# ChatbotIQ Build Journal

*Append-only. Read most recent 3 entries at session start. Archive when journal exceeds 30 entries.*

---

### Session 1 — 29 April 2026 — V1.0

**Built:** Full V1.0 stack live and tested. Backend (Node 20 + Express) deployed to Railway at `streamlineai-chatbotiq-production.up.railway.app`. Frontend (HTML/CSS/JS) deployed to Netlify at `streamlineai-chatbotiq.netlify.app`. Anthropic API integrated with `claude-sonnet-4-5`. End-to-end pipeline confirmed working.

Code organisation: backend has `server.js`, `lib/anthropic.js`, `lib/errors.js`, `lib/stop-reason.js`, `lib/validate.js`, `config/upunt.js`. Frontend has `index.html`, `style.css`, `chat.js`. Repository at `github.com/gphi9343/streamlineai-chatbotiq`, public, tagged `v1.0`.

**Decided:**
- Express over Fastify for backend — lowest friction, most Railway tutorials use it
- Server-Sent Events for streaming over WebSockets — simpler, fits request/response shape
- Single-file `config/upunt.js` exporting one object — keeps CONFIG vs CODE boundary visible
- `claude-sonnet-4-5` as the model
- Prompt caching scaffolded at V1.0 even though cached block is small — discipline of cached vs dynamic separation harder to retrofit
- Stop_reason router builds full case list at V1.0 with warnings for unhandled cases — cheaper than introducing cold at V1.6
- Frontend reads `window.BACKEND_URL` so Railway URL can be injected without rebuilding (currently hardcoded; future Netlify env var)
- GitHub repo public — no secrets in code, all keys in env vars, public is fine for V1.0
- Repo location: `C:\Users\gphi9\CODE\STREAMLINEAI-CHATBOTIQ` (moved out of OneDrive sync to avoid file-lock and path-length issues)

**Broken:** Nothing currently broken. All four smoke-test prompts returned correct behaviour:
- "Hello" → bot identified itself with deployment_name and domain from CONFIG ✓
- "Who won 2025 Melbourne Cup" → INSUFFICIENT DATA ✓
- "Last winner you know of" → INSUFFICIENT DATA (over-cautious, expected behaviour at V1.0)
- "Harness racing comparison" → INSUFFICIENT DATA, recognised domain mismatch ✓
- "Should I bet $500" → declined, redirected to user research per `hard_guardrails` in CONFIG ✓

**Build Standards applied at V1.0:**
- #1 prompt caching — `cache_control: ephemeral` on system prompt block ✓
- #2 structured error handling — full taxonomy in `lib/errors.js`, classified in `anthropic.js` ✓
- #3 response validation — post-stream validation in `lib/validate.js` ✓
- #4 streaming on web chat — SSE from backend, accumulator pattern server-side ✓
- #5 stop_reason router — full stub with all known cases ✓
- #6 pre-deployment checklist — passed (see below)

**Pre-Deployment Checklist outcome:** Passed for ship to internal testers. Three items deferred (cost estimate per 100 messages, deliberate error path test, external tester confirmation) — none are blockers, all happen in next sessions.

**Pattern check (from `StreamlineAI_Agent_Methodology_v1.md`):**
- Pattern 5 (CONFIG vs CODE) — clean. Only `config/upunt.js` contains client-specific content.
- Pattern 3 (Uncertainty handling) — INSUFFICIENT DATA pattern working as designed.
- Pattern 13 (Defaults are hypotheses) — over-cautious INSUFFICIENT DATA on Melbourne Cup history is correct V1.0 default; will tune at V1.2 (KB) and V1.5 (voice).

**Cost / spend state:**
- `chatbotiq-dev` API key created with workspace cap $40/month
- Notification at $30 (50% notification suggested for next time but not added)
- Smoke test spend negligible (<$0.05 at V1.0 — small system prompt, short responses)
- Railway: free trial $5 / 30 days. V1.0 testing well within envelope.
- Netlify: free tier, no cost.

**Security state:**
- ANTHROPIC_API_KEY in Railway env var (never in source)
- ALLOWED_ORIGIN tightened to `https://streamlineai-chatbotiq.netlify.app` post-smoke-test
- GitHub repo public, no secrets committed
- `.gitignore` excludes `.env`, `node_modules/`

**Files changed:** All initial files committed at `ca0c687`. Frontend BACKEND_URL update committed at `daada55`. Tag `v1.0` at `daada55`.

**Next:** Session 2 begins V1.1 — conversation memory in Supabase. Prerequisite work: Supabase project signup (stop-and-ask: external service + database tier choice), schema design, integration with `/chat` endpoint.

**Open questions for D1:** None this session. Strategic items listed below for awareness, not decision:
- Internal testing window — when to ship to Matty and Lingard for first external test
- Whether to upgrade Railway to Hobby ($5/mo) before or after the trial expires
- Whether to add `chatbotiq-prod` API key now or defer until V1.4 per master file plan

---
