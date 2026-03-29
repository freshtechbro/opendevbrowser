# Investigation: Workflow Autonomy and Script Fragility

## Summary

OpenDevBrowser's main workflow fragility is not that shell scripts exist. The deeper problem is that shopping and adjacent workflows hardcode provider tactics inside `src/providers/workflows.ts`, while the script layer still embeds scenario policy, timeout classes, and verdict shaping. The strongest repo-fit fix is a hybrid model: keep runtime policy, safety, resume, normalization, and audit verdicts deterministic in code; move variable shopping tactics into a bounded instruction-driven executor; thin scripts into manifest-driven runners.

## Symptoms

- Shopping runs degrade when provider UI or result shape changes, even when the runtime policy layer is healthy.
- One workflow fix often only moves the breakage to a later hardcoded step.
- Audit and live-matrix scripts still encode real workflow behavior, not just execution harness logic.
- `env_limited` and similar verdicts are partly shaped by script logic rather than by one shared production contract.

## Investigation Log

### Phase 1 - Entry surface ownership
**Hypothesis:** scripts are directly running production workflows and should be removed first.

**Findings:**
- The CLI and tool surfaces are already thin wrappers.
- The real workflow ownership is concentrated in provider workflow code.

**Evidence:**
- `src/cli/commands/shopping.ts:233-267` parses args and forwards one `shopping.run` payload to the daemon.
- `src/tools/shopping_run.ts:15-46` resolves provider runtime and calls `runShoppingWorkflow(...)`.
- `src/tools/workflow-runtime.ts:3-13` only creates the configured provider runtime.
- `src/providers/index.ts:1589-1594` routes suspended workflow intents back into `runResearchWorkflow`, `runShoppingWorkflow`, and `runProductVideoWorkflow`.

**Conclusion:** Eliminated. The main production problem is not the CLI/tool wrapper layer.

### Phase 2 - Runtime policy and fallback ownership
**Hypothesis:** the repo should replace deterministic runtime policy with free-form agent instructions.

**Findings:**
- Runtime policy and fallback semantics are already centralized and heavily tested.
- Those seams are the wrong place to introduce prompt-owned behavior.

**Evidence:**
- `src/providers/runtime-policy.ts:12-113` resolves browser mode, fallback modes, cookie policy, and challenge automation into a single runtime contract.
- `tests/providers-runtime-factory.test.ts:42-180` locks deterministic `createBrowserFallbackPort(...)` behavior such as missing-URL `env_limited`, fallback HTML capture, extension tab reuse, and shopping-specific settle timing.

**Conclusion:** Eliminated. Runtime policy, fallback selection, and transport semantics should stay code-owned.

### Phase 3 - Shopping workflow tactic ownership
**Hypothesis:** the shopping problem is mostly in scripts, not production workflow code.

**Findings:**
- Shopping behavior is currently static inside `runShoppingWorkflow(...)`.
- The workflow executes one search per provider, applies static offer filtering, and ranks with heuristics.
- This is where provider drift and candidate-quality failures accumulate.

**Evidence:**
- `src/providers/workflows.ts:1118-1149` `scoreShoppingOfferIntent(...)` scores matches with token heuristics and accessory penalties.
- `src/providers/workflows.ts:1184-1199` `resolveShoppingProviders(...)` normalizes and validates providers.
- `src/providers/workflows.ts:1229-1301` `extractShoppingOffer(...)` turns normalized records into offers.
- `src/providers/workflows.ts:1304-1331` `rankOffers(...)` sorts with static ranking logic.
- `src/providers/workflows.ts:1410-1449` `isLikelyOfferRecord(...)` filters records with URL/title/retrieval-path heuristics.
- `src/providers/workflows.ts:2017-2064` `runShoppingWorkflow(...)` resolves providers, runs one `runtime.search()` per provider, filters offer-like records, extracts offers, and ranks them.
- `tests/providers-workflows-branches.test.ts:598-738` confirms that default-vs-explicit provider routing and degraded-provider exclusion live inside the workflow layer itself.

**Conclusion:** Confirmed. The current shopping tactic loop is too static for high-variance provider pages.

### Phase 4 - Script layer ownership
**Hypothesis:** scripts are only thin scenario runners and can be ignored.

**Findings:**
- Scripts still own real scenario and verdict logic.
- They are more than wrappers; they classify outcomes, encode provider classes, and set shopping queries and timeout policy.

**Evidence:**
- `scripts/provider-direct-runs.mjs:35-39` defines auth-gated and high-friction shopping sets plus timeout overrides.
- `scripts/provider-direct-runs.mjs:268-304` builds hardcoded shopping cases with fixed queries, providers, challenge args, and cookies.
- `scripts/provider-direct-runs.mjs:406-471` classifies outcomes into `pass`, `env_limited`, or `fail`.
- `scripts/provider-live-matrix.mjs:41-69` duplicates provider class sets and `ENV_LIMITED_CODES`.
- `scripts/provider-live-matrix.mjs:681-695` and `scripts/provider-live-matrix.mjs:1504-1536` shape matrix verdicts and provider-specific timeout handling.
- `scripts/live-regression-matrix.mjs:801-835` computes strict-vs-nonstrict release verdicts from `pass/env_limited/fail` counts.
- `scripts/skill-runtime-audit.mjs:597-669` shells out to `provider-direct-runs.mjs` and `live-regression-direct.mjs`.
- `scripts/skill-runtime-audit.mjs:784-909` derives pack and domain status from those lane verdicts.

**Conclusion:** Confirmed. Script logic should be thinned and centralized, not deleted blindly.

### Phase 5 - Existing instruction substrate
**Hypothesis:** the repo has no suitable typed substrate for bounded instruction-driven workflows.

**Findings:**
- The repo already has resume intent and macro execution patterns that can be extended.

**Evidence:**
- `src/providers/workflows.ts:516-523` attaches `withWorkflowResumeIntent(...)`.
- `src/providers/types.ts:437-521` already defines `SuspendedIntentKind`, `SuspendedIntentSummary`, `ProviderRuntimePolicyInput`, and browser fallback request/response types.
- `src/macros/execute.ts:1-219` shows a compiler/executor/payload-shaping precedent for typed macro execution.
- `src/macros/packs/core.ts:1-170` resolves intent-like macro definitions into normalized provider actions.

**Conclusion:** Eliminated. OpenDevBrowser already has enough substrate to build a bounded workflow executor without inventing a second control plane.

### Phase 6 - Skill-pack framing
**Hypothesis:** skill documentation is already instruction-first and only needs minor edits.

**Findings:**
- The current best-practices pack still advertises script-first runbooks.
- It also already contains a minimal workflow-contract artifact that can become the new contract source.

**Evidence:**
- `skills/opendevbrowser-best-practices/SKILL.md:10-16` explicitly includes `script-first runbooks`.
- `skills/opendevbrowser-best-practices/SKILL.md:33-40` and `skills/opendevbrowser-best-practices/SKILL.md:53-56` direct users to router scripts and printed sequences.
- `skills/opendevbrowser-best-practices/artifacts/provider-workflows.md:1-58` already documents minimal stepwise workflow contracts.

**Conclusion:** Confirmed. The skill pack should be reoriented from script-first execution toward contract-first execution.

## Root Cause

The repo currently mixes three concerns that should be separated:

1. **Invariant workflow policy**  
   Browser mode, cookie policy, challenge automation, degraded-provider exclusion, legal review, and failure taxonomy already live in code and should stay there.

2. **Variable workflow tactics**  
   Shopping currently hardcodes one static tactic loop inside `runShoppingWorkflow(...)`. That makes provider drift expensive because every ambiguity has to become another heuristic branch.

3. **Harness and release governance**  
   The script layer still embeds provider classes, query packs, timeout rules, and verdict shaping. That causes business logic to spread into audit scripts.

The main fix is not "remove scripts." The fix is to move variable tactics into a bounded executor and move script policy into shared manifests/evaluators.

## Eliminated Hypotheses

- **"The CLI/tool wrappers are the main problem."**  
  Eliminated by `src/cli/commands/shopping.ts:233-267`, `src/tools/shopping_run.ts:15-46`, and `src/tools/workflow-runtime.ts:3-13`.

- **"Runtime policy and fallback logic should become prompt-driven."**  
  Eliminated by `src/providers/runtime-policy.ts:12-113` and `tests/providers-runtime-factory.test.ts:42-180`.

- **"Deleting scripts is sufficient."**  
  Eliminated by `src/providers/workflows.ts:2017-2064`; the main shopping tactic loop is still static in production code.

- **"The repo lacks typed workflow/intention substrate."**  
  Eliminated by `src/providers/types.ts:437-521`, `src/providers/workflows.ts:516-523`, and `src/macros/execute.ts:1-219`.

## Option Set

### Option A - Pure instruction-driven agent workflows

Replace most workflow ownership with prompt/instruction execution.

**Pros**
- Maximum flexibility for changing sites.

**Cons**
- Weak replayability.
- Harder to test.
- Risks reintroducing policy drift in prompts.
- Poor fit with the repo's existing deterministic runtime/fallback and audit model.

**Verdict**
- Not recommended.

### Option B - Hybrid compiler/executor/postprocessor

Compile workflow input into a typed plan, run a bounded executor over allowed primitives, then postprocess results deterministically.

**Pros**
- Fits current repo seams.
- Preserves deterministic policy and artifacts.
- Adds tactical autonomy where it matters.
- Reuses existing resume and macro substrate.

**Cons**
- Requires moderate refactor work inside `src/providers`.

**Verdict**
- Recommended production architecture.

### Option C - Manifest-driven thin scripts over current deterministic workflows

Keep production workflows mostly as they are, but move script-owned scenario and verdict rules into manifests and shared evaluators.

**Pros**
- Good cleanup for audit/release lanes.
- Lower migration risk for scripts.

**Cons**
- Does not solve the static shopping tactic loop by itself.

**Verdict**
- Recommended as a companion track, not the main production fix.

## Recommended Architecture

Use **Option B for production workflows** and **Option C for the script layer**.

### What stays deterministic in code

- Runtime policy resolution
- Browser transport forcing and fallback selection
- Cookie and challenge policy
- Provider routing and degraded-provider exclusion
- Legal review gating
- Failure and blocker taxonomy
- Output schemas and artifact layout
- Release/audit verdict rules

### What becomes instruction-driven

- Shopping tactic selection
- Candidate verification order
- Whether additional fetches are needed
- Whether a candidate is accessory drift or likely exact-match drift
- When confidence is high enough to stop
- Selective follow-up logic for research

## Enforcement Model

The executor should be bounded by typed contracts, not giant scripts.

### Required contract pieces

- `WorkflowIntent`
- `WorkflowPlan`
- `WorkflowStep`
- `WorkflowCheckpoint`
- `WorkflowObservation`
- `WorkflowDecision`
- `WorkflowExecutionTrace`

### Enforcement rules

1. The compiler resolves provider set, budgets, browser mode, cookie policy, challenge mode, and success criteria before execution begins.
2. The executor only gets approved primitives such as `runtime.search(...)` and `runtime.fetch(...)`.
3. Every executor action is validated against allowed providers, budgets, and runtime policy.
4. The postprocessor remains authoritative for normalization, ranking, blocker shaping, and artifacts.
5. Every executor decision emits structured trace entries so the run is replayable and testable.

## Migration Order

### Phase 1 - Split current shopping monolith without behavior change
Files:
- `src/providers/workflows.ts`

Goal:
- Isolate provider selection, execution, filtering, extraction, ranking, and meta shaping into internal units.

### Phase 2 - Add typed workflow intent and trace types
Files:
- `src/providers/types.ts`
- possibly `src/providers/workflow-types.ts` if a split is cleaner

Goal:
- Introduce typed workflow plan, budgets, checkpoints, and trace models using the current resume substrate.

### Phase 3 - Introduce bounded shopping executor
Files:
- `src/providers/workflows.ts`
- new `src/providers/workflow-executor.ts`
- new `src/providers/shopping-executor.ts`

Goal:
- Replace the static shopping middle loop with bounded candidate verification over approved primitives.

### Phase 4 - Extend resume support to executor checkpoints
Files:
- `src/providers/workflows.ts`
- `src/providers/types.ts`
- `src/providers/index.ts`

Goal:
- Preserve current challenge/fallback resume behavior while the executor is mid-plan.

### Phase 5 - Thin scripts into manifest-driven runners
Files:
- `scripts/provider-direct-runs.mjs`
- `scripts/provider-live-matrix.mjs`
- `scripts/live-regression-matrix.mjs`
- `scripts/skill-runtime-audit.mjs`
- new shared manifest/evaluator modules under `scripts/` or `src/providers/`

Goal:
- Move provider classes, queries, timeout groups, and verdict rules into shared data/evaluators.

### Phase 6 - Reframe the skill pack
Files:
- `skills/opendevbrowser-best-practices/SKILL.md`
- `skills/opendevbrowser-best-practices/artifacts/provider-workflows.md`

Goal:
- Make the skill contract-first instead of script-first.

### Phase 7 - Apply selectively beyond shopping
Files:
- `src/providers/workflows.ts`
- workflow-specific follow-up modules

Goal:
- Add lighter bounded follow-up logic to research.
- Keep product-video mostly deterministic.

## External Research

The repo-fit recommendation matches how similar tools separate autonomy from deterministic control:

- **Stagehand** explicitly positions `act`, `extract`, `observe`, and `agent` as composable layers where developers choose how much AI to use, and it recommends caching agent-discovered actions into deterministic scripts for repeated runs.  
  Sources: [Stagehand introduction](https://docs.stagehand.dev/), [Stagehand act](https://docs.stagehand.dev/v3/basics/act), [Stagehand observe](https://docs.stagehand.dev/v3/basics/observe), [Stagehand deterministic agent scripts](https://docs.stagehand.dev/v3/best-practices/deterministic-agent)

- **Browser Use** separates a high-level goal from a demonstration/skill recording and runs agents with explicit `max_steps`. That supports bounded autonomy, but it is a worse direct fit than Stagehand because this repo already has stronger typed runtime policy and artifact contracts than Browser Use expects.  
  Sources: [Browser Use skills](https://docs.browser-use.com/customize/skills/basics), [Browser Use agent basics](https://docs.browser-use.com/open-source/customize/agent/basics), [Browser Use available tools](https://docs.browser-use.com/customize/tools/available)

- **Playwright** continues to emphasize deterministic low-level primitives, resilient locators, and user-facing contracts. That is the right model for the invariant layer under any agentic executor.  
  Sources: [Playwright locators](https://playwright.dev/docs/locators), [Playwright best practices](https://playwright.dev/docs/best-practices)

## Final Recommendation

Do not delete scripts first. Do not rewrite the whole workflow stack into prompts.

Instead:

1. keep runtime policy, blockers, normalization, and artifacts deterministic,
2. replace the static shopping tactic loop with a bounded instruction-driven executor,
3. thin scripts into manifest-driven runners and shared evaluators,
4. then generalize the same model selectively to research.

That is the smallest refactor that actually addresses the current failure mode.
