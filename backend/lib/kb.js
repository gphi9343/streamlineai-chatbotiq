// backend/lib/kb.js
//
// V1.4.2 — Retrieval switched from .textSearch() builder to .rpc('search_kb').
//
// V1.2 baseline used the Supabase JS .textSearch() builder which compiles
// down to plainto_tsquery() server-side. plainto_tsquery is conjunctive —
// every word in the user's query (after stemming and stopword removal)
// must match somewhere in the indexed tsvector. Natural-language queries
// fail this routinely.
//
// Session 25 diagnosis (StreamlineAI Failure 1, "How much does it cost"):
// query stems to roughly `much & cost`. Entry 10's body has "cost" but
// no "much". Entry 17's body contains "as much as you can" and "cost".
// plainto_tsquery picks Entry 17 (semantically wrong but lexically
// matches both terms). Entry 10 — the correct VERBATIM pricing entry —
// fails the conjunctive match and is invisible to retrieval.
//
// Same shape explains Session 24 Failure 2 (Entry 19 missed for "I'm not
// technical, can I still use this?"): query stems to `technic & still &
// use`. Entry 19's question has "technical"; body has neither "still"
// nor "use". Conjunctive match fails. One mechanical bug, two surfaced
// failures.
//
// V1.4.2 fix: call the search_kb() RPC defined in
// migrations/v1.4.2-search-kb-rpc.sql. The RPC uses
// websearch_to_tsquery() (handles natural language without operator
// injection risk) and returns ts_rank per row, ordered by rank DESC.
// Caller can now apply RELEVANCE_FLOOR meaningfully — V1.2 declared
// the constant but never used it because .textSearch() doesn't expose
// rank. V1.4.2 enforces it.
//
// V1.4.2 also adds rank to the returned hit shape. The retrieval debug
// endpoint (V1.4.1) now surfaces rank scores in its diagnostic output,
// so retrieval calibration drift is visible without re-running smoke
// tests.
//
// Backwards compat note: the RPC must exist in Supabase before this
// code deploys. Deployment order is: (1) run the SQL migration, (2)
// verify via SQL Editor with three test calls, (3) deploy this code.
// If the RPC is missing, retrievals fail with a downstream_unavailable
// structured error and the bot degrades to no-context mode (Pattern 3
// INSUFFICIENT DATA fires per the system prompt's empty-context handling).
// Bot stays alive even on the failure path.
//
// Parsing functions (parseSeedFile, parseFrontmatter, replaceKbForDeployment)
// unchanged from V1.2.

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

// V1.2 retrieval cap. Now passed to the RPC as p_limit. The RPC orders
// by rank DESC then limits, so we get the top-N MOST RELEVANT entries
// rather than the first-N lexical matches as at V1.2.
const MAX_HITS = 3;

// Minimum ts_rank score to consider an entry relevant. Below this we
// treat the result as a miss (Pattern 3 — INSUFFICIENT DATA still fires).
//
// V1.2 declared this but never enforced it because .textSearch() didn't
// return rank. V1.4.2 enforces it: results below the floor are dropped
// in JS after the RPC returns.
//
// 0.01 is empirical for V1.2 seed scale and tsvector weighting (question
// weight A, body weight B). Tune upward as KB grows. Smoke-test the floor
// at V1.4.2 ship: queries that should hit Entry 10 should produce rank
// well above 0.01; queries that should miss should produce no hits at
// all (rank=0 not even returned by the RPC's @@ filter) or hits below
// the floor.
const RELEVANCE_FLOOR = 0.01;


// ----------------------------------------------------------------
// Retrieval
// ----------------------------------------------------------------

/**
 * Retrieve top KB entries matching a user query.
 *
 * V1.4.2: calls the search_kb() RPC. Returns ranked hits ordered by
 * relevance, filtered by RELEVANCE_FLOOR.
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

  const { data, error } = await supabase.rpc('search_kb', {
    p_deployment_slug: deploymentSlug,
    p_query: query.trim(),
    p_limit: MAX_HITS,
  });

  if (error) {
    return {
      ok: false,
      error: makeError({
        type: 'downstream_unavailable',
        message: `KB retrieval failed: ${error.message}`,
        suggestion:
          'Retry; if persistent, verify search_kb() RPC exists in Supabase ' +
          '(see migrations/v1.4.2-search-kb-rpc.sql).',
        recoverable: true,
      }),
    };
  }

  // Apply relevance floor. The RPC's @@ filter already excludes zero-rank
  // hits, but the floor catches weakly-matching results that pass @@ but
  // would mislead the model. Empirical floor for current KB scale.
  const filtered = (data || []).filter(
    hit => typeof hit.rank === 'number' && hit.rank >= RELEVANCE_FLOOR
  );

  return { ok: true, hits: filtered };
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
