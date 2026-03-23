# Challenge Automation Override and Desktop-Agent Boundary Plan

Implementation-ready plan for a first-class run-scoped challenge automation override, an optional session-scoped override, shared precedence resolution, cross-surface wiring, and a roadmap-only desktop-agent boundary extension.

---

## Overview

### Scope
- Keep `src/challenges/*` as the shared challenge intelligence plane.
- Keep `BrowserManager` and `OpsBrowserManager` as the only surfaced blocker and challenge metadata writers.
- Preserve `ChallengeRuntimeHandle` as a browser-scoped action adapter only.
- Reuse the existing request-scoped precedence pattern already used for cookie overrides in `src/providers/runtime-factory.ts` and `src/providers/workflows.ts`.
- Keep governed advanced lanes separately entitlement-gated and outside the new public override switch.

### Phase 1: immediate implementation scope
- Introduce one shared public override field: `challengeAutomationMode`.
- Support a first-class run-scoped override on workflow requests and tool/CLI workflow surfaces.
- Support an optional session-scoped override stored on manager session state.
- Resolve effective mode once, then thread it through policy gate, capability matrix, strategy selection, action loop, orchestrator, manager writers, and response metadata.
- Update tests and docs so the shipped contract is source-backed.

### Phase 2: roadmap-only scope
- Document the future desktop-agent path as a separate capability family.
- Do not change current runtime claims, current helper-lane naming, or current authority boundaries.
- Define the minimum capability bar that must exist before any desktop-agent wording, enum value, or public contract is allowed.

### Authority boundaries
- `ChallengeRuntimeHandle` stays browser-scoped and must not acquire OS or desktop control semantics.
- The current `optional-computer-use-bridge` remains a browser-scoped helper lane, not a desktop agent.
- Governed advanced lanes remain controlled by `governed-adapter-gateway.ts` and separate entitlement logic.
- Global config remains the baseline default and hard-gate source, but public overrides may narrow behavior and may only request behavior already permitted by hard gates.

### Precedence model

| Rank | Source | Carrier | Scope |
|---|---|---|---|
| 1 | Run | `challengeAutomationMode` on workflow request, daemon payload, or tool input | One request or workflow run |
| 2 | Session | Optional session metadata on BrowserManager or OpsBrowserManager session state | One browser session lifetime |
| 3 | Config | `providers.challengeOrchestration.mode` in `src/config.ts` | Global default |

After precedence resolves, hard gates still apply:
- no challenge metadata means no orchestration
- manager suppression guard still wins
- helper bridge still requires `optionalComputerUseBridge`
- helper bridge still fails closed on human-boundary cases
- governed lanes still require separate entitlement and are never granted by the override

### Stand-down matrix

| Effective mode | Browser autonomy lanes | Helper bridge lane | Governed advanced lanes | Required surfaced outcome |
|---|---|---|---|---|
| `off` | Stand down | Stand down | Stand down | Detect and report only, with explicit stand-down reason |
| `browser` | Eligible if existing browser checks pass | Forced to stand down | Not granted by this mode | Report helper stand-down when relevant |
| `browser_with_helper` | Eligible if existing browser checks pass | Eligible only if existing helper hard gates pass | Not granted by this mode | Preserve browser-first lane ordering, helper second |

---

## Key decisions
- Use `challengeAutomationMode` as the shared public field name across config defaults, run-scoped workflow inputs, and optional session state.
- Use `off`, `browser`, and `browser_with_helper` as the only immediate mode values.
- Resolve effective mode once with `run > session > config`.
- Keep `optionalComputerUseBridge` as a hard gate separate from the mode switch.
- Do not let the new mode switch grant governed advanced lanes.
- Record resolved mode, source, and stand-down reason in additive challenge orchestration metadata.
- Keep `ChallengeRuntimeHandle` unchanged as a browser-only contract.
- Forbid `desktop`, `computer_use_agent`, `desktop_agent`, or equivalent current-capability naming in public surfaces until a future desktop runtime exists.
- Treat future desktop-agent work as a separate roadmap spec, not part of the immediate coding scope.

---

## Task 1 - Define the shared override contract and precedence model

### Reasoning
The current challenge-orchestration control is anchored to global config gates. A true on-demand override needs one shared type system and one resolver so every surface uses the same precedence and naming rules.

### What to do
Add the shared mode types, config default semantics, and one canonical precedence resolver for challenge automation.

### How
1. In `src/challenges/types.ts`, add the shared public mode enum and supporting internal types:
   - `ChallengeAutomationMode = "off" | "browser" | "browser_with_helper"`
   - `ChallengeAutomationModeSource = "run" | "session" | "config"`
   - a resolved policy shape that carries `mode`, `source`, and `standDownReason`
2. In `src/config.ts`, change challenge orchestration config from an implicit global gate to an explicit default-mode baseline under `providers.challengeOrchestration`, while keeping `optionalComputerUseBridge` and governed-lane policy inputs as separate hard gates.
3. In `src/providers/runtime-factory.ts`, add one small shared resolver or import path for resolving `run > session > config` so the precedence logic is not duplicated across workflow surfaces and manager fallback paths.
4. Add code comments and type docs that explicitly state:
   - the mode switch does not grant governed-lane access
   - the helper bridge is not a desktop agent
   - hard gates still apply after precedence resolution

### Files impacted
- `src/challenges/types.ts`
- `src/config.ts`
- `src/providers/runtime-factory.ts`

### End goal
The repo has one shared challenge automation mode contract and one source of truth for precedence resolution.

### Acceptance criteria
- [ ] A shared `ChallengeAutomationMode` contract exists and is referenced by config and runtime resolution.
- [ ] Precedence is explicitly defined as `run > session > config`.
- [ ] Public names avoid `desktop`, `computer_use_agent`, and similar over-claiming terms.
- [ ] The shared contract does not grant governed-lane entitlement.

---

## Task 2 - Persist the optional session-scoped override on manager session state

### Reasoning
The optional session override must live on browser-session state so it can apply across multiple manager-triggered challenge checks without widening the browser action handle.

### What to do
Store the optional session-scoped challenge automation mode on BrowserManager and OpsBrowserManager session state and keep it outside `ChallengeRuntimeHandle`.

### How
1. In `src/browser/manager-types.ts`, add optional session metadata for challenge automation mode and resolved-source bookkeeping on the browser session shape.
2. In `src/browser/browser-manager.ts`, thread the optional session mode into session creation and lookup so later challenge checks can read it without passing ad hoc values through unrelated APIs.
3. In `src/browser/ops-browser-manager.ts`, mirror the same session-state storage so `/ops` mode and managed mode stay aligned.
4. In `src/core/bootstrap.ts`, wire the shared resolver or accessors into the managers without adding any session or desktop semantics to `ChallengeRuntimeHandle`.

### Files impacted
- `src/browser/manager-types.ts`
- `src/browser/browser-manager.ts`
- `src/browser/ops-browser-manager.ts`
- `src/core/bootstrap.ts`

### End goal
Managers can carry an optional session-scoped challenge automation override for the life of a browser session, while `ChallengeRuntimeHandle` remains browser-scoped and action-only.

### Acceptance criteria
- [ ] BrowserManager and OpsBrowserManager session state can store an optional challenge automation mode.
- [ ] Existing sessions remain valid when the new field is absent.
- [ ] `ChallengeRuntimeHandle` does not gain session-policy or desktop-control fields.
- [ ] Bootstrap wiring reuses the shared resolver instead of introducing parallel session-policy logic.

---

## Task 3 - Thread the run-scoped override through provider workflow contracts and runtime resolution

### Reasoning
Workflow wrappers already carry request-scoped cookie overrides through a proven precedence model. Challenge automation should use the same shape so per-run control is consistent and predictable.

### What to do
Add the run-scoped override to provider request and workflow contracts, then resolve it in the runtime factory and fallback orchestration seam.

### How
1. In `src/providers/types.ts`, add optional request-scoped `challengeAutomationMode` input fields and additive resolved metadata fields on the challenge orchestration envelope used across surfaces.
2. In `src/providers/workflows.ts`, add a helper parallel to the cookie-override helper so research, shopping, and product-video workflows merge run-scoped challenge automation inputs in one place.
3. In `src/providers/runtime-factory.ts`, resolve effective mode with `run > session > config`, then pass the resolved policy into fallback orchestration and any request-local challenge context.
4. Ensure workflow and fallback metadata echo the resolved mode, source, and any stand-down reason so downstream CLI and tool surfaces can expose truthful results.

### Files impacted
- `src/providers/types.ts`
- `src/providers/workflows.ts`
- `src/providers/runtime-factory.ts`

### End goal
Workflow requests can set a run-scoped challenge automation mode and the runtime resolves it consistently before challenge orchestration runs.

### Acceptance criteria
- [ ] Workflow request types accept an optional run-scoped `challengeAutomationMode`.
- [ ] Runtime resolution uses the shared precedence helper instead of duplicating precedence logic.
- [ ] Fallback orchestration receives resolved mode and source metadata.
- [ ] Provider output metadata can surface stand-down reasons without inventing a second contract.

---

## Task 4 - Wire CLI, daemon, and tool workflow surfaces to the new run-scoped override

### Reasoning
The override is only first-class if existing workflow entrypoints can set it directly and consistently across CLI, daemon, and tool surfaces.

### What to do
Expose one consistent workflow-level flag and input field for research, shopping, and product-video runs, and route it unchanged through CLI parsing, daemon payloads, and tool schemas.

### How
1. In `src/cli/args.ts`, add `--challenge-automation-mode` to the valid flag lists and accepted equals-flag lists, and validate it against the shared enum.
2. In `src/cli/daemon-commands.ts`, add forwarding and validation support so daemon-executed workflow commands preserve the same field name and enum values.
3. In `src/cli/commands/research.ts`, `src/cli/commands/shopping.ts`, and `src/cli/commands/product-video.ts`, parse the new flag and forward it into the existing workflow request payloads.
4. In `src/tools/research_run.ts`, `src/tools/shopping_run.ts`, and `src/tools/product_video_run.ts`, add the same optional field to each tool schema and pass it through unchanged.
5. In `src/tools/index.ts`, keep the workflow tool registry unchanged in shape, but ensure the newly extended tool schemas remain the single source of truth for tool-level exposure.

### Files impacted
- `src/cli/args.ts`
- `src/cli/daemon-commands.ts`
- `src/cli/commands/research.ts`
- `src/cli/commands/shopping.ts`
- `src/cli/commands/product-video.ts`
- `src/tools/research_run.ts`
- `src/tools/shopping_run.ts`
- `src/tools/product_video_run.ts`
- `src/tools/index.ts`

### End goal
Workflow callers can set `challengeAutomationMode` once and get the same behavior across CLI, daemon, and tool surfaces.

### Acceptance criteria
- [ ] CLI workflow surfaces accept `--challenge-automation-mode`.
- [ ] Daemon workflow payloads preserve the same field name and enum values.
- [ ] Tool schemas expose the same optional field name without aliases.
- [ ] No workflow surface invents a second challenge-override field or enum.

---

## Task 5 - Apply resolved mode to policy gate, capability matrix, strategy selection, and action loop

### Reasoning
The override has no value unless the challenge plane changes behavior consistently at each decision step from gating to final lane execution.

### What to do
Thread the resolved mode through the full challenge orchestration pipeline and implement explicit stand-down behavior for `off`, `browser`, and `browser_with_helper`.

### How
1. In `src/challenges/policy-gate.ts`, accept the resolved mode and emit a policy result that includes effective mode, source, and whether helper-lane evaluation is even allowed.
2. In `src/challenges/capability-matrix.ts`, require all of the following before helper-bridge eligibility is true:
   - effective mode is `browser_with_helper`
   - `optionalComputerUseBridge` is enabled
   - no human-boundary condition blocks it
   - existing helper prerequisites still pass
3. In `src/challenges/strategy-selector.ts`, preserve current browser-first ordering, but add explicit behavior:
   - `off`: no action lane is selected
   - `browser`: browser lanes can be selected, helper lane is forced to stand down
   - `browser_with_helper`: browser lanes remain first, helper lane stays second and only if capability matrix says eligible
4. In `src/challenges/action-loop.ts` and `src/challenges/optional-computer-use-bridge.ts`, record stand-down reasons clearly and keep helper behavior described as browser-scoped assistance, not desktop control.
5. In `src/challenges/orchestrator.ts` and `src/challenges/governed-adapter-gateway.ts`, keep governed-lane entitlement separate from the new mode switch and ensure the new mode never grants governed access.

### Files impacted
- `src/challenges/policy-gate.ts`
- `src/challenges/capability-matrix.ts`
- `src/challenges/strategy-selector.ts`
- `src/challenges/action-loop.ts`
- `src/challenges/optional-computer-use-bridge.ts`
- `src/challenges/orchestrator.ts`
- `src/challenges/governed-adapter-gateway.ts`

### End goal
The challenge plane can honor the resolved mode consistently and explain why a helper or action lane ran or stood down.

### Acceptance criteria
- [ ] `off` disables challenge actions while preserving challenge detection and reporting.
- [ ] `browser` forces the helper bridge to stand down.
- [ ] `browser_with_helper` allows helper evaluation only when existing hard gates pass.
- [ ] Governed advanced lanes remain separately entitlement-gated and are never granted by the mode switch.

---

## Task 6 - Keep manager metadata writers authoritative and surface resolved override truth

### Reasoning
Only BrowserManager and OpsBrowserManager should write surfaced challenge metadata. The new override must not create a second metadata-writing path.

### What to do
Update manager orchestration call sites and response shaping so surfaced challenge metadata includes resolved mode and stand-down truth while preserving the current writer boundary.

### How
1. In `src/browser/browser-manager.ts`, pass the resolved run or session policy into `maybeOrchestrateChallenge` whenever challenge metadata exists and suppression is not active.
2. In `src/browser/ops-browser-manager.ts`, mirror the same orchestration call-site behavior so `/ops` mode exposes the same metadata shape and stand-down reasons.
3. Extend the additive manager-shaped response metadata in `src/providers/types.ts` so `meta.challengeOrchestration` and fallback `details.challengeOrchestration` can include `mode`, `source`, `standDownReason`, and helper eligibility outcome.
4. When challenge metadata exists but execution is suppressed by mode or guard, emit metadata that makes the stand-down explicit instead of silently omitting the orchestration result.

### Files impacted
- `src/browser/browser-manager.ts`
- `src/browser/ops-browser-manager.ts`
- `src/providers/types.ts`

### End goal
Managed mode, `/ops` mode, and provider fallback all surface the same resolved challenge automation truth without changing metadata writer ownership.

### Acceptance criteria
- [ ] BrowserManager and OpsBrowserManager remain the only surfaced challenge metadata writers.
- [ ] `meta.challengeOrchestration` can expose resolved mode, source, and stand-down reason.
- [ ] Provider fallback detail envelopes can expose the same resolved override truth.
- [ ] Manager suppression guard behavior remains intact and explicit.

---

## Task 7 - Add regression coverage for precedence, stand-down logic, scope guardrails, and surface propagation

### Reasoning
This change crosses config, managers, workflows, challenge strategy, and docs. Tests need to lock precedence and keep the helper-lane boundary honest.

### What to do
Add or update tests that prove precedence, public-surface propagation, helper-lane stand-down logic, and `ChallengeRuntimeHandle` scope preservation.

### How
1. In `tests/providers-runtime-factory.test.ts`, add cases for `run > session > config` precedence and verify fallback orchestration metadata echoes the resolved source.
2. In `tests/cli-workflows.test.ts`, add workflow flag-propagation cases proving `--challenge-automation-mode` reaches research, shopping, and product-video request payloads.
3. In `tests/challenges-strategy-selector.test.ts`, add a mode matrix for `off`, `browser`, and `browser_with_helper`, including helper stand-down reasons.
4. In `tests/challenges-optional-computer-use-bridge.test.ts`, add eligibility and non-eligibility cases that prove the helper bridge only runs when the mode and hard gates both permit it.
5. In `tests/browser-manager-challenge-runtime-handle.test.ts` and `tests/ops-browser-manager-challenge-runtime-handle.test.ts`, assert that session override state stays outside `ChallengeRuntimeHandle`.
6. In `scripts/docs-drift-check.mjs` and `tests/docs-drift-check.test.ts`, add marker checks for the new flag and wording boundary so docs drift is caught automatically.

### Files impacted
- `tests/providers-runtime-factory.test.ts`
- `tests/cli-workflows.test.ts`
- `tests/challenges-strategy-selector.test.ts`
- `tests/challenges-optional-computer-use-bridge.test.ts`
- `tests/browser-manager-challenge-runtime-handle.test.ts`
- `tests/ops-browser-manager-challenge-runtime-handle.test.ts`
- `scripts/docs-drift-check.mjs`
- `tests/docs-drift-check.test.ts`

### End goal
The repo has regression coverage that protects precedence, helper-lane gating, public-surface propagation, and browser-scope boundaries.

### Acceptance criteria
- [ ] Runtime-factory tests prove `run > session > config`.
- [ ] Workflow tests prove flag and input propagation across CLI and tool workflow surfaces.
- [ ] Strategy and helper-bridge tests prove stand-down behavior for each mode.
- [ ] Runtime-handle tests fail if session-policy or desktop-like fields leak into `ChallengeRuntimeHandle`.

---

## Task 8 - Synchronize docs and public contract wording for the immediate override feature

### Reasoning
The shipped behavior is only claimable if docs, architecture language, CLI docs, and surface reference all describe the same field names, precedence rules, and helper-lane boundary.

### What to do
Update public and internal docs to describe the immediate override contract, the precedence rules, and the helper-lane boundary without over-claiming desktop capability.

### How
1. Update `README.md`, `docs/ARCHITECTURE.md`, `docs/CLI.md`, and `docs/SURFACE_REFERENCE.md` to document:
   - `challengeAutomationMode`
   - the accepted enum values
   - the precedence order
   - the stand-down matrix
   - the fact that the current helper bridge is browser-scoped
2. Update this plan, `docs/ARCHITECTURE.md`, `docs/CLI.md`, and `docs/SURFACE_REFERENCE.md` so immediate override work is described as bounded browser challenge automation control, not desktop-agent capability.
3. Extend `scripts/docs-drift-check.mjs` marker checks so the new flag name and helper-boundary wording become part of the docs sync gate.
4. Keep `docs/SURFACE_REFERENCE.md` aligned with any new workflow flag or metadata fields added to the CLI and tool surfaces.

### Files impacted
- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/CLI.md`
- `docs/SURFACE_REFERENCE.md`
- `docs/CHALLENGE_AUTOMATION_OVERRIDE_PLAN.md`
- `scripts/docs-drift-check.mjs`
- `tests/docs-drift-check.test.ts`

### End goal
All claimable surfaces document the same immediate override contract and the same bounded helper-lane language.

### Acceptance criteria
- [ ] README, architecture, CLI, and surface reference docs use the same field name and enum values.
- [ ] Docs explicitly describe `run > session > config`.
- [ ] Docs explicitly describe the current helper bridge as browser-scoped and non-desktop.
- [ ] Docs drift checks fail if the new override surface or wording drifts.

---

## Task 9 - Define the future desktop-agent roadmap boundary and minimum capability bar

### Reasoning
The repo needs a forward path for real desktop challenge automation, but the current bridge cannot truthfully carry that label. The roadmap must be explicit and separate so immediate work does not over-claim capability.

### What to do
Add a roadmap-only spec section that defines the minimum capability bar and architectural split required before any desktop-agent naming or surface can ship.

### How
1. In this plan and `docs/ARCHITECTURE.md`, add a clearly labeled roadmap-only section for a future desktop challenge agent.
2. Define the minimum capability bar as all of the following:
   - OS-level input actuation outside the browser
   - cross-window and cross-app focus management
   - desktop capture or accessibility-tree observation beyond browser DOM
   - explicit permission and consent gating
   - bounded workspace and abort controls
   - audit artifacts and replay-safe execution logs
   - a typed failure taxonomy separate from the current helper bridge
3. State that any future desktop capability must use a new runtime contract, separate from `ChallengeRuntimeHandle`, and must not reuse the current helper bridge name as if it were already a desktop runtime.
4. Add wording rules that forbid current public surfaces from using `desktop`, `computer_use_agent`, `desktop_agent`, or equivalent terms until the new runtime, policy surface, tests, and docs all exist.

### Files impacted
- `docs/CHALLENGE_AUTOMATION_OVERRIDE_PLAN.md`
- `docs/ARCHITECTURE.md`
- `README.md`

### End goal
The repo documents a credible future desktop-agent path while keeping the immediate shipped scope limited to browser-scoped challenge automation control.

### Acceptance criteria
- [ ] The desktop-agent section is explicitly labeled roadmap-only and non-shipping.
- [ ] The minimum capability bar is enumerated in one source-backed place.
- [ ] The roadmap requires a new runtime contract separate from `ChallengeRuntimeHandle`.
- [ ] No current public surface is documented as a desktop-agent capability.

---

## File-by-file implementation sequence

1. `src/challenges/types.ts` - define `ChallengeAutomationMode`, source, and resolved-policy types.
2. `src/config.ts` - move challenge automation to an explicit default-mode baseline while keeping hard gates separate.
3. `src/browser/manager-types.ts` - add optional session-scoped override storage and keep `ChallengeRuntimeHandle` unchanged.
4. `src/core/bootstrap.ts` - wire shared resolution helpers and manager accessors.
5. `src/providers/types.ts` - add run-scoped request fields and surfaced metadata fields.
6. `src/providers/workflows.ts` - add workflow helper for merging run-scoped challenge automation overrides.
7. `src/providers/runtime-factory.ts` - resolve `run > session > config` and pass resolved policy into fallback orchestration.
8. `src/cli/args.ts` - add CLI flag parsing and validation.
9. `src/cli/daemon-commands.ts` - forward workflow payloads with the new field.
10. `src/cli/commands/research.ts` - parse and pass workflow override.
11. `src/cli/commands/shopping.ts` - parse and pass workflow override.
12. `src/cli/commands/product-video.ts` - parse and pass workflow override.
13. `src/tools/research_run.ts` - add tool schema field and forwarding.
14. `src/tools/shopping_run.ts` - add tool schema field and forwarding.
15. `src/tools/product_video_run.ts` - add tool schema field and forwarding.
16. `src/tools/index.ts` - keep tool registry aligned with the updated workflow tool schemas.
17. `src/challenges/policy-gate.ts` - apply resolved mode to policy output.
18. `src/challenges/capability-matrix.ts` - gate helper-lane eligibility by mode plus hard gates.
19. `src/challenges/strategy-selector.ts` - enforce the mode matrix and browser-first ordering.
20. `src/challenges/action-loop.ts` - record stand-down reasons and suppress helper execution when required.
21. `src/challenges/optional-computer-use-bridge.ts` - keep helper wording and gating browser-scoped.
22. `src/challenges/orchestrator.ts` - surface resolved mode and stand-down metadata.
23. `src/challenges/governed-adapter-gateway.ts` - preserve separate governed entitlement behavior.
24. `src/browser/browser-manager.ts` - read resolved policy and remain a sole surfaced metadata writer.
25. `src/browser/ops-browser-manager.ts` - mirror the same writer behavior for `/ops`.
26. `tests/providers-runtime-factory.test.ts` - add precedence coverage.
27. `tests/cli-workflows.test.ts` - add workflow propagation coverage.
28. `tests/challenges-strategy-selector.test.ts` - add mode matrix coverage.
29. `tests/challenges-optional-computer-use-bridge.test.ts` - add helper eligibility coverage.
30. `tests/browser-manager-challenge-runtime-handle.test.ts` - protect browser-only handle scope.
31. `tests/ops-browser-manager-challenge-runtime-handle.test.ts` - protect `/ops` browser-only handle scope.
32. `scripts/docs-drift-check.mjs` - add docs sync markers for the new feature.
33. `tests/docs-drift-check.test.ts` - keep docs drift gate green.
34. `README.md` - public contract wording sync.
35. `docs/ARCHITECTURE.md` - architecture and roadmap boundary sync.
36. `docs/CLI.md` - CLI flag and precedence sync.
37. `docs/SURFACE_REFERENCE.md` - surfaced metadata and flag sync.
38. `docs/CHALLENGE_AUTOMATION_OVERRIDE_PLAN.md` - immediate feature wording, precedence contract, and roadmap-only desktop section.

---

## Dependencies to add

### Tasks and subtask dependencies

| Task | Depends on | Unlocks | Notes |
|---|---|---|---|
| Task 1 | None | Tasks 2, 3, 4, 5, 8 | Shared contract and precedence source of truth |
| Task 2 | Task 1 | Tasks 3, 6, 7 | Session-scoped storage must exist before manager integration tests |
| Task 3 | Tasks 1, 2 | Tasks 4, 5, 6, 7 | Runtime resolution must exist before surface and orchestrator wiring |
| Task 4 | Tasks 1, 3 | Tasks 7, 8 | Public workflow surfaces depend on stable run-scoped contract |
| Task 5 | Tasks 1, 3 | Tasks 6, 7, 8 | Challenge plane behavior depends on resolved policy shape |
| Task 6 | Tasks 2, 3, 5 | Tasks 7, 8 | Metadata writers need both session state and challenge-plane resolution |
| Task 7 | Tasks 1 through 6 | Task 8 | Tests should land after core wiring stabilizes |
| Task 8 | Tasks 4, 5, 6, 7 | Task 9 | Docs should reflect final immediate behavior and proof |
| Task 9 | Task 8 | Future implementation planning | Roadmap-only spec must follow final immediate terminology |

### Package dependencies

| Package | Version | Purpose |
|---|---|---|
| None | N/A | Reuse existing config, workflow, manager, docs, and test infrastructure |

---

## Version history

| Version | Date | Changes |
|---|---|---|
| 1.0 | 2026-03-22 | Initial implementation-ready plan for run-scoped and optional session-scoped challenge automation overrides plus roadmap-only desktop-agent boundary |
