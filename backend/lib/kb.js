// backend/lib/kb.js
//
// V1.2 — Knowledge base retrieval and seed-file parsing.
//
// Retrieval (used per-turn at /chat):
//   - Full-text search over question + body
//   - Filtered by deployment_slug so each deployment sees only its own KB
//   - Returns top N entries ranked by ts_rank
//   - Caller decides whether to inject; this module just retrieves
//
// Parsing (used by scripts/load-kb.js, never per-turn):
//   - Reads kb-seed.md, splits on `---` blocks, validates fields
//   - Returns array of { content_type, question, body, attribution, tags }
//
// Errors conform to the structured error shape from lib/errors.js.

import { createClient } from '@supabase/supabase-js';
import { makeError } from './errors.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  throw new Error(
    'Missing Supabase env vars. Set SUPABASE_URL and SUPABASE_SECRET_KEY.'
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { persistSession: false },
});

// V1.2 retrieval cap. Enough to test the engine without bloating the
// dynamic context block. Tunes upward at V1.5+ once we see real query
// patterns.
const MAX_HITS = 3;

// Minimum ts_rank score to consider an entry relevant. Below this we
// treat the result as a miss (Pattern 3 — INSUFFICIENT DATA still fires).
// 0.01 is empirical for V1.2 seed scale; revisit when KB is larger.
const RELEVANCE_FLOOR = 0.01;


// ----------------------------------------------------------------
// Retrieval
// ----------------------------------------------------------------

/**
 * Retrieve top KB entries matching a user query.
 *
 * @param {object} params
 * @param {string} params.deploymentSlug - e.g. 'upunt'
 * @param {string} params.query - user's message
 * @returns {Promise<{ok: true, hits: Array} | {ok: false, error: object}>}
 */
export async function retrieveKb({ deploymentSlug, query }) {
  if (!deploymentSlug || !query || !query.trim()) {
    return { ok: true, hits: [] };
  }

  // plainto_tsquery handles user input safely (no operator injection).
  // Postgres function call via Supabase RPC keeps the SQL on the server
  // side. We use a raw query via the .rpc shape isn't available without
  // creating a function, so we use the .select with a computed filter.
  //
  // Two-step approach: fetch candidates by deployment_slug, then rank
  // via plainto_tsquery on the search_tsv column. Supabase JS client
  // supports the textSearch builder for exactly this pattern.

  const { data, error } = await supabase
    .from('kb_entries')
    .select('id, content_type, question, body, attribution, tags')
    .eq('deployment_slug', deploymentSlug)
    .textSearch('search_tsv', query, {
      type: 'plain',
      config: 'english',
    })
    .limit(MAX_HITS);

  if (error) {
    return {
      ok: false,
      error: makeError({
        type: 'downstream_unavailable',
        message: `KB retrieval failed: ${error.message}`,
        suggestion: 'Retry; if persistent, check Supabase status.',
        recoverable: true,
      }),
    };
  }

  // Supabase textSearch returns rows that match. We don't get ts_rank
  // back through this path — we trust the match and let MAX_HITS cap.
  // RELEVANCE_FLOOR is enforced at the loader level (V1.4+) when we
  // route through an RPC that returns rank. For V1.2, presence in
  // results = relevant enough.
  return { ok: true, hits: data || [] };
}


// ----------------------------------------------------------------
// Seed file parsing (used by scripts/load-kb.js only)
// ----------------------------------------------------------------

/**
 * Parse kb-seed.md content into entry objects ready for INSERT.
 *
 * Format per entry:
 *   ---
 *   type: REFERENCE | VERBATIM
 *   tags: [tag1, tag2]
 *   attribution: <string or empty>
 *   ---
 *   <Question on first line>
 *
 *   <Body on subsequent lines>
 *
 * Entries are separated by blank lines between blocks.
 *
 * @param {string} markdown - full file contents
 * @returns {{ok: true, entries: Array} | {ok: false, error: object}}
 */
export function parseSeedFile(markdown) {
  if (typeof markdown !== 'string' || !markdown.trim()) {
    return {
      ok: false,
      error: makeError({
        type: 'validation_error',
        message: 'Seed file is empty',
        suggestion: 'Provide a kb-seed.md with at least one entry.',
        recoverable: false,
      }),
    };
  }

  // Split on the delimiter pattern: a `---` line, then frontmatter, then
  // another `---` line. We use a regex split that captures the frontmatter
  // and the body.
  //
  // Strategy: split the file on `\n---\n` boundaries. Pairs of splits
  // alternate: even = body of previous + frontmatter of next, odd =
  // body of current.
  //
  // Simpler approach: use a regex with three capture groups (frontmatter,
  // question line, body) and matchAll.
  const blockRe =
    /---\s*\n([\s\S]*?)\n---\s*\n([^\n]+)\n([\s\S]*?)(?=\n---\s*\n|\s*$)/g;

  const entries = [];
  let match;
  let blockNum = 0;

  while ((match = blockRe.exec(markdown)) !== null) {
    blockNum += 1;
    const [, frontmatterRaw, questionLine, bodyRaw] = match;

    const fm = parseFrontmatter(frontmatterRaw);
    if (!fm.ok) {
      return {
        ok: false,
        error: makeError({
          type: 'validation_error',
          message: `Block ${blockNum}: ${fm.message}`,
          suggestion: 'Fix kb-seed.md frontmatter and re-run loader.',
          recoverable: false,
        }),
      };
    }

    const question = questionLine.trim();
    const body = bodyRaw.trim();

    if (!question) {
      return {
        ok: false,
        error: makeError({
          type: 'validation_error',
          message: `Block ${blockNum}: missing question line`,
          suggestion: 'Each block must have a question line after the second ---.',
          recoverable: false,
        }),
      };
    }
    if (!body) {
      return {
        ok: false,
        error: makeError({
          type: 'validation_error',
          message: `Block ${blockNum}: missing body`,
          suggestion: 'Each block must have body content after the question line.',
          recoverable: false,
        }),
      };
    }

    // VERBATIM entries must have attribution.
    if (fm.type === 'VERBATIM' && !fm.attribution) {
      return {
        ok: false,
        error: makeError({
          type: 'validation_error',
          message: `Block ${blockNum}: VERBATIM entry missing attribution`,
          suggestion: 'VERBATIM entries quote a named source — set attribution.',
          recoverable: false,
        }),
      };
    }

    entries.push({
      content_type: fm.type,
      question,
      body,
      attribution: fm.attribution || null,
      tags: fm.tags,
    });
  }

  if (entries.length === 0) {
    return {
      ok: false,
      error: makeError({
        type: 'validation_error',
        message: 'Seed file parsed but no entries found',
        suggestion: 'Check the --- delimiters match the expected format.',
        recoverable: false,
      }),
    };
  }

  return { ok: true, entries };
}


/**
 * Parse the frontmatter block of a single entry.
 *
 * Expected lines:
 *   type: REFERENCE | VERBATIM
 *   tags: [tag1, tag2]
 *   attribution: <string or blank>
 */
function parseFrontmatter(raw) {
  const lines = raw
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);

  let type = null;
  let tags = [];
  let attribution = '';

  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim();

    if (key === 'type') {
      type = value.toUpperCase();
    } else if (key === 'tags') {
      // Strip [ ] and split on commas
      const inner = value.replace(/^\[|\]$/g, '').trim();
      if (inner) {
        tags = inner
          .split(',')
          .map(t => t.trim())
          .filter(t => t.length > 0);
      }
    } else if (key === 'attribution') {
      attribution = value;
    }
  }

  if (type !== 'REFERENCE' && type !== 'VERBATIM') {
    return {
      ok: false,
      message: `invalid type "${type}" — must be REFERENCE or VERBATIM`,
    };
  }

  return { ok: true, type, tags, attribution };
}


// ----------------------------------------------------------------
// Loader (called from scripts/load-kb.js)
// ----------------------------------------------------------------

/**
 * Replace all KB entries for a deployment with the provided set.
 * Used by the seed loader script. Not called from /chat.
 *
 * @param {string} deploymentSlug
 * @param {Array} entries - parsed entry objects from parseSeedFile
 * @param {string} source - tag for where these entries came from
 * @returns {Promise<{ok: true, inserted: number} | {ok: false, error: object}>}
 */
export async function replaceKbForDeployment(deploymentSlug, entries, source) {
  // Delete existing entries for this deployment first.
  const del = await supabase
    .from('kb_entries')
    .delete()
    .eq('deployment_slug', deploymentSlug);

  if (del.error) {
    return {
      ok: false,
      error: makeError({
        type: 'downstream_unavailable',
        message: `KB delete failed: ${del.error.message}`,
        suggestion: 'Retry; if persistent, check Supabase.',
        recoverable: true,
      }),
    };
  }

  // Insert new entries.
  const rows = entries.map(e => ({
    deployment_slug: deploymentSlug,
    content_type: e.content_type,
    question: e.question,
    body: e.body,
    attribution: e.attribution,
    tags: e.tags,
    source,
  }));

  const ins = await supabase.from('kb_entries').insert(rows);

  if (ins.error) {
    return {
      ok: false,
      error: makeError({
        type: 'validation_error',
        message: `KB insert failed: ${ins.error.message}`,
        suggestion: 'Check schema constraints and entry shapes.',
        recoverable: false,
      }),
    };
  }

  return { ok: true, inserted: rows.length };
}
