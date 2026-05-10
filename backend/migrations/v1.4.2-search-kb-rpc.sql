-- backend/migrations/v1.4.2-search-kb-rpc.sql
--
-- V1.4.2 — KB retrieval RPC with hybrid AND-then-OR matching.
--
-- Iteration history (this session — Session 25):
--
-- v2.a (rejected at verification step, Standing Rule 2 / Pattern 23 catch):
--   Used websearch_to_tsquery() expecting natural-language OR semantics.
--   Postgres docs were misread — websearch_to_tsquery is conjunctive by
--   default, only honours OR for explicit OR keyword in input. Effective
--   behaviour identical to plainto_tsquery for plain natural-language
--   queries. Test (a) "how much does it cost" still missed Entry 10; test
--   (b) "I am not technical can I still use this" returned zero rows for
--   Entry 19. Same retrieval miss as V1.4.1.
--
-- v2.b (this version):
--   Hybrid AND-then-OR matching, both paths combined and rank-ordered.
--   Rationale: AND match preserves precision when KB content is rich
--   (every term hits → high rank). OR match catches partial overlap when
--   content is thin (some terms hit → lower rank, but at least Entry 10
--   surfaces for "cost" alone). Both paths compete on rank; ts_rank
--   naturally rewards entries that match more terms in higher-weighted
--   positions.
--
--   Sanitisation: OR query is built from sanitised input — alphanumeric
--   tokens only, joined with ' | '. Prevents to_tsquery operator-injection
--   risk from special characters in user input.
--
--   Deduplication: same entry can match both paths. DISTINCT ON (id) keeps
--   the higher-ranked instance per entry (ordered by id then rank DESC).
--   Outer SELECT then re-orders by rank for final result.
--
--   Floor: rank > 0.0001 inside RPC drops severe noise. JS-side
--   RELEVANCE_FLOOR = 0.01 in lib/kb.js provides belt-and-braces (RPC
--   strips severe noise, JS strips mild noise).
--
-- Schema dependency: kb_entries.search_tsv is a generated tsvector column
-- weighted (question A, body B). RPC uses it as-is. No schema migration.
--
-- Reversibility: DROP FUNCTION search_kb(text, text, int);
--
-- Performance: two @@ operations on the same GIN-indexed tsvector. Both
-- cheap. ts_rank computed per matched row. DISTINCT ON sort is on a small
-- result set (LIMIT applied last). Net cost roughly 2x v2.a — still
-- negligible at current KB scale.

CREATE OR REPLACE FUNCTION search_kb(
  p_deployment_slug text,
  p_query text,
  p_limit int DEFAULT 3
)
RETURNS TABLE (
  id uuid,
  content_type content_type,
  question text,
  body text,
  attribution text,
  tags text[],
  rank real
)
LANGUAGE sql
STABLE
AS $$
  WITH
    -- Build a sanitised OR-query from the user input.
    -- Strip non-alphanumeric (preserve spaces), collapse whitespace, split
    -- on spaces, filter empties, join with ' | '. Result is a tsquery-safe
    -- string of OR-joined terms.
    --
    -- Example transformation:
    --   'How much does it cost?' →
    --   strip non-alnum → 'How much does it cost '
    --   collapse ws → 'How much does it cost'
    --   split + filter + join → 'How | much | does | it | cost'
    --
    -- to_tsquery then applies stemming and stopword removal to each term.
    or_query AS (
      SELECT NULLIF(
        array_to_string(
          array_remove(
            string_to_array(
              trim(regexp_replace(p_query, '[^a-zA-Z0-9 ]', ' ', 'g')),
              ' '
            ),
            ''
          ),
          ' | '
        ),
        ''
      ) AS q
    ),

    -- AND-path: conjunctive match via websearch_to_tsquery.
    -- High-precision when KB content is rich.
    and_hits AS (
      SELECT
        kb.id,
        kb.content_type,
        kb.question,
        kb.body,
        kb.attribution,
        kb.tags,
        ts_rank(kb.search_tsv, websearch_to_tsquery('english', p_query)) AS rank
      FROM kb_entries kb
      WHERE kb.deployment_slug = p_deployment_slug
        AND kb.search_tsv @@ websearch_to_tsquery('english', p_query)
    ),

    -- OR-path: disjunctive match via manually-built tsquery.
    -- Catches partial overlap when content is lexically thin.
    -- Skipped if the sanitised query is empty (all-special-chars input).
    or_hits AS (
      SELECT
        kb.id,
        kb.content_type,
        kb.question,
        kb.body,
        kb.attribution,
        kb.tags,
        ts_rank(kb.search_tsv, to_tsquery('english', (SELECT q FROM or_query))) AS rank
      FROM kb_entries kb
      WHERE (SELECT q FROM or_query) IS NOT NULL
        AND kb.deployment_slug = p_deployment_slug
        AND kb.search_tsv @@ to_tsquery('english', (SELECT q FROM or_query))
    ),

    -- Combined: dedupe on id, keep highest rank per entry.
    combined AS (
      SELECT * FROM and_hits
      UNION ALL
      SELECT * FROM or_hits
    ),

    deduped AS (
      SELECT DISTINCT ON (id)
        id, content_type, question, body, attribution, tags, rank
      FROM combined
      ORDER BY id, rank DESC
    )

  -- Final rank-ordered, floor-filtered, limited result set.
  SELECT id, content_type, question, body, attribution, tags, rank
  FROM deduped
  WHERE rank > 0.0001
  ORDER BY rank DESC
  LIMIT p_limit;
$$;

-- Verification queries — run each in a fresh SQL Editor tab (or replace
-- the previous one). Pass criteria documented per query.
--
--   -- (a) Should hit Entry 10 ("What does it cost? Pricing?") in top results.
--   --     Entry 10 is the VERBATIM pricing entry. Both paths should match
--   --     ("cost" via OR; AND path may match if "much" or other terms hit
--   --     incidentally). Pass: Entry 10's id (find via admin frontend)
--   --     appears in top 3, with rank > 0.0001.
--   SELECT id, question, rank FROM search_kb('streamlineai', 'how much does it cost', 5);
--
--   -- (b) Should hit Entry 19 ("What if I'm not technical?") in top results.
--   --     OR path matches on "technical" alone (Entry 19's question contains
--   --     "technical"). AND path likely returns zero. Pass: Entry 19 in
--   --     top 3, rank > 0.0001.
--   SELECT id, question, rank FROM search_kb('streamlineai', 'I am not technical can I still use this', 5);
--
--   -- (c) Should return empty (no rows, no error) on KB miss.
--   --     Neither path matches anything. Pass: zero rows.
--   SELECT id, question, rank FROM search_kb('streamlineai', 'xyzabc nonexistent gibberish', 5);
--
--   -- (d) Regression check — Entry 1 "What does StreamlineAI do?" should
--   --     still surface for the obvious query. AND path should match here
--   --     (high precision case). Pass: Entry 1 in top 3, rank > 0.0001.
--   SELECT id, question, rank FROM search_kb('streamlineai', 'What does StreamlineAI do', 5);
