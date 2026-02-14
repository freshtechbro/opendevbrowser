# Automation Platform Efficiency Implementation Plan

Convert `docs/AUTOMATION_PLATFORM_EFFICIENCY_SPEC.md` into an execution-ready implementation plan with no unresolved implementation decisions.

---

## Summary

This plan delivers FR-1 through FR-11 from the efficiency spec through dependency-ordered phases, preserving existing public command/tool names while adding capability behind additive config and additive response metadata.

Execution strategy is fixed to phased PRs:
1. Foundation contracts and runtime wiring.
2. Throughput engine upgrades.
3. Real retrieval defaults and safety.
4. Fingerprint/canary continuous operation and release gates.

---

## Overview

### Scope
- Implement tier runtime wiring, adaptive concurrency, worker crawl, and continuous fingerprint evaluation.
- Enforce real search/fetch behavior across default provider paths.
- Add guardrails for prompt-injection and establish observable rollout/SLO gates.

### Key decisions
- Preserve public tool/CLI/daemon command names; use additive fields and options only.
- Expose provider execution through existing macro surface by extending macro resolve with optional execute mode.
- Prohibit placeholder/synthetic runtime records on production/default paths.
- Set Tier 2/Tier 3 default-on with explicit rollback/kill-switch controls.

---

## Public APIs/Interfaces/Types

1. Config additions in `src/config.ts`:
   - `providers.tiers.default: "A" | "B" | "C"` (default `"A"`).
   - `providers.tiers.enableHybrid: boolean`.
   - `providers.tiers.enableRestrictedSafe: boolean`.
   - `providers.adaptiveConcurrency.enabled: boolean`.
   - `providers.adaptiveConcurrency.maxGlobal: number`.
   - `providers.adaptiveConcurrency.maxPerDomain: number`.
   - `providers.crawler.workerThreads: number`.
   - `providers.crawler.queueMax: number`.
   - `security.promptInjectionGuard.enabled: boolean`.
   - `fingerprint.tier2.enabled: boolean` (default `true`).
   - `fingerprint.tier2.mode: "deterministic" | "adaptive"` (default `"adaptive"`).
   - `fingerprint.tier2.continuousSignals: boolean` (default `true`).
   - `fingerprint.tier3.enabled: boolean` (default `true`).
   - `fingerprint.tier3.continuousSignals: boolean` (default `true`).
   - `canary.targets.enabled: boolean`.

2. Provider runtime metadata additions in `src/providers/types.ts`:
   - Tier metadata:
     - `meta.tier.selected`
     - `meta.tier.reasonCode`
   - Provenance metadata:
     - `meta.provenance.provider`
     - `meta.provenance.retrievalPath`
     - `meta.provenance.retrievedAt`

3. Macro resolve additive execution option:
   - Tool `opendevbrowser_macro_resolve` gains `execute?: boolean`.
   - CLI `macro-resolve` gains `--execute`.
   - Daemon command `macro.resolve` accepts `execute`.
   - `execute=false` keeps existing resolve-only behavior.
   - `execute=true` returns real runtime output in additive `execution` payload.

4. Logging/event additions:
   - Tier transition events with previous/next tier + reason code.
   - Canary promote/rollback events with score window data.
   - Provider realism violation event on placeholder detection.

---

## Assumptions and Defaults

- Plan target file is `docs/AUTOMATION_PLATFORM_IMPLEMENTATION_PLAN.md`.
- Delivery is phased PRs, dependency-ordered.
- Provider execution is surfaced via macro resolve execute mode.
- No placeholder runtime records are permitted in production/default paths.
- Tier 2 and Tier 3 ship default-on; rollout safety is enforced via canary thresholds and automatic rollback triggers.
- Existing quality gates remain required: `lint`, `tsc --noEmit`, `build`, `test` with coverage threshold.

---

## Task 1 — Contract and Config Foundation

### Reasoning
Later tasks depend on stable type/config contracts for tiering, metadata, and rollout controls.

### What to do
Add additive config and type contracts required by FR-1, FR-5, FR-10, and observability criteria.

### How
1. Extend `OpenDevBrowserConfig` and Zod schema with provider/tier/adaptive/crawler/guard/canary keys.
2. Define safe defaults and keep backward compatibility.
3. Add provider runtime metadata and tier reason code contracts.
4. Ensure metadata remains serialization-safe for tool/CLI/daemon outputs.

### Files impacted
- `src/config.ts`
- `src/providers/types.ts`
- `src/core/types.ts`
- `tests/config.test.ts`
- `tests/providers-contracts.test.ts`

### End goal
All new capabilities have typed config contracts and default-safe parsing.

### Acceptance criteria
- [ ] New keys parse with defaults.
- [ ] Existing configs remain valid.
- [ ] Runtime metadata contracts compile and are consumable by surfaces.

---

## Task 2 — Tier Router Runtime Integration

### Reasoning
FR-1 to FR-3 require explicit, auditable tier state and deterministic fallback.

### What to do
Implement tier selection and fallback in provider execution flow.

### How
1. Add tier router module using provider capability, health, policy, and risk signals.
2. Compute `selectedTier` and `reasonCode` before provider invocation.
3. Add deterministic fallback path from Tier B/C to Tier A.
4. Emit tier metadata in operation outputs and structured logs.
5. Preserve existing `source=auto|all` semantics while adding metadata.

### Files impacted
- `src/providers/index.ts`
- `src/providers/policy.ts`
- `src/providers/registry.ts`
- `src/providers/normalize.ts`
- `src/providers/tier-router.ts` (new file)
- `tests/providers-runtime.test.ts`
- `tests/providers-policy.test.ts`

### End goal
Every provider execution is tier-aware and fallback-safe.

### Acceptance criteria
- [ ] Tier selection and reason code appear per execution.
- [ ] Tier B/C failures deterministically fall back to Tier A.
- [ ] Existing provider fallback ordering remains intact.

---

## Task 3 — Adaptive Concurrency Controller

### Reasoning
Current concurrency is static and cannot respond to pressure and failure dynamics.

### What to do
Introduce adaptive concurrency for global and per-domain/provider budgets.

### How
1. Implement AIMD with cooldown and min/max clamps.
2. Feed controller with latency, timeout, 4xx/5xx, challenge, queue pressure signals.
3. Integrate effective budgets into runtime semaphores and web-crawl dispatch (`fetchConcurrency` + scoped crawl caps).
4. Expose effective concurrency values in diagnostics for verification.

### Files impacted
- `src/providers/index.ts`
- `src/providers/adaptive-concurrency.ts` (new file)
- `src/providers/types.ts`
- `tests/providers-runtime.test.ts`
- `tests/providers-performance-gate.test.ts`

### End goal
Runtime concurrency adapts predictably and safely.

### Acceptance criteria
- [ ] Controller scales up in healthy windows.
- [ ] Controller scales down on failure/challenge spikes.
- [ ] Budgets respect configured caps and floors.

---

## Task 4 — Worker-Thread Crawl Pipeline

### Reasoning
Sequential crawl fetch/extract is a primary throughput bottleneck.

### What to do
Implement bounded worker-thread crawl with deterministic merge.

### How
1. Split crawl into scheduler/fetch/parse-extract stages.
2. Add worker pool for parse/extract tasks (fetch remains on bounded scheduler path).
3. Enforce queue max, depth/page/domain caps, and deadline cancellation.
4. Apply deterministic ordering key:
   - `firstSeenAtMs asc`
   - `sourcePriority asc`
   - `stableRecordId asc`
   - frontier sequence fallback.
5. Keep non-worker fallback path for compatibility.

### Files impacted
- `src/providers/web/crawler.ts`
- `src/providers/web/crawl-worker.ts` (new file)
- `src/providers/web/index.ts`
- `src/providers/normalize.ts`
- `tests/providers-web.test.ts`
- `tests/providers-performance-gate.test.ts`

### End goal
Crawl is parallel, bounded, deterministic, and measurable.

### Acceptance criteria
- [ ] Queue/backpressure and budget limits are enforced.
- [ ] Output ordering is deterministic across runs.
- [ ] Throughput improves versus sequential baseline fixture.

---

## Task 5 — Real Retrieval Defaults (No Placeholder Paths)

### Reasoning
Default community/social paths still emit synthetic fallback content, violating FR-6.

### What to do
Replace synthetic defaults with real retrieval or structured failure output.

### How
1. Remove `.local` and input-echo synthetic records from default code paths.
2. Implement real retrieval defaults for web/community/social search/fetch.
3. Return structured errors when real retrieval cannot complete.
4. Ensure successful records include provenance metadata.
5. Add runtime realism checks that fail on placeholder patterns.

### Files impacted
- `src/providers/community/index.ts`
- `src/providers/social/platform.ts`
- `src/providers/social/index.ts`
- `src/providers/web/index.ts`
- `src/providers/errors.ts`
- `tests/providers-community.test.ts`
- `tests/providers-social-platforms.test.ts`
- `tests/providers-social.test.ts`
- `tests/providers-runtime.test.ts`

### End goal
Default provider output is always real retrieval data or explicit structured failure.

### Acceptance criteria
- [ ] No synthetic placeholder URL/content in default runtime records.
- [ ] Retrieval failures map to structured provider error codes.
- [ ] Provenance metadata present on successful records.

---

## Task 6 — FR-7 Community/Social Traversal Defaults

### Reasoning
FR-7 requires pagination, thread expansion, and multi-hop traversal defaults.

### What to do
Implement bounded traversal with deterministic dedupe and quality flags.

### How
1. Add pagination loops with explicit page budgets.
2. Add thread/link expansion with depth/hop bounds.
3. Implement deterministic dedupe using stable IDs + canonical URLs.
4. Emit extraction quality flags on each record.

### Files impacted
- `src/providers/community/index.ts`
- `src/providers/social/platform.ts`
- `src/providers/web/crawler.ts`
- `src/providers/normalize.ts`
- `tests/providers-community.test.ts`
- `tests/providers-social-platforms.test.ts`
- `tests/providers-web.test.ts`

### End goal
Community/social defaults satisfy FR-7 without unbounded traversal behavior.

### Acceptance criteria
- [ ] Pagination and multi-hop traversal are bounded.
- [ ] Dedupe is deterministic.
- [ ] Quality flags are emitted per record.

---

## Task 7 — Prompt-Injection Guardrail Pipeline

### Reasoning
Guardrail requirements exist in spec but are not implemented in provider flow.

### What to do
Implement untrusted-content labeling, scanning, quarantine, and data-only assembly safeguards.

### How
1. Add a shared prompt-guard module with risk classification.
2. Mark remote content as untrusted at retrieval boundary.
3. Scan content before analysis-context assembly.
4. Quarantine/strip high-risk segments; retain audit trail.
5. Wire the same guardrail into tool and CLI/daemon execution paths.

### Files impacted
- `src/providers/safety/prompt-guard.ts` (new file)
- `src/providers/index.ts`
- `src/tools/macro_resolve.ts`
- `src/cli/daemon-commands.ts`
- `tests/providers-runtime.test.ts`
- `tests/tools.test.ts`
- `tests/daemon-commands.integration.test.ts`

### End goal
All provider-to-analysis context flows pass through one shared safety pipeline.

### Acceptance criteria
- [ ] Malicious instruction-bearing patterns are blocked/quarantined.
- [ ] Tool and daemon flows use the same guardrail logic.
- [ ] Guardrail decisions are observable in logs/audit output.

---

## Task 8 — Macro Resolve Execute Mode (Runtime Surface Wiring)

### Reasoning
FR behavior must be reachable via existing shipped surfaces without introducing breaking command changes.

### What to do
Extend macro resolve to optionally execute resolved provider actions and return real outputs.

### How
1. Add `execute?: boolean` to tool args and daemon params.
2. Add `--execute` parsing to CLI macro-resolve command.
3. Keep resolve-only path as default behavior.
4. For execute mode:
   - resolve macro action,
   - execute provider runtime operation,
   - return additive `execution` payload with records/failures/metrics/meta.
5. Keep error taxonomy compatible with existing response conventions.

### Files impacted
- `src/tools/macro_resolve.ts`
- `src/cli/commands/macro-resolve.ts`
- `src/cli/args.ts`
- `src/cli/daemon-commands.ts`
- `src/core/bootstrap.ts`
- `src/tools/deps.ts`
- `tests/macro-resolve.test.ts`
- `tests/tools.test.ts`
- `tests/cli-args.test.ts`
- `tests/daemon-commands.integration.test.ts`
- `tests/parity-matrix.test.ts`

### End goal
Provider runtime behavior is reachable via existing macro surfaces across tool/CLI/daemon.

### Acceptance criteria
- [ ] Resolve-only behavior remains unchanged.
- [ ] Execute mode returns real records + required metadata.
- [ ] Tool/CLI/daemon parity tests pass for resolve and execute modes.

---

## Task 9 — Continuous Fingerprint Tier 2/3 and Canary Loop

### Reasoning
Tier 2/3 currently rely on debug-trace-triggered update flow rather than continuous signals.

### What to do
Shift Tier 2/3 updates to continuous runtime signal path and expose canary decisions.

### How
1. Add network event subscription path from `NetworkTracker` into fingerprint update flow.
2. Trigger Tier 2 event application continuously as events arrive.
3. Trigger Tier 3 adaptive evaluation from same stream.
4. Set Tier 2/Tier 3 config defaults to enabled + continuous mode in schema defaults.
5. Keep debug trace as reporting surface only.
6. Emit canary promote/rollback events with score and thresholds.

### Files impacted
- `src/devtools/network-tracker.ts`
- `src/browser/browser-manager.ts`
- `src/browser/fingerprint/tier2-runtime.ts`
- `src/browser/fingerprint/tier3-adaptive.ts`
- `src/browser/fingerprint/canary.ts`
- `tests/fingerprint-tier2.test.ts`
- `tests/fingerprint-tier3.test.ts`
- `tests/browser-manager.test.ts`

### End goal
Tier 2/3 behavior is continuous, deterministic, and observable.

### Acceptance criteria
- [ ] Tier 2/3 state updates occur without debug-trace calls.
- [ ] Canary events include action, reason, and score context.
- [ ] Fallback behavior respects configured fallback tier and reasoning.

---

## Task 10 — Observability, SLO Gates, and Rollout Controls

### Reasoning
Phase gates require explicit observable signals and benchmark protocols.

### What to do
Implement observable fields/events and enforce rollout/performance gates.

### How
1. Emit required metadata fields on execution responses.
2. Emit tier/canary/realism events in structured logs.
3. Enforce realism detection as a hard release gate in tests.
4. Align performance tests with benchmark protocol and fixture definitions.

### Files impacted
- `src/core/logging.ts`
- `src/providers/index.ts`
- `tests/providers-performance-gate.test.ts`
- `tests/providers-runtime.test.ts`
- `tests/parity-matrix.test.ts`
- `docs/benchmarks/provider-fixtures.md`

### End goal
Rollout gating decisions can be made from deterministic, test-backed signals.

### Acceptance criteria
- [ ] Required `meta.*` fields are present where expected.
- [ ] Tier/canary/realism events are logged.
- [ ] Performance and realism gates are reproducible in CI.

---

## Task 11 — Documentation and Operational Readiness

### Reasoning
Spec and shipped behavior must remain synchronized for maintainability and operations.

### What to do
Publish and synchronize implementation/architecture/CLI docs.

### How
1. Save this implementation plan as canonical build plan.
2. Update architecture and CLI docs for additive execution path and metadata.
3. Update spec cross-reference pointers to this plan.
4. Ensure benchmark docs and rollout gates reference same protocol.

### Files impacted
- `docs/AUTOMATION_PLATFORM_IMPLEMENTATION_PLAN.md`
- `docs/AUTOMATION_PLATFORM_EFFICIENCY_SPEC.md`
- `docs/ARCHITECTURE.md`
- `docs/CLI.md`
- `docs/RESEARCH_AUTOMATION_PLATFORM_SPEC.md`
- `README.md`

### End goal
Documentation is consistent, current, and release-ready.

### Acceptance criteria
- [ ] Canonical plan doc exists and is complete.
- [ ] CLI and architecture docs reflect implemented behavior.
- [ ] Cross-doc references are valid and non-stale.

---

## File-by-File Implementation Sequence

1. `src/config.ts` — config contract foundation.
2. `src/providers/types.ts` — tier/provenance metadata contracts.
3. `src/providers/tier-router.ts` — new tier router module.
4. `src/providers/index.ts` — runtime integration of tiering/adaptive/guardrail/metadata.
5. `src/providers/adaptive-concurrency.ts` — new adaptive controller.
6. `src/providers/web/crawl-worker.ts` — worker-thread parse/extract stage.
7. `src/providers/web/crawler.ts` — bounded scheduler/backpressure/deterministic merge.
8. `src/providers/community/index.ts` — real defaults + traversal upgrades.
9. `src/providers/social/platform.ts` — real defaults + traversal upgrades.
10. `src/providers/safety/prompt-guard.ts` — guardrail module.
11. `src/core/bootstrap.ts` + `src/tools/deps.ts` — runtime wiring to surfaces.
12. `src/tools/macro_resolve.ts`, `src/cli/commands/macro-resolve.ts`, `src/cli/args.ts`, `src/cli/daemon-commands.ts` — execute-mode wiring.
13. `src/devtools/network-tracker.ts` + `src/browser/browser-manager.ts` — continuous fingerprint signal path.
14. `src/browser/fingerprint/tier2-runtime.ts`, `src/browser/fingerprint/tier3-adaptive.ts`, `src/browser/fingerprint/canary.ts` — adaptive/canary runtime behavior.
15. `tests/*` parity/runtime/perf suites — regression and acceptance gates.
16. `docs/*` — final documentation synchronization.

---

## Dependencies to Add

No new dependencies are required initially.

| Package | Version | Purpose |
|---------|---------|---------|
| None | N/A | Use Node worker threads and existing runtime/test stack |

---

## Dependencies and Task Mapping

| Task | Depends on | Enables |
|---------|---------|---------|
| Task 1 | None | Tasks 2, 3, 8, 10 |
| Task 2 | Task 1 | Tasks 8, 10 |
| Task 3 | Task 1 | Tasks 4, 10 |
| Task 4 | Tasks 1, 3 | Tasks 6, 10 |
| Task 5 | Task 1 | Tasks 6, 8 |
| Task 6 | Tasks 4, 5 | Tasks 8, 10 |
| Task 7 | Task 1 | Tasks 8, 10 |
| Task 8 | Tasks 1, 2, 5, 6, 7 | Tasks 10, 11 |
| Task 9 | Task 1 | Tasks 10, 11 |
| Task 10 | Tasks 2, 3, 4, 8, 9 | Task 11 |
| Task 11 | Tasks 8, 9, 10 | Release readiness |

---

## PR/Phase Slicing

1. PR-1: Tasks 1 and 2.
2. PR-2: Tasks 3 and 4.
3. PR-3: Tasks 5, 6, 7, and 8.
4. PR-4: Tasks 9, 10, and 11.

Quality gates for every PR:
1. `npm run lint`
2. `npx tsc --noEmit`
3. `npm run build`
4. `npm run test`

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-02-13 | Initial implementation plan derived from automation platform efficiency spec |
