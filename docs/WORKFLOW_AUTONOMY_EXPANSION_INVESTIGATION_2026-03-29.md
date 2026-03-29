# Investigation: Workflow Autonomy Expansion Beyond Shopping

## Summary

OpenDevBrowser should not generalize the shopping autonomy fix across every workflow-like surface. The repo splits cleanly into four layers: first-class production workflow runners, deterministic provider/domain modules, browser-surface skill packs, and audit/governance scripts. The strongest next hybrid target is still `research`; `product-video` should move onto the same shared workflow substrate but stay deterministic; `web`, `community`, `social`, and `YouTube` should remain deterministic domain modules; `data-extraction`, `login`, and `form-testing` should remain browser-surface skill/runbook packs unless they later gain stable typed workflow contracts, resumability, and artifact schemas.

## Scope

- Extend the prior shopping-focused autonomy investigation into other supported workflow categories.
- Distinguish production workflow debt from provider-adapter debt, skill/runbook debt, and script-governance debt.
- Recommend the smallest repo-fit migration order that reduces script brittleness without moving policy, safety, or transport semantics into prompts.

## Symptoms

- Shopping proved that static tactic logic inside production workflows breaks under provider drift.
- Adjacent packs still lean on script routers and printed runbooks even when the real runtime surface is already richer.
- Audit and live-matrix scripts still own scenario classes, timeout buckets, and verdict shaping.
- Several supported capabilities are not equivalent to production workflows, but current pack naming can make them look equivalent.

## Investigation Log

### Phase 1 - Production workflow inventory
**Hypothesis:** all workflow-like capabilities should move toward the same hybrid autonomy model.

**Findings:**
- The repo has only three first-class workflow runners today: `research`, `shopping`, and `product_video`.
- Resume routing in the runtime matches only those three workflow kinds.
- That means the production workflow autonomy question is narrower than the total skill-pack surface.

**Evidence:**
- `src/providers/index.ts:1589-1594` routes suspended intents only to `runResearchWorkflow(...)`, `runShoppingWorkflow(...)`, and `runProductVideoWorkflow(...)`.
- `src/providers/workflows.ts:1864-1955` shows `runResearchWorkflow(...)` selecting sources, timeboxes, follow-up fetches, sanitation, dedupe, ranking, and artifact rendering.
- `src/providers/workflows.ts:2180-2275` shows `runProductVideoWorkflow(...)` resolving a product URL, optionally calling shopping for resolution, then running one detail fetch and deterministic asset extraction.

**Conclusion:** Confirmed. First-class workflow autonomy should be evaluated only across these production runners, not across every browser-facing skill pack.

### Phase 2 - Research is the strongest next hybrid target
**Hypothesis:** research carries the same kind of variable tactic debt that shopping exposed.

**Findings:**
- `runResearchWorkflow(...)` already contains a bounded but real tactic loop.
- It chooses sources, performs per-source search, does selective web follow-up, sanitizes shell/noise records, then enriches, dedupes, ranks, and renders.
- This is the clearest non-shopping place where variable tactics and deterministic postprocessing are mixed together.

**Evidence:**
- `src/providers/workflows.ts:1873-1904` resolves sources, timebox, exclusions, and runs `runtime.search(...)` across resolved sources.
- `src/providers/workflows.ts:1906-1937` performs `fetchResearchWebRecords(...)`, sanitation, failure merging, filtering, enrichment, dedupe, and ranking.
- `skills/opendevbrowser-research/SKILL.md:11-29` still frames research as deterministic/script-first with `run-research.sh`, `render-output.sh`, and `write-artifacts.sh`.
- `skills/opendevbrowser-best-practices/assets/templates/skill-runtime-pack-matrix.json:238-263` maps `opendevbrowser-research` to the first-class `research` CLI/tool surface and a dedicated `research-live` probe.

**Conclusion:** Confirmed. Research is the next repo-fit candidate for the hybrid compiler/executor/postprocessor model.

### Phase 3 - Product-video should reuse the substrate, not become free-form
**Hypothesis:** product-video should become the next autonomous executor after shopping.

**Findings:**
- `runProductVideoWorkflow(...)` is mostly deterministic artifact assembly.
- The only adaptive part is product URL resolution, and it already delegates that to `runShoppingWorkflow(...)` when needed.
- After URL resolution, the workflow is linear and schema-driven.

**Evidence:**
- `src/providers/workflows.ts:2209-2235` resolves `product_name` through `runShoppingWorkflow(...)` only when URL resolution is required.
- `src/providers/workflows.ts:2244-2269` performs one typed `runtime.fetch(...)`, validates the response, and surfaces a canonical provider issue summary on failure.
- `skills/opendevbrowser-product-presentation-asset/SKILL.md:11-57` packages deterministic artifacts and helper scripts around manifest/copy/features/claims output.
- `skills/opendevbrowser-best-practices/assets/templates/skill-runtime-pack-matrix.json:215-235` maps `opendevbrowser-product-presentation-asset` to the `product-video` runner via a fixture probe, not to a broader browser choreography surface.

**Conclusion:** Eliminated as a major autonomy target. Product-video should share typed plans, checkpoints, and traces, but it should remain deterministic.

### Phase 4 - Provider families are deterministic domain modules
**Hypothesis:** adjacent provider families should become autonomy targets too.

**Findings:**
- `web`, `community`, and generic `social` already act like deterministic retrieval/traversal modules.
- They validate inputs, enforce bounded traversal, normalize outputs, and preserve policy/transport behavior.
- This is the wrong layer to move into prompt-owned tactics.

**Evidence:**
- `src/providers/web/index.ts:107-260` implements deterministic search/fetch behavior, URL validation, structured extraction, and normalized metadata projection.
- `src/providers/community/index.ts:207-360` implements bounded traversal, queued expansion via `options.fetch`, skip-on-transient-expansion errors, and normalized records.
- `src/providers/social/platform.ts:265-420` implements bounded traversal, fetch normalization, and policy-gated post transport.
- `src/providers/index.ts:1843-1913` wires default `web` search/fetch behavior through `fetchRuntimeDocumentWithFallback(...)`, preserving runtime fallback semantics in code.

**Conclusion:** Eliminated. These provider families should stay deterministic primitives that workflow executors call.

### Phase 5 - YouTube is a specialized deterministic strategy module
**Hypothesis:** YouTube and similar high-friction adapters should be autonomy targets because they already need more adaptive behavior.

**Findings:**
- YouTube already behaves like a specialized deterministic executor.
- It owns legal review, transcript strategy resolution, attempt-chain shaping, browser fallback hints, and metadata normalization.
- That makes it a domain module, not the next generic autonomy seam.

**Evidence:**
- `src/providers/social/youtube.ts:345-380` builds deterministic search behavior from either an explicit URL or a YouTube search page.
- `src/providers/social/youtube.ts:383-485` resolves transcript mode, browser fallback hints, attempt-chain errors, and structured transcript metadata.
- `src/providers/social/youtube.ts:499-515` hardens the default `YouTube` adapter with preferred fallback modes and bounded traversal defaults.

**Conclusion:** Confirmed. YouTube should remain a deterministic domain module that autonomous workflows call.

### Phase 6 - Browser-surface packs are not first-class workflow runners
**Hypothesis:** data extraction, login, and form-testing should become first-class workflow runners next.

**Findings:**
- The pack matrix maps these packs to browser primitives and fixture probes, not to first-class workflow runners.
- Their skill docs describe browser choreography, quality gates, and runbook steps rather than stable workflow contracts and resumable output schemas.
- There is no repo evidence yet that they need new `workflow.*` runtime kinds.

**Evidence:**
- `skills/opendevbrowser-best-practices/assets/templates/skill-runtime-pack-matrix.json:70-107` maps `opendevbrowser-data-extraction` to `snapshot`, `dom-html`, `dom-text`, `dom-attr`, `scroll`, and `wait`.
- `skills/opendevbrowser-best-practices/assets/templates/skill-runtime-pack-matrix.json:145-213` maps `form-testing` and `login-automation` to browser primitives plus the `login-fixture` probe.
- `skills/opendevbrowser-data-extraction/SKILL.md:11-118` is a browser-surface runbook with schema planning, pagination patterns, and quality gates.
- `skills/opendevbrowser-best-practices/assets/templates/skill-runtime-pack-matrix.json:238-289` contrasts that with `research` and `shopping`, which map directly to first-class workflow CLI/tool surfaces.

**Conclusion:** Eliminated for now. These should remain browser-surface skill/runbook packs unless they later gain typed inputs/outputs, resumability, and stable artifact schemas like `research`, `shopping`, and `product_video`.

### Phase 7 - Governance scripts still own real policy
**Hypothesis:** script removal alone would solve the remaining fragility after shopping.

**Findings:**
- The governance layer still owns provider classes, timeout buckets, optional workflow probes, and verdict shaping.
- `skill-runtime-audit` then derives pack/domain/fix-queue status from that lane output.
- This is a centralization problem, not a reason to delete scripts blindly.

**Evidence:**
- `scripts/provider-live-matrix.mjs:41-84` defines auth-gated and high-friction shopping sets, timeout overrides, and the `ENV_LIMITED_CODES` taxonomy.
- `scripts/provider-live-matrix.mjs:1502-1595` applies provider-specific shopping scenarios and optional `workflow.research.all_sources` / `workflow.product_video.amazon` probes with matrix verdict shaping.
- `scripts/skill-runtime-audit.mjs:225-227` chooses configured-daemon execution specifically for `provider-direct` and `live-regression`.
- `scripts/skill-runtime-audit.mjs:756-930` derives pack status, audit-domain status, and fix-queue ordering from `sharedEvidenceIds`, `probeId`, and lane counts.
- `scripts/skill-runtime-scenarios.mjs:37-157` validates the shared matrix schema and defines the lane inventory consumed by the audit runner.
- `skills/opendevbrowser-best-practices/SKILL.md:11-16` still explicitly advertises `script-first runbooks`.

**Conclusion:** Confirmed. The script layer should be thinned into manifest-driven runners over shared evaluators and lane metadata, not removed outright.

### Phase 8 - External architecture context
**Hypothesis:** broader agent architecture guidance supports the repo-specific boundary between deterministic policy and bounded autonomy.

**Findings:**
- Current official guidance aligns with a bounded hybrid approach, not with replacing all deterministic logic.
- Anthropic recommends sequential/parallel workflows when tasks are predictable and reserving more complex multi-agent patterns for open-ended work; it also recommends single-agent or skill-first designs before escalating complexity.
- OpenAI recommends layered guardrails, structured outputs between nodes, clear guidance/examples, and tool-risk controls so untrusted data does not directly drive tool behavior.

**Evidence:**
- Anthropic, *Building Effective AI Agents*, sequential/parallel guidance: sequential workflows fit predictable fixed subtasks, evaluator loops fit clear criteria, and single-agent plus skills should come before multi-agent complexity (`turn1view0`, pages 17-23).
- OpenAI, *A practical guide to building agents*: layered guardrails, tool-risk classification, and rules-based protections should remain in the system design, not in ad hoc prompts (`turn1view1`, lines 678-725).
- OpenAI, *Safety in building agents*: use structured outputs to constrain data flow, keep untrusted data out of developer messages, and keep approvals/guardrails around tool use (`turn1view2`, lines 618-645).

**Conclusion:** Confirmed. The repo-specific recommendation is consistent with current official agent-building guidance: bounded autonomy over typed steps, deterministic guardrails around tools and policy, and progressive escalation only where tactic variance is real.

## Root Cause

The repo currently mixes four different ownership layers:

1. **First-class production workflows**  
   `research`, `shopping`, and `product_video` own stable workflow contracts, resume kinds, and artifact outputs.

2. **Deterministic provider/domain modules**  
   `web`, `community`, generic `social`, and `YouTube` own traversal, policy, legality, fallback semantics, and normalized record shaping.

3. **Browser-surface skill packs**  
   `data-extraction`, `login`, and `form-testing` package browser procedures and quality gates over low-level tools rather than over first-class workflow contracts.

4. **Audit/governance scripts**  
   `provider-live-matrix`, `provider-direct-runs`, `skill-runtime-scenarios`, and `skill-runtime-audit` still own scenario policy, lane metadata, and verdict shaping.

The shopping problem surfaced because variable tactics lived inside a production runner. The broader repo problem is not "scripts exist"; it is that variable tactics, governance policy, and browser-surface procedures are not yet cleanly separated by layer.

## Eliminated Hypotheses

- **"All workflow-like packs should become autonomous runners."**  
  Eliminated by `skills/opendevbrowser-best-practices/assets/templates/skill-runtime-pack-matrix.json:70-107` and `:145-213`, which map data-extraction, form, and login to browser primitives and fixture probes rather than to workflow runners.

- **"YouTube/social should be autonomy targets too."**  
  Eliminated by `src/providers/social/youtube.ts:345-515` and `src/providers/social/platform.ts:265-420`, which already own specialized deterministic strategy and policy.

- **"Product-video should become the next open-ended executor."**  
  Eliminated by `src/providers/workflows.ts:2209-2269`, where the adaptive part is only URL resolution and the rest is linear artifact assembly.

- **"Removing scripts is the main fix."**  
  Eliminated by `scripts/provider-live-matrix.mjs:41-84`, `:1502-1595`, and `scripts/skill-runtime-audit.mjs:756-930`, which show that scripts still own meaningful governance logic that must be centralized first.

## Recommendations

1. **Keep the production autonomy track focused on first-class workflow runners.**
   - Shopping remains the proving ground.
   - Research is the next hybrid compiler/executor/postprocessor target.
   - Product-video should reuse the same workflow substrate but remain deterministic.

2. **Keep provider families deterministic.**
   - `web`, `community`, generic `social`, and `YouTube` should remain typed domain modules.
   - Autonomous workflows should decide when to call them, not replace their internal policy/transport logic.

3. **Do not promote browser-surface packs yet.**
   - `data-extraction`, `login`, and `form-testing` should stay as skill/runbook surfaces until they justify first-class workflow status with typed inputs/outputs, resumability, and stable artifact schemas.

4. **Thin scripts into manifest-driven runners.**
   - Centralize scenario classes, timeout groups, and verdict evaluation into shared data/evaluator modules.
   - Keep `skill-runtime-scenarios` as the schema inventory source and keep `skill-runtime-audit` deterministic over those shared inputs.

5. **Reframe skills from script-first to contract-first.**
   - Workflow packs should point to production runners and typed contracts.
   - Browser-surface packs should describe bounded procedures and quality gates.
   - Governance packs should document lane inventories, acceptance gates, and audit commands without re-owning production behavior.

## Migration Order

1. **Extract the shared workflow substrate**
   - Files: `src/providers/types.ts`, `src/providers/index.ts`, new shared workflow modules under `src/providers/`
   - Goal: unify plan/checkpoint/trace/resume contracts for first-class workflow runners.

2. **Migrate research to the hybrid model**
   - Files: `src/providers/workflows.ts`, new `src/providers/research-executor.ts`, related tests
   - Goal: move variable source-follow-up tactics into a bounded executor while keeping sanitation, ranking, and rendering deterministic.

3. **Move product-video onto the shared substrate, still deterministic**
   - Files: `src/providers/workflows.ts`, `src/cli/commands/product-video.ts`, `src/tools/product_video_run.ts`
   - Goal: share plan/checkpoint/trace/resume plumbing without turning product-video into a free-form planner.

4. **Centralize script scenario and verdict policy**
   - Files: `scripts/provider-direct-runs.mjs`, `scripts/provider-live-matrix.mjs`, new shared manifest/evaluator modules
   - Goal: make scripts consumers of shared policy instead of owners of shopping classes, timeout groups, and verdict taxonomy.

5. **Thin `skill-runtime-audit` over shared lane metadata**
   - Files: `scripts/skill-runtime-audit.mjs`, `scripts/skill-runtime-scenarios.mjs`, matrix JSON
   - Goal: keep audit/fix-queue logic deterministic while reducing hidden policy drift.

6. **Realign skill packs and matrix docs**
   - Files: `skills/opendevbrowser-best-practices/SKILL.md`, `skills/opendevbrowser-research/SKILL.md`, `skills/opendevbrowser-product-presentation-asset/SKILL.md`, `skills/opendevbrowser-best-practices/assets/templates/skill-runtime-pack-matrix.json`
   - Goal: encode the production boundary clearly: workflow runners, deterministic provider modules, browser-surface packs, and governance packs.

7. **Defer browser-surface runner promotion unless new evidence appears**
   - Files: none immediately
   - Goal: avoid inventing `workflow.data_extraction`, `workflow.login`, or `workflow.form_testing` without a clear product/runtime need.

## Preventive Measures

- Keep `workflow.*` creation gated on three criteria:
  - typed input/output contract,
  - resumability/challenge semantics,
  - stable artifact schema with replay value.
- Keep provider/domain modules responsible for legality, fallback, transport, and normalized record shaping.
- Keep scripts from encoding business logic that production code or shared manifests should own.
- Keep browser-surface skills focused on bounded procedures, quality gates, and evidence capture.

