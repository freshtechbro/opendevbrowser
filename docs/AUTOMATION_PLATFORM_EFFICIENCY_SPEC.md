# OpenDevBrowser Automation Platform Efficiency Spec

Status: Draft  
Owner: Core Runtime Team  
Last Updated: 2026-02-13

---

## 0) Cross-References

- Implementation plan: [AUTOMATION_PLATFORM_IMPLEMENTATION_PLAN.md](AUTOMATION_PLATFORM_IMPLEMENTATION_PLAN.md)
- Research spec: [RESEARCH_AUTOMATION_PLATFORM_SPEC.md](RESEARCH_AUTOMATION_PLATFORM_SPEC.md)

---

## 1) Purpose

Define an efficiency-first architecture for OpenDevBrowser that:

- Preserves existing surface stability across plugin tools, CLI, daemon, and relay.
- Adds missing runtime capabilities as implementation deltas from current baseline.
- Improves real throughput and resilience without introducing unnecessary bloat.
- Hardens multi-page crawling and analysis-context assembly against prompt injection and anti-bot drift.

This is a proposed implementation spec. Requirements in this document are target-state deltas, not statements that implementation is already complete.

---

## 2) Scope

In scope:

- Runtime wiring for Provider Tier B and Tier C.
- Adaptive concurrency and worker-thread multi-page crawl.
- Real provider defaults for web/community/social with no placeholder records.
- Stronger community/social default behavior.
- Prompt-injection safeguards for crawl and analysis context.
- Continuous Tier 2 and Tier 3 fingerprint signal processing.
- Production canary effectiveness loop with promote/rollback.
- CDP/relay operational clarity and compatibility.

Out of scope:

- Breaking changes to existing public tool names or core CLI command names.
- Removal of relay legacy `/cdp` mode in this phase.
- New non-local CDP defaults.

---

## 3) Baseline (Current Implementation Snapshot)

### 3.1 Provider Tiers

- Tier B and Tier C are documented in plan docs but not implemented as runtime tiers.
- Current provider routing uses source selection and health ordering, not tier state.
- Current write/crawl policy checks exist but are not Tier C mode switching.

### 3.2 Crawl and Concurrency

- Provider runtime has global and per-provider semaphores.
- Parallel fanout exists only when `selection === "all"`.
- Web crawler is frontier-based but fetch/extract is currently sequential in-loop.
- Community/social defaults can emit synthetic placeholder records when no real adapter implementation is configured.

### 3.3 Fingerprint Tiers

- Tier 1 is wired at launch/connect and enabled by default (warning-oriented).
- Tier 2 and Tier 3 consume continuous runtime signals; debug trace is reporting/readout only.
- Tier 2 and Tier 3 are default-on with explicit opt-out controls.

### 3.4 CDP and Security

- Direct CDPConnect requires a running Chrome CDP endpoint (`/json/version`) and remote debugging enabled by operator.
- Relay `/cdp` is a local relay channel and not equivalent to direct CDP remote debugging.
- Default security enforces local endpoint restrictions (`allowNonLocalCdp: false`).

### 3.5 Baseline-to-Target Framing

- This section defines baseline facts only.
- All FR/NFR items below are explicit implementation targets.
- A requirement is not complete until it is wired end-to-end through the active runtime surface and verified by tests.

---

## 4) Problem Statement

We have strong baseline reliability and parity, but key efficiency and hardening capabilities are incomplete:

1. Tier B/Tier C are not runtime-operational.
2. Multipage crawl does not exploit worker-thread parallelism.
3. Concurrency is static rather than adaptive to live conditions.
4. Default community/social behaviors can be synthetic when adapters are absent; target state requires real retrieval outputs.
5. Prompt injection protection is not explicit in crawl-to-analysis flow.
6. Tier 2/Tier 3 require tighter operational threshold tuning across target classes.
7. Anti-bot effectiveness is not yet validated by target-site canary outcomes.

---

## 5) Design Principles

### 5.1 Efficiency Over Minimalism

- Prefer changes that maximize throughput, stability, and correctness per unit complexity.
- Accept moderate additional machinery when it replaces repeated work or bottlenecks.

### 5.2 Stable Surfaces, Deeper Runtime

- Keep public surfaces stable.
- Add capability under existing interfaces and config contracts.

### 5.3 Security and Safety by Default

- Preserve local-only CDP defaults.
- Preserve token/origin/rate-limit protections.
- Treat crawled content as untrusted by default.

### 5.4 Deterministic Fallbacks

- Every adaptive path must have explicit fallback behavior and rollback triggers.

### 5.5 No Placeholder Data

- Default runtime result paths must return real retrieved data or structured errors.
- Fabricated placeholder content/URLs are prohibited outside explicitly isolated test fixtures.

---

## 6) Functional Requirements

### FR-1: Provider Tier Runtime Wiring

Implement runtime-operational tier model:

- Tier A: browser-native core (always available baseline).
- Tier B: hybrid acceleration (optional adapter fast-paths).
- Tier C: restricted-safe mode (policy-tightened workflows).

Requirements:

1. Tier state is explicit in runtime context and logs.
2. Tier selection is deterministic and auditable.
3. Fallback to Tier A is deterministic on Tier B/C failure.

### FR-2: Tier B Triggering

Tier B enters when:

1. Adapter capability is available and healthy.
2. Policy allows hybrid acceleration for operation.
3. Risk score is below configured threshold.

Tier B exits when:

1. Adapter failure threshold breached.
2. Challenge/error/latency budget exceeded.
3. Policy requires restricted-safe mode.

### FR-3: Tier C Triggering

Tier C enters when:

1. Challenge pressure or block signals exceed threshold.
2. Target/domain is policy-marked as high-friction.
3. Operator or workflow requests restricted-safe mode.

Tier C exits when:

1. Canary and health windows recover for configured interval.
2. Policy permits return to Tier B or Tier A.

### FR-4: Worker-Thread Multipage Crawler

Add bounded parallel crawl pipeline with worker threads:

1. Frontier queue with per-domain subqueues.
2. Worker pool for parse/extract tasks, with fetch kept on the bounded async crawl scheduler path.
3. Ordered and deduplicated merge into normalized outputs using a deterministic order key: `(firstSeenAtMs asc, sourcePriority asc, stableRecordId asc)` with frontier-sequence fallback when timestamp is missing.
4. Backpressure controls for queue depth and memory.

### FR-5: Adaptive Concurrency

Add adaptive controller to tune:

1. Global provider-operation concurrency.
2. Scoped (host/domain-derived) provider-operation concurrency.
3. Web crawler fetch concurrency and per-domain crawl budget inputs when crawl operations execute.

Signal inputs:

- p95 latency
- timeout rate
- 4xx/5xx rate
- challenge rate
- queue pressure

### FR-6: Real Search/Fetch and No Placeholder Records

Default provider behavior must return real retrieval outputs:

1. Web/community/social default search and fetch paths must execute real retrieval (browser-native and/or network fetch).
2. Runtime must not fabricate placeholder records in default or production paths (including input-echo content and synthetic `.local` URLs).
3. On retrieval failure, providers must return structured errors (`timeout`, `unavailable`, `upstream`, etc.) instead of fabricated records.
4. Successful records must include provenance metadata identifying retrieval path and provider.

### FR-7: Stronger Community/Social Defaults

Target defaults must include:

1. Read workflows with pagination-aware fetch.
2. Link/thread expansion with bounded depth/budget controls.
3. Multi-hop traversal from seed item to reply/quote/thread graph with deterministic dedupe.
4. Provenance metadata and extraction quality flags for each emitted record.

### FR-8: Prompt-Injection Defense Pipeline

Introduce explicit untrusted-content safeguards:

1. Tag all crawled/remote content as untrusted.
2. Apply injection-pattern scanner before analysis context assembly/prompt construction.
3. Enforce data-only quoting mode for analysis context assembly.
4. Quarantine high-risk segments from instruction channels.

### FR-9: Continuous Fingerprint Tier 2/3

Move Tier 2/3 updates to continuous runtime signal path:

1. Network events feed Tier 2 challenge/rotation continuously.
2. Tier 3 canary evaluation runs on rolling windows continuously.
3. Debug trace remains a readout, not the primary update trigger.

### FR-10: Canary Effectiveness Loop

Add production canary mechanism:

1. Compare profiles/policies on real targets.
2. Promote when scores are stable above threshold.
3. Rollback automatically on failure thresholds.
4. Emit structured promote/rollback audit events.

### FR-11: CDP/Relay Operational Guarantees

Clarify and preserve mode semantics:

1. Direct CDPConnect requires operator-enabled remote debugging endpoint.
2. Relay `/ops` remains default extension path.
3. Relay `/cdp` remains legacy opt-in.
4. Local endpoint restrictions remain default.

---

## 7) Non-Functional Requirements

1. No regression in existing tool/CLI parity coverage.
2. No regression in launch/connect/disconnect stability.
3. Performance improvements must be measurable against current baselines.
4. Security defaults remain strict (`allowNonLocalCdp=false`).
5. Maintain test coverage thresholds (`>=97%`).

---

## 8) Target Architecture (ASCII)

```text
                                         OpenDevBrowser Target Architecture

┌─────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Surfaces                                                                                            │
│  Plugin Tools | CLI/Daemon | Hub | Extension                                                        │
└──────────────────────────────┬───────────────────────────────────────────────────────────────────────┘
                               │
                               v
┌──────────────────────────────────────────── Control Plane ───────────────────────────────────────────┐
│ Session Router                                                                                       │
│  - managed launch                                                                                   │
│  - extension relay (/ops default, /cdp legacy)                                                     │
│  - direct cdpConnect (host/port/ws)                                                                │
│                                                                                                     │
│ Security Gate                                                                                        │
│  - local endpoint enforcement                                                                       │
│  - relay token/origin/rate limits                                                                  │
│  - policy and command allowlists                                                                    │
└──────────────────────────────┬───────────────────────────────────────────────────────────────────────┘
                               │
                               v
┌──────────────────────────────────────────── Data Plane ──────────────────────────────────────────────┐
│ Provider Runtime                                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────────────┐ │
│  │ Tier Router                                                                                     │ │
│  │  Tier A: Browser-native baseline                                                                │ │
│  │  Tier B: Hybrid acceleration (adapter fast-paths)                                               │ │
│  │  Tier C: Restricted-safe mode (policy-tightened workflows)                                      │ │
│  └─────────────────────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                                     │
│ Scheduler                                                                                            │
│  - adaptive concurrency controller                                                                  │
│  - per-domain scheduling                                                                            │
│  - provider/global budgets                                                                          │
│                                                                                                     │
│ Crawl Engine                                                                                         │
│  - frontier queues                                                                                  │
│  - worker-thread pool                                                                               │
│  - incremental extraction + ordered merge                                                           │
│                                                                                                     │
│ Content Security                                                                                     │
│  - untrusted content labeling                                                                       │
│  - prompt-injection scanner + quarantine                                                            │
│  - data-only analysis context builder                                                               │
└──────────────────────────────┬───────────────────────────────────────────────────────────────────────┘
                               │ runtime signals
                               v
┌──────────────────────────────────────── Fingerprint Plane ───────────────────────────────────────────┐
│ Tier 1 Coherence (init checks; warning and policy flags)                                            │
│ Tier 2 Runtime Hardening (continuous challenge scoring/rotation)                                    │
│ Tier 3 Adaptive Hardening (continuous canary promote/rollback/fallback)                             │
└──────────────────────────────┬───────────────────────────────────────────────────────────────────────┘
                               │
                               v
┌────────────────────────────────────── Feedback and Governance ───────────────────────────────────────┐
│ Observability: structured logs, traces, provider/tier metrics                                       │
│ Gates: parity, perf, security, canary effectiveness                                                  │
│ Actions: policy tuning, auto rollback, release readiness                                             │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 9) Component-Level Design

### 9.1 Tier Router

Add runtime tier selection module in provider runtime:

- Inputs: provider capability, health, policy context, challenge pressure, operator overrides.
- Output: selected tier and reason code.
- Behavior: deterministic order `Tier C > Tier B > Tier A` when safety conditions require C.

### 9.2 Adaptive Concurrency Controller

Controller algorithm:

1. Start from configured baseline.
2. Increase concurrency when success and latency windows are healthy.
3. Decrease aggressively on timeout/challenge/error spikes.
4. Respect hard caps and minimum floor.

Recommended policy:

- AIMD (additive increase, multiplicative decrease) with cooldown.
- Separate tracks for global and scoped host/domain limits, with crawl fetch-concurrency overrides applied at operation dispatch.

### 9.3 Worker-Thread Crawl Pipeline

Stages:

1. Frontier scheduling.
2. Bounded async fetch execution on scheduler path.
3. Parse/extract in worker threads.
4. Normalize and dedupe.
5. Emit incremental records and final metrics.

Rules:

- Hard queue limits.
- Domain budget enforcement.
- Deterministic cancel on deadline exhaustion.
- Deterministic output ordering and dedupe keys must be shared across worker and non-worker code paths.

### 9.4 Non-Synthetic Defaults

Default provider behavior:

1. Use real browser-native and/or real fetch workflows for default search/fetch.
2. Never emit fabricated placeholder records on default or production paths.
3. Return structured errors on data unavailability instead of synthetic data.
4. Include provenance metadata per record.

### 9.5 Prompt-Injection Guardrail

Guardrail steps:

1. Mark source trust level.
2. Scan for injection signatures and tool-invocation bait.
3. Strip or quarantine high-risk segments.
4. Keep analysis-context prompt assembly in data-only mode.
5. Log security decision and retained content policy.

Integration points:

1. Execute guardrail after retrieval and before any analysis-context assembly.
2. Ensure both tool and CLI/daemon surfaces use the same guardrail pipeline.

### 9.6 Continuous Fingerprint Signals

Shift update locus:

- From: debug-trace-triggered updates.
- To: continuous network event path with bounded overhead.

Debug trace remains:

- Snapshot/reporting interface for current tier states and histories.

### 9.7 Canary Effectiveness Loop

Canary loop:

1. Collect score windows by target class and profile.
2. Evaluate promote/rollback thresholds.
3. Apply profile/policy changes.
4. Persist decision records with reason and score.

---

## 10) Configuration Additions (Additive)

Proposed additive keys:

- `providers.tiers.default`: `"A" | "B" | "C"` (default `"A"`).
- `providers.tiers.enableHybrid`: boolean.
- `providers.tiers.enableRestrictedSafe`: boolean.
- `providers.adaptiveConcurrency.enabled`: boolean.
- `providers.adaptiveConcurrency.maxGlobal`: number.
- `providers.adaptiveConcurrency.maxPerDomain`: number.
- `providers.crawler.workerThreads`: number.
- `providers.crawler.queueMax`: number.
- `security.promptInjectionGuard.enabled`: boolean.
- `fingerprint.tier2.enabled`: boolean (default `true`).
- `fingerprint.tier2.continuousSignals`: boolean.
- `fingerprint.tier3.enabled`: boolean (default `true`).
- `fingerprint.tier3.continuousSignals`: boolean.
- `canary.targets.enabled`: boolean.

Compatibility requirement:

- All new keys optional and default-safe.
- No default config value may enable placeholder/synthetic runtime outputs.
- No runtime config key may permit fabricated placeholder records on production/default result paths.
- Real-data and no-placeholder invariants are non-disableable runtime guarantees.

---

## 11) Rollout and Compatibility

### 11.1 Phases

1. Dev/internal behind flags.
2. Canary rollout (5 to 10 percent).
3. Beta rollout (25 to 50 percent).
4. GA with one-release opt-out flag retention.

### 11.2 Phase Gates and Rollback Criteria

1. Dev/internal -> Canary gate:
   - Full test suite pass and parity gate pass.
   - Provider realism gate pass (zero placeholder detections).
2. Canary -> Beta gate (minimum 7-day window):
   - Launch success >= 99.5 percent.
   - p95 latency regression <= 10 percent versus baseline protocol in section 13.
   - Tier promote/rollback decision stream is continuous and reason-coded.
   - Zero fabricated placeholder record detections.
3. Beta -> GA gate (minimum 14-day window):
   - Same metrics as Canary -> Beta with no sustained error-budget breach.
   - No security regression on prompt-injection and relay origin/token tests.
4. Automatic rollback triggers (all phases):
   - Any fabricated placeholder record detected on production/default paths.
   - Sustained error-budget breach for 3 consecutive 15-minute windows.
   - Canary effectiveness score below threshold for 2 consecutive rolling windows.

### 11.3 Backward Compatibility

1. Keep existing command/tool names and output shapes.
2. Keep `/ops` as extension default.
3. Keep legacy `/cdp` opt-in behavior.
4. Keep direct CDPConnect semantics unchanged.

---

## 12) Security Model

### 12.1 CDP Endpoint Security

1. Keep local-only endpoint enforcement by default.
2. Keep relay token pairing and origin checks.
3. Keep rate limiting on HTTP and WebSocket paths.

### 12.2 Prompt-Injection Security

1. Treat crawled content as untrusted input.
2. Separate instructions from data at all times.
3. Quarantine suspicious instruction-bearing payloads.

---

## 13) Observability and SLOs

Required metrics:

- Session launch success rate.
- Launch/connect/snapshot p50 and p95.
- Crawl pages/minute and extraction throughput.
- Challenge rate and rotation rate.
- Tier selection distribution and fallback rate.
- Canary promote/rollback counts.
- Relay auth/origin/rate-limit violation counts.

Suggested guardrails:

1. Launch success >= 99.5 percent.
2. p95 latency regression <= 10 percent over baseline.
3. Rollback on sustained error budget breach.

Baseline and benchmark protocol:

1. Use the canonical provider benchmark fixtures (`docs/benchmarks/provider-fixtures.md`) for workload comparability.
2. Run one warmup plus five measured runs per scenario; compare medians.
3. Compare against the latest green `main` baseline artifact generated under the same runtime mode.
4. Keep environment stable during comparison (same Node major, same machine class, same managed/extension mode).

---

## 14) Testing Strategy

### 14.1 Required Test Classes

1. Unit tests for tier router, concurrency controller, and injection guard.
2. Integration tests for worker crawler and continuous fingerprint updates.
3. Relay/CDP mode tests for `/ops`, `/cdp`, and direct CDPConnect.
4. Parity tests for tool/CLI surface consistency.
5. Performance gates for latency and throughput.
6. Security tests for injection and origin/token restrictions.
7. Provider realism tests asserting no placeholder records in production/default paths.

### 14.2 Acceptance Criteria

1. Full test suite passes.
2. Coverage remains >=97 percent.
3. No parity regressions.
4. Worker crawler demonstrates throughput improvement over sequential baseline.
5. Tier B/C transitions observable with deterministic reason codes on required surfaces in section 14.3.
6. Prompt-injection tests show blocked/quarantined malicious patterns.
7. Continuous Tier 2/3 updates visible without debug-trace dependency on required surfaces in section 14.3.
8. Default provider search/fetch outputs contain real retrieved content and valid provenance metadata on required surfaces in section 14.3.
9. No default runtime records contain synthetic placeholder URL patterns or input-echo placeholders.
10. Retrieval failures emit structured errors and zero fabricated records.

### 14.3 Required Observable Surfaces and Fields

1. Tool response surface (additive metadata only):
   - `meta.tier.selected`
   - `meta.tier.reasonCode`
   - `meta.provenance.provider`
   - `meta.provenance.retrievalPath`
   - `meta.provenance.retrievedAt`
2. CLI/daemon JSON surface (additive metadata only):
   - Same `meta.tier.*` and `meta.provenance.*` fields as tool responses.
   - Structured retrieval error code (`timeout`, `unavailable`, `upstream`, `not_supported`) when retrieval fails.
3. Structured log/audit surface:
   - Tier transition event with reason code and previous/next tier.
   - Canary promote/rollback event with target class, score window, and threshold comparison.
   - Provider realism violation event on any placeholder detection (must fail gate).

---

## 15) Implementation Work Packages

WP-1 Tier Runtime:

- Implement tier router and tier-state context propagation.

WP-2 Crawler and Concurrency:

- Introduce worker-thread crawler and adaptive concurrency controller.

WP-3 Provider Defaults:

- Replace synthetic defaults with real browser-native/fetch implementations for default search/fetch.
- Remove placeholder record paths from production/default runtime.

WP-4 Security Hardening:

- Add prompt-injection guardrail pipeline for crawl/analysis context assembly.

WP-5 Fingerprint Runtime:

- Move Tier 2/3 to continuous signal path; retain debug trace as reporting.

WP-6 Canary Loop:

- Add target-site effectiveness canary with promote/rollback.

WP-7 Rollout and Gates:

- Add flags, metrics, release gates, and compatibility docs updates.

WP-8 Runtime Surface Wiring:

- Wire provider runtime + guardrail execution through active tool and CLI/daemon paths.
- Ensure FR behavior is reachable through shipped surfaces, not isolated module code.

---

## 16) File Impact Map (Expected)

- `src/providers/index.ts`
- `src/providers/policy.ts`
- `src/providers/types.ts`
- `src/providers/web/crawler.ts`
- `src/providers/web/index.ts`
- `src/providers/community/index.ts`
- `src/providers/social/platform.ts`
- `src/browser/browser-manager.ts`
- `src/browser/fingerprint/tier2-runtime.ts`
- `src/browser/fingerprint/tier3-adaptive.ts`
- `src/browser/fingerprint/canary.ts`
- `src/core/bootstrap.ts`
- `src/core/types.ts`
- `src/config.ts`
- `src/tools/macro_resolve.ts`
- `src/cli/daemon-commands.ts`
- `tests/providers-performance-gate.test.ts`
- `tests/providers-runtime.test.ts`
- `tests/parity-matrix.test.ts`
- `tests/fingerprint-tier2.test.ts`
- `tests/fingerprint-tier3.test.ts`
- `tests/browser-manager.test.ts`
- `docs/ARCHITECTURE.md`
- `docs/CLI.md`
- `README.md`

---

## 17) CDP Operational Note

Direct CDPConnect and relay `/cdp` are distinct:

1. Direct CDPConnect requires an existing browser debug endpoint (`--remote-debugging-port`).
2. Relay `/cdp` is a local authenticated relay channel (legacy mode), not the browser debug port itself.
3. Existing logged-in session reuse is supported through direct CDPConnect when the operator starts Chrome with remote debugging on the desired profile.
