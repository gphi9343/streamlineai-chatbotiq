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
### Session 5 — V1.3.1 PATCH (04 May 2026)

**Built:** Single-sentence calibration patch to INSUFFICIENT DATA rule. Backend version label bumped V1.3 → V1.3.1.

Two files changed:
- `backend/lib/system-prompt.js` — one sentence added between V1.3's anti-hybrid rule and case-3 permission rule. New rule makes refusal a turn-level commitment, not a sentence-level one: "If you say INSUFFICIENT DATA in a turn, the entire turn is a refusal — do not provide explanatory content from general knowledge in the same turn, even if the topic seems well-defined."
- `backend/server.js` — version label `1.3` → `1.3.1` in `/health` endpoint and boot log. No functional code changes.

**Decided:**

- **Patch ships as V1.3.1, not deferred to V1.5.** D1 path B over path A. V1.5's calibration trigger ("if StreamlineAI deployment surfaces user-asks-reasonable-in-domain-question → bot-says-INSUFFICIENT-DATA → user-frustration pattern post-launch, V1.5 includes calibration pass") was written when we hadn't yet seen the pattern. Test 9 of V1.3 smoke testing surfaced the pattern pre-launch — the trigger condition is met by testbed evidence, not just post-launch evidence. The calibration deferral was a "fix when we have evidence" rule, not a "fix only post-launch" rule. Pre-launch evidence still counts.

- **Rule-precedence ambiguity diagnosed.** V1.3 had two rules that could collide on questions like "Tell me about late scratchings": (1) the anti-hybrid rule ("don't answer from general knowledge in the same turn") and (2) the case-3 permission rule ("if in-domain and well-defined, answer directly"). When both applied ambiguously, the model favoured the permissive rule (case-3) over the restrictive rule (anti-hybrid). The V1.3.1 fix reframes anti-hybrid as a turn-level commitment that takes precedence once INSUFFICIENT DATA fires. Case-3 only applies when INSUFFICIENT DATA was NOT warranted in the first place — they cannot collide on the same turn.

- **Sentence placement: between anti-hybrid and case-3.** Ordering matters for model attention. The new sentence sits immediately after the original anti-hybrid line and before case-3 permission, reading as: rule → reinforcement → exception clause. Same ordering principle as the V1.4 voice profile placement at end of cached block: the most recent rule the model reads dominates ambiguous interpretation.

- **Standing Rule 1 satisfied.** `git show v1.3:backend/lib/system-prompt.js` and `git show v1.3:backend/server.js` both read into context before generating replacements. No memory-based assumptions.

- **Backend version label bump per Standing Rule 2 spirit.** Frontend version label discipline (Rule 2) extends to backend per Session 20 D1 decision. V1.3.1 backend will report version `1.3.1` in `/health`, distinguishing logs and diagnostic state from V1.3.

**Smoke retest (V1.3.1):**

The same three Test 9 prompts from V1.3 smoke testing, run again post-deploy. Pass criteria: Test 1 unchanged (case-3 still working), Test 2 now refuses cleanly (no follow-on explanation), Test 3 unchanged (Case 1 still working).

[Test results filled in after deploy.]

**Pattern check:**
- Pattern 3 (Uncertainty Handling) — full integrity restored. Anti-hybrid rule now has unambiguous precedence over case-3 when INSUFFICIENT DATA fires. Case-3 permission preserved for questions that don't trigger INSUFFICIENT DATA in the first place.
- Pattern 5 (CONFIG vs CODE) — clean. CONFIG-only patch (system prompt content). CODE only touched for the version label.
- Pattern 11 (Pre-Generation Scope Confirmation) — used: scope statement + path A vs path B decision before code generation.
- Pattern 15 (Build Journal Discipline) — entry being written as a V1.3.1 patch postscript to Session 5, per protocol-permitted shape (Postscripts to existing entries are permitted when end-of-session diagnosis surfaces lessons that belong with the entry).

**Standing rules check:**
- Rule 1 satisfied for both files.
- Rule 2 spirit satisfied: backend version label bumped to match the prompt change. Frontend unchanged this patch (no frontend code changed) — public chat label still V1.2 (cosmetic V1.3+ bump remains a Session 6 task).

**Build Standards check:**
- #1 prompt caching — system prompt grew by ~150 chars (the new sentence). Cache hits still engage from turn 2; one additional turn 1 cache write to absorb the new content. Cache machinery unchanged.
- All other Build Standards unchanged from V1.3.

**Cost / spend state:**
- System prompt grows ~150 chars. Negligible cost impact.
- `chatbotiq-dev` API key cap unchanged at $40/month.

**Files changed at V1.3.1:**
- Modified: `backend/lib/system-prompt.js`, `backend/server.js`
- Tag: `v1.3.1` to be applied at clean deploy commit

**Next:** Session 6 begins V1.3.2 (admin form edit/delete capability) OR StreamlineAI deployment scaffolding, per D1 sequencing decision. V1.3.1 is a calibration patch within the V1.3 capability envelope, not a new capability — so the V1.3.1 ship doesn't change what comes next.

**Open questions for D1 (carried forward from Session 5 V1.3):**
- V1.3.2 (edit/delete admin endpoints) sequencing
- StreamlineAI deployment scaffolding sequencing
- Pattern 23 candidate promotion timing — still 1/2 proofs

---
### Session 5 — V1.3.2 PATCH (04 May 2026)

**Built:** Case-3 scope tightening. Replaces V1.3.1's permissive "well-defined factual answer" wording with concrete scope: "terminology, definitions, or concepts." Backend version label V1.3.1 → V1.3.2.

Two files changed:
- `backend/lib/system-prompt.js` — V1.3.1's case-3 sentence replaced by a longer, scope-explicit version. New wording lists what case-3 covers ("what does X mean", "what is X", terminology and named-concept definitions) AND what it explicitly does NOT cover (procedures, processes, current events, specific cases, operational details, "tell me about X" framings).
- `backend/server.js` — version label `1.3.1` → `1.3.2` in `/health` endpoint and boot log. No functional code changes.

**Decided:**

- **V1.3.1 was diagnosed as the wrong fix shape.** V1.3.1 added a turn-level refusal sentence ("if you say INSUFFICIENT DATA, the entire turn is a refusal"). The sentence itself was correct, but it didn't address the actual failure mode — which wasn't refusal-then-explain (the V1.3 drift), it was case-3 swallowing the question entirely so INSUFFICIENT DATA never fired in the first place.

  V1.3 smoke test result: "INSUFFICIENT DATA — I don't have specifics. What I can tell you is..." (refusal + explanation, transparent imperfection)

  V1.3.1 smoke test result: "Late scratchings are one of those annoying parts of racing..." (200 words of training-data prose, no INSUFFICIENT DATA flag at all, less transparent than V1.3)

  V1.3.1 made things worse because the model resolved the rule conflict by skipping INSUFFICIENT DATA entirely — case-3's permissive scope ("well-defined factual answer") covered "late scratchings" too easily. The model reasoned its way into "this is well-defined, case-3 says answer directly" without ever invoking INSUFFICIENT DATA where the V1.3.1 turn-level rule could bite.

- **V1.3.2 fix shape: tighten the permissive rule, not the restrictive rule.** Case-3 was too vague. Replaced with concrete scope: terminology and named-concept definitions only. Procedural questions, "tell me about X" framings, current events, specific cases — all explicitly excluded. The new wording lists examples of what's IN scope ("what does 'lame 1/5' mean", "what is a barrier draw") and what's OUT of scope (procedures, operational details).

- **Pattern 24 candidate flagged: "Permissive rules require concrete scope."** Vague scope on permissive rules ("well-defined factual answer") gets read liberally by models. Concrete scope ("terminology, definitions, or concepts" with explicit exclusion examples) keeps models constrained. Provisional pattern. Promotion deferred until same shape confirmed in second deployment per Session 16's 2+ proof rule. Surfaced this session via V1.3 → V1.3.1 → V1.3.2 iteration. Logged in master file methodology section as candidate.

- **Standing Rule 1 satisfied.** `git show v1.3.1:backend/lib/system-prompt.js` and `git show v1.3.1:backend/server.js` both read into context before generating V1.3.2 replacements. No memory-based assumptions on either file's content.

- **Cache stability check.** V1.3.2 system prompt grows by ~280 chars vs V1.3.1's ~150 char addition (case-3 sentence is now longer due to explicit scope and exclusion examples). Cache hits will engage from turn 2 unchanged. Build Standard #1 unaffected.

- **V1.5 calibration trigger remains live.** This is the second iteration of pre-launch calibration in one session. The V1.5 deferral language in master file ("if StreamlineAI deployment surfaces user-frustration pattern post-launch") is now explicitly being treated as "if testbed evidence surfaces the pattern, calibrate now." Worth flagging in master file update at session end: rephrase the V1.5 trigger to "if any deployment (testbed or paying-client) surfaces a calibration drift, V1.5 includes a calibration pass." Trigger condition is evidence-based, not phase-based.

**Smoke retest (V1.3.2):**

The same three Test 9 prompts. Critical: must run in a fresh private/incognito browser session to bypass cache (this was the V1.3.1 diagnostic finding — non-incognito test was running against stale state). Pass criteria:

1. Test 1 ("What does 'lame 1/5' mean?") — direct in-voice answer, NO INSUFFICIENT DATA. Case-3 narrow scope still covers terminology questions.
2. Test 2 ("Tell me about late scratchings") — INSUFFICIENT DATA in voice, NO follow-on explanation. "Tell me about" is procedural framing, explicitly excluded from V1.3.2's case-3 scope.
3. Test 3 ("Who won the 2025 Melbourne Cup?") — INSUFFICIENT DATA in voice. Case 1 unchanged.

[Test results filled in after deploy.]

**Pattern check:**
- Pattern 3 (Uncertainty Handling) — calibrating toward correct shape. V1.3 was transparent-but-hybrid (refuse + explain). V1.3.1 was opaque-but-pure (skip refusal entirely). V1.3.2 should be transparent-and-pure (refuse for procedural questions, answer terminology questions directly).
- Pattern 5 (CONFIG vs CODE) — clean. Only system prompt content + version label changed.
- Pattern 11 (Pre-Generation Scope Confirmation) — D1 selected option B (tighten case-3) over A (rollback to V1.3) and C (remove case-3 entirely). Reasoning captured at the time.

**Build Standards check:**
- #1 prompt caching — system prompt grew by ~280 chars from V1.3.1. Cache key changes. Cache machinery unchanged.
- All other Build Standards unchanged from V1.3.1.

**Cost / spend state:**
- System prompt grows ~280 chars. Negligible cost impact.
- `chatbotiq-dev` API key cap unchanged at $40/month.
- Three V1.3.x deploys today (V1.3, V1.3.1, V1.3.2) plus smoke tests. Estimated cumulative spend <$1.

**Files changed at V1.3.2:**
- Modified: `backend/lib/system-prompt.js`, `backend/server.js`
- Tag: `v1.3.2` to be applied at clean deploy commit

**Next:** Session 6 begins V1.3.3 (admin form edit/delete capability) OR StreamlineAI deployment scaffolding, per D1 sequencing decision. V1.3.2 is calibration only, no capability change.

**Open questions for D1 (carried forward):**
- V1.3.3 sequencing: edit/delete admin endpoints
- StreamlineAI deployment scaffolding sequencing
- Pattern 23 candidate promotion timing — still 1/2 proofs
- Pattern 24 candidate ("Permissive rules require concrete scope") — first proof surfaced this session, second proof needed for promotion
- Master file V1.5 calibration trigger rephrasing — D1 task at session end

---
### Session 22 — 5 May 2026 — V1.3.3

**Built:** Admin edit/delete capability. PATCH and DELETE endpoints on `/admin/kb/:id`, inline-expand UI on the recent-entries list, hard-delete with `confirm()` guard. Five files changed.

- `backend/routes/admin.js` — PATCH and DELETE handlers added. Validators extracted to a single internal `validateKbFields()` helper used by both POST (validates inbound body) and PATCH (validates merged final state). Cross-tenant guard on PATCH and DELETE — the existing row's `deployment_slug` must match the auth-resolved deployment_slug, returning 403 `auth_failure` on mismatch. PATCH uses partial-field merge: only fields present in `req.body` override the existing row, all others preserve. Field-level diff before update — only changed fields hit Supabase, no-op edits short-circuit and return `changed: false`. DELETE is hard-delete, single-row by id, structured 404 on missing.
- `backend/server.js` — version label `1.3.2` → `1.3.3` in `/health` endpoint and boot log. CORS `methods` array extended from `['GET', 'POST']` to `['GET', 'POST', 'PATCH', 'DELETE']` so browsers' preflight checks accept the new verbs. No other functional changes.
- `admin-frontend/admin.js` — Edit/Delete buttons added to each `<li>` via `renderEntryLi()` template. Single delegated click listener on `#recent-list` dispatches on `data-action` attribute (edit, delete, save, cancel) — survives DOM replacement on PATCH-success without re-wiring. Inline-expand UX: `openEditPanel()` injects a prefilled form into the `<li>`'s `.edit-panel` container and toggles `.expanded` class. Save replaces just the affected `<li>` via `Element.replaceWith()` rather than reloading the full list. Delete uses `confirm()` with the question text echoed, then DELETE, then DOM removal. In-memory `recentEntriesById` map caches last-fetched entries so the edit panel prefills without a re-fetch.
- `admin-frontend/index.html` — version label `V1.3` → `V1.3.3` in `<span class="version">`. Source-field hint updated to `defaults to admin-form-v1.3.3`. No other markup changes.
- `admin-frontend/style.css` — Additive rules for V1.3.3 state. `.entry-list li.expanded` gets a gold left border (`--accent`) and subtle background shift (`#0e0e0e`) to mark the active edit unambiguously per D1's visual-clarity instruction. `.entry-actions` floats Edit/Delete buttons to the right of the meta row via `margin-left: auto`. `button.secondary.danger:hover` shifts to error colour only on hover, avoiding constant-red alarm. `.edit-panel` styling for the inline form, dashed-top-border separator from the read-only meta. Mobile breakpoint adjusts action buttons to drop below meta on narrow screens.

Repo at `github.com/gphi9343/streamlineai-chatbotiq`. Tag `v1.3.3` to be applied at clean deploy commit.

**Decided:**

- **PATCH validation shape: partial-field merge over existing row, validated as merged final state.** Approved at scope. Caller can send a single field; server merges, validates, and persists only changed fields. Server is authoritative — frontend client-side guards mirror the validator but server runs the same checks regardless. Structured `validation_error` (HTTP 400) when merged state would violate schema (e.g., switching to VERBATIM without supplying attribution). This is the right ergonomic shape for the typo-correction use case the V1.3 deferral originally targeted.

- **Validators extracted to a single helper.** V1.3 had POST validators inline as ~120 lines of copy-paste. Extending to PATCH would have doubled that surface. Extracted to `validateKbFields()` — same logic, called from both routes. Returns `{ ok, normalised }` on success, `{ ok, error }` on failure (where `error` is a structured-error object ready for `sendError`). Pattern 5 spirit: validation is engine logic, lives in one place. Refactor was scope-creep-with-payoff — net file shorter, future PATCH-shaped endpoints (e.g. `/admin/ingest`) can reuse the validator.

- **Cross-tenant guard on PATCH and DELETE.** Both endpoints fetch the existing row first, compare its `deployment_slug` against the auth-resolved slug, and return 403 `auth_failure` on mismatch. Defensive even at single-deployment state — the moment a second deployment registers (V1.4), this guard prevents an UPunt admin token from editing a StreamlineAI entry by id. Cheap to add now, expensive to add reactively after a cross-tenant write incident.

- **Hard-delete at V1.3.3, soft-delete deferred to V1.6.** SAQ-5 approved. Single-operator context (Gareth), accidental-deletion blast radius small, schema unchanged this session. V1.6 logging-dashboard work is the natural pairing for soft-delete (a `deleted_at` column gives the dashboard an audit-trail axis). Note: schema was not touched this session — no migration needed for V1.3.3.

- **CORS preflight gotcha.** v1.3.2's `methods: ['GET', 'POST']` would have silently rejected PATCH/DELETE preflights from the browser. Spotted before testing — added to journal as a Pattern-22-adjacent reminder: "config-shape changes that look declarative (a string array) can gate a whole new capability." Cost: 0 minutes (caught at generation). Cost if missed: 15-30 minutes of "PATCH returns CORS error in browser, works fine in curl" diagnosis.

- **Event delegation on `#recent-list` rather than per-render wiring.** When a save replaces the `<li>` via `replaceWith()`, per-element listeners on the old node die. Delegation on the parent container survives because the parent never gets replaced. Less code, fewer leaks, simpler to reason about — especially as this list will eventually carry pagination controls that re-render the whole `<ul>`.

- **Inline-expand UI over modal overlay.** Approved at scope. Single-page-no-routing shape, no z-index/focus-trap concerns, easier hard-refresh diagnostics. The expanded state's gold left border + subtle background shift (D1's instruction) is CSS-only — no JS theming logic to break.

- **Standing Rule 1 (Pattern 22) satisfied for all five files.** `git show v1.3.2:` reads on `backend/routes/admin.js`, `backend/server.js`, `backend/lib/auth.js`, `backend/config/upunt.js`, `backend/lib/system-prompt.js`, `admin-frontend/admin.js`, `admin-frontend/index.html`, `admin-frontend/style.css` all read into context before generation. Two material findings caught by the discipline:
  1. **Voice profile `tone` shape mismatch.** Master file Session 22 voice profile had `tone` as a comma-separated string (`"calm, plain-spoken, practical, honest, warm"`). UPunt v1.3.2 has `tone` as an array. `lib/system-prompt.js` line 161 uses `Array.isArray(vp.tone)` — a string would have silently failed the check and the tone line would have been omitted from the system prompt with no error. Master file was a drafting error, corrected to array form for Session 22 onward (D1 to update master file post-session). Final tone: `["calm", "plain-spoken", "practical", "warm"]` — "honest" dropped per D1 voice review (tone words describe sound, not intent; honesty is enforced by hard_guardrails).
  2. **Server.js single-deployment binding.** Detailed in next section — promoted from Standing-Rule-1 finding to V1.4 scope finding because of impact.

**Architectural finding flagged for V1.4 scope (D1 master file action):**

`server.js` v1.3.2 binds `const CONFIG = upuntConfig` and `const SYSTEM_PROMPT = buildSystemPrompt(CONFIG)` at module load. The `/chat` endpoint references `CONFIG.deployment_name`, `CONFIG.client_slug`, and the cached `SYSTEM_PROMPT` for every request. There is no per-request CONFIG resolution.

What was briefed as Session 22 Part B "StreamlineAI deployment scaffolding" — clone CONFIG, register in `lib/auth.js`, create second Netlify site — does not work as scaffolding. Adding `streamlineai` to the registry makes admin endpoints work for both deployments (admin routes resolve CONFIG per-request via `requireAdminAuth`'s deployment_slug lookup). But the new public-chat Netlify site, hitting this `server.js`, would respond with UPunt's voice regardless of which origin is calling. StreamlineAI prospect chats to Punta the racing tragic.

Multi-deployment chat dispatch requires:
- `lib/auth.js` to expose `DEPLOYMENT_REGISTRY` (currently module-private) for chat-side lookup, OR a separate registry export
- `server.js` to resolve CONFIG per-request — Origin header → slug map is the cleanest approach (UPunt frontend needs no change; Origin-based dispatch is additive)
- Per-deployment system-prompt cache — a `Map<slug, string>` of pre-built prompts at boot, indexed by slug at request time
- KB retrieval already takes `deploymentSlug` per call — no change needed there

This is a chat-flow architecture change, not a CONFIG clone. D1 sequencing decision deferred Part B in full — single tag, single shippable change at V1.3.3.

**D2 recommendation for next-session scoping:** the changeset for multi-deployment dispatch (server.js dispatch logic + lib/auth.js registry export shape + per-deployment prompt cache + new Netlify site + ALLOWED_ORIGINS append + ADMIN_TOKEN_STREAMLINEAI Railway env var + StreamlineAI voice profile drop-in) is large enough to warrant V1.4 rather than V1.3.4. D1 to confirm at next-session scope.

**Pattern check:**

- Pattern 1 (Reference vs Verbatim) — admin form's edit path preserves the same VERBATIM-requires-attribution rule. Switching content_type from REFERENCE to VERBATIM in the edit panel without supplying attribution returns structured `validation_error`. Same constraint as create.
- Pattern 5 (CONFIG vs CODE) — clean. No CONFIG changes this session. New endpoints are pure engine logic. The cross-tenant guard reads CONFIG only via the auth-resolved `req.deploymentConfig` already attached by middleware.
- Pattern 11 (Pre-Generation Scope Confirmation) — three rounds: (1) initial scope statement with five SAQs, (2) SAQ resolution, (3) Pattern 22 finding triggered re-scope from option-3 to option-A (Part A only). Each round produced explicit decision before code generation.
- Pattern 14 (Stop-And-Ask) — invoked twice. (1) SAQ-2 PATCH validation shape — approved partial-field merge with structured-error contract on invalid merged state. (2) Pattern 22 server.js finding — irreversibility/data-shape category — approved Option A (defer Part B in full).
- Pattern 15 (Build Journal Discipline) — entry being written now per protocol. Sync to D2 KB at session close per Standing-Rule additions to checklists.
- Pattern 16 (Handback to D1) — none formally written. Pattern 22 finding is captured in this journal entry as an architectural finding for D1 to absorb into the master file's chat dispatch story for V1.4. If D1 wants this re-formatted as a structured handback, the substance is here.
- Pattern 22 (Verify Prior Version's Actual Exports Before Extending) — satisfied across all eight files read. Two concrete saves: tone-shape mismatch (silent omission bug) and server.js dispatch finding (would have shipped a misrouted chat surface).

**Standing rules check:**

- Rule 1 (Pattern 22) — satisfied. See above.
- Rule 2 (Pattern 23 candidate) — frontend changed this session (admin frontend). Test protocol below includes Ctrl+Shift+R on the admin Netlify site, version-label check showing `V1.3.3`, and `/health` check showing `version: "1.3.3"` before any smoke test runs.

**Build Standards check:**

- #1 prompt caching — system prompt unchanged. No impact on cache machinery.
- #2 structured error handling — extended to PATCH and DELETE. Both use the `{status, type, message, suggestion, recoverable}` shape via `makeError`/`sendError`. New error type values used: `validation_error` (404 on missing entry, 400 on invalid id or merged state), `auth_failure` (403 on cross-tenant access).
- #3 response validation — admin frontend validates merged-state inputs client-side as a UX guard, but server is authoritative. POST and PATCH both run `validateKbFields()` before any DB write.
- #4 streaming — unchanged for chat. Admin frontend's edit/delete paths surface every fetch failure visibly: status panel inline in the edit panel for save failures, native `alert()` for delete failures (no inline status surface on the read-only `<li>` and adding one was scope creep). `confirm()` guards the destructive action.
- #5 stop_reason router — unchanged.

**Cost / spend state:**

- No prompt token impact (system prompt unchanged).
- Admin endpoints don't hit Anthropic. PATCH/DELETE are Supabase-only — negligible cost.
- `chatbotiq-dev` API key cap unchanged at $40/month.
- `chatbotiq-prod` API key still not created — trigger is first non-Gareth chat traffic, which is V1.4 scope (StreamlineAI public chat goes live).

**Files changed at V1.3.3:**

- Modified: `backend/routes/admin.js`, `backend/server.js`, `admin-frontend/admin.js`, `admin-frontend/index.html`, `admin-frontend/style.css`
- New: none
- Tag: `v1.3.3` to be applied at clean deploy commit

**Broken:** No deploys yet at time of journal write. Test results filled in after deploy + smoke test.

**Next:** Session 23 begins V1.4 — multi-deployment chat dispatch + StreamlineAI deployment scaffolding folded together. Scope brief for D1 to write at session open. D2 recommendation: V1.4 not V1.3.4 because the changeset spans engine architecture (per-request CONFIG resolution, registry export shape, per-deployment system-prompt cache) and adds a new public surface (StreamlineAI Netlify site). Major surface for a minor version bump. Files anticipated to change: `backend/lib/auth.js` (registry export), `backend/server.js` (dispatch logic), `backend/config/streamlineai.js` (new), plus Railway env var additions (`ADMIN_TOKEN_STREAMLINEAI`, append to `ALLOWED_ORIGINS`) and a new Netlify site setup.

**Open questions for D1 (carried forward):**

- V1.4 scope confirmation — multi-deployment dispatch + StreamlineAI scaffolding folded, version bump V1.4 (D2 rec) vs V1.3.4 (brief default).
- Master file `voice_profile.tone` shape correction (string → array). Action: D1 edit master file Session 22 voice profile.
- Methodology doc v1.2 batch update — still queued. Three changes pending (Pattern 1 rename, Pattern 22 promotion body, testbed-scaffolding corollary).
- Pattern 23 candidate (verify runtime state) — still 1/2 proofs. Hard-refresh + `/health` version check ran clean Session 21; Session 22 will surface a second proof or not depending on whether deploy lands clean.
- Pattern 24 candidate (permissive rules require concrete scope) — still 1/2 proofs. No second proof this session.
- Cross-tenant token-scope tightening — V1.3 listing-route accepts any valid token to enumerate deployments. Acceptable at single-operator state, becomes a real concern when paying-client deployments register. Track for V1.6.

---

### Session 23 — 7 May 2026 — V1.4

**Built:** Multi-deployment chat dispatch + StreamlineAI deployment scaffolding folded into one V1.4 ship. ChatbotIQ engine now resolves CONFIG per-request via Origin header. UPunt and StreamlineAI run side-by-side on one Railway backend, two Netlify public-chat sites, one admin frontend, one shared codebase, one tag.

Eight files changed (six backend/frontend code, plus README documentation, plus this journal entry):

- `backend/lib/auth.js` — Added `streamlineai: streamlineaiConfig` to DEPLOYMENT_REGISTRY. New exported function `getDeploymentByOrigin(origin)` walks the registry and returns the first CONFIG whose `allowed_origins` array includes the given Origin. Returns `null` on miss; consumed by `server.js` chat dispatch which converts null → `config_error`. DEPLOYMENT_REGISTRY itself stays module-private — chat-side resolution goes through the new accessor, mirroring the existing `getDeploymentConfig(slug)` admin-side accessor. Two purpose-specific exports, one private registry.
- `backend/config/upunt.js` — Added `allowed_origins: ['https://streamlineai-chatbotiq.netlify.app']` field. Doc comment block (~25 lines) explains the relationship with `ALLOWED_ORIGINS` env var: CORS gate vs deployment dispatch, both must agree, drift symptom is "CORS passed, dispatch failed with config_error". Same comment block in `streamlineai.js` for parity.
- `backend/config/streamlineai.js` (new) — Full deployment CONFIG. Voice profile drop-in from master file (locked Session 22): tone array `['calm', 'plain-spoken', 'practical', 'warm']`, plain-English style paragraph, 10 signature phrases, 20 forbidden words, 17 forbidden behaviours, 13 example messages (10 confident + 3 INSUFFICIENT DATA), 16 hard guardrails. `admin_token_env_var: 'ADMIN_TOKEN_STREAMLINEAI'`. `allowed_origins: ['https://streamlineai-chat.netlify.app']`. `client_slug: 'streamlineai'`. Brand inherits StreamlineAI black/gold/warm-white tokens.
- `backend/server.js` — Replaced module-load CONFIG binding (`const CONFIG = upuntConfig`, `const SYSTEM_PROMPT = buildSystemPrompt(CONFIG)`) with per-request resolution via `getDeploymentByOrigin(req.headers.origin)`. Per-deployment system-prompt cache implemented as `Map<client_slug, string>`, lazily built on first request per deployment via `getSystemPromptFor(config)` helper. Pre-build at boot for diagnostic visibility (boot log surfaces each deployment's prompt size before any traffic). Strict reject on Origin miss with `config_error` (Build Standard #2, non-recoverable) — silent fallback was the V1.4 finding that prompted this work. `/health` extended to expose registered-deployments list with per-deployment prompt sizes and allowed_origins for diagnostic visibility on the multi-deployment surface. `/chat` `done` event extended with `deployment` field (the resolved client_slug) for client-side traceability. Version label 1.3.3 → 1.4.
- `streamlineai-chat-frontend/index.html` (new) — Sibling subdirectory to `frontend/`, `admin-frontend/`, `backend/` in the same repo. Title "StreamlineAI", header "StreamlineAI V1.4", neutral placeholder "Ask about our services, products, or how we work...". Same DOM shape as UPunt frontend so the SSE event handling logic is identical.
- `streamlineai-chat-frontend/style.css` (new) — Same black/gold/warm-white palette as UPunt frontend (StreamlineAI brand happens to match UPunt's brand tokens — no fork needed yet, comment notes if they diverge). Adds `.msg-error` styling that was inherited implicitly in UPunt frontend's older CSS — explicit here for visible-failure-path discipline (Build Standard #4).
- `streamlineai-chat-frontend/chat.js` (new) — Cloned SSE logic from `frontend/chat.js`. Logger prefix `[streamlineai]` instead of `[chatbotiq]` for log-stream separation. SESSION_KEY namespaced as `'streamlineai_chat_session_id'` (vs UPunt's `'chatbotiq_session_id'`) so a browser running both sites doesn't share session state. VERSION constant `'V1.4'`. BACKEND_URL identical (one Railway backend serves both deployments).
- `README.md` — Paragraph documenting `ALLOWED_ORIGINS` env var (CORS gate) vs `CONFIG.allowed_origins` field (deployment dispatch). Same content as the doc comment in CONFIG files but in operator-facing prose; deploy walkthroughs reference this section.

Repo at `github.com/gphi9343/streamlineai-chatbotiq`, public, tag `v1.4` to be applied at clean deploy commit.

**Decided:**

- **Origin-header dispatch over path-prefix or request-body slug.** D1 confirmed at scope. Origin-header is purely additive on the backend — UPunt frontend untouched, V1.0–V1.3.3 frontend rollback preserved. Path-prefix (`/chat/:slug`) and request-body slug both force a UPunt frontend change for zero capability gain. Origin is also the natural authority on "which site is this request from", so it's the most semantically correct dispatch key.

- **Strict reject on unknown Origin (`config_error`).** D1 confirmed at scope. A request from an Origin not in any CONFIG.allowed_origins is either a misconfigured deployment or a probe; both should fail loudly. Silent fallback to a default deployment routes those to one deployment's voice — same class of failure that prompted splitting v1.3.3 from v1.4 in the first place. `config_error` is the correct error type per Build Standard #2 (non-recoverable misconfiguration, log loudly, fail fast, no retry).

- **CONFIG-derived origin map (Pattern 5 enforced).** D1 confirmed at scope over D2's earlier consideration of a separate `ORIGIN_MAP` constant in `lib/auth.js`. Each deployment's CONFIG owns its own origins. The only place that knows about StreamlineAI's site URL is `streamlineai.js`. Adding a separate ORIGIN_MAP would have created a sync requirement (add deployment → remember to update two places) — same drift class as the `ALLOWED_ORIGINS` env var ↔ `CONFIG.allowed_origins` discipline this version already had to manage. One source of truth per concern.

- **DEPLOYMENT_REGISTRY stays module-private; two purpose-specific accessors.** D1 confirmed at scope over the original brief's "expose the registry". The Pattern 22 read of v1.3.3 `lib/auth.js` surfaced that `getDeploymentConfig(slug)` already exists as an exported accessor for admin lookups. The chat-dispatch path got its own purpose-specific accessor (`getDeploymentByOrigin`) rather than exposing the raw registry. Cleaner API surface, encapsulation preserved, and future accessors (e.g. by-token, by-domain) can be added without breaking existing callers.

- **Per-deployment system-prompt cache via `Map<slug, string>`, lazily built.** Build Standard #1 (prompt caching) preserved across deployments. Anthropic's ephemeral cache hits on identical system-prompt strings, so as long as each deployment's prompt is stable across the session, cache hits engage normally. Lazy build means cold deployments incur a one-time build cost on first request; pre-build at boot (`prebuildAllPrompts()`) shifts that cost to startup for diagnostic visibility (boot log surfaces prompt sizes per deployment).

- **`done` event carries `deployment` field.** Added so the frontend log stream can confirm which deployment the backend routed to. Useful diagnostic — if a hard-refresh produces an unexpected voice, the `done` event tells you whether dispatch resolved to the expected slug. Backwards-compatible (extra field, existing clients ignore it).

- **First non-test deployment registered. V1.6 cross-tenant token-scope concern now has a concrete second deployment in scope.** The `requireDeployment: false` listing route at `lib/auth.js` line 105-126 (which accepts any registered deployment's token to enumerate all deployments) is now exercised across two real deployments rather than one. Acceptable at single-operator state — only Gareth has tokens — but the V1.6 conversation about deployment-scoped admin auth tightening should open with this context: it's not a hypothetical concern any more, it's a concrete dual-deployment surface. Carried as a journal-flagged V1.6 item, not a V1.4 blocker.

- **`ADMIN_TOKEN_STREAMLINEAI` generated this session.** Per scope decision (Standing Rule 2 spirit, Session 21 precedent). Token generated via `openssl rand -hex 32`, value passed to D1 in deploy walkthrough for setting in Railway env vars. Token never appears in any committed file. Session 21's rotation pattern still applies if the token is ever exposed during testing.

- **Standing Rule 1 (Pattern 22) satisfied for all five files modified or referenced.** Read into context before generation:
  1. `git show v1.3.3:backend/lib/auth.js` — found that `getDeploymentConfig(slug)` is already exported (the journal description's "currently module-private" was technically correct about the registry constant but missed the existing slug accessor). Resulted in the smaller, cleaner V1.4 design (no `DEPLOYMENT_REGISTRY` export, just one new function).
  2. `git show v1.3.3:backend/server.js` — confirmed CORS allow-list shape, /admin route mount, SSE event names, all stage shapes for the chat handler. No surprise findings.
  3. `git show v1.3.3:backend/config/upunt.js` — confirmed CONFIG shape, voice profile field structure, hard_guardrails location at top-level (not nested in voice_profile). No surprise findings.
  4. `git show v1.3.3:backend/lib/system-prompt.js` (lines 1-60) — confirmed `buildSystemPrompt(config)` reads CONFIG via dot-notation (`config.deployment_name`, `config.domain`, `config.voice_profile.*`, `config.hard_guardrails`). Confirmed `streamlineai.js` only needs to match this contract — no per-deployment branching in the prompt builder.
  5. `git show v1.3.3:frontend/index.html`, `frontend/chat.js`, `frontend/style.css` — clone source for `streamlineai-chat-frontend/`. Found UPunt frontend version label still showing V1.2 (cosmetic carryforward from V1.3.3 journal). NOT bumped this session — UPunt frontend cosmetic update is a separate task; V1.4 doesn't touch UPunt's frontend at all (Pattern 22 spirit: don't conflate scope).

**Architectural note re-surfaced from Pattern 22 read:** the original V1.4 scope assumed `lib/auth.js` would need to export `DEPLOYMENT_REGISTRY` for chat-side consumption. That assumption was wrong. The chat dispatch needed an Origin → CONFIG accessor, which became a small new function alongside the existing slug accessor. Estimate accuracy data point: the Pattern 22 read shrank the auth.js change from "expose the registry" (10-15 min) to "add one entry + add one function" (still 10-15 min), but it shifted my mental allocation of session time. The new frontend site clone + per-deployment prompt cache + deploy walkthrough turned out to be the heavier buckets, not the engine plumbing. Future scope calibration: when scope splits into "engine work" + "new deployment surface", the surface clone is consistently the longer bucket. Engine plumbing reads bigger than it builds; surface clones read smaller than they build.

**Broken:** No deploys yet at time of journal write. Test results filled in after deploy + smoke test on both surfaces.

**Pattern check:**

- Pattern 1 (Reference vs Verbatim Separation) — preserved. Both deployments use the same KB rendering rule. StreamlineAI VERBATIM entries (pricing, brand statements, refusal/redirect language) get the same exact-quote-with-attribution behaviour as UPunt's.
- Pattern 5 (CONFIG vs CODE) — clean. All deployment-specific content (voice, brand, hard_guardrails, allowed_origins) lives in CONFIG. Engine code in `auth.js` and `server.js` reads CONFIG via the registry accessors only — never references a slug directly. Adding a third deployment is one CONFIG file, one registry entry, one Netlify site, one ALLOWED_ORIGINS append, one admin token env var. Zero engine code change.
- Pattern 11 (Pre-Generation Scope Confirmation) — three rounds before generation: (1) initial scope statement with three SAQs (dispatch pattern, miss behaviour, token timing), (2) D1 flagged frontend repo structure + Pattern 22 read, (3) revised scope with Pattern 22 findings + dual `allowed_origins` doc comment in scope + V1.6 journal-note in scope. Each round produced explicit decision before code generation.
- Pattern 14 (Stop-And-Ask) — invoked twice. (1) External services (new Netlify site) — approved. (2) Security (new admin token generation) — approved.
- Pattern 15 (Build Journal Discipline) — entry being written now per protocol. Journal sync to D2 KB at session close per Standing Rule additions to checklists.
- Pattern 16 (Handback to D1) — none formally written. All decisions resolved within scope.

**Standing rules check:**

- Rule 1 (verify prior version's exports before extending) — satisfied for all five files read. The `lib/auth.js` read in particular paid off — produced a smaller, cleaner V1.4 design than the original brief.
- Rule 2 (hard-refresh after frontend deploy) — applies to BOTH Netlify sites this session. UPunt frontend unchanged at V1.4 but its version label still shows V1.2 (cosmetic carryforward, not a V1.4 task). StreamlineAI frontend brand new — hard-refresh required after first deploy to confirm the site is reachable and serving the V1.4 build, not a Netlify placeholder. Test protocol covers both.

**Build Standards check:**

- #1 prompt caching — preserved per-deployment via `Map<slug, string>` cache. Each deployment's system prompt is stable across the session, so Anthropic's ephemeral cache hits as it did at v1.3.3. UPunt's prompt unchanged from V1.4 baseline (~5906 chars per Session 4 V1.4 measurement). StreamlineAI prompt new — size measurement filled in after first deploy via /health endpoint.
- #2 structured error handling — extended. New `config_error` path on Origin miss in `/chat`. Every existing error path preserved.
- #3 response validation — unchanged.
- #4 streaming — unchanged on UPunt surface. New StreamlineAI frontend inherits identical SSE parser with visible-failure-path discipline. `.msg-error` CSS class explicit in StreamlineAI stylesheet.
- #5 stop_reason router — unchanged.
- #6 pre-deployment checklist — to be passed before V1.4 ships.

**Cost / spend state:**

- No cost shape change at V1.4. Second deployment adds zero traffic until KB curation + website launch (StreamlineAI website not yet pointing at this chat).
- `chatbotiq-dev` API key cap unchanged at $40/month.
- `chatbotiq-prod` API key still not created — trigger remains first non-Gareth chat traffic. V1.4 ship doesn't trigger by itself; the StreamlineAI site goes live to public traffic only when KB curation completes + website integrates the chat.
- Railway: still on Hobby trial. Calendar reminder for upgrade by 24 May 2026 stands.
- Per-deployment system-prompt cache costs ~5-10 KB of process memory per registered deployment. Negligible at current scale; flag for V1.6 if registry exceeds ~50 deployments.

**Files changed at V1.4:**

- Modified: `backend/lib/auth.js`, `backend/config/upunt.js`, `backend/server.js`, `README.md`
- New: `backend/config/streamlineai.js`, `streamlineai-chat-frontend/index.html`, `streamlineai-chat-frontend/style.css`, `streamlineai-chat-frontend/chat.js`
- Tag: `v1.4` to be applied at clean deploy commit

**Next:** Session 24 begins post-V1.4 work. Critical-path candidates: (a) StreamlineAI KB curation via admin form (~30 entries — this is D1 task, not D2 build, but D2 may be needed for any admin form friction surfaced during curation), (b) NewsletterIQ proxy migration (flagged for post-v1.4 D2 work, required before NewsletterIQ goes on website as paid product), (c) UPunt public-chat frontend version-label cosmetic update (carry-forward from V1.3.3, no engine work). D1 sequencing decision opens Session 24.

**Open questions for D1 (carried forward):**

- V1.6 deployment-scoped admin auth tightening — now has concrete second deployment in scope (this session's StreamlineAI registration). Track for V1.6 conversation context.
- Methodology doc v1.2 batch update — still queued. Three changes pending (Pattern 1 rename, Pattern 22 promotion body, testbed-scaffolding corollary). Plus Pattern 23 candidate (verify runtime state) and Pattern 24 candidate (permissive rules require concrete scope) — both still 1/2 proofs.
- Custom domain `chat.streamlineai.net.au` — deferred to post-KB-curation per Session 22 SAQ-4. Adding it requires appending to BOTH `streamlineai.js` `allowed_origins` AND Railway `ALLOWED_ORIGINS` env var.
- UPunt frontend version label — still showing V1.2. Cosmetic update (V1.4 across two `<span class="version">` instances), no engine work, no test surface beyond hard-refresh + visual check.

---

