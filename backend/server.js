// backend/server.js
//
// V1.2 changes from V1.1:
//
// 1. KB retrieval per turn (lib/kb.js)
//    Before calling Claude, retrieve top KB hits matching the user's message
//    and inject them as a context block in the messages array.
//
// 2. System prompt assembled from CONFIG (lib/system-prompt.js)
//    V1.1 referenced CONFIG.system_prompt — that field doesn't exist on
//    upuntConfig, so the bot ran with no system prompt at all. V1.2 fixes
//    this by building the system prompt from CONFIG fields (identity,
//    guardrails, KB rules, INSUFFICIENT DATA rule).
//
// 3. Build Standard #1 actually delivers cache hits at V1.2+
//    System prompt is now substantial (~600-1000 tokens). KB content lives
//    in the dynamic message array, not the system prompt. Cache stays warm
//    across turns of the same session.
//
// V1.1 contract preserved at the SSE layer — same event names, same JSON
// payloads. Frontend doesn't change.

import express from 'express';
import cors from 'cors';

import { streamChat } from './lib/anthropic.js';
import { makeError, serialiseError, sendError } from './lib/errors.js';
import { handleStopReason } from './lib/stop-reason.js';
import { validateStreamedResponse } from './lib/validate.js';
import { isValidSessionId } from './lib/sessions.js';
import {
  ensureSession,
  getRecentMessages,
  saveUserMessage,
  saveAssistantMessage,
} from './lib/supabase.js';
import { retrieveKb } from './lib/kb.js';
import { buildSystemPrompt, renderKbContext } from './lib/system-prompt.js';

import { upuntConfig } from './config/upunt.js';

const app = express();
app.use(express.json({ limit: '32kb' }));

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'http://localhost:3000';
app.use(
  cors({
    origin: ALLOWED_ORIGIN,
    methods: ['GET', 'POST'],
  })
);

const CONFIG = upuntConfig;
const PORT = process.env.PORT || 3000;

// Build the cached system prompt ONCE at boot. Stable across all turns
// of all sessions for this deployment. Anthropic's ephemeral cache will
// hit on this block as long as it's identical (>~1024 tokens required).
const SYSTEM_PROMPT = buildSystemPrompt(CONFIG);


// ----------------------------------------------------------------
// Health
// ----------------------------------------------------------------
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    version: '1.4',
    deployment: CONFIG.deployment_name,
    system_prompt_chars: SYSTEM_PROMPT.length,
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
    return sendError(
      res,
      400,
      makeError({
        type: 'validation_error',
        message: 'Invalid or missing session_id',
        suggestion: 'Send a UUID v4 in session_id.',
        recoverable: false,
      })
    );
  }
  if (typeof message !== 'string' || !message.trim() || message.length > 4000) {
    return sendError(
      res,
      400,
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
    send('error', serialiseError(sessionResult.error));
    return res.end();
  }

  // --- Persist user message (before API call — crash-survivable)
  const userSave = await saveUserMessage(session_id, message);
  if (!userSave.ok) {
    send('error', serialiseError(userSave.error));
    return res.end();
  }

  // --- Fetch history (drops last entry, which is the just-saved user message)
  const historyResult = await getRecentMessages(session_id);
  if (!historyResult.ok) {
    send('error', serialiseError(historyResult.error));
    return res.end();
  }
  const history = historyResult.messages.slice(0, -1);

  // --- V1.2: Retrieve KB hits for this query
  const kbResult = await retrieveKb({
    deploymentSlug: CONFIG.client_slug,
    query: message,
  });
  if (!kbResult.ok) {
    // KB retrieval failure is NOT fatal — degrade to no-context mode.
    // Bot will hit INSUFFICIENT DATA on most questions but stays alive.
    console.warn('[kb] retrieval failed:', kbResult.error.message);
  }
  const hits = kbResult.ok ? kbResult.hits : [];
  const contextBlock = renderKbContext(hits);

  // --- Stream Claude
  const result = await streamChat({
    systemPrompt: SYSTEM_PROMPT,
    history,
    userMessage: message,
    contextBlock,
    onToken: chunk => send('token', { text: chunk }),
  });

  if (!result.ok) {
    send('error', serialiseError(result.error));
    return res.end();
  }

  // --- Validate accumulated response (Build Standard #3)
  const validation = validateStreamedResponse(result.text, result.stop_reason);
  if (!validation.ok) {
    console.warn('[validate] post-stream validation failed:', validation.message);
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
    console.error(
      '[persist] saveAssistantMessage failed:',
      serialiseError(assistantSave.error)
    );
  }

  // --- Route on stop_reason (Build Standard #5)
  const routerAction = handleStopReason(result.stop_reason, result.text);
  if (routerAction.action !== 'complete') {
    send('stop_reason', {
      reason: routerAction.reason,
      action: routerAction.action,
    });
  }

  send('done', {
    stop_reason: result.stop_reason,
    kb_hits: hits.length,
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
  console.log(`[chatbotiq] V1.4 listening on :${PORT}`);
  console.log(`[chatbotiq] deployment: ${CONFIG.deployment_name}`);
  console.log(`[chatbotiq] system prompt: ${SYSTEM_PROMPT.length} chars`);
  console.log(`[chatbotiq] CORS origin: ${ALLOWED_ORIGIN}`);
});
