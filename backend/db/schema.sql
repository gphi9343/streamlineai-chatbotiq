-- ChatbotIQ V1.1 — Conversation memory schema
-- Run once in the Supabase SQL Editor.
--
-- RLS is intentionally disabled on these tables. The chatbot backend
-- (Railway) is the only client. It uses the secret/service_role key
-- which bypasses RLS regardless. The frontend (Netlify) never talks
-- to Supabase directly — it talks to Railway. RLS adds operational
-- complexity here without security benefit at V1.1.
--
-- If/when V1.7 introduces a logging dashboard or any browser-side
-- Supabase access, RLS policies will be added at that point.

-- ----------------------------------------------------------------
-- sessions: one row per chat session (one browser tab / Telegram chat)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  id              UUID         PRIMARY KEY,
  deployment      TEXT         NOT NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  last_active_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  metadata        JSONB
);

ALTER TABLE sessions DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS sessions_deployment_idx
  ON sessions (deployment);

CREATE INDEX IF NOT EXISTS sessions_last_active_at_idx
  ON sessions (last_active_at DESC);


-- ----------------------------------------------------------------
-- messages: one row per turn (user or assistant)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS messages (
  id                  BIGSERIAL    PRIMARY KEY,
  session_id          UUID         NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role                TEXT         NOT NULL CHECK (role IN ('user', 'assistant')),
  content             TEXT         NOT NULL,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  stop_reason         TEXT,
  input_tokens        INTEGER,
  output_tokens       INTEGER,
  cache_read_tokens   INTEGER,
  cache_write_tokens  INTEGER
);

ALTER TABLE messages DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS messages_session_id_created_at_idx
  ON messages (session_id, created_at);


-- ----------------------------------------------------------------
-- Smoke test (run after creation to verify):
-- ----------------------------------------------------------------
-- INSERT INTO sessions (id, deployment) VALUES (gen_random_uuid(), 'smoke-test');
-- SELECT * FROM sessions WHERE deployment = 'smoke-test';
-- DELETE FROM sessions WHERE deployment = 'smoke-test';
