// backend/lib/anthropic.js
// Anthropic API wrapper.
// Build Standard #1: prompt caching on system prompt (cache_control: ephemeral)
// Build Standard #4: streaming enabled — first-token latency target ~500ms
// Build Standard #2: errors classified to structured shape

import Anthropic from '@anthropic-ai/sdk';
import { makeError } from './errors.js';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MODEL = 'claude-sonnet-4-5';
const MAX_TOKENS = 1024;

/**
 * Build the system prompt from CONFIG.
 * V1.0 returns a minimal prompt — voice profile and KB schema arrive at V1.5/V1.2.
 *
 * Cache discipline (Build Standard #1):
 *   The returned string IS the cached block. It must be stable across the session.
 *   Anything that changes per-turn (user message, retrieved KB content, conversation
 *   history) must NOT live in this string — it goes in the messages array instead.
 */
function buildSystemPrompt(config) {
  return `You are a chatbot assistant for ${config.deployment_name}.

Domain: ${config.domain}

Behaviour:
- Answer the user's question directly.
- If you do not have the information needed to answer confidently, respond with: "INSUFFICIENT DATA — [brief reason]." Do not guess.
- Keep responses concise.

This is V1.0 of the engine — voice profile, knowledge base, and expert injection arrive in later versions.`;
}

/**
 * Call Anthropic's Messages API with streaming enabled.
 * Returns an async iterable of stream events.
 *
 * Throws structured errors classified per Build Standard #2.
 */
export async function callAnthropic({ userMessage, config }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw makeError({
      type: 'config_error',
      message: 'ANTHROPIC_API_KEY environment variable not set.',
      suggestion: 'Set ANTHROPIC_API_KEY in Railway env vars.',
      recoverable: false,
    });
  }

  try {
    const stream = await client.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: [
        {
          type: 'text',
          text: buildSystemPrompt(config),
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        { role: 'user', content: userMessage },
      ],
    });

    return stream;

  } catch (err) {
    // Classify SDK errors to structured shape
    throw classifyAnthropicError(err);
  }
}

/**
 * Map Anthropic SDK errors to the structured error shape.
 * Recoverable types drive the agentic retry loop; hard types fail fast.
 */
function classifyAnthropicError(err) {
  const status = err?.status || err?.response?.status;
  const errorType = err?.error?.type || err?.type;

  // Auth failures — hard error, no retry
  if (status === 401 || errorType === 'authentication_error') {
    return makeError({
      type: 'auth_failure',
      message: 'Anthropic API authentication failed.',
      suggestion: 'Verify ANTHROPIC_API_KEY in Railway env vars is correct and not revoked.',
      recoverable: false,
    });
  }

  // Rate limit — recoverable with backoff per retry-after header
  if (status === 429 || errorType === 'rate_limit_error') {
    return makeError({
      type: 'rate_limit',
      message: 'Anthropic API rate limit hit.',
      suggestion: `Retry after ${err?.headers?.['retry-after'] || '60'} seconds.`,
      recoverable: true,
    });
  }

  // Content filter — model declined to respond
  if (errorType === 'invalid_request_error' && /content/i.test(err?.message || '')) {
    return makeError({
      type: 'content_filter',
      message: 'Request blocked by content policy.',
      suggestion: 'Rephrase the message.',
      recoverable: false,
    });
  }

  // Validation — request shape was wrong
  if (status === 400 || errorType === 'invalid_request_error') {
    return makeError({
      type: 'validation_error',
      message: err?.message || 'Invalid request to Anthropic API.',
      suggestion: 'Check request payload structure.',
      recoverable: false,
    });
  }

  // Service down — recoverable
  if (status === 503 || status === 502 || status === 504) {
    return makeError({
      type: 'downstream_unavailable',
      message: 'Anthropic API temporarily unavailable.',
      suggestion: 'Retry with backoff.',
      recoverable: true,
    });
  }

  // Timeout — recoverable
  if (err?.code === 'ETIMEDOUT' || err?.code === 'ECONNABORTED' || /timeout/i.test(err?.message || '')) {
    return makeError({
      type: 'api_timeout',
      message: 'Anthropic API request timed out.',
      suggestion: 'Retry with backoff.',
      recoverable: true,
    });
  }

  // Unknown — treat as recoverable downstream failure, log loudly
  console.error('[unclassified_anthropic_error]', err);
  return makeError({
    type: 'downstream_unavailable',
    message: err?.message || 'Unknown Anthropic API error.',
    suggestion: 'Retry. Check Railway logs for details.',
    recoverable: true,
  });
}
