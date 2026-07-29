// backend/lib/email-ask.js
//
// Deterministic pricing-email-ask append (Macarthur) — code-only safety net.
//
// Background: KB entry 2b3d30aa (REFERENCE, tags ["pricing","quote"]) reaches
// the model intact on every turn ([chat-diag] confirmed 8/8), but REFERENCE
// content is paraphrased by design (system-prompt.js KNOWLEDGE BASE
// BEHAVIOUR: REFERENCE entries "may be paraphrased, summarised, or
// synthesised"). Whether the email-ask clause survives paraphrase is
// therefore inherent sampling variance (5/8 live runs dropped it), not a bug
// — no further KB wording edit closes that gap. This module appends the ask
// programmatically, after generation completes, so it is deterministic and
// independent of what the model produced.
//
// Scope: code only. Does not touch 2b3d30aa, example_messages, or
// hard_guardrails wording — this sits alongside them as a safety net, not a
// replacement.
//
// No same-turn organic-ask guard (removed — PR-13 smoke test): an earlier
// version skipped the append when the model's own response text already
// contained the word "email", to avoid a doubled-up ask reading like
// double-dipping. That guard was defeated by the exact failure mode this
// module exists to eliminate: 2b3d30aa's enriched body itself contains the
// word "email", and on a live turn the model's paraphrase produced a
// degraded, incomplete version of the ask (missing "you're welcome to" and
// "with you") that still contained the bare word — the guard matched it,
// concluded an ask was already present, and suppressed the deterministic
// append on the exact turn it was meant to guarantee. A false "already
// asked" from unreliable model output is a functional failure; an
// occasional cosmetic doubled-up ask (model says something ask-like, we
// append the same fixed sentence right after) is not. Always append when
// isEligibleForEmailAsk is true and emailAskAlreadySentThisSession is false,
// full stop.
//
// Tag-based eligibility (not ID-based): matches any hit tagged "pricing" or
// "quote", so the deferred crowding-candidate backlog rows (pricing-adjacent
// KB entries not yet added) opt in automatically with no code change once
// seeded with the same tags.
//
// "Already asked this session" persistence: no schema migration for a
// dedicated flag column — the fixed appended sentence is itself a perfect,
// exact-match marker (it is never model-generated, so no fuzzy matching is
// needed), and prior assistant message content is already fetched per turn
// (V1.1 history architecture). A substring check against that history is
// sufficient and avoids a schema change for this safety net.

const EMAIL_ASK_TAGS = ['pricing', 'quote'];

// Fixed, hardcoded, byte-identical every time it's appended — deliberately
// not model-generated, so it's independent of sampling variance. Doubles as
// its own "already appended" marker (see emailAskAlreadySentThisSession).
export const EMAIL_ASK_SENTENCE =
  "If you'd rather not fill in the whole form right now, you're welcome to " +
  'just leave your email here instead and the team can follow up directly ' +
  'with you.';

/**
 * Whether this turn's retrieved KB hits qualify for the pricing email ask.
 *
 * @param {Array} hits - from kb.retrieveKb (this turn's retrieval)
 * @returns {boolean}
 */
export function isEligibleForEmailAsk(hits) {
  if (!Array.isArray(hits)) return false;
  return hits.some(
    h => Array.isArray(h.tags) && h.tags.some(t => EMAIL_ASK_TAGS.includes(t))
  );
}

/**
 * Whether the fixed email-ask sentence already appears in an earlier
 * assistant message this session. Exact substring match — sufficient
 * because the appended text is a fixed literal, never model-generated.
 *
 * @param {Array<{role: string, content: string}>} history - prior turns,
 *   oldest-first (does not include the current turn)
 * @returns {boolean}
 */
export function emailAskAlreadySentThisSession(history) {
  if (!Array.isArray(history)) return false;
  return history.some(
    m =>
      m.role === 'assistant' &&
      typeof m.content === 'string' &&
      m.content.includes(EMAIL_ASK_SENTENCE)
  );
}

/**
 * Decide whether to append the deterministic email ask to this turn's
 * response, and produce the pieces the caller needs: the suffix alone (to
 * stream as a final SSE token) and the full combined text (for validation,
 * diagnostics, and persistence — so future emailAskAlreadySentThisSession
 * checks see it in history).
 *
 * @param {object} params
 * @param {Array} params.hits - this turn's retrieved KB hits
 * @param {Array} params.history - prior turns in this session (oldest-first)
 * @param {string} params.responseText - the model's completed response text
 * @returns {{ appended: boolean, suffix: string, text: string }}
 */
export function applyEmailAsk({ hits, history, responseText }) {
  const eligible = isEligibleForEmailAsk(hits);
  const alreadySent = emailAskAlreadySentThisSession(history);

  if (!eligible || alreadySent) {
    return { appended: false, suffix: '', text: responseText };
  }

  const separator = /\s$/.test(responseText) ? '' : ' ';
  const suffix = separator + EMAIL_ASK_SENTENCE;

  return {
    appended: true,
    suffix,
    text: responseText + suffix,
  };
}
