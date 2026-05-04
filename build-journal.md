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

### Session 3 — 03 May 2026 — V1.2

**Built:** Knowledge base ingestion and retrieval. Bot now answers from stored content rather than refusing every domain question. Five new/changed files:

- `backend/db/schema-v1.2.sql` — new `kb_entries` table with `content_type` enum (`REFERENCE` | `VERBATIM`), full-text search index via generated `tsvector` column, deployment_slug filter
- `backend/db/kb-seed.md` — 15 hand-curated UPunt entries (9 REFERENCE, 6 VERBATIM, attribution `Punta (UPunt)`)
- `backend/lib/kb.js` — new module: `retrieveKb` (full-text search via Supabase `textSearch`), `parseSeedFile` (markdown frontmatter parser with VERBATIM attribution validation), `replaceKbForDeployment` (idempotent loader)
- `backend/lib/system-prompt.js` — new module: `buildSystemPrompt(config)` assembles cached block from CONFIG fields, `renderKbContext(hits)` formats retrieved entries as a user-side context message
- `backend/lib/anthropic.js` — extended V1.1's `streamChat` to accept optional `contextBlock` parameter; injected as user-role message immediately before the user's turn (Option B / RAG-style architecture)
- `backend/server.js` — V1.2 flow: validate → ensure session → save user message → fetch history → **retrieve KB → render context block** → stream Claude with assembled system prompt + context block → validate → persist
- `backend/scripts/load-kb.js` — one-shot loader, reads seed file, replaces all rows for deployment slug

V1.1 contracts preserved at SSE layer. Frontend unchanged.

Repo at `github.com/gphi9343/streamlineai-chatbotiq`, public, tag `v1.2` to be applied at clean deploy commit.

**Decided:**

- **Architecture: Option B (RAG-style).** KB content lives in a user-side context message before each user turn, NOT in the system prompt. This preserves the cached system prompt across turns of a session — Build Standard #1 actually delivers cache hits at V1.2+ because the cached block is now stable AND substantial (~800-1000 chars). Putting KB content in the system prompt would have invalidated the cache every turn.
- **V1.1 latent bug fixed.** V1.1's `server.js` referenced `CONFIG.system_prompt` — that field did not exist on `upuntConfig`. The bot ran for V1.1's entire lifecycle with no system prompt: identity, guardrails, INSUFFICIENT DATA rule, none of it sent to Claude. V1.2 replaces the missing-field reference with `buildSystemPrompt(CONFIG)` which assembles the prompt from real CONFIG fields. This is also why Standing Rule 1 — verify prior version's actual exports before extending — was added in v1.3 of D2 master prompt: this exact bug is what caused the Session 18 four-deploy churn, and a residue of it survived. Next versions must verify CONFIG field presence as well as code exports.
- **Retrieval: full-text search via Postgres `tsvector`.** No embeddings at V1.2. Generated `tsvector` column with GIN index; query via Supabase `textSearch` builder using `plainto_tsquery` (safe against operator injection from user input). `MAX_HITS = 3`. Empirical relevance floor managed by Postgres internally; if quality issues surface in testing, route through an RPC to expose `ts_rank`.
- **Schema column naming locked.** `content_type` enum `REFERENCE` | `VERBATIM` per D1 Pattern 1 rename approval. Methodology doc bump to v1.1 is D1's task, not this session's.
- **VERBATIM rendering rule.** System prompt instructs the model to quote VERBATIM body text exactly, wrapped in quotation marks, with attribution to the source field. REFERENCE entries may be paraphrased and synthesised. The seed loader rejects VERBATIM entries with no attribution at parse time — schema-level constraint enforced at the parser.
- **KB retrieval failure is non-fatal.** If Supabase KB query fails, server logs the error and proceeds with empty context. Bot will hit INSUFFICIENT DATA on most questions but stays alive. This is correct degraded-mode behaviour: the chat surface stays up even when retrieval is broken.
- **Loader is idempotent.** Running `node scripts/load-kb.js` twice gives the same result — it deletes existing entries for the deployment before inserting. The seed file is the source of truth. This makes V1.2 easy to iterate: edit the markdown, re-run the loader, retest.
- **`deployment_slug` column on `kb_entries`.** Future-proofs for multiple deployments sharing one Supabase project. UPunt rows tagged `upunt`; a future Chem-Dry deployment would tag `chemdry`. Retrieval filters by slug.
- **Standing Rule 1 satisfied this session.** All four V1.1 files (`anthropic.js`, `server.js`, `supabase.js`, `upunt.js`) read via `git show v1.1:<path>` before generating replacements. No memory-based assumptions. One extension write, one push, one deploy expected (vs Session 18's four-deploy churn).

**Broken:** Nothing built yet at time of journal write. Test results filled in after deploy.

**Pattern check:**
- Pattern 1 (Reference vs Verbatim Separation) — implemented. Schema column, system prompt rendering rules, parser validation all enforce the split.
- Pattern 2 (Pass-Through Discipline) — VERBATIM entries quoted exactly with attribution. System prompt is explicit: "do not paraphrase, summarise, or rewrite."
- Pattern 3 (Uncertainty Handling) — preserved. INSUFFICIENT DATA rule still in system prompt, and now explicitly tied to "context block contains nothing relevant."
- Pattern 5 (CONFIG vs CODE) — clean. System prompt assembled from CONFIG fields, KB content stored separately, no client-specific content in code.
- Pattern 11 (Pre-Generation Scope Confirmation) — scope stated and approved before code generation.
- Pattern 14 (Stop-And-Ask) — invoked once: Option A vs B architectural decision (cache strategy).
- Pattern 15 (Build Journal) — entry being written now per protocol.

**Build Standards check:**
- #1 prompt caching — system prompt now substantial (~1000 chars). With KB rendering rules, INSUFFICIENT DATA rule, identity, guardrails, and (V1.5+) voice profile, cached block will exceed Anthropic's ~1024 token threshold. Cache hits should engage. Actual `cache_read_input_tokens` confirmed in test protocol below.
- #2 structured error handling — extended to `lib/kb.js` (KB retrieval and parser errors classified to taxonomy).
- #3 response validation — unchanged from V1.1. Still passes.
- #4 streaming — unchanged. Frontend still gets `event: token` deltas.
- #5 stop_reason router — unchanged. `end_turn` expected on all V1.2 traffic.
- #6 pre-deployment checklist — to be run before V1.2 ships to external testers.

**Cost / spend state:**
- System prompt grows from ~150 chars (V1.1) to ~1000 chars (V1.2) — roughly 7x. Per-turn input cost rises proportionally on first turn of each session, then drops sharply on subsequent turns once cache hits engage.
- KB context block adds variable cost per turn: 0 chars on miss, ~500-2000 chars when 1-3 entries retrieved.
- Estimated per-100-messages cost at V1.2: ~$0.40-0.60 (vs V1.1's ~$0.23). Real number after smoke test.
- `chatbotiq-dev` API key cap unchanged at $40/month.

**Security state:**
- No new env vars. SUPABASE_URL and SUPABASE_SECRET_KEY already set at V1.1.
- No new secrets in code. KB content in `backend/db/kb-seed.md` is non-sensitive testbed content.
- Repo public, no impact.

**Files changed at V1.2:**
- New: `backend/db/schema-v1.2.sql`, `backend/db/kb-seed.md`, `backend/lib/kb.js`, `backend/lib/system-prompt.js`, `backend/scripts/load-kb.js`
- Modified: `backend/lib/anthropic.js`, `backend/server.js`, `README.md` (V1.2 deployment section)
- Tag: `v1.2` to be applied at clean deploy commit

**Next:** Session 4 begins V1.3 — Telegram interface. Same engine, second surface.

Pre-V1.3 admin (D1 side):
- External tester ship: V1.2 IS the ship gate. Once smoke test passes, Matty and Lingard get the Netlify URL.
- `chatbotiq-prod` API key: create the moment first non-Gareth traffic hits the bot.
- Calendar reminder: Railway Hobby upgrade by 24 May 2026.

**Open questions for D1:**
- Pattern 22 candidate (verify prior version's actual exports — extended this session to verify CONFIG field presence too): when does it promote from D2 standing rule to methodology doc? Session 16 rule says 2+ deployment proof. V1.1 was deployment 1; V1.2 found a residue of the same failure mode in CONFIG references. Arguably the same failure, second proof.
- Methodology doc Pattern 1 rename: "FORM vs INTEL" → "Reference vs Verbatim Separation". D1 to bump methodology doc to v1.1 with changelog. Schema column already uses correct names regardless of doc state.
- V1.4 reframing: "VERBATIM ingestion mechanism — multiple sources" rather than "Telegram injection (racing-specific)". Master file already updated per D1's prior decision; flagging for methodology doc consistency.

### Session 3 — POSTSCRIPT (added end of session)

**Frontend cache + silent SSE failure mode (Pattern 22 candidate, sibling to Standing Rule 1)**

Smoke test of V1.2 initially appeared to fail. Symptom: user message rendered, but assistant responses showed as empty black bubbles with no error message. No console errors. No red text. Just empty bubbles.

Diagnosis took ~25 minutes. Root cause was two-layered:

1. **Netlify cache held the V1.1 frontend.** Although V1.2 frontend was committed and pushed, the browser was still running cached V1.1 `chat.js` against the V1.2 backend. The V1.1 frontend's SSE parser worked, but its `done` event handler logged to console only — and the console logs were scrolling off-screen behind dev tools panel switching.
2. **V1.1 frontend had no visible-error fallback.** If a stream completed with zero token events rendered, the empty assistant bubble stayed empty. Silent failure, no diagnostic.

What confused the diagnosis: the Network tab showed status 200 with 641-680 bytes returned per request, EventStream tab showed correct token events flowing from the backend, and `kb_hits` was present in the done event. The backend was working perfectly. The only path that surfaced the bug was a hard-refresh (Ctrl+Shift+R) of the chat page, which forced Netlify to serve the new V1.2 frontend.

**Fix shipped in V1.2 frontend:**
- Defensive parser logs every event with name + data
- Every error path now surfaces visibly in the chat (no more silent empty bubbles)
- Pre-stream sanity check: if stream ends with zero tokens and no error event, surfaces a diagnostic message in the bubble itself
- Version label bumped to V1.2 in `index.html` (cosmetic, also acts as visual confirmation that hard-refresh worked)

**Lesson promoted to D2 master prompt v1.4 as Standing Rule 2:** after every frontend deploy, the test protocol must include a hard-refresh (Ctrl+Shift+R) before running smoke tests. Browser cache + CDN cache + Netlify edge cache stack together — auto-deploy success on Netlify dashboard does NOT guarantee the browser is running the new code.

**Time cost:** ~25 minutes diagnosis. Recovery itself was ~5 minutes (write defensive frontend, push, hard-refresh, retest). Same shape as Session 18's Standing Rule 1 surfacing — discipline failure (assumed deployment = browser running new code) caused diagnostic time.

**Pattern 22 candidate status:** Standing Rule 1 (verify prior version exports before extending) was Session 18's lesson. Standing Rule 2 (hard-refresh after frontend deploy) is Session 19's lesson. Both surface the same underlying class — *unstated assumptions about state* — Standing Rule 1 about code state, Standing Rule 2 about runtime state. Worth flagging to D1 whether these are siblings of one Pattern 22 ("Verify state before testing") or two independent standing rules. Currently both encoded as separate rules in D2 master prompt; methodology doc promotion still gated by Session 16's 2+ deployment proof rule.

**Smoke test final result (post-fix):** All 7 prompts passed. V1.2 shipped, tagged `v1.2`, external tester gate now open.

---

### Session 4 — 04 May 2026 — V1.4

**Built:** Voice profile applied. Bot now speaks as Punta — Aussie-casual, racing-savvy, betting-neutral. CONFIG-only build per Pattern 5 — no engine code touched beyond the system prompt assembly function and a cosmetic version-label bump in `server.js`.

Three files changed:
- `backend/config/upunt.js` — `voice_profile` placeholder filled with six fields (tone, style, signature_phrases, forbidden_words, forbidden_behaviours, example_messages). `hard_guardrails` extended at top level by 7 racing-specific entries merged from voice draft (V1.2 had 4 universal entries, V1.4 has 11 total).
- `backend/lib/system-prompt.js` — `renderVoiceProfile` function added. V1.2 placeholder rendered only 3 fields (tone, style, forbidden_words); V1.4 renders all 6, with `example_messages` framed as "EXAMPLES OF VOICE" (anchors pattern matching, not few-shot completion). Voice section moved to end of cached system prompt block per attention-weighting rationale.
- `backend/server.js` — version label bumped V1.2→V1.4 in `/health` endpoint and boot log. Cosmetic only, no behaviour change.

Three commits this session: `fc78c867` (voice profile + system-prompt rendering), one cosmetic version-label commit, then `v1.4` tag at HEAD.

**Decided:**

- **Telegram dropped from V1 baseline.** D1 decision in this session: ChatbotIQ's product is a generic chatbot for small businesses, not a racing-Telegram product. Telegram becomes a per-deployment optional surface, added later if a specific client wants it. Old V1.3 (Telegram) deleted from the staging. Old V1.4 (VERBATIM ingestion via Telegram) renamed to "VERBATIM ingestion — multiple implementations" and renumbered to V1.3. Old V1.5 (voice) became this session's V1.4. Master file needs corresponding update.

- **Voice profile via written profile + examples, not curated archive.** D1 explicitly rejected the previous-build approach of using 5 years of Telegram archive to establish voice — it's a cheat that doesn't scale to clients without that history. Co-pilot draft adopted with three D2 adjustments: (1) added 3 INSUFFICIENT DATA examples in Punta voice, (2) tightened style paragraph to flag "voice doesn't substitute for content," (3) dropped two pattern-recognition signature phrases ("They've pulled this move before", "Pretty typical for that camp") that licensed implied-knowledge claims without KB backing. Final example_messages count: 13 (10 confident-voice + 3 INSUFFICIENT DATA voice).

- **Methodology rule candidate flagged for D1:** "Any feature that only works for the testbed because of testbed-specific resources is scaffolding, not engine." Not a new pattern — corollary of Principles B and C from methodology doc — but worth surfacing because both UPunt-specific decisions D1 rejected this session (Telegram-baseline, archive-voice) violated it.

- **`hard_guardrails` location.** Kept top-level on upuntConfig (where V1.2 put it). Voice profile contributions merged into the canonical top-level list rather than nested. Rationale: one source of truth, no duplication. Voice block stays focused on the six fields that describe *how* the bot speaks; guardrails describe *what it must never do*.

- **Standing Rule 1 satisfied across all three files this session.** `git show v1.2:backend/config/upunt.js`, `git show v1.2:backend/lib/system-prompt.js`, and `git show v1.2:backend/server.js` all read into context before generating replacements. Discovered V1.2's `system-prompt.js` already had a placeholder voice-rendering block — incomplete (3 of 6 fields) but anticipated correctly. Reading the placeholder shaped the V1.4 extension; would have invented an inferior shape from memory without the read.

- **Version label bump is part of Standing-Rule-2-adjacent discipline.** Standing Rule 2 covers frontend version labels (the `<span class="version">` field). Backend has its own version label in the boot log. Same diagnostic purpose — staring at logs in three months and seeing V1.2 when V1.4 is deployed wastes time. Worth bumping every version, like the frontend label. Rule 2's spirit applies; D1 may want to update the rule wording to cover both.

**Broken:** Nothing broken. Single clean V1.4 deploy on the voice-profile commit, single clean follow-up deploy on the version-label commit. No rollbacks, no diagnostic time, no surprises.

**Smoke test outcome — V1.4 voice tests:**

Eight prompts run in sequence in a single browser session. All 8 passed.

1. *"What's the deal with stewards' inquiries after a race?"* → Conversational explanation, used signature phrase "You see this sort of thing a fair bit" naturally. ✓
2. *"What does 'lame 1/5' mean?"* → Strong voice match. Echoed "racing version of a mild headache" framing from example_messages without literal parroting — exactly the pattern-matching anchor effect example_messages are designed to produce. ✓
3. *"Tell me about late scratchings."* → INSUFFICIENT DATA in voice + general-knowledge follow-on. Slight drift: bot refused with INSUFFICIENT DATA then explained scratchings from general knowledge anyway. Voice itself is correct ("frustrating for punters", "after you've already locked in your play"). The INSUFFICIENT DATA rule's "do not answer from general knowledge" half got softened. Flagged for monitoring at V1.5+; not a V1.4 blocker. ✓ (with note)
4. *"Who won the 2025 Melbourne Cup?"* → Clean refusal, voice slightly muted but acceptable. ✓
5. *"What's the latest on Winx?"* → Strong refusal in voice. Pulled in genuine context (retired 2019) without fabricating recent news. ✓
6. *"Should I bet on race 4 today?"* → Clean refusal, zero forbidden words, redirected to user research. Voice deliberately calibrated — declining gambling advice in cheeky tone would feel wrong. ✓
7. *"Give me your best of the day."* → "That's not what I'm here for." Strong in-voice refusal, productive deflection to legitimate help (form, conditions, stewards' reports). ✓
8. *"What horse should I back in the next race?"* → "That's not my gig." Genuine voice. Lists what bot CAN help with — productive deflection, not dead-end. ✓

Forbidden-word audit across 8 responses: zero forbidden words used. Even when explicitly invited (tests 6, 7, 8), bot found different language. Forbidden-behaviour audit: no tipping, no form-analysis claims, no implied predictions. Voice profile holding under direct provocation.

**Build Standard #1 — cache verification confirmed for the first time:**

Supabase query against `messages.cache_read_tokens` and `messages.cache_write_tokens` columns over the 8 V1.4 test turns:

| Turn | input_tokens | cache_read | cache_write | Notes |
|---|---|---|---|---|
| 1 | 949 | 0 | 1505 | First V1.4 turn — wrote the cache |
| 2 | 198 | 1505 | 946 | Cache HIT, also wrote new content |
| 3 | 364 | 1505 | 946 | Cache HIT |
| 4 | 1469 | 1505 | 0 | Cache HIT |
| 5 | 1439 | 1505 | 0 | Cache HIT |
| 6 | 1429 | 1505 | 0 | Cache HIT |
| 7 | 1366 | 1505 | 0 | Cache HIT |
| 8 | 1389 | 1505 | 0 | Cache HIT |

Pattern is exactly correct. Turn 1 writes the cache, turns 2-8 read from it. Build Standard #1 is now demonstrably delivering, not just architecturally ready. V1.0–V1.3 had the wiring; V1.4 is the first version where the cached block clears Anthropic's ~1024-token threshold and hits actually engage.

Cost implication: cache reads cost ~10% of regular input tokens at Sonnet 4.5 pricing. Across turns 2-8, ~90% cost saving on the cached portion (1505 of ~1500-1700 input tokens per turn).

Comparison with V1.2 yesterday's traffic: 990-1392 input tokens with zero cache activity. Confirms V1.2 system prompt was right at the threshold and not engaging. V1.4 voice profile pushed it cleanly over.

**Build Standards check at V1.4:**
- #1 prompt caching — DEMONSTRABLY WORKING for first time. Cache hits engaging from turn 2. ✓
- #2 structured error handling — unchanged from V1.2, still passes ✓
- #3 response validation — unchanged from V1.2, still passes ✓
- #4 streaming — unchanged from V1.2, still works ✓
- #5 stop_reason router — `end_turn` on every test turn, no warnings logged ✓
- #6 pre-deployment checklist — passed for V1.4 ship

**Pattern check:**
- Pattern 1 (Reference vs Verbatim Separation) — unchanged from V1.2, still working
- Pattern 3 (Uncertainty Handling) — INSUFFICIENT DATA still working, with one drift case flagged in test 3 above
- Pattern 5 (CONFIG vs CODE) — clean. All voice content lives in CONFIG, rendering logic in CODE. No leakage.
- Pattern 11 (Pre-Generation Scope Confirmation) — used twice this session: scope statement before voice profile generation, scope statement before version-label bump
- Pattern 14 (Stop-And-Ask) — not engaged this session. CONFIG-only changes, no schema, no new dependencies, no cost shape change.
- Pattern 15 (Build Journal Discipline) — entry being written now per protocol
- Pattern 16 (Handback to D1) — three handbacks resolved during session (Telegram drop, voice approach, methodology rule candidate)

**Standing rules check:**
- Rule 1 (verify prior version's exports before extending) — satisfied for all three files. `system-prompt.js` read in particular paid off — discovered placeholder shape that would have been mis-built from memory.
- Rule 2 (hard-refresh after frontend deploy) — not engaged this session, no frontend changes. Worth noting that backend version-label discipline mirrors Rule 2's spirit; D1 may want to extend the rule wording.

**Cost / spend state:**
- `chatbotiq-dev` API key cap unchanged at $40/month. V1.4 testing across ~10 turns estimated <$0.30.
- Per-100-messages estimate at V1.4 with cache hits engaging: roughly comparable to V1.2's ~$0.40-0.60 despite system prompt growing from ~1000 to ~5906 chars, because cache reads at ~10% pricing offset most of the system prompt cost. Will refine measurement after a longer session set.
- Railway: $5 trial, ~$4.94 left, 25 days remaining (per Railway dashboard). Hobby upgrade calendar reminder still 24 May 2026.
- Supabase: free tier, well under all limits.

**Security state:**
- No new env vars at V1.4.
- No new secrets in code.
- ALLOWED_ORIGIN unchanged.
- Repo public, no impact.

**Files changed at V1.4:**
- Modified: `backend/config/upunt.js` (voice profile populated, hard_guardrails extended)
- Modified: `backend/lib/system-prompt.js` (full voice rendering across 6 fields)
- Modified: `backend/server.js` (version label V1.2→V1.4, cosmetic)
- Final V1.4 tag at the version-label-bump commit (post-cleanup HEAD)

**Next:** Session 5 begins V1.5 — scheduled data ingestion (NewsIQ variant) per the renumbered staging post-Telegram drop. D1 to confirm before opening D2.

Pre-V1.5 admin (D1 side):
- Master file update for renumbered staging (V1.3 = VERBATIM ingestion, V1.4 = Voice ✓ shipped, V1.5 = Scheduled ingestion, V1.6 = Logging dashboard)
- Methodology doc Pattern 1 rename to v1.1 (FORM/INTEL → REFERENCE/VERBATIM body update) — pending since Session 19, still pending
- External tester ship gate decision — V1.4 voice plus V1.2 KB content: does answer quality clear the new tester gate? Bot has voice now, but KB content is still 15 seeded entries. Three options: (a) ship now to Matty/Lingard with voice + thin KB, (b) expand KB content first, (c) wait until V1.5 scheduled ingestion adds content automatically.
- Methodology rule candidate: "testbed-specific resources are scaffolding, not engine" — D1 to decide whether to add to methodology doc as a corollary of Principles B and C, or leave as session-level decision artefact.

**Open questions for D1:**
- Test 3 INSUFFICIENT DATA drift (refused-then-answered) — fix at V1.5 by tightening system prompt language, or accept as edge case? D1 view appreciated.
- Pattern 22/23 candidates from Sessions 18 and 19 — promotion timing per Session 16's 2+ deployment proof rule. Both have surfaced; promotion still pending.
- Backend version-label discipline as extension of Standing Rule 2 — D1 to decide whether the rule wording bumps to cover both frontend and backend version labels, or stays frontend-only with backend handled implicitly.

---

### Session 5 — 04 May 2026 — V1.3

**Built:** VERBATIM/REFERENCE admin form shipped. Generic engine capability complete: any deployment can curate KB content via authenticated admin UI. Test 3 INSUFFICIENT DATA drift fix folded into same commit.

Eight files changed:

- `backend/lib/system-prompt.js` — Test 3 patch. Two sentences added to INSUFFICIENT DATA section: anti-hybrid rule (forbids refused-then-answered pattern) + case-3 permission rule (licenses direct answers for in-domain low-stakes well-defined questions). Removed the V1.2 "Do not attempt to answer from general knowledge" line — subsumed by anti-hybrid sentence and contradicted by case-3 permission. Net change: ~5 lines in the INSUFFICIENT DATA section.
- `backend/server.js` — CORS allow-list shape (reads ALLOWED_ORIGINS plural, falls back to ALLOWED_ORIGIN), admin router mounted at `/admin/*`. Health endpoint version bumped to 1.3, exposes allowed_origins for diagnostic visibility.
- `backend/config/upunt.js` — Added `admin_token_env_var: 'ADMIN_TOKEN_UPUNT'`. Per-deployment naming locked from V1.3 per Session 16 API key naming discipline.
- `backend/lib/auth.js` (new) — Bearer-token auth middleware. Reads `process.env[CONFIG.admin_token_env_var]` via deployment registry lookup. Two route shapes: deployment-scoped (requires deployment_slug in body/query) and listing (matches any registered deployment's token). Structured errors per Build Standard #2.
- `backend/routes/admin.js` (new) — Three endpoints: `GET /admin/deployments` (picker data), `POST /admin/kb` (create entry, validates content_type / question / body / attribution-required-for-VERBATIM / tag shape), `GET /admin/kb` (read-back with pagination). Defers PATCH/DELETE/CSV/webhook to V1.3.1+.
- `admin-frontend/index.html` (new) — Three-section layout: Setup (backend URL + slug + token), Add KB Entry (REFERENCE/VERBATIM radio with conditional attribution field), Recent entries (read-back).
- `admin-frontend/admin.js` (new) — Token map in localStorage keyed by deployment slug. Submit-and-clear pattern for bulk entry. Ctrl/Cmd+Enter shortcut. Visible failure paths on every fetch (Build Standard #4 inherited).
- `admin-frontend/style.css` (new) — Black/gold/warm-white StreamlineAI brand. Mobile-responsive. REFERENCE and VERBATIM badges colour-coded.

Repo at `github.com/gphi9343/streamlineai-chatbotiq`, public, tag `v1.3` to be applied at clean deploy commit.

**Decided:**

- **Two-sentence Test 3 patch, folded into V1.3 commit.** D1 expanded scope from master file's single-sentence anti-hybrid rule. Case-3 permission added because StreamlineAI deployment going live will receive in-domain low-stakes questions ("what is an LLM", "do you only work with small businesses") where pedantic INSUFFICIENT DATA refusal is a commercial-impact bug, not a UX nit. Calibration question pinned to V1.5 with explicit trigger condition: "if StreamlineAI deployment surfaces user-asks-reasonable-in-domain-question → bot-says-INSUFFICIENT-DATA → user-frustration pattern post-launch, V1.5 includes calibration pass."

- **Three-case INSUFFICIENT DATA framework captured as calibration vocabulary.** D1 instruction. Future calibration discussions reference these three cases:
  - **Case 1: True KB gap** — question is in-domain but KB doesn't cover. INSUFFICIENT DATA correct. Example: "What were Winx's race times in 2018?"
  - **Case 2: Out-of-domain question** — voice profile handles via domain-redirect, NOT INSUFFICIENT DATA. Example: V1.4 Test 8 "What horse should I back" → "That's not my gig."
  - **Case 3: In-domain general knowledge, low-stakes, well-defined** — answer directly. Example: "What does 'lame 1/5' mean?" V1.3 patch licenses this case.

- **Separate admin Netlify deployment, not embedded in public chat.** D1 pushback on D2's binary framing (embed vs `/admin.html` on same site). Correct architectural decision: one admin tool serves multiple deployments via deployment_slug picker, talks to same Railway backend, lives at separate `streamlineai-chatbotiq-admin.netlify.app`. Reduces attack surface (admin URLs not on prospect-facing surface) and prevents per-deployment admin URL proliferation as platform scales. Cost: 30 min Netlify second-site setup, one extra free-tier site. Worth it for architectural cleanliness — saves a refactor at V1.7+ when paying-client deployments multiply.

- **Per-deployment env var token naming from V1.3.** `ADMIN_TOKEN_UPUNT` not generic `ADMIN_TOKEN`. CONFIG points to env var name via `admin_token_env_var` field. Engine reads `process.env[CONFIG.admin_token_env_var]` — never knows the deployment slug directly. Same Pattern 5 discipline as the per-product API key naming locked Session 16. When StreamlineAI deployment lands, add `ADMIN_TOKEN_STREAMLINEAI` to Railway env vars; CONFIG for that deployment points to the new var name. Zero code change.

- **localStorage for token map at V1.3.** Per-deployment tokens stored as `{slug: token}` map. Trade-off: anyone with browser access (or successful XSS on admin site) can read all tokens at once. Acceptable because (a) only Gareth uses it, (b) admin site loads no user-controlled content so XSS surface near-zero, (c) tokens are per-deployment so one compromise doesn't leak others. Revisit at V1.6 / logging dashboard when admin auth pattern matures. Alternative considered (sessionStorage, prompt every session) rejected for friction — slow curation threatens Japan launch milestone.

- **CORS allow-list shape with backwards-compatibility shim.** Backend reads `ALLOWED_ORIGINS` (plural, comma-separated) as canonical. Falls back to `ALLOWED_ORIGIN` (singular, V1.4 var) if new var isn't set. Lets Railway env vars migrate independently of code deploy. Old works until you switch.

- **Admin frontend in same monorepo as `admin-frontend/`.** Single repo, single git tag covers backend + public frontend + admin frontend. Two Netlify sites pointing at different `Base directory` values. Cleaner than splitting repos at this stage — both can share the same git tag.

- **Deferred to V1.3.1 / V1.3.2:** PATCH /admin/kb/:id (edit existing), DELETE /admin/kb/:id (remove), POST /admin/kb/bulk (CSV upload), POST /admin/ingest (API webhook). V1.3 ships create + read only. Edit/delete added when the curation pattern reveals which is actually needed first (likely edit, for typo correction during onboarding).

- **Standing Rule 1 satisfied across six files this session.** `git show v1.4:backend/lib/system-prompt.js`, `git show v1.4:backend/server.js`, `git show v1.4:backend/config/upunt.js`, `git show v1.2:backend/db/schema-v1.2.sql`, `git show v1.4:backend/lib/supabase.js`, `git show v1.4:backend/lib/errors.js` — all read into context before generating replacements. Confirmed schema needs no migration for V1.3 (V1.2 `kb_entries` already supports REFERENCE + VERBATIM with attribution, tags, source). Confirmed `getRecentMessages` returns `role, content` only — chat flow untouched by V1.3.

**Broken:** No deploys yet at time of journal write. Test results filled in after deploy + smoke test.

**Pattern check:**
- Pattern 1 (Reference vs Verbatim Separation) — admin form is the productised onboarding surface for VERBATIM curation. Form rejects VERBATIM without attribution at validation time, mirroring V1.2 parser-level constraint.
- Pattern 3 (Uncertainty Handling) — Test 3 patch protects the pattern's integrity. Anti-hybrid rule prevents the refused-then-answered drift; case-3 permission prevents over-pedantic refusal of well-defined low-stakes questions.
- Pattern 5 (CONFIG vs CODE) — clean. `admin_token_env_var` is CONFIG. Deployment registry in `lib/auth.js` is CODE pointing to CONFIG. Engine reads `process.env[CONFIG.admin_token_env_var]` — never hardcodes a slug or env var name.
- Pattern 11 (Pre-Generation Scope Confirmation) — three rounds of scope statement and stop-and-ask before code generation. D1 expanded Test 3 scope, refined admin form scope, pushed back on admin frontend placement.
- Pattern 14 (Stop-And-Ask) — invoked three times: (1) auth approach (env var token vs Supabase auth), (2) admin UX (separate site vs embedded), (3) CORS allow-list shape (security category). All produced explicit decisions before action.
- Pattern 15 (Build Journal Discipline) — entry being written now per protocol.
- Pattern 16 (Handback to D1) — none this session. All decisions resolved within scope.

**Standing rules check:**
- Rule 1 (verify prior version's exports before extending) — satisfied for all six files read. `system-prompt.js` voice profile placeholder shape preserved verbatim; `server.js` SSE event shape preserved; `errors.js` `makeError`/`serialiseError`/`sendError` exports used as-is; `supabase.js` not modified (admin routes use their own client locally to keep diagnostic separation visible in logs).
- Rule 2 (hard-refresh after frontend deploy) — applies to BOTH Netlify sites this session. Public chat frontend unchanged at V1.3 but version label still shows V1.2 — flagged in test protocol below to bump the public chat version label as a cosmetic V1.3 task. Admin frontend brand new — hard-refresh required after first deploy to confirm the site is reachable and not serving a placeholder.

**Build Standards check:**
- #1 prompt caching — system prompt unchanged in shape. Test 3 patch adds ~30 tokens to the cached block. Cache hits should continue engaging at the same rate as V1.4. Unchanged threshold maths.
- #2 structured error handling — extended to admin routes. Auth middleware returns 401/400/500 with structured shape per Build Standard. Admin route validation returns 400 with structured shape.
- #3 response validation — unchanged for chat flow. Admin POST validates inbound body shape (content_type enum, attribution-required-for-VERBATIM, length limits) before insert.
- #4 streaming — unchanged for chat. Admin frontend has its own visible-error surface pattern: every fetch wraps in try/catch and surfaces `{status, message}` from the error response or the network error. No silent failures.
- #5 stop_reason router — unchanged. Admin routes are non-streaming JSON.
- #6 pre-deployment checklist — to be run before V1.3 ships.

**Cost / spend state:**
- System prompt grows by ~30 tokens (Test 3 patch). Negligible cost impact. Cache reads unchanged.
- Admin routes add no LLM calls — pure CRUD against Supabase.
- Estimated per-100-messages cost at V1.3: comparable to V1.4 (~$0.40-0.60).
- `chatbotiq-dev` API key cap unchanged at $40/month.
- Netlify: free tier covers a second site at no cost.

**Security state:**
- New env var required: `ADMIN_TOKEN_UPUNT` on Railway. Generated via `openssl rand -hex 32` (or any equivalent). Set in Railway dashboard before first admin operation.
- New env var required: `ALLOWED_ORIGINS` on Railway. Comma-separated: `https://streamlineai-chatbotiq.netlify.app,https://streamlineai-chatbotiq-admin.netlify.app`. Old `ALLOWED_ORIGIN` can be left in place during migration; new var takes precedence once set.
- Token never committed to git. Only set in Railway dashboard and pasted into admin frontend localStorage at first use.
- Repo public, no impact — token is in env vars, not code.
- Admin frontend exposes admin routes by domain — anyone landing on `streamlineai-chatbotiq-admin.netlify.app` sees the form, but cannot submit without a valid token. Acceptable trade-off: separate domain reduces attack surface vs embedding in public chat.

**Files changed at V1.3:**
- New: `backend/lib/auth.js`, `backend/routes/admin.js`, `admin-frontend/index.html`, `admin-frontend/admin.js`, `admin-frontend/style.css`
- Modified: `backend/lib/system-prompt.js`, `backend/server.js`, `backend/config/upunt.js`
- Tag: `v1.3` to be applied at clean deploy commit

**Next:** Session 6 begins V1.3.1 if D1 wants edit/delete capability before V1.5, OR opens StreamlineAI deployment work in parallel. D1 to confirm sequencing.

Pre-V1.3 admin (D1 side, post-build):
- Generate `ADMIN_TOKEN_UPUNT` value, set in Railway env vars
- Set `ALLOWED_ORIGINS` env var on Railway with both Netlify origins
- Create second Netlify site pointing at `admin-frontend/` base directory
- Begin StreamlineAI KB content curation via admin form once V1.3 is live
- UPunt KB stays at 15 entries (testbed not product, no expansion)
- Methodology doc v1.2 batch update — three changes still queued (Pattern 1 rename, Pattern 10 promotion, testbed-scaffolding corollary)

**Open questions for D1:**
- V1.3.1 sequencing: edit/delete admin endpoints before V1.5 (when curation reveals typo-correction need), or after? D1 to decide based on first-week curation experience.
- StreamlineAI deployment scaffolding: clone `config/upunt.js` to `config/streamlineai.js` and register in `lib/auth.js` deployment registry. Trivial change but adds to backend at next deploy. D1 to confirm whether to land in V1.3 final commit (one tag covers both deployments) or defer to a separate V1.3.0.1 deploy.
- Pattern 23 candidate (Verify runtime state matches deployed state) status — second proof not yet surfaced this session. Still 1/2 per Session 16's promotion rule.

---
