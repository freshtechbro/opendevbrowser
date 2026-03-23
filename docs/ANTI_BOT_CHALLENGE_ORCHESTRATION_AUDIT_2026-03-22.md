# Anti-Bot Challenge Orchestration Part 2 Audit

Status: complete  
Date: 2026-03-22  
Scope:
- `docs/ANTI_BOT_CHALLENGE_ORCHESTRATION_PART_2.md`
- `docs/ANTI_BOT_CHALLENGE_ORCHESTRATION_IMPLEMENTATION_PLAN.md`
- `docs/INVESTIGATION_ANTI_BOT_CHALLENGE_ORCHESTRATION_2026-03-21.md`
- Live runtime, tests, and public docs in the current `antibot` worktree

This audit used the Part 2 plan as a strict inventory. Each Task 1-8 acceptance criterion stayed open until live code, deterministic tests, and public docs all supported closure. The audit loop found proof gaps during implementation, added the missing branch-focused coverage, re-ran the gates, and only then closed the final inventory.

## Final verdict

- All 8 Part 2 tasks are closed.
- All 32 Part 2 acceptance criteria are closed.
- The shared `src/challenges/` plane is integrated across direct browser, `/ops`, provider fallback, and workflow narration without reopening Part 1 ownership seams.
- Public docs now describe the shipped bounded-autonomy posture without claiming unsandboxed third-party challenge solving.
- No remaining implementation or proof gaps were found after the final re-audit.

## Audit-loop findings that required closure

- The old audit file was stale. It still described a seven-task plan and outdated gate totals. It was replaced with this Task 1-8 closure report.
- Branch-proof gaps remained around fallback and no-progress branches in the challenge plane. They were closed with focused coverage in `tests/challenges-capability-matrix.test.ts`, `tests/challenges-action-loop-fallback.test.ts`, and `tests/challenges-orchestrator-fallback.test.ts`.
- The final evidence-bundle fallback path was tightened in `src/challenges/evidence-bundle.ts` so the targeted tests proved the real branch behavior instead of relying on defensive empty-string defaults.

## Inventory summary

| Task | Status | Primary implementation evidence | Primary proof |
|---|---|---|---|
| Task 1 | Closed | `src/challenges/types.ts`, `src/challenges/index.ts`, `src/challenges/README.md` | `tests/challenges-evidence-bundle.test.ts`, `tests/challenges-orchestrator.test.ts` |
| Task 2 | Closed | `src/challenges/evidence-bundle.ts`, `src/challenges/interpreter.ts` | `tests/challenges-evidence-bundle.test.ts`, `tests/challenges-interpreter.test.ts` |
| Task 3 | Closed | `src/challenges/capability-matrix.ts`, `src/challenges/strategy-selector.ts`, `src/challenges/policy-gate.ts` | `tests/challenges-capability-matrix.test.ts`, `tests/challenges-strategy-selector.test.ts` |
| Task 4 | Closed | `src/challenges/action-loop.ts`, `src/challenges/verification-gate.ts`, `src/challenges/orchestrator.ts` | `tests/challenges-action-loop.test.ts`, `tests/challenges-action-loop-fallback.test.ts`, `tests/challenges-verification-gate.test.ts` |
| Task 5 | Closed | `src/challenges/human-yield-gate.ts`, `src/challenges/outcome-recorder.ts`, `src/providers/index.ts`, `src/providers/workflows.ts` | `tests/challenges-human-yield-gate.test.ts`, `tests/challenges-outcome-recorder.test.ts`, `tests/challenges-orchestrator.test.ts`, `tests/providers-workflows-branches.test.ts` |
| Task 6 | Closed | `src/challenges/governed-adapter-gateway.ts`, lane modules, `src/config.ts` | `tests/challenges-governed-adapter-gateway.test.ts`, `tests/anti-bot-fixtures.test.ts` |
| Task 7 | Closed | `src/challenges/optional-computer-use-bridge.ts`, `src/challenges/action-loop.ts` | `tests/challenges-optional-computer-use-bridge.test.ts`, `tests/challenges-strategy-selector.test.ts`, `tests/challenges-action-loop.test.ts` |
| Task 8 | Closed | `src/browser/browser-manager.ts`, `src/browser/ops-browser-manager.ts`, `src/providers/runtime-factory.ts`, `src/providers/workflows.ts`, public docs | Challenge unit suite, runtime-handle integration tests, provider fallback tests, workflow summary tests, docs sync checks |

## Task-by-task audit

### Task 1 - Establish the challenge intelligence module and additive contracts

Status: closed

Implementation evidence:
- `src/challenges/` is the only new top-level Part 2 intelligence module and exports one shared surface through `src/challenges/index.ts`.
- `src/challenges/types.ts` defines additive challenge-plane contracts, including evidence, interpretation, lane selection, verification, yield, governed-lane, and outcome types.
- `src/challenges/README.md` documents the authority boundaries: `SessionStore` remains blocker truth, managers remain surfaced blocker/challenge writers, `GlobalChallengeCoordinator` remains lifecycle-only, and registry pressure stays registry-owned.
- `src/browser/manager-types.ts` and `src/providers/types.ts` extend existing contracts only where the new plane needs typed evidence, handles, or preserved-session metadata.

Acceptance closure:
- Closed: `src/challenges/` exists as the single Part 2 landing zone.
- Closed: shared types are additive and do not replace blocker, lifecycle, or registry truth.
- Closed: Part 1 authority boundaries remain intact.
- Closed: challenge behavior is not duplicated into providers, daemon shims, or `/ops` transport.

### Task 2 - Build the canonical evidence bundle and provider-neutral interpreter

Status: closed

Implementation evidence:
- `src/challenges/evidence-bundle.ts` builds one canonical bundle from blocker metadata, additive challenge metadata, URL/title state, snapshots, diagnostics, preserved-session context, policy signals, and non-secret data availability.
- `src/challenges/interpreter.ts` classifies auth state, challenge class, human boundary, continuity options, lane hints, and verification requirements without mutating runtime truth.
- `src/challenges/orchestrator.ts` uses the bundle and interpreter as the common entrypoint regardless of source surface.
- `src/providers/runtime-factory.ts` threads fallback disposition and preserved-session identifiers into the same bundle shape used by direct and `/ops` incidents.

Acceptance closure:
- Closed: one bundle format is shared across direct and `/ops` incidents.
- Closed: the bundle includes blocker, additive challenge, evidence, preserved-session, registry-pressure, and continuity inputs.
- Closed: the interpreter returns provider-neutral challenge and capability summaries.
- Closed: the interpreter is read-only and does not mutate blocker, lifecycle, or durable pressure truth.

Proof:
- `tests/challenges-evidence-bundle.test.ts`
- `tests/challenges-interpreter.test.ts`

### Task 3 - Add explicit lane selection and capability mapping

Status: closed

Implementation evidence:
- `src/challenges/capability-matrix.ts` computes the allowed autonomy surface from policy, continuity, auth state, pressure, and human-boundary signals.
- `src/challenges/strategy-selector.ts` returns exactly one next lane with rationale, attempt budget, verify cadence, stop conditions, and escalation rules.
- `src/challenges/policy-gate.ts`, `src/providers/policy.ts`, and `src/providers/shared/anti-bot-policy.ts` expose the policy inputs and registry-backed pressure needed by the selector without making the selector authoritative.

Acceptance closure:
- Closed: the selector returns one deterministic lane for each preserved incident.
- Closed: each decision carries rationale, attempt budget, and stop conditions.
- Closed: lane choice depends on canonical evidence, policy, and registry-backed pressure inputs.
- Closed: selector logic stays pure and non-authoritative.

Proof:
- `tests/challenges-capability-matrix.test.ts`
- `tests/challenges-strategy-selector.test.ts`

### Task 4 - Build the generic autonomous action loop and verification gate

Status: closed

Implementation evidence:
- `src/challenges/action-loop.ts` implements the bounded observe -> act -> verify loop using manager and `/ops` handles for DOM actions, pointer actions, navigation, session reuse checks, cookie-backed reuse attempts, non-secret fill, scroll, and trace refresh.
- `src/challenges/verification-gate.ts` re-checks progress after each atomic step using manager-owned verification paths only.
- `src/challenges/orchestrator.ts` binds the interpreter, selector, loop, governed lanes, and yield logic into one runtime path.
- `src/browser/manager-types.ts`, `src/browser/browser-manager.ts`, and `src/browser/ops-browser-manager.ts` expose the additive handle surface needed by the loop without moving loop logic into the managers.

Acceptance closure:
- Closed: the loop uses the existing manager, `/ops`, DOM, input, pointer, cookie, and diagnostics controls.
- Closed: the loop attempts auth navigation, session or cookie reuse, non-secret form fill, and bounded interaction experimentation before yielding.
- Closed: every state-changing step is followed by manager-owned verification.
- Closed: blocker truth is never cleared outside manager-owned verification.

Proof:
- `tests/challenges-action-loop.test.ts`
- `tests/challenges-action-loop-fallback.test.ts`
- `tests/challenges-verification-gate.test.ts`
- `tests/browser-manager-challenge-runtime-handle.test.ts`
- `tests/ops-browser-manager-challenge-runtime-handle.test.ts`

### Task 5 - Standardize human yield and outcome recording

Status: closed

Implementation evidence:
- `src/challenges/human-yield-gate.ts` defines the reclaimable `HumanYieldPacket` and narrows yield triggers to secret-bearing, MFA, human-authority, policy-blocked, or exhausted no-progress boundaries.
- `src/challenges/outcome-recorder.ts` records lane choice, attempt history, verification results, yield reason, and resume outcome by `challengeId`.
- `src/challenges/orchestrator.ts` emits standardized yield packets and outcome records from the real orchestration path.
- `src/providers/index.ts`, `src/providers/workflows.ts`, and `src/providers/registry.ts` thread resume narration and durable last-outcome state without becoming new truth authorities.

Acceptance closure:
- Closed: every human handoff returns one reclaimable packet shape.
- Closed: human yield is limited to true human-authority, secret-bearing, policy-blocked, or exhausted no-progress cases.
- Closed: outcome telemetry records lane selection, attempts, verify results, and resume outcome consistently.
- Closed: provider and workflow resume behavior stays behind verified-clear and shared runtime ownership.

Proof:
- `tests/challenges-human-yield-gate.test.ts`
- `tests/challenges-outcome-recorder.test.ts`
- `tests/challenges-orchestrator.test.ts`
- `tests/challenges-orchestrator-fallback.test.ts`
- `tests/providers-workflows-branches.test.ts`

### Task 6 - Add governed optional lanes for owned-environment, sanctioned identity, and service adapters

Status: closed

Implementation evidence:
- `src/challenges/governed-adapter-gateway.ts` is the single decision seam for governed advanced lanes.
- `src/challenges/owned-environment-lane.ts`, `src/challenges/sanctioned-identity-lane.ts`, and `src/challenges/service-adapter-lane.ts` remain explicitly separated, with lane-specific result shaping.
- `src/config.ts` and the shared policy inputs gate each governed lane behind explicit enablement, entitlements, and audit metadata requirements.
- The lane outputs are additive and never redefine blocker, lifecycle, or durable pressure truth.

Acceptance closure:
- Closed: governed lanes are available on demand instead of becoming the default path.
- Closed: owned-environment, sanctioned identity, and service-adapter lanes are explicitly separated.
- Closed: every governed lane requires explicit policy or entitlement and emits audit metadata.
- Closed: governed lanes never mutate blocker, lifecycle, or durable pressure truth directly.

Proof:
- `tests/challenges-governed-adapter-gateway.test.ts`
- `tests/anti-bot-fixtures.test.ts`

### Task 7 - Add the optional browser-scoped computer-use bridge

Status: closed

Implementation evidence:
- `src/challenges/optional-computer-use-bridge.ts` provides policy-gated screenshot-driven action suggestions from the same canonical bundle used by the default loop.
- `src/challenges/action-loop.ts` only consults the bridge when the selected lane and policy gate explicitly allow it.
- `src/challenges/strategy-selector.ts` keeps the bridge off the default path and only elevates it when the browser-native lane is insufficient and policy permits it.

Acceptance closure:
- Closed: the bridge is optional, policy-controlled, and on-demand only.
- Closed: the bridge consumes canonical evidence instead of inventing a second screen-truth model.
- Closed: blocker clearance still routes through manager-owned verification.
- Closed: the default path remains browser-native while the bridge stays a helper lane.

Proof:
- `tests/challenges-optional-computer-use-bridge.test.ts`
- `tests/challenges-strategy-selector.test.ts`
- `tests/challenges-action-loop.test.ts`

### Task 8 - Integrate across surfaces, lock tests, and update docs when behavior lands

Status: closed

Implementation evidence:
- `src/browser/browser-manager.ts` integrates the shared challenge plane into direct browser preserved-session handling.
- `src/browser/ops-browser-manager.ts` integrates the same plane into `/ops` preserved-session handling while keeping `extension/src/ops/ops-runtime.ts` transport-thin.
- `src/providers/runtime-factory.ts` and `src/providers/index.ts` integrate preserved provider fallback and resumed intent handling, including `challenge_preserved` transport disposition and `details.challengeOrchestration`.
- `src/providers/workflows.ts` consumes the same shared runtime results for workflow narration, reclaim, and resume summaries.
- `README.md`, `docs/ARCHITECTURE.md`, `docs/CLI.md`, and `docs/SURFACE_REFERENCE.md` now describe the shipped bounded-autonomy posture and preserve the explicit legitimacy boundary.

Acceptance closure:
- Closed: direct browser, `/ops`, provider, and workflow flows use the same Part 2 intelligence plane.
- Closed: tests cover lane selection, bounded action loops, stop rules, yield packets, governed lanes, and resume paths.
- Closed: public docs were updated only after runtime behavior landed.
- Closed: shipped-versus-target posture is now explicit and source-backed.

Proof:
- Challenge unit suite:
  - `tests/challenges-evidence-bundle.test.ts`
  - `tests/challenges-interpreter.test.ts`
  - `tests/challenges-capability-matrix.test.ts`
  - `tests/challenges-strategy-selector.test.ts`
  - `tests/challenges-action-loop.test.ts`
  - `tests/challenges-action-loop-fallback.test.ts`
  - `tests/challenges-verification-gate.test.ts`
  - `tests/challenges-human-yield-gate.test.ts`
  - `tests/challenges-outcome-recorder.test.ts`
  - `tests/challenges-governed-adapter-gateway.test.ts`
  - `tests/challenges-optional-computer-use-bridge.test.ts`
  - `tests/challenges-orchestrator.test.ts`
  - `tests/challenges-orchestrator-fallback.test.ts`
- Runtime and fallback integration:
  - `tests/browser-manager-challenge-runtime-handle.test.ts`
  - `tests/ops-browser-manager-challenge-runtime-handle.test.ts`
  - `tests/providers-runtime-factory.test.ts`
  - `tests/providers-workflows-branches.test.ts`
  - `tests/anti-bot-fixtures.test.ts`

## Public docs audit

The public docs now match the shipped Part 2 posture:

- `README.md` documents the bounded challenge orchestration plane, low-level pointer support, registry-backed anti-bot pressure, and the in-scope versus out-of-scope legitimacy boundary.
- `docs/ARCHITECTURE.md` documents the Part 2 authority split: managers surface blocker and challenge metadata, `GlobalChallengeCoordinator` owns lifecycle only, `src/challenges/` owns bounded intelligence only, runtime-factory owns preserve-or-complete transport, and registry owns durable pressure.
- `docs/CLI.md` documents additive `meta.challenge` and `meta.challengeOrchestration`, explicit fallback dispositions, shared bounded challenge behavior, resume ownership, and the in-scope versus out-of-scope boundary.
- `docs/SURFACE_REFERENCE.md` documents the same blocker/challenge surface, fallback dispositions, shared bounded challenge plane, and legitimacy boundary for tool, CLI, and `/ops` consumers.

## Final validation evidence

- `npm run test`
  - `Test Files  204 passed | 1 skipped (205)`
  - `Tests  2573 passed | 1 skipped (2574)`
  - `All files 98.17 stmts | 97.00 branch | 97.69 funcs | 98.22 lines`
- `npm run lint`: passed
- `npm run typecheck`: passed
- `npm run build`: passed
- `npm run extension:build`: passed
- `node scripts/docs-drift-check.mjs`: passed with `ok: true`
  - command count: `60`
  - tool count: `53`
  - ops count: `48`
  - canvas count: `35`
- `./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh`: passed
  - `Skill assets validated: 22 files referenced/present, 10 JSON templates parsed.`

## Closure statement

The Part 2 inventory is fully closed. The implementation now ships one shared, bounded, auditable challenge intelligence plane that can interpret preserved auth and anti-bot incidents, select a policy-allowed lane, attempt legitimate browser-native progression, escalate cleanly to a human when required, and narrate resume outcomes across runtime surfaces without inventing a second blocker, lifecycle, or durable-pressure authority.
