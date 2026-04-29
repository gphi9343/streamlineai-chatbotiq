// backend/server.js
// V1.0 — Web chat → Anthropic API → reply. Prove the pipe.
// No memory, no KB, no voice profile. Those arrive at V1.1+.

import express from 'express';
import cors from 'cors';
import { callAnthropic } from './lib/anthropic.js';
import { makeError, sendError } from './lib/errors.js';
import { handleStopReason } from './lib/stop-reason.js';
import { validateStreamedResponse } from './lib/validate.js';
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
  res.json({ status: 'ok', version: 'v1.0', timestamp: new Date().toISOString() });
});

// /chat — V1.0 single-turn endpoint, streams response back to frontend
app.post('/chat', async (req, res) => {
  const { message } = req.body;

  // Input validation — fail fast before calling the API
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return sendError(res, 400, makeError({
      type: 'validation_error',
      message: 'Request body must include a non-empty "message" string.',
      suggestion: 'Send { "message": "your question here" }',
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
    const stream = await callAnthropic({
      userMessage: message,
      config: upuntConfig,
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
        if (event.usage) finalUsage = event.usage;
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

    // stop_reason routing — V1.0 stub, expanded in later versions
    const routerResult = handleStopReason(finalStopReason, accumulatedText);
    if (routerResult.action === 'continue') {
      // V1.0 only handles end_turn. Anything else logs a warning.
      console.warn('[stop_reason_unhandled]', { stop_reason: finalStopReason, version: 'v1.0' });
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
      message_length: message.length,
      response_length: accumulatedText.length,
      stop_reason: finalStopReason,
      usage: finalUsage,
    });

  } catch (err) {
    // Catch-all for unstructured errors that escaped the API layer
    console.error('[chat_unhandled_error]', err);
    if (!res.headersSent) {
      return sendError(res, 500, makeError({
        type: 'downstream_unavailable',
        message: 'Unexpected server error.',
        suggestion: 'Retry. If the issue persists, check Railway logs.',
        recoverable: true,
      }));
    }
    // Headers already sent (mid-stream) — write structured error event
    res.write(`data: ${JSON.stringify({
      type: 'error',
      error: makeError({
        type: 'downstream_unavailable',
        message: 'Stream interrupted unexpectedly.',
        suggestion: 'Retry the message.',
        recoverable: true,
      }),
    })}\n\n`);
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`[server_started] ChatbotIQ V1.0 listening on port ${PORT}`);
});
