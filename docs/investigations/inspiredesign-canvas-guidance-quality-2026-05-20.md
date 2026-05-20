# Investigation: Inspired Design Canvas Guidance Quality

## Summary
Confirmed. OpenDevBrowser currently optimizes the Inspired Design plus Canvas path for artifact completion, not evidence validity or agent recoverability. A bad, empty, provider-limited, or off-brief harvest can still emit a valid-looking Canvas continuation bundle, while Canvas and handoff guidance expose command names and field errors without schema-derived examples, repair payloads, or workflow-shaped next steps.

## Symptoms
- The generated direction for a digital photography studio was judged as underwhelming and instruction-mismatched.
- The agent was asked to use both `inspiredesign` harvest and Canvas governance, but the final output apparently did not reflect that workflow contract.
- Agents struggled to use OpenDevBrowser even with next-step guidance and error messages.
- Next-step guidance may say what field is missing without showing a valid example shape, intent value, command form, or codebase-specific structure.
- The concern applies across OpenDevBrowser guidance surfaces, not only Inspired Design.

## Background / Prior Research
- Memory registry points to recent `inspiredesign harvest` implementation work on 2026-05-18 and 2026-05-19. Durable seams noted there include `src/cli/commands/inspiredesign.ts`, `src/providers/workflows.ts`, `src/inspiredesign/*`, `src/providers/*`, `docs/CLI.md`, `docs/SURFACE_REFERENCE.md`, `skills/opendevbrowser-design-agent/*`, and `skills/opendevbrowser-motion-design/*`.
- Prior successful Inspired Design bundle validation noted that a useful continuation contract should include `advanced-brief.md`, `design.md`, `design-contract.json`, `canvas-plan.request.json`, `design-agent-handoff.json`, `generation-plan.json`, `implementation-plan.md`, `implementation-plan.json`, `evidence.json`, `prototype-guidance.md`, and `bundle-manifest.json`.

## Investigator Findings

### Phase 2 - Source-backed guidance quality findings

#### Finding 1 - Harvest defaults request visual evidence, but the evidence can still be weak by default
**Conclusion:** Partly confirmed. The CLI and direct tool do default `inspiredesign harvest` to `maxReferences=5`, `visualEvidence="required"`, and `mode="path"`, so the bug is not that harvest omits visual evidence by default. The weak point is that query discovery can return broad SERP/listing/marketplace pages, while the visual proof is viewport-only, metadata-only, and not scored for reference relevance.

**Evidence:**
- `src/cli/commands/inspiredesign.ts:269-284` rejects harvest without `--query` or `--url`, then forwards default `maxReferences: 5`, `visualEvidence: "required"`, and `mode: "path"`.
- `src/inspiredesign/capture-mode.ts:8-11` forces `captureMode="deep"` only when URLs are present; query-only harvest begins from `off` capture mode at the CLI layer.
- `src/tools/inspiredesign_run.ts:64-88` compensates in the direct tool by enabling `captureReference` for harvest or query and by defaulting harvest visual evidence to required.
- `tests/cli-workflows.test.ts:522-537` and `tests/tools-workflows.test.ts:552-568` assert the harvest defaults and screenshot call, but they do not assert reference relevance or example-rich recovery guidance.
- Supplied artifact `visual-evidence.json:7-13` and `screenshot-index.json:4-11` show captured viewport PNG metadata, while `ranked-references.json:21-22`, `ranked-references.json:47-50`, and `ranked-references.json:131-156` show noisy cues from Etsy or TemplateMonster chrome rather than clean photography-studio design evidence.

#### Finding 2 - Canvas has typed validation data, but invalid-plan guidance does not include a valid repair payload
**Conclusion:** Confirmed. Canvas exposes required fields, allowed values, missing fields, and issue objects, but the public guidance strings and error details stop at field names and command names. They do not return a copy-paste `canvas.plan.set` payload, an example valid `generationPlan`, or issue-specific repair snippets.

**Evidence:**
- `src/canvas/guidance.ts:25-34` returns generic reasons: "Submit a complete generationPlan" or "Submit a supported plan" with only command names.
- `src/browser/canvas-manager.ts:2354-2364` includes `generationPlanRequirements.requiredBeforeMutation` and `allowedValues` in the handshake, but no example payload.
- `src/browser/canvas-manager.ts:2645-2684` builds `generation_plan_invalid` from `missingFields` and `issues` only. Details include `auditId`, `missingFields`, and `issues`, but no `exampleGenerationPlan`, `repairPayload`, or `paramsFile` example.
- `src/canvas/document-store.ts:1312-1370` proves issue objects are already typed enough to drive schema-derived repair examples because each issue has `path`, `code`, `message`, `expected`, and `received`.
- `src/canvas/types.ts:48-72` shows Canvas also requires governance blocks such as `intent`, `designLanguage`, and `contentModel` before mutation or save, creating a second repair surface that current next-step guidance does not turn into concrete patch examples.
- `tests/canvas-manager.test.ts:3079-3113` and `tests/canvas-manager.test.ts:3429-3443` assert `generation_plan_invalid`, missing fields, and issue paths, but not an example repair payload.

#### Finding 3 - Inspired Design handoffs include some commands, but not enough workflow-shaped next steps
**Conclusion:** Confirmed. The Inspired Design handoff has copy-paste commands for loading skills and `canvas.plan.set`, but it does not include a `canvas.session.open` command, does not show how to replace session IDs, and does not include a governance `canvas.document.patch` example for required blocks such as `intent`.

**Evidence:**
- `src/inspiredesign/handoff.ts:60-63` defines `continueInCanvas` as `opendevbrowser canvas --command canvas.plan.set --params-file ./canvas-plan.request.json` only.
- `src/inspiredesign/handoff.ts:72-76` tells users to fill `canvasSessionId`, `leaseId`, and `documentId`, but does not show a session-open command or a concrete filled payload.
- `src/inspiredesign/handoff.ts:270-276` builds a next-step sentence that repeats `canvas.plan.set`, confirms acceptance, then says to patch governance blocks listed in the handoff, without a `governance.update` patch example.
- Supplied artifact `design-agent-handoff.json:2-3` repeats the same pattern in generated output: it names files and says to run `canvas.plan.set`, but does not show a valid repair command or governance patch batch.
- Supplied artifact `canvas-plan.request.json:1-44` proves the generated plan request is complete for `canvas.plan.set`; the gap is not missing `generationPlan`, it is the next-step bridge from accepted plan to required governance patches and save readiness.

#### Finding 4 - Tests lock in generic guidance instead of example-rich guidance
**Conclusion:** Confirmed. Existing tests protect defaults, generic command lists, and exact generic text, so they would pass even when agents receive no schema-derived repair payload.

**Evidence:**
- `tests/workflow-handoff.test.ts:329-359` asserts the Inspired Design suggested steps exactly match the current generic command and reason sequence.
- `tests/workflow-handoff.test.ts:361-392` asserts Canvas guidance command arrays such as `["canvas.plan.set"]`, but not typed example payloads or repair commands.
- `tests/providers-inspiredesign-contract.test.ts:2562-2583` asserts rendered Inspired Design steps equal `buildInspiredesignSuccessHandoff`, so the generic handoff is treated as the contract.
- `tests/cli-workflows.test.ts:540-584` and `tests/tools-workflows.test.ts:590-623` assert terse rejection messages for harvest misuse, but not actionable example commands such as `inspiredesign harvest --brief ... --query ... --provider ... --visual-evidence required`.

### Eliminated hypotheses
- Not confirmed: "harvest lacks visual evidence by default." Source and tests show harvest defaults to required visual evidence on CLI and direct tool paths.
- Not confirmed: "the supplied bundle lacked screenshots." `visual-evidence.json:7-13` and `bundle-manifest.json:20-27` show persisted viewport PNG entries.
- Not confirmed: "the supplied bundle lacked a valid Canvas plan request." `canvas-plan.request.json:6-44` contains all required `CanvasGenerationPlan` sections.

### Root cause
The main root cause is a guidance shape mismatch. Runtime validation is typed and machine-readable, but the guidance layer collapses it into generic prose and bare command names. Agents need copy-paste commands plus schema-derived repair payloads at the same point where errors and handoffs are emitted. A secondary root cause is harvest evidence scoring: screenshots can be present while the ranked reference synthesis still borrows irrelevant source chrome, marketplace, or listicle text.

### Recommended remediation targets and tests
1. Add a Canvas repair example builder near `src/canvas/guidance.ts` or a new `src/canvas/repair-examples.ts` that derives:
   - `exampleGenerationPlan` from `CANVAS_GENERATION_PLAN_REQUIRED_FIELDS` and allowed values.
   - `repairPayload` for `canvas.plan.set` from `details.missingFields` and `details.issues`.
   - `recommendedNextCommandExamples` with `opendevbrowser canvas --command canvas.plan.set --params-file <file>` and inline JSON examples.
2. Extend `src/browser/canvas-manager.ts` invalid-plan details to include the repair payload and command examples while preserving existing `missingFields` and `issues`.
3. Extend Inspired Design handoff generation in `src/inspiredesign/handoff.ts` and `src/providers/workflow-handoff.ts` with:
   - a `canvas.session.open` command example,
   - exact `canvas-plan.request.json` placeholder replacement instructions,
   - a `canvas.document.patch` governance update example for required blocks, starting with `intent`.
4. Strengthen harvest reference synthesis in `src/inspiredesign/reference-pattern-board.ts` and related tests so captured evidence is downgraded or warned when visual/text cues are dominated by cookie banners, marketplace navigation, SERP/listicle chrome, or off-brief content.
5. Add tests that fail on generic guidance:
   - `tests/canvas-manager.test.ts`: `generation_plan_invalid` includes an example valid plan and issue-specific repair payload.
   - `tests/workflow-handoff.test.ts`: Canvas guidance includes copy-paste command examples, not just command names.
   - `tests/providers-inspiredesign-contract.test.ts`: Inspired Design handoff includes session open, plan set, and governance patch examples.
   - `tests/providers-inspiredesign-workflow.test.ts` or `tests/inspiredesign-visual-harvest.test.ts`: noisy captured references are marked weak despite screenshot presence.
   - `tests/cli-workflows.test.ts` and `tests/tools-workflows.test.ts`: harvest misuse errors include a valid example command.

## Investigation Log

### Phase 0 - Workspace Binding
**Hypothesis:** RepoPrompt must be bound to the target workspace before codebase-wide investigation.
**Findings:** RepoPrompt bound successfully to `/Users/bishopdotun/Documents/DevProjects/opendevbrowser`.
**Evidence:** `bind_context` returned workspace `opendevbrowser (1)`.
**Conclusion:** Confirmed.

### Phase 1 - Initial Artifact Inventory
**Hypothesis:** The supplied artifact directory exists and contains the expected Inspired Design harvest files.
**Findings:** Directory exists and contains `advanced-brief.md`, `bundle-manifest.json`, `canvas-plan.request.json`, `design-agent-handoff.json`, `design-contract.json`, `design.md`, `evidence.json`, `generation-plan.json`, `implementation-plan.json`, `implementation-plan.md`, `meta-prompt.md`, `ranked-references.json`, `screenshot-index.json`, `visual-evidence.json`, and screenshot PNGs under `visual-evidence/`.
**Evidence:** Artifact root `/Users/bishopdotun/Documents/DevProjects/vibe-test-project/.opendevbrowser/inspiredesign/0d0ac015-f9a3-4ac2-bc83-e7ae36080b7b`.
**Conclusion:** File presence alone is not the failure; quality and continuation guidance need review.

### Phase 1.5 - Supplied Artifact Quality Review
**Hypothesis:** The supplied bundle was present but contained poor design evidence and polluted synthesis.
**Findings:** Confirmed. The run was intended to harvest Pinterest inspiration, but ranked references included Etsy, TheFlatStudios, TemplateMonster, DesignRush, SiteBuilderReport, Behance, Dribbble, and Colorlib. The top Etsy screenshot was a 404 page, yet it scored 96 with no major visual risk. The generated `meta-prompt.md` and `design.md` used unrelated source chrome and off-brief text such as Etsy search UI, TemplateMonster filters, website-builder copy, and worship/music language as creative direction.
**Evidence:** Supplied artifact root `ranked-references.json`, `meta-prompt.md`, `design.md`, `visual-evidence/070883f6b83f/viewport.png`, and `screenshot-index.json`.
**Conclusion:** The failure is not just weak next-step guidance. Harvest scoring promotes bad-page or source-chrome captures into creative evidence.

### Phase 1.6 - Local Pinterest-Only Reproduction
**Hypothesis:** A Pinterest-only request can fail provider discovery but still emit a design bundle and Canvas handoff.
**Findings:** Confirmed. Running `node dist/cli/index.js inspiredesign harvest --brief "<digital photography studio brief>" --query "Pinterest premium digital photography studio landing page cinematic parallax portfolio" --provider social/pinterest --max-references 5 --visual-evidence required --browser-mode managed --use-cookies --challenge-automation-mode browser_with_helper --mode json --output-dir .opendevbrowser/inspiredesign-repro-2026-05-20 --output-format json` returned success with message `No providers available`. The output had `reference_count: 0`, no accepted URLs, and `capture_mode: off`, but still emitted artifacts and a suggested Canvas continuation.
**Evidence:** Local artifact path `.opendevbrowser/inspiredesign-repro-2026-05-20/inspiredesign/d3eed28d-25e7-42b8-9756-59f102764c02`; JSON output recorded `meta.primaryConstraint.reasonCode: env_limited` and `meta.discovery.failure: No providers available`.
**Conclusion:** Provider-unavailable states are not strong enough to block design-ready continuation.

### Phase 1.7 - Local Web Discovery Reproduction
**Hypothesis:** Broad web harvest can gather visual artifacts but still rank irrelevant or blocked UI as high-quality design evidence.
**Findings:** Confirmed. Running the same brief through `--provider web/default --max-references 3` returned a Pinterest idea page, Envato, and Lovable. It reported provider follow-up required because deep capture failed for one reference. The top ranked reference was an Envato cookie-consent screen, scored 90 with no major visual risk, and `meta-prompt.md` used cookie-consent text as the dominant direction. The Pinterest page was rejected as too weak for creative synthesis.
**Evidence:** Local artifact path `.opendevbrowser/inspiredesign-repro-2026-05-20-web/inspiredesign/d30a0a13-04f7-415b-9f88-36de9114aad8`; `visual-evidence/d8415857b6f5/viewport.png`; `ranked-references.json`; `meta-prompt.md`.
**Conclusion:** Visual evidence presence is over-weighted relative to page relevance, blocker UI, and provider intent.

### Phase 1.8 - Command Surface and Pinterest Provider Verification
**Hypothesis:** The intended command may be a separate `harvest inspired-design` or `inspired-design run` surface that uses a Pinterest logged-in search workflow.
**Findings:** Eliminated. `npx opendevbrowser harvest inspired-design --output-format json` returns `Unknown command: harvest`. `npx opendevbrowser inspired-design run --brief "Digital photography studio landing page" --output-format json` returns `Unknown command: inspired-design`. The installed CLI help only exposes `npx opendevbrowser inspiredesign run ...` and `npx opendevbrowser inspiredesign harvest ...`.
**Evidence:** CLI help lists `inspiredesign run` and `inspiredesign harvest`; `src/cli/commands/inspiredesign.ts:252-256` accepts only subcommands `run` and `harvest` under command `inspiredesign`.
**Conclusion:** The supported command is `opendevbrowser inspiredesign harvest`, not `opendevbrowser harvest inspired-design` or `opendevbrowser inspired-design run`.

### Phase 1.9 - Pinterest Provider Registration Verification
**Hypothesis:** `social/pinterest` is a real provider registered in the provider runtime and can use the extension logged-in session for search.
**Findings:** Not confirmed. Source registration does not include Pinterest. `src/providers/social/index.ts:27-36` defines social platforms as `x`, `reddit`, `bluesky`, `facebook`, `linkedin`, `instagram`, `tiktok`, `threads`, and `youtube`. `src/providers/social/index.ts:50-61` creates providers for those same platforms only. Runtime command `npx opendevbrowser inspiredesign harvest ... --provider social/pinterest --browser-mode extension --use-cookies --cookie-policy required ...` returned success with provider follow-up required, `No providers available`, zero accepted URLs, zero references, and `capture_mode: off`.
**Evidence:** Local artifact path `.opendevbrowser/inspiredesign-command-verify-harvest-pinterest-extension/inspiredesign/b0a55c07-7124-45b6-9abc-0e35675b7518`; `/tmp/odb-inspiredesign-harvest-pinterest-extension.json`; `tests/providers-inspiredesign-workflow.test.ts:1352-1436` only simulate Pinterest provider failures in tests.
**Conclusion:** The current installed build does not have a functioning registered Pinterest search provider. The `social/pinterest` lane exists in tests and metadata paths, but runtime provider discovery cannot use it.

### Phase 1.10 - Explicit Pinterest URL Capture
**Hypothesis:** Even without a search provider, `inspiredesign run` or `inspiredesign harvest` can capture an explicit Pinterest URL through extension browser transport.
**Findings:** Confirmed with limitations. `npx opendevbrowser inspiredesign run --url <Pinterest ideas URL> --browser-mode extension --use-cookies --cookie-policy required ...` fetched and captured one reference with `capture_mode: deep`. `npx opendevbrowser inspiredesign harvest --url <Pinterest ideas URL> --visual-evidence required --browser-mode extension ...` also captured one viewport screenshot. However, the explicit Pinterest reference was rejected from creative synthesis as diagnostic or too weak, leaving zero ranked references.
**Evidence:** Run artifact `.opendevbrowser/inspiredesign-command-verify-run/inspiredesign/5baefc89-9117-4d47-8b5a-1599d8847e68`; harvest artifact `.opendevbrowser/inspiredesign-command-verify-harvest-pinterest-url/inspiredesign/bb8c392c-f05f-4174-be54-05523b487e57`; screenshot `visual-evidence/32aa63f3d77f/viewport.png`; `meta-prompt.md` says no usable references were ranked.
**Conclusion:** Explicit Pinterest URLs can be captured, but that is not the same as the planned logged-in Pinterest search harvest workflow.

## Root Cause
The primary root cause is a state and guidance mismatch: runtime validation and provider execution produce structured data, but the workflow collapses degraded states into a successful artifact bundle and collapses typed errors into generic prose. Agents receive a path to continue, not an explicit decision about whether the bundle is design-ready.

Confirmed sub-causes:
- Harvest can succeed with zero usable references and still emit Canvas continuation artifacts.
- Explicit provider intent is not protected strongly enough. If `social/pinterest` is unavailable, the workflow does not stop as provider-blocked.
- Reference scoring treats screenshot presence as strong evidence even when the page is a 404, cookie banner, marketplace shell, search/listing page, or off-brief content.
- Evidence degradation does not make recovery the primary next action. Canvas continuation remains prominent even when provider evidence is missing, weak, or polluted.
- Canvas invalid-plan guidance has `missingFields` and typed `issues`, but does not include a valid repair payload, minimal plan example, or command example.
- Inspired Design handoff tells agents to run `canvas.plan.set`, but it does not show `canvas.session.open`, placeholder replacement, a full params shape, or a governance patch example.
- Current tests assert generic guidance and command arrays, so they preserve the under-specified behavior.
- The currently registered social provider runtime has no Pinterest provider, so `--provider social/pinterest` cannot perform the intended logged-in Pinterest search harvest in this build.
- Next-step guidance is scattered across workflow handoffs, Canvas guidance, CLI messages, docs, and skills instead of being produced by one typed guidance router with reusable recipes, typed examples, and status-aware recovery rules.

## Recommendations
1. Add failing regression tests first:
   - `tests/providers-inspiredesign-workflow.test.ts`: provider unavailable and zero-reference harvest must not be design-ready.
   - `tests/inspiredesign-visual-harvest.test.ts`: 404, cookie-consent, marketplace chrome, and listicle captures must be rejected or heavily downgraded.
   - `tests/providers-inspiredesign-contract.test.ts`: handoff must include session-open, plan-set, and governance patch examples.
   - `tests/canvas-manager.test.ts`: `generation_plan_invalid` must include a valid repair payload and command example.
   - `tests/cli-workflows.test.ts` and `tests/tools-workflows.test.ts`: harvest misuse and provider-unavailable guidance must include valid example commands.

2. Add evidence readiness gates in `src/providers/workflows.ts`, `src/providers/workflow-handoff.ts`, and `src/inspiredesign/handoff.ts`:
   - Introduce a design-readiness state such as `designReady`, `needsEvidenceRecovery`, or `blockedByProvider`.
   - If references are empty, providers are unavailable, or no usable ranked references remain, make recovery the primary next action.
   - Do not present Canvas continuation as the primary next step until evidence is design-ready.

3. Preserve provider scope and capture expectations in `src/cli/commands/inspiredesign.ts`, `src/tools/inspiredesign_run.ts`, `src/providers/workflows.ts`, and `src/inspiredesign/capture-mode.ts`:
   - Treat explicit `--provider social/pinterest` unavailability as provider-blocked.
   - Do not widen to unrelated providers unless the user explicitly asks for fallback sources.
   - Ensure query-backed harvest with required visual evidence cannot appear visual-ready when capture is effectively absent or weak.

4. Harden reference scoring in `src/inspiredesign/reference-pattern-board.ts`:
   - Reject or downgrade 404 pages, cookie banners, consent modals, marketplace/search/listing chrome, template gallery filters, website-builder marketing copy, off-brief content, and explicit provider mismatches.
   - Keep those captures as diagnostic artifacts, but prevent them from becoming dominant creative direction.

5. Add schema-derived Canvas repair guidance in `src/canvas/guidance.ts`, `src/browser/canvas-manager.ts`, and likely a new `src/canvas/repair-examples.ts`:
   - Return `exampleGenerationPlan`, `examplePlanSetParams`, `repairHints`, `fieldExamples`, and `recommendedNextCommandExamples`.
   - Preserve existing `missingFields` and `issues` for compatibility.

6. Expand Inspired Design handoff examples in `src/inspiredesign/handoff.ts`, `src/inspiredesign/contract.ts`, and `src/providers/workflow-handoff.ts`:
   - Add a `canvas.session.open` example.
   - Show exactly how to replace `canvasSessionId`, `leaseId`, and `documentId`.
   - Include a full `canvas.plan.set` params-file shape.
   - Include a `canvas.document.patch` governance update example starting with `intent`.
   - State explicitly that `planStatus=accepted` is not the same as governance completion.

7. Update docs, bundled skills, and workflow scripts:
   - `docs/DESIGN_CANVAS_TECHNICAL_SPEC.md`
   - `docs/SURFACE_REFERENCE.md`
   - `skills/opendevbrowser-design-agent/SKILL.md`
   - `skills/opendevbrowser-design-agent/artifacts/research-harvest-workflow.md`
   - `skills/opendevbrowser-best-practices/scripts/odb-workflow.sh`
   - Add one full successful Inspired Design to Canvas path, one provider-unavailable recovery path, one invalid Canvas plan repair path, and one governance patch example.

8. Add a centralized typed next-step guidance router:
   - Create a shared guidance layer that receives workflow status, reason codes, blocker codes, schema issues, provider/site context, artifact readiness, and command surface metadata.
   - Return a typed `nextStepGuidance` object instead of scattered prose-only strings.
   - Keep outputs DRY by generating command examples, params examples, validation gates, and recovery steps from recipes.
   - Use the same router from Inspired Design, Canvas, research, shopping, product-video, macro execution, daemon mismatch handling, and any future workflow.

9. Model task recipes separately from provider adapters:
   - Do not turn every website into a heavyweight provider.
   - Add generic browser-native task recipes for logged-in site navigation, search, extraction, artifact capture, and recovery.
   - Add Pinterest as the first site recipe only for Pinterest-specific search-box navigation, result extraction, session checks, scroll cadence, and bad-state detection.
   - Keep full providers for reusable data-source adapters with stable operations; use site recipes for browser-native agent execution against logged-in or visually driven sites.

10. Define reusable recipe categories:
   - Workflow entry recipes: how to start a workflow correctly, including required flags and valid command shapes.
   - Site navigation recipes: how to open a logged-in site, search naturally, collect candidates, scroll, and detect bad states.
   - Schema repair recipes: how to fix typed validation failures such as `generation_plan_invalid`, missing `intent`, or invalid provider selection.
   - Evidence recovery recipes: how to respond to `env_limited`, `auth_required`, `challenge_required`, `provider_unavailable`, empty results, or weak visual evidence.
   - Artifact handoff recipes: how to read produced files, verify readiness, and continue into the next workflow without treating artifacts as automatically valid.
   - Quality gate recipes: how to decide whether a result is design-ready, source-ready, provider-ready, or blocked.

11. Define the typed guidance output contract:
   - `id`: stable recipe or guidance id.
   - `severity`: `info`, `warning`, `blocked`, or `fatal`.
   - `readiness`: `ready`, `needs_input`, `needs_recovery`, `blocked`, or `diagnostic_only`.
   - `reasonCode`: normalized machine-readable reason.
   - `primaryAction`: the next action agents should take first.
   - `commands`: copy-paste commands with placeholders clearly marked.
   - `paramsExamples`: valid JSON or params-file examples.
   - `fieldExamples`: examples for missing or invalid typed fields.
   - `artifactInputs`: files to read before proceeding.
   - `validationChecks`: commands or assertions that prove the next step worked.
   - `fallbackPolicy`: when fallback is allowed, disallowed, or requires user confirmation.
   - `doNotProceedIf`: explicit blockers that prevent downstream handoff.

12. Replace ad hoc guidance surfaces incrementally:
   - First replace Inspired Design handoff and Canvas invalid-plan guidance because they are the reproduced failure path.
   - Then replace shared `src/providers/workflow-handoff.ts` so research, shopping, product-video, and macro execution use the same guidance contract.
   - Then wire CLI errors and daemon mismatch guidance through the same recipe router where practical.
   - Keep docs and skills synchronized with generated examples from the same recipe source.

## Proposed Central Guidance Recipe Architecture
The fix should be a shared typed guidance system, not another Inspired Design-only patch. The current pattern lets each workflow hand-write next-step prose, so examples drift, typed validation data is lost, and agents receive generic commands without enough structure to recover. A centralized router should turn runtime state into recipe-backed, typed, copy-paste guidance everywhere OpenDevBrowser asks an agent to continue, repair, recover, or stop.

### Core model
Add a shared guidance module, likely under `src/guidance/`, with three separable concepts:
- `GuidanceRouter`: receives a normalized context object and selects the best recipe by workflow, reason code, readiness state, schema issue, provider/site context, and artifact state.
- `GuidanceRecipe`: declarative instructions for one task or recovery path, including commands, params examples, field examples, validation checks, and blockers.
- `GuidanceRenderer`: converts typed guidance to the target surface, such as JSON handoff, CLI text, daemon response, docs snippet, or skill example, without changing the recipe content.

The router can be implemented as a dispatch table or switch over normalized reason codes, but the recipe content should stay data-driven. This keeps the logic DRY while still allowing workflow-specific examples where the examples matter.

### Suggested Type Shape
```ts
type GuidanceSeverity = "info" | "warning" | "blocked" | "fatal";
type GuidanceReadiness =
  | "ready"
  | "needs_input"
  | "needs_recovery"
  | "blocked"
  | "diagnostic_only";

interface NextStepGuidance {
  id: string;
  recipeType: GuidanceRecipeType;
  workflow: string;
  severity: GuidanceSeverity;
  readiness: GuidanceReadiness;
  reasonCode: string;
  primaryAction: string;
  commands: GuidanceCommandExample[];
  paramsExamples: GuidanceParamsExample[];
  fieldExamples: GuidanceFieldExample[];
  artifactInputs: GuidanceArtifactInput[];
  validationChecks: GuidanceValidationCheck[];
  fallbackPolicy: GuidanceFallbackPolicy;
  doNotProceedIf: string[];
}
```

The important part is not this exact interface name. The important part is that guidance becomes an object with typed examples and validation semantics, not a prose paragraph plus a command-name array.

### Recipe Types To Maintain
- Workflow entry recipes: valid command forms, required flags, mode expectations, and minimum viable inputs for each workflow.
- Site navigation recipes: browser-native steps for logged-in search, session checks, search box usage, scrolling cadence, result extraction, and bad-state detection.
- Schema repair recipes: typed examples for invalid params, missing fields, enum violations, and command-specific repair payloads.
- Evidence recovery recipes: next actions for `env_limited`, `auth_required`, `challenge_required`, `provider_unavailable`, empty references, weak visual evidence, and provider mismatch.
- Artifact handoff recipes: required files to read, readiness checks to perform, and the next workflow command only when the artifact state is actually ready.
- Quality gate recipes: assertions that decide whether an output is source-ready, design-ready, Canvas-ready, provider-ready, diagnostic-only, or blocked.

### Pinterest As A Recipe, Not A Default Provider
Pinterest should be the first browser-native site recipe, not necessarily a full provider. The site recipe should describe how to use a logged-in browser session to search Pinterest naturally, detect login or challenge states, collect candidate pins or boards, scroll for enough visual variety, and capture artifacts. That avoids creating a heavyweight provider for every website while still giving agents concrete instructions for sites where logged-in visual navigation matters.

A full provider should be reserved for stable, reusable data-source adapters with durable query semantics. A site recipe is better when the task depends on browser interaction, logged-in session state, visual search, or site-specific recovery.

### Cross-Workflow Guidance Coverage
The first implementation should cover the reproduced failure path:
- Inspired Design harvest provider unavailable, zero references, weak references, and design-ready handoff.
- Canvas `generation_plan_invalid`, missing governance blocks such as `intent`, and plan accepted but governance incomplete.
- Provider workflow handoffs that currently present artifacts as if they are ready.

The next implementation pass should route the other repeated guidance surfaces through the same system:
- Research, shopping, and product-video evidence handoffs.
- Macro execution and provider action expansion errors.
- Daemon fingerprint mismatch, stale daemon, and relay readiness guidance.
- CLI validation failures where a valid command example can be generated from command metadata.

### Example Recipes Needed First
1. `inspiredesign.harvest.provider_unavailable`
   - Primary action: recover provider evidence, not continue to Canvas.
   - Command example: a valid `opendevbrowser inspiredesign harvest` command with explicit `--provider`, `--query`, `--visual-evidence required`, and browser mode flags.
   - Do not proceed if: `reference_count === 0`, no ranked references, or provider is unavailable.

2. `inspiredesign.harvest.browser_native_site_search.pinterest`
   - Primary action: open Pinterest in an authenticated browser session, search the brief, collect visual candidates, and reject login/challenge/search-shell captures.
   - Params examples: query string, max references, visual evidence policy, expected artifact files.
   - Validation checks: accepted URLs are Pinterest pins or boards, screenshots are not login/challenge/empty-grid screens, and ranked references remain on brief.

3. `canvas.generation_plan_invalid`
   - Primary action: repair and resubmit `canvas.plan.set`.
   - Params examples: minimal valid `generationPlan`, issue-specific repair patch, and `--params-file` command.
   - Field examples: valid `intent`, `designLanguage`, `contentModel`, `theme`, `sections`, and `motion` values derived from the current Canvas schema.

4. `canvas.governance_missing.intent`
   - Primary action: patch governance before save or mutation.
   - Params examples: `canvas.document.patch` payload with a concrete `intent` block, not just a field name.
   - Do not proceed if: governance readiness is false even when `planStatus` is accepted.

5. `daemon.fingerprint_mismatch`
   - Primary action: run status preflight and use a matching binary or isolated config/cache/ports.
   - Command examples: status JSON command, restart command, and isolation command pattern.
   - Validation checks: `data.fingerprintCurrent === true`.

### Design Constraints
- Recipes must be typed and testable. A test should be able to assert that a reason code returns a command example, params example, validation check, and blocker policy.
- Recipes must be reusable across runtime, docs, and skills. Generated docs snippets are safer than separately maintained examples.
- Recipe selection must be deterministic. Agents should see one primary action, then alternatives only when fallback is explicitly allowed.
- Guidance must distinguish completion from readiness. Artifact presence, screenshots, or accepted schema should not imply design-ready or Canvas-ready.
- Site recipes must not silently widen provider scope. If the user asked for Pinterest, the guidance should not switch to unrelated sources without a clear fallback policy or confirmation requirement.
- Every workflow that emits `nextStepGuidance`, `suggestedSteps`, `details`, or handoff instructions should eventually use the same guidance object or a renderer derived from it.

### Acceptance Criteria For The Future Fix
- Provider-unavailable Inspired Design harvest returns blocked or recovery guidance with typed examples and does not recommend Canvas as the primary next step.
- Weak visual evidence returns diagnostic-only or needs-recovery guidance, even if screenshots exist.
- Canvas invalid plan responses include a valid repair payload and command example generated from typed schema information.
- Governance-missing responses include concrete field examples, starting with `intent`.
- CLI misuse responses include at least one valid command example for the attempted workflow.
- Docs and skills consume the same recipe examples or generated snippets so runtime guidance and written guidance cannot drift.

## Preventive Measures
- Treat "artifact emitted" and "design-ready" as separate workflow states.
- Require tests for low-quality evidence, not only tests for artifact presence.
- Require every next-step guidance surface to include at least one valid command example and one valid params example when the command needs structured input.
- Keep recovery guidance closer to the runtime error that generated it. Agents should not have to infer valid shapes from scattered docs.
- Add visual-evidence diagnostics that distinguish usable creative evidence from diagnostic browser evidence.
- Centralize next-step guidance in typed recipes so runtime messages, handoff artifacts, docs, and skills cannot drift independently.
- Prefer recipe-driven browser-native execution for logged-in sites instead of adding a full provider for every website.
