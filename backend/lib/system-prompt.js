// backend/lib/system-prompt.js
//
// V1.3 — Test 3 patch folded in (anti-hybrid + case-3 permission rule).
// Two-sentence change to INSUFFICIENT DATA section. No other behaviour changes.
//
// V1.4 baseline preserved: voice profile rendering across 6 fields, voice
// section last in cached block, RAG-style context block separate.
//
// Architecture (unchanged from V1.2):
//
//   CACHED BLOCK (stable across all turns of all sessions for this deployment):
//     - Identity (deployment_name, domain)
//     - KB rendering rules (REFERENCE vs VERBATIM behaviour)
//     - INSUFFICIENT DATA rule (V1.3: anti-hybrid + case-3 permission)
//     - Hard guardrails
//     - Voice profile (V1.4+ — six fields)
//
//   DYNAMIC CONTEXT BLOCK (varies per turn — sent as user-side context, NOT in system prompt):
//     - Retrieved KB entries for this query
//
// V1.3 changes vs V1.4 baseline:
//   - INSUFFICIENT DATA section: removed "Do not attempt to answer from
//     general knowledge. Do not guess. Do not hedge." (subsumed by new
//     anti-hybrid sentence, and contradicts the case-3 permission).
//   - Added anti-hybrid sentence: forbids the refused-then-answered pattern
//     surfaced in Test 3 of V1.4 smoke testing.
//   - Added case-3 permission sentence: licenses direct answers for in-domain
//     questions with well-defined low-stakes factual answers.

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
    `When a CONTEXT block is empty or contains nothing relevant to the user's ` +
    `question, do not invent an answer from general knowledge. Apply the ` +
    `INSUFFICIENT DATA rule below.`
  );

  // ----- INSUFFICIENT DATA rule (Pattern 3) -----
  // V1.3: anti-hybrid + case-3 permission rules added.
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
    `If the question is in-domain and has a well-defined factual answer that ` +
    `doesn't depend on current data or stakes-bearing predictions, answer it ` +
    `directly without invoking INSUFFICIENT DATA. Reserve INSUFFICIENT DATA ` +
    `for questions where the KB has a genuine gap on something the user needs ` +
    `grounded information for.\n` +
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
      `rhythm, tone, and approach in your responses, including when refusing):\n${examples}`
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
