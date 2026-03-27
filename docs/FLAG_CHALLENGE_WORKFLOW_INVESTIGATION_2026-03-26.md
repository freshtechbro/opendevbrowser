# Investigation: Flag, Challenge, and Workflow Integration Seams

## Summary
OpenDevBrowser does have some weak or dormant flags, but the main problem is not dead configuration by itself. The current checkout shows five execution seams that make important behavior feel hidden or non-first-class: no `review` stage, stale popup target truth in extension ops sessions, iframe-blind extension snapshots, ref metadata that executors ignore, and a challenge executor whose runnable steps lag behind its own model.

The flag story is still real, but mostly as a drift amplifier. Important controls like `challengeAutomationMode`, workflow `browserMode`, fallback hints, cookie policy, and helper toggles are live, yet they are remapped across too many layers. That makes real runtime gaps look like mode or flag failures.

## Symptoms
- Popup and challenge flows in extension mode can stay attached to the wrong target.
- Snapshot to action breaks on iframe-heavy surfaces and stale DOM states.
- The public surface exposes `snapshot` plus direct actions, but no explicit `review` stage.
- The challenge plane can detect richer actions than the executor can actually perform.
- Browser-mode and fallback choices are carried through multiple hint layers, which makes behavior feel conditional even when enabled.

## Investigation Log

### Phase 1 - Workflow surface audit
**Hypothesis:** the missing `review` stage is only naming or documentation drift.

**Findings:** It is not drift. There is no first-class `review` tool or CLI command.

**Evidence:**
- `src/tools/index.ts:1-136` registers `opendevbrowser_snapshot` plus direct action/query tools, but no `review` tool.
- `src/cli/args.ts:1-23` exposes `snapshot` plus action commands, but no `review` command.

**Conclusion:** Confirmed root cause. The public workflow is effectively `snapshot -> direct action`, not `snapshot -> review -> action`.

### Phase 3 - Popup target ownership in extension mode
**Hypothesis:** popup/new-target adoption already exists and failures happen later in challenge orchestration.

**Findings:** The router layer has popup-target plumbing, but the ops runtime does not integrate it into session truth.

**Evidence:**
- `extension/src/services/CDPRouter.ts:646-689` configures flattened auto-attach with `Target.setAutoAttach`.
- `extension/src/services/CDPRouter.ts:898-900` emits `Target.targetCreated`.
- `extension/src/ops/ops-runtime.ts:226-302` handles only `Runtime.consoleAPICalled`, `Network.requestWillBeSent`, and `Network.responseReceived`.
- `extension/src/ops/ops-runtime.ts:620-729` updates `session.activeTargetId` only through explicit `targets.use`, `targets.new`, and canvas registration flows.
- `extension/src/services/ConnectionManager.ts:447-520` still tells users to focus a normal tab, not the popup.
- `git blame extension/src/ops/ops-runtime.ts:226-302` points to committed change `ebb109e` from 2026-02-02, so this gap predates the current dirty worktree.

**Conclusion:** Confirmed root cause. Popup/new targets do not become authoritative ops-session truth.

### Phase 3 - Snapshot capture and ref contract
**Hypothesis:** iframe capture is the only major reason snapshot-to-action feels broken.

**Findings:** Capture is incomplete, and the capture-to-action contract is also incomplete.

**Evidence:**
- `extension/src/ops/ops-runtime.ts:925-933` forces snapshot capture through `buildSnapshot(..., true, maxNodes)`.
- `src/snapshot/ops-snapshot.ts:139-187` skips nodes with `frameId` whenever `mainFrameOnly` is `true`, even though stored entries retain `frameId`.
- `src/snapshot/refs.ts:3-17` and `extension/src/ops/ops-session-store.ts:48-75` store both `frameId` and `snapshotId`.
- `extension/src/ops/ops-runtime.ts:964-1123` executes click, hover, press, type, select, and scroll through selector-only DOM operations.
- `extension/src/ops/ops-runtime.ts:2030-2048` resolves refs to `entry.selector` only and ignores `frameId` and `snapshotId`.
- `src/browser/browser-manager.ts:1248-1412` uses `page.locator(selector)` for `waitForRef`, `click`, `hover`, `type`, `select`, and related actions.
- `src/browser/browser-manager.ts:3215-3237` resolves refs to `{ selector, backendNodeId }` only and does not consume `frameId`.
- `src/browser/browser-manager.ts:3824-3836` clears refs on top-level navigation or close only.
- `extension/src/ops/ops-runtime.ts:851-857` clears refs on synthetic document replacement, not on generic snapshot freshness changes.
- Repo-wide search for `snapshotId` only found the ref stores plus snapshot responses. No action path compares snapshot ids before acting.

**Conclusion:** Confirmed root cause. Fixing iframe capture alone will not make framed or stale refs actionable. The action contract must consume `frameId` and enforce `snapshotId`.

### Phase 3 - Challenge planner and executor parity
**Hypothesis:** the challenge plane fails mainly because it cannot detect popup, hold, drag, or cookie/debug surfaces.

**Findings:** Detection is richer than execution.

**Evidence:**
- `src/challenges/evidence-bundle.ts:195-228` derives `holdRefs`, `dragRefs`, `clickRefs`, surface phrases, and `preferredAction`.
- `src/challenges/action-loop.ts:88-95` plans `click_and_hold` with a detected `ref` when available.
- `src/challenges/action-loop.ts:244-251` executes `click_and_hold` at fallback coordinates and ignores that `ref`.
- `src/challenges/types.ts:91-106` declares executable step kinds `cookie_list`, `cookie_import`, `snapshot`, and `debug_trace`.
- `src/challenges/action-loop.ts:236-293` contains no execution cases for those kinds.
- `src/challenges/orchestrator.ts:129-140` and `src/challenges/verification-gate.ts:34-47` do follow `status.activeTargetId`, so the downstream challenge plane is not ignoring target choice by itself.
- `git blame src/challenges/action-loop.ts:88-95` and `src/challenges/action-loop.ts:244-251` shows these lines are uncommitted on 2026-03-26. That makes this a current-checkout truth, but not necessarily already shipped release behavior.

**Conclusion:** Confirmed current-checkout gap. The challenge planner and type model advertise more capability than the executor actually runs.

### Phase 4 - Flag inventory and drift classification
**Hypothesis:** most breakage comes from dead or disabled flags.

**Findings:** Most important flags are live. The bigger issue is that they are remapped across too many layers.

**Evidence:**
- `src/config.ts:339-417` defines live provider-tier, adaptive-concurrency, anti-bot, challenge-orchestration, transcript, cookie-policy, and cookie-source config families.
- `src/providers/workflows.ts:474-518` re-maps workflow input into `useCookies`, `cookiePolicyOverride`, `challengeAutomationMode`, `preferredFallbackModes`, and `forceBrowserTransport`.
- `src/providers/index.ts:1176-1186` forwards those run options into provider context.
- `src/providers/shopping/index.ts:605-620` treats `forceBrowserTransport` as a real force-browser signal, not a dead field.
- `src/providers/types.ts:237-249` and `415-420` show those hint fields are part of the provider context and run-option contract.
- `src/config.ts:29-34` and `307-310` define `security.allowRawCDP`, but repo search found no runtime consumer.
- `git blame src/config.ts:307-309` shows `allowRawCDP` has existed since committed change `4d56321` on 2025-12-27.
- `src/tools/status.ts:76-101` is the only runtime consumer found for `checkForUpdates`, making it narrow status-only behavior rather than a core feature gate.

**Conclusion:** Confirmed classification:
- Live and first-class, but over-fanned-out: `challengeAutomationMode`, `providers.challengeOrchestration.*`, cookie policy/source, anti-bot policy, provider tiers, adaptive concurrency, transcript toggles.
- Live but weakly integrated or indirect: workflow `browserMode`, `preferredFallbackModes`, `forceBrowserTransport`, optional helper bridge.
- Narrow rather than dead: `checkForUpdates`.
- Effectively dormant/dead: `security.allowRawCDP`.

## Eliminated Hypotheses
- **"CDPRouter lacks popup-target support."** Eliminated. `extension/src/services/CDPRouter.ts:646-689` and `898-900` already support flattened target plumbing and emit `Target.targetCreated`.
- **"Challenge handling fails because the system cannot detect popup/interstitial/hold/drag surfaces."** Eliminated. `src/challenges/evidence-bundle.ts:195-228` already detects them.
- **"Orchestrator and verification ignore target changes."** Eliminated. `src/challenges/orchestrator.ts:129-140` and `src/challenges/verification-gate.ts:34-47` follow `status.activeTargetId`.
- **"Managed mode is fine; only extension mode has frame problems."** Eliminated. `src/browser/browser-manager.ts:1248-1412` and `3215-3237` show managed mode also ignores stored `frameId`.
- **"`snapshotId` already protects against stale refs."** Eliminated. The metadata is stored, but no action path enforces it.
- **"`forceBrowserTransport` is dead."** Eliminated. `src/providers/workflows.ts:513-518`, `src/providers/index.ts:1176-1186`, and `src/providers/shopping/index.ts:605-620` show a real downstream consumer.
- **"Dead config flags are the main reason popup/challenge handling is unreliable."** Eliminated. The main failures are runtime ownership and contract gaps. Dead flags exist, but they are secondary.

## Root Cause
The current repo evidence supports five primary seams plus one drift amplifier.

1. **Surface seam**
   - No first-class `review` surface exists between capture and action.
   - Result: users experience the product as `snapshot -> direct action`.

2. **Popup target-truth seam**
   - Extension CDP plumbing can observe popup/new-target creation, but ops session state does not adopt it.
   - Result: challenge logic follows `activeTargetId`, but `activeTargetId` can stay pinned to the wrong surface.

3. **Snapshot capture seam**
   - Extension actionables snapshots are main-frame-only by default.
   - Result: iframe-rendered challenge surfaces are omitted before the action system ever sees them.

4. **Frame/snapshot contract seam**
   - Ref storage carries `frameId` and `snapshotId`, but both managed and extension action paths ignore them.
   - Result: even widened snapshots cannot reliably drive framed actions, and stale refs are only caught indirectly.

5. **Executor parity seam**
   - The challenge planner and type model describe more actions than the executor actually runs.
   - Result: the system can explain richer challenge states than it can solve.

**Cross-cutting drift amplifier**
- `challengeAutomationMode`, workflow `browserMode`, fallback hints, cookie policy, and helper bridge choices are all translated through config, CLI, daemon, workflow, provider, and fallback layers.
- Result: real runtime gaps feel like flag or mode flakiness instead of ownership gaps.

## Flag Family Inventory

| Family | Status | Evidence | Recommendation |
|---|---|---|---|
| `providers.challengeOrchestration.*` and run/session `challengeAutomationMode` | First-class but over-fanned-out | `src/config.ts:363-384`, `src/providers/workflows.ts:485-490`, `src/providers/index.ts:1181-1186`, `src/challenges/orchestrator.ts:129-140` | Keep, but resolve once into a single runtime policy object |
| Cookie policy/source and `useCookies` | First-class | `src/config.ts:409-417`, `src/providers/workflows.ts:474-480`, `src/providers/index.ts:1181-1186` | Keep as first-class policy inputs |
| `antiBotPolicy`, provider tiers, adaptive concurrency, transcript toggles | First-class | `src/config.ts:339-408` | Keep; they are not the primary defect source |
| Workflow `browserMode` | Weakly integrated | `src/providers/workflows.ts:491-518` | Collapse into one resolved execution mode |
| `preferredFallbackModes` and `forceBrowserTransport` | Live but indirect | `src/providers/workflows.ts:513-518`, `src/providers/index.ts:1176-1186`, `src/providers/shopping/index.ts:605-620` | Replace with one authoritative resolved runtime policy where possible |
| Optional helper bridge | Weakly integrated | `src/config.ts:377-384` plus challenge-policy consumption in the selected challenge plane | Keep optional, but do not treat it as the primary browser lane |
| `checkForUpdates` | Narrow | `src/tools/status.ts:76-101` | Keep or rename to reflect status-only scope |
| `security.allowRawCDP` | Effectively dormant/dead | `src/config.ts:29-34`, `307-310`; no runtime consumer found by repo search | Remove or deprecate explicitly |

## Recommendations
1. **Fix popup target adoption first**
   - Primary files: `extension/src/ops/ops-runtime.ts`, `extension/src/services/ConnectionManager.ts`, `src/browser/ops-browser-manager.ts`
   - Integrate popup/new-target events into ops session state and stop assuming the operator must focus a normal tab.

2. **Fix the frame/snapshot contract next**
   - Primary files: `extension/src/ops/ops-runtime.ts`, `extension/src/ops/ops-session-store.ts`, `src/snapshot/ops-snapshot.ts`, `src/snapshot/refs.ts`, `src/browser/browser-manager.ts`
   - Stop forcing main-frame-only capture for actionables/challenge-sensitive snapshots.
   - Make ref resolution consume `frameId`.
   - Enforce `snapshotId` freshness before acting.

3. **Bring the challenge executor into parity with its own model**
   - Primary files: `src/challenges/action-loop.ts`, `src/challenges/types.ts`, `src/challenges/evidence-bundle.ts`
   - Make `click_and_hold` and `drag` use detected refs or resolved coordinates from refs.
   - Either implement `cookie_list`, `cookie_import`, `snapshot`, and `debug_trace` step execution or remove them from the executable step model until they are real.

4. **Collapse override plumbing into one resolved runtime policy object**
   - Primary files: `src/config.ts`, `src/cli/daemon-commands.ts`, `src/cli/commands/*.ts`, `src/providers/workflows.ts`, `src/providers/index.ts`, `src/providers/browser-fallback.ts`, `src/providers/runtime-factory.ts`
   - Resolve run > session > config once.
   - Pass a single policy object downward instead of translating `browserMode` into multiple fallback hints.

5. **Add a first-class `review` surface**
   - Primary files: `src/tools/index.ts`, `src/cli/args.ts`, likely a new tool/command implementation file
   - Make `snapshot -> review -> action` explicit and include target/snapshot freshness warnings before action.

## Preventive Measures
- Treat `frameId` and `snapshotId` as contract fields, not passive metadata. Add tests that fail if ref resolution ignores either field.
- Add parity tests that exercise popup target creation and iframe challenge surfaces in both extension and managed modes.
- Lock the public workflow shape in tests and docs so `review` cannot stay implicit again.
- Add a config-consumer audit test or script so dormant fields like `security.allowRawCDP` are detected automatically.
- Keep "live but indirect" flags to a minimum. Prefer one resolved runtime policy object over layered hint propagation.

