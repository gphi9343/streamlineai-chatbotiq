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
