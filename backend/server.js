// backend/server.js
//
// V1.4.7 (Session 33) — Add standalone POST /free-tool-proxy endpoint for
// DecisionIQ + StaffTalkIQ, which 504 on Netlify's synchronous-function wall
// (~28-30s) for their heaviest calls. Railway has no short execution wall.
//
// The new endpoint is DELIBERATELY SEPARATE from /chat. It does NOT:
//   - resolve a deployment via getDeploymentByOrigin (free tools have no
//     deployment config and would be strict-rejected)
//   - touch Supabase, KB retrieval, SSE, or the system-prompt cache
// It only forwards { model, max_tokens, system, messages } to Anthropic
// (non-streaming, via proxyMessage in lib/anthropic.js) and returns the JSON.
// Ports the Netlify proxy.js contract: caller supplies model + max_tokens.
//
// CORS: the two free-tool origins are appended to ALLOWED_ORIGINS (Railway
// env var) — no code change to the allow-list. Passing CORS is sufficient
// for this route because it never runs deployment dispatch.
//
// V1.4.4 — Patch increment. VERBATIM RESPONSE SCOPE block relocated to sit
// AFTER voice profile in cached system prompt (system-prompt.js). Voice
// profile carve-out added to style field in both deployments' CONFIG
// (streamlineai.js, upunt.js). No server.js behaviour change — version
// label bump only.
//
// Surfaced by Session 26 V1.4.3 smoke test (Tests B and C failed on
// directive despite live presence in deployed prompt). D1 Session 27
// decision: Option 1 + Option 2 combined — relocate the rule, amend the
// voice profile, reinforce from both sides.
//
// V1.4.3 patch scope (in other files):
//   - lib/system-prompt.js: VERBATIM RESPONSE SCOPE directive added between
//     VERBATIM PRECEDENCE and NEVER FABRICATE in KB rendering rules.
//
// V1.4.2 patch scope (in other files):
//   - lib/kb.js: retrieval switched from .textSearch() to RPC call to
//     search_kb(). Adds rank-based ordering + RELEVANCE_FLOOR enforcement.
//     Returns rank in hit shape for diagnostic visibility.
//   - migrations/v1.4.2-search-kb-rpc.sql: new Supabase RPC function.
//     Must be deployed to Supabase BEFORE this code ships, otherwise
//     retrievals fail with downstream_unavailable and bot degrades to
//     no-context mode.
//
// V1.4.1 baseline preserved:
//   - Pattern 11 case-3 fix (system-prompt.js — exclusion list extended,
//     wording domain-agnostic, VERBATIM precedence, NEVER FABRICATE)
//   - /admin/debug/system-prompt/:slug endpoint
//   - /admin/debug/retrieval/:slug?query=... endpoint (now returns rank
//     scores per hit thanks to the V1.4.2 RPC change)
//
// V1.4 baseline preserved:
//   - CORS allow-list shape (ALLOWED_ORIGINS plural canonical, ALLOWED_ORIGIN
//     singular fallback, localhost default for dev)
//   - /admin route mount, SSE event names and payload shapes
//   - Chat flow stages (validation, session ensure, persist user message,
//     fetch history, KB retrieve, stream Claude, validate, persist assistant,
//     stop_reason route, done event)
//   - Build Standards #1-#5 (caching, structured errors, validation,
//     streaming, stop_reason router) all preserved per-deployment
//   - /chat endpoint resolves CONFIG per-request via getDeploymentByOrigin().
//   - System prompts built once per deployment at first-request time and
//     cached in a Map<slug, string>. Preserves Build Standard #1 prompt-
//     caching across all deployments.

import express from 'express';
import cors from 'cors';

import { streamChat, proxyMessage } from './lib/anthropic.js';
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
import { adminRouter } from './routes/admin.js';

import {
  getDeploymentByOrigin,
  listDeployments,
  getDeploymentConfig,
} from './lib/auth.js';

const app = express();
app.use(express.json({ limit: '32kb' }));

// ----------------------------------------------------------------
// CORS — V1.3 allow-list shape (unchanged at V1.4 / V1.4.1 / V1.4.2 / V1.4.3 / V1.4.4)
// ----------------------------------------------------------------
// Read ALLOWED_ORIGINS (plural, comma-separated) as the canonical var.
// Fall back to ALLOWED_ORIGIN (singular, V1.4 var) for backwards-compat.
// If neither is set, default to localhost for dev.
//
// Note: this is the CORS allow-list (which origins can call the API at all).
// After CORS passes, /chat additionally resolves which DEPLOYMENT a given
// Origin maps to via getDeploymentByOrigin() — see chat handler below.
// Both lists must agree; an Origin in ALLOWED_ORIGINS but not in any
// CONFIG.allowed_origins will pass CORS and fail dispatch with config_error.
function resolveAllowedOrigins() {
  const plural = process.env.ALLOWED_ORIGINS;
  if (plural) {
    return plural.split(',').map(o => o.trim()).filter(Boolean);
  }
  const singular = process.env.ALLOWED_ORIGIN;
  if (singular) {
    return [singular];
  }
  return ['http://localhost:3000'];
}

const ALLOWED_ORIGINS = resolveAllowedOrigins();

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow same-origin / curl / health-check requests with no Origin header.
      if (!origin) return callback(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: origin ${origin} not in allow-list`));
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  })
);

const PORT = process.env.PORT || 3000;

// ----------------------------------------------------------------
// V1.4 — Per-deployment system prompt cache.
// ----------------------------------------------------------------
// Map<client_slug, string>. Built lazily on first request per deployment.
// Preserves Build Standard #1: each deployment's system prompt string is
// stable across the session, so Anthropic's ephemeral cache hits as it did
// at v1.3.3 — just with a per-deployment cached block instead of one shared.
const SYSTEM_PROMPT_CACHE = new Map();

function getSystemPromptFor(config) {
  const slug = config.client_slug;
  let prompt = SYSTEM_PROMPT_CACHE.get(slug);
  if (!prompt) {
    prompt = buildSystemPrompt(config);
    SYSTEM_PROMPT_CACHE.set(slug, prompt);
    console.log(
      `[chatbotiq] built system prompt for ${slug}: ${prompt.length} chars`
    );
  }
  return prompt;
}

// Pre-build prompts at boot for diagnostic visibility (logs the size of
// each deployment's prompt before any request arrives). Lazy build above
// would still work; this is just so the boot log surfaces deployment health.
function prebuildAllPrompts() {
  for (const { slug } of listDeployments()) {
    const config = getDeploymentConfig(slug);
    if (config) getSystemPromptFor(config);
  }
}


// ----------------------------------------------------------------
// Health
// ----------------------------------------------------------------
app.get('/health', (_req, res) => {
  const deployments = listDeployments().map(({ slug, display_name }) => {
    const config = getDeploymentConfig(slug);
    const prompt = config ? SYSTEM_PROMPT_CACHE.get(slug) : null;
    return {
      slug,
      display_name,
      system_prompt_chars: prompt ? prompt.length : null,
      allowed_origins: config ? config.allowed_origins || [] : [],
    };
  });

  res.json({
    status: 'ok',
    version: '1.5.0',
    deployments,
    cors_allowed_origins: ALLOWED_ORIGINS,
    timestamp: new Date().toISOString(),
  });
});


// ----------------------------------------------------------------
// Free-tool proxy (V1.4.7) — standalone, NOT part of /chat flow.
// ----------------------------------------------------------------
// Non-streaming Anthropic passthrough for free lead-gen tools (DecisionIQ,
// StaffTalkIQ) that 504 on Netlify's sync-function wall. Ports the Netlify
// proxy.js contract: body { model, max_tokens, system, messages } in,
// Anthropic response JSON out. No deployment dispatch, no Supabase, no KB,
// no SSE, no prompt cache. CORS allow-list (above) is the only gate; this
// route never calls getDeploymentByOrigin, so the /chat strict-reject does
// not apply. Shared-generic endpoint (D1 Session 33 decision, Option 1).
app.post('/free-tool-proxy', async (req, res) => {
  const { model, max_tokens, system, messages } = req.body || {};

  // Validate required fields (mirrors Netlify proxy.js guard)
  if (!model || !max_tokens || !Array.isArray(messages) || messages.length === 0) {
    return sendError(
      res,
      400,
      makeError({
        type: 'validation_error',
        message: 'Missing or invalid required fields: model, max_tokens, messages',
        suggestion: 'Send JSON { model, max_tokens, messages } (system optional).',
        recoverable: false,
      })
    );
  }

  const result = await proxyMessage({ model, max_tokens, system, messages });

  if (!result.ok) {
    // classifyAnthropicError already mapped status → structured shape.
    // Surface 5xx as 502 (downstream), 4xx as 400; recoverable drives nothing
    // here (free tools have no agentic retry loop) but is preserved in body.
    const httpStatus = result.error.recoverable ? 502 : 400;
    return sendError(res, httpStatus, result.error);
  }

  // Pass the SDK response through as JSON. Frontends read data.content[0].text.
  return res.json(result.body);
});



app.use('/admin', adminRouter);


// ----------------------------------------------------------------
// Chat — SSE stream
// ----------------------------------------------------------------
app.post('/chat', async (req, res) => {
  const { session_id, message } = req.body || {};

  // --- V1.4: Resolve deployment from Origin header.
  // Strict reject on miss — silent fallback would route to a default
  // deployment's voice (the V1.4 finding that prompted this work).
  const origin = req.headers.origin;
  const CONFIG = getDeploymentByOrigin(origin);
  if (!CONFIG) {
    return sendError(
      res,
      400,
      makeError({
        type: 'config_error',
        message: origin
          ? `Origin ${origin} is not registered to any deployment`
          : 'Missing Origin header — chat dispatch requires Origin',
        suggestion:
          'Verify that the calling site is in BOTH the ALLOWED_ORIGINS env var ' +
          'AND in some CONFIG.allowed_origins array. They must agree.',
        recoverable: false,
      })
    );
  }

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

  // --- Get the per-deployment cached system prompt
  const SYSTEM_PROMPT = getSystemPromptFor(CONFIG);

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
  const sessionResult = await ensureSession(
    session_id,
    CONFIG.deployment_name,
    CONFIG.client_slug
  );
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

  // --- V1.2: Retrieve KB hits for this query (deployment-scoped)
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

  // --- Retrieval observability (Session 36) — structured per-turn diagnostic.
  // Logging only: no behavioural change, no schema change, no added DB write.
  // It ties the query to what retrieval actually surfaced this turn (ok flag,
  // hit count, entry ids, ranks, content_types) alongside the model's response.
  // Those are the exact facts that were missing when the Macarthur "3-4 weeks"
  // turnaround fabrication could not be isolated post-hoc: assistant rows
  // persist the response text but never recorded what CONTEXT the model
  // received, so a later retrieval re-run only shows CURRENT KB state, not what
  // was in-context at the moment of the failing turn. With this line, the next
  // occurrence is separable from logs alone — "retrieval empty/failed →
  // fabricated" vs "correct entry in-context → model ignored it". One JSON
  // line per turn, greppable by [chat-diag]. Note: Railway log retention is a
  // rolling window; if durable/queryable capture is wanted later, persist the
  // same fields onto the assistant row behind a one-time column migration.
  console.log(
    '[chat-diag] ' +
      JSON.stringify({
        session_id,
        deployment: CONFIG.client_slug,
        query: message,
        retrieval_ok: kbResult.ok,
        retrieval_error: kbResult.ok ? null : kbResult.error.message,
        kb_hits: hits.length,
        kb_entries: hits.map(h => ({
          id: h.id,
          rank: typeof h.rank === 'number' ? Number(h.rank.toFixed(4)) : null,
          content_type: h.content_type,
        })),
        // Diagnostic-only addition (assembly-step investigation): the exact
        // CONTEXT block text as assembled by renderKbContext() and handed to
        // streamChat() — i.e. what actually left the process for the KB-entries
        // section, not just entry ids/ranks. Lets a failing turn's "what was
        // sent" be diffed byte-for-byte against "what came back" instead of
        // inferred from a truncated preview. No behavioural change: this is
        // the same string already built at line ~340, just also logged.
        kb_context_block: contextBlock,
        stop_reason: result.stop_reason,
        response_preview: (result.text || '').slice(0, 240),
        // Diagnostic-only addition: full response text (paired with
        // kb_context_block above) so the KB-entries section sent and the
        // response text received can be diffed directly on a test turn.
        response_full: result.text,
      })
  );

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
    deployment: CONFIG.client_slug,
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
prebuildAllPrompts();

app.listen(PORT, () => {
  console.log(`[chatbotiq] V1.5.0 listening on :${PORT}`);
  for (const { slug, display_name } of listDeployments()) {
    const prompt = SYSTEM_PROMPT_CACHE.get(slug);
    const chars = prompt ? prompt.length : 0;
    console.log(`[chatbotiq] deployment: ${slug} (${display_name}) — system prompt: ${chars} chars`);
  }
  console.log(`[chatbotiq] CORS origins: ${ALLOWED_ORIGINS.join(', ')}`);
});
