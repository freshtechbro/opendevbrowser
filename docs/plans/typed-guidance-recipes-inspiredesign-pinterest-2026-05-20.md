# Typed Guidance Recipes And Pinterest Inspired Design Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Start with failing tests. Do not convert degraded workflow output into design-ready success.

**Goal:** Fix the Inspired Design Pinterest harvest failure path and introduce a reusable typed next-step guidance recipe architecture across OpenDevBrowser workflows.

**Architecture:** Add a shared `src/guidance/` layer with `GuidanceRouter`, `GuidanceRecipe`, and `GuidanceRenderer`. Workflows emit typed status and evidence context; recipes choose the correct next action; renderers format consistent JSON, CLI, Canvas, daemon, docs, and skill guidance. Pinterest lands as the first browser-native site recipe, not as a default heavyweight provider.

**Tech Stack:** TypeScript, Vitest, OpenDevBrowser provider workflows, Canvas manager, public-surface generated help, bundled skill validators, local workflow artifact validation.

---

## Background
- Investigation source: `docs/investigations/inspiredesign-canvas-guidance-quality-2026-05-20.md` confirms that weak, empty, provider-limited, or off-brief harvests can still emit valid-looking Canvas continuation bundles, while Canvas and handoff guidance expose command names and field errors without schema-derived repair examples.
- Fresh daemon preflight: `npx opendevbrowser status --daemon --output-format json` returned `data.fingerprintCurrent === true` with extension relay connected and handshaken on a Pinterest ideas page. It also reported a native host extension-id mismatch, which is diagnostic but did not block workflow runs.
- Fresh provider-unavailable proof: `npx opendevbrowser inspiredesign harvest --provider social/pinterest --browser-mode extension --use-cookies --cookie-policy required ...` returned success with `No providers available`, `reference_count: 0`, no accepted URLs, and a complete artifact bundle at `.opendevbrowser/deep-plan-verify-pinterest-provider/inspiredesign/5e76be6a-390d-46a1-9c30-0fd2b041aa71`.
- Fresh explicit Pinterest URL proof: `npx opendevbrowser inspiredesign harvest --url https://uk.pinterest.com/ideas/web-design-parallax-scrolling/896364491640/ --browser-mode extension --use-cookies --cookie-policy required ...` returned success with one attempted URL, failed deep capture, zero ranked references, and a complete artifact bundle at `.opendevbrowser/deep-plan-verify-pinterest-url/inspiredesign/1b66a55a-b189-4c35-9dc5-83b95a6954bf`.
- Fresh broad web proof: `npx opendevbrowser inspiredesign harvest --provider web/default --max-references 2 ...` returned success with two accepted URLs, one failed deep capture, one weak ranked reference with score `22`, and the same Canvas continuation guidance despite `primaryConstraint.reasonCode: env_limited`.
- Fresh Canvas proof: `npx opendevbrowser canvas --command canvas.plan.set --params '{}' --timeout-ms 30000 --output-format json` returned `{"success":false,"error":"Missing canvasSessionId","exitCode":2}`, showing the CLI error path still lacks typed repair payloads.
- Inspired Design CLI seam: `src/cli/commands/inspiredesign.ts:252` accepts only `inspiredesign <run|harvest>`, `src/cli/commands/inspiredesign.ts:269` requires harvest to have `--query` or `--url`, and `src/cli/commands/inspiredesign.ts:274` dispatches daemon method `inspiredesign.run`.
- Tool seam: `src/tools/inspiredesign_run.ts:33` exposes `harvest`, `query`, `providers`, `maxReferences`, `visualEvidence`, URLs, browser, cookie, and challenge options; `src/tools/inspiredesign_run.ts:75` enables reference capture for harvest or query.
- Workflow seam: `src/providers/workflows.ts:1878` discovers Inspired Design references, `src/providers/workflows.ts:3971` runs discovery, `src/providers/workflows.ts:4005` fetches each URL, `src/providers/workflows.ts:4023` captures references, and `src/providers/workflows.ts:4061` renders final artifacts.
- Visual evidence seam: `src/inspiredesign/visual-policy.ts:74` decides visual capture policy, `src/inspiredesign/visual-evidence.ts:146` persists metadata-only visual evidence, and `src/inspiredesign/reference-pattern-board.ts:83` owns ranking/scoring constants.
- Handoff seam: `src/providers/workflow-handoff.ts:4` defines `WorkflowSuccessStep` and `WorkflowSuccessHandoff`, while `src/providers/workflow-handoff.ts:20` centralizes workflow handoff creation.
- Provider constraint seam: `src/providers/constraint.ts:17` defines `ProviderNextStepGuidance`, and `src/providers/constraint.ts:354` maps reason codes to provider issue guidance.
- CLI message seam: `src/cli/utils/workflow-message.ts:117` chooses next-step text from `suggestedNextAction`, runnable `suggestedSteps[].command`, step reason, and provider constraint guidance.
- Inspired Design handoff seam: `src/inspiredesign/handoff.ts:57` defines current Canvas continuation command constants, `src/inspiredesign/handoff.ts:270` builds the follow-through summary, and `src/providers/renderer.ts:749` writes the handoff artifacts.
- Canvas guidance seam: `src/canvas/guidance.ts:1` defines `CanvasNextStepGuidance`, `src/canvas/guidance.ts:27` defines current guidance constants, `src/canvas/guidance.ts:90` builds command guidance, and `src/browser/canvas-manager.ts:2327` emits guidance in handshake and command responses.
- Macro and cross-workflow seams: `src/providers/workflow-handoff.ts:351` builds research handoffs, `src/providers/workflow-handoff.ts:358` shopping, `src/providers/workflow-handoff.ts:373` product-video, and `src/providers/workflow-handoff.ts:393` macro resolve.
- Daemon guidance prior art: `src/cli/daemon-mismatch.ts:9` centralizes `daemon_fingerprint_mismatch` guidance with the status command and `data.fingerprintCurrent === true` assertion.
- Public-surface prior art: `src/public-surface/source.ts`, `scripts/generate-public-surface-manifest.mjs`, `src/public-surface/generated-manifest.ts`, `src/public-surface/generated-manifest.json`, `src/cli/help.ts`, and `docs/SURFACE_REFERENCE.md` form the generated help/docs parity path.
- Pinterest provider evidence: `src/providers/social/index.ts:28` defines social platforms without Pinterest, `src/providers/social/index.ts:50` registers the current social providers, and `src/providers/index.ts:3080` registers social providers into the default runtime. There is no registered `social/pinterest` provider.
- Tests to extend: `tests/cli-workflows.test.ts`, `tests/tools-workflows.test.ts`, `tests/providers-inspiredesign-workflow.test.ts`, `tests/inspiredesign-visual-harvest.test.ts`, `tests/providers-inspiredesign-contract.test.ts`, `tests/workflow-handoff.test.ts`, `tests/canvas-manager.test.ts`, `tests/public-surface-manifest.test.ts`, and workflow skill validators.

## Approach
Build a typed guidance system first, then adopt it incrementally at the reproduced failure path. The implementation should not start by registering Pinterest as another normal provider. It should introduce browser-native site recipes as a separate concept that can describe authenticated and public navigation, collection, capture, evidence validation, and repair guidance without bloating the provider registry.

The first production slice must prove these outcomes:
- A requested but unavailable Pinterest lane is blocked or recovery-first, not Canvas-first.
- A zero-reference harvest is not design-ready.
- A failed deep capture or weak ranked-reference harvest is diagnostic or recovery-first.
- A `--provider social/pinterest` query can route to a browser-native recipe-backed discovery lane without registering Pinterest as a normal social provider.
- A valid ready harvest can still continue to Canvas.
- Canvas invalid params and governance blockers include typed repair examples.
- CLI, workflow JSON, handoff files, docs, and skills draw from the same typed recipe source.

Target architecture:

```ts
export type GuidanceSeverity = "info" | "warning" | "blocked" | "fatal";
export type GuidanceReadiness =
  | "ready"
  | "needs_input"
  | "needs_recovery"
  | "blocked"
  | "diagnostic_only";

export interface NextStepGuidance {
  id: string;
  recipeType: GuidanceRecipeType;
  workflow: GuidanceWorkflow;
  severity: GuidanceSeverity;
  readiness: GuidanceReadiness;
  reasonCode: string;
  primaryAction: GuidanceAction;
  commands: GuidanceCommandExample[];
  paramsExamples: GuidanceParamsExample[];
  fieldExamples: GuidanceFieldExample[];
  artifactInputs: GuidanceArtifactInput[];
  validationChecks: GuidanceValidationCheck[];
  fallbackPolicy: GuidanceFallbackPolicy;
  doNotProceedIf: string[];
}
```

The exact names can change during implementation, but the shape must preserve readiness, primary action, typed examples, and blockers as structured data.

Implementation decisions for the first slice:
- `src/providers/workflows.ts` owns the Inspired Design guidance data boundary. Build an `InspiredesignGuidanceSource` after discovery, fetch, capture, visual finalization, reference ranking, and primary-constraint assembly, and before calling `renderInspiredesign` or returning CLI/daemon workflow data.
- `src/providers/renderer.ts` owns artifact serialization of typed guidance into `design-agent-handoff.json`; `src/cli/utils/workflow-message.ts` owns only CLI formatting from already-rendered typed guidance.
- Pinterest recipes are executable for query discovery through a generic browser-native discovery runner. They are not registered in `src/providers/social/index.ts` as a normal provider.
- The first cross-workflow migration after Inspired Design and Canvas should cover one representative non-Inspired Design path, preferably macro executed-blocked or research gated-provider guidance. Do not migrate every workflow in the first implementation wave.
- Canvas pre-session errors need an explicit command-validation envelope before `CanvasSession` exists. Missing identifiers should be converted into typed repair guidance at the command boundary, not only inside post-session Canvas guidance.

## Work Items

## Task 1 - Lock Reproductions Into Failing Tests
Reasoning: The current failures are behavioral, not just documentation gaps. The first step must make provider-unavailable, zero-reference, failed-capture, weak-reference, and generic Canvas error guidance fail in tests.

What to do: Add regression tests and fixtures that encode the fresh workflow proofs from this plan and the investigation report.

How:
1. Add fixtures under `tests/fixtures/guidance/` or existing fixture locations for:
   - `inspiredesign-pinterest-provider-unavailable`
   - `inspiredesign-pinterest-zero-reference`
   - `inspiredesign-pinterest-url-failed-capture`
   - `inspiredesign-web-weak-reference`
   - `canvas-plan-set-missing-session`
2. In `tests/providers-inspiredesign-workflow.test.ts`, assert that a provider-unavailable `social/pinterest` harvest returns a non-ready guidance state and does not make Canvas continuation the primary next action.
3. In `tests/inspiredesign-visual-harvest.test.ts`, assert that failed screenshot, missing screenshot artifact, cookie-banner, search-shell, 404, and off-brief captures cannot become high-confidence ranked references.
4. In `tests/providers-inspiredesign-contract.test.ts`, assert that `rankedReferences.length === 0` or a weak ranking produces diagnostic/recovery guidance, not a Canvas-ready contract.
5. In `tests/workflow-handoff.test.ts`, assert that Inspired Design handoff output includes typed `readiness`, `reasonCode`, `primaryAction`, `doNotProceedIf`, command examples, and params examples.
6. In `tests/canvas-manager.test.ts`, assert `canvas.plan.set` missing session, missing lease, missing document, and invalid `generationPlan` responses include repair examples and not only terse errors.
7. In `tests/cli-workflows.test.ts` and `tests/tools-workflows.test.ts`, assert misuse and provider-unavailable paths include valid example commands.

Files impacted:
- `tests/providers-inspiredesign-workflow.test.ts`
- `tests/inspiredesign-visual-harvest.test.ts`
- `tests/providers-inspiredesign-contract.test.ts`
- `tests/workflow-handoff.test.ts`
- `tests/canvas-manager.test.ts`
- `tests/cli-workflows.test.ts`
- `tests/tools-workflows.test.ts`
- New fixtures under `tests/fixtures/guidance/` if no existing fixture home fits.

End goal: Current behavior fails for the exact reasons observed in real workflow runs.

Acceptance criteria:
- Tests fail before implementation because Canvas continuation is still primary or typed examples are missing.
- Tests encode all fresh artifact paths as comments or fixture provenance, not as hard runtime dependencies.
- Tests avoid network access and use deterministic fixtures or mocked provider runtime responses.

Dependencies: None.

Size: Medium.

## Task 2 - Add The Shared Guidance Core
Reasoning: Guidance is currently split across provider constraints, workflow handoffs, Inspired Design handoffs, Canvas guidance, CLI message formatting, and daemon mismatch helpers. A shared core is needed before wiring surfaces.

What to do: Create a focused `src/guidance/` module with typed contracts, readiness classification, recipe dispatch, and renderers.

How:
1. Create `src/guidance/types.ts` with:
   - `GuidanceWorkflow`
   - `GuidanceRecipeType`
   - `GuidanceSeverity`
   - `GuidanceReadiness`
   - `GuidanceContext`
   - `GuidanceRecipe`
   - `NextStepGuidance`
   - `GuidanceAction`
   - `GuidanceCommandExample`
   - `GuidanceParamsExample`
   - `GuidanceFieldExample`
   - `GuidanceArtifactInput`
   - `GuidanceValidationCheck`
   - `GuidanceFallbackPolicy`
2. Create `src/guidance/readiness.ts` with pure helpers such as `classifyGuidanceReadiness(context)`.
3. Create `src/guidance/router.ts` with deterministic recipe selection. Prefer explicit recipe priority over implicit array order if more than one recipe can match.
4. Create `src/guidance/renderers.ts` with renderers for:
   - workflow JSON
   - CLI completion text
   - Canvas guidance compatibility output
   - provider constraint compatibility output
   - daemon readiness text
5. Create `src/guidance/recipes/generic.ts` for fallback workflow entry, schema repair, evidence recovery, artifact handoff, and quality gate recipes.
6. Create `src/guidance/index.ts` for stable exports.
7. Add `tests/guidance-router.test.ts`, `tests/guidance-readiness.test.ts`, and `tests/guidance-renderers.test.ts`.

Files impacted:
- New `src/guidance/types.ts`
- New `src/guidance/readiness.ts`
- New `src/guidance/router.ts`
- New `src/guidance/renderers.ts`
- New `src/guidance/recipes/generic.ts`
- New `src/guidance/index.ts`
- New `tests/guidance-router.test.ts`
- New `tests/guidance-readiness.test.ts`
- New `tests/guidance-renderers.test.ts`

End goal: Every workflow can ask one typed service for next-step guidance.

Acceptance criteria:
- No `any`, `ts-ignore`, or broad `unknown` escapes are introduced.
- Readiness classification is pure and has deterministic tests for `ready`, `needs_input`, `needs_recovery`, `blocked`, and `diagnostic_only`.
- Renderers do not decide readiness. They only format typed guidance.
- Existing callers can still receive compatibility fields such as `followthroughSummary`, `suggestedNextAction`, `suggestedSteps`, and provider `recommendedNextCommands`.

Dependencies: Task 1.

Size: Large.

## Task 3 - Normalize Workflow Evidence Into Guidance Context
Reasoning: The router is only useful if workflows can pass it normalized evidence. Today Inspired Design, provider constraints, Canvas, and daemon readiness each use different shapes.

What to do: Add adapters that convert current workflow state into `GuidanceContext` without forcing broad rewrites of provider workflow internals.

How:
1. Create `src/guidance/context.ts` with builders such as:
   - `createInspiredesignGuidanceContext(...)`
   - `createProviderWorkflowGuidanceContext(...)`
   - `createCanvasGuidanceContext(...)`
   - `createDaemonGuidanceContext(...)`
   - `createCliValidationGuidanceContext(...)`
2. Create an `InspiredesignGuidanceSource` type that is assembled once in `src/providers/workflows.ts` after:
   - `discoverInspiredesignReferences(...)`
   - URL merge
   - fetch normalization
   - `captureInspiredesignReference(...)`
   - visual evidence finalization
   - `buildInspiredesignPacket(...)`
   - primary constraint summary assembly
3. In the Inspired Design adapter, map:
   - requested providers from `meta.discovery.providers`
   - discovery failure from `meta.discovery.failure`
   - accepted URLs from `meta.discovery.acceptedUrls`
   - `meta.metrics.reference_count`
   - failed capture counts
   - ranked reference count
   - minimum ranked reference score and confidence
   - visual evidence warnings
   - `primaryConstraint.reasonCode`
4. Make `src/providers/workflows.ts` the compatibility owner for Inspired Design workflow responses. It should add `nextStepGuidance` and preserve legacy `suggestedNextAction`, `suggestedSteps`, and `meta.followthroughSummary` via renderer output.
5. Make `src/providers/renderer.ts` the artifact owner for writing guidance into `design-agent-handoff.json`.
6. In provider workflow adapters, map existing `ProviderIssueSummary` from `src/providers/constraint.ts`.
7. In Canvas adapter, map missing session, missing lease, missing document, invalid plan, missing governance blocks, and typed issues from `src/canvas/document-store.ts`.
8. In daemon adapter, map `daemon_fingerprint_mismatch` from `src/cli/daemon-mismatch.ts` and the `data.fingerprintCurrent === true` assertion.
9. Unit test each adapter with source-shaped fixtures rather than hand-rolled simplified objects where practical.

Files impacted:
- New `src/guidance/context.ts`
- `src/providers/constraint.ts`
- `src/canvas/guidance.ts`
- `src/cli/daemon-mismatch.ts`
- New or updated `tests/guidance-context.test.ts`

End goal: Existing source-shaped data becomes one stable guidance input.

Acceptance criteria:
- Inspired Design provider-unavailable fixture maps to `readiness: "blocked"` or `needs_recovery`.
- Failed deep capture and weak-ranked-reference fixtures map to non-ready.
- Valid ready evidence fixture maps to `readiness: "ready"`.
- The implementation has one explicit Inspired Design guidance data boundary. No renderer or CLI formatter recomputes readiness independently.
- Canvas missing field and invalid issue fixtures preserve schema paths, expected values, received values, and repairable field names.
- Daemon mismatch context preserves the exact status command and `fingerprintCurrent` validation check.

Dependencies: Task 2.

Size: Large.

## Task 4 - Implement Browser-Native Site Recipes And Discovery Runner
Reasoning: The user explicitly wants agents to learn how to navigate sites without adding endless provider adapters. Pinterest should prove the browser-native recipe lane, and `--provider social/pinterest` should no longer be a dead provider id.

What to do: Add typed site recipes that describe navigation, authentication, collection, capture, bad-state detection, recovery, and validation. Add a generic browser-native discovery runner that can execute recipe-defined discovery steps and return normalized discovery records for Inspired Design.

How:
1. Create `src/guidance/recipes/site-recipe-types.ts` or include these types in `src/guidance/types.ts`:
   - `SiteRecipe`
   - `SiteRecipeAuthMode`
   - `SiteRecipeNavigationStep`
   - `SiteRecipeBadState`
   - `SiteRecipeEvidenceRequirement`
   - `SiteRecipeRecoveryStep`
2. Create a small recipe registry, for example `src/guidance/recipes/site-registry.ts`, that resolves provider ids and hostnames to site recipes.
3. Create a browser-native discovery runner near the provider workflow boundary, for example `src/providers/browser-native-discovery.ts`.
4. Make the runner return the same normalized shape consumed by `normalizeInspiredesignDiscoveryRecords(...)`, or an adapter that converts recipe output to that shape.
5. Hook the runner into `discoverInspiredesignReferences(...)` in `src/providers/workflows.ts` before or alongside `runtime.search(...)`. If a requested provider id maps to a site recipe, use the recipe runner instead of treating it as an unknown normal provider.
6. Create `src/guidance/recipes/pinterest.ts`.
7. Match Pinterest contexts by requested provider id `social/pinterest`, hostname `pinterest.com`, `uk.pinterest.com`, or future site recipe id.
8. Encode authenticated flow guidance:
   - require extension or authenticated managed profile when cookies are required
   - open Pinterest
   - verify logged-in state
   - use the Pinterest search bar naturally
   - search the brief query
   - scroll to collect visual variety
   - prefer pins, boards, and idea pages that contain actual visual grids
   - reject login, challenge, empty grid, search shell, and unrelated page states
9. Encode public flow guidance:
   - allow explicit Pinterest URLs
   - capture page state
   - detect if public page becomes protected
   - recover by requesting authenticated session or explicit usable URLs
10. Add tests that ensure Pinterest recipe discovery does not silently fall back to unrelated web providers.
11. Keep the runner bounded: it should produce candidate URLs and evidence diagnostics, not scrape private content or bypass authentication/challenges.

Files impacted:
- New `src/guidance/recipes/site-recipe-types.ts` or `src/guidance/types.ts`
- New `src/guidance/recipes/site-registry.ts`
- New `src/guidance/recipes/pinterest.ts`
- New `src/providers/browser-native-discovery.ts`
- `src/providers/workflows.ts`
- `src/inspiredesign/reference-discovery.ts`
- `src/guidance/router.ts`
- New `tests/pinterest-guidance-recipe.test.ts`
- `tests/providers-inspiredesign-workflow.test.ts`

End goal: Pinterest-specific instructions exist as typed recipe data, and query harvest can use a generic browser-native discovery lane without registering Pinterest as a normal social provider.

Acceptance criteria:
- Requested Pinterest provider maps to the Pinterest site recipe.
- If the authenticated browser session is available, the runner attempts Pinterest-native query discovery and returns candidate URLs or typed diagnostics.
- If the authenticated browser session is unavailable, guidance renders Pinterest recipe recovery action, not generic web fallback.
- Explicit Pinterest URL failed capture renders session-state and capture-retry guidance.
- Public Pinterest URL protected by login renders auth-required guidance.
- The recipe includes commands, params examples, artifact inputs, validation checks, fallback policy, and blockers.
- The implementation does not add Pinterest to `src/providers/social/index.ts` as a full social provider.

Dependencies: Tasks 2 and 3.

Size: Large.

## Task 5 - Add Minimal Evidence Quality Signals And Readiness Gates To Inspired Design
Reasoning: The reproduced failure path is in Inspired Design. This is the first integration point and must block Canvas-first guidance for non-ready evidence.

What to do: Add the minimum evidence-quality signals needed by readiness gates, then route Inspired Design completion and artifact handoff through the typed guidance system.

How:
1. In `src/inspiredesign/reference-pattern-board.ts`, expose a compact quality summary for the final board:
   - ranked count
   - rejected count
   - top score and confidence
   - failed capture count
   - missing screenshot count
   - diagnostic-only reasons
2. In `src/providers/workflows.ts`, after discovery/capture/ranking and before final response assembly, build `InspiredesignGuidanceSource`.
3. Convert `InspiredesignGuidanceSource` to `GuidanceContext`.
4. In `src/providers/renderer.ts`, pass guidance into `renderInspiredesign` so artifact files include typed guidance metadata.
5. In `src/inspiredesign/handoff.ts`, replace hard-coded "continue in Canvas" primary guidance with a renderer-compatible handoff generated from `NextStepGuidance`.
6. Preserve existing artifact filenames and existing fields where external compatibility requires them.
7. Add a new `nextStepGuidance` field to `design-agent-handoff.json`.
8. Ensure `suggestedNextAction` and `suggestedSteps` are derived from the same typed guidance, not independent prose.
9. Ensure the ready state still includes:
   - `canvas.session.open`
   - `canvas.plan.set`
   - governance patch examples
   - validation checks
10. Ensure blocked or recovery states make evidence recovery primary and Canvas secondary or absent.

Files impacted:
- `src/providers/workflows.ts`
- `src/providers/renderer.ts`
- `src/inspiredesign/handoff.ts`
- `src/inspiredesign/contract.ts`
- `src/inspiredesign/reference-pattern-board.ts`
- `tests/providers-inspiredesign-workflow.test.ts`
- `tests/providers-inspiredesign-contract.test.ts`
- `tests/workflow-handoff.test.ts`

End goal: Inspired Design output distinguishes artifact completion from design readiness.

Acceptance criteria:
- Provider-unavailable Pinterest harvest reports non-ready guidance and does not recommend Canvas as primary.
- Explicit Pinterest URL failed capture reports capture/session recovery first.
- Weak web/default harvest reports needs-recovery guidance even when one weak ranked reference exists.
- Ready fixture still produces Canvas continuation as primary.
- `design-agent-handoff.json` includes typed guidance with readiness, reason code, and examples.

Dependencies: Tasks 3 and 4.

Size: Large.

## Task 6 - Harden Reference Scoring And Weak Evidence Detection
Reasoning: Guidance gates need reliable evidence quality signals. Screenshot presence or a fetched page cannot be treated as usable creative direction.

What to do: Strengthen `reference-pattern-board` scoring and weak-evidence classification so bad pages remain diagnostic.

How:
1. In `src/inspiredesign/reference-pattern-board.ts`, add explicit weak or rejection signals for:
   - zero ranked references
   - failed deep capture
   - missing finalized screenshot artifact
   - cookie banners and consent modals
   - login and challenge states
   - 404 or unavailable pages
   - marketplace/search/listing chrome
   - template filter chrome
   - off-brief content
   - source/provider mismatch
2. Keep rejected references in diagnostic artifacts with clear reasons.
3. Do not let diagnostic rejection copy leak into `meta-prompt.md` as creative direction.
4. Feed final rank quality into `GuidanceContext` so `weak-reference` is not inferred only from count.
5. Add tests for the prior Etsy 404, Envato cookie-consent, Pinterest shell, and Lovable weak-reference patterns using fixtures or synthesized evidence.

Files impacted:
- `src/inspiredesign/reference-pattern-board.ts`
- `src/inspiredesign/meta-prompt.ts`
- `src/inspiredesign/contract.ts`
- `tests/inspiredesign-visual-harvest.test.ts`
- `tests/providers-inspiredesign-contract.test.ts`
- `tests/providers-inspiredesign-workflow.test.ts`

End goal: The harvest can record bad evidence without turning it into design direction.

Acceptance criteria:
- 404, cookie-consent, login/challenge, marketplace chrome, and search shell captures are rejected or heavily downgraded.
- Weak evidence produces `readiness: "needs_recovery"` or `diagnostic_only`.
- `meta-prompt.md` says missing or weak evidence clearly instead of inventing a dominant visual direction from blocked UI.
- Existing valid reference tests still pass.

Dependencies: Task 5.

Size: Medium.

## Task 7 - Add Canvas Schema-Derived Repair Examples
Reasoning: Canvas already has typed issue data, but agents see generic errors such as missing `canvasSessionId` or missing fields without valid repair payloads.

What to do: Add a Canvas repair example builder and route Canvas command guidance through typed recipes.

How:
1. Create `src/canvas/repair-examples.ts`.
2. Use existing schema constants and issue structures from `src/canvas/document-store.ts` and `src/canvas/types.ts`.
3. Add a pre-session command validation envelope near the Canvas command boundary in `src/browser/canvas-manager.ts`, before or around the existing `requireString(...)` calls. This envelope should convert missing identifier errors into typed guidance instead of throwing only terse strings.
4. Generate examples for:
   - missing `canvasSessionId`
   - missing `leaseId`
   - missing `documentId`
   - missing or invalid `generationPlan`
   - missing governance blocks, starting with `intent`
5. In `src/canvas/guidance.ts`, extend `CanvasNextStepGuidance` compatibility output with:
   - `nextStepGuidance`
   - `paramsExamples`
   - `fieldExamples`
   - `validationChecks`
   - `doNotProceedIf`
6. In `src/browser/canvas-manager.ts`, attach repair examples to invalid plan and missing context responses.
7. Preserve existing `missingFields`, `issues`, and command arrays for compatibility until callers are migrated.
8. Add tests that validate generated examples against the same schema or validator used by Canvas runtime.

Files impacted:
- New `src/canvas/repair-examples.ts`
- `src/canvas/guidance.ts`
- `src/browser/canvas-manager.ts`
- `src/canvas/document-store.ts`
- `src/canvas/types.ts`
- `tests/canvas-manager.test.ts`

End goal: Canvas errors become copy-paste repair instructions with typed examples.

Acceptance criteria:
- `canvas.plan.set --params '{}'` no longer returns only `Missing canvasSessionId`; it includes a valid params-file example.
- `generation_plan_invalid` includes an example valid generation plan and issue-specific repair hints.
- Missing `intent` guidance includes a concrete `canvas.document.patch` example.
- Pre-session identifier failures and post-session validation failures use the same typed repair envelope.
- Tests prove examples remain schema-valid.

Dependencies: Task 2 and Task 3.

Size: Large.

## Task 8 - Route Cross-Workflow Guidance Through The Shared Layer
Reasoning: The problem is not limited to Inspired Design. Research, shopping, product-video, macro execution, CLI completion messages, provider constraints, and daemon readiness already have scattered guidance.

What to do: Replace duplicated or parallel guidance assembly for shared compatibility seams and one non-Inspired Design representative workflow while preserving public response compatibility. Defer full migration of every workflow to a follow-up after the first proof lands.

How:
1. In `src/providers/workflow-handoff.ts`, keep the public `WorkflowSuccessHandoff` shape but produce it from `NextStepGuidance`.
2. In `src/providers/constraint.ts`, map `ProviderNextStepGuidance` from guidance recipes for provider blockers while preserving `reason` and `recommendedNextCommands`.
3. In `src/cli/utils/workflow-message.ts`, render CLI completion messages from typed guidance priority instead of independently scanning multiple fields.
4. Migrate one representative non-Inspired Design workflow path. Prefer macro executed-blocked if it has compact fixtures, otherwise research gated-provider guidance.
5. In `src/cli/daemon-mismatch.ts`, either wrap existing constants in a daemon recipe or expose a `daemon.fingerprint_mismatch` recipe that renders the same command and assertion.
6. Add compatibility tests to ensure existing fields still exist while new typed guidance is present.
7. Add explicit follow-up notes in docs for remaining shopping and product-video migration if they are not migrated in this slice.

Files impacted:
- `src/providers/workflow-handoff.ts`
- `src/providers/constraint.ts`
- `src/cli/utils/workflow-message.ts`
- `src/providers/workflows.ts`
- `src/cli/daemon-commands.ts`
- `src/cli/daemon-mismatch.ts`
- `tests/workflow-handoff.test.ts`
- `tests/providers-runtime-coverage.test.ts`
- `tests/cli-workflows.test.ts`
- `tests/daemon-commands.integration.test.ts`

End goal: Cross-workflow next-step guidance is typed, DRY, and rendered consistently.

Acceptance criteria:
- Existing top-level fields stay available for current consumers.
- New `nextStepGuidance` is present on migrated workflow responses.
- CLI completion messages choose the same primary action as workflow JSON.
- Daemon fingerprint mismatch still uses the exact status command and `data.fingerprintCurrent === true` check.
- One non-Inspired Design workflow path proves cross-workflow reuse in this slice.
- Remaining workflow migrations are documented as staged follow-up work, not silently left inconsistent.

Dependencies: Tasks 2, 3, 5, and 7.

Size: Large.

## Task 9 - Update Public Surface, Docs, And Skills From The Recipe Source
Reasoning: Agents struggled partly because examples were absent or drifted across help, docs, and skills. The same recipes should feed generated examples wherever practical.

What to do: Update the public first-contact surface and bundled skills to explain typed guidance recipes, browser-native site recipes, readiness states, and Canvas repair examples.

How:
1. Update `src/public-surface/source.ts` with any new help notes and examples that are part of the public CLI surface.
2. Run `node scripts/generate-public-surface-manifest.mjs`.
3. Update generated files:
   - `src/public-surface/generated-manifest.ts`
   - `src/public-surface/generated-manifest.json`
4. Update `src/cli/help.ts` only where runtime help consumes source-owned examples or imported guidance constants.
5. Update docs:
   - `docs/CLI.md`
   - `docs/SURFACE_REFERENCE.md`
   - `docs/ARCHITECTURE.md`
   - `docs/DESIGN_CANVAS_TECHNICAL_SPEC.md`
   - any relevant troubleshooting or workflow docs if guidance behavior changes there.
6. Update bundled skills:
   - `skills/opendevbrowser-best-practices/SKILL.md`
   - `skills/opendevbrowser-best-practices/scripts/odb-workflow.sh`
   - `skills/opendevbrowser-design-agent/SKILL.md`
   - `skills/opendevbrowser-design-agent/artifacts/research-harvest-workflow.md`
   - `skills/opendevbrowser-motion-design/SKILL.md` if motion handoff wording changes.
7. For the first slice, keep docs and skill updates manual but validate them against recipe fixtures. Do not add a new docs-generation system unless an existing public-surface generation path can be reused safely.
8. Add a small fixture or snapshot test that compares the recipe example command and params example used in docs/skills against the runtime recipe output.

Files impacted:
- `src/public-surface/source.ts`
- `src/public-surface/generated-manifest.ts`
- `src/public-surface/generated-manifest.json`
- `src/cli/help.ts`
- `docs/CLI.md`
- `docs/SURFACE_REFERENCE.md`
- `docs/ARCHITECTURE.md`
- `docs/DESIGN_CANVAS_TECHNICAL_SPEC.md`
- `skills/opendevbrowser-best-practices/**`
- `skills/opendevbrowser-design-agent/**`
- `skills/opendevbrowser-motion-design/**`

End goal: Runtime guidance, docs, and skills stop drifting.

Acceptance criteria:
- Help shows correct canonical `opendevbrowser inspiredesign harvest` examples.
- Docs state that Pinterest is a browser-native site recipe, not a default full provider.
- Docs describe readiness states and when Canvas continuation is blocked.
- Skills teach agents to inspect `nextStepGuidance`, `readiness`, `doNotProceedIf`, and typed examples before continuing.
- Docs and skill examples are validated against recipe fixture output or public-surface generated metadata.
- Skill validators pass.

Dependencies: Tasks 5, 7, and 8.

Size: Medium.

## Task 10 - Run Live Verification And Remove Obsolete Guidance Duplication
Reasoning: The issue was discovered through live workflow behavior, so the final proof must include real workflow runs and cleanup of stale hard-coded guidance.

What to do: Rerun the real workflows, verify output semantics, and remove obsolete duplicate guidance strings that are no longer used.

How:
1. Run daemon preflight:
   ```bash
   npx opendevbrowser status --daemon --output-format json
   ```
   Expected: `data.fingerprintCurrent === true`.
2. Rerun provider-unavailable Pinterest:
   ```bash
   npx opendevbrowser inspiredesign harvest --brief "Premium digital photography studio landing page" --query "Pinterest premium digital photography studio landing page cinematic parallax portfolio" --provider social/pinterest --max-references 2 --visual-evidence required --browser-mode extension --use-cookies --cookie-policy required --challenge-automation-mode browser_with_helper --mode json --output-format json
   ```
   Expected: non-ready `nextStepGuidance`, Pinterest/browser-native recovery primary, no Canvas primary action.
3. Rerun explicit Pinterest URL harvest:
   ```bash
   npx opendevbrowser inspiredesign harvest --brief "Premium digital photography studio landing page" --url "https://uk.pinterest.com/ideas/web-design-parallax-scrolling/896364491640/" --max-references 1 --visual-evidence required --browser-mode extension --use-cookies --cookie-policy required --challenge-automation-mode browser_with_helper --mode json --output-format json
   ```
   Expected: ready only if capture succeeds and references rank usable; otherwise capture/session recovery primary.
4. Rerun broad web/default harvest:
   ```bash
   npx opendevbrowser inspiredesign harvest --brief "Premium digital photography studio landing page" --query "premium digital photography studio landing page cinematic parallax portfolio" --provider web/default --max-references 2 --visual-evidence required --browser-mode managed --challenge-automation-mode browser_with_helper --mode json --output-format json
   ```
   Expected: weak or failed references are non-ready; ready references can continue to Canvas.
5. Run Canvas invalid params:
   ```bash
   npx opendevbrowser canvas --command canvas.plan.set --params '{}' --timeout-ms 30000 --output-format json
   ```
   Expected: typed repair example, params-file example, validation checks, and required identifiers.
6. Search for stale hard-coded guidance strings after integration:
   ```bash
   rg "Fill canvasSessionId|No providers available|Rerun inspiredesign|Deep capture failed|Retry deep capture|patch only the governance blocks" src tests docs skills
   ```
7. Remove or redirect obsolete duplicate prose where it is no longer source-owned. Do not remove compatibility field names such as `recommendedNextCommands` or `suggestedNextAction` while they remain part of the response contract.

Files impacted:
- Source files touched by Tasks 5 through 9.
- Tests touched by Tasks 1 through 9.
- Generated workflow artifact directories under `.opendevbrowser/` for proof only.

End goal: Implementation is proven by the same kind of real workflow evidence that exposed the bug.

Acceptance criteria:
- Real workflow outputs match typed readiness expectations.
- No stale hard-coded guidance prose remains except compatibility wrappers fed by typed guidance.
- Full validation passes.
- Generated proof artifacts are either left as local evidence or cleaned only if the user asks.

Dependencies: Tasks 1 through 9.

Size: Medium.

## Validation Strategy
Run focused checks first:

```bash
npm run test -- tests/guidance-router.test.ts tests/guidance-readiness.test.ts tests/guidance-renderers.test.ts
npm run test -- tests/providers-inspiredesign-workflow.test.ts tests/inspiredesign-visual-harvest.test.ts tests/providers-inspiredesign-contract.test.ts
npm run test -- tests/workflow-handoff.test.ts tests/canvas-manager.test.ts
npm run test -- tests/cli-workflows.test.ts tests/tools-workflows.test.ts tests/daemon-commands.integration.test.ts
```

Run public-surface and skill checks:

```bash
node scripts/generate-public-surface-manifest.mjs
npm run test -- tests/cli-help-parity.test.ts tests/parity-matrix.test.ts tests/public-surface-manifest.test.ts
./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh
./skills/opendevbrowser-design-agent/scripts/validate-skill-assets.sh
./skills/opendevbrowser-motion-design/scripts/validate-skill-assets.sh
./skills/opendevbrowser-design-agent/scripts/design-workflow.sh research-harvest
./skills/opendevbrowser-design-agent/scripts/design-workflow.sh release-gate
node scripts/docs-drift-check.mjs
```

Run full repository gates:

```bash
npm run typecheck
npm run lint
npm run build
npm run test
git diff --check
```

Run live workflow proof commands from Task 10 after the source tests pass.

## Rollout And Risks
- Roll out in compatibility mode first: add `nextStepGuidance` while preserving `followthroughSummary`, `suggestedNextAction`, `suggestedSteps`, Canvas `guidance`, and provider `recommendedNextCommands`.
- Implement Pinterest query discovery through the browser-native recipe runner, not through `src/providers/social/index.ts`.
- Do not introduce a full Pinterest provider unless a later implementation review proves recipe-backed discovery cannot satisfy the workflow contract.
- Treat public-surface changes as generated-source changes. Update source, regenerate manifests, then update docs.
- Keep readiness gates conservative. If evidence quality is uncertain, prefer recovery guidance over Canvas continuation.
- Do not let docs or skills drift from recipes. Use fixture validation in the first slice; consider generated snippets only after the architecture is stable.

Known risks:
- Existing tests may assert exact old guidance strings. Update those tests only after the new typed behavior is proven.
- Some consumers may rely on `suggestedNextAction` being a plain string. Preserve it as rendered compatibility output during migration.
- Authenticated Pinterest behavior is session-sensitive. Tests should use deterministic fixtures; live workflow proof should be reported separately.
- Readiness thresholds can become subjective. Keep them data-backed and explicitly tested against boundary fixtures.
- The native host mismatch from the fresh daemon preflight is not the root cause, but future live verification should mention it if it still appears.

## Open Questions
- None block this plan, but the implementation agent must make these choices explicit before editing production code:
- Recommended default: Pinterest recipes should power a bounded browser-native discovery runner for `--provider social/pinterest`, not only render repair guidance.
- Recommended default: Weak-reference thresholds should start from observed evidence boundaries: zero ranked references is non-ready; missing finalized screenshot with required visual evidence is non-ready; top score below the current usable threshold should be `needs_recovery`; login/challenge/cookie/404/search-shell pages are `diagnostic_only`.
- Recommended default: Canvas repair examples should be generated from runtime schema metadata where available and backed by checked-in examples validated by tests.
- Recommended default: Preserve compatibility fields for the first release and add `nextStepGuidance` alongside them.
- Recommended default: First deliverable migrates Inspired Design, Canvas, CLI message formatting, daemon mismatch recipe compatibility, and one representative non-Inspired Design workflow path. Broader research, shopping, and product-video migration follows after this proof.

## References
- `docs/investigations/inspiredesign-canvas-guidance-quality-2026-05-20.md`
- `.opendevbrowser/deep-plan-verify-pinterest-provider/inspiredesign/5e76be6a-390d-46a1-9c30-0fd2b041aa71`
- `.opendevbrowser/deep-plan-verify-pinterest-url/inspiredesign/1b66a55a-b189-4c35-9dc5-83b95a6954bf`
- `.opendevbrowser/deep-plan-verify-web-harvest/inspiredesign/b037fae6-8384-4255-8e69-eaaeb04e3f7e`
- `/tmp/odb-deep-plan-pinterest-provider.json`
- `/tmp/odb-deep-plan-pinterest-url.json`
- `/tmp/odb-deep-plan-web-harvest.json`
- `/tmp/odb-deep-plan-canvas-invalid.json`
