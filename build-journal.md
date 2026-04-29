# ChatbotIQ Build Journal

*Append-only. Read most recent 3 entries at session start. Archive when journal exceeds 30 entries.*

---

### Session 1 — 29 April 2026 — V1.0

**Built:** Backend skeleton (Express on Node 20) and minimal frontend (HTML/CSS/JS). Backend has six files: `server.js` (Express + /chat endpoint with SSE streaming), `lib/anthropic.js` (SDK wrapper with prompt caching and error classification), `lib/errors.js` (structured error shape per Build Standard #2), `lib/stop-reason.js` (router stub per Build Standard #5), `lib/validate.js` (post-stream validation per Build Standard #3), `config/upunt.js` (CONFIG skeleton — voice profile and KB stubs in place but empty for V1.0). Frontend has three files: `index.html`, `style.css` (StreamlineAI black/gold brand), `chat.js` (SSE stream parser with structured error rendering).

**Decided:**
- Express over Fastify for backend — lowest friction, most Railway tutorials use it, dependency overhead negligible
- Server-Sent Events for streaming over WebSockets — simpler, fits the request/response shape, easier to debug
- Single-file `config/upunt.js` exporting one object — keeps CONFIG vs CODE boundary visible at a glance, avoids YAML/JSON parsing overhead
- `claude-sonnet-4-5` as the model — locked in master file, not relitigated
- Prompt caching scaffolded at V1.0 even though the cached block is small — the discipline of cached vs dynamic content separation is harder to retrofit than to start with
- Stop_reason router builds the full case list at V1.0 with warnings for unhandled cases — cheaper than introducing cold at V1.6
- Frontend reads `window.BACKEND_URL` so the Railway URL can be injected without rebuilding — Netlify env var pattern

**Broken:** Nothing yet — code is generated but not deployed. Smoke test happens after Gareth completes Railway and Netlify deploy.

**Next:** Session 2 either (a) completes V1.0 deployment if smoke test passes, or (b) handles whatever surfaces from the smoke test. Then V1.1 — conversation memory in Supabase.

**Files changed:**
- `backend/package.json` (new)
- `backend/server.js` (new)
- `backend/lib/anthropic.js` (new)
- `backend/lib/errors.js` (new)
- `backend/lib/stop-reason.js` (new)
- `backend/lib/validate.js` (new)
- `backend/config/upunt.js` (new)
- `frontend/index.html` (new)
- `frontend/style.css` (new)
- `frontend/chat.js` (new)
- `README.md` (new)
- `.gitignore` (new)

**Spend cap state:** Workspace cap set at $40/month, notification at $30. `chatbotiq-dev` is currently the only key.

**Build Standards applied at V1.0:**
- #1 prompt caching — scaffolded, system prompt block has `cache_control: ephemeral`
- #2 structured error handling — full taxonomy implemented in `lib/errors.js` and `lib/anthropic.js`
- #3 response validation — post-stream validation in `lib/validate.js`
- #4 streaming on web chat — SSE from backend, accumulator pattern server-side
- #5 stop_reason router — full stub with all known cases, only `end_turn` acts on result at V1.0
- #6 pre-deployment checklist — to be run before declaring V1.0 shippable

**Pattern 5 check:** CONFIG vs CODE boundary clean. Only `config/upunt.js` contains client-specific content. Engine logic has no UPunt references.

**Open questions for D1:** None this session.
