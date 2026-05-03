// backend/lib/anthropic.js
//
// V1.1 changes:
// - Accepts `history` array (prior turns from Supabase) and prepends
//   to the current user message.
// - Returns token usage from the API response so the caller can persist it
//   (confirms prompt caching is actually working — Build Standard #1).
//
// The cache split discipline is preserved:
//   CACHED block:   system prompt template (stable across the session)
//   DYNAMIC block:  conversation history + current user message (per turn)
//
// Conversation history goes in the `messages` array, not the system block,
// so adding a turn does not invalidate the system-prompt cache.

import Anthropic from '@anthropic-ai/sdk';
import { makeError } from './errors.js';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MODEL = 'claude-sonnet-4-5';
const MAX_TOKENS = 1024;

/**
 * Stream a response from Claude.
 *
 * @param {object} params
 * @param {string} params.systemPrompt - cached
 * @param {Array<{role: string, content: string}>} params.history - prior turns
 * @param {string} params.userMessage - current turn
 * @param {function(string): void} params.onToken - called per text delta
 * @returns {Promise<{ok: true, text: string, stop_reason: string, usage: object} | {ok: false, error: object}>}
 */
export async function streamChat({ systemPrompt, history, userMessage, onToken }) {
  const messages = [
    ...history.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ];

  let accumulated = '';
  let stop_reason = null;
  let usage = null;

  try {
    const stream = await client.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: [
        {
          type: 'text',
          text: systemPrompt,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages,
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        const chunk = event.delta.text;
        accumulated += chunk;
        onToken(chunk);
      } else if (event.type === 'message_delta') {
        if (event.delta?.stop_reason) stop_reason = event.delta.stop_reason;
        if (event.usage) usage = { ...usage, ...event.usage };
      } else if (event.type === 'message_start' && event.message?.usage) {
        usage = { ...usage, ...event.message.usage };
      }
    }

    return {
      ok: true,
      text: accumulated,
      stop_reason,
      usage: usage || {},
    };
  } catch (err) {
    return { ok: false, error: classifyAnthropicError(err) };
  }
}


function classifyAnthropicError(err) {
  const status = err.status || err.response?.status;

  if (err.name === 'APIConnectionTimeoutError' || err.code === 'ETIMEDOUT') {
    return makeError({
      type: 'api_timeout',
      message: 'Anthropic API timeout',
      suggestion: 'Retry with backoff.',
      recoverable: true,
    });
  }

  if (status === 429) {
    return makeError({
      type: 'rate_limit',
      message: 'Anthropic rate limit hit',
      suggestion: 'Retry per retry-after header.',
      recoverable: true,
    });
  }

  if (status === 401 || status === 403) {
    return makeError({
      type: 'auth_failure',
      message: 'Anthropic auth failed',
      suggestion: 'Check ANTHROPIC_API_KEY env var on Railway.',
      recoverable: false,
    });
  }

  if (status === 400) {
    return makeError({
      type: 'validation_error',
      message: `Anthropic rejected request: ${err.message}`,
      suggestion: 'Check request shape; deadletter the input.',
      recoverable: false,
    });
  }

  if (status >= 500 && status < 600) {
    return makeError({
      type: 'downstream_unavailable',
      message: `Anthropic API ${status}`,
      suggestion: 'Retry with backoff.',
      recoverable: true,
    });
  }

  return makeError({
    type: 'downstream_unavailable',
    message: err.message || 'Unknown Anthropic error',
    suggestion: 'Retry; if persistent, check Anthropic status.',
    recoverable: true,
  });
}
