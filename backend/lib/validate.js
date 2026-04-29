// backend/lib/validate.js
// Build Standard #3: response validation.
// Never trust API output is well-formed. Validate before use.
//
// V1.0: confirm accumulated stream is a non-empty string and stop_reason is set.
// V1.4 (injection) and V1.6 (ingestion): validation failure writes to deadletter
//   queue, does not crash the cron job. (Not implemented in V1.0 — no cron yet.)

/**
 * Validate a streamed response after the stream has closed.
 * Returns { ok: true } or { ok: false, message: '...' }.
 */
export function validateStreamedResponse(accumulatedText, stopReason) {
  if (typeof accumulatedText !== 'string') {
    return {
      ok: false,
      message: 'Accumulated response is not a string.',
    };
  }

  if (accumulatedText.length === 0) {
    return {
      ok: false,
      message: 'Accumulated response is empty — stream produced no text.',
    };
  }

  if (!stopReason) {
    return {
      ok: false,
      message: 'Stream closed without a stop_reason.',
    };
  }

  // Sanity check — extremely long responses suggest something went wrong upstream
  if (accumulatedText.length > 50000) {
    return {
      ok: false,
      message: `Response exceeds sanity limit (${accumulatedText.length} chars).`,
    };
  }

  return { ok: true };
}
