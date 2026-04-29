// backend/lib/stop-reason.js
// Build Standard #5: stop_reason router.
// Backend dispatches on the API response's stop_reason field, NOT on text-parsing.
//
// V1.0 stub handles end_turn only. Each later version adds cases:
//   V1.1: max_tokens (memory may need continuation)
//   V1.2: stop_sequence (KB query patterns)
//   V1.6: tool_use, pause_turn (agentic loop dispatches)
//   any: refusal (model declined)
//
// Build the stub at V1.0. Cost of introducing this cold at V1.6 is a refactor.

/**
 * Route based on stop_reason.
 * Returns { action, reason } so the caller can decide what to do next.
 *
 *   action: 'complete'  → response is final, return to user
 *   action: 'continue'  → version-specific handling needed (currently logs warning)
 *   action: 'fail'      → response cannot be returned (e.g. refusal)
 */
export function handleStopReason(stopReason, accumulatedText) {
  switch (stopReason) {
    case 'end_turn':
      // Model finished naturally. V1.0 expects this case.
      return { action: 'complete', reason: 'end_turn' };

    case 'max_tokens':
      // Hit response cap. V1.0 returns truncated response with a warning.
      // V1.1+ may implement continuation.
      console.warn('[stop_reason_max_tokens] response truncated', {
        length: accumulatedText.length,
      });
      return { action: 'continue', reason: 'max_tokens' };

    case 'stop_sequence':
      // Hit configured stop string. Not used in V1.0.
      console.warn('[stop_reason_stop_sequence] hit unconfigured stop sequence');
      return { action: 'continue', reason: 'stop_sequence' };

    case 'tool_use':
      // Model wants to call a tool. V1.0 has no tools registered.
      console.warn('[stop_reason_tool_use] tool_use received but tools not enabled in v1.0');
      return { action: 'continue', reason: 'tool_use' };

    case 'pause_turn':
      // Long-running tool call. V1.0 has no tools.
      console.warn('[stop_reason_pause_turn] pause_turn received but tools not enabled in v1.0');
      return { action: 'continue', reason: 'pause_turn' };

    case 'refusal':
      // Model declined to respond.
      console.warn('[stop_reason_refusal] model declined');
      return { action: 'fail', reason: 'refusal' };

    default:
      // Unknown stop_reason — log loudly, treat as continue
      console.warn('[stop_reason_unknown]', { stopReason });
      return { action: 'continue', reason: 'unknown' };
  }
}
