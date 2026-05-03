// backend/lib/supabase.js
//
// Supabase client + CRUD for sessions and messages.
// Backend-only. Uses the secret/service_role key. Never expose to the browser.
//
// Errors returned from this module conform to the structured error shape
// from lib/errors.js. Raw Supabase errors are caught and classified.

import { createClient } from '@supabase/supabase-js';
import { makeError } from './errors.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  // Fail fast at boot — config_error category, not recoverable.
  throw new Error(
    'Missing Supabase env vars. Set SUPABASE_URL and SUPABASE_SECRET_KEY in Railway.'
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { persistSession: false }, // backend doesn't need auth state
});

// How many recent turns to send back to the API. Older turns stay in DB
// but aren't included in the prompt context.
// 20 turns ~= 10 user/assistant pairs. Token-budget management is V1.2+.
const MAX_HISTORY_TURNS = 20;


// ----------------------------------------------------------------
// Sessions
// ----------------------------------------------------------------

/**
 * Create or upsert a session. Idempotent — calling with an existing id
 * updates last_active_at without overwriting created_at.
 *
 * @param {string} sessionId - UUID generated client-side
 * @param {string} deployment - CONFIG name, e.g. "upunt"
 * @returns {Promise<{ok: true} | {ok: false, error: object}>}
 */
export async function ensureSession(sessionId, deployment) {
  const { error } = await supabase
    .from('sessions')
    .upsert(
      {
        id: sessionId,
        deployment,
        last_active_at: new Date().toISOString(),
      },
      { onConflict: 'id', ignoreDuplicates: false }
    );

  if (error) {
    return {
      ok: false,
      error: classifySupabaseError(error, 'ensureSession failed'),
    };
  }
  return { ok: true };
}


// ----------------------------------------------------------------
// Messages
// ----------------------------------------------------------------

/**
 * Fetch the most recent N turns for a session, oldest-first
 * (the order the API expects in the messages array).
 *
 * @param {string} sessionId
 * @returns {Promise<{ok: true, messages: Array} | {ok: false, error: object}>}
 */
export async function getRecentMessages(sessionId) {
  // Fetch in reverse chronological order, then reverse client-side.
  // Postgres LIMIT applies after ORDER BY, so this gets the last N.
  const { data, error } = await supabase
    .from('messages')
    .select('role, content')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(MAX_HISTORY_TURNS);

  if (error) {
    return {
      ok: false,
      error: classifySupabaseError(error, 'getRecentMessages failed'),
    };
  }

  // Reverse to oldest-first for the Anthropic API.
  return { ok: true, messages: (data || []).reverse() };
}

/**
 * Persist a user message.
 *
 * @param {string} sessionId
 * @param {string} content
 * @returns {Promise<{ok: true} | {ok: false, error: object}>}
 */
export async function saveUserMessage(sessionId, content) {
  const { error } = await supabase
    .from('messages')
    .insert({ session_id: sessionId, role: 'user', content });

  if (error) {
    return {
      ok: false,
      error: classifySupabaseError(error, 'saveUserMessage failed'),
    };
  }
  return { ok: true };
}

/**
 * Persist an assistant message with diagnostics.
 *
 * @param {string} sessionId
 * @param {string} content
 * @param {object} meta - { stop_reason, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens }
 * @returns {Promise<{ok: true} | {ok: false, error: object}>}
 */
export async function saveAssistantMessage(sessionId, content, meta = {}) {
  const { error } = await supabase
    .from('messages')
    .insert({
      session_id: sessionId,
      role: 'assistant',
      content,
      stop_reason: meta.stop_reason ?? null,
      input_tokens: meta.input_tokens ?? null,
      output_tokens: meta.output_tokens ?? null,
      cache_read_tokens: meta.cache_read_tokens ?? null,
      cache_write_tokens: meta.cache_write_tokens ?? null,
    });

  if (error) {
    return {
      ok: false,
      error: classifySupabaseError(error, 'saveAssistantMessage failed'),
    };
  }
  return { ok: true };
}


// ----------------------------------------------------------------
// Error classification
// ----------------------------------------------------------------

/**
 * Map Supabase error shapes to our structured error taxonomy.
 *
 * Supabase errors have: { message, code, details, hint }.
 * Postgres error codes: https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
function classifySupabaseError(err, context) {
  // Network / unreachable
  if (err.message?.includes('fetch failed') || err.message?.includes('ENOTFOUND')) {
    return makeError({
      type: 'downstream_unavailable',
      message: `${context}: Supabase unreachable`,
      suggestion: 'Retry; check Supabase project is not paused.',
      recoverable: true,
    });
  }

  // Auth / key issues
  if (err.message?.includes('JWT') || err.message?.includes('Invalid API key')) {
    return makeError({
      type: 'auth_failure',
      message: `${context}: Supabase auth failed`,
      suggestion: 'Check SUPABASE_SECRET_KEY env var on Railway.',
      recoverable: false,
    });
  }

  // Schema / validation
  if (err.code?.startsWith('23') || err.code?.startsWith('22')) {
    // 23xxx = integrity constraint violation, 22xxx = data exception
    return makeError({
      type: 'validation_error',
      message: `${context}: ${err.message}`,
      suggestion: 'Input violates schema constraints.',
      recoverable: false,
    });
  }

  // Default — treat as recoverable downstream issue
  return makeError({
    type: 'downstream_unavailable',
    message: `${context}: ${err.message || 'unknown Supabase error'}`,
    suggestion: 'Retry; if persistent, check Supabase status.',
    recoverable: true,
  });
}
