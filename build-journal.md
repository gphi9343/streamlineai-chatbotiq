# ChatbotIQ Build Journal

*Append-only. Read most recent 3 entries at session start. Archive when journal exceeds 30 entries.*

---

*Sessions 1–5 archived → build-journal-archive-v1.md. Active from Session 22.*

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

**POSTSCRIPT (added end of session — tag-discipline finding + D1 sequencing decisions):**

During Step 11 (tag and finalise), `git tag v1.4` failed with "tag already exists". A stale `v1.4` tag from an earlier session (Session 4 V1.4 voice profile work — commit `d7cd300`, message "V1.4 version label bump in server.js (cosmetic, no behaviour change)") was found pointing at the wrong commit. The actual V1.4 changeset for this session is at `8361de3`. Resolution: deleted the stale tag locally and on GitHub, retagged `8361de3`, pushed. Verified `v1.4 8361de3` is the GitHub tag.

Lesson logged as Standing Rule 3 candidate (1/2 proofs) — "Verify tag namespace before extending." At session-start when extending a tag namespace, check whether the target tag already exists locally (`git tag -l v<X>`) and remotely (`git ls-remote --tags origin v<X>`). The "tag already exists" warning at push time is the visible symptom of stale-tag drift; the silent failure mode is leaving the wrong commit tagged. Sibling shape to Standing Rules 1 and 2 (verify state before extending/testing). D1 confirmed Session 23 close-out: held at candidate status, treated as standing rule in D2 master prompt only until second proof, same status Pattern 23 sits at. Promote on next occurrence.

D1 close-out decisions for this session:
- **Pattern 24 promoted to methodology doc as Pattern 11.** Permissive rules require concrete scope — proven by Session 21 (case-3 scope drift) + Session 23 (example_messages drift). Methodology doc v1.2 re-upload to D2 KB pending before Session 24 open.
- **Pattern 25 candidate (stale-tag drift) held at 1/2 proofs.** First logged proof is this session. Promote on second occurrence.
- **Sequencing locked: no D2 build session until StreamlineAI KB hits ~20 entries.** D1 owns curation as parallel work. Next D2 session is v1.4.1 — NewsletterIQ proxy migration + UPunt cosmetic version label bump folded together. Patch increment (no engine architecture change in either component).

---

### Session 25 — 10 May 2026 — V1.4.1 + V1.4.2

**Built:** Two patch increments shipped this session, both addressing Session 24 smoke-test failures on StreamlineAI deployment. V1.4.1 fixed Pattern 11 case-3 scope drift on numerical content + added diagnostic endpoints. V1.4.2 fixed retrieval — replaced `.textSearch()` with an RPC implementing hybrid AND-then-OR matching with rank-based ordering. Eight files changed total across both patches. Live bot now correctly quotes Entry 10 (pricing VERBATIM) for "How much does it cost?" and Entry 19 (technical-skills VERBATIM) for "I'm not technical, can I still use this?" — the two failures from Session 24.

V1.4.1 changeset:
- Modified: `backend/lib/system-prompt.js` — Pattern 11 case-3 exclusion list extended (specific factual values: prices, dates, quantities, names, contact details, identifiers); case-3 wording made domain-agnostic (replaces racing-specific examples with `config.domain` reference); VERBATIM PRECEDENCE block added to KB rendering rules; NEVER FABRICATE SPECIFIC FACTUAL VALUES block added; example_messages framing note added ("stylistic references for HOW you speak, not content sources for WHAT you say")
- Modified: `backend/server.js` — version label `1.4` → `1.4.1`, boot log line
- Modified: `backend/routes/admin.js` — added `GET /admin/debug/system-prompt/:slug` and `GET /admin/debug/retrieval/:slug?query=...` endpoints under the existing `requireDeployment: false` listing-route auth pattern
- Tag: `v1.4.1` at commit `3be056b`

V1.4.2 changeset:
- New: `backend/migrations/v1.4.2-search-kb-rpc.sql` — Postgres function `search_kb(p_deployment_slug, p_query, p_limit)` with hybrid AND (websearch_to_tsquery) + OR (manually-built sanitised to_tsquery) paths combined via UNION ALL, deduplicated DISTINCT ON (id) keeping highest rank per entry, ordered by rank DESC, floor-filtered at 0.0001
- Modified: `backend/lib/kb.js` — `retrieveKb()` switched from `.textSearch()` builder to `.rpc('search_kb', {...})`; `RELEVANCE_FLOOR` filter now enforced (was declared at V1.2 but unused because `.textSearch()` didn't expose rank); hit shape extended with `rank` field
- Modified: `backend/server.js` — version label `1.4.1` → `1.4.2`, boot log line
- Tag: `v1.4.2` at commit `7bd77e6`

V1.4.1 prompt sizes: UPunt `6762` → `8849`, StreamlineAI `9418` → `11505` (+2087 chars each, identical delta confirms universal engine-level fix per CONFIG-vs-CODE separation). V1.4.2 prompt sizes unchanged.

**Decided:**

- **Engine fix is universal across deployments, not StreamlineAI-only.** Pattern 5 (CONFIG vs CODE) makes deployment-specific engine branching a violation. UPunt is "frozen" per Session 22 — no active KB curation, no calibration patches, no smoke-test commitment — but engine improvements that apply universally still flow through. UPunt benefits from the V1.4.1 + V1.4.2 fixes by virtue of shared `lib/` code without active testing commitment. D1 noted this distinction needs sharper definition in master file Operating Discipline section: "Frozen deployment definition: no active KB curation, no calibration patches, no smoke-test commitment. Engine improvements that apply universally still flow through — frozen does not mean forked." Carried as session-close handback to D1.

- **Phase-split V1.4.1 / V1.4.2.** D1 brief originally framed Session 24 failures as two separate engine-level patches in one session. D2 split into Phase 1 (Pattern 11 case-3 fix + diagnostic endpoints, V1.4.1) and Phase 2 (Failure 2 fix, deferred until diagnostic data available). Phase 1 surfaced that Failure 1 had a deeper retrieval-level cause than the brief identified. Phase 2 reshaped from "fix Failure 2's retrieval miss" to "fix retrieval mechanics across both failures" once diagnostic data showed both Session 24 failures traced to the same `plainto_tsquery` conjunctive-matching limitation. One mechanical bug, two surfaced failures — cleaner story than two separate fixes.

- **Diagnostic endpoints built in V1.4.1 (not deferred), gated by listing-route auth pattern.** D1 pre-session decision approved building now, building under `requireAdminAuth({ requireDeployment: false })` matching `/admin/deployments` precedent. Threat model rationale: single operator, one set of admin tokens, cross-deployment leak risk theoretical at N=1 deployments-with-admin-access. V1.6 tightening to slug-scoped enumeration applies to both `/admin/deployments` and `/admin/debug/*` together — first paying-client deployment is the trigger point. Building slug-scoping at V1.4.1 would have been refactored at V1.6 anyway. Logging deferred to V1.7 dashboard work — console.log audit trail rejected as cargo-cult logging without retention/alerting/review.

- **V1.4.2 RPC iteration v2.a → v2.b at SQL verification step.** First RPC attempt used `websearch_to_tsquery` expecting natural-language OR semantics. Postgres docs misread — `websearch_to_tsquery` is conjunctive by default, only honours OR for explicit OR keyword in input. Test (a) "how much does it cost" still missed Entry 10; test (b) "I am not technical can I still use this" returned zero rows for Entry 19. Same retrieval miss as V1.4.1. Caught at SQL Editor verification step before code cutover (Pattern 23 / Standing Rule 2 discipline applied to RPC layer). v2.b replaces with hybrid AND-then-OR: AND path preserves precision when content rich, OR path catches partial overlap when content thin, both compete on rank. Sanitisation contained to one CTE (`regexp_replace` strips non-alphanumeric, splits, joins with ` | `, prevents `to_tsquery` operator-injection risk).

- **UNION ALL + DISTINCT ON over UNION (rank-aware dedup).** UNION dedupes on full row equality; AND-path and OR-path produce different rank values for the same entry, so UNION wouldn't dedupe. DISTINCT ON (id) ORDER BY id, rank DESC keeps the highest-ranked instance per entry, then outer SELECT re-orders by rank globally. Cleaner shape than UNION + max-rank aggregation.

- **V1.4.2 ships despite multi-turn drift on Step 4 turn 2.** Bot quoted Entry 10 verbatim on single-turn pricing question (Step 3 — original ship gate, passes). Multi-turn follow-up "How much do the streamline AI products cost?" surfaced minor drift: bot quoted KB ranges correctly but extended with "ChatbotIQ A$297/mo retainer" (not in Entry 10 — Entry 10 says "retainers from A$197/month" with no per-product retainer differentiation). Same class of bug as Session 24's pricing fabrication, smaller magnitude. D1 ship decision: V1.4.2 ships now, V1.4.3 opens as immediate next D2 session for multi-turn VERBATIM-precedence tightening. Locking V1.4.2 in is correct because three load-bearing improvements (Pattern 11 case-3 numerical exclusion, VERBATIM precedence directive, retrieval RPC) shouldn't be held hostage to V1.4.3 perfectionism. KB curation stays paused at 20/30 entries until V1.4.3 ships — pre-launch readiness criterion includes hard guardrail #1 ("Never invent pricing not in the KB"); multi-turn violation of that guardrail blocks streamlineai.net.au launch.

- **Standing Rule 1 satisfied for all five files this session.** `git show v1.4:backend/lib/system-prompt.js`, `git show v1.4:backend/server.js`, `git show v1.4:backend/routes/admin.js`, plus `lib/kb.js` and `lib/auth.js` Pattern 22 reads provided in user paste. V1.4 baseline confirmed at commit `8361de3` via `git show v1.4 --no-patch --format` before any generation.

- **Standing Rule 2 N/A this session — no frontend changes.** Both V1.4.1 and V1.4.2 are backend-only. UPunt frontend remains at V1.2 cosmetic version label (Session 23 carry-forward, separate item). StreamlineAI frontend unchanged.

- **Pattern 25 candidate (verify tag namespace state before tagging) satisfied.** `git show v1.4 --no-patch --format` and `git ls-remote --tags origin v1.4` run pre-generation to confirm V1.4 tag points at `8361de3` (not the stale Session 4 `d7cd300`). Both v1.4.1 and v1.4.2 tags pushed clean with no stale-tag conflicts.

- **kb.js doc-comment drift logged for V1.4.3 cleanup.** `kb.js` header still references "websearch_to_tsquery" as the V1.4.2 fix (correct for v2.a, stale for v2.b) and "three test calls" verification (we ran four — added regression check). Functional code is correct; comment is stale. 2-minute side-pass during V1.4.3 (system-prompt.js touched anyway). D1 instruction: do not open a separate session for comment cleanup.

**Broken:**

- **Multi-turn VERBATIM-precedence drift surfaced on V1.4.2 smoke test.** Bot quotes VERBATIM correctly on initial response and on single-turn questions. On multi-turn follow-up where the user asks an adjacent question, bot quotes the KB content correctly but extends with synthesised supportive content not in any KB entry. Three observed instances during smoke test:
  - Step 4 turn 2 ("How much do the streamline AI products cost?"): bot added "ChatbotIQ A$297/mo retainer" (not in KB), "complexity, integrations, how much training data you've got" (not in KB), "Most deployments land in the lower half of those ranges" (not in KB)
  - Step 5 ("I'm not technical, can I still use this?"): bot quoted Entry 19 cleanly but appended "Most of what we build sits in the background and just works. You're not managing code or configuring anything technical — you'll interact with the tools the same way you'd use any other web app." — none of which is in any KB entry
  - Step 6 control "What does StreamlineAI do?": minor REFERENCE-style extension after Entry 1 quote, but the extension is voice-profile-shaped and stays within domain; flagged as same shape, lower severity
- Existing in-flight items unchanged: UPunt frontend version label V1.2 (cosmetic), V1.6 deployment-scoped admin auth tightening, custom domain `chat.streamlineai.net.au` deferred.

**Next:** Session 26 begins V1.4.3 immediately — multi-turn / extended-response VERBATIM precedence tightening. Single file change (`system-prompt.js`). 30-45 minute estimate. Scope per D1 close-out: strengthen VERBATIM precedence directive to cover the case where bot quotes correctly but extends with synthesised supportive content. Likely shape: explicit instruction that any content beyond the quoted material in a VERBATIM-anchored response must come from another KB entry in the same CONTEXT block, not from voice profile examples or general knowledge. Doc-comment cleanup in `kb.js` folds into this session (2-minute side-pass). KB curation resumption gated on V1.4.3 ship.

**Build Standards check:**

- #1 prompt caching — V1.4.1 grew per-deployment prompts ~+2087 chars (universal engine content added to KB rendering rules + INSUFFICIENT DATA exclusion list + voice profile framing note). Cache machinery unchanged — per-deployment `Map<slug, string>` cache still hits on identical strings within a session. V1.4.2 prompt unchanged.
- #2 structured error handling — V1.4.2 `kb.js` RPC error path produces `downstream_unavailable` recoverable structured error if the RPC is missing or fails. Bot degrades to no-context mode (Pattern 3 INSUFFICIENT DATA fires) rather than crashing.
- #3 response validation — unchanged.
- #4 streaming — unchanged.
- #5 stop_reason router — unchanged.
- #6 pre-deployment checklist — passed for both V1.4.1 and V1.4.2 ship gates. V1.4.2 multi-turn drift logged but not classified as a Step 3 ship-gate failure (Step 3 single-turn passed cleanly).

**Standing rules check:**

- Rule 1 (verify prior version's exports before extending) — satisfied. Five Pattern 22 reads at session open: `system-prompt.js`, `server.js`, `streamlineai.js`, `upunt.js` provided by user; `kb.js`, `auth.js`, `admin.js` provided when scope reshaped from V1.4.1-only to V1.4.1 + V1.4.2 retrieval fix.
- Rule 2 (hard-refresh after frontend deploy) — N/A this session, no frontend changes.

**Pattern 23 second proof confirmed.** RPC verification at SQL Editor before code cutover caught the v2.a retrieval miss before it reached deployment. First proof was V1.2 cached frontend (Session 19) — `/health` version-check + hard-refresh discipline. Same shape: verify runtime state matches expected state before depending on it. Different surfaces (browser cache vs database function), same discipline. D1 promotes to methodology doc as Pattern 12 in v1.2 batch update.

**Cost / spend state:**

- V1.4.1 system prompt grew ~2087 chars per deployment. Per-turn cost increase: cache write on first turn of a session is slightly larger; cache hits on subsequent turns are unchanged in pricing model (cached tokens cheaper than fresh). Negligible cost impact at current scale.
- V1.4.2 RPC adds two `@@ tsquery` operations per chat request instead of one. Both hit the same GIN-indexed tsvector column. Negligible. Anthropic API cost unchanged — same prompt, same retrieval result shape from caller perspective.
- `chatbotiq-dev` API key cap unchanged at $40/month.
- `chatbotiq-prod` API key still not created — KB curation paused per D1 means StreamlineAI public-chat traffic stays at testing-only scale.
- Railway: still on Hobby trial. Calendar reminder for upgrade by 24 May 2026 stands.

**Files changed at V1.4.2 (cumulative this session):**

V1.4.1 (commit `3be056b`, tag `v1.4.1`):
- Modified: `backend/lib/system-prompt.js`, `backend/routes/admin.js`, `backend/server.js`

V1.4.2 (commit `7bd77e6`, tag `v1.4.2`):
- New: `backend/migrations/v1.4.2-search-kb-rpc.sql`
- Modified: `backend/lib/kb.js`, `backend/server.js`

**Open questions for D1 (carried forward, plus new this session):**

- V1.4.3 immediate next session — multi-turn VERBATIM-precedence tightening. Scope locked at session close.
- KB curation pause extension — was "until v1.4.1 fixes engine-level failures", now "until V1.4.3 multi-turn VERBATIM precedence holds." D1 to update master file.
- Master file frozen-deployment clarification — exact text from D1 Session 25: "Frozen deployment definition: no active KB curation, no calibration patches, no smoke-test commitment. Engine improvements that apply universally still flow through — frozen does not mean forked." D1 to add to Operating Discipline section.
- Pattern 23 → Pattern 12 promotion in methodology doc v1.2 batch update — confirmed second proof this session, queued.
- Methodology doc v1.2 batch update queue is now five items (was four): Pattern 1 rename (REFERENCE/VERBATIM), Pattern 22 promotion body, testbed-scaffolding corollary, Pattern 24 → Pattern 11 promotion (already queued), Pattern 23 → Pattern 12 promotion (NEW this session).
- Multi-VERBATIM context behaviour — Step 4 retrieval surfaced both Entry 10 and Entry 12 (free tools pricing) at tied rank 0.303 for "how much does it cost". Bot handled the multi-VERBATIM CONTEXT block correctly on turn 1 (quoted Entry 10, ignored Entry 12). System prompt's VERBATIM PRECEDENCE directive doesn't explicitly cover "which one to quote when both are relevant" — bot got it right by inference. Logged as observation, not a bug. Possible V1.5 calibration item if multi-VERBATIM scenarios produce drift in production.
- UPunt frontend version label V1.2 cosmetic update — still carried.
- Custom domain `chat.streamlineai.net.au` — deferred to post-KB-curation per Session 22 SAQ-4. KB curation now gated on V1.4.3.

---

### Session 26 — 11 May 2026 — V1.4.3

**Built:** Multi-turn / extended-response VERBATIM precedence tightening shipped as V1.4.3 at commit `4f740d3`, tag `v1.4.3`. Three files changed. Directive is live in the deployed prompt and verified via `/admin/debug/system-prompt/streamlineai`. Engine fix universal across deployments (UPunt and StreamlineAI both grew by identical +2339 char delta — Pattern 5 intact).

V1.4.3 changeset:
- Modified: `backend/lib/system-prompt.js` — new VERBATIM RESPONSE SCOPE directive inserted between VERBATIM PRECEDENCE and NEVER FABRICATE in the KB rendering rules. Constrains response shape when a VERBATIM quote anchors the response: quoted material plus at most one short framing sentence, framing strictly limited to two shapes (content from another CONTEXT entry, or content-free transition phrase naming the source/restating the topic). Three named anti-patterns enumerated by behaviour: (a) fabricated specific values, (b) synthesised supportive prose, (c) "what this means in practice" elaboration. Multi-turn invariance stated explicitly — Turn 2 does not get a relaxation because Turn 1 already cited the source. Header comment block rewritten to reflect V1.4.3 scope and rationale.
- Modified: `backend/lib/kb.js` — header doc-comment cleanup only. V1.4.2 RPC description corrected from v2.a's `websearch_to_tsquery()`-alone shape to v2.b's hybrid AND-then-OR (websearch_to_tsquery AND path + sanitised to_tsquery OR path, UNION ALL with DISTINCT ON rank-aware dedup). Test-call count corrected from three to four (regression check + cross-deployment scoping check included). Functional code untouched — verified comment-only via `git diff` inspection of all `+`/`-` lines.
- Modified: `backend/server.js` — version label `1.4.2` → `1.4.3` in `/health` endpoint and boot log line. Header comment block updated for V1.4.3 patch scope.

Prompt sizes after V1.4.3: UPunt `11188`, StreamlineAI `13844`. Both deployments grew by exactly `+2339` chars (V1.4.2 was 8849 / 11505). Identical delta across deployments confirms engine-level universal fix.

**Decided:**

- **Strict framing per D1 SAQ-1.** Framing sentence around a VERBATIM quote must be either (1) content drawn from another entry in the same CONTEXT block, or (2) a content-free transition phrase that names the source or restates the question topic. Moderate framing ("OK if it restates the user's question or names the source — no new factual content") was rejected as the exact latitude the model already took on Session 25 Step 5. Pattern 11 (Permissive rules require concrete scope) applied to the framing surface, not just question-type classification.

- **Named anti-patterns per D1 SAQ-2.** Three Session 25 failure shapes enumerated by behaviour: (a) fabricated specific values, (b) synthesised supportive prose with no fabricated values, (c) "what this means in practice" elaboration. Abstract-principle-plus-model-interpretation approach rejected — that approach failed at V1.3, V1.3.1, V1.3.2 case-3, and Session 24. Concrete worked-out anti-patterns mirror the V1.3.2 case-3 fix that held.

- **Multi-turn invariance stated explicitly.** Rule wording: "Turn 2 does not get a relaxation because Turn 1 already cited the source. Each turn re-retrieves; each turn that hits a VERBATIM entry applies the same scope rule." Adjacent-question handling explicit (different KB entry → use that, apply scope rule again; nothing relevant → INSUFFICIENT DATA).

- **Standing Rule 1 satisfied for all three files.** Pattern 22 reads at session open: `git show v1.4.2:backend/lib/system-prompt.js`, `git show v1.4.2:backend/lib/kb.js`, `git show v1.4.2:backend/server.js` all read into context before any generation. No surprise findings — all three files matched journal references exactly. V1.4.2 baseline confirmed at commit `7bd77e6` via `git show v1.4.2 --no-patch --format` pre-generation.

- **Standing Rule 2 N/A this session — no frontend changes.** Both V1.4.3 changes are backend-only. UPunt and StreamlineAI frontends unchanged. Hard-refresh not required for V1.4.3 ship gate.

- **kb.js doc-comment scope discipline maintained.** Side-pass cleanup folded into V1.4.3 ship (D1 instruction Session 25 — no separate session for comments). Diff inspection confirmed every `+`/`-` line in kb.js was a `//` comment line. Functional code preserved byte-identical.

**Broken — V1.4.3 directive does not hold on primary target:**

Five-test smoke at session close. **Two of three directive-testable cases fail.** Directive is provably present in deployed prompt (verified via `/admin/debug/system-prompt/streamlineai` — full VERBATIM RESPONSE SCOPE block including all three anti-patterns visible). Retrieval correctly surfaces the VERBATIM entries for Tests B and D. Model sees the rule, sees the entry, and extends the quote anyway on Tests B and C.

| Test | Prompt | Result | Notes |
|---|---|---|---|
| A | "What does StreamlineAI do?" → "How much do the streamline AI products cost?" | FAIL | Retrieval miss — Entry 10 not in CONTEXT. V1.4.2 retrieval calibration gap, separate from V1.4.3 scope. |
| B | "I'm not technical, can I still use this?" | **FAIL** | Entry 19 quoted verbatim. Then: "That's straight from Gareth. Most of our clients aren't technical — the tools are built to be simple to use, not impressive to look at." First sentence passes V1.4.3 shape (2). Second sentence is **anti-pattern (b)** — synthesised supportive prose, no fabricated values, no trace to CONTEXT. |
| C | "What does StreamlineAI do?" | **FAIL** | Entry 1 quoted verbatim. Then: "That's Gareth's take. We've got four main products — LeadLock, TriageIQ, NewsletterIQ, and ChatbotIQ — plus custom builds when something specific doesn't fit the off-the-shelf options." Second sentence is **anti-pattern (c)** — "what this means in practice" elaboration introducing product names that may exist in other KB entries but are not in this CONTEXT block. |
| D | "How much does it cost?" | PASS | Entry 10 quoted verbatim. Trailing "What kind of business are you running?" is a content-free transition (V1.4.3 shape 2). Single-turn pricing control clean. |
| E | "What's your phone number?" | PASS (with calibration note) | INSUFFICIENT DATA branch alive — bot did not invent a phone number, redirected to operator booking. Voice-shaped redirect rather than literal "INSUFFICIENT DATA — [reason]" opener. V1.4.1 prompt expects the literal signal string; current behaviour skips to voice-shaped redirect. Operator-facing this works; for log-mining the literal signal would be more useful. Separate calibration question, not V1.4.3 scope. |

**Test A retrieval finding (separate from V1.4.3 directive failure):**

Retrieval endpoint output for query `"How much do the streamline AI products cost"`:
- Hit 1: `f23af807...` VERBATIM "Can you build something custom?" rank `0.17022`
- Hit 2: `efbf2d91...` REFERENCE "What does 'client trains the AI' mean?" rank `0.133744`
- Hit 3: `17a413d6...` VERBATIM "What's StreamlineAI's philosophy on AI for small business?" rank `0.133744`

Entry 10 (`710e7688...`, the pricing VERBATIM) not in top 3. Single-turn `"How much does it cost?"` surfaces Entry 10 at rank `0.303964` (control test confirmed). Extra tokens `streamline`, `AI`, `products` in the Test A query split rank weight across entries that lexically match those terms, pushing Entry 10 below the floor or out of the top 3. V1.4.2 hybrid AND-then-OR works for the original Session 25 query but doesn't cover this paraphrase.

This is V1.4.2 retrieval calibration scope, not V1.4.3 directive scope. Logged for D1 sequencing decision (V1.4.4 retrieval calibration pass vs V1.5 priorities).

**Diagnostic hypotheses for Tests B and C directive failure:**

Three candidate causes, in order of plausibility:

1. **Tonal pressure overrides rule pressure.** Voice profile contains "Acknowledge the prospect's situation back to them in your own words before answering" as an active style instruction (line 12 of the voice profile rendering in the prompt). Voice profile is placed last in the cached block per the existing comment ("Placed last in the cached block so the model attends to it most strongly"). The model honours the voice instruction over the scope rule because the voice instruction comes after VERBATIM RESPONSE SCOPE in the prompt and Pattern 8 says models attend most strongly to information near the end. Test D passes because pricing has a definitive numeric answer with no obvious tonal pull to extend; Tests B and C answer questions where there's natural pull to elaborate ("can I still use this?" wants reassurance; "what does StreamlineAI do?" wants description).

2. **Directive placement.** V1.4.3 VERBATIM RESPONSE SCOPE sits in the middle of the prompt with INSUFFICIENT DATA, hard guardrails, and voice profile all coming after it. Same Pattern 8 logic as (1) — the rule is far from the response position.

3. **Anti-pattern wording too abstract for self-classification.** The directive describes the failure shapes correctly in abstract terms but the model doesn't classify its own output ("Most of our clients aren't technical — the tools are built to be simple to use") as matching the description "synthesised supportive prose." It may classify the same output as "voice-shaped acknowledgement" — which the voice profile actively encourages.

The structural shape of the problem is a tension between two prompt instructions that both fire: voice profile says acknowledge in own words; VERBATIM RESPONSE SCOPE says do not extend with non-CONTEXT content. The bot resolves the tension toward voice. V1.4.3 wording revisions alone unlikely to resolve — would require either directive relocation (move to end of prompt, after voice profile), voice profile revision (carve out a VERBATIM exception in the "acknowledge in your own words" instruction), or structural change (post-stream output validator that strips non-CONTEXT extension before token streaming).

This is **outside V1.4.3 scope** to fix. Session 26 ships V1.4.3 as deployed-but-not-effective on its primary target. Decision on what V1.4.4 looks like is a D1 call.

**D2 discipline failures this session — both logged for journal:**

1. **Diff-syntax-as-paste error.** I presented `server.js` edits as diff blocks (`-old line` / `+new line`) in chat. Operator pasted the diff markers literally into the file. Railway deploy crashed on `SyntaxError: Unexpected identifier 'express'` (parser failed on `-//` and `+//` lines, cascaded to first identifier it could name). Diff syntax is a display convention, not file content. Should have given final file content from the start. **Recovery cost:** one Railway crash, one tag-rebuild cycle, ~15 minutes. Logged as Standing Rule 4 candidate (1/2 proofs): "When generating code for the operator to paste, give the final file content, never diff representation. `-`/`+` prefixes are display markers, not source." Sibling to Standing Rules 1, 2, 3.

2. **Pre-flight retrieval check skipped.** V1.4.1 added the `/admin/debug/retrieval` endpoint specifically to verify retrieval before chat-surface smoke tests. Session 26 ran Test A as a chat test first, found the failure, then ran the retrieval endpoint to diagnose. Should have run the retrieval endpoint as a pre-flight before any chat smoke — would have caught the Test A retrieval gap in ~30 seconds without needing the chat session. **Recovery cost:** ~5 minutes plus user confusion about whether the directive was failing or retrieval was failing. Logged as Standing Rule 5 candidate (1/2 proofs): "Use diagnostic endpoints as pre-flight before chat-surface smoke tests when available." Sibling to existing rules — same shape as "verify state before testing."

3. **Inferred from journal references rather than reading source.** Mid-session, during auth diagnostic, I reasoned about `lib/auth.js` middleware behaviour from journal references (Session 22 line 631, Session 23 line 707) rather than reading the actual file. Caught myself and pivoted to `git show v1.4.2:backend/lib/auth.js`. No deploy cost — pivot happened before any code change — but the discipline lapse is the same class as Standing Rule 1's origin (Session 18 V1.1 build). Logged as same-class-as-existing.

**Recovery cycle notes:**

- Stale-tag drift fired once at Step 4 (Standing Rule 3 candidate). `git add` was missing from the commit sequence; commit ran with nothing staged; `git tag v1.4.3` tagged HEAD which was still V1.4.2 (`2a23783` problem). Recovery: deleted local + remote tag, re-staged + re-committed + re-tagged. Standing Rule 3 candidate now has **second proof firing in same session** (different mechanism vs Session 23's stale-pre-existing-tag, but same class: tag landed on wrong commit). D1 to decide promotion path.

- Diff-marker contamination crash at Step 5. Recovery: regenerated full `server.js` as artefact, replaced entirely (not str_replace), re-committed at `4f740d3`. The recovery also surfaced that the operator's manual application of the prior diff snippets had **deleted the boot `for` loop** that logs each deployment's prompt size — not just contaminated the file with diff markers but lost code. Regenerated file restored the loop from V1.4.2 baseline.

- Token-format misadventure at Step 7 diagnostic. Operator pasted curl placeholder syntax `<token>` literally; then 65-char token (extra `9` from copy); then 66-char token (literal `<` and `>` from my example). Eventually resolved with `$token = "..."` variable assignment + `$token.Length` check. **Tooling lesson for next session:** when giving paste-ready commands with token substitution, build the assignment as a script step rather than inline placeholder.

**Cost / spend state:**

- V1.4.3 prompt grew +2339 chars per deployment. Per-turn cost increase: cache write on first turn of a session is slightly larger; cache reads on subsequent turns unchanged in pricing model. Negligible at current scale.
- Session 26 chat smoke test consumed 5 fresh sessions + 3 retrieval diagnostic calls. Token cost ~$0.20 total estimated.
- `chatbotiq-dev` API key cap unchanged at $40/month.
- `chatbotiq-prod` API key still not created — StreamlineAI public-chat traffic remains testing-only scale.
- Railway: still on Hobby trial. Calendar reminder for upgrade by 24 May 2026 stands.

**Build Standards check:**

- #1 prompt caching — V1.4.3 grew per-deployment prompts +2339 chars (universal engine content added to KB rendering rules). Cache machinery unchanged — per-deployment `Map<slug, string>` cache still hits on identical strings within a session.
- #2 structured error handling — unchanged.
- #3 response validation — unchanged.
- #4 streaming — unchanged.
- #5 stop_reason router — unchanged.
- #6 pre-deployment checklist — passed Architecture and Operations gates. **Failed Testing gate:** Tests B and C fail. Operator decision required on whether V1.4.3 ships "as deployed" with known directive limitation or rolls back. D2 recommendation below.

**Standing rules check:**

- Rule 1 (verify prior version's exports before extending) — satisfied. Three Pattern 22 reads at session open. Plus a fourth (`auth.js`) mid-session when diagnostic required.
- Rule 2 (hard-refresh after frontend deploy) — N/A this session, no frontend changes.

**Files changed at V1.4.3:**

- Modified: `backend/lib/system-prompt.js`, `backend/lib/kb.js`, `backend/server.js`
- Tag: `v1.4.3` at commit `4f740d3` (after recovery from initial `2a23783` diff-marker-contamination crash)

**Next:** Handback to D1 below. Session 27 scope depends on D1 decision on whether V1.4.4 attempts a structural fix for the directive-vs-voice-profile tension, defers to V1.5, or rolls back to V1.4.2.

**Open questions for D1 (carried forward, plus new this session):**

- **V1.4.3 directive failure on primary target — D1 decision required.** Handback below.
- **V1.4.4 retrieval calibration scope.** Test A revealed V1.4.2 retrieval doesn't surface Entry 10 for paraphrases like "How much do the streamline AI products cost?" Separate from V1.4.3 directive scope. D1 to sequence vs V1.5 priorities.
- **Standing Rule 3 promotion (stale-tag / tag-on-wrong-commit).** Second proof confirmed this session — different mechanism (missing `git add` before commit vs pre-existing stale tag), same class. D1 to decide whether to promote to methodology doc as Pattern 12 sibling, or hold for third proof.
- **Standing Rule 4 candidate.** "When generating code for the operator to paste, give the final file content, never diff representation." First proof this session. Held at candidate.
- **Standing Rule 5 candidate.** "Use diagnostic endpoints as pre-flight before chat-surface smoke tests when available." First proof this session. Held at candidate.
- Methodology doc v1.2 batch update — queue is now five items (Pattern 1 rename, Pattern 22 promotion body, testbed-scaffolding corollary, Pattern 24 → Pattern 11 promotion, Pattern 23 → Pattern 12 promotion) plus three V1.4.3 standing-rule candidates above.
- INSUFFICIENT DATA literal-signal calibration. Test E revealed bot redirects in voice but skips the literal "INSUFFICIENT DATA — [reason]" opener. V1.4.1 prompt expects the signal string for log-mining. Separate calibration question, V1.5 or later.
- Master file frozen-deployment clarification (Session 25 carry-forward). D1 still to update Operating Discipline section.
- KB curation pause extension — was "until V1.4.3 multi-turn VERBATIM precedence holds." V1.4.3 directive does NOT hold. D1 to decide whether curation can resume against the partially-broken state or remains paused.
- UPunt frontend version label V1.2 cosmetic update — still carried.
- Custom domain `chat.streamlineai.net.au` — deferred to post-KB-curation per Session 22 SAQ-4.

---

### HANDBACK TO D1 — V1.4.3 directive failure on primary target

**Context:**

V1.4.3 shipped to V1.4 spec at commit `4f740d3`, tag `v1.4.3`. Directive verified live in deployed prompt for both deployments. Smoke test of three Session 25 failure cases (Tests B, C — directive-testable; Test A — retrieval-bound) plus two controls (Test D single-turn pricing, Test E INSUFFICIENT DATA):

- Tests D and E pass.
- Test A fails on retrieval (separate scope).
- **Tests B and C fail on directive.** Both quote the VERBATIM entry correctly, then extend with anti-pattern (b) or (c) content explicitly named-and-forbidden by the V1.4.3 directive that's live in the prompt.

The directive is present. The retrieval surfaces the right entry. The model reads the rule and violates it.

Structural diagnosis: the voice profile's "Acknowledge the prospect's situation back to them in your own words before answering" instruction tensions against VERBATIM RESPONSE SCOPE. Voice profile is placed last in the cached block (per existing engineering comment, deliberately) so the model attends to it strongly. Test D passes because pricing has no tonal pull to extend; Tests B and C answer questions with natural pull to elaborate (reassurance, description).

V1.4.3 wording revisions alone unlikely to resolve. The fix is one of: directive relocation, voice profile revision, or structural change (post-stream output validator).

**Question for D1 (framed as decision with options):**

1. **V1.4.4 — directive relocation.** Move VERBATIM RESPONSE SCOPE to end of system prompt, after voice profile. Cost: ~15 minutes. Risk: minimal — same content, different position. Test cost: re-run Tests B, C, D, E. Plausibility of success: moderate — Pattern 8 attention argument is consistent but unproven.

2. **V1.4.4 — voice profile carve-out.** Add to voice profile's "acknowledge in your own words" instruction: "EXCEPT when a VERBATIM entry is quoted — in that case, the quote stands alone and acknowledgement is a content-free transition only, per VERBATIM RESPONSE SCOPE." Cost: ~30 minutes (touches CONFIG, requires D1 voice-profile sign-off). Risk: moderate — voice profile is operator-curated content (Pattern 5), this is engine-side directive bleeding into voice profile space. Plausibility of success: higher than (1) because directly addresses the tension.

3. **V1.4.4 — structural: post-stream output validator.** Add a Build Standard #3-shaped validator that runs after stream completes, before persistence and `done` event. If response contains a VERBATIM quote (detectable: quoted block with attribution) followed by content not traceable to any CONTEXT entry, log validation_warning, optionally truncate the extension before persistence. Cost: ~2-3 hours — new file, integration with chat handler, traceability check against CONTEXT block. Risk: high — first time we're adding response-modification logic in the chat path, not just observation. Plausibility of success: very high if implemented correctly but introduces new failure surface.

4. **Defer V1.4.4 — accept current state and resume KB curation.** Document V1.4.3 as "directive deployed, holds on single-turn factual questions, drifts on multi-turn or reassurance-shaped questions." Resume KB curation against the partially-broken state. Plan structural fix for V1.5 alongside scheduled ingestion or other surface work. Cost: zero D2 time. Risk: bot ships to public traffic with known guardrail violation — hard guardrail #1 ("Never invent pricing not in the KB") still works because Test A's failure is retrieval not directive, but anti-pattern (b)/(c) failures are observable in any reassurance-shaped or descriptive-shaped question.

5. **Rollback V1.4.3.** Revert to V1.4.2 baseline at commit `7bd77e6`. Cost: ~5 minutes (one git revert + redeploy). Risk: returns to V1.4.2 state where Session 25 Step 4 turn 2 failure (multi-turn pricing fabrication including fabricated retainer values) is also in scope. Worse than current V1.4.3 state.

**Recommendation:**

Option 2 (voice profile carve-out) is the cheapest plausible fix and directly addresses the diagnosed tension. Pattern 5 concern is real — engine-side directives shouldn't leak into voice profile space — but the carve-out can be framed as a voice profile instruction *about how voice profile applies in a specific context*, which is voice profile's own concern. Worth one V1.4.4 attempt at Option 2 before reaching for Option 3.

If Option 2 fails at V1.4.4 smoke, Option 3 becomes the path. Option 3 is the only option whose plausibility of success is "very high."

Option 1 is cheap to try alongside Option 2 — could be combined into a single V1.4.4 ship (relocate directive AND add voice profile carve-out).

Options 4 and 5 are not recommended. Option 4 leaves a public-facing guardrail violation in place; Option 5 reverts to a strictly-worse failure mode.

**Status until D1 resolves:** V1.4.3 deployed at Railway and serving traffic with the known directive failure on multi-turn / reassurance-shaped / descriptive-shaped questions. Single-turn factual questions (pricing, INSUFFICIENT DATA path) work correctly. KB curation paused per existing Session 25 instruction until V1.4.3 multi-turn VERBATIM precedence holds — D1 to confirm whether that gate now reopens partially or remains closed.

D2 awaiting D1 decision on V1.4.4 path before opening next build session.

---

### Session 27 — 11 May 2026 — V1.4.4

**Built:** VERBATIM RESPONSE SCOPE block relocation + voice profile carve-out shipped as V1.4.4 at commit `f66cfce`, tag `v1.4.4`. Four files changed. Engine-level fix universal across deployments (UPunt and StreamlineAI both grew by identical +1539 char delta vs V1.4.3 — Pattern 5 intact).

V1.4.4 changeset:

- Modified: `backend/lib/system-prompt.js` — VERBATIM RESPONSE SCOPE block extracted from KB BEHAVIOUR section and placed as a new top-level section AFTER the voice profile. KB BEHAVIOUR retains VERBATIM PRECEDENCE (substitution rule) and NEVER FABRICATE (content rule) — these govern content, not response shape. Section gets a forward-pointer sentence at its end so model knows the scope rule exists when reading content rules. VERBATIM RESPONSE SCOPE block opens with a one-sentence preamble making the relocation rationale explicit to the model ("The rule is the last rule in this prompt deliberately — it takes precedence over the voice profile's stylistic instructions whenever the two would produce different response shapes"). Anti-pattern (b) gets an inline amplifier sentence naming the voice-profile-vs-scope-rule tension directly. New "Voice profile precedence carve-out" paragraph inside the block explicitly states voice still shapes framing sentences but does not license additional sentences of synthesised content. All three named anti-patterns (a/b/c) and the multi-turn invariance clause preserved verbatim from V1.4.3.

- Modified: `backend/config/streamlineai.js` — voice profile `style` field gets a trailing two-sentence carve-out: "EXCEPT when a VERBATIM entry from the CONTEXT block answers the question — in that case the quote stands alone, acknowledgement is a content-free transition only, no elaboration on the quoted content. See VERBATIM RESPONSE SCOPE for the full rule." Exact wording per session brief.

- Modified: `backend/config/upunt.js` — same carve-out as `streamlineai.js`, applied as a third paragraph after the existing "Punta's voice carries personality only when there's something to say" passage. UPunt's existing style had no explicit "acknowledge in your own words" instruction (different voice from StreamlineAI's prospect-focused style), but engine-level consistency means both deployments take the same VERBATIM-scope amendment.

- Modified: `backend/server.js` — version label `1.4.3` → `1.4.4` in `/health` endpoint and boot log line. Header comment block updated. No behaviour change.

Prompt sizes after V1.4.4: UPunt `12727`, StreamlineAI `15381`. Both deployments grew by exactly `+1539` chars (V1.4.3 was 11188 / 13844). Identical delta across deployments confirms engine-level universal fix per Pattern 5.

**Decided:**

- **Option 1 + Option 2 combined per D1 Session 27 directive.** Session 26 handback options 3 (post-stream output validator, ~2-3 hours, new failure surface) and 4 (defer to V1.5) rejected. Option 1 (directive relocation, low cost, low risk, moderate plausibility) and Option 2 (voice profile carve-out, moderate cost, moderate risk, higher plausibility) combined to reinforce the fix from both sides. Pattern 8 attention-weighting argument used in two directions: voice profile remains near-last (still strongly attended), VERBATIM RESPONSE SCOPE now sits truly last (the rule the voice must yield to is the rule the model encounters last, immediately before generating).

- **Engine vocabulary in voice profile CONFIG accepted per Pattern 5 ownership argument.** Session 26 flagged Option 2 as "moderate risk — voice profile is operator-curated content (Pattern 5), this is engine-side directive bleeding into voice profile space." D1 Session 27 ruled the trade explicitly: Pattern 5 is about WHO owns the field, not what vocabulary appears in it. Voice profile is operator-curated CONFIG; D1 owns the field; D1 approves the wording. Softer language ("when a direct quote from your knowledge base answers the question") loses precision exactly where precision matters — Pattern 11 (vague permissive scope gets read liberally by the model) directly applies. Engine vocabulary stays. Cost: future operators curating their own voice profile need to understand what "VERBATIM" and "CONTEXT block" mean. That's a documentation burden for the operator onboarding questionnaire / voice profile authoring guide — to write when second paying-client deployment surfaces, not now.

- **UPunt carve-out applied with same engine vocabulary as StreamlineAI** despite UPunt's style having no explicit "acknowledge in your own words" instruction. Engine-level consistency over per-deployment customisation for response-shape constraints — the carve-out is defensive across deployments. Punta's "bit of colour and personality" disposition can produce the same extension drift the StreamlineAI Tests B and C hit; the carve-out applies the same constraint as a precaution.

- **Standing Rule 1 satisfied for all four files.** `git show v1.4.3:backend/lib/system-prompt.js`, `git show v1.4.3:backend/config/streamlineai.js`, `git show v1.4.3:backend/config/upunt.js`, `git show v1.4.3:backend/server.js` all read into context before any generation. User pasted file contents from `git show` outputs directly into chat. No memory-based assumptions on file shape.

- **Standing Rule 2 N/A this session — no frontend changes.** Both V1.4.4 changes are backend-only. UPunt and StreamlineAI frontends unchanged. Hard-refresh not required for V1.4.4 ship gate.

- **Standing Rule 3 applied successfully.** Pre-tag check at deployment Step 2: `git tag -l v1.4.4` and `git ls-remote --tags origin v1.4.4` both empty before tagging. Post-tag verification: `git ls-remote --tags origin v1.4.4` shows `f66cfcec5450a2a717ff11200e96200cbad3910f refs/tags/v1.4.4` — tag landed on the correct commit (matching the push output `4f740d3..f66cfce main -> main`). First session where Standing Rule 3 fired pre-emptively and prevented a stale-tag failure rather than catching one in flight.

- **Standing Rule 5 candidate applied successfully.** Diagnostic-endpoint pre-flight executed before chat smoke test: `/admin/debug/system-prompt/{slug}` for both deployments to verify directive position; `/admin/debug/retrieval/streamlineai?query=...` for each of the four test prompts to confirm retrieval surfacing. All four retrieval pre-flights passed before chat smoke ran. Second proof for the candidate — first proof was Session 26 where the pre-flight was suggested in hindsight; Session 27 ran it as scheduled discipline. D1 to decide promotion path at session-end review.

**Smoke retest at session close — V1.4.4 SHIPS:**

| Test | Prompt | Result | Notes |
|---|---|---|---|
| B | "I'm not technical, can I still use this?" | **PASS** | Bot quoted Entry `b28eaf05...` ("You only need basic computer skills — if you can check emails and open a browser, you'll be fine.") verbatim with Gareth attribution. ZERO framing — quote-only response. V1.4.3 anti-pattern (b) failure ("Most of our clients aren't technical — the tools are built to be simple to use, not impressive to look at") closed. |
| C | "What does StreamlineAI do?" | **PASS** | Bot quoted Entry `e6b77867...` (literal "What does StreamlineAI do?" VERBATIM — "StreamlineAI helps businesses use AI in practical ways...") verbatim with Gareth attribution. ZERO framing — quote-only response. V1.4.3 anti-pattern (c) failure ("We've got four main products — LeadLock, TriageIQ, NewsletterIQ, and ChatbotIQ — plus custom builds") closed. |
| D | "How much does it cost?" | **PASS** (regression check) | Bot quoted Entry `710e7688...` (pricing VERBATIM) verbatim with attribution. ZERO framing this time — V1.4.3 had a trailing transition question, V1.4.4 dropped even that. Stricter shape than V1.4.3 but well within the rule (framing is *at most* one sentence; zero framing is valid). No regression. |
| E | "What's your phone number?" | **PASS** (regression check + partial signal-string fix) | Literal "INSUFFICIENT DATA — phone number isn't in the knowledge base I have access to." opener present. Session 26 V1.4.3 produced voice-only redirect without the literal signal; V1.4.4 surfaces it. Variance or relocation-strengthened-all-final-position-rules — either way the V1.5 signal-string calibration candidate may have natural resolution. Capture offer references "the contact form on streamlineai.net.au" which isn't in CONTEXT for this zero-hit query — flagged as a known-fact-about-domain reference in the INSUFFICIENT DATA branch, not a VERBATIM-scope violation (scope rule governs VERBATIM-anchored responses, not refusal branches). |

The directive holds. Voice profile carve-out + relocated VERBATIM RESPONSE SCOPE + anti-pattern (b) amplifier sentence stack proved out on the two Session 26 failure cases. Engine-level fix verified on both deployments.

**Multi-VERBATIM observation (carry-forward):**

Test C retrieval returned three VERBATIM entries tied at rank 0.66872 — `6660d663...` (differentiation), `daabb803...` (origin story), `e6b77867...` (literal services overview). Bot quoted the literal-question-match entry. Same behaviour observed Session 25 Step 4 turn 1 (pricing scenario, multi-VERBATIM tie, bot picked the literal match by inference). VERBATIM PRECEDENCE directive doesn't explicitly cover "which one to quote when multiple are tied" — bot got it right by inference. Second proof for the Session 25 V1.5 calibration candidate. Logged as observation, not a bug.

**Tooling discipline failures this session (three instances, same class):**

Three diagnostic-tooling failures surfaced and were caught by the operator's screenshots before they affected production. All three were the same class — inferring API surfaces from memory rather than reading source.

1. **Wrong header name.** I gave `x-admin-token` as the admin auth header. Real header is `Authorization: Bearer <token>`. Caught by operator paste of `auth_failure` response with explicit suggestion field.

2. **Wrong response key.** I gave `$resp.system_prompt` as the prompt field. Real field is `$resp.prompt`. Caught when `Set-Content` wrote two zero-byte files; operator pasted `$sa | ConvertTo-Json -Depth 5` which surfaced the real response shape.

3. **PowerShell variable-name boundary.** I gave `"$base?query=..."` without subexpression delimiters. PowerShell parses `?` as part of variable name in some contexts, so `$base?query` was treated as one (empty) variable name. Result: URL starting with `=` instead of `https://`. Caught by operator paste of malformed `$url` output. Fixed with `"$($base)?query=..."` subexpression form.

All three failures are sibling-shape to Standing Rule 1 (verify prior version's exports before extending) and Pattern 22 (verify state before extending) but applied to a different surface: API contracts, response shapes, language-tooling parsing rules. Standing Rule 1 protects against memory-based assumptions about CODE SHAPE; these failures are memory-based assumptions about TOOL/API SHAPE.

**Standing Rule 6 candidate logged:** "Verify diagnostic command syntax before sending to operator." Three proofs in one session is unusually concentrated — would be three sessions' worth of proof under normal rate. Could be a session-specific concentration (lots of new diagnostic surfaces this session) or could indicate a broader gap. D1 to assess whether this is sibling-class to Standing Rule 1 (same shape, different surface) or independent. Recommendation: candidate status, monitor for additional proofs in next 2-3 sessions before deciding whether it's a real recurring class or a Session 27 concentration.

The cost of each failure was low — operator caught it within one screenshot cycle, no production impact, total recovery time ~5 minutes across all three. But the discipline lapse is real: when an operator is following a build session step-by-step against production infrastructure, diagnostic-command shape that fails on first try wastes operator attention and erodes trust. The operator-side feedback loop is the only safety net here, and it shouldn't have to fire three times in one session.

**Pattern 5 universality check passed:**

The +1539 char delta was identical across UPunt (11188 → 12727) and StreamlineAI (13844 → 15381). Both deployments received the same engine content (relocated VERBATIM RESPONSE SCOPE block + amplifier sentence + carve-out paragraph) and the same CONFIG-level carve-out (voice profile style amendment). Engine code is shared by Pattern 5 design; fork at this layer would violate it. CONFIG fields rendered through the same `renderVoiceProfile()` function regardless of deployment.

**Frozen-deployment operating discipline applied:**

Per Session 25 ruling ("Frozen deployment definition: no active KB curation, no calibration patches, no smoke-test commitment. Engine improvements that apply universally still flow through — frozen does not mean forked"), UPunt received the engine-level fix (system-prompt.js relocation) and the engine-level CONFIG amendment (voice profile carve-out) without UPunt-specific smoke testing this session. UPunt remains frozen at content level; engine improvements continue to flow.

**Cost / spend state:**

- V1.4.4 system prompts grew +1539 chars per deployment. Per-turn cost increase: cache write on first turn of a session is slightly larger; cache reads on subsequent turns unchanged in pricing model. Negligible at current scale.
- Session 27 smoke test consumed 4 fresh chat sessions + 4 retrieval diagnostic calls + 2 system-prompt diagnostic calls. Token cost estimated ~$0.15-0.20 total.
- `chatbotiq-dev` API key cap unchanged at $40/month.
- `chatbotiq-prod` API key still not created — StreamlineAI public-chat traffic remains testing-only scale.
- Railway: Hobby trial, 18 days remaining (per dashboard screenshot earlier this session). Calendar reminder for upgrade by 24 May 2026 stands; ~14 days notice.

**Build Standards check:**

- #1 prompt caching — V1.4.4 grew per-deployment prompts +1539 chars (universal engine content added). Cache machinery unchanged — per-deployment `Map<slug, string>` cache still hits on identical strings within a session.
- #2 structured error handling — unchanged. (`auth_failure` validated end-to-end during diagnostic-tooling missteps — error shape held with explicit `suggestion` field that named the right header to use. Working as designed.)
- #3 response validation — unchanged.
- #4 streaming — unchanged.
- #5 stop_reason router — unchanged.
- #6 pre-deployment checklist — passed Architecture, Operations, and Testing gates. V1.4.4 SHIPS.

**Standing rules check:**

- Rule 1 (verify prior version's exports before extending) — satisfied. Four `git show v1.4.3:` reads at session open via user paste. No memory-based assumptions on file shape.
- Rule 2 (hard-refresh after frontend deploy) — N/A this session, no frontend changes.
- Rule 3 (verify tag namespace state before tagging) — satisfied pre-emptively. `git tag -l v1.4.4` and `git ls-remote --tags origin v1.4.4` both confirmed empty before commit-and-push. Post-tag verification confirmed tag landed on correct commit `f66cfce`. First session where Rule 3 fired proactively and prevented a stale-tag class failure rather than catching one mid-flight.
- Rule 5 candidate (diagnostic endpoints as pre-flight before chat-surface smoke) — applied per session brief. Pre-flight Step 1 (system-prompt verification) caught zero issues — both deployments structurally clean. Pre-flight Step 2 (retrieval verification) confirmed all four test queries surfacing expected VERBATIM entries before chat smoke ran. Second proof for the candidate.

**Files changed at V1.4.4:**

- Modified: `backend/lib/system-prompt.js`, `backend/config/streamlineai.js`, `backend/config/upunt.js`, `backend/server.js`
- Tag: `v1.4.4` at commit `f66cfce` (verified on remote: `f66cfcec5450a2a717ff11200e96200cbad3910f refs/tags/v1.4.4`)

**Side-pass cleanup at session close:**

Four diagnostic artefact `.txt` files removed from working tree (`streamlineai-prompt-v144.txt`, `upunt-prompt-v144.txt`, `backend/auth-v142.txt`, `backend/prompt.txt`). All four were untracked — removal is local-only, no git operation needed. Pattern 9 (KB hygiene) extension: working-tree hygiene matters as much as KB hygiene. Repo root and `backend/` shouldn't accumulate diagnostic dumps between sessions.

**Next:** Session 28 scope depends on D1 review of V1.4.4 ship and resumption of KB curation (paused since pre-V1.4.3 per Session 25 / 26 / 27 cycle). Likely candidates:

1. Resume KB curation against the now-V1.4.4 engine — multi-turn precedence holds, content curation can proceed.
2. V1.4.5 retrieval calibration pass — Session 26 Test A retrieval gap ("How much do the streamline AI products cost?" paraphrase) still unresolved. V1.4.2 RPC handles original-form query but extra tokens split rank weight.
3. V1.5 scheduled-ingestion (NewsIQ variant) — staging item.

D1 to sequence.

**Open questions for D1 (carried forward + new this session):**

- **Session 26 carry-forwards now resolved by V1.4.4:**
  - V1.4.3 directive failure — RESOLVED. V1.4.4 shipped, Tests B and C pass.
  - KB curation pause extension — D1 to decide whether to resume against V1.4.4 engine. Tests B and C close the multi-turn extension class; pricing fabrication class closed at V1.4.1; case-3 scope class closed at V1.3.2. Engine is at the most disciplined point in its history.

- **V1.4.5 retrieval calibration scope.** Session 26 Test A revealed V1.4.2 retrieval doesn't surface Entry 10 for paraphrases like "How much do the streamline AI products cost?" Carried forward from Session 26 — D1 to sequence vs V1.5 priorities.

- **Standing Rule 3 promotion status.** Second proof of stale-tag/tag-on-wrong-commit logged Session 26 (commit-without-stage producing tag on wrong commit). Session 27 was first session where Rule 3 ran proactively and produced empty pre-tag check + correct-commit post-tag verification — third proof, this time as prevention rather than recovery. D1 to decide promotion to methodology doc.

- **Standing Rule 4 candidate** ("When generating code for the operator to paste, give the final file content, never diff representation") — first proof Session 26. No additional proof Session 27. Held at candidate, awaiting second occurrence.

- **Standing Rule 5 candidate** ("Use diagnostic endpoints as pre-flight before chat-surface smoke tests when available") — first proof Session 26 (hindsight identification of the discipline that would have caught Test A in 30 seconds without a chat session). Second proof Session 27 (applied as scheduled discipline per session brief; caught zero issues but functioned as designed). D1 to decide promotion to methodology doc — sibling-shape to Pattern 23 (verify runtime state matches deployed state before depending on it) but on a different surface.

- **Standing Rule 6 candidate** ("Verify diagnostic command syntax before sending to operator") — first proof Session 27 with three same-session instances (Authorization header, response key, PowerShell variable-name boundary). Concentration may be Session 27-specific (lots of new diagnostic surfaces) rather than indicating a broader recurring class. D1 to assess whether this is sibling-class to Standing Rule 1 (same shape, different surface — memory-based assumption about TOOL/API SHAPE rather than CODE SHAPE) or independent. Recommendation: candidate status, monitor 2-3 sessions before deciding.

- **Multi-VERBATIM-tie calibration (V1.5 candidate).** Second proof confirmed Session 27 Test C — bot picked correct VERBATIM by inference when three entries tied at identical rank. V1.5 calibration item: explicit VERBATIM PRECEDENCE rule for "which one to quote when multiple match."

- **INSUFFICIENT DATA branch and content references.** Test E response referenced "the contact form on streamlineai.net.au" — not in CONTEXT for the zero-hit query. Allowed under current VERBATIM RESPONSE SCOPE wording (scope rule governs VERBATIM-anchored responses, INSUFFICIENT DATA RULE governs refusal branches). D1 to decide whether the same strict line should apply to refusal-branch content references — could be a V1.5+ tightening if drift surfaces, or could be acceptable as "domain-known facts in the refusal-and-capture pattern."

- **Methodology doc v1.2 batch update queue** — five items carried from Session 25, plus three V1.4.3 candidates from Session 26, plus three V1.4.4 candidates from Session 27. Total queue: 11 items. D1 to schedule batch update.

- **Master file frozen-deployment clarification** (Session 25 carry-forward) — still pending. D1 to update Operating Discipline section.

- **UPunt frontend version label V1.2 cosmetic update** — still carried.

- **Custom domain `chat.streamlineai.net.au`** — deferred to post-KB-curation per Session 22 SAQ-4. Gating may lift now V1.4.4 ships.

---

### Session 30 — 12 May 2026 — V1.4.5

**Built:** V1.4.5 shipped at commit `535b480`, tag `v1.4.5`. Scope expanded mid-session from briefed three items to five items per D1 mid-session expansion. Four shipped, one deferred to V1.4.6 with locked scope.

V1.4.5 changeset:

- Modified: `admin-frontend/index.html` — header version label `V1.3.3` → `V1.4.5` (line 12). Source-tag placeholder `admin-form-v1.3.3` preserved (data-lineage semantics, not cosmetic — D1 Decision 1).
- Modified: `streamlineai-chat-frontend/index.html` — header version label `V1.4` → `V1.4.5` (line 11). StreamlineAI public chat frontend was V1.4 not V1.4.4; backend-only patches V1.4.1 through V1.4.4 left frontend label silently behind (Standing Rule 2 wording-extension candidate — see below).
- Frontend `frontend/index.html` (UPunt public chat) intentionally NOT touched — frozen surface per Session 25 frozen-deployment definition. Currently shows V1.2.

Three Netlify Function proxy migrations shipped outside the git repo (NewsletterIQ + LeadLock NP Support + LeadLock StreamlineAI). Two new Anthropic keys generated (leadlock-npsupport, leadlock-streamlineai) alongside session-start newsletteriq-prod. Three new local source folders: `C:\Users\gphi9\CODE\NEWSLETTERIQ-PROXY`, `C:\Users\gphi9\CODE\LEADLOCK-NPSUPPORT-PROXY`, `C:\Users\gphi9\CODE\LEADLOCK-STREAMLINEAI-PROXY`. Each contains identical `netlify/functions/proxy.js` (Anthropic passthrough), identical `netlify.toml` (functions dir + Node 20 esbuild config), and per-deployment patched `index.html`. Proxy.js is structured-error compliant per Build Standard #2 (`{status, type, message, suggestion, recoverable}` shape).

Architecture: each proxy reads `ANTHROPIC_API_KEY` from Netlify env var (per-project, secret-marked, scoped Builds/Functions/Runtime, 4 deploy contexts populated with Local development empty per security discipline). Frontend HTML POSTs to `/.netlify/functions/proxy` with `{model, max_tokens, system, messages}` body; proxy forwards to Anthropic with server-side key; response passthrough. Zero client-exposed credentials in deployed HTML.

Anthropic dashboard state post-V1.4.5:
- `newsletteriq-prod` LIVE on `newsletteriq.netlify.app`
- `leadlock-npsupport` LIVE on `leadlockiq.netlify.app`
- `leadlock-streamlineai` LIVE on `streamlineai-enquiries.netlify.app`
- `chatbotiq-dev` LIVE on UPunt + StreamlineAI ChatbotIQ deployments (Railway, unchanged)
- `Streamline API 2` REMAINS LIVE — serves 4 of 5 free IQ tools (DecisionIQ, ProposalIQ, ClientFlowIQ, StaffTalkIQ). Rotation deferred to V1.4.6.
- `Streamline API` (`bZl...UAAA`) DISABLED since Apr 16 — served BizPulse, dormant deletion bundled with `Streamline API 2` rotation at V1.4.6.

Workspace cap raised mid-session from $40/mo to $80/mo (Gareth call — stronger margin for paying-client phase, D1 had recommended $60). Email notification raised to $60. Auto-reload deferred (Tier 1 account restriction — only available at Tier 2+). One-off $50 credit top-up applied, balance $71.38 post-top-up. Two-week credit-check calendar reminder set as manual monitoring backstop. Tier upgrade is a calibration trigger when burn rate increases post-website-launch.

**Decided:**

- **Test G fix deferred to V1.5 per D1.** Three-layer diagnostic (rendered output / SSE stream / model output via Railway logs) ran across four runs of "Should I invest in Bitcoin?" on streamlineai-chat. Findings: Session 28's "truncated quote" was model variance (not reproduced — all four runs returned full quote body). Real findings: (a) attribution rendered 1/4 runs only — model emits attribution intermittently; (b) anti-pattern (b) trailing-prose regression on Run 3 ("That's Gareth's take on it. If you've got questions about AI tools for your business, I'm here for those.") — V1.4.4 directive holds on business-question shape (Tests B/C Session 27/28) but breaks on off-topic-refusal shape (Test G). Class-of-question generalisation drift. V1.5 calibration candidates A (engine-side deterministic attribution append) + B (VERBATIM RESPONSE SCOPE third iteration) logged. V1.5 evidence count: 4 inputs (Session 25 multi-VERBATIM-tie + Session 26 paraphrase retrieval + Session 28 short-query overview-collision + Session 30 Test G class-of-question generalisation drift).

- **Item 4 deferred to V1.4.6 per mid-session D1 call.** Streamline API 2 is shared infrastructure serving 4 of 5 free IQ tools (DecisionIQ + ProposalIQ + ClientFlowIQ + StaffTalkIQ). Rotating it post-V1.4.5 would break four working products without prior migration. V1.4.6 scope locked: migrate all five free IQ tools to Netlify proxy architecture (BizPulse is the 5th, currently broken since Apr 15 on the dormant `bZl...UAAA` key — human-error casualty of Apr 16 rotation), generate five new Anthropic keys, then rotate Streamline API 2. Estimated 75-90 min D2 work.

- **D1 Decision 1 (Item 5 source-tag).** admin-frontend source-tag default `admin-form-v1.3.3` preserved at V1.4.5 cosmetic bump. Source-tag is data-lineage metadata (Pattern 5 frame — header = CODE-state indicator, source-tag = CONFIG/data-tag), bumps only on admin-form material change (validation logic, field schema, submission flow), not on backend version increments. Future-Gareth reading KB entries' source field can identify which entries were created under which admin-form spec. Bumping cosmetically every session would corrupt that lineage.

- **D1 Decision 2 (Item 5 frontend scope).** Only admin-frontend + streamlineai-chat-frontend bumped to V1.4.5. UPunt public chat frontend (V1.2, in `frontend/`) intentionally untouched — frozen surface per Session 25 Operating Discipline. Per-deployment cosmetic touches require explicit justification; UPunt public chat wasn't surfaced in original brief or during execution.

- **Per-deployment Anthropic keys (Item 3 sub-decision).** D1 sequencing Option C + key-strategy Option ii: NP Support first, StreamlineAI second pass, separate `leadlock-npsupport` + `leadlock-streamlineai` keys rather than one shared `leadlock-prod`. Session 16 discipline preserved — per-tenant key separation supports per-tenant spend visibility, aligns with paying-client phase where Lingard/Matty review traffic shifts attribution semantics.

- **Workspace cap structure.** Single Default workspace, per-key cost visibility via dashboard Cost column, workspace-level monthly spend cap at $80 (raised from $40). Gareth's call — stronger margin justified for paying-client phase. Tier 1 account = $100/mo Anthropic-side ceiling, $80 workspace cap is effective limit anyway. Future tier upgrade trigger logged.

- **Netlify env var "Contains secret values" workflow forces per-context value entry but does NOT force value into Local development context.** Strictest security posture (paste key into Production + Deploy Previews + Branch deploys + Preview Server, leave Local development empty) is achievable in practice, not just theoretically. Applied consistently across all three proxy migrations. Worth flagging — if Local development ever becomes needed (e.g., Netlify CLI debugging), a separate low-cap key would be the right path rather than exposing the prod key.

- **Standing Rule 1 (Pattern 22) satisfied four times.** `git show HEAD:admin-frontend/index.html`, `git show HEAD:frontend/index.html`, `git show HEAD:streamlineai-chat-frontend/index.html`, plus full Pattern 22 reads on the uploaded `leadlock.html` (NP Support) and `streamlineai-leadlock.html` files before generating either LeadLock proxy artefact. All six reads executed before any generation. Zero memory-based assumptions on file shape.

- **Standing Rule 2 satisfied across all five deployment surfaces.** Hard-refresh after each frontend deploy: NewsletterIQ smoke (Test A + Test B), LeadLock NP Support smoke (twice — DevTools-late retry caught the init-fetch timing), LeadLock StreamlineAI smoke, admin-frontend cosmetic verify, streamlineai-chat cosmetic verify.

- **Standing Rule 3 fired pre-emptively (third proof — first was Session 27).** Pre-tag check `git tag -l v1.4.5` + `git ls-remote --tags origin v1.4.5` both empty before tagging. Post-tag verification confirmed `535b480001d142cb25c640824404eda08e65bf80 refs/tags/v1.4.5` matching push output. Tag landed on correct commit. Now methodology Pattern 13.

- **Standing Rule 5 satisfied (third proof).** Proxy-only sanity check via `Invoke-RestMethod` POST to `/.netlify/functions/proxy` ran before UI smoke on all three proxy migrations. Caught zero issues — all three returned `content[0].text: "OK"` cleanly. Now methodology Pattern 14.

- **Standing Rule 6 satisfied (second proof — first was Session 27).** Every diagnostic command sent in copy-pasteable PowerShell shell-quoted form with platform explicit. Heredoc-style `$proxyBody = @{...} | ConvertTo-Json -Depth 5` pattern reused three times for the per-deployment proxy sanity check — Gareth ran each verbatim, zero command-syntax friction. Sibling-shape to Pattern 22 (verify before sending), promotion candidate at next D1 close-out.

**Broken — three findings logged in journal, none blocking V1.4.5 ship:**

1. **BizPulse stale-key state — 27 days broken.** Forensic finding mid-session when D1 reviewed Streamline API 2 rotation. BizPulse depends on the dormant `bZl...UAAA` key disabled Apr 16. Rotation logic was applied to other products but BizPulse missed during the Apr 16 fix — human error, not a discipline failure of the rotation itself. Master file API key discipline section needs a per-key product-mapping subsection (existing discipline tracks key naming + spend caps; lacks "which products depend on which keys" mapping). V1.4.6 fixes by migrating BizPulse to its own `bizpulse-prod` key with proxy.

2. **streamlineai-chat frontend version label stuck at V1.4 across V1.4.1 through V1.4.4 backend patches.** Standing Rule 2's spirit (visual confirmation indicator on every shippable version) was broken when patches went backend-only and Rule 2 was read strictly as "only after frontend deploy." Logged at Session 4 already but resurfaced this session. Worth amending Rule 2 wording — see Open Questions.

3. **Three Netlify projects with "Canceled" deploys across Session 22-27 commits.** Initial diagnostic interpretation was "broken Git path / config drift". Real cause: Netlify auto-skips deploys when build output is byte-identical to previously published artifact. V1.4 through V1.4.4 commits touched only `backend/`, frontends were byte-identical, build completed but Deploying stage Skipped, Netlify marks "Canceled". Healthy infrastructure behavior, not silent failure. Distinguishing test: read deploy log step states (Initializing Complete / Building Complete / Deploying Skipped → byte-identical optimisation; vs Build Failed → real failure). Logged for future diagnostic speed.

**Test G — full diagnostic protocol applied (3-layer):**

| Run | Prompt | Quote body | Attribution | Trailing prose |
|---|---|---|---|---|
| 1 | "Should I invest in Bitcoin?" | Full ✓ | Present ✓ | None |
| 2 | "should i invest in bitcoin?" | Full ✓ | Missing | None |
| 3 | "Should I invest in Bitcoin?" | Full ✓ | Missing | **Anti-pattern (b)**: "That's Gareth's take on it..." |
| Session 28 | "Should I invest in Bitcoin?" | Truncated | Missing | n/a |

Three-layer protocol: Rendered output (browser bubble), SSE stream (DevTools Network → EventStream), Anthropic raw output (Railway logs accessible but unused — SSE matched rendered). Diagnosis: model variance + class-of-question generalisation drift. Methodology candidate (1/2 proofs) logged: "Three-layer diagnostic protocol for output quality issues" — sibling-shape to Pattern 23 (verify state before testing), applied to output quality rather than runtime state. Promote on second occurrence.

**Pattern check:**

- Pattern 5 (CONFIG vs CODE) — all three proxy migrations preserved per-deployment CONFIG values. StreamlineAI LeadLock CONFIG (own sheetsWebhook) NOT contaminated by NP Support CONFIG (separate webhook). Verified via grep cross-check before deploy. Decision 1 (source-tag preservation) is a Pattern 5 application — header version is CODE-state, source-tag is CONFIG/data lineage, different update triggers.
- Pattern 11 (Pre-Generation Scope Confirmation) — invoked twice mid-session. (1) Item 3 sub-decision on per-tenant keys vs shared key — three options scoped, D1 confirmed C + ii. (2) Item 5 source-tag handling — three options scoped, D1 confirmed B.
- Pattern 14 (Stop-And-Ask) — invoked seven times across session. Cost + Security (Anthropic key creation × 3), Data shape (source-tag handling), External services (Netlify env var × 3), Cost (workspace cap raise + credit top-up). All produced explicit decision before action.
- Pattern 15 (Build Journal Discipline) — entry being written now per protocol.
- Pattern 16 (Handback to D1) — V1.4.6 scope handed forward; six handback items below.
- Pattern 22 (Verify Prior Version's Exports Before Extending) — six reads at session open + mid-session. See Standing Rules check above.
- Pattern 23 (Verify Runtime State Matches Deployed State Before Testing) — applied to Netlify deploy state diagnosis (read deploy log step states, don't just trust "Canceled" badge), proxy-only smoke before UI smoke, hard-refresh before reading version labels.

**Build Standards check:**

- #1 prompt caching — N/A this session. NewsletterIQ + LeadLock proxies don't implement caching (different traffic shape — newsletter generation is one-shot 8000-token call, LeadLock conversations rebuild system prompt per turn from CONFIG). Build Standard #1 applies to ChatbotIQ chat workflows specifically.
- #2 structured error handling — proxy.js implements `{status, type, message, suggestion, recoverable}` envelope at all five error paths: method guard (405 validation_error), missing env var (500 config_error), JSON parse failure (400 validation_error), missing required body fields (400 validation_error), Anthropic network failure (502 downstream_unavailable recoverable). Anthropic success/failure responses passthrough verbatim.
- #3 response validation — proxy.js relies on Anthropic's response format. Frontend code parses `data.content[0].text` as before (unchanged from pre-proxy architecture). No new validation surface introduced.
- #4 streaming — N/A this session. NewsletterIQ + LeadLock are request/response, no SSE. Test G diagnostic verified existing SSE on streamlineai-chat working as designed.
- #5 stop_reason router — N/A. NewsletterIQ + LeadLock don't dispatch on stop_reason; they read `data.content[0].text` and render.
- #6 pre-deployment checklist — passed for each of three proxy migrations + cosmetic frontend bumps. Hard-refresh + version-label verification applied per Standing Rule 2.

**Cost / spend state:**

- Workspace cap: $40/mo → $80/mo. Email notification threshold $30 → $60.
- Credits balance pre-session: $21.38. One-off top-up $50 mid-session. Balance post-top-up: $71.38.
- Spend during session (all keys aggregated): newsletteriq-prod $0.02 (NewsletterIQ smoke), leadlock-npsupport $0.01 estimated, leadlock-streamlineai $0.01 estimated, Streamline API 2 $0.01 (unexplained — possibly stale dashboard caching from Apr 18 or background calls). Total session spend ~$0.05.
- `chatbotiq-prod` key still not created — StreamlineAI public chat traffic remains testing-only scale; trigger fires at website go-live (Session 31 D1 work).
- Tier 1 account ceiling: $100/mo Anthropic-side hard ceiling regardless of workspace cap. Tier 2+ unlocks auto-reload + higher ceiling. Calendar trigger at first sustained burn approaching tier limit.

**Standing rules check:**

- Rule 1 (verify prior version's exports before extending) — satisfied. Six Pattern 22 reads at session open + mid-session.
- Rule 2 (hard-refresh after frontend deploy) — satisfied across all surfaces. Wording-extension candidate logged in Open Questions for D1 amendment review.
- Rule 3 (verify tag namespace state before tagging) — satisfied pre-emptively, third pre-emptive proof.
- Rule 4 candidate (final file content not diff representation) — N/A this session, no diff-format generation.
- Rule 5 candidate (diagnostic endpoints as pre-flight before chat-surface smoke) — N/A in original wording (which is chatbotiq-specific). Generalised form satisfied via proxy-only sanity check before UI smoke on all three proxy migrations — third proof of the generalised pattern. D1 promotion call: keep narrow chatbotiq-scoped wording vs broaden to "diagnostic endpoint pre-flight for any surface change."
- Rule 6 candidate (verify diagnostic command syntax before sending to operator) — satisfied, second proof.

**Files changed at V1.4.5:**

In git repo:
- Modified: `admin-frontend/index.html`, `streamlineai-chat-frontend/index.html`
- Tag: `v1.4.5` at commit `535b480` (verified on remote: `535b480001d142cb25c640824404eda08e65bf80 refs/tags/v1.4.5`)

Outside git repo (per established pattern — drag-deploy projects):
- New folder: `C:\Users\gphi9\CODE\NEWSLETTERIQ-PROXY\` (index.html patched + netlify.toml + netlify/functions/proxy.js)
- New folder: `C:\Users\gphi9\CODE\LEADLOCK-NPSUPPORT-PROXY\` (same structure)
- New folder: `C:\Users\gphi9\CODE\LEADLOCK-STREAMLINEAI-PROXY\` (same structure)
- These three folders are NOT in version control. Local-only source-of-truth. Netlify deploys are the canonical record. Bringing them into git is V1.4.6 candidate (likely as separate repos per Pattern 5 — each is a distinct deployment surface with different CONFIG).

**Next:**

D2 Session 31 candidates (D1 sequencing):

1. **V1.4.6 — five free IQ tools proxy migration + Streamline API 2 rotation + bundled disabled-key cleanup.** Locked scope, 75-90 min estimate. Pattern-proven (three migrations shipped this session, fourth identical pattern applied five times). Includes fixing BizPulse stale-key state (27 days broken).
2. **V1.5 retrieval + scope-rule calibration pass — 4 inputs queued.** Multi-VERBATIM-tie tiebreak rule, paraphrase retrieval (trigram fuzzy matching pg_trgm extension), short-query overview-collision (Entry 5 secondary-companion behaviour), Test G class-of-question generalisation drift + attribution-rendering shift. Larger scope than V1.4.x patches.

D1 to decide which opens first. Recommendation: V1.4.6 first — pattern-proven, finishes the security migration class, opens path to deleting Streamline API 2 + dormant key cleanly. V1.5 calibration is more open-ended and lower-urgency.

**Open questions for D1:**

1. **V1.4.6 scope confirmation** — five free IQ tools + Streamline API 2 rotation + bundled disabled-key delete. D1 to confirm at session-start or amend.

2. **Standing Rule 2 wording extension.** Current Rule 2 fires only on frontend code change. Backend-only patches across V1.4.1 / V1.4.2 / V1.4.3 / V1.4.4 caused silent frontend label drift on streamlineai-chat (V1.4 stuck while backend at V1.4.4). Proposed amendment: "Frontend version labels bump every shippable backend version, even when no frontend code change ships." Diagnostic indicator stays current. D1 call: amend Rule 2 wording or treat as separate Rule 7 candidate.

3. **Standing Rule 5 promotion scope.** Now methodology Pattern 14 per Session 27 close-out. Wording is chatbotiq-scoped ("diagnostic endpoints as pre-flight before chat-surface smoke"). Session 30 third proof was generalised form — proxy-only sanity check before UI smoke applied across three non-ChatbotIQ deployments. D1 call: keep narrow wording or broaden to "any-surface diagnostic pre-flight before user-facing smoke."

4. **Standing Rule 6 promotion candidate.** Two proofs now (Session 27 + Session 30). Wording: "Verify diagnostic command syntax before sending to operator." Sibling-shape to Pattern 22 (verify code before extending), applied to operator command surface. D1 call: promote to methodology doc as Pattern 15.

5. **Three-layer diagnostic protocol — methodology candidate (1/2 proofs).** Test G diagnosis isolated model output / SSE stream / rendered bubble layers separately. Sibling-shape to Pattern 23 (verify runtime state). Different focus — output quality vs runtime state. D1 call: log as candidate, monitor for second proof.

6. **Master file doc gap.** Infrastructure section describes ChatbotIQ Netlify projects without specifying per-project deploy mechanism (Git auto-deploy vs drag-deploy). Session 30 hit this — drag-deploy planned for what turned out to be Git-linked projects, caused mid-session re-routing. D1 to amend master file Infrastructure section: explicit deploy-mechanism column per Netlify project.

7. **API key discipline doc gap — per-product mapping.** Master file API key discipline section tracks naming convention + spend cap + traffic-volume triggers, but lacks "which products depend on which keys" mapping. BizPulse stale-key state surfaced mid-session because the dependency wasn't documented. D1 to add per-key product-mapping subsection.

8. **Methodology doc v1.2 batch update queue.** Now ~9 items per master file Session 28 count of 7 + Rule 6 promotion (+1) + Rule 2 wording extension or Rule 7 candidate (+1) + three-layer diagnostic candidate (+1 awaiting second proof). D1 to schedule batch update — Lingard-day-before per established discipline.

9. **`chatbotiq-prod` key trigger** — unchanged from Session 28. Fires at website go-live (Session 31 D1 work) or paying-client traffic, whichever first.

10. **NewsletterIQ per-client URL / config isolation surfaced.** Logged mid-session when Champion Bets localStorage state appeared in fresh NewsletterIQ smoke test. Current `newsletteriq.netlify.app` is one URL with one localStorage namespace — paying clients on the same URL would share localStorage. V1.4.6+ candidate (paying-client onboarding architecture). Not blocking V1.4.5 ship.

11. **Tier 1 Anthropic account ceiling — $100/mo hard cap regardless of workspace cap.** Tier 2+ unlocks auto-reload + higher ceiling. Tier upgrade path is cumulative-spend + time-in-account driven. Calibration trigger at first sustained burn approaching tier limit (likely post-website-launch).

12. **PowerShell `Set-Content` line-ending churn.** Triggers `LF will be replaced by CRLF` warning on `git diff`. Git autocrlf normalises on commit, working tree stays CRLF. No content drift. Alternative `[System.IO.File]::WriteAllText($path, $content)` preserves source line endings. Environment artefact, not a discipline failure. Logged for awareness.

---

### HANDBACK TO D1 — V1.4.5 ship close + V1.4.6 scope + V1.5 calibration + master file doc gaps

**Context:**

V1.4.5 shipped at `535b480`, tagged `v1.4.5`. Five-item scope per mid-session expansion: four shipped (Test G diagnosis, three proxy migrations, two cosmetic frontend bumps), one deferred (Streamline API 2 rotation). No hard guardrail violations. No engine architecture changes. Three Anthropic key migrations close the paid-product client-side credential exposure surface.

Pre-launch readiness post-V1.4.5: NewsletterIQ now safe to put on website as paid product (D1 brief criterion met — proxy migration complete). LeadLock both deployments on per-tenant keys. Streamline API 2 retains free-tool serving role through V1.4.6.

**Questions for D1 (framed as decisions with options):**

1. **V1.4.6 scope confirmation.** Locked at session close: five free IQ tools (BizPulse, DecisionIQ, ProposalIQ, ClientFlowIQ, StaffTalkIQ) migrate to Netlify proxy architecture; five new keys (`{product}-prod` naming); Streamline API 2 rotated post-migration; both disabled keys deleted 24-48 hours post-V1.4.6 ship. D1 confirm or amend.

2. **V1.5 sequencing.** Four V1.5 calibration inputs queued. D1 call: V1.4.6 first then V1.5 (recommended), V1.5 first then V1.4.6, or run V1.4.6 alongside D1 launch-prep work and V1.5 deferred until post-launch?

3. **Two methodology promotions.** Rule 6 candidate (verify diagnostic command syntax) now at 2 proofs — promote to Pattern 15. Three-layer diagnostic protocol at 1 proof — log as candidate, monitor for second.

4. **Two Standing Rule wording amendments.** Rule 2 wording extension (frontend version labels bump every shippable version, not only on frontend code change) + Rule 5 wording scope (chatbotiq-narrow vs any-surface-broad).

5. **Two master file doc gaps.** Per-Netlify-project deploy mechanism column (Git vs drag), per-key product-mapping subsection (which products depend on which keys).

**Recommendation:**

V1.4.6 opens next D2 session. Pattern-proven (NewsletterIQ + LeadLock × 2 ship this session). Five free tools = same workflow × 5. Mature playbook reduces session risk.

V1.5 calibration deferred until post-launch — real-prospect retrieval evidence will sharpen calibration scope vs guessing at the four logged inputs in isolation.

Methodology promotions + wording amendments + doc gaps: batch update at Lingard-day-before (existing discipline), all logged in journal for retrieval.

**Status until D1 resolves:** V1.4.5 LIVE across all five surfaces (NewsletterIQ, LeadLock NP Support, LeadLock StreamlineAI, UPunt admin frontend, StreamlineAI chat frontend). Streamline API 2 retains active role. Free-tool exposure surface unchanged from pre-V1.4.5 (acceptable per master file DAPS Operating Notes — "until volume justifies"). D2 awaiting D1 sequencing call on V1.4.6 vs V1.5.

---

### Session 31.5 — 14 May 2026 — V1.4.5.1

**Built:** V1.4.5.1 shipped at commit `f984f2e`, tag `v1.4.5.1`. CONFIG-only patch addressing ChatbotIQ-LeadLock architectural drift surfaced Session 31 (Penny Phillips real-prospect interaction). Four edits per D1 Session 31 brief:

- Edit A — `example_messages` #10 (ready-to-buy signal): rewrote to route to GET STARTED button + `gareth@streamlineai.net.au` direct email. Removed "Want me to grab your email and set that up?" close.
- Edit B — `example_messages` #11 (INSUFFICIENT DATA Case 1, KB gap): rewrote to same dual-route close. Removed "let me flag it for Gareth and he'll come back to you. Want to leave your email?" close.
- Edit C — `example_messages` #13 (speculative can-you-build-X): rewrote to same dual-route close. Removed "want me to set one up?" call-booking close.
- Edit D — `hard_guardrails` #17 appended: "Never accept or capture an email address mid-conversation. When a prospect signals readiness or asks for contact, route them to the GET STARTED button (LeadLock) at the top of the page AND/OR provide gareth@streamlineai.net.au as the direct email — never offer to 'grab' or 'take' an email address yourself."

System prompt grew +524 chars from V1.4.5 baseline (15381 → 15905). Within expected band. Build Standard #1 cache write cost: turn 1 post-deploy invalidated cache and re-wrote (~$0.04 estimated marginal cost); turns 2+ resume cache-read pattern. Accepted per brief.

**Decided:**

- **D1 Option C — V1.4.5.1 ships as partial fix despite Scenario 2 FAIL.** Edits A + C land cleanly per smoke results. Edits B + D close the explicit "grab your email" class but leave the implicit "flag for Gareth" callback-promise class open. Net improvement over pre-V1.4.5.1 state. D1 reasoning: D2's diagnosis (deeper shaping problem than example-driven CONFIG can reach) points to engine layer, not CONFIG layer. Extending hard_guardrail #17 wording today predicts whack-a-mole — would close Penny's exact phrasing, leave adjacent phrasings open. Same shape as V1.4.4 VERBATIM RESPONSE SCOPE iteration history (three CONFIG patches Sessions 25-27 delivered partial wins before structural fix at V1.4.4 closed the class). Skip the intermediate CONFIG patches this time, go straight to structural fix at V1.4.5.2.

- **V1.4.5.2 structural fix queued — engine layer.** Add INSUFFICIENT DATA TEMPLATE block to system prompt that mandates literal routing close (parallel to VERBATIM RESPONSE SCOPE relocation Session 27). Closes the class architecturally rather than example-by-example. D1 composes brief, V1.4.5.2 D2 session within 24-48 hours, lands before Japan flight (6-day window).

- **Pattern 22 path mismatch caught and resolved at Step 1.** Brief specified `config/streamlineai.js` for the four edits. `git show v1.4.5:config/streamlineai.js` returned `fatal: path 'config/streamlineai.js' does not exist in 'v1.4.5'`. Resolved via `git ls-tree -r v1.4.5 --name-only | findstr streamlineai` — real path is `backend/config/streamlineai.js`. No edits attempted against the wrong path. Standing Rule 1 functioning as designed — caught the discrepancy pre-edit, zero deploy cost.

- **Standing Rule 4 satisfied via whole-file deliverable.** Initial output was two array-replacement blocks for hand-editing into the existing file. Operator flagged high-risk-of-human-error on hand-edit, requested complete final file. D2 generated full `backend/config/streamlineai.js` with all edits applied, byte-identical to pre-edit file outside the four targeted regions. Self-diff verified six change blocks total (header comment, voice_profile comment, #10/#11/#13 wording, hard_guardrails comment, +#17). Zero collateral damage. Whole-file delivery is the right discipline for any multi-region edit going forward.

- **Standing Rule 5 (Pattern 14) satisfied.** Diagnostic endpoint `GET /admin/debug/system-prompt/streamlineai` ran before chat-surface smoke. `$resp.prompt.Length` = 15905, +524 chars from V1.4.5 baseline. Pattern matches confirmed new hard_guardrail #17 rendered + new example_messages #10/#11/#13 rendered. End-to-end content pipeline (CONFIG → engine render → admin endpoint) verified working before any chat session ran. Caught zero issues this session but functioned as designed.

- **Standing Rule 3 fired post-detection (fourth proof).** New failure mechanism inside the same class: tag created AFTER commits already pushed → `git push --follow-tags` no-op'd because no commits were transported in that operation. Tag remained local-only despite Railway showing commit ACTIVE. Detected via `git ls-remote --tags origin v1.4.5.1` returning empty. Recovered with explicit `git push origin v1.4.5.1`. Audit-trail cleanup only, no production state at risk. Mechanism inventory now: Session 23 (stale pre-existing tag), Session 26 (commit-without-stage put tag on wrong commit), Session 30 (pre-emptive prevention), Session 31.5 (tag created post-push, --follow-tags no-op).

**Broken — Scenario 2 FAIL is the headline finding:**

Smoke test results on `streamlineai-chat.netlify.app`, post hard-refresh, three scenarios:

| Scenario | Prompt | Result | Detail |
|---|---|---|---|
| 1 — Ready-to-buy (Edit A) | "I want to talk to Gareth about LeadLock" | PASS | Bot routed to GET STARTED + direct email. Voice on-brand. No email-grab. |
| 2 — INSUFFICIENT DATA Case 1 (Edit B + D) | "Do you have any deployments in healthcare?" | **FAIL** | Bot output INSUFFICIENT DATA literal opener correctly, then closed with "Want me to flag this for Gareth so he can tell you what's been built in that space?" — functionally identical to pre-edit #11 wording that surfaced Penny's drift Session 31. |
| 3 — Speculative can-you-build (Edit C) | "Can you build a chatbot for my real estate agency?" | PASS | Bot retrieved a VERBATIM entry ("If you need something specific built, give us a try..."), routed cleanly to GET STARTED + direct email. VERBATIM RESPONSE SCOPE directive holding on this shape. |

Scenario 2 detailed bot response (verbatim):

```
INSUFFICIENT DATA — the knowledge base doesn't include case studies or 
specific client deployments by industry yet. StreamlineAI does work 
across different industries, but I can't confirm healthcare deployments 
specifically without that information. Want me to flag this for Gareth 
so he can tell you what's been built in that space?
```

**Diagnosis:**

Edit B (example_messages #11 rewrite) did not shape the bot's response. Edit D (hard_guardrail #17) did not fire because its wording prohibits "grab/take email" but does not cover "flag for Gareth" / callback-promise shapes. The bot is one turn upstream of where #17 fires — it offers the callback option (turn 1), which would lead to email-ask (turn 2) where #17 finally catches it. But by then the prospect has been promised a notification that doesn't fire — same outcome as Penny.

Likely root cause per D2 + D1 agreement: the bot's INSUFFICIENT DATA response shape has its own attractor (from broader training data on "I don't have an answer" patterns + voice profile's "moves toward a clear next step" instruction) that example #11 doesn't override. Example-driven CONFIG fixes have a ceiling. When training-data attractors are strong, examples alone won't override — structural directives at the engine layer are required. Same pattern as V1.4.4 VERBATIM RESPONSE SCOPE: three Session 25-27 CONFIG iterations delivered partial wins before structural relocation closed the class at V1.4.4.

**Note on V1.4.4 VERBATIM RESPONSE SCOPE directive interaction (per brief):**

Brief asked whether new Edit B language works cleanly with the directive's anti-trailing-prose rule. Expected: yes, because the routing language IS the answer, not synthesised commentary on the answer.

Answer: undetermined this session — Scenario 2 didn't get far enough to test the interaction because the bot didn't render Edit B's wording at all. The bot synthesised its own INSUFFICIENT DATA close from prior-pattern attractor rather than pulling example #11. Whether Edit B language interacts cleanly with VERBATIM RESPONSE SCOPE will be testable post-V1.4.5.2 structural fix.

**Bonus diagnostic finding — PowerShell `Select-String` on long single-string content:**

`$resp.prompt | Select-String -Pattern "X"` returned the entire prompt rather than only matching lines. Cause: `$resp.prompt` is one giant string with embedded newlines, not an array of lines, so `Select-String` matches the whole string as one "line." Workaround for cleaner pattern matching: split first with `$resp.prompt -split "`n" | Select-String -Pattern "X"`. Logged for future diagnostic command shape — not blocking, but cleaner output is one line of pipe addition.

**Journal sync recovery — retroactive Session 30 entry:**

Session 31.5 session-open `git status` after first edit revealed `build-journal.md` modified but unstaged. Diff was the complete Session 30 entry + V1.4.5 handback (~191 lines), written locally Session 30 (12 May 2026) but never committed and never uploaded to D2 KB. Pattern 15 sync-rule failure from Session 30 close — local commit + KB upload are two independent operations; either can be skipped without the other firing an error, and Session 30 evidently skipped both for the journal entry specifically. D2 session-start KB read had been operating against a journal stale by one entry for ~6 days. Recovered by committing journal separately first (`439d9ab`, "journal sync: append Session 30 V1.4.5 entry + handback (retroactive, missed at S30 close)"), then committing V1.4.5.1 CONFIG change as second commit. Two separate concerns, two separate commits, clean audit trail.

**Pattern check:**

- Pattern 5 (CONFIG vs CODE) — clean. CONFIG-only patch. No engine code touched. V1.4.5.2 structural fix will require engine work (out of D2 brief scope for this session, queued).
- Pattern 11 (Permissive Rules Require Concrete Scope) — applied to all four edits. Edits A/B/C add concrete routing alternatives; Edit D adds concrete behavioural prohibition. Scenario 2 FAIL reveals the limit of example-driven Pattern 11 application against training-data attractors — concrete scope at the example layer isn't sufficient when the bot's response shape has its own attractor independent of the example.
- Pattern 14 (Stop-And-Ask) — invoked twice. Tag question (resolved Option A, tag `v1.4.5.1`). Journal sync recovery (D2 + D1 implicit agreement: commit journal separately first).
- Pattern 15 (Build Journal Discipline) — entry being written now. Retroactive Session 30 entry sync recovered earlier in session.
- Pattern 16 (Handback to D1) — V1.4.5.2 scope handback written and executed mid-session. D1 returned Option C decision within ~2 minutes.
- Pattern 22 (Verify Prior Version's Exports Before Extending) — fired and caught the path mismatch (`config/streamlineai.js` vs `backend/config/streamlineai.js`). Zero deploy cost on the catch.
- Pattern 23 (Verify Runtime State Matches Deployed State Before Testing) — applied to push-state diagnosis when Railway showed commit ACTIVE but `git push --follow-tags` returned "Everything up-to-date." Three-signal verification (`git status` + `git log -3 --oneline` + `git ls-remote --tags`) confirmed commits were on origin but tag was not. Recovered via explicit `git push origin v1.4.5.1`.

**Build Standards check:**

- #1 prompt caching — turn 1 post-deploy cache write cost absorbed (system prompt grew +524 chars). Cache machinery unchanged. Cache hits resume turn 2+.
- #2 structured error handling — N/A this session, no error paths exercised.
- #3 response validation — N/A this session, no validation surface introduced.
- #4 streaming — verified working on streamlineai-chat smoke tests (all three scenarios streamed tokens normally, no empty bubbles).
- #5 stop_reason router — N/A this session, no router changes.
- #6 pre-deployment checklist — passed for V1.4.5.1 ship despite Scenario 2 FAIL per D1 Option C decision. Net improvement over pre-V1.4.5.1 state acknowledged. V1.4.5.2 follow-up required to close the class.

**Cost / spend state:**

- V1.4.5.1 system prompt grew +524 chars. Turn 1 cache write absorbed; turn 2+ cache reads unchanged. Negligible at current testing-only traffic.
- Session 31.5 smoke test consumed 3 chat sessions (one per scenario). Estimated cost ~$0.05.
- `chatbotiq-dev` API key cap unchanged at $40/mo workspace cap raised to $80/mo Session 30.
- Credits balance approximately $71.30 (start of session $71.38, minor session-end spend).

**Standing rules check:**

- Rule 1 (verify prior version's exports before extending) — satisfied. Path mismatch caught pre-edit via `git show v1.4.5:config/streamlineai.js` failing → `git ls-tree` resolution → confirmed real path `backend/config/streamlineai.js`. Full file content read before generating any edits.
- Rule 2 (hard-refresh after frontend deploy / verify backend version label) — frontend untouched this session (CONFIG-only patch), version label correctly remained `V1.4.5`. Hard-refresh applied before smoke tests anyway as defensive discipline.
- Rule 3 (verify tag namespace state before tagging) — satisfied pre-emptively (`git ls-remote --tags origin v1.4.5.1` empty before tag created). Fourth proof of the rule fired post-detection: new failure mechanism (tag created post-push, --follow-tags no-op). Recovered via explicit `git push origin v1.4.5.1`. See journal mechanism inventory above.
- Rule 4 (final file content not diff representation) — third proof. Initial output was array-replacement blocks; operator flagged human-error risk; D2 produced complete final file. Now at 3 proofs total — promote to methodology doc on next D1 close-out.
- Rule 5 (diagnostic endpoint pre-flight) — satisfied. Now methodology Pattern 14 per Session 27 promotion.
- Rule 6 candidate (verify diagnostic command syntax before sending to operator) — satisfied this session. PowerShell variable assignment used for `$token`, `$base`, `$url` per established pattern. Bonus diagnostic finding logged (Select-String quirk on single-string content) for future command refinement. Now at 3 proofs total (Session 27 + Session 30 + Session 31.5) — promote candidate.

**Files changed at V1.4.5.1:**

In git repo:
- Modified: `backend/config/streamlineai.js` (+22/-6 lines: header comments + #10/#11/#13 rewrites + new guardrail #17)
- Modified: `build-journal.md` (retroactive Session 30 entry + V1.4.5 handback sync, +188 lines, separate commit `439d9ab`)
- Tag: `v1.4.5.1` at commit `f984f2e` (verified on remote: `f984f2e6be9e312b67e57fef04d79b1d758944a7 refs/tags/v1.4.5.1`)

Railway deployment: V1.4.5.1 ACTIVE, Deployment successful, verified via dashboard.

**Next:**

D2 Session 31.6 candidate (or whichever version label D1 chooses for the structural fix): V1.4.5.2 INSUFFICIENT DATA TEMPLATE block at engine layer. D1 to compose brief tonight, D2 session within 24-48 hours, lands before Japan flight.

V1.4.6 free-tool proxy migration still queued post-V1.4.5.2.

**Open questions for D1 (handback below for any remaining):**

- **V1.4.5.2 brief composition** — D1 to draft + upload to D2 KB.
- **Methodology candidate at 2/2 proofs after V1.4.5.2 lands** — "Example-driven CONFIG fixes have a ceiling. When training-data attractors are strong, examples alone won't override. Structural directives at the engine layer are required." Sibling-shape to Pattern 11 (Permissive Rules Require Concrete Scope) but applied to limits of CONFIG-layer scope-tightening. V1.4.4 VERBATIM RESPONSE SCOPE = proof 1, V1.4.5.2 INSUFFICIENT DATA TEMPLATE = proof 2 if it closes the class. Logged by D1 in master file.
- **Standing Rule 4 promotion** — now at 3 proofs (Session 26 + Session 30 was actually N/A per Session 30 journal so revising: Session 26 + Session 31.5 = 2 proofs). Re-check on next promotion review.
- **Standing Rule 6 promotion** — now at 3 proofs (Session 27 + Session 30 + Session 31.5). Promote to methodology doc on next D1 close-out.
- **Pattern 15 sync-rule sharpening candidate** — Pre-Session-End Checklist gets a `git status` check item before declaring session complete. Catches uncommitted journal entries, uncommitted code, or any other drift between intent and repo state. Sibling-shape to Standing Rules 3 and 5 — all "verify state before declaring done." This session's retroactive Session 30 journal sync is the first proof.

---

### HANDBACK TO D1 — V1.4.5.1 partial ship + V1.4.5.2 structural fix queued

**Context:**

V1.4.5.1 deployed at `f984f2e`, tagged `v1.4.5.1`. CONFIG-only patch per Session 31 brief. Three smoke scenarios: A and C PASS, B FAIL. D1 returned Option C decision mid-session: ship as partial fix, queue V1.4.5.2 structural fix at engine layer.

Net effect of V1.4.5.1: Penny would not have been asked for her email immediately. She might still have been routed into a callback-promise flow ("Want me to flag this for Gareth?") that creates the same downstream issue (notification doesn't fire, prospect waits). Improvement over pre-V1.4.5.1 state but does not close the architectural drift Session 31 brief targeted.

**Questions for D1 (framed as decisions with options):**

1. **V1.4.5.2 brief composition and timing.** D1 to compose. Session window: within 24-48 hours per Japan flight constraint.

2. **Methodology promotions queued.** Standing Rule 6 now at 3 proofs (promote to methodology doc as next pattern slot). Standing Rule 4 now at 2 proofs (one more required). Pattern 15 sync-rule sharpening candidate at 1 proof (Session 31.5 retroactive journal sync).

3. **Master file Strategic Bets update.** D1 to log "Example-driven CONFIG fixes have a ceiling" pattern recognition note pending V1.4.5.2 second-proof confirmation.

**Recommendation:**

Close Session 31.5 now. V1.4.5.1 live, partial improvement, no rollback. D1 composes V1.4.5.2 brief at convenience; D2 session opens when brief is in KB.

**Status until D1 resolves:**

- V1.4.5.1 LIVE on Railway (commit `f984f2e`, tag `v1.4.5.1`).
- Build journal entry written and being uploaded to D2 KB.
- D2 paused awaiting V1.4.5.2 brief.

---

### Session 31.6 — 18 May 2026 — V1.4.5.2

**Built:** INSUFFICIENT DATA TEMPLATE block added as new top-level section at the end of the cached system prompt in `backend/lib/system-prompt.js`. Block fires whenever the existing INSUFFICIENT DATA RULE fires — mandates a verbatim routing close (sourced from CONFIG) and enumerates four forbidden alternative shapes (flag/log/note offers, email-capture mid-conversation, callback-promises, and class-not-phrasing variants). Two new CONFIG fields added to support the engine block: `routing_close` (the verbatim mandated close text) and `contact_email` (kept independent so future deployments can reference it from voice profile or guardrails without duplicating). StreamlineAI CONFIG populated with the full StreamlineAI close text + `gareth@streamlineai.net.au`. UPunt CONFIG populated with empty strings — engine block becomes a no-op for UPunt and the INSUFFICIENT DATA RULE section falls back to a B-ii fallback variant ("briefly acknowledge that you don't have the answer. Do not offer to capture the user's email or contact details, and do not promise any callback or follow-up"). The B-ii fallback removes V1.4.5.1's attractor seed instruction ("offer to capture the question for the operator") universally — UPunt benefits from the engine improvement at zero engine cost per Pattern 5 frozen-deployment rule. Section 3 (INSUFFICIENT DATA RULE) updated with ternary forward-pointer: routes to TEMPLATE section when `config.routing_close` populated, falls back to B-ii variant when empty. Voice-side reinforcement also landed: `signature_phrase` #6 ("Good question — let me flag that for Gareth.") dropped from `streamlineai.js` because it directly contradicts the engine TEMPLATE's forbidden alternative (a). Dropped, not replaced — replacing risks seeding a fresh attractor. Voice profile now has 9 signature_phrases; sufficient. Smoke test 4/4 PASS on `streamlineai-chat.netlify.app`. Primary V1.4.5.2 target (Session 31.5 Scenario 2 attractor) closed.

**Decided:**

- **Brief filename was wrong; Pattern 22 caught it at Step 1.** D1 brief specified `lib/promptBuilder.js` as the edit target. Recursive search returned zero matches. Actual file `backend/lib/system-prompt.js` confirmed via `Get-ChildItem -Recurse -Path backend\lib`. Logged as path-assumption variant of Standing Rule 1 (Rule 1 historically covers export shape, but path identity sits in the same class — "verify state before extending"). D2 proceeded on Option 1 (verify-and-continue) after surfacing the discrepancy via Stop-and-Ask. No D1 round-trip needed because the substitution was mechanically obvious and Option 1 cost zero added time.

- **Brief function signature reference was wrong.** Brief referenced "`getSystemPrompt(deploymentSlug, ...)` deployment-router pattern." Actual signature is `buildSystemPrompt(config)` — single argument, deployment-agnostic by construction. No router function exists; deployment routing happens upstream at the caller. The function being deployment-agnostic means any top-level section added to it applies to all deployments automatically — INSUFFICIENT DATA TEMPLATE became universal-by-default, no per-deployment wiring needed. Pattern 5 split simplified by this discovery: engine code holds SHAPE for all deployments, CONFIG holds per-deployment content. UPunt's empty `routing_close` produces a graceful no-op via the same engine code that produces a rendered block on StreamlineAI.

- **Pattern 5 boundary issue caught at Step 2b Stop-and-Ask.** Brief locked the mandated close as universal directive across `streamlineai` AND `upunt`. But the close hardcoded the StreamlineAI direct email (`gareth@streamlineai.net.au`) — a per-deployment value bleeding into universal engine code. D2 surfaced three options (A: hardcode + accept debt; B: CONFIG-driven; C: deployment-slug guard in engine). D1 selected Option B. Engine code now holds the rule SHAPE; CONFIG holds per-deployment content. UPunt B-upunt-i fallback (empty strings + B-ii section 3 variant) proves the split works at zero engine cost. Future paying-client deployments need only populate two CONFIG fields — no engine touch required. **Pattern 14 win:** Stop-and-Ask gate caught what the brief authored blind. D1 close-out observation: brief composition cannot anticipate all boundary issues — that's why the gate exists.

- **signature_phrase #6 contradiction caught at D1 final review.** D2's own header comment block on `backend/lib/system-prompt.js` (lines 37-40) identified "Good question — let me flag that for Gareth." as the voice-side reinforcement of the V1.4.5.1 attractor that V1.4.5.2 was closing. But the phrase was still live in the first `streamlineai.js` draft D2 produced at Step 2b. D1 caught the contradiction at the final-shape review. The cached system prompt would have shipped with engine TEMPLATE forbidden alternative (a) directly contradicting voice profile signature_phrases licensing the same phrase as natural usage — a self-contradicting prompt. Recovery: D2 produced corrected `streamlineai.js` dropping signature_phrase #6 entirely. Drop not replace — replacing risks seeding a fresh attractor. Cross-check pass on the corrected file: scanned all CONFIG for the same contradiction class against engine TEMPLATE forbidden alternatives (a)-(d). example_messages #2 contains "happy to flag it for Gareth if you want a firm quote" but is on a CONFIDENT VOICE response to a pricing question — not an INSUFFICIENT DATA close — so out of TEMPLATE scope. hard_guardrail #17 prohibits email-capture explicitly (aligned). No other contradictions found.

- **Methodology candidate "Example-driven CONFIG fixes have a ceiling" — PROOF 2 CONFIRMED at smoke.** V1.4.4 VERBATIM RESPONSE SCOPE relocation (Sessions 25-27) was proof 1. V1.4.5.2 INSUFFICIENT DATA TEMPLATE (this session) is proof 2. Both prove the same shape: when training-data attractors are strong (positioning + small-business context + voice profile "moves toward a clear next step" instruction), example_messages alone cannot override. Structural directives at the engine layer are required to close the behaviour class. D1 to promote to methodology doc on next close-out per Session 16 "2+ deployment proof" rule.

- **Pattern 5 frozen-deployment rule confirmed by UPunt B-ii fallback.** UPunt CONFIG passed empty `routing_close` and empty `contact_email`. Engine code rendered: TEMPLATE block absent (correct), INSUFFICIENT DATA RULE section with B-ii fallback wording present (correct), V1.4.5.1 attractor seed "offer to capture the question for the operator" absent universally (correct). UPunt benefits from the engine improvement at zero additional engine cost. Reusable-architecture observation: V1.4.5.2 engine improvement applies to any future deployment with unpopulated `routing_close`, no engine touch required to onboard.

- **Step 6 char-count target relaxed at Step 6 Stop-and-Ask.** V1.4.5.1 baseline char count not captured at Session 31.5 close. Three options surfaced: (i) live endpoint capture (impossible — V1.4.5.1 no longer deployed), (ii) reconstruct locally from git history (~5-10 min), (iii) structural verification only + log V1.4.5.2 as new baseline. D1 selected (iii). Char-count target was D1's Step 1 sharpening upgrade framed as "discipline refinement, not promotion-relevant" — treating it as a hard gate would have been drift from D1's own framing. Structural verification is the binary pass/fail; char count is sanity-check, not independent gate. V1.4.5.2 figures captured for journal as future baseline: streamlineai assembled prompt = 20,041 chars; upunt assembled prompt = 12,838 chars.

- **Pattern 15 sync-rule sharpening candidate logged.** "Capture diagnostic endpoint baseline char count at every version close, so the next session has a known anchor for delta verification on the next structural change." First proof: this session (V1.4.5.1 baseline not captured at Session 31.5 close → can't verify locked delta target this session). 1/2 proofs toward promotion. Second proof candidate triggers if same gap surfaces at a future structural change session.

**Step-by-step execution log:**

- **Step 1 Pattern 22 pre-flight read.** `git pull` clean, working tree at `d8e7f4e` (Session 31.5 journal commit, code-identical to `f984f2e` v1.4.5.1 tag). Brief filename path discrepancy caught (see Decided above). Real file read: `backend/lib/system-prompt.js`. ESM module type confirmed (`node --check` substituted for `node -c`). Function signature confirmed deployment-agnostic. Current cached block order at V1.4.5.1: 1. Identity, 2. KB BEHAVIOUR, 3. INSUFFICIENT DATA RULE, 4. Hard guardrails, 5. Voice profile, 6. VERBATIM RESPONSE SCOPE. INSUFFICIENT DATA TEMPLATE insertion point: new section 7, after VERBATIM RESPONSE SCOPE, dead last in the prompt.

- **Step 2 Stop-and-Ask gate #1 (block content).** Drafted full INSUFFICIENT DATA TEMPLATE block verbatim per Pattern 14 + Standing Rule 4. Also drafted Section 3 forward-pointer edit. Char count delta calculated: +3,487 raw before CONFIG interpolation. Pattern 5 boundary surfaced; three options presented to D1.

- **Step 2b Stop-and-Ask gate #2 (Option B implementation).** D1 selected Option B. D2 produced revised engine block with `${config.routing_close}` interpolation; empty-string guard wrapping section 7 push; ternary forward-pointer on section 3 with B-ii fallback when routing_close empty. Required `streamlineai.js` and `upunt.js` pastes for Standing Rule 1 compliance before generating final replacements.

- **Step 2c Stop-and-Ask gate #3 (final-shape review).** Three final-shape files produced. D1 caught signature_phrase #6 contradiction. D2 produced corrected `streamlineai.js`. D2 voluntary cross-check on the corrected file scanned all CONFIG sources for same-class contradictions against engine TEMPLATE forbidden alternatives. No further contradictions found.

- **Step 4 apply edits.** Operator saved three files to repo. `git status` confirmed 3 files modified. `git diff --stat`: streamlineai.js +58, upunt.js +36, system-prompt.js +297. `node --check` clean on all three (silent success).

- **Step 5 commit + push.** Commit `4243631` pushed to remote. Standing Rule 3 pre-emptive tag check skipped at this step (tag deferred to post-smoke per brief) — fifth-mechanism discipline note logged below. Railway auto-deploy: V1.4.5.2 ACTIVE 58 seconds after push, deployment successful, verified via dashboard screenshot.

- **Step 6 diagnostic structural verification.** Both deployments verified via `/admin/debug/system-prompt/<slug>`. StreamlineAI: prompt_chars 20,041, VERBATIM RESPONSE SCOPE 6 occurrences, INSUFFICIENT DATA TEMPLATE 4 occurrences, MANDATED ROUTING CLOSE 1 occurrence, `${config.routing_close}` leaked literal 0 occurrences (critical interpolation gate PASS), GET STARTED close text 3 occurrences, INSUFFICIENT DATA opener 2 occurrences. UPunt: prompt_chars 12,838, VERBATIM RESPONSE SCOPE 3 occurrences, INSUFFICIENT DATA TEMPLATE 0 occurrences (engine guard correctly skipping), MANDATED ROUTING CLOSE 0 occurrences (correct absence), INSUFFICIENT DATA RULE 1 occurrence, B-ii first clause 1 occurrence, B-ii second clause 1 occurrence, V1.4.5.1 attractor seed 0 occurrences (engine improvement flowed through universally). All structural checks PASS.

- **Step 7 smoke test on `streamlineai-chat.netlify.app`** (browser, hard-refresh applied even though no frontend changes — Standing Rule 2 discipline). 4/4 PASS, see Smoke results below.

- **Step 7b tag operation.** Pre-emptive `git ls-remote --tags origin v1.4.5.2` returned empty. Local `git tag -l v1.4.5.2` returned empty. Tag created at `4243631`. Explicit `git push origin v1.4.5.2` per Session 31.5 fourth-mechanism learning. Final verification: local tag = `v1.4.5.2`, remote tag = `v1.4.5.2 -> 42436317a1c930b655f5e6f7ffd75ac01e633bb0`. Matches local commit `4243631`. Standing Rule 3 satisfied.

**Smoke test results (Step 7) — verbatim bot outputs:**

**Scenario 1 — "Do you have any deployments in healthcare?"** — primary V1.4.5.2 target, INSUFFICIENT DATA Case 1. **PASS.**

> "INSUFFICIENT DATA — don't have case studies or deployment details for healthcare in the knowledge base. Easiest next step is the GET STARTED button at the top of the page — Gareth will be in touch within one business day. Or email gareth@streamlineai.net.au directly if you prefer."

INSUFFICIENT DATA opener + mandated routing close verbatim. Zero callback-promise wording. Zero email-capture offer. Response consists of opener + close, nothing else. TEMPLATE block "Nothing else" directive holding. Session 31.5 Scenario 2 attractor closed.

**Scenario 2 — "I want to talk to Gareth about LeadLock"** — V1.4.5.1 regression check. **PASS.**

> "Easiest next step is the GET STARTED button at the top of this page — that's LeadLock. It'll ask a few quick questions about your situation, capture your details, and Gareth will be in touch within one business day. Or if you'd rather email, that's gareth@streamlineai.net.au."

Routes to GET STARTED + direct email. No mid-conversation email-grab. No bot-side callback-promise — phrasing "Gareth will be in touch within one business day" is acceptable because the trigger is the user's own action on the LeadLock button (which fires the LeadLock notification stack), not a bot-side notification. Response wrapped in quotation marks suggests retrieval hit a KB VERBATIM entry covering ready-to-buy routing; VERBATIM RESPONSE SCOPE block governed the response, INSUFFICIENT DATA TEMPLATE did not fire. Mutual exclusion between the two engine rules working correctly per the interaction clause.

**Scenario 3 — "What does StreamlineAI do?"** — V1.4.4 VERBATIM regression check. **PASS.**

> "StreamlineAI helps businesses use AI in practical ways that save time, reduce hassle, and improve the bottom line. If we haven't already built what you need, give us a tap on the shoulder and we'll see what we can do."

Entry 1 quoted verbatim, wrapped in quotation marks. Zero trailing prose. V1.4.4 VERBATIM RESPONSE SCOPE directive holding. No degradation from V1.4.5.2 engine changes.

**Scenario 4 — "What industries do you work with most?"** — adjacent-phrasing structural test. **PASS** (different shape than S1, structurally correct).

> "Any industry where a small business owner needs AI to handle customer communication, lead intake, visual pre-assessment, or recurring content. Trades, service businesses, retail, health practices, professional services, NDIS providers, side hustles. The product suite isn't industry-specific — it's adapted to whatever business it goes into. What kind of business are you in?"

NOT an INSUFFICIENT DATA case — KB has REFERENCE coverage for industries served. Bot answered confidently from CONTEXT in voice + asked one follow-up question per voice profile style. Critical sub-checks: zero callback-promise wording, zero email-capture offer, zero "flag for Gareth" variants. Adjacent-phrasing class verified: when KB has coverage, bot answers from coverage (correct); when KB doesn't (S1), bot fires INSUFFICIENT DATA + mandated close (correct). No drift toward callback-promise on either path.

**Standing Rule mechanism enumerations this session:**

- **Standing Rule 1 (verify prior version's actual exports before extending) — satisfied with path-identity sub-class.** Brief filename `lib/promptBuilder.js` was wrong; actual `backend/lib/system-prompt.js` confirmed via recursive search at Step 1. Path-assumption sits in same class as Rule 1's export-shape assumption. Logged for Pattern 22 / Rule 1 promotion review at next D1 close-out.

- **Standing Rule 3 (pre-emptive tag check before extending tag namespace) — fifth-mechanism instance logged.** Pre-emptive `git ls-remote --tags origin v1.4.5.2` check skipped at Step 5 commit because tag was deferred to post-smoke per brief. Discipline rule applies regardless of when the tag op happens — the namespace check is a sanity gate, not a sequencing gate. No promotion impact (Rule 3 is operational learning, no promotion needed). Mechanism enumeration only.

- **Standing Rule 4 (final file content not diff) — third proof.** All three files produced as final-shape content (system-prompt.js, streamlineai.js, upunt.js). Corrected streamlineai.js also produced as final-shape after D1 caught the contradiction. No diffs, no patches, no partial blocks. Promote candidate at 3 proofs total (Session 26 + Session 31.5 + Session 31.6).

- **Standing Rule 5 (diagnostic endpoint pre-flight) — satisfied as methodology Pattern 14.** Diagnostic ran on both deployments before smoke. Sharpening candidate already logged at Session 31.6 open (precise byte target with CONFIG-interpolated content) — relaxed in execution because V1.4.5.1 baseline not captured at Session 31.5 close (see Pattern 15 sync-rule sharpening candidate below). Structural verification (not char count) was the operative pass/fail gate.

- **Standing Rule 6 (verify diagnostic command syntax before sending to operator) — promoted at Session 31.5 close-out per 3 proofs; this session adds two further mechanism instances for inventory weight:** Mechanism #4 — `-UseBasicParsing` flag missing on PowerShell 5.x `Invoke-WebRequest` (script-execution warning fires without it). Mechanism #5 — session variable scope drift between deployment diagnostic calls (`$base` was cleared between streamlineai and upunt diagnostics; `$url` rebuilt with empty base became `/admin/debug/system-prompt/upunt` and `Invoke-WebRequest` returned "Invalid URI"). Recovery: re-set `$base` and `$token` explicitly before second diagnostic. Mechanism inventory now at 5 proofs total (Session 27 + Session 30 + Session 31.5 + this session ×2). Promotion already triggered; this is enumeration weight only.

**Observations logged for future pattern accumulation (not Session 31.6 actions):**

- **Pattern 14 working as intended.** Stop-and-Ask gate at Step 2b caught Pattern 5 boundary missed in the brief (StreamlineAI email hardcoded into universal engine code). Stop-and-Ask gate at Step 2c caught signature_phrase #6 contradiction between engine TEMPLATE and voice profile that D2's own diagnostic comment had named but the initial draft had missed. Two same-prompt direct contradictions averted before commit. Pattern 14 is doing the work it's supposed to do.

- **D2 voluntary cross-check discipline upgrade.** On the corrected `streamlineai.js`, D2 voluntarily scanned all CONFIG sections (signature_phrases, example_messages, hard_guardrails) for the same contradiction class against all four engine TEMPLATE forbidden alternatives (a)-(d), not just the called-out line. Single instance, not Standing Rule candidate yet. Worth a journal note for pattern accumulation — when an engine rule names a specific phrasing as forbidden, every CONFIG file the engine reads should be scanned for that phrasing class, not just the surface-level mention. Logging for future Standing Rule emergence.

- **Communication discipline observation — Step 6 turn surfaced option references (i)/(ii)/(iii) without the option set itself reaching D1.** D1 paused to request full option set; D2 surfaced it cleanly on the second turn. Pattern 14 territory: Stop-and-Ask works only when the question content (including option definitions) reaches D1. Single instance, not Standing Rule candidate yet. Log for pattern accumulation. Lesson: when option references appear in a message to D1, the option definitions must appear in the same message (or have been established earlier in the session with explicit numbering preserved). Implicit references to earlier-turn options are a discipline failure mode.

- **Forward-pointer architecture observation (not Session 31.6 scope).** `streamlineai.js` voice_profile.forbidden_behaviours line "Speculating about whether something specific can be built — route to consultation instead" embeds deployment-specific routing language in a CONFIG behavioural rule. Same architectural class as the routing_close issue resolved via Option B this session. CONFIG is the correct layer for this so no Pattern 5 violation, but if a unified routing primitive (referenced by voice_profile, hard_guardrails, AND engine TEMPLATE) becomes useful at the first paying-client deployment, this is the next candidate for primitive extraction. Log only — not Session 31.6 action.

**Pattern 5 boundary observation (engine-tier work cleanly executed):**

V1.4.5.2 was engine-tier work (CODE-tier per Pattern 5), distinct from V1.4.5.1's CONFIG-tier work (Session 31.5). The split worked correctly: engine code (`backend/lib/system-prompt.js`) holds the rule SHAPE (forbidden alternatives, multi-turn invariance, interaction-with-VERBATIM clause). CONFIG files (`streamlineai.js`, `upunt.js`) hold per-deployment content (routing_close text, contact_email). Same engine code produces different output per deployment based on CONFIG state alone — no engine branching, no deployment-slug guards. CONFIG-driven shape working as architected.

**Broken:** Nothing.

**Cost estimate per 100 messages:** Unchanged from V1.4.5.1 except cache-write delta. V1.4.5.2 increased streamlineai assembled prompt from estimated ~16,500 chars (V1.4.5.1) to 20,041 chars (V1.4.5.2). Turn 1 after deploy invalidated cache; turns 2+ resume cache-read pattern. Per Build Standard #1 awareness. Acceptable cost, structural fix value justifies. UPunt prompt size effectively unchanged (12,838 chars; B-ii fallback adds ~200 chars, attractor seed removal nets out closely).

**Next:**

- D1 close-out actions queued (handback below).
- V1.4.6 free-tool proxy migration still queued post-V1.4.5.2.
- Build journal at this entry crosses ~1,650 lines (approx) — Pattern 15 archive pass remains Session 32 first item.

**Files changed at V1.4.5.2:**

In git repo:
- Modified: `backend/lib/system-prompt.js` (+297/-89 lines: V1.4.5.2 header comment block + ternary forward-pointer + new INSUFFICIENT DATA TEMPLATE section)
- Modified: `backend/config/streamlineai.js` (+58/-X lines: V1.4.5.2 header note + routing_close field + contact_email field + signature_phrase #6 dropped from voice_profile)
- Modified: `backend/config/upunt.js` (+36/-0 lines: V1.4.5.2 header note + routing_close empty string + contact_email empty string)
- Commit: `4243631` (verified on remote: pushed via `git push`, no tag follow-through this commit)
- Tag: `v1.4.5.2` at commit `4243631` (verified on remote: `42436317a1c930b655f5e6f7ffd75ac01e633bb0 refs/tags/v1.4.5.2`)

Railway deployment: V1.4.5.2 ACTIVE, Deployment successful, verified via dashboard screenshot at 58 seconds post-push.

**POSTSCRIPT — none this session.**

### Session 32 — 08 June 2026 — V1.4.6 (Free-Tool Proxy Migration)

**Built:** All five free IQ tools (BizPulse, ClientFlowIQ, DecisionIQ, ProposalIQ, StaffTalkIQ) migrated from client-side embedded API keys to the Netlify serverless-function proxy pattern (NewsletterIQ V1.4.5 template). Each tool now: `netlify/functions/proxy.js` (Anthropic passthrough, Build Standard #2 structured-error shape) + `netlify.toml` (functions dir + Node 20 esbuild) + patched `index.html` (key declaration removed, fetch URLs swapped to `/.netlify/functions/proxy`, `x-api-key` / `anthropic-version` / `anthropic-dangerous-direct-browser-access` headers stripped). `proxy.js` and `netlify.toml` byte-identical across all five (md5-verified). Five new per-product Anthropic keys generated (`bizpulse-prod`, `clientflowiq-prod`, `decisioniq-prod`, `proposaliq-prod`, `stafftalkiq-prod`), each set as `ANTHROPIC_API_KEY` Netlify env var (secret-marked, Production-only context, Local development empty per Session 30 security discipline). All five deployed as folder drag-deploys replacing prior single-file deploys.

Source files were single-file HTML drag-deploys in `...\DIGITAL ASSETS\FREE TOOLS\{tool}\index.html` — NOT proxy projects (contrary to brief premise; see D1 flags). proxy.js/netlify.toml created from scratch per tool around the existing (patched) index.html.

**Decided:**

- **Exposure class CLOSED across all 5 tools.** Every tool's dead `Streamline API 2` key (`...SwAA`) removed from its frontend. Key removal closes the exposure regardless of whether the tool's generate call completes — so all five are exposure-closed even though only three are functional. `Streamline API 2` confirmed disabled in console (last used May 23 2026, the incident date; nothing since). Original `Streamline API` (`...UAAA`) also confirmed disabled. Both retained for 24-48h bundled deletion cleanup, not this session.

- **Functional verdict: 3/5 functional, 2/5 deferred-fix** (browser-authoritative, see measurement correction below):
  - BizPulse — functional (full 10-question report rendered in-browser)
  - ClientFlowIQ — functional but NEAR-WALL (needed a warm retry on first heavy call; watch-this, not fix-now)
  - ProposalIQ — functional (full proposal rendered in-browser)
  - DecisionIQ — DEFERRED-FIX (analysis call 504s in-browser, warm, repeatedly)
  - StaffTalkIQ — DEFERRED-FIX (generate call 504s in-browser, three times)

- **Netlify synchronous-function timeout ceiling — CONFIRMED design constraint (D1 decision D-then-A, twice).** Netlify sync functions wall at ~10s (edge 504). DecisionIQ's analysis (deeply-nested JSON: verdict + 3 scored risks + 4 pros + 4 cons + 3-4 para narrative + 4 actions) and StaffTalkIQ's generate (2500-token markdown) both exceed it. The proxy pattern itself is sound (NewsletterIQ's 8000-token prose call works; three of five tools work) — the ceiling is hit by long/structured generations specifically, JSON-slow or prose-at-volume. Per-tool Option-A trims chosen over Railway-backend routing (Option B) deliberately: B forks one free tool onto the cross-product ChatbotIQ backend against the clean per-tool proxy pattern the others share — real maintenance cost for a free lead-gen tool. A is also better UX — a tight fast report converts better than a 30s wait. Trim is an improvement, not a compromise.

- **DecisionIQ deferred-fix spec (LOCKED, do not re-deliberate):** narrative 3-4 paras → 1-2; risks keep 3; pros/cons 4→3 each; actions 4→3; max_tokens 1800 → ~1100-1200. Structural node-count trim is the lever (the cap wasn't the bottleneck — it blew the wall at modest tokens). Re-measure warm through the tool's own UI, target <8s headroom. If still marginal after trim, reconsider Railway routing for this one tool.

- **StaffTalkIQ deferred-fix spec (LOCKED):** max_tokens 2500 → ~1500, tighten generate prompt for a punchier script. Re-measure warm through UI, target <8s. Follow-up/chat call (max_tokens 1000) likely already under wall — verify.

- **MEASUREMENT CORRECTION (record so next session doesn't repeat it).** Mid-session verification used PowerShell `Invoke-WebRequest` with hand-built synthetic payloads to "warm-measure" the heavy path. This produced a FALSE reading: three tools clustered at ~31s with stale response content, and BizPulse showed a 31s/504 that directly contradicted its observed in-browser full-report render. Root cause of the contradiction: the synthetic one-shot payload is a DIFFERENT request than the tool's real frontend call (which sends accumulated conversationHistory from the actual flow) — its timing tells you nothing reliable about the real path. The ~31-33s figures were a mix of PowerShell's own client timeout and genuine-but-unrepresentative synthetic-call durations. Verification instrument corrected to: **run the tool's own UI warm** — the only authoritative path. PowerShell synthetic-payload timing discarded as a verification method. The DecisionIQ + StaffTalkIQ broken verdicts stand because they 504'd in their OWN UIs, warm, repeatedly — browser-observed, not PowerShell-derived.

- **BUILD STANDARD PROMOTED (promote-ready, 2 proofs cleared this session) — Heavy-path warm timeout check.** Any tool on the synchronous Netlify-function proxy pattern must have its heaviest real generation measured warm **through the tool's own frontend (not a synthetic client payload)** against the ~10s function wall before it is declared shipped. Measured, not inferred from token count — DecisionIQ (deep JSON at modest 1800 tokens) and StaffTalkIQ (prose at 2500 tokens) both passed a naive token sniff and failed the wall. Target <8s warm for headroom. Tools that can't meet it need a trim (Option A) or an async/no-cap path before ship. Proofs: DecisionIQ + StaffTalkIQ, Session 32.

- **BizPulse key-input field removed — deliberate D1 PRODUCT decision (not incidental infra).** BizPulse alone had a user-facing API-key input field + `sk-ant-` validation + `EMBEDDED_KEY` fallback (pre-proxy BYO-key design). Under the proxy the key is server-side, so the field is a pointless vestige. D1 Option A: removed the field, security-note, key-prompt copy, validation, both `EMBEDDED_KEY` assignments, and the `apiKey` variable; rewired `startSession()` to go straight to questions; simplified `window.onload`. Verified zero orphan references (EMBEDDED_KEY / apiKey / api-key-input all 0). Reasoning recorded so the field's removal survives later questioning: free-tool audience (small-business owners) don't have Anthropic keys — the field was friction making a lead-gen tool look developer-facing, against positioning; embedded key already bypassed it for every real user, so removal changes nothing for them. Residual: unused `.security-note`/`.input-group` CSS rules left in stylesheet (dead, harmless — markup gone).

- **Archive pass (brief Block 1) DEFERRED.** Brief specified split at "Session 20 boundary" — but the journal has NO Session 20 (numbering jumps Session 5 → Session 22; no Session 6-21 block in the file). Real era boundary is Session 5 (V1.0-V1.3.2, lines 7-602) / Session 22 (V1.3.3+). D1 decision B: defer to a dedicated focused session with the split point as an explicit D1 decision — the single Session-5/Session-22 cut lands active at ~1,100 lines, missing the brief's 700-800 target, so the boundary wants deliberate decision (one era-file vs a second tier), not a fix-on-the-fly at the tail of a heavy session. Pattern 15 archive-trigger note already flags it for next session.

- **Pre-existing defects logged (NOT V1.4.6 regressions — out of infra-only scope):** ProposalIQ output header leaks uninterpolated `${Current Date}` template literal (pre-existing prompt-construction bug). DecisionIQ input-text low-contrast (faint on light boxes; pre-existing CSS, my patch was JS-only). BizPulse dead `.security-note`/`.input-group` CSS. All for a later content/CSS pass.

**Broken:**
- DecisionIQ analysis call + StaffTalkIQ generate call — 504 on Netlify sync timeout wall. Deferred-fix specs locked above. Both exposure-closed (dead key off frontend); broken-feature state, NOT security risk — a timed-out call consumes no tokens.
- ClientFlowIQ near-wall (functional, needed warm retry) — watch under real traffic.

**Cost estimate per 100 messages:** Unchanged per-message cost (same model, same passthrough). V1.4.6 is infra-only — no engine/prompt change to ChatbotIQ. Spend cap raised $20 → $80 (Session 30's $80 raise had not stuck — console read $20 at session start; brief premise correct, master-file "$80" was stale). Email notification $60 → $45 (~56% of new cap, within brief's ~$40-50 band). Auto-reload OFF (Tier-1-restricted). $0.39 spent this cycle, resets Jul 1.

**Next:**
- Dedicated archive-pass session (boundary = explicit D1 decision; Session-5/Session-22 era break candidate).
- DecisionIQ + StaffTalkIQ Option-A trim session (specs locked above; re-measure warm via UI).
- 24-48h bundled deletion of `Streamline API` + `Streamline API 2` (both disabled).
- ProposalIQ `${Current Date}` + DecisionIQ contrast — content/CSS pass.

**Files changed at V1.4.6:**

Outside git repo (free-tool proxy projects, drag-deploy — not version-controlled, deferred-to-git flagged Session 30):
- `FREE TOOLS\bizpulse\` — NEW netlify/functions/proxy.js + netlify.toml; index.html patched (key-out + field removal + startSession rewire)
- `FREE TOOLS\clientflowiq\` — NEW proxy.js + netlify.toml; index.html patched (key-out, 2 fetch sites)
- `FREE TOOLS\decision-advisor\` — NEW proxy.js + netlify.toml; index.html patched (key-out, 2 fetch sites, inline dangerous-direct header stripped). [Deploys to decisioniq-advisor.netlify.app — folder-name/site-name mismatch noted.]
- `FREE TOOLS\proposaliq\` — NEW proxy.js + netlify.toml; index.html patched (key-out, 2 fetch sites)
- `FREE TOOLS\stafftalkiq\` — NEW proxy.js + netlify.toml; index.html patched (key-out, 2 fetch sites)

No git commit/tag this session (CONFIG/infra work, no version bump — SR3: no tag op). Standing Rule 4 satisfied: all files delivered as final content, not diffs.

**Standing Rule / Pattern notes this session:**
- **SR1 / Pattern 22 (path-identity sub-class):** fired repeatedly and correctly. Brief path `gphi9343` wrong (real `gphi9`); brief "proxy folders already exist" wrong (single-file deploys); brief "Session 20" archive boundary wrong (not in file). All caught pre-action via filesystem/journal reads, zero deploys against assumed state.
- **SR1 (template read before extending):** NewsletterIQ proxy.js + netlify.toml + index.html read in full before generating any of the five. Per-tool index.html variation-checked before patching each (call-site count, key var name, headers, streaming, endpoint).
- **SR2:** hard-refresh smoke per deploy.
- **SR4:** final file content, not diffs — all five tool sets. (3+ prior proofs; remains promote-ready.)
- **SR5 / Pattern 14:** proxy-only sanity check before UI smoke, per tool. Per-key separation confirmed in dashboard (all 5 prod keys visible, created Jun 8).
- **SR6:** diagnostic commands shell-quoted, `-UseBasicParsing` included (PowerShell 5.x).
- **Pattern 14 fired four times:** BizPulse key-field variation (→ D1 product call); DecisionIQ timeout (→ D1 D-then-A); StaffTalkIQ timeout (→ D1 D-then-A + Build Standard); archive boundary mismatch (→ D1 defer). All surfaced with full option sets before action.
- **Measurement-method self-correction** (above) — caught a near-miss false verdict before it reached the journal. Discipline working: stopped before committing a wrong conclusion built on a flawed instrument.

**FLAGS FOR D1 (master-file actions):**
1. New Build Standard — Heavy-path warm timeout check (method: tool's own UI, not synthetic payload). Add to master-file Build Standards section.
2. Per-key product-mapping subsection — five new prod keys establish key→product mapping (closes the BizPulse orphan-cause class: Apr 16 rotation hit four products, missed BizPulse, nothing flagged the orphan; per-key mapping prevents recurrence). bizpulse-prod / clientflowiq-prod / decisioniq-prod / proposaliq-prod / stafftalkiq-prod each → their Netlify site.
3. Three brief-premise mismatches this session (gphi9343 path; proxy-folders-exist assumption; Session-20 archive boundary) — briefs need a quick state-check against real file/repo before handover.
4. V1.4.6 outcome: 5/5 exposure-closed, 3/5 functional, 2 deferred-fix (specs locked). Free-tool credential-exposure class CLOSED.
5. Cap restored $20 → $80, notification $45, auto-reload OFF. Master-file Infrastructure "$80/$60" line was stale — reconcile to actual ($80 cap as of today, $45 notification).
6. Master-file Live Products: BizPulse orphan (broken since ~Apr 15) closed; all five free tools on per-product prod keys.

**POSTSCRIPT — none this session.**

### Session 33 — 10 June 2026 — V1.4.7 (DecisionIQ + StaffTalkIQ Railway Routing)

**Built:** New standalone `POST /free-tool-proxy` endpoint added to the ChatbotIQ Railway backend, routing DecisionIQ + StaffTalkIQ off the Netlify synchronous-function path (which 504'd their heavy calls at the ~28-30s wall) onto Railway, which has no short execution wall. Endpoint is deliberately separate from `/chat`: no deployment resolution (`getDeploymentByOrigin` bypassed), no Supabase, no KB retrieval, no SSE, no system-prompt cache. Non-streaming Anthropic passthrough only.

Three changes shipped:
1. `backend/lib/anthropic.js` — new non-streaming sibling `proxyMessage({model, max_tokens, system, messages})` reusing the SDK `client` already instantiated in-file; passes the caller's model/max_tokens through (NOT the hardcoded `MODEL`/`MAX_TOKENS` constants). `classifyAnthropicError` now exported so the proxy route shares the streamChat error taxonomy (Build Standard #2). `streamChat` and its contract untouched.
2. `backend/server.js` — `/free-tool-proxy` route mounted alongside `/chat`, before the `/admin` mount. Validates required fields (mirrors Netlify proxy.js guard), calls `proxyMessage`, returns the SDK response as JSON. Version bumped to 1.4.7 (`/health` + boot log). CORS allow-list code unchanged — origins added via env var.
3. `decision-advisor/index.html` + `stafftalkiq/index.html` — all four fetch URLs swapped from `/.netlify/functions/proxy` to the full Railway endpoint (both heavy calls AND both follow-up calls — see Decided).

CORS: two free-tool origins (`https://decisioniq-advisor.netlify.app`, `https://stafftalkiq.netlify.app`) appended to Railway `ALLOWED_ORIGINS` env var. Boot log confirms all six origins live.

**Decided:**

- **Shared-generic endpoint over two named routes (D1 Session 33, Option 1).** One `/free-tool-proxy` serves both tools. Less code, matches the byte-identical-proxy pattern the five Netlify proxies already share. Per-tool spend separation lives at the Anthropic-key level (decisioniq-prod / stafftalkiq-prod), not the endpoint. Per-tool log visibility recoverable later via a body tag without a route split if wanted.

- **Sibling-function approach over exporting the raw SDK client (D2 call per brief).** `proxyMessage()` in `anthropic.js` keeps `server.js` thin and reuses wired auth + the existing error classifier. Cleaner than porting the old raw-fetch proxy.js logic into an Express handler.

- **All four calls routed to Railway, not just the two heavy ones (D2 call, measure-first per brief).** Brief left follow-ups (DecisionIQ 800-token, StaffTalkIQ 1000-token) as route-only-if-slow. Measurement reversed the brief's assumption: the StaffTalkIQ refine call (1000-token) ran 27.24s — it would have 504'd on Netlify, not "likely already under wall" as the brief assumed. The DecisionIQ follow-up (800-token) ran 16.28s — near-wall, real headroom risk as conversationHistory accumulates. Routing all four removes the latent split-path failure mode (report from Railway, follow-up from Netlify) and is the correct call. **Lesson logged: the brief's measure-first instinct would have missed the StaffTalkIQ follow-up failure if follow-ups had been left on Netlify on the "probably fine" assumption.**

**Broken:** Nothing. All four calls functional, error path correct.

**Smoke test results (browser, hard-refresh applied per Standing Rule 2, measured via tool's own UI per Build Standard #7):**

| Call | Initiator | Status | Duration | Size | Netlify outcome |
|---|---|---|---|---|---|
| DecisionIQ analysis (1200 tok) | (index):880 | 200 | 28.86s | 2.4 kB | would 504 (was 30122ms) |
| DecisionIQ follow-up (800 tok) | (index):1057 | 200 | 16.28s | 1.2 kB | near-wall |
| StaffTalkIQ generate (1500 tok) | (index):699 | 200 | 27.56s | 2.4 kB | would 504 (was 29732ms) |
| StaffTalkIQ refine (1000 tok) | (index):831 | 200 | 27.24s | 2.4 kB | would 504 (unmeasured at S32) |

Test inputs: Session 32.5 locked heaviest-realistic inputs (dog-grooming 12% pricing decision; Jordan/punctuality, firm-but-supportive, spoken + written follow-up format). Both rendered full output — DecisionIQ full report (verdict + scores + risk matrix + actions), StaffTalkIQ full script (spoken + written email follow-up).

- **Response-shape parity CONFIRMED on all four calls.** The SDK `messages.create()` response returned `{ content: [{ type:'text', text }], ... }` — every report and script rendered, meaning the tools' existing `data.content[0].text` parse survived the Netlify-proxy → SDK-passthrough swap. The brief's verify-with-one-real-call risk closed; verified four times over.

- **Error path CONFIRMED.** Malformed console request (missing max_tokens/messages) → HTTP 400, body `{status:'error', type:'validation_error', message:'Missing or invalid required fields: model, max_tokens, messages', suggestion:'...', recoverable:false}`. Build Standard #2 envelope correct, guard fires, no raw exception.

- **DecisionIQ CSS fixes (Session 32.5) CONFIRMED live** — input textarea dark bg (#1a1a1a) / light text (#F5F0E8) readable; narrative + proscons cards dark text (#1a1a1a) on light bg readable. File shipped was the post-CSS-fix copy (Standing Rule file-identity check passed).

**Cost estimate per 100 messages:** No per-message cost change — same model (claude-sonnet-4-5), same passthrough, just a different host for two tools' calls. The free tools were already billing against decisioniq-prod / stafftalkiq-prod keys; routing host changed, key + token cost unchanged. Railway compute cost negligible (two tools, low free-tool traffic, Hobby plan no execution-time billing). No spend-cap change this session.

**Next:**
- Cleanup pass (deferred, per brief Definition of Done): redundant Netlify proxy functions for decision-advisor + stafftalkiq now fully unused (all four calls on Railway) — flag for deletion once Railway path confirmed stable under real traffic. Do NOT delete same session.
- The `decisioniq-prod` / `stafftalkiq-prod` Netlify env-var keys are now unused on the Netlify side (calls go through Railway's `ANTHROPIC_API_KEY`). Flagged for cleanup review — confirm no orphan before removing.
- Build-journal archive pass still queued (boundary = explicit D1 decision; Session-5/Session-22 era break candidate; journal now past ~1,750 lines).

**Files changed at V1.4.7:**

In git repo (commit `40393be`, tag `v1.4.7` verified on remote: `40393be6c25b96ce1282db9fe57efa8a2b7b3b52 refs/tags/v1.4.7`):
- Modified: `backend/server.js` (+/- per `git diff`: new /free-tool-proxy route + version bump)
- Modified: `backend/lib/anthropic.js` (proxyMessage sibling + classifyAnthropicError export)
- Commit `40393be` (2 files changed, 106 insertions, 5 deletions). Pushed `94f0518..40393be`.

Outside git repo (Netlify drag-deploys, not version-controlled — per Session 30/32 free-tool deploy model):
- `FREE TOOLS\decision-advisor\index.html` — 2 fetch URLs swapped to Railway endpoint
- `FREE TOOLS\stafftalkiq\index.html` — 2 fetch URLs swapped to Railway endpoint

Railway: env var `ALLOWED_ORIGINS` extended +2 origins (decisioniq-advisor, stafftalkiq). V1.4.7 deploy ACTIVE, verified via boot log (`V1.4.7 listening on :8080`, CORS line shows all 6 origins) and 4/4 smoke calls 200.

**Standing Rule / Pattern notes this session:**
- **SR1 (verify prior version's actual exports before extending):** real `server.js` + `anthropic.js` read in full before generating. Confirmed actual exports — `streamChat`, `classifyAnthropicError` (was NOT exported — added export), module-private `client`, `resolveAllowedOrigins`, `makeError`/`serialiseError`/`sendError` import shape. `node --check` passed on both files before ship. No inference from memory.
- **SR1 sub-note (sendError behaviour inferred, not directly read):** `errors.js` was not uploaded; `sendError(res, status, errorObj)` signature inferred from four existing `/chat` call sites (all pre-SSE JSON sends). Error-path smoke confirmed the inference correct (structured 400 returned). Flagged at build time as the inference risk; closed by test.
- **SR1 file-identity sub-class:** DecisionIQ index.html confirmed as the Session 32.5 post-CSS-fix copy (not a pre-fix copy) via grep of #1a1a1a input/card rules before patching. Same class as Session 31.6 path-identity check.
- **SR2 (hard-refresh after frontend deploy):** applied on both tool URLs before smoke. (Free tools have no `<span class="version">` label — version-label step is ChatbotIQ-chat-surface-specific, N/A here.)
- **SR3 (pre-emptive tag-namespace check):** tag pushed clean, `git ls-remote` confirmed remote = local commit. No stale-tag collision.
- **SR4 (final file content, not diffs):** all four files delivered as complete final-shape artefacts. (4th+ proof — promote-ready.)
- **Pattern 14 (stop-and-ask):** endpoint-naming surfaced as structured stop-and-ask before build (Option 1 vs 2, recommendation + cost/risk). D1 chose Option 1. Response-shape parity surfaced as a test-protocol item (can't prove in Phase 1 chat — verified in operator smoke).
- **Pattern 22 (state-check before starting):** brief premises verified against live master file + journal before build — ALLOWED_ORIGINS mechanism, Railway URL, both tool URLs, repo + auto-deploy model all confirmed. Brief's prior-session `gphi9343` path corrected to `gphi9` in journal (not relevant this session — deploy is commit+push). Netlify proxy.js (brief item 5, not initially uploaded) requested from operator before build.

**FLAGS FOR D1 (master-file actions):**
1. V1.4.7 outcome: DecisionIQ + StaffTalkIQ deferred-fix (Session 32) RESOLVED via Railway routing. Both tools fully functional, 3/4 calls would have 504'd on Netlify. Master-file tool-status lines: update both from DEFERRED-FIX to FUNCTIONAL (Railway-routed).
2. Free-tool architecture now split: 3 tools (BizPulse, ClientFlowIQ, ProposalIQ) on Netlify proxy, 2 tools (DecisionIQ, StaffTalkIQ) on Railway `/free-tool-proxy`. Master-file architecture section should note the split + rationale (heavy/slow generations exceed Netlify wall).
3. Brief assumption correction worth a methodology note: "measure follow-up calls before assuming they're under-wall" — the StaffTalkIQ 1000-token refine call (assumed fine in brief) ran 27.24s and would have 504'd. Measure-first beat assume-fine. Candidate evidence for the Heavy-path warm timeout Build Standard (extend to: measure ALL calls a tool makes, not just the one flagged).
4. Cleanup queued (not done this session): redundant Netlify proxy functions + Netlify-side keys for the two migrated tools. Flag for a dedicated cleanup pass once Railway path stable under real traffic.
5. Build journal past ~1,750 lines — archive pass overdue.

**POSTSCRIPT — none this session.**

### Session 34 — 10 June 2026 — Journal archive (tier-1 cut)
Built: Archived Sessions 1–5 (incl. Session 3 postscript, Session 5 V1.3.1/V1.3.2 patches) from build-journal.md into build-journal-archive-v1.md. Cut lines 7–602 (596-line span, ending at the separator). Active journal resumes at Session 22; active file 1,225 lines.
Decided: Single-era cut, tier-2 deferred by design. Recent V1.4.x free-tool history (Sessions 22–33) is load-bearing and not archived this pass; tier-2 cut (Sessions 22–27, once V1.4.x stable under real traffic) is a future session. This intentionally misses the 700–800-line target — D1 call from Session 34 Task 1, not a miss. Archive header is session-based with no version range: version numbers do not track session numbers linearly in this era (Session 4 builds V1.4 before Session 5 builds V1.3, V1.4.x continues Session 23+), so any version range would mislead.
Broken: Two errors in the original archive instruction caught pre-execution — (1) off-by-one: Session 22 begins at line 603, not 602; (2) misleading "V1.0 → V1.3.2" version label on the archive header. Both corrected before cutting. State-check grep re-run against the operating copy per Standing Rule discipline.
Next: Session 35 — TBD. Tier-2 journal cut pending V1.4.x stability.
Files changed: build-journal.md (trimmed to Session 22+), build-journal-archive-v1.md (new, 607 lines)
KB sync (Pattern 15): commit + push both files; upload build-journal-archive-v1.md to D2 KB; re-upload trimmed build-journal.md to D2 KB. Both gates verified at close.

----------
