# Anti-Bot Resilience and Transcript Durability Implementation Spec

Specification for implementing robust, DRY, and compliance-aware transcript retrieval and anti-bot handling across provider workflows.

---

## Overview

### Problem and scope
- Current transcript retrieval for YouTube relies on a single HTML + caption endpoint path.
- Anti-bot handling is primarily classification and alerting, not unified policy execution across all provider adapters.
- We need one shared runtime policy and one shared transcript resolver pattern to avoid provider-level duplication.
- Scope covers `social`, `community`, `shopping`, and `web` retrieval paths, with YouTube as the first concrete resolver implementation.

### Goals
- Increase transcript retrieval success in hostile environments without bloating per-provider logic.
- Normalize anti-bot outcomes into explicit reason codes and actionable runtime signals.
- Add controlled browser-assisted fallback for high-friction flows while preserving deterministic server-side paths.
- Preserve existing runtime boundaries by keeping `ProviderRuntime` browser-agnostic.

### Non-goals
- No promise of universal anti-bot bypass on every provider/site.
- No direct implementation of opaque evasion tricks that violate provider policies.
- No broad refactor of unrelated runtime/CLI surfaces.

### Key decisions
- Centralize anti-bot policy in one shared module and call it from provider runtime paths.
- Implement transcript retrieval as a multi-strategy resolver with ordered fallback.
- Expose browser-assisted fallback through an injected runtime port instead of direct `ProviderRuntime -> BrowserManager` coupling.
- Keep ASR fallback optional and policy-gated to control cost and compliance risk.
- Require explicit legal checklist approval entries for each transcript strategy before rollout.
- Standardize telemetry naming on `reasonCode` (camelCase) and keep contract changes additive.
- Ship in phases with telemetry first, then resolver/fallback, then browser-assisted escalation.

### Proposed Architecture (ASCII)

```text
                                  +---------------------------+
                                  |    CLI / Tools / Skills   |
                                  | research_run, shopping... |
                                  +------------+--------------+
                                               |
                                               v
                         +------------------------------------------+
                         | Core Wiring / ToolDeps / RuntimeInit     |
                         | optional BrowserFallbackPort injection    |
                         +------------------+-----------------------+
                                            |
                                            v
+----------------------------------------------------------------------------------+
|                               ProviderRuntime                                    |
|                               (browser-agnostic)                                |
|                                                                                  |
|  +--------------------+      +-----------------------+      +-----------------+  |
|  | Provider Selector  | ---> | AntiBotPolicyEngine   | ---> | Adapter Execute |  |
|  | tiers/routing      |      | shared cooldown/rate  |      | social/web/...  |  |
|  +--------------------+      | proxy/session hooks    |      +--------+--------+  |
|                               +-----------+-----------+               |           |
|                                           |                           |           |
|                                           v                           v           |
|                               +-----------------------+    +--------------------+ |
|                               | Blocker Classifier    |    | TranscriptResolver | |
|                               | reasonCode/alerts     |    | (ordered strategy) | |
|                               +-----------+-----------+    +----+----+----+-----+ |
|                                           |                     |    |    |       |
|                                           |                     |    |    |       |
|                                   +-------v------+          +---v+ +--v--+ +--v----------------+
|                                   | Meta/Alerts  |          |A:  | |B:    | |C: Optional ASR    |
|                                   | + diagnostics|          |HTML| |yt-dlp| |(policy+legal gate)|
|                                   +-------+------+          |cap | |subs  | |                    |
|                                           |                 +---++ +--+---+ +--------------------+
|                                           |                     |     |
|                                           +-----------+---------+-----+
|                                                       |
|                                               +-------v--------+
|                                               | Normalized      |
|                                               | records/meta    |
|                                               +-------+---------+
+----------------------------------------------------------------------------------+
                                                        |
                                                        v
                                             +-----------------------+
                                             | Artifacts + Rendering |
                                             | compact/json/md/path  |
                                             +-----------------------+

Escalation branch (only when policy allows):

Adapter Execute ----> BrowserAssistedResolver ----> BrowserFallbackPort (optional)
                        (human-like action path)     -> BrowserManager only when available
```

### Success metrics
- Transcript success rate improvement versus baseline in the same environment.
- Reduced generic `transcript_unavailable` failures through explicit reason taxonomy.
- Stable alerting for anti-bot/rate-limited transitions using rolling windows.
- No duplicated anti-bot logic in individual provider adapters.
- No regression in existing tool/CLI parity envelopes and blocker metadata placement.

### Compatibility guardrails
- Keep existing response envelopes stable; add fields only (no breaking renames/removals).
- Keep blocker metadata additive and parity-safe (`meta.blocker` and execute-mode projection).
- Standardize classification keys as `reasonCode` (camelCase).
- Unsupported browser-assisted environments must return explicit `env_limited` codes.

---

## Task 1 — Standardize anti-bot failure taxonomy and telemetry envelope

### Reasoning
Current failures collapse into broad codes and make operations blind. A shared taxonomy is the foundation for reliable fallback and routing decisions.

### What to do
Add explicit anti-bot/transcript reason codes and structured telemetry fields used across all providers.

### How
1. Extend provider error details to support specific reason codes (`ip_blocked`, `token_required`, `challenge_detected`, `rate_limited`, `caption_missing`, `env_limited`, `transcript_unavailable`).
2. Add a shared helper to normalize reason codes from HTTP status, error bodies, and blocker classifier signals.
3. Update blocker metadata output so alerts include `reasonCode`, provider, and retry guidance.
4. Ensure existing `meta.alerts[]` carries normalized `reasonCode` and transition state without breaking current envelope shape.

### Files impacted
- `src/providers/types.ts`
- `src/providers/errors.ts`
- `src/providers/blocker.ts`
- `src/providers/workflows.ts`
- `tests/providers-blocker.test.ts`
- `tests/providers-runtime.test.ts`

### End goal
Failures become machine-actionable and consistently classified across providers.

### Acceptance criteria
- [ ] New reason codes are emitted for anti-bot/transcript failures.
- [ ] Alerts include explicit `reasonCode` fields.
- [ ] Existing tests pass and new branches are covered.
- [ ] Existing parity assertions for blocker metadata placement remain valid.

---

## Task 2 — Introduce shared AntiBotPolicyEngine

### Reasoning
Anti-bot handling is currently distributed and partially implicit. A single policy module prevents duplication and enforces DRY controls.

### What to do
Create a shared anti-bot runtime policy module used by provider runtime before and after adapter execution.

### How
1. Add `anti-bot-policy.ts` with a single policy interface for preflight checks, pacing decisions, cooldowns, and post-result updates.
2. Wire `ProviderRuntime.execute` and/or `invokeProvider` to call policy preflight and postflight hooks.
3. Add config-backed knobs for cooldown window, max retries under challenge, and optional proxy/session hints.
4. Allow policy to emit escalation intent only; policy must not directly invoke browser APIs.
5. Keep default behavior conservative and backward compatible.

### Files impacted
- `src/providers/shared/anti-bot-policy.ts` (new file)
- `src/providers/index.ts`
- `src/config.ts`
- `tests/providers-runtime-internals.test.ts`
- `tests/config.test.ts`

### End goal
All providers share one anti-bot decision engine with minimal adapter-specific logic.

### Acceptance criteria
- [ ] Policy hooks run for every provider operation.
- [ ] Cooldown and pacing behavior is configurable and test-covered.
- [ ] No provider duplicates core anti-bot decision logic.

---

## Task 3 — Build TranscriptResolver abstraction with ordered fallback

### Reasoning
Single-path transcript extraction fails in real-world blocked environments. Ordered fallback improves durability while preserving deterministic behavior.

### What to do
Implement a reusable transcript resolver that supports ordered strategies and structured failure reporting.

### How
1. Create `youtube-resolver.ts` with a strategy pipeline: `native_caption_parse -> ytdlp_subtitle -> optional_asr`.
2. Return a typed result containing transcript text, source strategy, language, and `reasonCode` when unavailable.
3. Make `yt-dlp` strategy optional and controlled by runtime availability, policy, and legal checklist approval.
4. Keep ASR disabled by default; gate by config and legal checklist approval before any rollout.
5. Fail closed when a strategy is enabled in config but not approved in legal checklist metadata.

### Files impacted
- `src/providers/social/youtube-resolver.ts` (new file)
- `src/providers/social/youtube.ts`
- `src/providers/types.ts`
- `tests/providers-youtube.test.ts`
- `tests/providers-youtube-branches.test.ts`

### End goal
YouTube transcript retrieval supports robust fallback with explicit strategy provenance.

### Acceptance criteria
- [ ] Resolver attempts fallback in configured order.
- [ ] Output includes `transcript_strategy` and normalized availability reason codes.
- [ ] Existing YouTube tests pass and new fallback branches are covered.
- [ ] Unapproved strategies are blocked with explicit policy/legal `reasonCode`.

---

## Task 4 — Refactor YouTube adapter to consume TranscriptResolver

### Reasoning
Adapter should orchestrate inputs/outputs while resolver owns retrieval strategy details.

### What to do
Move transcript retrieval internals out of `youtube.ts` into the resolver and keep adapter thin.

### How
1. Replace direct caption parsing and transcript fetch calls with resolver invocation.
2. Preserve existing metadata keys and add new metadata fields (`transcript_strategy`, `reasonCode`, `attempt_chain`).
3. Keep summary/full behavior unchanged unless resolver output requires explicit fallback messaging.
4. Ensure `requireTranscript=true` uses structured `reasonCode` values instead of generic unavailable errors.
5. Keep existing blocker/metadata envelope additive for parity safety.

### Files impacted
- `src/providers/social/youtube.ts`
- `tests/providers-youtube.test.ts`
- `tests/providers-youtube-branches.test.ts`

### End goal
YouTube adapter is concise, DRY, and easier to maintain.

### Acceptance criteria
- [ ] Adapter logic is slimmer and delegates transcript retrieval.
- [ ] `requireTranscript` failures include precise reason code.
- [ ] Branch coverage remains above project threshold.

---

## Task 5 — Add browser-assisted human-interaction fallback contract

### Reasoning
Some sites require human-like interaction or manual checkpoints. This should be an explicit, controlled escalation path without violating current module boundaries.

### What to do
Define and implement a policy-gated browser-assisted resolver contract via an injected runtime port for high-friction retrieval.

### How
1. Add contract types for browser-assisted fallback request/response and policy flags.
2. Add an optional `BrowserFallbackPort` to runtime init/dependencies; keep `ProviderRuntime` browser-agnostic.
3. Add an adapter-level hook that can request browser fallback when anti-bot policy permits escalation.
4. Add one shared runtime-construction helper (DRY) that injects the optional browser fallback port and is reused across all runtime entry points.
5. Wire that helper from tools/core wiring and non-tool runtime callers (daemon commands and macro-resolve execute path), not from provider internals.
6. Support headed/extension mode through the port; reject unsupported environments with explicit `env_limited` `reasonCode`.
7. Ensure this path is opt-in and auditable in metadata.

### Files impacted
- `src/providers/types.ts`
- `src/providers/index.ts`
- `src/providers/runtime-factory.ts` (new file)
- `src/tools/deps.ts`
- `src/tools/workflow-runtime.ts`
- `src/tools/macro_resolve.ts`
- `src/cli/daemon-commands.ts`
- `src/core/bootstrap.ts`
- `src/providers/workflows.ts`
- `tests/providers-workflows-branches.test.ts`
- `tests/providers-runtime-internals.test.ts`

### End goal
Human-like browser fallback exists as a controlled escalation path without replacing deterministic provider retrieval.

### Acceptance criteria
- [ ] Fallback is only invoked when policy permits.
- [ ] Metadata clearly marks browser-assisted path and outcome.
- [ ] Unsupported environments return explicit `env_limited` reason code.
- [ ] `ProviderRuntime` does not directly import or depend on `BrowserManager`.
- [ ] Tools, daemon commands, and macro execute path use the same runtime-construction helper for fallback-port wiring.

---

## Task 6 — Extend observability and operational controls

### Reasoning
Operations need clear live visibility into anti-bot pressure and transcript failure reasons to tune routing and reduce user-facing failures.

### What to do
Expose richer operational telemetry and add operator-facing controls for staged rollout.

### How
1. Extend runtime alerts to include strategy-level transcript failure counts.
2. Add provider health dimensions for anti-bot pressure and transcript durability.
3. Add rollout flags (canary on/off for resolver strategies and browser fallback) with default-safe values.
4. Document operational thresholds and response playbook.

### Files impacted
- `src/providers/workflows.ts`
- `src/providers/index.ts`
- `docs/CLI.md`
- `docs/TROUBLESHOOTING.md`
- `tests/providers-performance-gate.test.ts`

### End goal
Operators can identify and respond to transcript and anti-bot regressions quickly.

### Acceptance criteria
- [ ] Alerts include transcript strategy and `reasonCode` distributions.
- [ ] Canary flags are test-covered and default-safe.
- [ ] Docs reflect operational controls and troubleshooting flow.

---

## Task 7 — Verification and rollout hardening

### Reasoning
Risky reliability work must ship with strong regression coverage and deterministic rollout gates.

### What to do
Add comprehensive tests and staged rollout criteria before default enablement.

### How
1. Add deterministic tests for resolver fallback order and `reasonCode` mapping.
2. Add blocked-env fixtures for `ip_blocked`/`rate_limited` branches.
3. Add parity/compatibility checks to ensure blocker metadata placement and execute-mode envelopes remain additive.
4. Update performance gates to include transcript durability metrics.
5. Define promotion criteria from canary to default.

### Files impacted
- `tests/providers-youtube.test.ts`
- `tests/providers-youtube-branches.test.ts`
- `tests/providers-runtime.test.ts`
- `tests/providers-runtime-internals.test.ts`
- `tests/providers-workflows-branches.test.ts`
- `tests/parity-matrix.test.ts`
- `tests/providers-performance-gate.test.ts`
- `docs/CLI.md`
- `docs/TROUBLESHOOTING.md`

### End goal
Feature ships safely with measurable durability and no regressions.

### Acceptance criteria
- [ ] New tests cover fallback and anti-bot branches.
- [ ] Gates pass with project-wide coverage thresholds.
- [ ] Promotion criteria are documented and enforceable.
- [ ] Parity and blocker-metadata compatibility tests remain green.

---

## File-by-file implementation sequence

1. `src/providers/types.ts` — Add `reasonCode` and fallback contract types used by downstream tasks.
2. `src/providers/errors.ts` + `src/providers/blocker.ts` — Normalize error taxonomy and blocker mapping.
3. `src/providers/shared/anti-bot-policy.ts` (new file) — Implement shared anti-bot policy engine.
4. `src/providers/index.ts` — Integrate policy engine into runtime execution flow.
5. `src/providers/runtime-factory.ts` (new file) + `src/tools/deps.ts` + `src/tools/workflow-runtime.ts` + `src/tools/macro_resolve.ts` + `src/cli/daemon-commands.ts` + `src/core/bootstrap.ts` — Centralize runtime construction and inject optional browser-fallback port across all entry points.
6. `src/providers/social/youtube-resolver.ts` (new file) — Implement strategy pipeline for transcript retrieval.
7. `src/providers/social/youtube.ts` — Delegate transcript retrieval to resolver, enforce legal-gated strategy enablement.
8. `src/providers/workflows.ts` — Extend telemetry/alerts for transcript and anti-bot dimensions.
9. `src/config.ts` — Add policy/fallback config toggles (default-safe).
10. `tests/providers-*.test.ts` + `tests/parity-matrix.test.ts` — Add/adjust branch coverage and compatibility assertions.
11. `docs/CLI.md` + `docs/TROUBLESHOOTING.md` — Document runtime flags, telemetry, legal gates, and support playbook.

---

## Dependencies to add

| Package | Version | Purpose |
|---------|---------|---------|
| `yt-dlp` (system binary) | pinned stable (ops-managed) | Subtitle/transcript fallback strategy when native caption extraction fails; requires startup probe, timeout budget, and stderr-to-`reasonCode` mapping |
| `none (npm)` | n/a | Prefer built-in Node APIs and existing dependencies to avoid bloat |

### Task and subtask dependency mapping

| Task | Depends on | Connected subtasks |
|------|------------|--------------------|
| Task 1 | none | Reason code schema, blocker mapping, telemetry shape |
| Task 2 | Task 1 | Shared policy preflight/postflight, config knobs |
| Task 3 | Task 1 | Resolver strategy interfaces, legal-gated strategy contract |
| Task 4 | Tasks 1, 3 | Adapter delegation and metadata parity |
| Task 5 | Tasks 1, 2 | Escalation contract, runtime port injection, browser fallback gating |
| Task 6 | Tasks 1, 2, 4, 5 | Alert enrichment and rollout controls |
| Task 7 | Tasks 1-6 | Regression matrix, compatibility/parity gates, canary promotion checks |

---

## Version history

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-02-16 | Initial implementation specification with phased tasks and ASCII architecture |
| 1.1 | 2026-02-16 | Added injected browser-fallback port architecture, legal-gated `yt-dlp`/ASR rollout controls, and additive compatibility/parity requirements |
| 1.2 | 2026-02-16 | Expanded fallback-port wiring scope to include daemon/macro runtime constructors via shared runtime factory; standardized strategy field naming on `transcript_strategy` |
