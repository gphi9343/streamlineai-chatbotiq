// backend/server.js
// V1.1 — adds conversation memory in Supabase. Single-turn endpoint becomes
// multi-turn: each /chat request loads prior turns for the session and
// persists the new exchange.
//
// Flow per /chat request:
//   1. Validate session_id and message
//   2. Upsert session in Supabase (sets last_active_at)
//   3. Persist user message
//   4. Fetch recent history (last N turns, excluding the just-saved one)
//   5. Stream Claude response, accumulate server-side
//   6. Validate accumulated response
//   7. Persist assistant message with stop_reason and token usage
//   8. Route on stop_reason

import express from 'express';
import cors from 'cors';
import { callAnthropic } from './lib/anthropic.js';
import { makeError, sendError } from './lib/errors.js';
import { handleStopReason } from './lib/stop-reason.js';
import { validateStreamedResponse } from './lib/validate.js';
import { isValidSessionId } from './lib/sessions.js';
import {
  ensureSession,
  getRecentMessages,
  saveUserMessage,
  saveAssistantMessage,
} from './lib/supabase.js';
import { upuntConfig } from './config/upunt.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || '*',
  methods: ['GET', 'POST'],
}));
app.use(express.json({ limit: '100kb' }));

// Health check — Railway uses this to confirm the service is up
app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: 'v1.1', timestamp: new Date().toISOString() });
});

// /chat — V1.1 multi-turn endpoint, streams response back to frontend
app.post('/chat', async (req, res) => {
  const { message, session_id } = req.body;

  // Input validation — fail fast before calling the API
  if (!isValidSessionId(session_id)) {
    return sendError(res, 400, makeError({
      type: 'validation_error',
      message: 'Request body must include a valid UUID session_id.',
      suggestion: 'Send { "session_id": "<uuid>", "message": "..." }',
      recoverable: false,
    }));
  }

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return sendError(res, 400, makeError({
      type: 'validation_error',
      message: 'Request body must include a non-empty "message" string.',
      suggestion: 'Send { "session_id": "<uuid>", "message": "your question here" }',
      recoverable: false,
    }));
  }

  if (message.length > 4000) {
    return sendError(res, 400, makeError({
      type: 'validation_error',
      message: 'Message exceeds 4000 character limit.',
      suggestion: 'Shorten the message and retry.',
      recoverable: false,
    }));
  }

  // Set up SSE-style streaming response
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable proxy buffering

  // Accumulate full response server-side for post-stream validation
  let accumulatedText = '';
  let finalStopReason = null;
  let finalUsage = null;

  try {
    // Ensure session row exists (idempotent upsert)
    const sessionResult = await ensureSession(session_id, upuntConfig.client_slug);
    if (!sessionResult.ok) {
      console.error('[ensure_session_failed]', sessionResult.error);
      res.write(`data: ${JSON.stringify({ type: 'error', error: sessionResult.error })}\n\n`);
      res.end();
      return;
    }

    // Persist user message FIRST so a crash mid-stream still preserves the input
    const userSave = await saveUserMessage(session_id, message);
    if (!userSave.ok) {
      console.error('[save_user_message_failed]', userSave.error);
      res.write(`data: ${JSON.stringify({ type: 'error', error: userSave.error })}\n\n`);
      res.end();
      return;
    }

    // Fetch recent history. The just-saved user message is the last entry —
    // drop it so it isn't duplicated in the messages array (callAnthropic
    // appends `userMessage` itself).
    const historyResult = await getRecentMessages(session_id);
    if (!historyResult.ok) {
      console.error('[get_recent_messages_failed]', historyResult.error);
      res.write(`data: ${JSON.stringify({ type: 'error', error: historyResult.error })}\n\n`);
      res.end();
      return;
    }
    const history = historyResult.messages.slice(0, -1);

    // Stream from Claude
    const stream = await callAnthropic({
      userMessage: message,
      config: upuntConfig,
      history,
    });

    for await (const event of stream) {
      // content_block_delta — the actual text tokens
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        const chunk = event.delta.text;
        accumulatedText += chunk;
        res.write(`data: ${JSON.stringify({ type: 'token', text: chunk })}\n\n`);
      }

      // message_delta — contains stop_reason and final usage
      if (event.type === 'message_delta') {
        if (event.delta?.stop_reason) finalStopReason = event.delta.stop_reason;
        if (event.usage) finalUsage = { ...finalUsage, ...event.usage };
      }

      // message_start — initial usage (input_tokens, cache_read/write counts)
      if (event.type === 'message_start' && event.message?.usage) {
        finalUsage = { ...finalUsage, ...event.message.usage };
      }
    }

    // Post-stream validation
    const validation = validateStreamedResponse(accumulatedText, finalStopReason);
    if (!validation.ok) {
      // Stream is already partially delivered — log loudly, signal to frontend
      console.error('[validation_failure]', validation);
      res.write(`data: ${JSON.stringify({
        type: 'error',
        error: makeError({
          type: 'validation_error',
          message: validation.message,
          suggestion: 'Response was malformed. Retry the message.',
          recoverable: false,
        }),
      })}\n\n`);
      res.end();
      return;
    }

    // Persist assistant message + diagnostics. Fire-and-log: if persistence
    // fails the user has already seen the response, no point surfacing.
    const assistantSave = await saveAssistantMessage(session_id, accumulatedText, {
      stop_reason: finalStopReason,
      input_tokens: finalUsage?.input_tokens,
      output_tokens: finalUsage?.output_tokens,
      cache_read_tokens: finalUsage?.cache_read_input_tokens,
      cache_write_tokens: finalUsage?.cache_creation_input_tokens,
    });
    if (!assistantSave.ok) {
      console.error('[save_assistant_message_failed]', assistantSave.error);
    }

    // stop_reason routing — V1.0 stub, expanded in later versions
    const routerResult = handleStopReason(finalStopReason, accumulatedText);
    if (routerResult.action === 'continue') {
      console.warn('[stop_reason_unhandled]', { stop_reason: finalStopReason, version: 'v1.1' });
    }

    // Send final completion event
    res.write(`data: ${JSON.stringify({
      type: 'done',
      stop_reason: finalStopReason,
      usage: finalUsage,
    })}\n\n`);
    res.end();

    // Server-side log — V1.0 console only, dashboard arrives at V1.7
    console.log('[chat_complete]', {
      session_id,
      message_length: message.length,
      response_length: accumulatedText.length,
      history_turns: history.length,
      stop_reason: finalStopReason,
      usage: finalUsage,
    });

  } catch (err) {
    // Catch-all for structured errors thrown by callAnthropic, plus anything
    // unstructured that escaped.
    console.error('[chat_unhandled_error]', err);

    // If callAnthropic threw a structured error, it has type/message/suggestion fields
    const structured = (err && typeof err === 'object' && err.type)
      ? err
      : makeError({
          type: 'downstream_unavailable',
          message: 'Unexpected server error.',
          suggestion: 'Retry. If the issue persists, check Railway logs.',
          recoverable: true,
        });

    if (!res.headersSent) {
      return sendError(res, 500, structured);
    }
    // Headers already sent (mid-stream) — write structured error event
    res.write(`data: ${JSON.stringify({ type: 'error', error: structured })}\n\n`);
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`[server_started] ChatbotIQ V1.1 listening on port ${PORT}`);
});
