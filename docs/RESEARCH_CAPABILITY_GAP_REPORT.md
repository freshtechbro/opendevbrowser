# OpenDevBrowser Research Capability Gap Report

Status: Draft  
Owner: Core Runtime / Skills  
Last Updated: 2026-02-14

---

## 1) Objective

Document the gap between OpenDevBrowser's current native capabilities and an external benchmark research workflow, then define a low-bloat approach to close that gap with a pluggable architecture.

This report is intentionally broader than a single 30-day workflow. Target state is a general-purpose **agent browser research capability** that can support time-boxed and non-time-boxed research across multiple sources.

---

## 2) Scope

In scope:
- Runtime and macro execute path gaps for research operations.
- Source coverage and orchestration gaps.
- Time-boxed research requirements (`1w`, `30d`, `1y`, custom windows).
- General/unbounded research inference when time bounds are not requested.
- Output and artifact requirements for agent handoff.
- Pluggable architecture to avoid monolithic core bloat.

Out of scope:
- Immediate full implementation in this document.
- Hardcoding one external template workflow into core runtime.

---

## 3) Evidence Snapshot (Validated)

Validated from real runs in this repository:

1. Macro execute path failures:
- `@web.search(...)` -> `Web search retrieval is not configured`
- `@community.search(...)` -> `Community search retrieval is not configured`
- `@media.search(..., "x")` -> `X search retrieval is not configured`

2. Browser-native runs:
- Generic web research run works (`https://news.ycombinator.com` snapshot success).
- Reddit path encountered anti-bot challenge page (`Reddit - Prove your humanity`).
- X search path redirected to auth flow (`Log in to X / X`).

3. Quality gate status for current tree:
- `npm run lint` -> pass
- `npx tsc --noEmit` -> pass
- `npm run build` -> pass
- `npm run test` -> pass

---

## 4) Current vs Target Gap Matrix

| Capability Area | Current State | Gap | Impact | Closure Direction |
|---|---|---|---|---|
| Cross-source orchestration | No native end-to-end aggregator workflow in macro execute path | Missing coordinated Reddit/X/Web research workflow | High | Add pluggable orchestrator that composes provider adapters |
| `web.search` execute | Unconfigured by default runtime in execute path | Missing default retriever wiring | High | Add default web retriever adapter contract + runtime wiring |
| `community.search` execute | Unconfigured by default runtime in execute path | Missing default community retriever wiring | High | Add community adapter chain with structured fallback |
| `x.search` execute | Unconfigured by default runtime in execute path | Missing default social/X retriever wiring | High | Add social adapter chain with auth/session/API fallback policies |
| Time-boxed research | No unified time-window semantics in research execution | Missing date-window abstraction and inference | High | Add `timebox` model + inference policy |
| Hard recency filtering | Not integrated as a research pipeline capability | Missing deterministic date filtering and confidence handling | High | Add recency filter stage with confidence scoring |
| Engagement enrichment | Not integrated as research pipeline primitive | Missing upvote/comment/like/repost enrichment hooks | Medium/High | Add optional enrichment stage per source adapter |
| Ranking and dedupe | Not packaged as cross-source research pipeline | Missing score/rank/dedupe pipeline | Medium/High | Add modular scoring + dedupe stages |
| Output modes + artifacts | No dedicated research report/context emit modes | Missing reusable report/context artifacts | High | Add renderer pack (`compact/json/md/context/path`) |
| Browser-native automation | Present and strong | No gap in primitive browser control | Positive baseline | Keep as core primitive; avoid duplicating logic |
| Anti-bot handling | Runtime reaches challenge pages but no research fallback strategy | Missing challenge-aware policy and fallback routing | High | Add challenge signals -> tiered fallback (session/API/alternate source) |
| Auth-gated source handling | X flow redirects to login without orchestration policy | Missing auth-required routing policy | High | Add auth-aware source policy and session reuse strategy |

---

## 5) Root Causes in Macro Execute Path

Current macro execute shape is correct, but runtime defaults are not provisioned for actual retrieval transports in key research paths.

Observed failure class:
- Resolver succeeds.
- Execute call is made.
- Provider path returns `unavailable` due to missing retrieval backend configuration.

Implication:
- Macro execute currently proves intent translation, not research fulfillment.

Required shift:
- Keep macro interface stable.
- Add retrieval adapter provisioning and fallback policy so execute mode can return real records when upstream is reachable.

---

## 6) Constraints: Anti-Bot and Authentication

### Reddit challenge pages
Problem:
- Browser-native access can hit anti-bot/captcha flows, reducing deterministic unattended collection.

Required controls:
- Challenge detection as first-class runtime signal.
- Retry budget and policy switch per source.
- Fallback routing (alternate endpoint, authenticated session, secondary provider).
- Explicit partial-result semantics when blocked.

### X login redirects
Problem:
- Direct page search route can redirect to login, blocking anonymous collection.

Required controls:
- Auth-required classification for source operations.
- Session-aware execution policy (existing logged-in profile vs unauthenticated run).
- Optional external adapter path when browser path is auth-blocked.

---

## 7) Target Architecture (Pluggable, Low-Bloat)

### Design principles
1. Keep OpenDevBrowser core focused on stable primitives (browser/session/snapshot/action/runtime).
2. Add research behavior through **pluggable adapters and orchestrators**.
3. Avoid source-specific hardcoding in core execution loops.
4. Keep policy and scoring modules composable and optional.

### Proposed modules

1. `ResearchOrchestrator` (new)
- Coordinates multi-source execution.
- Applies timebox policy.
- Handles fallback and partial results.

2. `SourceAdapter` interfaces (new)
- `web`, `community`, `social/x`, plus extensible future sources.
- Capability metadata: auth requirement, anti-bot risk, date confidence, engagement availability.

3. `TimeboxEngine` (new)
- Supports explicit windows: `7d`, `30d`, `365d`, custom range.
- Supports inferred mode:
  - If query indicates recency/time-bounded intent -> infer bounded window.
  - Else default to general/unbounded web research.

4. `ResearchPipeline` stages (new)
- Normalize -> recency filter -> enrich -> score -> rank -> dedupe.
- Stage toggles for cost/latency control.

5. `ResearchRenderer` (new)
- Output modes: `compact`, `json`, `md`, `context`, `path`.
- Persisted artifacts for reuse by downstream agents.

6. `PolicyRouter` extensions (new)
- Challenge and auth-aware route decisions.
- Structured fallback reasons.

---

## 8) Skill Direction and Naming

Recommended skill identity:
- **Primary:** `opendevbrowser-researcher`
- **Display label:** `OpenDevBrowser Researcher Skill`
- **Optional alias:** `Agent Browser Research Skill`

Rationale:
- Generic and extensible.
- Not constrained to one timeframe, one source, or one template behavior.
- Aligns with pluggable architecture and long-term reuse.

Skill responsibilities:
- Orchestrate research runs.
- Select and configure timebox behavior.
- Drive source adapters.
- Produce reusable artifacts and context summaries.

---

## 9) Functional Requirements to Close Gap

1. Macro execute fulfillment
- `web.search`, `community.search`, and `social/x.search` must execute real retrieval when upstream is reachable.
- Structured failure only after real retrieval attempt and policy routing.

2. Cross-source workflow
- Single orchestrated run can aggregate multiple sources with source-level provenance.

3. Timebox support
- Explicit windows: `1w`, `30d`, `1y`, custom range.
- Implicit inference:
  - Detect time-bound intent from query semantics.
  - If unclear, default to non-time-boxed general search mode.

4. Recency and date confidence
- Date extraction and confidence scoring (`high|medium|low`).
- Hard filter for verified out-of-window results.

5. Enrichment + ranking pipeline
- Engagement enrichment where available.
- Source-aware weighting.
- Ranking and near-duplicate suppression.

6. Artifact outputs
- Human-readable and machine-readable outputs.
- Context artifact path for downstream agent chaining.

7. Anti-bot/auth resilience
- Challenge/auth detection -> policy fallback.
- Partial-result reporting with explicit reasons.

---

## 10) Non-Functional Guardrails (No Bloat)

1. Separation of concerns
- Core runtime remains primitive-first.
- Research behavior in dedicated pluggable modules.

2. Minimal default path
- No heavy dependencies in baseline execution unless needed.
- Feature flags/config for expensive stages.

3. Determinism and observability
- Structured diagnostics at each stage.
- Stable output contracts and trace metadata.

4. Backward compatibility
- Preserve existing macro and CLI command shapes where feasible.

---

## 11) Phased Implementation Approach

### Phase A: Runtime enablement
- Wire default retrieval adapters for `web/community/social` execute paths.
- Add policy-aware fallback reasons.

### Phase B: Research orchestration
- Add orchestrator + timebox engine + stage pipeline hooks.
- Introduce source aggregation contract.

### Phase C: Output/artifacts
- Add render modes and persisted context/report artifacts.
- Define downstream agent handoff format.

### Phase D: Skill pack
- Create `skills/opendevbrowser-researcher/` with:
  - `SKILL.md`
  - `scripts/` orchestration helpers
  - `assets/` templates
  - optional `references/` patterns

### Phase E: Hardening
- Anti-bot/auth policy tuning.
- Regression tests and performance thresholds.

---

## 12) Acceptance Criteria

- [ ] Macro execute path returns real records for reachable `web/community/social` research calls.
- [ ] Cross-source orchestration run exists and is test-covered.
- [ ] Timebox semantics support explicit and inferred modes.
- [ ] Recency filter, enrichment, ranking, dedupe are stage-configurable and validated.
- [ ] Renderer provides `compact/json/md/context/path` and persists artifacts.
- [ ] Auth/challenge handling is explicit with fallback and partial-result semantics.
- [ ] Full repository quality gate remains green.

---

## 13) Recommended Next Move

Proceed with **Phase A + Phase D skeleton** first:
- Unblock macro execute retrieval in default runtime.
- Create `opendevbrowser-researcher` skill skeleton with explicit non-bloat architecture boundaries.

This gives immediate functional progress while preserving clean architecture.
