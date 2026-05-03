// backend/lib/sessions.js
//
// Session ID validation. IDs are generated client-side (UUIDs from the
// browser's crypto.randomUUID()) and arrive on every request. Backend
// validates shape only — does not generate.
//
// Generating server-side would either require a separate "create session"
// endpoint or piggyback on /chat, both of which add complexity for no
// benefit when the browser already has a UUID generator.

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate a session ID is a well-formed UUID.
 * @param {string} id
 * @returns {boolean}
 */
export function isValidSessionId(id) {
  return typeof id === 'string' && UUID_REGEX.test(id);
}
