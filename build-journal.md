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

### Session 2 — 03 May 2026 — V1.1

**Built:** Conversation memory in Supabase. Each chat session gets a stable client-generated UUID stored in browser `localStorage`; user and assistant messages persist in a `messages` table referencing a `sessions` table. On each `/chat` request: validate session, upsert session row, save user message, fetch last 20 turns, prepend history to the messages array sent to Claude, stream response, persist assistant message with `stop_reason` and full token usage.

Code organisation: backend gains `lib/supabase.js` (client + CRUD for sessions/messages, classifies Supabase errors to structured shape), `lib/sessions.js` (UUID validation), `db/schema.sql` (one-shot DDL with RLS explicitly disabled and rationale comment). `lib/anthropic.js` extends V1.0's `callAnthropic` with an optional `history` parameter — name and signature otherwise unchanged. `server.js` adds the persistence pipeline; SSE event format identical to V1.0 (untyped, `type` inside JSON). Frontend `chat.js` adds session generation/persistence and a "New conversation" reset button; SSE parser updated to match V1.0's untyped format.

Repo at `github.com/gphi9343/streamlineai-chatbotiq`, public, tagged `v1.1` at commit `9273874`.

**Decided:**
- Session ID generated client-side (UUID v4 from `crypto.randomUUID()`) and stored in `localStorage`. No server-side session creation endpoint — adds complexity without benefit when the browser already has a UUID generator. Backend validates shape only.
- History fetched fresh per turn from Supabase rather than carried in client memory. Single source of truth, survives page reloads, supports server-side analytics later.
- 20-turn history window. ~10 user/assistant pairs. Token-budget management deferred to V1.2 when KB content arrives and total prompt size matters more.
- User message persisted BEFORE the API call so a crash mid-stream still preserves the user's input. History fetch returns the just-saved message as the last entry; server drops it before sending to API to avoid duplication via the explicit `userMessage` argument.
- Backend uses Supabase secret key (formerly service_role), bypasses RLS. RLS explicitly disabled on both tables — rationale documented in `schema.sql` header. Frontend never talks to Supabase directly.
- Token usage columns (`input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`) included on `messages` from V1.0-of-V1.1 to verify Build Standard #1 cache discipline. Cheaper to add now than migrate later.
- Used the existing `ChatbotIQ` Supabase project from prior session setup — region `ap-southeast-2` (Sydney). Backend remains in `us-west2`; cross-region database calls add ~150-200ms RTT, acceptable for testing. Region migration flagged for paying-client phase, not now.
- New Supabase secret API key system used (`sb_secret_...` format, named `chatbotiq_backend`) over the legacy `service_role` JWT. Anthropic-style key naming wasn't allowed (no hyphens), used underscores instead.
- Tag `v1.1` rotated from broken commit `bbd784a` to working commit `9273874` after rebuild. Tag deletion + re-creation is acceptable when the tag was never used as a rollback target — V1.0 was the only rollback target, untouched.

**Broken / recovered:**
Four broken deploys before the fifth landed. Sequence and root cause:

1. `bbd784a` (V1.1 — conversation memory in Supabase) — `server.js` imported `isStructuredError` from `./lib/errors.js`, no such export. Hotfixed.
2. `ced8678` (V1.1 hotfix — remove unused import) — `server.js` imported `routeStopReason`; the real export is `handleStopReason` with a different signature. Same class of mistake.
3. (untagged commit) — additional name mismatches (`validateAssistantText` vs real `validateStreamedResponse`).
4. (next push) — `import upunt from './config/upunt.js'` (default import); the real export is the named `upuntConfig`. Plus `CONFIG.system_prompt` referenced when CONFIG has no such field.

Root cause: D2 generated V1.1 against assumed V1.0 export shapes rather than reading the actual V1.0 lib files. Fix-forward strategy compounded the mistake — each broken deploy generated another broken deploy because the assumption error wasn't corrected.

Recovery: rolled back to V1.0 in Railway via Deployments → Redeploy on the original Session 17 deployment (4 days old). Production restored in ~30 seconds. Then forensically read V1.0 contracts via `git show v1.0:<path> | clip`, rebuilt three files (`anthropic.js`, `server.js`, `chat.js`) against the real V1.0 contract, pushed once, deployed clean.

**Lesson promoted to D2 master prompt for next session:** when extending an existing version, D2 must read the file being extended via the version tag before generating its replacement. `git show <tag>:<path>` is the verification command. This is not "Pattern 12 user-paste-beats-guess" applied to the user — it's that pattern applied to D2 reading prior versions of the codebase. Discipline failure was D2's, not Gareth's.

**Smoke test outcome (clean V1.1 deploy):**
- "Hello" → bot identifies itself with `deployment_name` and `domain` from CONFIG ✓
- "What did I just say?" → recalled "HELLO" verbatim — V1.1 memory confirmed ✓
- "Who won the 2025 Melbourne Cup?" → INSUFFICIENT DATA, cited the Melbourne Cup date logic ✓
- "Should I bet $500 on race 4?" → declined per `hard_guardrails`, redirected to user research ✓
- "Remember the question I asked first" → recalled both prior turns in order — history depth confirmed ✓
- "Tell me about harness racing" → INSUFFICIENT DATA citing thoroughbred-only domain ✓

Token usage progression confirmed history is being sent: turn 1 = 111 input tokens; later turn = 421 input tokens; turn 6 = 467 input tokens. Growth from 111 → 467 = system prompt + accumulating history.

`cache_read_input_tokens` = 0 on all turns. Expected. Anthropic ephemeral cache requires the cached block to exceed a minimum size (~1024 tokens) before caching engages. V1.0 system prompt is ~150 tokens. Cache machinery is wired correctly per Build Standard #1 (`cache_control: ephemeral` set on the system block); cache hits will start showing once V1.2 (KB content) or V1.5 (voice profile) push the system prompt past the threshold. Build Standard #1 is *architectural readiness* at V1.1.

Supabase `messages` table after smoke test: 12 rows (6 user + 6 assistant), all under single `session_id` `402d151a-8e4d-4239-b47d-...`, `stop_reason: end_turn` on every assistant row, RLS disabled badge visible.

**Build Standards check at V1.1:**
- #1 prompt caching — wired correctly, cache hits gated on system-prompt size threshold (V1.2+) ✓
- #2 structured error handling — extended to Supabase (`classifySupabaseError` in `lib/supabase.js`) ✓
- #3 response validation — unchanged from V1.0, still passes ✓
- #4 streaming on web chat — unchanged from V1.0, still works ✓
- #5 stop_reason router — `end_turn` on every test turn, no warnings logged ✓
- #6 pre-deployment checklist — 11/14 items pass, 3 deferred (cost estimate, hard-error path, external tester)

**Pattern check (from `StreamlineAI_Agent_Methodology_v1.md`):**
- Pattern 5 (CONFIG vs CODE) — clean. `config/upunt.js` unchanged from V1.0; engine extension lives in `lib/`, not in CONFIG.
- Pattern 14 (Stop-And-Ask) — used four times this session: external service (Supabase signup), data shape (schema), irreversibility (commit + push, twice). All produced explicit user approval before action.
- Pattern 15 (Build Journal Discipline) — entry being written now per protocol.
- Pattern 16 (Handback to D1) — three handbacks deferred to D1: ship V1.0 timing, Railway upgrade timing, `chatbotiq-prod` key creation. Carried forward from Session 1.

**Cost / spend state:**
- `chatbotiq-dev` API key: workspace cap $40/month unchanged. Smoke test plus four-broken-deploy-recovery-churn estimated <$0.50.
- Average input tokens per turn at V1.1: ~250 (across 6 turns). Output average: ~100. At Sonnet 4.5 pricing ($3/MTok input, $15/MTok output): per-100-messages estimate = $0.075 input + $0.150 output = ~$0.23 per 100 messages at current size. Will rise at V1.2 (KB) and V1.5 (voice profile expand system prompt).
- Railway: $5 trial unchanged. ~5 days of trial used; ~25 days remaining.
- Supabase: free tier, well under all limits (bytes used: KB-scale, well under 500MB cap).

**Security state:**
- New Supabase secret key `chatbotiq_backend` created with description "Railway backend — V1.1+". Default Supabase-generated `default` key untouched, flagged for tidy-up.
- `SUPABASE_URL` and `SUPABASE_SECRET_KEY` added to Railway env vars. Total Railway env vars now 4 user-set + 8 Railway-set.
- `.gitignore` continues to exclude `.env`. No secrets committed. Repo public.
- ALLOWED_ORIGIN unchanged (`https://streamlineai-chatbotiq.netlify.app`).

**Files changed at V1.1:**
- New: `backend/db/schema.sql`, `backend/lib/supabase.js`, `backend/lib/sessions.js`, `backend/.env.example`
- Modified: `backend/server.js`, `backend/lib/anthropic.js`, `backend/package.json`, `backend/package-lock.json`, `frontend/index.html`, `frontend/chat.js`, `frontend/style.css`, `README.md`
- Final working commit: `9273874`. Tag `v1.1` rotated to point here.

**Next:** Session 3 begins V1.2 — KB ingestion. Bot answers from stored knowledge.

Pre-V1.2 admin (D1 side):
- Decide on V1.0/V1.1 internal tester ship to Matty/Lingard (handback question #1, now applies to V1.1 as "ship V1.1 with memory or hold for V1.2 KB?")
- Tidy-up: delete unused `default` Supabase secret key after confirming nothing references it
- Open question: do we keep the V1.0-system-prompt size as-is, or expand it now to start exercising prompt caching? Opening for V1.2 scope discussion.

**Open questions for D1:**
- Same three carried from Session 1 (V1.0 ship timing, Railway upgrade timing, `chatbotiq-prod` key creation) — none resolved this session.
- New: do we increase Supabase Pro upgrade priority given cross-region latency, or leave at free tier through V1.4?
- New: methodology Pattern N candidate — "verify prior version's actual exports before extending". Specific case: D2 reading `git show v<tag>:<file>` before generating file replacements at V<tag+1>. Surfaces from this session's four-deploy churn. D1 to decide whether this lives in D2 master prompt only or promotes to methodology doc.

---
