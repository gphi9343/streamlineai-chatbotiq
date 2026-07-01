### Session 35 — 01 July 2026 — V1.5.0 (VERBATIM Coverage Most-Direct-Answer Test)

> Session number inferred (last journaled = Session 34 archive, 10 Jun; numbering is non-linear in this era). D1 to confirm/renumber.

**Built:** Three coordinated Macarthur fixes shipped to production, culminating in engine V1.5.0. All causally linked: a KB content correction surfaced a retrieval gap, whose fix surfaced an engine-level blended-answer bug.

1. **KB content — turnaround range 10–15 → 7–15 business days.** Both turnaround rows updated (`26d33962` general turnaround + `648fe867` Job-C row). En dash preserved; minimal substring-replace `UPDATE` (`replace(body,'10–15','7–15')`) guarded by `id` + `like`, no full-body rewrite. SQL straight to Supabase, dry-run SELECT before apply, `UPDATE 1` each, live-tested on production.

2. **Retrieval — turnaround row question-anchor widening.** Appended soonest/how-fast/how-quickly/install phrasings to `26d33962`'s `question` field (weight-A tsvector), deliberately **no** `measure`/`come` vocabulary, so it ranks #1 for "soonest to install" phrasings without poaching the install-first VERBATIM's genuine booking-process queries. The lever: the english stemmer keeps `soonest` distinct from `soon`, so the turnaround row overtakes the VERBATIM (which only carries `soon`) on the reported phrasing. SQL-only, verified via `search_kb()` + production.

3. **Engine V1.5.0 — VERBATIM coverage "most-direct-answer" test.** Two coordinated pieces in `system-prompt.js`: (a) a coverage-test paragraph in KNOWLEDGE BASE BEHAVIOUR redefining "covers the user's question" as *the most direct and complete answer* (topical/keyword overlap ≠ coverage); (b) a forceful APPLICABILITY PRECONDITION at the top of the end-anchored VERBATIM RESPONSE SCOPE section, run before quoting, routing "how soon/fast/long/when" questions to the entry that states the timeframe rather than a topically-adjacent process VERBATIM. Also bumped `server.js` version literals 1.4.8 → 1.5.0 (`/health` + boot log), clearing the version-drift backlog. Merged PR #5 → `main` (merge `6149b8b`), Railway auto-deployed.

**Decided:**

- **Engine lane, not KB/retrieval, for the blended-answer problem.** Post-retrieval-fix top-3 for "whats the soonest you can install": turnaround REFERENCE `26d33962` #1 (rank 0.478), install-first booking VERBATIM `8ae5d40e` #2 (0.240), install-coordination REFERENCE `e0061be1` #3 (0.237). **VERBATIM PRECEDENCE is categorical, not rank-based** — with the booking VERBATIM in-context and read as "covering" the question, the engine required quoting it and (via VERBATIM RESPONSE SCOPE) anchoring the whole turn on it, producing the long blend. The two intents ("give me the number" vs "what's the booking process") share `install`/`soon` vocabulary and are lexically inseparable, so retrieval scoping could not cleanly split them — disambiguation belongs at the prompt layer. KB-restructure (narrow the VERBATIM anchor) and second-VERBATIM alternatives rejected: the former breaks the genuine booking query, the latter creates an unresolved multi-VERBATIM tie (already a logged V1.5 calibration item).

- **Iteration required (attempt 1 failed PR-env smoke 1).** First V1.5.0 attempt was a single mid-prompt paragraph keyed on *"a request for a specific figure/value."* It rendered correctly (char delta + `/admin/debug/system-prompt/:slug` confirmed) but smoke 1 was unchanged: *"soonest to install"* carries **no explicit number**, so the model read the booking VERBATIM as a valid timing answer and the value-keyed carve-out never fired; a calm paragraph at ~7% of the prompt also lost attention to the end-anchored RESPONSE SCOPE mandate (Pattern 8). Fix re-targeted the coverage test on *"most direct answer / timeframe-vs-process"* and **relocated** the decisive check into the high-attention end section. Attempt 2 passed all 5 smokes.

- **Pattern 5 held every iteration.** Identical char-delta across all three deployment prompts: +1342 (attempt 1), +2401 (attempt 2, vs pre-V1.5.0 baseline) — macarthur/streamlineai/upunt each.

- **Verified in PRODUCTION, not just PR env.** Operator ran smoke 1 against production `/chat` directly (no override) → short 7–15 answer, no booking quote, matches PR-env exactly. An early "shipped and verified" was corrected at close: PR-env pass + matching `/health` char count is necessary but **not** sufficient; a direct production behaviour observation is the bar.

**Broken:** None. All 5 smokes pass — target (macarthur "soonest to install" → short figure) + 4 regression guards (macarthur booking-process still quotes VERBATIM; streamlineai pricing + "what does StreamlineAI do" still quote VERBATIMs; upunt VERBATIM still quotes). No regressions.

**Concurrency note (important for char-count reconciliation):** PR #4 (`verbatim-framing-no-third-party`, commit `c5bcf64`) merged to `main` **during** this work, adding a "never attribute VERBATIM quotes to a third party/source" paragraph to VERBATIM RESPONSE SCOPE (+422 chars/deployment). Clean auto-merge with V1.5.0 (different part of the same section, no conflict). Production now carries **both**. The V1.5.0 brief's char-count targets (24549/25493/16943) predate PR #4 and are stale by +422; actual production counts are **24971/25915/17365**.

**Cost estimate per 100 messages:** No per-message cost change. Cached system prompt grew +~2823 chars/deployment (V1.5.0 +2401, PR#4 +422) — a marginal one-time cache-write increase; the dominant cached-read path is unchanged. No model change (chat = claude-sonnet-4-5). No spend-cap change this session.

**Production verification (V1.5.0, merged main `6149b8b`):**
- `/health` version **1.5.0** ✅
- `system_prompt_chars` — macarthur **24971**, streamlineai **25915**, upunt **17365** ✅ (match merged-main local build)
- Production `/chat` smoke 1 (macarthur "whats the soonest you can install") → 7–15 business days, no booking quote ✅

**Next:**
- Backlog (unchanged): Pass-2 repeat-shortening softness (INSUFFICIENT DATA repeat-callback doesn't reliably shorten on 2nd refusal) — not touched this session.
- Watch "how soon/fast/long" phrasings under real Macarthur traffic for edge phrasings the precondition might miss. Deterministic Plan B if any future phrasing regresses: cap the booking VERBATIM out of that phrasing's top-3 (retrieval lane) rather than a third prompt rewrite.

**Files changed (V1.5.0):**

In git repo (branch `verbatim-precedence-qualifier`, merged to `main` and deleted local+remote):
- `backend/lib/system-prompt.js` — coverage-test paragraph (KB BEHAVIOUR) + APPLICABILITY PRECONDITION (VERBATIM RESPONSE SCOPE) + V1.5.0 header. Commits `603c02d` (attempt 1), `77e42f7` (iter 2).
- `backend/server.js` — version literals 1.4.8 → 1.5.0 (`/health` line 181, boot log line 404). Commit `603c02d`.
- Merge `6149b8b` (PR #5 → main), pushed. Railway auto-deploy ACTIVE (`/health` = 1.5.0).

In Supabase (`kb_entries`, deployment `macarthur`; SQL-only, no git, no service-role via CCode):
- Rows `26d33962` + `648fe867` body: `10–15` → `7–15` business days.
- Row `26d33962` question: appended soonest/how-fast/install anchor phrasings.

**Standing Rule / Pattern notes this session:**
- **No service-role calls via CCode:** every Supabase SELECT/UPDATE and `search_kb()` diagnostic was handed to the operator to run in the SQL Editor; CCode never touched the DB. Held across all KB + retrieval steps.
- **Diff-by-diff approval:** every SQL and prompt edit presented before apply; dry-run SELECT before UPDATEs; full row IDs requested rather than fabricated; PR brief approved before implementation; revised wording approved before commit.
- **Live-test before "done":** corrected an early "shipped and verified" — production behaviour test is the bar, not PR-env pass + deploy/char-count confirmation. (Methodology candidate, below.)
- **Pattern 5 (CONFIG vs CODE):** engine change in shared `buildSystemPrompt`; char-delta verified identical across all three deployments each iteration.
- **Pattern 8 (attention-weighting):** root cause of attempt-1 failure; fix relocated the decisive check to the end-anchored high-attention section.
- **Co-Authored-By trailer** corrected to `Claude` (no model/version string) per standing rule after an initial wrong trailer was caught.
- **Environment gap:** no `gh` CLI / GitHub token — PR open + merge done via local git (`merge --no-ff`, push to `main`); PR body + comment handed to operator to paste. `/health` verification done via public endpoint (no admin token needed — it exposes `version` + per-deployment `system_prompt_chars`).

**FLAGS FOR D1 (master-file actions):**
1. **V1.5.0 shipped + production-verified** — add to master-file engine-version history. VERBATIM PRECEDENCE is now qualified by a most-direct-answer coverage test (KB BEHAVIOUR) + an APPLICABILITY PRECONDITION (VERBATIM RESPONSE SCOPE).
2. **Version-drift backlog CLOSED** — `server.js` `/health` + boot-log literals now 1.5.0 on main; retired the tracking memory.
3. **Two engine changes in one deploy window** (V1.5.0 + PR#4 third-party-framing). Master-file VERBATIM RESPONSE SCOPE description should note the third-party-attribution prohibition (PR#4) alongside the applicability precondition (V1.5.0).
4. **Methodology candidate (1st proof, caught at close):** "PR-env smoke pass + matching `/health` char count ≠ production-verified; require a direct production behaviour observation before declaring 'verified'."
5. **KB content note:** Macarthur turnaround is now **7–15 business days** (Ruby-confirmed, "to cover ourselves"). If the master file records deployment facts, update the turnaround line.

**POSTSCRIPT — none this session.**
