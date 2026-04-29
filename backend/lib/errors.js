// backend/lib/errors.js
// Build Standard #2: structured error shape.
// All errors returned from external service calls conform to this shape.
// The `recoverable` boolean drives the agentic loop. The `type` drives logs and ops.

/**
 * Error type taxonomy (V1.0):
 *
 *   Recoverable (loop reacts via retry/backoff):
 *     - api_timeout
 *     - rate_limit
 *     - downstream_unavailable
 *
 *   Hard (log loudly, fail fast, no auto-retry):
 *     - auth_failure
 *     - config_error
 *     - validation_error
 *     - content_filter
 *
 * Add new types here as new external services are integrated (V1.1+ Supabase,
 * V1.3+ Telegram, V1.6+ ingestion sources).
 */

/**
 * Construct a structured error object.
 * Always use this — never throw raw Error or return ad-hoc objects.
 */
export function makeError({ type, message, suggestion, recoverable }) {
  // Defensive validation — if a caller passes a malformed shape, surface it loudly
  if (typeof recoverable !== 'boolean') {
    console.error('[error_shape_violation] recoverable must be boolean', { type, message });
  }
  if (!type || !message) {
    console.error('[error_shape_violation] type and message required', { type, message });
  }

  const err = new Error(message);
  err.status = 'error';
  err.type = type;
  err.message = message;
  err.suggestion = suggestion || '';
  err.recoverable = recoverable === true;
  err.timestamp = new Date().toISOString();
  return err;
}

/**
 * Serialise a structured error for JSON response.
 * Strips the Error prototype, returns plain object.
 */
export function serialiseError(err) {
  return {
    status: 'error',
    type: err.type || 'downstream_unavailable',
    message: err.message || 'Unknown error',
    suggestion: err.suggestion || '',
    recoverable: err.recoverable === true,
    timestamp: err.timestamp || new Date().toISOString(),
  };
}

/**
 * Send a structured error as an HTTP response.
 * Used for non-streaming error returns (validation failures before stream starts,
 * auth failures, etc.).
 */
export function sendError(res, httpStatus, err) {
  return res.status(httpStatus).json(serialiseError(err));
}
