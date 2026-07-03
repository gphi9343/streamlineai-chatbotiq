-- backend/migrations/v1.6-sessions-deployment-slug.sql
--
-- Adds sessions.deployment_slug so conversations can be queried by slug
-- (Conversation Digest feature) instead of by the stored display name.
--
-- Context: sessions.deployment holds CONFIG.deployment_name (the display
-- name, e.g. 'Macarthur Marble & Granite') — NOT the slug. kb_entries already
-- carries deployment_slug; this brings sessions in line with that pattern and
-- removes the display-name-string brittleness (a deployment_name change in
-- CONFIG would otherwise orphan old sessions from any slug-based filter).
--
-- Run in the Supabase SQL Editor (schema/service-role changes are operator-run;
-- CCode never touches the DB). The column is additive + nullable, so current
-- production keeps working before the engine write-path change deploys.
--
-- DEPLOY ORDER (must hold):
--   1. Run this file (column + backfill + index).
--   2. Deploy the engine change that writes deployment_slug on ensureSession()
--      — the column MUST exist first, or that insert fails on an unknown column.
--   3. Re-run Step B (idempotent) once after deploy to sweep rows created in the
--      gap; only then is the deferred NOT NULL (bottom) safe to apply.
--
-- Applied to production 2026-07-03 via SQL Editor. Pre-flight (Step A) row
-- counts confirmed byte-exact before backfill; post-backfill: macarthur 113,
-- streamlineai 17, upunt 13, zero NULLs.


-- ----------------------------------------------------------------
-- Step A — pre-flight (dry-run). Confirm the three display-name strings
-- match byte-exact and surface any stray 'deployment' values before writing.
-- ----------------------------------------------------------------
-- SELECT deployment, count(*) AS rows
-- FROM sessions
-- GROUP BY deployment
-- ORDER BY rows DESC;


-- ----------------------------------------------------------------
-- Step B — migration (additive, backfill by display name -> slug, idempotent).
-- ----------------------------------------------------------------

-- 1. Add the column (nullable for now).
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS deployment_slug text;

-- 2. Backfill existing rows by mapping the stored display name -> slug.
UPDATE sessions SET deployment_slug = 'macarthur'
  WHERE deployment = 'Macarthur Marble & Granite'
    AND deployment_slug IS DISTINCT FROM 'macarthur';
UPDATE sessions SET deployment_slug = 'streamlineai'
  WHERE deployment = 'StreamlineAI Chatbot'
    AND deployment_slug IS DISTINCT FROM 'streamlineai';
UPDATE sessions SET deployment_slug = 'upunt'
  WHERE deployment = 'UPunt Racing Chatbot'
    AND deployment_slug IS DISTINCT FROM 'upunt';

-- 3. Index for the deployment_slug + date-range query pattern.
CREATE INDEX IF NOT EXISTS sessions_deployment_slug_idx ON sessions (deployment_slug);


-- ----------------------------------------------------------------
-- DEFERRED — do NOT run as part of this migration.
-- Only after the engine write-path change has deployed and a re-run of Step B
-- shows zero NULLs for the three live deployments. Legacy / non-registry
-- 'deployment' values (e.g. 'smoke-test') stay NULL by design.
-- ----------------------------------------------------------------
-- ALTER TABLE sessions ALTER COLUMN deployment_slug SET NOT NULL;
