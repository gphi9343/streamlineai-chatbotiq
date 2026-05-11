// backend/lib/system-prompt.js
//
// V1.4.3 — Multi-turn / extended-response VERBATIM precedence tightening.
// Universal fix applied to all deployments.
//
// Surfaced by Session 25 V1.4.2 smoke test:
//
//   Bot quotes VERBATIM correctly on the initial response and on single-turn
//   questions. On multi-turn follow-up where the user asks an adjacent
//   question, bot quotes the KB content correctly but extends with
//   synthesised supportive content not in any KB entry. Three observed
//   instances:
//
//     Step 4 turn 2 ("How much do the streamline AI products cost?"): bot
//     quoted Entry 10 (pricing VERBATIM) then added "ChatbotIQ A$297/mo
//     retainer" (fabricated value), "complexity, integrations, how much
//     training data you've got" (synthesised supporting content), "Most
//     deployments land in the lower half of those ranges" (synthesised
//     supporting content).
//
//     Step 5 ("I'm not technical, can I still use this?"): bot quoted
//     Entry 19 cleanly then appended "Most of what we build sits in the
//     background and just works. You're not managing code or configuring
//     anything technical — you'll interact with the tools the same way
//     you'd use any other web app." None of this in any KB entry — generic
//     supportive prose, no fabricated values.
//
//     Step 6 ("What does StreamlineAI do?"): minor REFERENCE-style
//     extension after Entry 1 quote. Voice-profile-shaped, domain-bounded,
//     flagged as same shape lower severity.
//
// Gap in V1.4.1 VERBATIM PRECEDENCE block: governed substitution (don't
// replace VERBATIM with something else) and alteration (don't paraphrase
// the quoted material), but did NOT constrain the SCOPE of a VERBATIM-
// anchored response. Bot was free to quote correctly and then keep writing
// — drawing extension content from voice profile, general knowledge, or
// inference — as long as it didn't fabricate a specific value and didn't
// substitute the quote. V1.4.1 NEVER FABRICATE caught only one of the three
// failure shapes (Step 4 turn 2's "$297/mo"). Steps 5 and 6 passed every
// V1.4.1 rule because they contained no fabricated values.
//
// V1.4.3 changes:
//
//   1. New VERBATIM RESPONSE SCOPE directive inserted between VERBATIM
//      PRECEDENCE and NEVER FABRICATE. Constrains the response shape when
//      a VERBATIM quote anchors the response: quoted material plus, at
//      most, a strict framing sentence. Strict framing is defined as
//      either (a) content drawn from another entry in the same CONTEXT
//      block, or (b) a content-free transition phrase that names the
//      source. No synthesised framing of any other shape qualifies.
//
//   2. Three named anti-patterns enumerated, mirroring the three Session 25
//      failure shapes by behaviour (not by quoting the failed responses):
//      (a) extending with fabricated specific values, (b) extending with
//      synthesised supportive prose containing no fabricated values,
//      (c) extending with "what this means in practice" / elaboration /
//      clarification not present in CONTEXT.
//
//   3. Multi-turn invariance stated explicitly. Turn 2 does not get a
//      relaxation. Each turn re-retrieves; each turn that hits a VERBATIM
//      entry applies the same scope rule. The Session 25 failures all
//      occurred on follow-up turns where the model behaved as if having
//      already cited the quote earlier in the conversation entitled it to
//      paraphrase or extend on the follow-up. Closed explicitly.
//
// Rationale for strict framing (D1 SAQ decision Session 26):
//
//   Moderate framing ("OK if it restates the user's question or names the
//   source — no new factual content") is precisely the latitude the model
//   already took on Step 5. The Step 5 extension would pass a moderate test
//   — a permissive reader classifies it as "framing the answer." Strict
//   framing closes that loophole: framing is either pulled from another
//   CONTEXT entry (verifiable source) or is a content-free transition (no
//   factual surface to drift on). Both auditable. Pattern 24 (methodology
//   doc, "Permissive rules require concrete scope") directly applies —
//   vague permissive scope gets read liberally under model interpretation
//   pressure.
//
// Rationale for named anti-patterns (D1 SAQ decision Session 26):
//
//   Three observed instances, three distinct shapes, one of which (Step 5
//   supportive prose) is not covered by any rule before V1.4.3. Abstract
//   principle plus model interpretation is what failed at V1.3, V1.3.1,
//   V1.3.2 case-3, and Session 24. The V1.3.2 case-3 fix that held used
//   concrete worked exclusions; V1.4.3 mirrors that approach. Prompt cost
//   ~5 lines, failure cost a V1.4.4 patch session.
//
// V1.4.2 baseline preserved otherwise: VERBATIM PRECEDENCE directive
// (substitution rule), NEVER FABRICATE SPECIFIC FACTUAL VALUES, case-3
// scope tightening with extended exclusion list, anti-hybrid rule, turn-
// level refusal rule, voice profile rendering, RAG-style context block
// separate.
//
// Architecture (unchanged from V1.2):
//
//   CACHED BLOCK (stable across all turns of all sessions for this deployment):
//     - Identity (deployment_name, domain)
//     - KB rendering rules (REFERENCE vs VERBATIM behaviour, V1.4.3 extended)
//     - INSUFFICIENT DATA rule (V1.4.1 strengthened)
//     - Hard guardrails
//     - Voice profile (V1.4 — six fields)
//
//   DYNAMIC CONTEXT BLOCK (varies per turn — sent as user-side context, NOT in system prompt):
//     - Retrieved KB entries for this query
//
// Pattern 11 (methodology, formerly Pattern 24): "Permissive rules require
// concrete scope." Fourth instance confirmed Session 25 (multi-turn VERBATIM
// extension drift). V1.4.3 extends the concrete-scope discipline to response-
// shape constraints around VERBATIM quotes, not just question-type
// classification.

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
  // V1.4.3: VERBATIM RESPONSE SCOPE directive added between precedence and
  // anti-fabrication. Constrains response shape around VERBATIM quotes.
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
    `VERBATIM RESPONSE SCOPE: When a VERBATIM entry covers the user's question ` +
    `and you are quoting it, your response consists of: the verbatim quote ` +
    `(with attribution), and at most one short framing sentence before or ` +
    `after the quote. Framing is strictly limited to one of two shapes:\n` +
    `\n` +
    `  (1) Content drawn from another entry in the same CONTEXT block. If ` +
    `the framing makes a factual claim, that claim must trace to a specific ` +
    `entry currently in the CONTEXT block — REFERENCE or VERBATIM.\n` +
    `\n` +
    `  (2) A content-free transition phrase that names the source or restates ` +
    `the question topic, carrying no factual content of its own. Examples: ` +
    `"Here's what the source says about that:"; "On pricing —"; "Gareth's ` +
    `take on this:".\n` +
    `\n` +
    `Any framing that does not fit one of these two shapes is forbidden. ` +
    `Specifically, do not extend a VERBATIM quote with any of the following:\n` +
    `\n` +
    `  (a) Fabricated specific values — numbers, dates, quantities, prices, ` +
    `percentages, names, or identifiers that are not present in the CONTEXT ` +
    `block. This is forbidden even if the values are plausible or consistent ` +
    `with the quoted material.\n` +
    `\n` +
    `  (b) Synthesised supportive prose — sentences of reassurance, ` +
    `encouragement, clarification, or context that contain no fabricated ` +
    `specific values but also do not trace to any entry in the CONTEXT block. ` +
    `Generic supportive content drawn from general knowledge or inference is ` +
    `forbidden even when it sounds helpful and contains no specific factual ` +
    `claims.\n` +
    `\n` +
    `  (c) "What this means in practice" elaboration — sentences that ` +
    `explain, expand, clarify, or apply the quoted material in ways the ` +
    `CONTEXT does not. If the source did not say it, do not extend the ` +
    `quote to say it. If the user wants elaboration, they will ask a ` +
    `follow-up question, which will retrieve fresh CONTEXT.\n` +
    `\n` +
    `This rule is invariant across turns. Turn 2 does not get a relaxation ` +
    `because turn 1 already cited the source. Each turn re-retrieves; each ` +
    `turn that hits a VERBATIM entry applies the same scope rule. If the ` +
    `user's follow-up question is genuinely adjacent (e.g. user asked about ` +
    `pricing on turn 1, then asks about delivery timeframes on turn 2), the ` +
    `new turn either hits a different KB entry (use that, apply scope rule ` +
    `again) or hits nothing relevant (apply INSUFFICIENT DATA below). It ` +
    `does not entitle you to extend the turn-1 quote with synthesised turn-2 ` +
    `content.\n` +
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
