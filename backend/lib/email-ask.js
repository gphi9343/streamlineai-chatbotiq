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
// replacement. The model's own organic inclusion (3/8 runs) is left as-is;
// the dedup guard below only prevents a double-ask within the SAME turn.
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

// Same-turn dedup guard (item 4): a loose organic-ask detector. Only needs
// to catch the model's own spontaneous ask well enough to avoid an obviously
// doubled-up close (the exact thing PR #11 guarded against at the prompt
// level) — false positives here just skip a redundant-but-harmless append,
// so this stays deliberately broad rather than tight.
const ORGANIC_ASK_PATTERN = /\bemail\b/i;

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
 * Whether the model's own response text already reads as an email ask.
 * Same-turn dedup guard only — does not look at prior turns.
 *
 * @param {string} responseText
 * @returns {boolean}
 */
export function responseAlreadyAsksForEmail(responseText) {
  return typeof responseText === 'string' && ORGANIC_ASK_PATTERN.test(responseText);
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
  const organicAsk = responseAlreadyAsksForEmail(responseText);

  if (!eligible || alreadySent || organicAsk) {
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
