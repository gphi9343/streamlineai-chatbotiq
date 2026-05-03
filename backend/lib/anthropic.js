// backend/lib/anthropic.js
//
// V1.2 changes from V1.1:
// - New optional `contextBlock` parameter. When present, it is injected as
//   a user-role message immediately before the current user message. This
//   is where retrieved KB hits go (Option B architecture — keeps the
//   system prompt cache warm).
// - System prompt is now ASSEMBLED by the caller (lib/system-prompt.js)
//   from CONFIG fields, not pulled from a single CONFIG.system_prompt
//   field. V1.1 had a latent bug where that field didn't exist; this fix
//   ensures the bot actually receives identity, guardrails, and KB rules.
//
// Cache split discipline preserved:
//   CACHED block:    assembled system prompt (stable across the session)
//   DYNAMIC block:   conversation history + context block + current user message
//
// V1.1 contract preserved:
//   - Same function name `streamChat`
//   - Same shape `{systemPrompt, history, userMessage, onToken}` plus
//     new optional `contextBlock`
//   - Same return shape `{ok, text, stop_reason, usage}`
//
// Anyone calling streamChat without contextBlock gets V1.1 behaviour.

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
 * @param {string} [params.contextBlock] - optional KB context (V1.2+)
 * @param {function(string): void} params.onToken - called per text delta
 * @returns {Promise<{ok: true, text: string, stop_reason: string, usage: object} | {ok: false, error: object}>}
 */
export async function streamChat({
  systemPrompt,
  history,
  userMessage,
  contextBlock,
  onToken,
}) {
  const messages = [...history.map(m => ({ role: m.role, content: m.content }))];

  // V1.2 — context block is injected as a user-role message immediately
  // before the current user message. The model treats it as supplied
  // context for the next question. This keeps it OUT of the cached
  // system prompt, preserving cache hits across turns.
  if (contextBlock && contextBlock.trim()) {
    messages.push({ role: 'user', content: contextBlock });
    messages.push({
      role: 'assistant',
      content: 'Understood. I will use that context for your next question.',
    });
  }

  messages.push({ role: 'user', content: userMessage });

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
