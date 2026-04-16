# Investigation: First-Class Desktop Observation And Browser-Scoped Computer Use

Status: active research
Date: 2026-04-15
Scope: investigation only, no source-code changes

## Summary

OpenDevBrowser already ships desktop observation as a first-class public CLI and tool family, but it does not yet ship browser-scoped computer use or desktop-assisted browser review as first-class operator surfaces. The main upgrade path is not to collapse everything into a single desktop agent, but to keep the existing safety split and publish the missing public surfaces around composed review, policy inspection, and correlated audit output.

## Symptoms

- Generated help and public docs intentionally separate three discovery lanes: browser replay, desktop observation, and browser-scoped computer use.
- Desktop observation is public and observe-only.
- Browser-scoped computer use is public only as workflow flags on provider commands, not as its own first-class CLI or tool family.
- A higher-capability composed seam already exists internally, but it is not publicly exposed.
- Architecture docs explicitly say the desktop-agent boundary is roadmap-only and that the optional helper is not a desktop agent.

## Investigation Log

### Phase 1 - Public surface inventory

Hypothesis: desktop observation and computer use are both still non-first-class.

Findings:

- Desktop observation is already first-class on both CLI and tool surfaces.
- Browser-scoped computer use is not first-class; it is exposed through `--challenge-automation-mode` on workflow commands.
- Public discovery copy is deliberately explicit about the split.

Evidence:

- `src/public-surface/source.ts:535-567` defines a dedicated `desktop_observation` CLI group with six commands.
- `src/public-surface/source.ts:670-675` defines six matching `opendevbrowser_desktop_*` tools.
- `src/cli/help.ts:225-249` defines the three `Find It Fast` lookup entries and labels computer use as `browser-scoped`.
- `docs/CLI.md:9` maps `desktop observation` to `desktop-*` and maps `computer use / browser-scoped computer use` to workflow flags.
- `docs/SURFACE_REFERENCE.md:100-106` lists the six desktop observation CLI commands.
- `docs/SURFACE_REFERENCE.md:184-189` lists the six desktop observation tools.
- `README.md:248-257` repeats the same split in the root product documentation.
- `tests/cli-help.test.ts:96-145` locks the discovery copy and the three-lane wording into tests.

Conclusion:

The hypothesis is partially eliminated. Desktop observation is already first-class. The actual gap is that browser-scoped computer use and desktop-assisted review are not first-class public families.

### Phase 2 - Internal composition seam

Hypothesis: the runtime does not yet have a reusable seam for a stronger first-class public surface.

Findings:

- Core bootstrap already exposes an internal `observeDesktopAndVerify` function.
- That function first requests desktop observation and then routes verification back through browser review.
- The automation coordinator already supports desktop capture, accessibility, active-window mode, and hinted-window mode before browser verification.

Evidence:

- `src/core/bootstrap.ts:104-126` defines `observeDesktopAndVerify` and calls `automationCoordinator.requestDesktopObservation(...)` followed by `automationCoordinator.verifyAfterDesktopObservation(...)`.
- `src/automation/coordinator.ts:16-42` defines `DesktopObservationRequest` and `DesktopObservationEnvelope`.
- `src/automation/coordinator.ts:44-61` defines `BrowserVerificationEnvelope` and the coordinator contract.
- `src/automation/coordinator.ts:122-238` implements `requestDesktopObservation(...)` with `active_window` and `hinted_window` resolution.
- `src/automation/coordinator.ts:240-251` implements `verifyAfterDesktopObservation(...)` through browser review.
- `src/core/runtime-assemblies.ts:24-40` wires `desktopRuntime` and `automationCoordinator` together.
- `tests/core-bootstrap.test.ts:230-404` verifies that the composed observation-and-verification flow exists and that verification runs after observation.

Conclusion:

The hypothesis is eliminated. The internal seam already exists. The missing work is public surface design, not foundational runtime invention.

### Phase 3 - Browser-scoped computer use boundaries

Hypothesis: the optional helper is already effectively a desktop agent or a general-purpose computer-use layer.

Findings:

- The effective policy is explicit and supports only `off`, `browser`, and `browser_with_helper`.
- The optional helper is stood down when the policy disables it, when human-boundary conditions apply, or when canonical evidence does not expose safe actions.
- The helper bridge only returns bounded browser-scoped suggestions from canonical refs.

Evidence:

- `src/challenges/types.ts:20-55` defines `ChallengeAutomationMode`, `ChallengeAutomationModeSource`, and `ChallengeAutomationStandDownReason`.
- `src/challenges/policy-gate.ts:61-72` resolves mode precedence as `run > session > config`.
- `src/challenges/policy-gate.ts:75-103` resolves helper eligibility and explicit stand-down reasons.
- `src/challenges/policy-gate.ts:106-173` builds the public policy gate and sets `optionalComputerUseBridge` from helper eligibility.
- `src/challenges/capability-matrix.ts:50-72` blocks helper use when human boundaries apply or when no safe helper refs exist.
- `src/challenges/capability-matrix.ts:86-87` publishes `canUseComputerUseBridge` and `helperEligibility`.
- `src/challenges/optional-computer-use-bridge.ts:29-53` only returns bounded click suggestions from canonical evidence.
- `src/challenges/orchestrator.ts:180-184` runs policy resolution and capability analysis before strategy selection.
- `src/challenges/orchestrator.ts:308-311` only invokes `suggestComputerUseActions(...)` after those gates.
- `docs/ARCHITECTURE.md:68-95` states that the helper bridge is browser-scoped, not a desktop agent.
- `docs/CLI.md:165-180` repeats the same policy split in the CLI contract.
- `tests/challenges-capability-matrix.test.ts:94-151` verifies helper stand-down behavior for human boundaries and no-safe-action cases.
- `tests/tools-workflows.test.ts:165-214` verifies that workflow tools only forward `challengeAutomationMode` through runtime policy.

Conclusion:

The hypothesis is eliminated. The current computer-use layer is intentionally browser-scoped, suggestion-oriented, and bounded. It is not secretly a desktop agent.

### Phase 4 - Desktop runtime capability bar

Hypothesis: the shipped desktop runtime already meets the bar for a true public desktop agent.

Findings:

- The runtime is observe-only by type contract.
- The runtime is macOS-only and uses the local `swift` command plus `screencapture`.
- Audit records already exist, but the runtime does not expose desktop actuation, cross-app focus control, or bounded workspace controls.
- The architecture docs explicitly list those missing capabilities as prerequisites for any future desktop-agent claim.

Evidence:

- `src/desktop/types.ts:1-4` limits capabilities to `observe.windows`, `observe.screen`, `observe.window`, and `observe.accessibility`.
- `src/desktop/types.ts:74-82` defines `DesktopRuntimeLike` with status, listing, capture, and accessibility methods only.
- `src/desktop/runtime.ts:67` defines `MACOS_SCREENCAPTURE_PATH`.
- `src/desktop/runtime.ts:378-383` rejects non-macOS platforms and `desktop.permissionLevel=off`.
- `src/desktop/runtime.ts:440-517` creates the runtime and probes permissions through local commands.
- `src/desktop/runtime.ts:619-722` wraps list, active-window, capture, and accessibility operations in audit-backed execution.
- `src/desktop/audit.ts:56-71` persists audit records with artifact paths.
- `src/config.ts:464-468` shows the shipped desktop defaults: `permissionLevel=observe`, audit directory, and accessibility depth/child bounds.
- `docs/ARCHITECTURE.md:81-95` states that the desktop-agent boundary is roadmap-only and enumerates the minimum capability bar, including OS-level actuation, cross-app focus, consent gating, bounded workspace controls, replay-safe logs, and separate failure taxonomy.

Conclusion:

The hypothesis is eliminated. The shipped desktop runtime is intentionally a first-class observation plane, not a desktop agent.

### Phase 5 - Public-surface and operator-UX gaps

Hypothesis: the remaining work is primarily deeper runtime engineering.

Findings:

- The highest-value missing surface is a public composed review flow that uses desktop evidence and then verifies through browser review.
- The second missing surface is a first-class computer-use inspect/plan surface exposing effective mode, mode source, helper eligibility, stand-down reason, and safe suggested steps.
- The third missing surface is correlated audit output that links desktop evidence, browser verification, and policy decisions into one operator bundle.

Evidence:

- `src/core/bootstrap.ts:104-126` proves the composed review seam already exists internally.
- `src/challenges/policy-gate.ts:61-173` and `src/challenges/capability-matrix.ts:3-87` prove the inspectable policy state already exists internally.
- `src/challenges/orchestrator.ts:37-83` builds orchestration outcomes with `helperEligibility`, `standDownReason`, verification, and evidence.
- `src/challenges/outcome-recorder.ts:1-22` shows that orchestration outcomes are already recorded, albeit in-memory and challenge-scoped.
- `src/tools/desktop-shared.ts:8-31` shows that desktop tools already serialize structured audit information and can participate in richer correlated outputs.

Conclusion:

The hypothesis is eliminated. The highest-priority work is public productization of existing seams, not immediately widening runtime authority.

### Phase 6 - External research synthesis

Hypothesis: first-class capability requires a unified browser-and-desktop agent metaphor.

Findings:

- Strong external examples do not push toward one monolithic agent abstraction.
- Mature systems separate observation, action, policy, and session/runtime concerns.
- Reliability comes from stable targeting, actionability checks, isolated execution contexts, artifact capture, and explicit consent boundaries.

Evidence:

- OpenAI Computer Use guide: isolated environment guidance, screenshot-first loops, ordered action batches, screenshot-after-action verification, custom harness reuse, and action-time confirmation for risky steps.
- Playwright guides: locator strictness, user-facing targeting, auto-waiting and actionability checks, trace artifacts, and isolated browser contexts.
- Stagehand docs: separate `Observe`, `Act`, `Extract`, and `Agent` primitives rather than forcing one agent metaphor.
- Browser Use docs: explicit split between agent runs and raw browser sessions.

Conclusion:

The hypothesis is eliminated. The stronger pattern is layered capability design, not metaphor collapse.

## Root Cause

The core problem is not missing architecture. The core problem is a public-surface mismatch.

OpenDevBrowser already has the right internal split:

- desktop observation as a public, observe-only sibling runtime
- browser-scoped challenge handling and optional helper logic as a bounded browser lane
- desktop-assisted browser verification as an internal composed seam

What is missing is a coherent operator-facing productization of those seams. Desktop observation is already first-class. Browser-scoped computer use is still presented as a workflow modifier, and the most capable composed seam is still internal only. That makes the product feel less capable than the runtime actually is.

## Eliminated Hypotheses

- Desktop observation is not first-class.
  Eliminated by `src/public-surface/source.ts:535-567,670-675`, `docs/SURFACE_REFERENCE.md:100-106,184-189`, and `README.md:418-428`.

- The runtime lacks a higher-capability composition seam.
  Eliminated by `src/core/bootstrap.ts:104-126`, `src/automation/coordinator.ts:122-251`, and `tests/core-bootstrap.test.ts:230-404`.

- The optional helper is already a desktop agent under another name.
  Eliminated by `src/challenges/policy-gate.ts:75-173`, `src/challenges/optional-computer-use-bridge.ts:29-53`, and `docs/ARCHITECTURE.md:68-95`.

- Desktop commands do not support per-command timeout control.
  Eliminated by `src/public-surface/source.ts:539-562` and `src/cli/commands/desktop/shared.ts:19-33,56-61`.

- A unified browser-and-desktop agent metaphor is the normal mature pattern.
  Eliminated by the external patterns reviewed from OpenAI Computer Use, Playwright, Stagehand, and Browser Use.

## Recommendations

1. Publish a review-owned desktop-assisted browser review surface.
   This should expose the existing `observeDesktopAndVerify` seam publicly, but keep naming and authority with the review/verification family rather than the desktop family.

2. Publish first-class browser-scoped computer-use inspect and plan surfaces.
   Operators should be able to inspect effective mode, mode source, helper eligibility, stand-down reason, yield reason, and safe suggested steps without running a provider workflow.

3. Publish correlated audit bundles.
   A first-class operator bundle should link desktop artifacts, browser review, policy state, timestamps, and a shared observation identifier.

4. Publish capability discovery as a runtime surface.
   Operators should be able to ask one place whether desktop observation is available, whether accessibility is available, what challenge policy is effective, and which first-class lanes are enabled on the current host and session.

5. Treat true desktop actuation as a later, separate contract.
   If the project later wants a real desktop agent, it should create a distinct contract with separate policy, action taxonomy, consent model, abort controls, replay-safe logs, and documentation. It should not widen `challengeAutomationMode` into that job.

## What Can Wait

- OS-level desktop actuation
- cross-app focus control
- desktop action planning
- widening `/ops` into a desktop control channel
- cross-platform desktop runtime expansion
- any unified browser-plus-desktop agent metaphor

These are expensive and policy-heavy changes, and they are not required to make the product feel first-class in the next increment.

## Preventive Measures

- Keep help, README, CLI docs, architecture docs, and public-surface manifests aligned on the three-plane model.
- Add parity tests for any new composed review or policy-inspection surfaces, the same way desktop observation and help wording are already parity-tested.
- Keep browser truth browser-owned, even when desktop evidence participates.
- Keep stand-down reasons and human-boundary decisions explicit and serializable.
- Keep first-class surfaces artifact-rich so failures can be audited and replayed without widening runtime authority.

## External Research Synthesis

### OpenAI Computer Use

Relevant patterns:

- isolate the runtime environment up front
- start with screenshot capture when state is uncertain
- execute returned actions in order
- capture updated screenshots after each action batch
- keep a human in the loop at the point of risk, not prematurely
- custom harness reuse is preferred when mature domain-specific guardrails already exist

Implication for OpenDevBrowser:

The project should treat its existing review, browser, and desktop seams as a reusable harness and make them first-class, rather than discarding them for a new monolithic agent story.

### Playwright

Relevant patterns:

- prefer stable, user-facing targets over brittle structure-based targeting
- rely on actionability checks and auto-waiting before actions
- use trace artifacts, screenshots, logs, and network evidence for debugging
- isolate execution contexts for reproducibility and easier debugging

Implication for OpenDevBrowser:

First-class computer-use surfaces should expose stable targeting evidence, explicit verification, and artifact-rich outputs. They should feel deterministic and debuggable, not magical.

### Stagehand

Relevant patterns:

- separate `Observe`, `Act`, `Extract`, and `Agent` rather than forcing all work into one abstraction
- let operators choose how much AI versus deterministic control they want
- emphasize repeatability and replayability

Implication for OpenDevBrowser:

The strongest public model is `desktop observation`, `browser-scoped computer use`, and `desktop-assisted browser review`, not one catch-all desktop agent.

### Browser Use

Relevant patterns:

- split agent runs from raw browser sessions
- treat infrastructure/runtime concerns separately from agent-level intent

Implication for OpenDevBrowser:

The project should keep raw runtime surfaces, policy surfaces, and orchestration surfaces distinct. That separation improves product clarity and preserves safety boundaries.

## Recommended Product Framing

- Desktop observation: read-only evidence from the sibling desktop runtime.
- Browser-scoped computer use: bounded browser-only challenge assistance.
- Desktop-assisted browser review: correlated desktop evidence plus browser-owned verification.

Avoid these phrases unless a new contract is intentionally created later:

- desktop agent
- unified computer use agent
- desktop automation family

## Bottom Line

The strongest next move is to make the missing composed review and policy-inspection surfaces first-class, not to make the desktop runtime more powerful. That path gives OpenDevBrowser a much stronger operator story, better debuggability, and higher perceived capability without breaking its existing safety and authority boundaries.
