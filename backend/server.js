// backend/server.js
//
// V1.1 — adds conversation memory.
//
// Flow per /chat request:
//   1. Validate session_id and user_message
//   2. Upsert session in Supabase (sets last_active_at)
//   3. Persist user message
//   4. Fetch recent history (last N turns)
//   5. Stream Claude response to client AND accumulate server-side
//   6. After stream closes: validate accumulated response
//   7. Persist assistant message with token usage and stop_reason
//   8. Route on stop_reason for any non-end_turn cases
//
// On error at any step, return structured error per lib/errors.js.

import express from 'express';
import cors from 'cors';

import { streamChat } from './lib/anthropic.js';
import { makeError, isStructuredError } from './lib/errors.js';
import { routeStopReason } from './lib/stop-reason.js';
import { validateAssistantText } from './lib/validate.js';
import { isValidSessionId } from './lib/sessions.js';
import {
  ensureSession,
  getRecentMessages,
  saveUserMessage,
  saveAssistantMessage,
} from './lib/supabase.js';

import upunt from './config/upunt.js';

const app = express();
app.use(express.json({ limit: '32kb' }));

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'http://localhost:3000';
app.use(
  cors({
    origin: ALLOWED_ORIGIN,
    methods: ['GET', 'POST'],
  })
);

const CONFIG = upunt;
const PORT = process.env.PORT || 3000;


// ----------------------------------------------------------------
// Health
// ----------------------------------------------------------------
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    version: '1.1',
    deployment: CONFIG.deployment_name,
    timestamp: new Date().toISOString(),
  });
});


// ----------------------------------------------------------------
// Chat — SSE stream
// ----------------------------------------------------------------
app.post('/chat', async (req, res) => {
  const { session_id, message } = req.body || {};

  // --- Input validation
  if (!isValidSessionId(session_id)) {
    return res.status(400).json(
      makeError({
        type: 'validation_error',
        message: 'Invalid or missing session_id',
        suggestion: 'Send a UUID v4 in session_id.',
        recoverable: false,
      })
    );
  }
  if (typeof message !== 'string' || !message.trim() || message.length > 4000) {
    return res.status(400).json(
      makeError({
        type: 'validation_error',
        message: 'Invalid message',
        suggestion: 'Send a non-empty string under 4000 chars.',
        recoverable: false,
      })
    );
  }

  // --- Set up SSE response
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // --- Ensure session row exists
  const sessionResult = await ensureSession(session_id, CONFIG.deployment_name);
  if (!sessionResult.ok) {
    send('error', sessionResult.error);
    return res.end();
  }

  // --- Persist user message
  const userSave = await saveUserMessage(session_id, message);
  if (!userSave.ok) {
    send('error', userSave.error);
    return res.end();
  }

  // --- Fetch history (excludes the message we just saved? no — it's there now)
  // We saved first so a crash mid-stream still preserves the user input.
  // The history fetch will include the just-saved user message as the
  // last entry; we drop it to avoid duplicating it via `userMessage`.
  const historyResult = await getRecentMessages(session_id);
  if (!historyResult.ok) {
    send('error', historyResult.error);
    return res.end();
  }
  const history = historyResult.messages.slice(0, -1); // drop the just-saved user msg

  // --- Stream Claude
  const result = await streamChat({
    systemPrompt: CONFIG.system_prompt,
    history,
    userMessage: message,
    onToken: chunk => send('token', { text: chunk }),
  });

  if (!result.ok) {
    send('error', result.error);
    return res.end();
  }

  // --- Validate accumulated response (Build Standard #3)
  const validation = validateAssistantText(result.text);
  if (!validation.ok) {
    // Validation failure post-stream — log, but the user has already seen
    // the output. Still persist what we got, marked with the validation
    // issue in stop_reason for diagnostics.
    console.warn('[validate] post-stream validation failed:', validation.error);
  }

  // --- Persist assistant message + diagnostics
  const usage = result.usage || {};
  const assistantSave = await saveAssistantMessage(session_id, result.text, {
    stop_reason: result.stop_reason,
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cache_read_tokens: usage.cache_read_input_tokens,
    cache_write_tokens: usage.cache_creation_input_tokens,
  });
  if (!assistantSave.ok) {
    // We already streamed the response; failing to persist is logged
    // but not surfaced to the user.
    console.error('[persist] saveAssistantMessage failed:', assistantSave.error);
  }

  // --- Route on stop_reason (Build Standard #5)
  const routerAction = routeStopReason(result.stop_reason);
  if (routerAction.action !== 'complete') {
    send('stop_reason', { reason: result.stop_reason, action: routerAction.action });
  }

  send('done', {
    stop_reason: result.stop_reason,
    usage: {
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_read_input_tokens: usage.cache_read_input_tokens,
      cache_creation_input_tokens: usage.cache_creation_input_tokens,
    },
  });
  res.end();
});


// ----------------------------------------------------------------
// Boot
// ----------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`[chatbotiq] V1.1 listening on :${PORT}`);
  console.log(`[chatbotiq] deployment: ${CONFIG.deployment_name}`);
  console.log(`[chatbotiq] CORS origin: ${ALLOWED_ORIGIN}`);
});
