# StreamlineAI ChatbotIQ

Generic chatbot engine. Reskinnable per client via CONFIG-only changes.
First deployment: UPunt (horse racing testbed).

**Current version:** V1.1 — conversation memory in Supabase.

## Stack

| Layer | Tool |
|---|---|
| LLM | Claude Sonnet 4.5 (`claude-sonnet-4-5`) via Anthropic API |
| Backend | Node 20 + Express on Railway |
| Database | Supabase (Postgres) — ap-southeast-2 |
| Frontend | HTML/CSS/JS on Netlify |
| VCS | git on GitHub (public repo) |

## Repo structure

```
backend/
  server.js                  Express app, /chat SSE endpoint
  config/
    upunt.js                 UPunt CONFIG (voice, KB, guardrails)
  lib/
    anthropic.js             Anthropic client + streaming
    errors.js                Structured error shape + helpers
    sessions.js              Session ID validation
    stop-reason.js           Router for API stop_reason field
    supabase.js              Supabase client + sessions/messages CRUD
    validate.js              Response validation
  db/
    schema.sql               One-shot schema for Supabase
  package.json
  .env.example

frontend/
  index.html
  chat.js                    Session ID, SSE parser, chat UI
  style.css
```

## Environment variables

Set on Railway → service → Variables tab.

| Var | Purpose | Source |
|---|---|---|
| `ANTHROPIC_API_KEY` | Auth to Anthropic API | console.anthropic.com → API keys → `chatbotiq-dev` |
| `ALLOWED_ORIGIN` | CORS allow-list | Netlify URL (e.g. `https://streamlineai-chatbotiq.netlify.app`) |
| `SUPABASE_URL` | Supabase project URL | Supabase project Home page |
| `SUPABASE_SECRET_KEY` | Backend access to Supabase | Supabase → Settings → API Keys → "+ New secret key" |
| `PORT` | HTTP port | Set by Railway automatically |

## Database schema

V1.1 introduces two tables: `sessions` and `messages`. RLS is intentionally
disabled — see header comment in `backend/db/schema.sql` for rationale.

To deploy schema:

1. Open Supabase project → SQL Editor
2. Paste the contents of `backend/db/schema.sql`
3. Click **Run**
4. Verify tables exist in Table Editor

Re-running the SQL is safe — all `CREATE` statements use `IF NOT EXISTS`.

## Deployment

**Backend (Railway):**
- Connected to GitHub repo, auto-deploys on push to `main`
- Root Directory set to `backend`
- Build command: `npm install`
- Start command: `npm start`

**Frontend (Netlify):**
- Connected to GitHub repo, auto-deploys on push to `main`
- Base directory: `frontend`
- Publish directory: `frontend`

## Rollback

If a deployment breaks production:

**Option A — git revert (clean history):**
```
git revert <bad-commit-sha>
git push origin main
```
Both Railway and Netlify auto-deploy the revert.

**Option B — Railway rollback (fast, no git change):**
1. Railway → service → Deployments tab
2. Find the last known-good deployment
3. Click ⋮ → **Redeploy**
This rolls back the running container without changing git. Good for
emergency revert; follow up with a proper git revert afterwards.

**Option C — git tag rollback (for tagged versions):**
```
git checkout v1.0
git checkout -b rollback-from-1.1
git push origin rollback-from-1.1
```
Then point Railway/Netlify branch at `rollback-from-1.1`.

## Cost envelope (V1.1 testing)

| Service | Tier | Cost |
|---|---|---|
| Anthropic API | `chatbotiq-dev` key, $40/mo cap | <$5/mo expected |
| Railway | Free trial ($5 / 30 days) | $0 until trial expires |
| Supabase | Free tier | $0 |
| Netlify | Free tier | $0 |
| **Total** | | **<$5/mo** during V1.1 testing |

## Versions

- **V1.0** (29 April 2026) — Web chat → Anthropic API → reply. No memory.
- **V1.1** (current) — Conversation memory in Supabase.
- V1.2 — KB ingestion (next).
- V1.3 — Telegram interface.
- V1.4 — Injection channel (FORM/INTEL tagging).
- V1.5 — Voice profile applied.
- V1.6 — Scheduled data ingestion.
- V1.7 — Logging dashboard.
---

## Multi-deployment dispatch (V1.4+)

The chat backend serves multiple deployments from one Railway instance. A
request's deployment is resolved from the Origin header. Two configuration
surfaces govern this and must agree:

- `ALLOWED_ORIGINS` (Railway env var, comma-separated): the CORS allow-list.
  Controls which origins are allowed to call the API at all. Rejection
  happens in Express middleware before any route handler runs.
- `CONFIG.allowed_origins` (per-deployment array, e.g. in `config/upunt.js`):
  the deployment dispatch map. After CORS passes, the chat handler looks up
  the Origin header against each registered deployment's `allowed_origins` to
  determine which CONFIG to use. No match returns a structured `config_error`.

If an origin is in `ALLOWED_ORIGINS` but not in any `CONFIG.allowed_origins`,
the request passes CORS and fails dispatch with `config_error`. Drift symptom:
"CORS passed, dispatch failed with config_error". Fix is adding the origin to
the appropriate CONFIG (or removing it from ALLOWED_ORIGINS if it shouldn't
reach the API at all).

When adding a new deployment: (1) clone an existing `config/<slug>.js`,
(2) register the slug in `lib/auth.js` `DEPLOYMENT_REGISTRY`, (3) set
`ADMIN_TOKEN_<SLUG>` in Railway env vars, (4) append the public-chat origin
to `ALLOWED_ORIGINS` env var, (5) confirm the same origin is in the new
CONFIG's `allowed_origins` array.