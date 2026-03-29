# Browser Help Competitive Capability Plan

Ranked plan for closing the highest-value browser-use and computer-use capability gaps in OpenDevBrowser without breaking the current browser-first architecture.

---

## Overview

### Current repo-backed baseline
- Current helper posture is already wired end to end:
  - config default is `browser_with_helper` with `optionalComputerUseBridge.enabled=true` in `src/config.ts:363`
  - CLI/tool/workflow overrides already propagate `challengeAutomationMode`
  - both `BrowserManager` and `OpsBrowserManager` already expose `snapshot`, `cookieList`, `cookieImport`, `debugTraceSnapshot`, pointer, and drag through `createChallengeRuntimeHandle()`
- March 23 skill-pack governance work is already closed and green:
  - `node scripts/docs-drift-check.mjs` currently passes at `61` CLI commands, `54` tools, `54` `/ops` commands, and `35` `/canvas` commands
  - `tests/docs-drift-check.test.ts` pins challenge-override wording, bundled-skill fallback wording, copied-versus-discoverable inventory wording, and the new skill-pack marker checks
  - `tests/skill-workflow-packs.test.ts` runs the shipped workflow-pack validators end to end
  - research and shopping validator runs are now deterministic fixture checks via `ODB_CLI_VALIDATOR_OVERRIDE` plus `validator-fixture-cli.sh`
- Remaining plan scope is browser-help capability posture, not skill-pack governance closure.
- Current live provider-direct baseline remains constrained:
  - `artifacts/skill-runtime-audit/lanes/provider-direct.json` reports `pass=20`, `env_limited=7`, `fail=0`
  - current `env_limited` cases are `provider.social.reddit.search`, `provider.social.instagram.search`, `provider.shopping.target.search`, `provider.shopping.costco.search`, `provider.shopping.aliexpress.search`, `provider.shopping.temu.search`, and `provider.shopping.others.search`
- Current highest-signal live artifacts:
  - `artifacts/investigations/helper-observability-20260323/target.json` proves `providerShell=target_shell_page`, `constraint.kind=render_required`, and `challengeOrchestration.invoked=false`
  - `artifacts/investigations/helper-observability-20260323/temu.json` proves `challengeOrchestration.invoked=true` but `lane=defer`, `status=deferred`, `cookieCount=19`, and `checkpointRefs=["r55"]`
- The remaining gaps are concentrated in three areas:
  - live-browser recovery coverage for render-required shells
  - execution parity for already-exposed runtime capabilities
  - screenshot, evidence, and verification strength for browser-scoped helper recovery
- Current highest-signal local seams:
  - `src/providers/runtime-factory.ts` only invokes orchestration inside the preserve-eligible auth/challenge branch
  - `src/challenges/action-loop.ts` does not execute `cookie_import`, `cookie_list`, `snapshot`, or `debug_trace` even though those step kinds already exist in `src/challenges/types.ts`
  - `src/challenges/optional-computer-use-bridge.ts` still returns click-only helper suggestions from canonical refs
  - `src/challenges/capability-matrix.ts` still disables helper use whenever `humanBoundary !== "none"`
  - `src/challenges/interpreter.ts` only detects MFA and password-like text as human boundaries, so `explicit_consent` is not materially classified yet
  - `src/challenges/verification-gate.ts` uses a narrow progress heuristic
  - `src/challenges/evidence-bundle.ts` hard-codes `screenshotCaptured: false`
  - `src/snapshot/ops-snapshot.ts` warns when iframe nodes are skipped, and the live Temu artifact shows skipped iframe pressure in practice

### External competitive patterns
- `usecomputer` benchmark:
  - screenshot output carries reusable capture geometry and coordinate-remap metadata
  - coordinate remap is applied consistently across `click`, `hover`, `drag`, and `mouse move`
  - a dry-run `debug-point` flow validates where a mapped click would land before execution
  - explicit `mouseDown`, `mouseUp`, and `mousePosition` primitives show the shape of a strong action surface, even though the package is desktop-scoped
  - source: <https://github.com/remorses/kimaki/tree/main/usecomputer>
- OpenAI Computer Use:
  - screenshot-driven browser action loops with click/type/scroll style actions
  - official guidance explicitly allows combining the computer-use loop with a custom harness and browser artifacts
  - source: <https://platform.openai.com/docs/guides/tools-computer-use>
- Anthropic Computer Use:
  - fine-grained mouse/keyboard actions including mouse-down/mouse-up, cursor movement, key presses, scrolling, and optional zoom
  - explicit prompt-injection guidance for on-page content treated as untrusted
  - source: <https://docs.anthropic.com/en/docs/build-with-claude/computer-use>
- Browserbase / Stagehand:
  - AI-native `act`, `observe`, `extract`, and `goto` split
  - persistent authenticated browser contexts, session inspector for remote control/human-in-loop, downloads/uploads, proxies, and signed-agent identity
  - source: <https://docs.browserbase.com/introduction/stagehand>, <https://docs.browserbase.com/guides/authentication>, <https://docs.browserbase.com/fundamentals/using-browser-session>, <https://docs.browserbase.com/features>
- browser-use:
  - persistent profiles that sync local auth into cloud runs
  - optional TOTP support, shared workspaces for file upload/download, and sandbox-level proxy, stealth, and CAPTCHA/Turnstile bypass
  - source: <https://docs.browser-use.com/customize/authentication>, <https://docs.browser-use.com/guides/workspaces>, <https://docs.browser-use.com/customize/sandbox/quickstart>

### Key decisions
- Explicit username/password, OTP, MFA, passkey, and similar secret-entry flows remain human-only.
- We should not copy competitor code or mimic vendor-specific behavior verbatim.
- The correct hedge is to absorb capability classes and interface patterns into our own typed challenge plane:
  - richer evidence
  - render-shell recovery
  - execution parity for existing runtime actions
  - browser-scoped screenshot geometry
  - mapped pointer recovery
  - better continuity reuse
  - bounded frame-aware recovery only when DOM evidence is incomplete
- Keep browser-first DOM/ref control as primary truth.
- Add a bounded visual lane only when DOM-first evidence is insufficient or clearly incomplete.

### External benchmark methodology
- This plan uses external systems such as `usecomputer` only as capability-class benchmarks.
- We borrow pattern classes, then translate them into OpenDevBrowser's existing browser-scoped architecture:
  - screenshot geometry becomes browser-owned capture metadata and remap utilities
  - mapped click, hover, drag, and pointer sequences become helper-proposed plans executed only through `ChallengeRuntimeHandle`
  - debug-point style validation becomes a dry-run browser artifact that shows the projected landing point before a committed pointer action
  - narrower observation scopes become browser page, frame, or region captures only when manager-owned runtime methods support them
- A benchmark capability is in scope only if it can be expressed as all of the following:
  - manager-owned runtime surface
  - browser-session-local observation or actuation
  - typed challenge evidence, planning, and verification
  - explicit human stand-down for secret-entry flows
- Anything requiring display enumeration, window enumeration, global desktop coordinates, or OS-wide automation is out of scope for this plan.

### Impact tiers
- High impact:
  - render-required shell recovery while the fallback session is still alive, with explicit handoff into preserve-eligible orchestration only when needed
  - execution parity for existing runtime capabilities: `cookie_list`, `cookie_import`, `snapshot`, and `debug_trace`
  - browser-scoped screenshot geometry plus mapped pointer actuation
  - helper eligibility for typed non-secret interstitials
  - stronger evidence and verification for screenshot-assisted recovery
- Medium impact:
  - debug-point style dry-run validation artifacts
  - iframe-pressure signals and bounded frame-aware recovery
  - remaining safe action additions such as `check`, `uncheck`, `scrollIntoView`, and `waitForRef`
- Low impact:
  - replay ergonomics and audit polish beyond current diagnostic needs
  - extra manual takeover UX beyond existing surfaces
- Out of scope:
  - desktop-agent behavior
  - display and window enumeration as product goals
  - global desktop coordinates
  - arbitrary OS automation
  - secret-entry automation

### Revised priority order
1. Add render-shell recovery before fallback completion, but keep it fallback-owned until the page transitions into a preserve-eligible blocker.
2. Make already-exposed continuity and observation actions executable.
3. Add screenshot-backed browser capture geometry and mapped pointer helper flows only after extending `ChallengeRuntimeHandle` with the screenshot or capture seam the challenge plane needs.
4. Add first-class non-secret interstitial taxonomy and helper eligibility rules.
5. Improve evidence, verification, and audit taxonomy after Tasks 1 to 4 establish the new metadata.
6. Add bounded iframe-aware and visual recovery only where DOM grounding is incomplete and the screenshot/runtime seams from Task 3 already exist.
7. Add truly new safe runtime actions only after the existing surface is fully consumed.

---

## Task 1 — Add Render-Shell Recovery Before Fallback Completion

### Reasoning
The biggest current miss is that OpenDevBrowser often reaches a live browser page, captures HTML, and then exits before attempting browser-safe recovery on render-required shells like `target_shell_page`, `bestbuy_international_gate`, `duckduckgo_non_js_redirect`, and `temu_empty_shell`. Current `runtime-factory` challenge orchestration only runs for preserve-eligible `auth_required` and `anti_bot_challenge` blockers, so this task must add a bounded fallback-owned recovery path instead of implicitly reusing the preserved-session branch.

### What to do
Add a bounded shell/interstitial recovery pass that runs while the fallback browser session is still alive, before fallback returns `completed`, and only hand off to the existing challenge-preserved path if the page transitions into `auth_required` or `anti_bot_challenge`.

### How
1. Extend browser-fallback request and response plumbing to preserve `providerShell` and `constraint.kind` for `render_required` captures.
2. Add a pre-completion recovery hook in `src/providers/runtime-factory.ts` for `render_required` fallback captures, without changing the existing preserve-eligible orchestration boundary unless the page transitions into `auth_required` or `anti_bot_challenge`.
3. Start with typed shell templates:
   - non-JS redirect
   - country/store selector
   - international gate
   - generic rendered shell with actionable checkpoints
4. Reuse existing browser-safe actions only:
   - click
   - hover
   - select
   - scroll
   - pointer
   - drag
   - wait
5. Keep hard stop rules:
   - no username/password entry
   - no OTP/passkey
   - bounded attempts and no-progress budget

### Files impacted
- `src/providers/runtime-factory.ts`
- `src/providers/constraint.ts`
- `src/providers/shopping/index.ts`
- `src/challenges/evidence-bundle.ts`
- `src/challenges/interpreter.ts`
- `tests/providers-runtime-factory.test.ts`
- `tests/providers-shopping.test.ts`
- `tests/provider-direct-runs.test.ts`

### End goal
Render-required shells are treated as recoverable live-browser states, not automatic dead ends, while the current preserve-eligible orchestration boundary remains explicit.

### Acceptance criteria
- [ ] Target-like render shells can enter a bounded pre-completion recovery pass before fallback returns completed HTML
- [ ] `providerShell` and `constraint.kind` remain visible in recovery input and emitted fallback metadata
- [ ] Only shells that clear inside the live fallback session resume the original provider flow automatically; still-blocked shells keep explicit `render_required` and `providerShell` diagnostics
- [ ] Pages that transition into `auth_required` or `anti_bot_challenge` still use the existing preserve-eligible orchestration boundary
- [ ] Secret-entry pages still yield immediately

---

## Task 2 — Make Continuity and Observation Actions Executable

### Reasoning
The challenge plane already knows when cookies, session continuity, and fresh observation context exist, but the action loop cannot act on several of those capabilities even though the runtime handle already exposes them.

### What to do
Turn continuity and observation metadata into executable steps and make continuity-first planning the default when safe.

### How
1. Extend `ChallengeActionStep` payload shape where needed, then implement execution for:
   - `cookie_list`
   - `cookie_import`
   - `snapshot`
   - `debug_trace`
2. Add planner rules for:
   - cookie refresh then retry
   - cookie import then verify
   - session reuse before generic click exploration
   - fresh snapshot or debug trace before declaring no progress
3. Promote preserved target or session recovery when present.
4. Record whether continuity and observation actions were attempted, succeeded, and changed state.

### Files impacted
- `src/challenges/action-loop.ts`
- `src/challenges/types.ts`
- `src/challenges/strategy-selector.ts`
- `src/challenges/verification-gate.ts`
- `src/challenges/orchestrator.ts`
- `tests/challenges-action-loop.test.ts`
- `tests/challenges-orchestrator.test.ts`

### End goal
Cookie, session, snapshot, and trace continuity become real remediation lanes instead of passive metadata.

### Acceptance criteria
- [ ] The action loop can execute `cookie_import`, `cookie_list`, `snapshot`, and `debug_trace` through explicit step payloads covered by challenge-loop tests
- [ ] Cookie/session continuity gets planned ahead of generic click exploration when evidence supports it
- [ ] Snapshot and trace refresh can be used as bounded verification steps before stand-down
- [ ] Outcome metadata records continuity attempts and whether they changed state
- [ ] Auth recovery still stops at explicit secret entry

---

## Task 3 — Add Browser-Scoped Screenshot Geometry and Mapped Pointer Recovery

### Reasoning
The strongest transferable `usecomputer` pattern is not desktop automation breadth. It is geometry discipline: screenshots carry reusable capture metadata, and every later pointer action is remapped consistently back into the real capture space. The browser managers already expose `screenshot`, `pointerMove`, `pointerDown`, `pointerUp`, and `drag`, but `ChallengeRuntimeHandle` currently does not expose screenshot capture to the challenge plane, so this task must extend the runtime contract before it can claim screenshot-backed recovery.

### What to do
First extend the challenge runtime contract with browser-scoped screenshot capture and geometry metadata, then add mapped pointer helper steps and a bounded dry-run validation artifact.

### How
1. Extend `ChallengeRuntimeHandle` and the manager-owned runtime-handle implementations to expose the screenshot or capture-metadata seam the challenge plane needs.
2. Extend challenge evidence to record real screenshot presence plus browser capture geometry:
   - capture bounds
   - image dimensions
   - viewport dimensions or scale metadata where available
3. Add typed mapped pointer step payloads for:
   - click
   - hover
   - pointer move
   - pointer hold and release
   - drag
4. Add remap utilities that convert screenshot-space coordinates back into browser-scoped execution coordinates.
5. Add a dry-run diagnostic artifact that marks the projected landing point before a committed pointer action.
6. Keep this browser-scoped:
   - no global desktop coordinates
   - no native window manager semantics
   - no uncontrolled OS access

### Files impacted
- `src/challenges/types.ts`
- `src/challenges/evidence-bundle.ts`
- `src/challenges/optional-computer-use-bridge.ts`
- `src/challenges/action-loop.ts`
- `src/challenges/verification-gate.ts`
- `src/browser/manager-types.ts`
- `src/browser/browser-manager.ts`
- `src/browser/ops-browser-manager.ts`
- `tests/challenges-action-loop.test.ts`
- `tests/challenges-orchestrator.test.ts`
- `tests/browser-manager-challenge-runtime-handle.test.ts`
- `tests/ops-browser-manager-challenge-runtime-handle.test.ts`
- focused screenshot-remap or dry-run coverage under `tests/` (new file only if no current suite can absorb it)

### End goal
Helper mode can make screenshot-assisted browser moves that land predictably and can be validated before execution.

### Acceptance criteria
- [ ] `ChallengeRuntimeHandle` exposes the screenshot or capture-metadata path the challenge plane needs, and runtime-handle tests cover the added method surface
- [ ] Challenge evidence records real screenshot capture state and reusable browser capture geometry
- [ ] Helper mode can propose mapped pointer sequences beyond click-only suggestions
- [ ] Mapped `click`, `hover`, `drag`, and pointer move/hold flows execute through `ChallengeRuntimeHandle`
- [ ] A dry-run artifact can show the projected landing point before a real pointer action
- [ ] The implementation stays browser-scoped and never depends on desktop-agent semantics

---

## Task 4 — Add First-Class Non-Secret Interstitial Taxonomy and Helper Eligibility

### Reasoning
Consent, geo, store, international, and non-JS gates are currently spread across provider shell classification and challenge heuristics instead of being first-class recoverable states. At the same time, helper eligibility is still blocked too broadly, so the system cannot distinguish helper-safe friction from true human-only authority boundaries.

### What to do
Teach the challenge plane to recognize recoverable interstitial classes directly and use that taxonomy to decide when helper mode is still safe.

### How
1. Add typed interstitial classes:
   - `explicit_consent`
   - `geo_or_country_gate`
   - `store_selector`
   - `non_js_redirect`
   - `render_shell`
2. Detect them from:
   - provider shell
   - snapshot text
   - actionables
   - trace hosts and warnings
3. Refine human-boundary detection so only true secret-entry and authority boundaries cause mandatory yield.
4. Allow helper mode to remain eligible for browser-safe non-secret interstitials while keeping explicit stand-down reasons.

### Files impacted
- `src/challenges/interpreter.ts`
- `src/challenges/types.ts`
- `src/challenges/capability-matrix.ts`
- `src/challenges/strategy-selector.ts`
- `src/providers/constraint.ts`
- `tests/challenges-interpreter.test.ts`
- `tests/challenges-capability-matrix.test.ts`
- `tests/providers-shopping.test.ts`

### End goal
Recoverable browser interstitials are identified and handled deliberately instead of collapsing into generic `env_limited` or being blocked by an overly broad helper stand-down.

### Acceptance criteria
- [ ] `explicit_consent` becomes a real detected state instead of dead schema
- [ ] Non-secret interstitials are mapped to browser-safe recovery strategies
- [ ] Helper eligibility remains allowed for helper-safe interstitials and yields only for true human-only boundaries
- [ ] Stand-down reasons remain explicit in outcome metadata

---

## Task 5 — Improve Evidence, Verification, and Audit Taxonomy

### Reasoning
Even after behavior improves, weak evidence and broad `env_limited` buckets will keep the product hard to tune and hard to compare against competitors. Evidence must prove what the helper saw, what it tried, and why it stopped.

### What to do
Upgrade challenge evidence, progress detection, and audit output so remaining failures are diagnosable by actual missing capability.

### How
1. Expand progress heuristics to include:
   - actionable-count deltas
   - checkpoint ref changes
   - shell/interstitial markers
   - screenshot refresh presence
   - visible/enabled/checked state changes where available
2. Record richer challenge evidence:
   - screenshot presence
   - capture geometry identifiers
   - iframe-pressure/skipped-frame counts
   - helper stand-down reason
   - continuity attempts and outcomes
3. Split audit output into more precise failure classes:
   - render-shell gap
   - continuity gap
   - helper stand-down
   - human-required
   - true environment gap
4. Preserve the existing high-level `env_limited` umbrella only as a summary surface.

### Files impacted
- `src/challenges/evidence-bundle.ts`
- `src/challenges/verification-gate.ts`
- `scripts/live-direct-utils.mjs`
- `scripts/provider-direct-runs.mjs`
- `tests/provider-direct-runs.test.ts`
- `tests/skill-runtime-audit.test.ts`

### End goal
Future challenge regressions can be triaged by actual missing capability instead of by a single overloaded status bucket.

### Acceptance criteria
- [ ] Progress detection observes more than URL/title/ref-list changes
- [ ] Challenge evidence records helper stand-down and shell/interstitial state, plus screenshot presence once the Task 3 runtime capture seam exists
- [ ] Runtime audit output separates helper stand-down, render-shell, continuity, human-boundary, and true environment cases

---

## Task 6 — Add Bounded Frame-Aware and Visual Recovery

### Reasoning
Current live artifacts prove that challenge evidence can miss iframe-hosted controls. After geometry and evidence are strengthened, the next competitive step is a bounded secondary recovery lane for pages where DOM grounding is incomplete.

### What to do
Add frame-aware discovery and a bounded visual recovery lane that only activates when DOM and ref evidence are clearly incomplete.

### How
1. Promote iframe coverage from warning-only to recoverable context:
   - expose skipped-frame counts in challenge evidence
   - expose frame pressure in verification and audit output
2. Add frame-aware discovery where safe:
   - map frame-local actionables when supported
   - capture frame or region screenshots when manager-owned runtime methods can do so safely
3. Introduce a visual fallback policy:
   - use only when DOM/ref evidence is incomplete
   - keep bounded attempt budgets
   - translate proposed visual actions back into browser-scoped manager actions
4. Treat this as a second observation plane, not a replacement for refs.

### Files impacted
- `src/snapshot/ops-snapshot.ts`
- `src/challenges/evidence-bundle.ts`
- `src/challenges/action-loop.ts`
- `src/challenges/optional-computer-use-bridge.ts`
- `src/browser/browser-manager.ts`
- `src/browser/ops-browser-manager.ts`
- `tests/challenges-verification-gate.test.ts`
- `tests/provider-direct-runs.test.ts`
- focused frame-aware or screenshot-assisted challenge coverage under `tests/` (new file only if no current suite can absorb it)

### End goal
Iframe-bound or visually obvious browser challenges are no longer invisible to the challenge plane.

### Acceptance criteria
- [ ] Challenge evidence records skipped-frame pressure explicitly
- [ ] Frame-limited challenge pages can route into a bounded browser-safe recovery lane
- [ ] Visual recovery only activates when DOM grounding is incomplete
- [ ] The visual lane still obeys secret-entry boundaries

---

## Task 7 — Add Remaining Safe Runtime Actions Only After Existing Surface Is Fully Consumed

### Reasoning
The broader manager surface already supports more safe actions than the challenge plane uses today, but most competitive value will come from consuming the existing screenshot, pointer, continuity, and trace surface before expanding the contract further.

### What to do
Expose only the remaining safe actions that still matter after Tasks 1-6 land.

### How
1. Evaluate whether these actions are still needed after the earlier tasks:
   - `check`
   - `uncheck`
   - `scrollIntoView`
   - `waitForRef`
2. Add corresponding step kinds and execution support only for the actions that still close real browser-help gaps.
3. Add planner rules for checkboxes, delayed visibility, and scroll-into-view before click only where evidence shows they matter.
4. Do not widen the runtime contract just for parity optics.

### Files impacted
- `src/browser/manager-types.ts`
- `src/browser/browser-manager.ts`
- `src/browser/ops-browser-manager.ts`
- `src/challenges/types.ts`
- `src/challenges/action-loop.ts`
- `tests/browser-manager-challenge-runtime-handle.test.ts`
- `tests/ops-browser-manager-challenge-runtime-handle.test.ts`
- `tests/challenges-action-loop.test.ts`

### End goal
The challenge planner can use the remaining safe browser actions it truly needs without drifting into unnecessary surface growth.

### Acceptance criteria
- [ ] Added runtime actions are justified by real browser-help recovery cases, not just surface parity
- [ ] The action loop can execute the selected new step kinds
- [ ] At least one challenge/interstitial regression test proves each added action is necessary

---

## File-by-file implementation sequence

1. `src/providers/constraint.ts` and `src/providers/shopping/index.ts` — keep render-shell typing and `providerShell`/`constraint` emission honest before fallback-entry changes consume it
2. `src/providers/runtime-factory.ts` — add bounded pre-completion render-shell recovery while preserving the existing auth/challenge orchestration boundary
3. `src/challenges/types.ts` — extend step payloads, interstitial classes, evidence fields, and any future screenshot geometry contracts
4. `src/browser/manager-types.ts` — extend `ChallengeRuntimeHandle` only if the challenge plane truly needs new screenshot or capture methods
5. `src/browser/browser-manager.ts` and `src/browser/ops-browser-manager.ts` — implement any runtime-handle additions and keep manager parity
6. `src/challenges/evidence-bundle.ts` — record richer shell, interstitial, continuity, and screenshot metadata after the runtime surface exists
7. `src/challenges/interpreter.ts` — classify interstitials and tighten human-boundary decisions
8. `src/challenges/capability-matrix.ts` and `src/challenges/strategy-selector.ts` — refine helper eligibility and lane selection around the richer taxonomy
9. `src/challenges/optional-computer-use-bridge.ts` — replace click-only suggestions with mapped pointer plans once geometry exists
10. `src/challenges/action-loop.ts` — execute continuity, observation, mapped pointer, and only later any justified net-new step kinds
11. `src/challenges/verification-gate.ts` — strengthen progress detection against the newly recorded evidence
12. `src/challenges/orchestrator.ts` — preserve outcome metadata parity after the above seams settle
13. `src/snapshot/ops-snapshot.ts` — expose frame-pressure signals cleanly for later frame-aware recovery
14. `scripts/live-direct-utils.mjs` and `scripts/provider-direct-runs.mjs` — emit the richer audit taxonomy after evidence and outcome fields stabilize
15. Tests and doc touch-ups, preferring existing suites before adding focused new test files

---

## Dependencies to add

Current recommendation: no new external dependency is required for the first tranche.

| Package | Version | Purpose |
|---------|---------|---------|
| None | n/a | Prefer building on current manager, snapshot, and challenge infrastructure first |

---

## Version history

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-03-23 | Initial competitive capability plan based on repo evidence, March 23 live artifacts, and official vendor docs |
| 1.1 | 2026-03-23 | Revalidated after skill-pack validator/docs-drift updates; backlog unchanged, baseline scope clarified to treat validator and governance work as already closed |
| 1.2 | 2026-03-24 | Added clean-room `usecomputer` benchmark posture, reprioritized around screenshot geometry and mapped browser actuation, and narrowed later runtime-surface expansion to browser-scoped needs only |
