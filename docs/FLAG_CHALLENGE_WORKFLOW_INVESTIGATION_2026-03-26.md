# Investigation: Flag, Challenge, and Workflow Integration Seams

## Summary
The original report correctly identified that popup/challenge/workflow reliability felt non-first-class, but it is now stale against the current branch. The current checkout has already landed a first-class `review` surface, runtime-policy collapse, challenge executor parity, actionables snapshot widening, stale-ref rejection, and the missing `Target.setDiscoverTargets` forwarding path. This turn also repaired the last stale provider fallback assertions, and the repo gate set is now green again: `npm run lint`, `npm run typecheck`, `npm run build`, `npm run extension:build`, and `npm run test` all pass, with `208` test files passed, `2738` tests passed, and global branch coverage at `97.00%`.

The remaining unresolved closure is now concentrated in the extension ops ownership lane. Live popup proof still fails after a fresh daemon restart and extension reconnect, and a real `shopping run --browser-mode extension` now fails with `[not_owner] Client does not own session`. That keeps the live blocker narrower than the old report claimed: the source seams are mostly closed, but extension-mode ownership and popup adoption are still not proven end-to-end.

## Revalidation Matrix

| Seam | Prior claim | Current branch evidence | Live status | Final verdict |
|---|---|---|---|---|
| First-class `review` surface | Missing | `src/browser/review-surface.ts:1-31`, `src/tools/index.ts:15-17`, `src/cli/commands/nav/review.ts:1-83` | Managed and extension root review succeed live | Fixed |
| Popup target ownership in extension mode | Missing | `extension/src/ops/ops-runtime.ts:1270-1319`, `extension/src/ops/ops-runtime.ts:2470-2558`, `extension/src/services/CDPRouter.ts:80-98`, `extension/src/services/CDPRouter.ts:131-147`, `tests/extension-ops-runtime.test.ts:520-652`, `tests/extension-cdp-router.test.ts:1588-1658` | Child page opens live, but `targets-list` still reports only the root target after a fresh daemon restart and extension reconnect | Source-fixed, live FAILED pending extension reload or deeper ops ownership investigation |
| Actionables iframe capture | Missing | `src/snapshot/snapshotter.ts:19-47`, `extension/src/ops/ops-runtime.ts:2497-2514` request `mainFrameOnly=false` for actionables | Live extension still emits the old main-frame warning after the fresh daemon restart | Source-fixed, live FAILED pending extension reload or deeper ops ownership investigation |
| Stale snapshot rejection | Missing | `extension/src/ops/ops-runtime.ts:2470-2558`, `src/browser/browser-manager.ts:3366-3477`, `tests/browser-manager.test.ts:6160-6288` | Covered by source and tests; no conflicting live evidence | Fixed |
| Frame-aware ref execution | Ignored | Refs still store `frameId` in `src/snapshot/refs.ts:3-17`, but execution now resolves by `backendNodeId` in `src/browser/browser-manager.ts:3380-3477` and `extension/src/ops/ops-runtime.ts:2470-2617` | No framed live failure reproduced this turn | Not reproduced; keep as future targeted check, not an active defect |
| Challenge planner/executor parity | Missing | `src/challenges/action-loop.ts:257-346`, `tests/challenges-action-loop.test.ts:320-409`, `tests/challenges-action-loop.test.ts:947-979` | Unit-backed; no conflicting live challenge evidence this turn | Fixed |
| Runtime-policy collapse | Missing | `src/providers/runtime-policy.ts:1-113`, `tests/providers-runtime-policy.test.ts:1-42`, `tests/providers-runtime-factory.test.ts:1680-1899`, `tests/providers-workflows-branches.test.ts:3490-3669` | `auto` and a constrained `managed` shopping run honor requested mode live, but `extension` still degrades with ops ownership errors | Source-fixed; extension live blocker remains |
| `security.allowRawCDP` | Dormant | `src/config.ts:29-34`, `src/config.ts:307-310`; no runtime consumer found | Not exercised | Dormant, non-blocking |

## Symptoms
- Popup and challenge flows in extension mode can stay attached to the wrong target.
- Snapshot-to-action historically felt stale or mode-dependent.
- Workflow `browserMode` and challenge override behavior historically looked flag-driven rather than policy-driven.
- The original public workflow felt like `snapshot -> direct action` rather than `snapshot -> review -> action`.

## Investigation Log

### Phase 1 - Workflow surface re-audit
**Hypothesis:** the missing `review` stage is still an active branch defect.

**Findings:** It is no longer a defect in the current checkout. The branch now ships a shared review builder, a first-class CLI command, and a first-class tool surface.

**Evidence:**
- `src/browser/review-surface.ts:1-31` builds `status + snapshot(actionables)` into one `BrowserReviewResult`.
- `src/tools/index.ts:15-17` imports and wires `createReviewTool`.
- `src/cli/commands/nav/review.ts:1-83` exposes the dedicated CLI path and forwards `nav.review` to the daemon.
- Live managed and extension-root review calls returned valid `snapshotId`, `targetId`, content, and metadata.

**Conclusion:** Eliminated as an active seam. `review` is first-class in the current branch.

### Phase 2 - Popup target ownership in extension mode
**Hypothesis:** popup adoption was fully fixed already and only needed a daemon restart.

**Findings:** Partially false. The current branch already had popup lifecycle handling in `OpsRuntime`, but it still missed one real router seam: direct ops runtime bootstrap enabled discover-target mode through `setDiscoverTargetsEnabled(true)` without forwarding a real `Target.setDiscoverTargets` command to Chrome. That source bug is now fixed and covered by router tests. Live popup proof is still blocked even after a fresh daemon restart and extension reconnect, so the remaining issue is either a stale unpacked extension build in Chrome or a deeper extension ops ownership path that still prevents popup adoption.

**Evidence:**
- Source fix:
  - `extension/src/services/CDPRouter.ts:80-98` now applies `Target.setDiscoverTargets` to attached debugger sessions instead of only flipping router-local state.
  - `extension/src/services/CDPRouter.ts:131-147` now reapplies discover-target state when a new root tab attaches after discover mode is already enabled.
  - `tests/extension-cdp-router.test.ts:1588-1658` now asserts both the public `Target.setDiscoverTargets` command path and the direct helper path issue real CDP commands.
- Existing popup ownership source/tests:
  - `extension/src/ops/ops-runtime.ts:1270-1319` exposes `nav.review`.
  - `extension/src/ops/ops-runtime.ts:2470-2558` resolves refs against active target state and returns the popup attach-pending retry message.
  - `tests/extension-ops-runtime.test.ts:520-652` covers popup review payloads over the ops surface.
- Live repro after rebuild + fresh daemon restart:
  - Fresh daemon listener confirmed on `127.0.0.1:8787` and `127.0.0.1:8788`; extension reconnected with `extensionConnected=true` and `extensionHandshakeComplete=true`.
  - `npx opendevbrowser launch --extension-only --wait-for-extension --wait-timeout-ms 15000 --start-url http://127.0.0.1:8124/popup-root-anchor.html --output-format json` returned session `f83b9707-1491-4fb1-95f0-85102fcf1ec8` on target `tab-1245673252`.
  - `npx opendevbrowser review --session-id f83b9707-1491-4fb1-95f0-85102fcf1ec8 --max-chars 4000 --output-format json` returned root-only content `[r1] link "Open Popup Window"` with `warnings=["Skipped 1 iframe nodes; snapshot limited to main frame."]`.
  - `npx opendevbrowser click --session-id f83b9707-1491-4fb1-95f0-85102fcf1ec8 --ref r1 --output-format json` succeeded with `navigated=false`.
  - `npx opendevbrowser targets-list --session-id f83b9707-1491-4fb1-95f0-85102fcf1ec8 --include-urls --output-format json` still returned only root target `tab-1245673252`.
  - The popup fixture remained live at `http://127.0.0.1:8124/popup-child.html`, so the missing child target is not a fixture availability problem.
- Stale-extension proof:
  - Live extension `review` still returned `warnings=["Skipped 1 iframe nodes; snapshot limited to main frame."]`.
  - Current source at `extension/src/ops/ops-runtime.ts:1296-1319` and `extension/src/ops/ops-runtime.ts:2497-2514` requests actionables capture, and current source at `extension/src/ops/snapshot-builder.ts:5-16` would only emit that warning when `mainFrameOnly=true`.
  - That mismatch means Chrome is still running an older extension build even after the repo rebuild and daemon restart.

**Conclusion:** Source gap fixed and test-backed. Live popup adoption still fails after the fresh daemon restart, so closure now depends on reloading the unpacked extension in Chrome and, if that still fails, tracing extension ops ownership around popup-created targets.

### Phase 3 - Snapshot/ref contract re-audit
**Hypothesis:** the current branch still ignores stale snapshots and still needs the old report’s broad frame/snapshot rewrite.

**Findings:** The old conclusion is too broad now. Current source already rejects stale refs in both extension and managed lanes. Explicit `frameId`-driven execution is no longer clearly required for current paths because execution resolves live DOM context from `backendNodeId`, not a fresh selector-only lookup.

**Evidence:**
- `extension/src/ops/ops-runtime.ts:2470-2558` rejects missing or stale refs when `entry.snapshotId` no longer matches the target’s current snapshot.
- `src/browser/browser-manager.ts:3380-3477` resolves ref entries to `backendNodeId`, maps stale DOM/CDP errors back to `Take a new snapshot first.`, and executes through `DOM.resolveNode` + `Runtime.callFunctionOn`.
- `tests/browser-manager.test.ts:6160-6288` covers resolved-ref point lookup, fallback behavior, and stale snapshot error mapping.

**Conclusion:** The active defect is no longer “executors ignore snapshot freshness.” Treat framed-action behavior as a targeted future check only if a fresh live iframe repro fails after the extension reload.

### Phase 4 - Challenge planner/executor parity re-audit
**Hypothesis:** the challenge planner still advertises actions that the executor cannot run.

**Findings:** This is now stale for the current branch. The executor runs the richer step set that the old report flagged as missing.

**Evidence:**
- `src/challenges/action-loop.ts:257-346` executes `click_and_hold`, `drag`, `cookie_list`, `cookie_import`, `snapshot`, and `debug_trace`.
- `tests/challenges-action-loop.test.ts:320-409` covers hold and drag behavior.
- `tests/challenges-action-loop.test.ts:947-979` covers direct execution of cookie, snapshot, and debug-trace suggested steps.

**Conclusion:** Eliminated as an active branch seam.

### Phase 5 - Runtime policy and workflow matrix revalidation
**Hypothesis:** browser-mode and challenge override handling are still over-distributed enough to be an active runtime defect.

**Findings:** The current branch has one canonical resolver, and live workflow behavior mostly lines up with it, but the extension-only workflow lane still has an ownership blocker.

**Evidence:**
- `src/providers/runtime-policy.ts:1-113` resolves browser, cookies, and challenge policy once.
- Live shopping matrix after the fresh daemon restart:
  - `extension` (all default providers): failed with `requested_browser_mode="extension"` and `browserFallbackModesObserved=["extension"]`, but multiple providers returned `[not_owner] Client does not own session`.
  - `auto` (all default providers): succeeded with `requested_browser_mode="auto"` and returned real offers from `shopping/ebay` and `shopping/bestbuy`.
  - `managed` (all default providers): timed out at `50000ms` on the full four-provider query.
  - `managed` (constrained `--providers shopping/ebay`): succeeded and returned `browser_fallback_mode="managed_headed"` offers.
- Challenge override precedence was not exercised live because no run preserved a challenge; keep that verdict test-backed via `tests/providers-runtime-factory.test.ts:1680-1899`.

**Conclusion:** Runtime-policy collapse is fixed in source and test-backed. Live `auto` and constrained `managed` runs behave consistently with requested mode, but the extension-only workflow lane still has an ops ownership blocker that is separate from policy resolution.

## Eliminated Hypotheses
- **“The current branch still lacks a first-class `review` surface.”** Eliminated by `src/browser/review-surface.ts:1-31`, `src/tools/index.ts:15-17`, and `src/cli/commands/nav/review.ts:1-83`.
- **“Challenge executor parity is still missing.”** Eliminated by `src/challenges/action-loop.ts:257-346` and the matching challenge tests.
- **“Runtime-policy collapse is still an open implementation task.”** Eliminated by `src/providers/runtime-policy.ts:1-113`, the updated provider fallback tests, and the full green repo gate set.
- **“Auto and managed workflow modes are broadly unusable in the current branch.”** Eliminated by the successful live `auto` run and the successful constrained `managed` `shopping/ebay` run.

## Root Cause
The branch is no longer suffering from five equally active seams. Current repo-backed evidence supports a narrower closure picture:

1. **Historical seams already closed in source**
   - First-class `review` surface
   - Runtime-policy collapse
   - Challenge executor parity
   - Actionables snapshot widening
   - Stale-ref rejection

2. **Remaining live closure blockers in the extension ops lane**
   - Popup target ownership in extension mode still lacks final live proof.
   - Extension-only workflow runs can still fail with ops ownership errors (`[not_owner] Client does not own session`).
   - This turn fixed one real router bug in that lane by forwarding `Target.setDiscoverTargets` to Chrome, but the live rerun still behaved like a stale extension build or a deeper ownership issue.

3. **Non-blocking residuals**
   - `security.allowRawCDP` still appears dormant.
   - Explicit `frameId`-specific execution is not proven necessary or broken in the current branch; it should only be reopened with a framed live repro.

## Recommendations
1. **Reload the unpacked extension in Chrome, then rerun the popup and extension-workflow runbooks**
   - This is the immediate blocker.
   - The continued main-frame warning on `review` after a fresh daemon restart proves the live browser is not yet behaving like the current extension snapshot.
   - Repeat both:
     - popup runbook: `launch -> review -> click -> targets-list -> review`
     - extension workflow runbook: `shopping run --browser-mode extension`

2. **Keep the new router discover-target patch**
   - Primary files:
     - `extension/src/services/CDPRouter.ts`
     - `extension/src/services/cdp-router-commands.ts`
     - `tests/extension-cdp-router.test.ts`
   - This closes a real source hole whether or not the loaded extension had picked it up during this turn.

3. **Investigate extension ops ownership only if the extension reload does not clear the live failures**
   - Primary files:
     - `extension/src/ops/ops-runtime.ts`
     - `src/browser/ops-browser-manager.ts`
     - `src/providers/runtime-factory.ts`
   - Focus on lease/client ownership churn rather than reopening policy or provider parsing.

4. **Do not reopen broad frame/snapshot or challenge rewrites**
   - Those seams are now source-fixed or not reproduced.
   - If a framed live repro appears later, patch it seam-locally at the ref-execution layer.

5. **Deprecate or remove `security.allowRawCDP` separately**
   - It remains dormant, but it is not blocking popup/challenge/workflow closure.

## Preventive Measures
- Add one live-smoke runbook requirement that explicitly distinguishes `repo rebuilt` from `unpacked extension reloaded`.
- Add one live-smoke runbook requirement that explicitly checks extension session ownership after daemon restart before claiming extension-mode workflow health.
- Keep popup target proof fixture-based so target adoption failures are separable from challenge-site noise.
- Keep `review` and runtime-policy behavior locked in tests so the report cannot drift backward again.
- Add a lightweight config-consumer audit for dormant fields like `security.allowRawCDP`.
