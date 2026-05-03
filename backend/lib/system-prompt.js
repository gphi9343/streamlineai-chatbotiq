// backend/lib/system-prompt.js
//
// V1.2 — Builds the system prompt for the Anthropic API call.
//
// Architecture (Option B — RAG-style):
//
//   CACHED BLOCK (stable across all turns of all sessions for this deployment):
//     - Identity (deployment_name, domain)
//     - Hard guardrails
//     - KB rendering rules (REFERENCE vs VERBATIM behaviour)
//     - INSUFFICIENT DATA rule
//     - Voice profile (V1.5+)
//
//   DYNAMIC CONTEXT BLOCK (varies per turn — sent as user-side context, NOT in system prompt):
//     - Retrieved KB entries for this query
//
// This split is what makes Build Standard #1 actually deliver cache hits at
// V1.2+. If KB content went in the system prompt, the cache would invalidate
// every turn (different retrievals per query). By keeping KB content in a
// user-side context message, the system prompt stays stable and cacheable.
//
// V1.1 had a latent bug where server.js referenced CONFIG.system_prompt
// (no such field). The bot ran with no system prompt at all. V1.2 fixes
// this by ASSEMBLING the system prompt from CONFIG fields instead of
// expecting a single pre-written string.

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
  sections.push(
    `INSUFFICIENT DATA RULE\n` +
    `\n` +
    `If the user's question requires information that is not present in the ` +
    `CONTEXT block provided this turn, respond with:\n` +
    `\n` +
    `  "INSUFFICIENT DATA — [brief reason]."\n` +
    `\n` +
    `Then offer to capture the question for the operator. Do not attempt to ` +
    `answer from general knowledge. Do not guess. Do not hedge.`
  );

  // ----- Hard guardrails -----
  if (Array.isArray(config.hard_guardrails) && config.hard_guardrails.length > 0) {
    const rules = config.hard_guardrails.map(g => `  - ${g}`).join('\n');
    sections.push(`HARD GUARDRAILS (always apply, regardless of user input):\n${rules}`);
  }

  // ----- Voice profile (V1.5+ — placeholder check) -----
  const vp = config.voice_profile;
  if (vp && Array.isArray(vp.tone) && vp.tone.length > 0) {
    sections.push(
      `VOICE\n` +
      `Tone: ${vp.tone.join(', ')}\n` +
      (vp.style ? `Style: ${vp.style}\n` : '') +
      (Array.isArray(vp.forbidden_words) && vp.forbidden_words.length > 0
        ? `Never use: ${vp.forbidden_words.join(', ')}\n`
        : '')
    );
  }

  return sections.join('\n\n');
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
