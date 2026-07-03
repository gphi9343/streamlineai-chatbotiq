### Session 36 — 03 July 2026 — V1.6 (Conversation Digest + Client Viewer) + turnaround-fabrication observability

> Session number inferred (last journaled = Session 35, 01 Jul). Numbering non-linear in this era — D1 to confirm/renumber.

**Built:** Four linked pieces across engine, DB, and two frontends. A Ruby bug report opened the session and resolved to an observability fix; the bulk of the session then built the Conversation Digest feature end-to-end into a client-facing deliverable.

1. **Turnaround-fabrication investigation (Macarthur) — observability-only fix, root cause UNCONFIRMED.** Ruby reported a cold-start "What is your turnaround" returning a fabricated "3–4 weeks" despite the correct 7–15 business-days REFERENCE (`26d33962`) ranked #1 in CONTEXT. Static trace found the engine path clean: chat retrieval scope (`CONFIG.client_slug`) matches the debug endpoint's URL slug, CONTEXT is assembled on the cold-start turn, and NEVER FABRICATE is present. **Could not reproduce across 35 production cold-starts** (21 exact-phrasing + 8 adjacent + 6 specific-value probes) — every turnaround turn grounded on 7–15, `kb_hits` 2–3. A "20mm/40mm" thickness answer looked like a same-class fabrication but the operator verified it grounded → ruled out. Root cause not isolable on the current build; the happy path is robust. The one actionable engine finding: **assistant rows never recorded what CONTEXT the model received**, so a post-hoc retrieval re-run only shows current KB state — the failing turn is un-diagnosable after the fact. Shipped a logging-only `[chat-diag]` per-turn diagnostic (query + retrieval_ok + kb_hits + entry ids/ranks + response preview) so the next occurrence is separable ("empty/failed retrieval → fabricated" vs "correct entry in-context → ignored"). Held the empty-context sentinel (#2) as an unconfirmed hypothesis. **Not reported to Ruby as fixed**, per standing discipline.

2. **Conversation Digest (admin, pull-mode).** `sessions.deployment_slug` migration (operator-run SQL: additive nullable column + backfill by display-name→slug + index; 113/17/13, zero NULLs) — chosen over mapping the display-name string at query time, to kill the brittleness. Write-path fix so new sessions populate the slug (`ensureSession` + `/chat` call site). Slug-scoped admin auth retrofit: `requireAdminAuth` gained a `param` slug mode + scoped enumeration; `/admin/deployments` and both `/admin/debug/*` tightened from any-valid-token to token-must-match-slug — **closing a cross-tenant exposure gap** (one deployment's token could previously read another's prompt/retrieval). New `GET /admin/conversations/:slug?start=&end=` (date-range, FK-embedded messages, threads). New admin-frontend collapsible thread-list panel with date presets. PR #7 merged, production-verified (114 Macarthur convos / other-token 401).

3. **Client-token auth tier.** A second, narrower token pool (`client_token_env_var` → `CLIENT_TOKEN_MACARTHUR`, operator-generated + set in Railway) for the client viewer. `requireAdminAuth` gained `allowClientToken` + `allowQueryToken`, both opt-in per route — **the route allowlist is the opt-in itself** (only `/admin/conversations/:slug` passes them), so a leaked client link is structurally unable to reach KB/debug. Hardening: admin token authorizes via **header only**, never `?token=`; the client token may use header or the query fallback. `req.authTier` attached. Merged, production-verified (client-via-query 200; client on kb/debug 401; admin-via-query 401; admin-via-header no regression; client token slug-scoped).

4. **Client-facing Conversations viewer.** New `client-conversations-frontend/` copy-swap template (static, no build, no login): reads slug from `config.js` (`?slug=` override) + token from `?token=`, calls the conversations endpoint via the query-param path, reuses the admin panel's escaping + collapse rendering stripped to one deployment, auto-loads last 7 days. **Light theme matched to the approved live widget** (`macarthur-chat-frontend/style.css`: `#f5f5f5` ground, `#2c2c2c` text, `#CBA58F` stone-rose, warm-cream/grey chat bubbles, black header block) — deliberately NOT the stale `macarthur.js` brand block. Deployed to `macarthur-conversations.netlify.app`, origin added to `ALLOWED_ORIGINS` for CORS, live-tested end-to-end, bookmarkable `?token=` link sent to Ruby.

5. **CONFIG drift fix.** `macarthur.js` `brand` block corrected from the stale near-black LeadLock values (`#0A0908`/`#F4EFE9`) to the real light theme (`#f5f5f5`/`#2c2c2c`; accent already correct). Zero behavioural impact (not rendered into the system prompt) — pure correctness so CONFIG stops misleading future work, as it did this session.

**Decided:**

- **Turnaround: observability over speculative prompt edit.** With 0/35 reproduction and a robust happy path, a prompt change would have been a blind edit to a working path (Session 35 showed how easily that misfires). Chose the logging instrument + honest "unconfirmed root cause," not a false fix.
- **Auth allowlist as per-route opt-in flags**, not a string/path list — structural, no drift risk.
- **Admin token never valid in a URL** (header-only); the query path is client-token-only in effect.
- **Schema-harden sessions with `deployment_slug`** rather than map display-name→slug at query time.
- **Client viewer theme sourced from the live widget**, not the CONFIG brand block (confirmed stale).

**Broken:** Nothing shipped broken. The turnaround root cause is explicitly **unconfirmed** — the observability log is the mechanism to catch the next occurrence, not a fix.

**Cost estimate per 100 messages:** No per-message change. `[chat-diag]` is one `console.log` per turn (Railway logs, no model/DB cost). Chat model unchanged (`claude-sonnet-4-5`). New admin/client endpoints are read-only DB queries off the chat path.

**Production verification:**

- Retrieval-observability PR merged; `[chat-diag]` emits on production `/chat`.
- Conversation Digest PR #7 merged; `/admin/conversations/macarthur` → 114 (admin), 401 (other token).
- Client-token PR merged; client via query → 200, on kb/debug → 401, admin via query → 401, admin via header → 200.
- Client viewer live at `macarthur-conversations.netlify.app?token=…`, CORS-allowed, fresh-incognito render confirmed, sent to Ruby.

**Next / open:**

- **`/health` version literal still `1.5.0`** despite V1.6 features live — version drift reopened (Session 35 had just closed it). Bump decision needed next session; not urgent.
- **Empty-context sentinel (#2)** held pending a logged recurrence or independent evidence.
- **Pass-2 repeat-shortening softness** — untouched backlog.
- **Deferred `NOT NULL`** on `sessions.deployment_slug` — operator to apply after a post-deploy Step-B re-run shows zero NULLs.
- **CONFIG brand-drift scan** — check other deployments' brand blocks for the same LeadLock-copy staleness (small, non-urgent).

**Files changed (Session 36):**

- Engine (PRs → main): `backend/server.js` (`[chat-diag]` log; `ensureSession` call site), `backend/lib/supabase.js` (`ensureSession` writes slug), `backend/lib/auth.js` (`param` mode + scoped enum; client tier + header-only admin + `req.authTier`), `backend/routes/admin.js` (slug-scoped `/deployments`+`/debug/*`; new `/conversations/:slug` + client-tier flags), `backend/config/macarthur.js` (`client_token_env_var`; brand fix), `backend/migrations/v1.6-sessions-deployment-slug.sql` (repo record).
- Frontends (main → Netlify): `admin-frontend/{index.html,style.css,admin.js}` (Conversations panel); `client-conversations-frontend/{index.html,app.js,style.css,config.js}` (new client viewer).
- Supabase (operator-run): `v1.6-sessions-deployment-slug.sql` applied (113/17/13).
- Railway env (operator): `CLIENT_TOKEN_MACARTHUR` set; `macarthur-conversations.netlify.app` added to `ALLOWED_ORIGINS`.

**Standing Rule / Pattern notes this session:**

- **Client-facing Conversations viewer is now a STANDARD DELIVERABLE for every re-skin**, alongside the chat widget itself.
- **CCode briefs are always posted between delimiter lines** going forward.
- **Live-test-before-done** held throughout — every backend change smoke-tested in the PR env + production-verified; client viewer live-tested end-to-end before hand-off.
- **No service-role / no direct-prod-DB via CCode** — migration + backfill handed to the operator's SQL Editor.
- **Engine = topic branch → PR → Railway PR env → smoke → merge; frontend = straight to Netlify + immediate live-test.** Held for every change.
- **CONFIG-vs-CODE (Pattern 5):** token content in env/CONFIG, rule shape in engine; brand-of-record correctness matters (the stale block misled this very session).

**FLAGS FOR D1 (master-file actions):**

1. **Turnaround fabrication — NOT fixed, root cause unconfirmed.** Observability shipped; do not report to Ruby as resolved. Next occurrence caught via `[chat-diag]`.
2. **V1.6 shipped:** `sessions.deployment_slug`, slug-scoped admin auth (cross-tenant gap closed), Conversation Digest endpoint + admin panel, client-token tier, client viewer. Add to engine-version history.
3. **Client Conversations viewer = standard re-skin deliverable** — add to build checklist.
4. **Version-drift reopened:** `/health` still `1.5.0`; V1.6 live. Bump decision needed.
5. **CONFIG drift class:** `macarthur.js` brand fixed this session; worth scanning other CONFIG brand blocks for LeadLock-copy staleness.

**POSTSCRIPT — none this session.**
