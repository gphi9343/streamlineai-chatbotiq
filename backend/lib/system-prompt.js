// backend/lib/system-prompt.js
//
// V1.4.9 — REFERENCE fabrication guardrail. Adds a second NEVER FABRICATE
// directive ("NEVER FABRICATE ADJACENT SERVICES, CAPABILITIES, OR
// CATEGORIES") to the KNOWLEDGE BASE BEHAVIOUR section, sibling to the
// existing NEVER FABRICATE SPECIFIC FACTUAL VALUES rule.
//
// Surfaced by live smoke (Macarthur, 29 Jun 2026): query "can you do island
// benches" retrieved ONE high-confidence (rank 0.991) on-topic REFERENCE row
// whose body only said "refer to our quote page". The model paraphrased the
// row but then fabricated a full service list (splashbacks, vanities,
// fireplace surrounds, wall panelling, staircases, custom furniture) absent
// from the matched content, then synthesised a plausible pricing close around
// it.
//
// Not a retrieval failure (correct row, correct topic, high rank) — a
// grounding failure: a high-confidence REFERENCE match was treated as license
// to answer from general/training knowledge about what a stone fabricator
// "probably" offers, rather than restricting synthesis to the row's facts.
//
// Root cause: Session 26's three REFERENCE-synthesis anti-patterns (a)/(b)/(c)
// all live under VERBATIM RESPONSE SCOPE and are scoped to VERBATIM-anchored
// turns. REFERENCE entries were left looser by design (meant to be
// paraphrased, not quoted), but "paraphrase the row" and "invent adjacent
// capabilities not in the row" were never separated — no rule said REFERENCE
// synthesis must stay bounded by the row's facts.
//
// Placement note: the brief framed this as a "(d)" sibling to (a)/(b)/(c), but
// those live in VERBATIM RESPONSE SCOPE, which only fires on VERBATIM-anchored
// turns — placing the rule there would NOT cover the island-bench case (a
// REFERENCE hit, no VERBATIM in CONTEXT). The directive is therefore a CONTENT
// rule in KNOWLEDGE BASE BEHAVIOUR: fires every turn, REFERENCE or VERBATIM,
// CONFIG-agnostic. Pattern 5 universal — verified +1389 chars inserted
// identically into all three deployment prompts (macarthur, streamlineai,
// upunt; upunt despite shipping no INSUFFICIENT DATA TEMPLATE) with nothing
// else moved.
//
// Anti-hybrid reconciliation: the directive does NOT create a blended
// answer-then-refuse turn. The V1.3.2 rule ("If you say INSUFFICIENT DATA in a
// turn, the entire turn is a refusal") owns the answer-vs-refuse MODE
// decision; the new directive only caps the FACT SET of an answer turn and
// explicitly defers the mode decision to that rule (see the parenthetical in
// the directive body). An unsupported sub-scope is handled by non-elaboration,
// never by a partial INSUFFICIENT DATA opener.
//
// V1.4.5.2 — INSUFFICIENT DATA TEMPLATE block added as new top-level section
// at the end of the cached system prompt. Mandated routing close text comes
// from CONFIG (config.routing_close) — engine code holds the SHAPE rule and
// the forbidden-alternatives enumeration; CONFIG holds the per-deployment
// close text. Pattern 5 boundary preserved.
//
// Surfaced by Session 31.5 V1.4.5.1 smoke test:
//
//   V1.4.5.1 CONFIG-only patch rewrote voice profile example_messages
//   #10/#11/#13 and added hard_guardrail #17 prohibiting mid-conversation
//   email-capture. Two of three smoke scenarios PASS. Scenario 2 FAIL
//   (INSUFFICIENT DATA Case 1, "Do you have any deployments in healthcare?")
//   — bot generated functionally identical callback-promise close ("Want me
//   to flag this for Gareth so he can tell you what's been built in that
//   space?") from a deeper training-data attractor that example_messages
//   alone cannot override.
//
//   D2 Session 31.5 diagnosis: "deeper shaping problem than Edit B/D can
//   reach via example-driven CONFIG."
//
//   Same class as V1.4.4 VERBATIM RESPONSE SCOPE iteration history Sessions
//   25-27 (three CONFIG patches delivered partial wins before structural fix
//   at V1.4.4 closed the class). V1.4.5.2 skips the intermediate CONFIG
//   patches and goes straight to structural fix at the engine layer.
//
// Structural diagnosis (Session 31.5 handback to D1, carried into 31.6 brief):
//
//   The existing INSUFFICIENT DATA RULE section instructed the model to
//   "offer to capture the question for the operator" after the
//   INSUFFICIENT DATA opener. That permissive instruction is itself a
//   Pattern 11 violation — vague scope ("offer to capture") gets read
//   liberally by the model, surfaces as "Want me to flag this for Gareth?",
//   "Want to leave your email?", "Have Gareth get back to you", etc.
//
//   Voice profile signature_phrase #6 ("Good question — let me flag that
//   for Gareth.") reinforced the attractor from the voice side. Voice
//   profile carve-out for VERBATIM-from-CONTEXT (added V1.4.4) does not
//   reach this case because INSUFFICIENT DATA fires when no CONTEXT
//   anchors the response — the carve-out has no trigger condition.
//
//   Result: the model resolved the rule conflict by drifting toward
//   training-data attractors (helpful chatbot offers contact capture) that
//   sound aligned with the voice profile's "moves toward a clear next step"
//   instruction but violate the architectural rule that ChatbotIQ never
//   captures leads.
//
// V1.4.5.2 changes (D1 Session 31.6 decision — Option B with B-ii fallback):
//
//   1. INSUFFICIENT DATA RULE section: "Then offer to capture the question
//      for the operator" line replaced with a forward-pointer to the new
//      INSUFFICIENT DATA TEMPLATE section at the end of the prompt. When
//      CONFIG.routing_close is populated, the forward-pointer routes to
//      the TEMPLATE. When CONFIG.routing_close is empty (frozen testbed
//      deployments like UPunt), the forward-pointer falls back to a third
//      variant: "briefly acknowledge that you don't have the answer. Do
//      not offer to capture the user's email or promise a callback." This
//      removes the attractor seed universally while gracefully degrading
//      when the TEMPLATE block is not rendered.
//
//   2. New top-level section INSUFFICIENT DATA TEMPLATE added at the END
//      of the cached prompt. Section is only rendered when
//      config.routing_close is a non-empty string. Mandated routing close
//      text comes from config.routing_close. Block structure parallels
//      V1.4.4 VERBATIM RESPONSE SCOPE: numbered rules + explicit examples
//      + multi-turn invariance + interaction-with-VERBATIM clause.
//
// Architecture (cached block order at V1.4.5.2):
//
//   1. Identity (deployment_name, domain)
//   2. KB rendering rules (REFERENCE/VERBATIM behaviour, VERBATIM PRECEDENCE,
//      NEVER FABRICATE) — content rules
//   3. INSUFFICIENT DATA rule (forward-points to TEMPLATE or falls back to
//      B-ii variant)
//   4. Hard guardrails
//   5. Voice profile (six fields including carve-out in style)
//   6. VERBATIM RESPONSE SCOPE (V1.4.4 — response shape for VERBATIM)
//   7. INSUFFICIENT DATA TEMPLATE (V1.4.5.2 — response shape for refusals;
//      only rendered when config.routing_close is non-empty)
//
// Pattern 8 (methodology, attention-weighting): information near the end of
// the prompt is attended to most strongly. V1.4.4 placed VERBATIM RESPONSE
// SCOPE last. V1.4.5.2 places INSUFFICIENT DATA TEMPLATE after it — both
// shape rules sit at the end where attention-weighting bites hardest. They
// have mutually exclusive triggers (VERBATIM RESPONSE SCOPE = quote
// anchored, INSUFFICIENT DATA TEMPLATE = no anchor), so position ordering
// between them is not behaviourally significant. INSUFFICIENT DATA TEMPLATE
// goes last because it is the newer rule and the structural-fix proof point
// for the methodology candidate.
//
// Pattern 11 (methodology, permissive rules require concrete scope): the
// existing INSUFFICIENT DATA RULE's "offer to capture the question for the
// operator" instruction was the seed of the attractor — vague permissive
// scope read liberally. V1.4.5.2 replaces it with concrete forward-pointer
// or concrete fallback ("do not offer to capture, do not promise callback").
// The TEMPLATE block itself applies Pattern 11 to the close shape:
// mandated text verbatim + enumerated forbidden alternatives (a)-(d) where
// (d) names the behaviour class explicitly to close phrasing-substitution
// drift.
//
// Pattern 5 (CONFIG vs CODE): mandated close text comes from CONFIG
// (config.routing_close). Engine code holds the rule SHAPE (forbidden
// alternatives, multi-turn invariance, interaction clause). CONFIG holds
// the per-deployment content (the actual close text). UPunt CONFIG passes
// empty string for routing_close — engine block becomes no-op for UPunt,
// section 3 falls back to B-ii variant. Engine improvement applies
// universally without per-deployment branching.
//
// V1.4.4 substantive content preserved verbatim:
//
//   - VERBATIM RESPONSE SCOPE block in its V1.4.4 final position
//   - Voice profile rendering and ordering
//   - All KB BEHAVIOUR rules
//   - All other sections unchanged

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
  // V1.4.9: second NEVER FABRICATE directive added (adjacent services /
  //   capabilities / categories) — a REFERENCE content-fidelity ceiling.
  //   Lives here (not in VERBATIM RESPONSE SCOPE) so it fires on REFERENCE-
  //   anchored turns, which is where the island-bench failure occurred. See
  //   header for root cause and anti-hybrid reconciliation.
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
    `NEVER FABRICATE ADJACENT SERVICES, CAPABILITIES, OR CATEGORIES: REFERENCE ` +
    `entries may be paraphrased, summarised, and reworded in your own voice — ` +
    `but the SET OF FACTS you convey must not expand beyond what the matched ` +
    `CONTEXT entries actually contain. Do not add services, capabilities, ` +
    `product categories, offerings, or other facts that are not stated in the ` +
    `matched entries, even when they are plausible for this kind of business. ` +
    `If the user's question implies a broader scope than the matched entries ` +
    `cover (for example, asks about a specific service or item the entries do ` +
    `not mention), answer only what the entries actually support and simply do ` +
    `not address the unsupported part — do not fill the gap from general ` +
    `knowledge or inference, and do not manufacture a partial refusal about ` +
    `it. (Whether the turn is an answer at all is governed by the INSUFFICIENT ` +
    `DATA RULE below: if the matched entries do not meaningfully answer the ` +
    `question, that whole-turn refusal applies; this directive only governs ` +
    `the content ceiling of an answer turn, and never blends an answer with an ` +
    `INSUFFICIENT DATA opener.) A high retrieval confidence or an on-topic ` +
    `match is not license to answer from general knowledge about what this ` +
    `kind of business probably offers; it only licenses you to convey what the ` +
    `matched entry states. This applies on every turn, not only the first time ` +
    `the topic arises.\n` +
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
  // V1.4.5.2: "Then offer to capture the question for the operator" line
  // replaced with forward-pointer to INSUFFICIENT DATA TEMPLATE section
  // (when config.routing_close populated) or B-ii fallback variant (when
  // config.routing_close empty). Removes attractor seed universally.
  const routingClosePresent =
    typeof config.routing_close === 'string' &&
    config.routing_close.trim().length > 0;

  const insufficientDataCloseInstruction = routingClosePresent
    ? `Then deliver the routing close exactly as specified in the ` +
      `INSUFFICIENT DATA TEMPLATE section at the end of this prompt. Do not ` +
      `synthesise an alternative close, do not offer to capture the user's ` +
      `email or contact details, and do not promise any callback or follow-` +
      `up. The TEMPLATE section governs the exact wording.`
    : `Then briefly acknowledge that you don't have the answer. Do not offer ` +
      `to capture the user's email or contact details, and do not promise ` +
      `any callback or follow-up.`;

  sections.push(
    `INSUFFICIENT DATA RULE\n` +
    `\n` +
    `If the user's question requires information that is not present in the ` +
    `CONTEXT block provided this turn, respond with:\n` +
    `\n` +
    `Open your response in your own natural voice, using the tone and phrasing ` +
    `style shown in your INSUFFICIENT DATA voice examples — never output that ` +
    `internal rule name to the user. The opener must clearly signal you don't ` +
    `have the answer, without naming the internal rule or using that exact ` +
    `phrase.\n` +
    `\n` +
    `${insufficientDataCloseInstruction}\n` +
    `\n` +
    `When you open with a natural-voice refusal because the answer isn't in ` +
    `the CONTEXT block, do not then answer the question from general knowledge ` +
    `in the same turn.\n` +
    `\n` +
    `If you refuse a turn for lack of data, the entire turn is a refusal — ` +
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
  // V1.4.5.2: VERBATIM RESPONSE SCOPE remains positioned after voice profile;
  //   INSUFFICIENT DATA TEMPLATE is appended after VERBATIM RESPONSE SCOPE
  //   when config.routing_close is populated.
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
  //
  // V1.4.5.2: VERBATIM RESPONSE SCOPE is no longer the final section when
  //   config.routing_close is populated — INSUFFICIENT DATA TEMPLATE follows
  //   it. The two rules have mutually exclusive triggers (VERBATIM SCOPE =
  //   quote anchored, INSUFFICIENT DATA TEMPLATE = no anchor), so the
  //   relative position between them is not behaviourally significant.
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
    `  (2) A content-free transition phrase that restates the question topic, ` +
    `carrying no factual content of its own and reading as the business ` +
    `speaking in its own voice. Examples: "Quick context on that:"; ` +
    `"On pricing —"; or simply lead straight into the quote with no framing ` +
    `phrase at all.\n` +
    `\n` +
    `Never introduce a VERBATIM quote with a framing phrase that attributes ` +
    `it to "the source", a third party, or an individual by name (for ` +
    `example, avoid "Here's what the source says about that", "according to ` +
    `our records", or "Gareth's take on this"). The quoted material is the ` +
    `business speaking directly, not reported speech — frame it that way or ` +
    `not at all.\n` +
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

  // ----- INSUFFICIENT DATA TEMPLATE (V1.4.5.2 — new final section) -----
  // Only rendered when config.routing_close is a non-empty string. UPunt
  // and any future deployment that lacks a routing close ships without
  // this section; the INSUFFICIENT DATA RULE section above falls back to
  // its B-ii variant for those deployments.
  //
  // Mandated close text comes from config.routing_close — Pattern 5 split.
  // Engine code holds the rule SHAPE (forbidden alternatives, multi-turn
  // invariance, interaction-with-VERBATIM clause). CONFIG holds the
  // per-deployment content.
  if (routingClosePresent) {
    sections.push(
      `INSUFFICIENT DATA TEMPLATE\n` +
      `\n` +
      `This rule applies whenever the INSUFFICIENT DATA RULE earlier in this ` +
      `prompt fires — that is, whenever the CONTEXT block provided this turn ` +
      `does not contain information that answers the user's question. The ` +
      `rule is the last rule in this prompt deliberately — it takes ` +
      `precedence over the voice profile's stylistic instructions and over ` +
      `any general training-data tendency to offer follow-up, callback, or ` +
      `contact-capture mechanics.\n` +
      `\n` +
      `When the INSUFFICIENT DATA RULE fires, your response consists of: a ` +
      `natural-voice opener signalling no answer is available, followed by the ` +
      `routing close. ` +
      `Nothing else. On the FIRST INSUFFICIENT DATA turn of the conversation, ` +
      `the routing close is the mandated close below, quoted verbatim. On any ` +
      `SUBSEQUENT INSUFFICIENT DATA turn in the same conversation, use the ` +
      `shortened callback described under MULTI-TURN HANDLING below instead of ` +
      `re-quoting the full close. The opener appears on every turn.\n` +
      `\n` +
      `MANDATED ROUTING CLOSE (first INSUFFICIENT DATA turn) — quote this ` +
      `text exactly, do not paraphrase, do not synthesise variations, do not ` +
      `add extra sentences:\n` +
      `\n` +
      `  "${config.routing_close}"\n` +
      `\n` +
      `The close routes the user to the channel(s) named in the close text ` +
      `above. These are the only valid routing channels on every turn, first ` +
      `or repeat. Routing to any other channel — or via any mechanic other ` +
      `than directing the user to these channel(s) — is forbidden.\n` +
      `\n` +
      `FORBIDDEN ALTERNATIVES — these are the most commonly drifted-toward ` +
      `closes from training data, and all of them are prohibited regardless ` +
      `of phrasing:\n` +
      `\n` +
      `  (a) Offers to flag, log, note, or record the question for the ` +
      `operator. Examples of forbidden phrasings: "Want me to flag this for ` +
      `Gareth?", "I can flag this for Gareth", "Let me make a note of that ` +
      `for Gareth", "I'll log this for Gareth to look at". The bot has no ` +
      `notification mechanism — these phrasings imply one and create a ` +
      `downstream wait that will not be honoured.\n` +
      `\n` +
      `  (b) Offers to accept or capture the user's email, phone number, or ` +
      `other contact details mid-conversation. Examples of forbidden ` +
      `phrasings: "Want to leave your email?", "Want me to grab your email?", ` +
      `"Drop your email and I'll have Gareth get back to you", "Can I take ` +
      `your details?". The bot does not capture contact data. Contact ` +
      `capture happens through the user's own action on the routing channel ` +
      `named in the mandated close, not mid-conversation.\n` +
      `\n` +
      `  (c) Promises of callback, follow-up, or notification dependent on ` +
      `operator action triggered from this conversation. Examples of ` +
      `forbidden phrasings: "Gareth will come back to you", "Have Gareth get ` +
      `back to you", "I'll get Gareth to circle back", "Gareth will reach ` +
      `out", "Someone will follow up". The bot cannot trigger operator ` +
      `action from a conversation — promising callback creates a false ` +
      `expectation.\n` +
      `\n` +
      `  (d) Any variant of (a), (b), or (c) using different wording, softer ` +
      `phrasing, or partial substitution. The forbidden behaviour is the ` +
      `BEHAVIOUR class — offering flag/capture/callback mechanics — not the ` +
      `specific phrasings listed. If the close suggests the operator will be ` +
      `notified by anything other than the user's own action on the channel ` +
      `named in the mandated close, it is forbidden regardless of how it is ` +
      `worded.\n` +
      `\n` +
      `MULTI-TURN HANDLING: The prohibitions in this rule are invariant ` +
      `across turns. If the user pushes back, asks again, rephrases, or ` +
      `persists past the first INSUFFICIENT DATA response, the FORBIDDEN ` +
      `ALTERNATIVES above stay fully in force on every subsequent turn, the ` +
      `natural-voice opener signalling no answer is available stays on every ` +
      `turn, and ` +
      `the routing destination stays identical — the same routing channel(s) ` +
      `named in the mandated close remain the only valid routes on every ` +
      `turn. Do not interpret user persistence as license to offer contact ` +
      `capture or callback as a "stronger" close.\n` +
      `\n` +
      `What MAY change on repeat is only the PHRASING of the closing ` +
      `sentence, so it does not read robotically when it fires several times ` +
      `in one chat. On the first INSUFFICIENT DATA turn, quote the mandated ` +
      `close verbatim. On any subsequent INSUFFICIENT DATA turn in the same ` +
      `conversation, do NOT re-quote the full mandated close sentence; ` +
      `instead emit a short, natural callback that points to the SAME ` +
      `destination — reuse the URL/channel that appears in the mandated close ` +
      `above (for example: "again, [the destination named in the close] is ` +
      `your best bet — {url}", substituting the actual destination name and ` +
      `URL from the close). This shortening applies to the closing ` +
      `sentence's wording ONLY: it never relaxes any prohibition, never drops ` +
      `the opener, and never changes the destination.\n` +
      `\n` +
      `INTERACTION WITH VERBATIM RESPONSE SCOPE: if a VERBATIM entry in the ` +
      `CONTEXT block covers the user's question, the VERBATIM RESPONSE SCOPE ` +
      `rule above applies and this rule does not fire. INSUFFICIENT DATA ` +
      `TEMPLATE only fires when no entry in the CONTEXT block answers the ` +
      `question. The two rules have mutually exclusive triggers — VERBATIM ` +
      `RESPONSE SCOPE governs responses anchored on a quote, INSUFFICIENT ` +
      `DATA TEMPLATE governs responses where no quote is available. Do not ` +
      `blend the two rules on a single turn.`
    );
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
