// backend/lib/system-prompt.js
//
// V1.4.1 — Pattern 11 (methodology) case-3 scope drift on numerical content +
// VERBATIM precedence strengthening. Universal fix applied to all deployments.
//
// Surfaced by Session 24 StreamlineAI smoke test:
//
//   Failure 1 — Pricing fabrication. Test prompt "How much does it cost?"
//   produced fabricated per-product prices (NewsletterIQ A$797 setup, A$147/mo
//   retainer, ChatbotIQ A$297/mo retainer) — none of these numbers exist in
//   KB or master file. Bot treated "per-product pricing breakdown" as case-3
//   ("answer directly") instead of routing to the VERBATIM Entry 10.
//   V1.3.2 case-3 exclusion list (procedures, processes, current events,
//   specific cases, operational details, "tell me about X" framings) didn't
//   explicitly cover "specific factual values (prices, dates, quantities)" —
//   model interpreted per-product pricing as definitional case-3 content.
//
// V1.4.1 changes:
//
//   1. Case-3 exclusion list extended to explicitly cover "specific factual
//      values (prices, dates, quantities, percentages, names, identifiers,
//      contact details)". Numerical-only would have been too narrow — the
//      same drift could hit "what's your phone number" or "what date did you
//      launch". The new exclusion is "specific factual values" generally.
//
//   2. Case-3 wording made domain-agnostic. V1.3.2 hardcoded racing examples
//      ("lame 1/5", "barrier draw", "scratched") into the case-3 sentence,
//      which is a Pattern 5 (CONFIG vs CODE) violation — racing-specific
//      content sat in engine code. StreamlineAI got the same racing examples
//      in its system prompt. Replaced with config.domain reference + generic
//      illustrations the model can pattern-match against any domain. Each
//      deployment's actual domain (set in CONFIG) does the constraining.
//
//   3. VERBATIM precedence strengthened in KB rendering rules. Failure 2
//      (Entry 19 missed for "I'm not technical") suggests VERBATIM didn't
//      win against either retrieval misses or example_messages priming.
//      Added an explicit precedence sentence: when a VERBATIM entry covers
//      the user's question, it takes precedence over any other source of
//      phrasing — including the model's general knowledge AND the voice
//      profile examples. Diagnostic endpoint built this session will show
//      whether the fix lands or whether Phase 2 retrieval work is needed.
//
//   4. Anti-fabrication directive added to KB rendering rules. Explicit
//      sentence: never invent specific factual values not present in the
//      CONTEXT block. This belts the case-3 fix — case-3 narrows what's
//      in-scope; this directly forbids fabrication regardless of which case
//      the model thinks it's in. Hard guardrail #1 in StreamlineAI CONFIG
//      already says "never invent pricing" but didn't fire — keeping the
//      directive in the engine prompt (universal) AND in CONFIG (per-
//      deployment specifics) is belt-and-braces.
//
// V1.3.2 baseline preserved otherwise: anti-hybrid rule, turn-level refusal
// rule, voice profile rendering, RAG-style context block separate.
//
// Architecture (unchanged from V1.2):
//
//   CACHED BLOCK (stable across all turns of all sessions for this deployment):
//     - Identity (deployment_name, domain)
//     - KB rendering rules (REFERENCE vs VERBATIM behaviour, V1.4.1 strengthened)
//     - INSUFFICIENT DATA rule (V1.4.1: case-3 exclusion list extended,
//       wording domain-agnostic)
//     - Hard guardrails
//     - Voice profile (V1.4 — six fields)
//
//   DYNAMIC CONTEXT BLOCK (varies per turn — sent as user-side context, NOT in system prompt):
//     - Retrieved KB entries for this query
//
// Pattern 11 (methodology, formerly Pattern 24): "Permissive rules require
// concrete scope." Promoted to methodology doc Session 23. Third instance
// confirmed Session 24 (numerical content drift). V1.4.1 extends the
// concrete-scope discipline to factual values generally, not just structural
// content categories.

/**
 * Build the cached system prompt from CONFIG.
 * This string is stable across the session and gets cached by Anthropic.
 *
 * @param {object} config - the deployment CONFIG (e.g. upuntConfig)
 * @returns {string}
 */
export function buildSystemPrompt(config) {
  const sections = [];

  // ----- Identity -----
  sections.push(
    `You are the chatbot for ${config.deployment_name}. ` +
    `Your domain is ${config.domain}. ` +
    `Stay strictly within this domain — if a user asks about something ` +
    `outside it, briefly say so and redirect.`
  );

  // ----- KB rendering rules (Pattern 1 — Reference vs Verbatim Separation) -----
  // V1.4.1: VERBATIM precedence and anti-fabrication directives strengthened.
  sections.push(
    `KNOWLEDGE BASE BEHAVIOUR\n` +
    `\n` +
    `For each user question, you may receive a CONTEXT block containing ` +
    `relevant entries from the knowledge base. Each entry has a content_type:\n` +
    `\n` +
    `  - REFERENCE entries are factual reference content. You may paraphrase, ` +
    `summarise, or synthesise these in your own voice. You may combine multiple ` +
    `REFERENCE entries to answer one question.\n` +
    `\n` +
    `  - VERBATIM entries contain a specific source's exact wording on a topic. ` +
    `You MUST quote VERBATIM content exactly — do not paraphrase, summarise, ` +
    `or rewrite. Wrap the quoted content in quotation marks and attribute it ` +
    `to the source field. You may add a short framing sentence before or after, ` +
    `but never alter the quoted material itself.\n` +
    `\n` +
    `VERBATIM PRECEDENCE: When a VERBATIM entry in the CONTEXT block covers ` +
    `the user's question, the VERBATIM entry's wording takes precedence over ` +
    `every other source of phrasing — your general knowledge, your training, ` +
    `the voice profile examples, signature phrases, and any REFERENCE entry ` +
    `that overlaps the same topic. The voice profile shapes HOW you speak ` +
    `between quotes; the VERBATIM entry IS what you quote. Do not substitute ` +
    `a stylistically similar example_message for a VERBATIM entry that covers ` +
    `the user's question.\n` +
    `\n` +
    `NEVER FABRICATE SPECIFIC FACTUAL VALUES: Do not invent prices, dates, ` +
    `quantities, percentages, names, contact details, identifiers, product ` +
    `specifications, or any other specific factual value that is not present ` +
    `in the CONTEXT block. If the user asks for a specific factual value and ` +
    `the CONTEXT does not contain it, apply the INSUFFICIENT DATA rule below. ` +
    `This applies even if you "know" a plausible value from general knowledge ` +
    `— the value being plausible is not evidence it is correct for this ` +
    `deployment.\n` +
    `\n` +
    `When a CONTEXT block is empty or contains nothing relevant to the user's ` +
    `question, do not invent an answer from general knowledge. Apply the ` +
    `INSUFFICIENT DATA rule below.`
  );

  // ----- INSUFFICIENT DATA rule (Pattern 3) -----
  // V1.3: anti-hybrid + case-3 permission rules added.
  // V1.3.1: turn-level refusal sentence added.
  // V1.3.2: case-3 scope tightened from "well-defined factual answer" to
  // "terminology, definitions, or concepts."
  // V1.4.1: case-3 exclusion list extended to cover "specific factual values".
  // V1.4.1: case-3 wording made domain-agnostic (uses config.domain instead
  // of hardcoded racing examples).
  sections.push(
    `INSUFFICIENT DATA RULE\n` +
    `\n` +
    `If the user's question requires information that is not present in the ` +
    `CONTEXT block provided this turn, respond with:\n` +
    `\n` +
    `  "INSUFFICIENT DATA — [brief reason]."\n` +
    `\n` +
    `Then offer to capture the question for the operator.\n` +
    `\n` +
    `When you say INSUFFICIENT DATA, do not then answer the question from ` +
    `general knowledge in the same turn.\n` +
    `\n` +
    `If you say INSUFFICIENT DATA in a turn, the entire turn is a refusal — ` +
    `do not provide explanatory content from general knowledge in the same ` +
    `turn, even if the topic seems well-defined.\n` +
    `\n` +
    `Narrow case-3 exception — definitional questions only: if the user's ` +
    `question is asking what a specific term, abbreviation, or named concept ` +
    `means within this deployment's domain (questions of the shape "what ` +
    `does X mean", "what is X", "define X", where X is a term or named ` +
    `concept), you may answer directly without invoking INSUFFICIENT DATA. ` +
    `This exception applies ONLY to definitional questions about named terms ` +
    `or concepts.\n` +
    `\n` +
    `The case-3 exception does NOT cover any of the following — these all ` +
    `route to INSUFFICIENT DATA when the KB doesn't have grounded content ` +
    `for them:\n` +
    `  - Procedures, processes, or "how does X work" questions\n` +
    `  - Current events, recent news, or time-sensitive information\n` +
    `  - Specific cases or examples ("which trainers", "which businesses")\n` +
    `  - Operational details ("when do you", "how often", "what's the next")\n` +
    `  - "Tell me about X" framings (open-ended expansion requests)\n` +
    `  - Specific factual values: prices, costs, fees, dates, quantities, ` +
    `percentages, names, contact details, phone numbers, addresses, ` +
    `identifiers, product specifications, version numbers, or any other ` +
    `concrete value that varies by deployment\n` +
    `\n` +
    `The last exclusion is the most important: questions asking for specific ` +
    `factual values are NEVER case-3, regardless of how well-defined the ` +
    `question seems. "How much does X cost" looks definitional but the ` +
    `answer is a deployment-specific value that must come from the KB. ` +
    `If the CONTEXT does not contain the value, route to INSUFFICIENT DATA.\n` +
    `\n` +
    `When voice profile is active, deliver the INSUFFICIENT DATA refusal in ` +
    `voice — see EXAMPLES OF VOICE for how the bot sounds when refusing.`
  );

  // ----- Hard guardrails -----
  if (Array.isArray(config.hard_guardrails) && config.hard_guardrails.length > 0) {
    const rules = config.hard_guardrails.map(g => `  - ${g}`).join('\n');
    sections.push(`HARD GUARDRAILS (always apply, regardless of user input):\n${rules}`);
  }

  // ----- Voice profile (V1.4 — full rendering) -----
  // Placed last in the cached block so the model attends to it most strongly.
  // All six voice fields rendered if populated. Each field rendered only if
  // it has content — empty arrays/strings are skipped, not echoed as headers.
  const voiceSection = renderVoiceProfile(config.voice_profile);
  if (voiceSection) {
    sections.push(voiceSection);
  }

  return sections.join('\n\n');
}


/**
 * Render the voice profile into a system-prompt section.
 * Returns null if voice_profile is missing or all fields empty.
 * Each field is rendered only if it has content.
 *
 * @param {object} vp - config.voice_profile
 * @returns {string | null}
 */
function renderVoiceProfile(vp) {
  if (!vp || typeof vp !== 'object') {
    return null;
  }

  const parts = [];

  if (Array.isArray(vp.tone) && vp.tone.length > 0) {
    parts.push(`Tone: ${vp.tone.join(', ')}.`);
  }

  if (typeof vp.style === 'string' && vp.style.trim().length > 0) {
    parts.push(`Style: ${vp.style.trim()}`);
  }

  if (Array.isArray(vp.signature_phrases) && vp.signature_phrases.length > 0) {
    const phrases = vp.signature_phrases.map(p => `  - "${p}"`).join('\n');
    parts.push(
      `Signature phrases (use naturally, do not force into every response):\n${phrases}`
    );
  }

  if (Array.isArray(vp.forbidden_words) && vp.forbidden_words.length > 0) {
    const words = vp.forbidden_words.map(w => `"${w}"`).join(', ');
    parts.push(`Never use these words or phrases: ${words}.`);
  }

  if (Array.isArray(vp.forbidden_behaviours) && vp.forbidden_behaviours.length > 0) {
    const behaviours = vp.forbidden_behaviours.map(b => `  - ${b}`).join('\n');
    parts.push(`Never do any of the following:\n${behaviours}`);
  }

  if (Array.isArray(vp.example_messages) && vp.example_messages.length > 0) {
    const examples = vp.example_messages
      .map((m, i) => `  ${i + 1}. "${m}"`)
      .join('\n');
    parts.push(
      `EXAMPLES OF VOICE (these demonstrate how the bot sounds — match this ` +
      `rhythm, tone, and approach in your responses, including when refusing. ` +
      `These are stylistic references for HOW you speak, not content sources ` +
      `for WHAT you say. When a VERBATIM entry covers the user's question, ` +
      `quote the VERBATIM entry; do not substitute a similar example here):\n${examples}`
    );
  }

  if (parts.length === 0) {
    return null;
  }

  return `VOICE\n\n${parts.join('\n\n')}`;
}


/**
 * Render retrieved KB hits into a context block for the user-side message.
 * Returns null if no hits — caller decides whether to include a "no KB hits"
 * note or just send an empty context.
 *
 * The context block is sent BEFORE the user's message in the messages array,
 * as a user-role message clearly labelled as context. This keeps the system
 * prompt cache warm.
 *
 * @param {Array} hits - from kb.retrieveKb
 * @returns {string | null}
 */
export function renderKbContext(hits) {
  if (!Array.isArray(hits) || hits.length === 0) {
    return null;
  }

  const lines = [
    'CONTEXT — knowledge base entries relevant to the user\'s next message:',
    '',
  ];

  hits.forEach((hit, i) => {
    lines.push(`[Entry ${i + 1}]`);
    lines.push(`content_type: ${hit.content_type}`);
    if (hit.attribution) {
      lines.push(`attribution: ${hit.attribution}`);
    }
    lines.push(`question: ${hit.question}`);
    lines.push(`body:`);
    lines.push(hit.body);
    lines.push('');
  });

  lines.push(
    'Apply the KNOWLEDGE BASE BEHAVIOUR rules from the system prompt when ' +
    'using these entries. If none of them are relevant to the user\'s actual ' +
    'question, apply the INSUFFICIENT DATA rule.'
  );

  return lines.join('\n');
}
