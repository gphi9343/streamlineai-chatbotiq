-- backend/db/schema-v1.2.sql
--
-- V1.2 — Knowledge base table.
--
-- Adds kb_entries with content_type enum (REFERENCE | VERBATIM) per
-- methodology Pattern 1 (Reference vs Verbatim Separation, formerly
-- FORM vs INTEL — D1 rename pending in methodology doc v1.1).
--
-- Retrieval at V1.2 is naive: Postgres full-text search via to_tsvector,
-- ranked by ts_rank, with a deployment_slug filter so multiple deployments
-- can share one Supabase project later. No embeddings — that's a later
-- refinement when we know what queries actually fail.
--
-- RLS explicitly disabled: backend uses the secret key and bypasses RLS,
-- frontend never talks to Supabase directly. Same rationale as V1.1.
--
-- ----------------------------------------------------------------
-- Run ORDER:
-- 1. CREATE TYPE content_type
-- 2. CREATE TABLE kb_entries
-- 3. CREATE INDEX (full-text + deployment_slug)
-- 4. ALTER TABLE ... DISABLE ROW LEVEL SECURITY
-- ----------------------------------------------------------------

CREATE TYPE content_type AS ENUM ('REFERENCE', 'VERBATIM');

CREATE TABLE kb_entries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_slug text NOT NULL,
  content_type    content_type NOT NULL,
  question        text NOT NULL,
  body            text NOT NULL,
  attribution     text,           -- NULL for REFERENCE, source string for VERBATIM
  tags            text[] DEFAULT '{}',
  source          text,           -- where this entry came from (e.g. 'manual-seed-v1.2')
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Full-text search index on (question || body).
-- Generated column avoids re-tokenising on every query.
ALTER TABLE kb_entries
  ADD COLUMN search_tsv tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(question, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(body, '')), 'B')
  ) STORED;

CREATE INDEX kb_entries_search_tsv_idx ON kb_entries USING GIN (search_tsv);
CREATE INDEX kb_entries_deployment_idx ON kb_entries (deployment_slug);

-- Disable RLS — backend uses secret key, frontend never reads this table.
ALTER TABLE kb_entries DISABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------
-- Notes for V1.3+
-- ----------------------------------------------------------------
-- V1.4 (VERBATIM ingestion mechanism) will INSERT into this same table
-- with content_type = 'VERBATIM' and attribution set per source.
--
-- V1.7 (admin dashboard) will SELECT/UPDATE rows here.
--
-- If embeddings are needed later (post-V1.4), add a vector column
-- alongside search_tsv. Don't drop full-text — keep both, route per
-- query type.
