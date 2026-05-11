// backend/lib/system-prompt.js
//
// V1.4.4 — VERBATIM RESPONSE SCOPE block relocated to sit AFTER the voice
// profile in the cached system prompt. Voice profile carve-out lives in
// CONFIG (streamlineai.js, upunt.js) — see each deployment's voice_profile.style.
//
// Surfaced by Session 26 V1.4.3 smoke test:
//
//   V1.4.3 directive was provably present in the deployed prompt (verified
//   via /admin/debug/system-prompt/streamlineai). Retrieval correctly
//   surfaced the VERBATIM entries for Tests B and D. Model read the rule,
//   read the entry, quoted correctly — then extended the quote on Tests B
//   and C with content explicitly named-and-forbidden by the live directive.
//
//   Test B ("I'm not technical, can I still use this?"): Entry 19 quoted
//   verbatim, then extended with anti-pattern (b) — synthesised supportive
//   prose ("Most of our clients aren't technical — the tools are built to
//   be simple to use, not impressive to look at"). No fabricated values,
//   no trace to CONTEXT. Forbidden by V1.4.3 directive. Generated anyway.
//
//   Test C ("What does StreamlineAI do?"): Entry 1 quoted verbatim, then
//   extended with anti-pattern (c) — "what this means in practice"
//   elaboration introducing product names not in this CONTEXT block.
//   Forbidden by V1.4.3 directive. Generated anyway.
//
//   Test D ("How much does it cost?"): Entry 10 quoted verbatim, trailing
//   "What kind of business are you running?" — content-free transition,
//   passes V1.4.3 shape (2). Pricing has a definitive numeric answer with
//   no tonal pull to extend. Single-turn pricing control clean.
//
// Structural diagnosis (Session 26 handback to D1):
//
//   Voice profile's "Acknowledge the prospect's situation back to them in
//   your own words before answering" instruction tensions against VERBATIM
//   RESPONSE SCOPE. Voice profile was placed last in the cached block per
//   Pattern 8 (attention-weighting — models attend most strongly to
//   information near the end). VERBATIM RESPONSE SCOPE was placed in the
//   middle of the prompt, embedded in KB BEHAVIOUR. Same Pattern 8 logic
//   running in the wrong direction: the rule is far from response position,
//   the voice instruction is near response position, voice instruction wins.
//
//   Test D passes because pricing has no tonal pull to extend. Tests B and C
//   answer questions where there's natural pull to elaborate ("can I still
//   use this?" wants reassurance; "what does StreamlineAI do?" wants
//   description). The voice profile's "acknowledge in your own words"
//   instruction is read as license to extend; the V1.4.3 directive's
//   "framing must trace to CONTEXT" rule is forgotten by then.
//
// V1.4.4 changes (D1 Session 27 decision — Option 1 + Option 2 combined):
//
//   1. VERBATIM RESPONSE SCOPE block RELOCATED out of the KB BEHAVIOUR
//      section and placed as a new top-level section AFTER the voice
//      profile. The block sits last in the cached prompt, so the same
//      Pattern 8 attention-weighting that previously favoured the voice
//      instruction now favours the scope rule.
//
//   2. Voice profile carve-out applied in CONFIG (streamlineai.js,
//      upunt.js). The "acknowledge in your own words" instruction in each
//      style field gets a trailing exception sentence naming VERBATIM-from-
//      CONTEXT as the case where acknowledgement is content-free transition
//      only. Engine-side directive vocabulary inside operator-curated
//      voice profile content is a documented Pattern 5 trade — D1 owns the
//      CONFIG field, D1 approves the wording, precision wins over softer
//      language (Pattern 11 — vague permissive scope gets read liberally).
//
// V1.4.3 substantive content preserved verbatim:
//
//   - Strict framing shapes (1) and (2)
//   - Three named anti-patterns (a), (b), (c)
//   - Multi-turn invariance clause
//   - VERBATIM PRECEDENCE substitution rule (stays in KB BEHAVIOUR)
//   - NEVER FABRICATE SPECIFIC FACTUAL VALUES rule (stays in KB BEHAVIOUR)
//
// What stays in KB BEHAVIOUR after V1.4.4:
//
//   - REFERENCE vs VERBATIM rendering rules
//   - VERBATIM PRECEDENCE (substitution rule — independent of scope rule)
//   - NEVER FABRICATE SPECIFIC FACTUAL VALUES (independent of scope rule)
//   - Empty-CONTEXT fallback to INSUFFICIENT DATA
//
//   These are CONTENT-handling rules (what to quote, what not to invent).
//   They belong in KB BEHAVIOUR.
//
// What moves to its own dedicated section last in the prompt:
//
//   - VERBATIM RESPONSE SCOPE — the SHAPE rule for VERBATIM-anchored responses.
//
//   This is a RESPONSE-shape rule (how long the response is, what its
//   components are). It belongs near the response position so attention-
//   weighting works for it, not against it.
//
// Architecture (cached block order at V1.4.4):
//
//   1. Identity (deployment_name, domain)
//   2. KB rendering rules (REFERENCE/VERBATIM behaviour, VERBATIM PRECEDENCE,
//      NEVER FABRICATE) — content rules
//   3. INSUFFICIENT DATA rule
//   4. Hard guardrails
//   5. Voice profile (six fields including carve-out in style)
//   6. VERBATIM RESPONSE SCOPE — NEW LAST POSITION
//
// Pattern 8 (methodology, attention-weighting): information near the end of
// the prompt is attended to most strongly. V1.4.3 placed voice profile last
// for that reason. V1.4.4 keeps voice profile near the end but places the
// scope rule AFTER it — the rule that the voice profile must yield to is
// the rule the model encounters last, immediately before generating.
//
// Pattern 11 (methodology, permissive rules require concrete scope): the
// scope rule's strict framing shapes (1) and (2) and three named anti-
// patterns are unchanged from V1.4.3 — precision wording is preserved, only
// position changes.

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
  //   anti-fabrication. Constrained response shape around VERBATIM quotes.
  // V1.4.4: VERBATIM RESPONSE SCOPE relocated OUT of this section to a
  //   dedicated final section after voice profile (see end of function).
  //   VERBATIM PRECEDENCE (substitution rule) and NEVER FABRICATE (content
  //   rule) remain here — they govern CONTENT, not response SHAPE.
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
    `INSUFFICIENT DATA rule below.\n` +
    `\n` +
    `The VERBATIM RESPONSE SCOPE rules at the end of this prompt govern the ` +
    `SHAPE of a VERBATIM-anchored response (how long it is, what framing is ` +
    `permitted). Those rules apply whenever you quote a VERBATIM entry — read ` +
    `them before generating any response that includes a VERBATIM quote.`
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
  // V1.4: placed last in the cached block so the model attends to it strongly.
  // V1.4.4: voice profile is no longer the final section — VERBATIM RESPONSE
  //   SCOPE follows it (see next push). Voice profile remains near the end,
  //   immediately before the scope rule. The rule the voice profile must
  //   yield to is the rule the model encounters last.
  // All six voice fields rendered if populated. Each field rendered only if
  // it has content — empty arrays/strings are skipped, not echoed as headers.
  const voiceSection = renderVoiceProfile(config.voice_profile);
  if (voiceSection) {
    sections.push(voiceSection);
  }

  // ----- VERBATIM RESPONSE SCOPE (V1.4.4 — relocated last position) -----
  // V1.4.3 substantive content preserved verbatim. Position changed from
  // middle-of-KB-BEHAVIOUR to dedicated final section.
  //
  // Rationale (D1 Session 27 decision Option 1):
  //   Voice profile's "Acknowledge the prospect's situation back to them in
  //   your own words" instruction was being read as license to extend
  //   VERBATIM-anchored responses with synthesised supportive prose. Pattern 8
  //   attention-weighting favoured voice profile (last in V1.4.3) over scope
  //   rule (middle in V1.4.3). V1.4.4 places the scope rule LAST so the
  //   attention-weighting runs in its favour. Voice profile carve-out
  //   (Option 2, in CONFIG style fields) reinforces from the voice side.
  sections.push(
    `VERBATIM RESPONSE SCOPE\n` +
    `\n` +
    `This rule applies whenever a VERBATIM entry from the CONTEXT block ` +
    `covers the user's question and you are quoting it. The rule is the ` +
    `last rule in this prompt deliberately — it takes precedence over the ` +
    `voice profile's stylistic instructions whenever the two would produce ` +
    `different response shapes.\n` +
    `\n` +
    `When a VERBATIM entry covers the user's question and you are quoting ` +
    `it, your response consists of: the verbatim quote (with attribution), ` +
    `and at most one short framing sentence before or after the quote. ` +
    `Framing is strictly limited to one of two shapes:\n` +
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
    `claims. This is the most commonly violated rule: voice profile ` +
    `instructions to "acknowledge in your own words" do NOT override this ` +
    `constraint when a VERBATIM entry anchors the response.\n` +
    `\n` +
    `  (c) "What this means in practice" elaboration — sentences that ` +
    `explain, expand, clarify, or apply the quoted material in ways the ` +
    `CONTEXT does not. If the source did not say it, do not extend the ` +
    `quote to say it. If the user wants elaboration, they will ask a ` +
    `follow-up question, which will retrieve fresh CONTEXT.\n` +
    `\n` +
    `Voice profile precedence carve-out: the voice profile's style ` +
    `instructions (acknowledging the user's situation, matching tone, using ` +
    `signature phrases) apply fully on responses that are NOT VERBATIM-` +
    `anchored. On VERBATIM-anchored responses, the scope rule above ` +
    `overrides voice instructions that would expand the response beyond ` +
    `the quote plus permitted framing. The voice still shapes the framing ` +
    `sentence itself — the framing sentence sounds like the voice — but it ` +
    `does not license additional sentences of synthesised content.\n` +
    `\n` +
    `This rule is invariant across turns. Turn 2 does not get a relaxation ` +
    `because turn 1 already cited the source. Each turn re-retrieves; each ` +
    `turn that hits a VERBATIM entry applies the same scope rule. If the ` +
    `user's follow-up question is genuinely adjacent (e.g. user asked about ` +
    `pricing on turn 1, then asks about delivery timeframes on turn 2), the ` +
    `new turn either hits a different KB entry (use that, apply scope rule ` +
    `again) or hits nothing relevant (apply INSUFFICIENT DATA). It does not ` +
    `entitle you to extend the turn-1 quote with synthesised turn-2 content.`
  );

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
