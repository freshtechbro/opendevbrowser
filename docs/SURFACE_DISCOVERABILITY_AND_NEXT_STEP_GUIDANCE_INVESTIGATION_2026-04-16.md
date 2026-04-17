# Investigation: Surface Discoverability And Next-Step Guidance

Status: active
Last updated: 2026-04-16

## Summary

OpenDevBrowser already has a strong, code-derived inventory model for public CLI commands, tool surfaces, and workflow validation lanes. The main problem is not missing capability definitions. The real gaps are split ownership of descriptive metadata, incomplete cross-linking from the primary help surface, and inconsistent presentation of already-existing next-step guidance in CLI text mode.

The safest path is to keep the current two-source architecture intact:

- `src/public-surface/source.ts` remains the only authored source of truth for the executable public surface.
- `scripts/shared/workflow-inventory.mjs` remains the code-derived source of truth for workflow families, validation scenarios, and proof lanes.

From there, the repo should improve discoverability and post-action usability by reusing existing metadata and payload fields rather than introducing a second discoverability registry or broad response-schema rewrites.

## Scope

This investigation answered four questions:

1. Where the canonical inventories for commands, tools, and workflows already live.
2. Which capabilities are currently easiest to miss, even though they are already present.
3. How next-step guidance is already represented in structured payloads.
4. How to surface that guidance safely without breaking consumers or bloating runtime output.

## Symptoms

- The project has a large surface area across CLI commands, tools, `/ops`, `/canvas`, workflows, onboarding helpers, diagnostics, and validation lanes.
- The user wants every capability to be easily discoverable by agents, with no hidden or easy-to-miss surface.
- The user also wants responses to include useful next steps after a command or tool call.
- Workflow guides should show step-by-step usage and next steps after each phase.
- The integration must avoid breakage, duplicate metadata, and response bloat.

## Canonical Inventory Snapshot

### Current coverage

The current code-derived workflow inventory reports:

- CLI commands: `77`
- Tool surfaces: `70`
- CLI<->tool pairs: `67`
- CLI-only commands: `10`
- Tool-only surfaces: `3`
- Provider ids in live scenario source: `22`

Evidence:

- `docs/WORKFLOW_SURFACE_MAP.md:8-14`
- `scripts/shared/workflow-inventory.mjs:710-728`
- `scripts/shared/workflow-inventory.mjs:741-757`

### Canonical inventory sources

The existing inventory model is already layered and mostly healthy:

- `src/public-surface/source.ts:121-124` defines `PublicSurfaceCliCommandDefinition`.
- `src/public-surface/source.ts:624-631` builds `CLI_COMMAND_HELP_DETAILS` from canonical command metadata.
- `src/public-surface/source.ts:642-709` defines `TOOL_SURFACE_ENTRIES`.
- `src/public-surface/source.ts:773-780` builds canonical CLI command records.
- `src/public-surface/source.ts:801-809` derives CLI<->tool pairs from tool metadata.
- `scripts/generate-public-surface-manifest.mjs` writes `src/public-surface/generated-manifest.ts` and `src/public-surface/generated-manifest.json`.
- `src/cli/args.ts:1-12` and `src/cli/args.ts:106-107` parse commands and flags from the generated manifest, not from ad hoc lists.
- `src/tools/index.ts:75-90` re-exports `TOOL_SURFACE_ENTRIES` from the generated manifest and then wires runtime tools manually.
- `tests/public-surface-manifest.test.ts:1-12` verifies that the checked-in generated manifest exactly matches `buildPublicSurfaceManifest(...)`.
- `tests/cli-help-parity.test.ts:18-23` and `tests/cli-help-parity.test.ts:108-122` verify tool parity and runtime registration parity.

Conclusion:

The repo already has a strong source-derived inventory model. Missing discoverability is a presentation and ownership problem, not a missing-inventory problem.

### CLI command inventory by family

The current family-level CLI inventory is already codified in `docs/WORKFLOW_SURFACE_MAP.md` and `docs/SURFACE_REFERENCE.md`.

System lifecycle:

- `install`
- `update`
- `uninstall`
- `help`
- `version`
- `serve`
- `daemon`

Guarded power-user surfaces:

- `native`
- `rpc`

Script automation:

- `run`

Session lifecycle:

- `launch`
- `connect`
- `disconnect`
- `status`
- `status-capabilities`
- `cookie-import`
- `cookie-list`

First-class provider workflows:

- `research`
- `shopping`
- `product-video`
- `inspiredesign`

Diagnostics:

- `artifacts`
- `session-inspector`
- `session-inspector-plan`
- `session-inspector-audit`
- `perf`
- `screenshot`
- `dialog`
- `console-poll`
- `network-poll`
- `debug-trace-snapshot`
- `screencast-start`
- `screencast-stop`

Macro provider workflows:

- `macro-resolve`

Canvas workflow:

- `canvas`

Navigation and review:

- `goto`
- `wait`
- `snapshot`
- `review`
- `review-desktop`

Interaction and pointer control:

- `click`
- `hover`
- `press`
- `check`
- `uncheck`
- `type`
- `select`
- `scroll`
- `scroll-into-view`
- `upload`
- `pointer-move`
- `pointer-down`
- `pointer-up`
- `pointer-drag`

Targets and named pages:

- `targets-list`
- `target-use`
- `target-new`
- `target-close`
- `page`
- `pages`
- `page-close`

DOM inspection and export:

- `dom-html`
- `dom-text`
- `dom-attr`
- `dom-value`
- `dom-visible`
- `dom-enabled`
- `dom-checked`
- `clone-page`
- `clone-component`

Annotation workflow:

- `annotate`

Desktop observation:

- `desktop-status`
- `desktop-windows`
- `desktop-active-window`
- `desktop-capture-desktop`
- `desktop-capture-window`
- `desktop-accessibility-snapshot`

Evidence:

- `docs/WORKFLOW_SURFACE_MAP.md:10-14`
- `docs/SURFACE_REFERENCE.md:30`

### Tool inventory summary

The exhaustive tool inventory already exists in `docs/SURFACE_REFERENCE.md:134` and is mirrored from the generated manifest. The most important discoverability detail is that almost all tool surfaces are paired to CLI commands except three local-only helpers.

Tool-only local helpers:

- `opendevbrowser_prompting_guide`
- `opendevbrowser_skill_list`
- `opendevbrowser_skill_load`

These are intentionally local-only and are currently surfaced mainly through onboarding guidance.

Evidence:

- `docs/WORKFLOW_SURFACE_MAP.md:10-14`
- `src/tools/index.ts:75-90`
- `tests/cli-help-parity.test.ts:18-23`

### CLI-only commands

The commands most likely to be missed by tool-first agents are the CLI-only surfaces:

- `install`
- `update`
- `uninstall`
- `help`
- `version`
- `serve`
- `daemon`
- `native`
- `artifacts`
- `rpc`

These are not hidden in the repo, but they are less discoverable to agents that only reason through tool equivalence.

Evidence:

- `docs/WORKFLOW_SURFACE_MAP.md:10-14`
- `scripts/shared/workflow-inventory.mjs:710-728`

### Workflow and validation lanes

The validation surface is already broad and explicit. The automated validation lanes currently documented are:

- `scenario.feature.cli.onboarding`
- `scenario.feature.cli.smoke`
- `scenario.workflow.research.run`
- `scenario.workflow.shopping.run`
- `scenario.workflow.product_video.url`
- `scenario.workflow.product_video.name`
- `scenario.workflow.inspiredesign.run`
- `scenario.workflow.macro.web_search`
- `scenario.workflow.macro.web_fetch`
- `scenario.workflow.macro.community_search`
- `scenario.workflow.macro.media_search`
- `scenario.feature.annotate.direct`
- `scenario.feature.annotate.relay`
- `scenario.feature.canvas.managed_headless`
- `scenario.feature.canvas.managed_headed`
- `scenario.feature.canvas.extension`
- `scenario.feature.canvas.cdp`

Guarded and non-CLI lanes are also explicitly documented.

Evidence:

- `docs/WORKFLOW_SURFACE_MAP.md:226-248`
- `scripts/shared/workflow-inventory.mjs:696-757`

Conclusion:

The workflow validation model is already discoverable in code and docs. The main issue is that the primary help path does not point to it aggressively enough.

## Investigation Log

### Phase 1 - Public inventory authority

**Hypothesis:** the repo lacks a stable canonical inventory for its public surface.

**Findings:** false. The public surface is already mostly source-first.

**Evidence:**

- `src/public-surface/source.ts:121-124` defines CLI command metadata shape.
- `src/public-surface/source.ts:624-631` derives CLI help details from canonical command metadata.
- `src/public-surface/source.ts:642-709` defines tool surface entries.
- `src/public-surface/source.ts:773-809` builds manifest-ready CLI records and CLI<->tool pairs.
- `src/cli/args.ts:1-12` and `src/cli/args.ts:106-107` consume generated manifest command and flag inventories.
- `tests/public-surface-manifest.test.ts:1-12` asserts generated snapshot parity.
- Commit `1fb1c10` introduced the public-surface manifest direction.

**Conclusion:** the core architecture already has the right inventory foundation.

### Phase 2 - Help discoverability and drift seams

**Hypothesis:** discoverability is limited because descriptive metadata is still split between the manifest source and runtime registration.

**Findings:** confirmed.

`src/public-surface/source.ts` currently owns command names, usage strings, flags, group membership, tool names, tool descriptions, and CLI<->tool pairs, but it does not own CLI command descriptions. `src/cli/help.ts` therefore reaches back into the runtime registry to fetch descriptions via `listCommands()`.

**Evidence:**

- `src/public-surface/source.ts:121-124` shows `PublicSurfaceCliCommandDefinition` only includes `name`, `usage`, and `flags`.
- `src/cli/help.ts:339-347` calls `listCommands()` to collect human descriptions.
- `src/cli/help.ts:425-455` formats command rows from runtime descriptions plus manifest-derived usage/flags.
- `src/cli/help.ts:457-465` shows tool entries already render a `cli:` detail when a pairing exists.
- `src/cli/help.ts:482-510` builds the help text but does not reference `docs/WORKFLOW_SURFACE_MAP.md`.
- `src/cli/index.ts` manually duplicates descriptions inside `registerCommand(...)` blocks throughout the file, for example the session-inspector description at `src/cli/index.ts:503-517`.

**Conclusion:** names are canonical, but command meaning is still duplicated. That is the most important remaining drift seam.

### Phase 3 - Structured next-step guidance already exists

**Hypothesis:** the repo needs a brand-new next-step metadata system.

**Findings:** false. The data layer already contains next-step guidance in multiple places.

**Evidence:**

- `src/cli/utils/workflow-message.ts:33-79` already reads `meta.primaryConstraintSummary` and `guidance.recommendedNextCommands[]`, then appends a single `Next step:` message for workflow CLI wrappers.
- `src/browser/session-inspector.ts:120-147` returns `suggestedNextAction` as part of `SessionInspectorResult`.
- `src/browser/session-inspector.ts:309-333` computes `suggestedNextAction` centrally from blocker, relay, target, and trace state.
- `src/browser/canvas-manager.ts:140-185` defines command-level `recommendedNextCommands` guidance for canvas state transitions.
- `src/browser/canvas-manager.ts:2450-2460` resolves command guidance at execution time.
- `src/challenges/types.ts:388-415` defines `ChallengeInspectPlan`, which already includes `suggestedSteps: ChallengeActionStep[]`.
- `src/challenges/types.ts:256-271` defines each `ChallengeActionStep` with `kind`, `reason`, and optional structured execution details.
- `src/challenges/inspect-plan.ts:355-414` builds `ChallengeInspectPlan` and preserves `suggestedSteps`.
- `docs/CLI.md:475` already tells operators to follow `meta.primaryConstraint.guidance.recommendedNextCommands[]` when present.
- `docs/CLI.md:964` already documents a step chain for the canvas workflow.
- `docs/SURFACE_REFERENCE.md:408` and `docs/SURFACE_REFERENCE.md:550` document structured guidance for canvas and workflow outputs.

**Conclusion:** the repo already has useful structured follow-up data. The main missing piece is normalized presentation.

### Phase 4 - CLI text mode hides some of that guidance

**Hypothesis:** CLI text mode is where discoverability and post-action guidance are most inconsistent.

**Findings:** confirmed.

The CLI executor prints only `result.message` in text mode. That works well when a wrapper already formats a good message, but it hides next-step data when a wrapper returns only a generic sentence and keeps the useful guidance inside `result.data`.

**Evidence:**

- `src/cli/index.ts:252-273` prints only `result.message` in text mode.
- `src/cli/commands/session/inspector.ts:18-26` returns `message: "Session inspector snapshot captured."` and puts the actual payload in `data`.
- `src/cli/commands/session/inspector-plan.ts:26-34` returns `message: "Challenge inspect plan captured."` and puts the plan in `data`.
- `src/cli/commands/session/inspector-audit.ts:40-45` returns `message: "Correlated audit bundle captured."` and puts the structured bundle in `data`.
- Git blame shows the workflow helper gained first-next-step rendering in commit `80b21a2`, while the inspector wrapper messages remained generic from `bcf5458` and `3fb6197`.

Nuance:

- Canvas is lower priority here because `src/cli/commands/canvas.ts:293-307` prints the raw structured result in text mode, so guidance is visible even though it is not curated.

**Conclusion:** CLI text-mode wrapping, not producer-side data availability, is the highest-value usability seam.

### Phase 5 - Tool responses are already machine-oriented and should stay that way

**Hypothesis:** the simplest solution is to stuff human prose into every tool result.

**Findings:** false and risky.

The tool layer has a deliberately simple envelope. Most tools return raw structured data through `ok(...)`, which serializes `{ ok: true, ...data }`. A blanket human-prose rewrite there would affect virtually every tool consumer.

**Evidence:**

- `src/tools/response.ts:1-18` shows `ok()` and `failure()` are generic JSON-string envelopes used by the whole tool layer.
- `src/tools/session_inspector.ts:10-41` returns `ok(result)` directly.
- `src/tools/research_run.ts:1-54` returns `ok(result)` directly.
- `src/tools/inspiredesign_run.ts:1-53` returns `ok(result)` directly.

**Conclusion:** follow-up usability should be improved at the CLI presentation layer first, and only added to tool payloads where the producer already owns meaningful structured guidance.

### Phase 6 - Workflow and docs surfaces already contain the right raw materials

**Hypothesis:** the repo needs a new workflow-guide registry.

**Findings:** false for the initial rollout.

The repo already has:

- first-contact onboarding and help guidance in `docs/CLI.md:8-9`
- exhaustive public inventories in `docs/SURFACE_REFERENCE.md:30`, `docs/SURFACE_REFERENCE.md:134`, `docs/SURFACE_REFERENCE.md:228`, and `docs/SURFACE_REFERENCE.md:344`
- code-derived workflow and validation coverage in `docs/WORKFLOW_SURFACE_MAP.md:8-14` and `docs/WORKFLOW_SURFACE_MAP.md:226-248`
- docs drift enforcement in `scripts/docs-drift-check.mjs:91-100` and `scripts/docs-drift-check.mjs:131-140`

**Conclusion:** the safer short-term move is to strengthen cross-linking and standardize step-guide formatting in existing docs rather than invent a new authored registry.

## Root Cause

The discoverability problem comes from three related issues:

1. **Split metadata ownership.** `src/public-surface/source.ts` owns names/usages/flags/tools, but `src/cli/index.ts` still owns CLI descriptions. Help therefore depends on both the generated manifest and the runtime command registry.
2. **Primary help under-links secondary inventories.** The exhaustive inventory and validation maps already exist, but `src/cli/help.ts` does not surface `docs/WORKFLOW_SURFACE_MAP.md`, CLI-only surfaces, or tool-only helpers strongly enough from the first-contact help path.
3. **Follow-up guidance exists but is not normalized at the presentation boundary.** Workflows, session inspection, challenge plans, and canvas already expose next-step data, but only workflow wrappers currently turn that into concise text-mode guidance.

## Eliminated Hypotheses

- **"The repo lacks a public inventory."** Eliminated. The inventories already exist and are drift-checked.
- **"A new discoverability registry is required."** Eliminated. The current source manifest plus workflow inventory are sufficient.
- **"Tool schemas should be rewritten globally."** Eliminated. That would destabilize the whole tool layer for little gain.
- **"Workflow validation metadata belongs in `src/public-surface/source.ts`."** Eliminated. That would mix executable catalog metadata with proof-lane metadata and make the public-surface source heavier than necessary.

## Recommended Architecture

### Layer A - Canonical executable surface

Keep `src/public-surface/source.ts` as the only authored source of truth for:

- CLI command names
- CLI descriptions
- usage strings
- flags
- command groups
- tool names and descriptions
- CLI<->tool pairing

Minimal change:

- add `description` to `PublicSurfaceCliCommandDefinition`
- emit it from `buildPublicSurfaceCliCommands()`
- generate it into `generated-manifest.ts` and `generated-manifest.json`
- render help descriptions from the generated manifest instead of `listCommands()`

This is the cleanest way to eliminate the remaining help/description drift seam.

### Layer B - Code-derived workflow and validation surface

Keep `scripts/shared/workflow-inventory.mjs` as the authority for:

- validation scenario IDs
- execution policy (`automated`, `guarded`, `non_cli`)
- entry paths
- real-life tasks and alternate tasks
- family-level coverage summaries

Do not move this data into `src/public-surface/source.ts`.
Do not create a second YAML or JSON registry.

### Presentation boundary for next-step guidance

Normalize follow-up guidance at the CLI presentation layer, not by forcing every producer into a new schema.

Recommended extraction priority:

1. Workflow provider guidance:
   - `meta.primaryConstraintSummary`
   - `meta.primaryConstraint.guidance.recommendedNextCommands[0]`
2. Diagnostics:
   - `suggestedNextAction`
3. Challenge plans:
   - `suggestedSteps[0].reason`
4. Audit bundles:
   - `sessionInspector.suggestedNextAction`
   - fallback `challengePlan.suggestedSteps[0].reason`
5. Canvas:
   - first entry in `guidance.recommendedNextCommands[]` when a compact text summary is useful

CLI text-mode rule:

- one summary sentence
- optionally one `Next step: ...` line
- never a full playbook dump

Tool/JSON rule:

- keep raw structured payloads as they are today
- do not inject broad human-prose wrappers into the generic tool envelope

## Recommended Fixes

1. **Canonicalize CLI descriptions in `src/public-surface/source.ts`.**
   Files: `src/public-surface/source.ts`, `scripts/generate-public-surface-manifest.mjs`, generated manifest snapshots, `src/cli/help.ts`, `tests/public-surface-manifest.test.ts`, `tests/cli-help-parity.test.ts`.

2. **Make help fully source-driven and more cross-linked.**
   Use the manifest for descriptions, keep tool pair rendering, add explicit pointers to `docs/WORKFLOW_SURFACE_MAP.md`, and clearly call out CLI-only versus tool-paired surfaces.

3. **Introduce a shared CLI follow-up helper for diagnostics and plans.**
   Reuse the existing workflow-message pattern and add a small extractor for `suggestedNextAction` and `suggestedSteps[0].reason`.

4. **Update session-inspector wrappers to surface next steps in text mode.**
   Files: `src/cli/commands/session/inspector.ts`, `src/cli/commands/session/inspector-plan.ts`, `src/cli/commands/session/inspector-audit.ts`.

5. **Keep tool payloads raw.**
   Do not change `src/tools/response.ts` globally. If a future tool needs richer follow-up guidance, add it to that specific producer's structured result, not to the universal tool envelope.

6. **Standardize step-by-step workflow guides in existing docs.**
   Use the current workflow sections in `docs/CLI.md` plus the validation table in `docs/WORKFLOW_SURFACE_MAP.md`. Add a uniform template for high-value lanes:
   - entry command
   - what to inspect in the output
   - next safe command or action
   - validation lane or proof scenario

7. **Explicitly surface hidden-ish categories.**
   Make CLI-only commands, tool-only local helpers, and guarded surfaces visible from `--help` and from the workflow map.

## Safe Rollout Order

1. Canonicalize CLI descriptions in `src/public-surface/source.ts` and the generated manifest.
2. Update `src/cli/help.ts` to consume those descriptions and add workflow-map references.
3. Add shared CLI follow-up extraction for session inspector, plan, and audit wrappers.
4. Add or refresh doc-level step guides in `docs/CLI.md` and `docs/WORKFLOW_SURFACE_MAP.md`.
5. Add parity tests for manifest descriptions and text-mode follow-up output.

## Guardrails

- Do not add a second discoverability registry.
- Do not let docs become a source of truth for command metadata.
- Do not rewrite the generic tool `ok()` envelope for the whole repo.
- Do not hide advanced or guarded commands behind a curated-only help mode.
- Do not emit long follow-up paragraphs in runtime responses.
- Do not duplicate existing structured fields with new aliases unless there is a real schema need.
- Do not fold workflow-validation metadata into the public-surface executable catalog.

## Attractive Ideas To Avoid

1. **A new `discoverability.json` or YAML catalog.**
   This would instantly create drift against `src/public-surface/source.ts` and `scripts/shared/workflow-inventory.mjs`.

2. **Global tool-response prose.**
   Injecting human explanations into every tool result would bloat the machine-facing API and make schemas harder to consume.

3. **Long next-step lists in every command response.**
   The right UX here is compact guidance, not a playbook dump.

4. **A full auto-registration rewrite now.**
   Manual runtime wiring plus parity tests is acceptable. The current issue is metadata ownership and presentation, not command dispatch.

5. **A second workflow-guide registry.**
   The existing workflow inventory and docs are enough for the first pass.

## Preventive Measures

- Add a parity test asserting that every runtime `registerCommand(...)` description matches the generated manifest description.
- Add text-mode tests for:
  - `research`
  - `shopping`
  - `product-video`
  - `inspiredesign`
  - `session-inspector`
  - `session-inspector-plan`
  - `session-inspector-audit`
- Add a docs drift assertion that `src/cli/help.ts` references `docs/WORKFLOW_SURFACE_MAP.md` once that pointer is added.
- Keep `docs/SURFACE_REFERENCE.md` and `docs/WORKFLOW_SURFACE_MAP.md` generated or drift-checked against source-derived counts and listings.

## Root-Cause Statement

No major capability is actually missing from the codebase. The current gap is that the canonical executable catalog, the validation catalog, and the help/rendering layer are not yet fully aligned on descriptive ownership and post-action presentation. Fixing that alignment is sufficient to make the surface substantially more discoverable without adding bloat or destabilizing existing behavior.

## Git History Notes

The current architecture direction is deliberate, not accidental:

- `1fb1c10` introduced the public-surface manifest direction.
- `80b21a2` added workflow next-step guidance in CLI/provider outputs.
- `bcf5458` introduced session diagnostics and structured session-inspector guidance.
- `3fb6197` added first-class operator review and inspection surfaces.
- `8066257` added the inspiredesign workflow surface.
- `c07df7e` updated the workflow surface documentation.

These commits all point in the same direction: source-derived inventory, thin runtime wrappers, and structured guidance in producer payloads. The recommended rollout above extends that direction instead of fighting it.

## Appended Implementation Plan

This section is append-only. It does not replace the investigation above.

### Objective

Implement discoverability and next-step guidance improvements without changing the investigation's core conclusion:

- `src/public-surface/source.ts` remains the only authored source of executable surface metadata.
- `scripts/shared/workflow-inventory.mjs` remains the code-derived authority for workflow and validation inventory.
- `src/tools/response.ts` remains a generic machine-facing envelope and is not globally humanized.
- No second discoverability registry is introduced.

### Delivery strategy

The safest execution order is:

1. Canonicalize CLI descriptions into the public-surface source and generated manifest.
2. Make help rendering consume that manifest directly and point more explicitly to the workflow surface map.
3. Expose already-existing structured next-step guidance in CLI text mode for the session-inspector family.
4. Add parity and docs-drift guardrails so the architecture cannot regress back into split metadata ownership.

### Exact implementation seams

#### Seam 1 - Canonical CLI descriptions

Goal: move CLI command descriptions out of runtime-only registration and into the authored public-surface source.

Files to edit:

- `src/public-surface/source.ts`
- `scripts/generate-public-surface-manifest.mjs`
- `src/public-surface/generated-manifest.ts`
- `src/public-surface/generated-manifest.json`

Exact edits:

1. In `src/public-surface/source.ts`:
   - Add `description: string` to `PublicSurfaceCliCommandDefinition`.
   - Add `description: string` to `CommandHelpDetail`.
   - Add `description: string` to `PublicSurfaceCliCommand`.
   - Backfill every command object inside `PUBLIC_CLI_COMMAND_GROUPS` with the exact description text currently used in `registerCommand(...)` inside `src/cli/index.ts`.
   - Update `CLI_COMMAND_HELP_DETAILS` so each entry includes `description` in addition to `usage` and `flags`.
   - Update `buildPublicSurfaceCliCommands()` so each emitted command record includes `description`.

2. In `scripts/generate-public-surface-manifest.mjs`:
   - Update `renderManifestModule(...)` so generated command records and generated `CLI_COMMAND_HELP_DETAILS` include `description`.
   - Keep the generator as a pure projection of `src/public-surface/source.ts`; do not add manual patch logic or secondary registries.

3. Regenerate:
   - `src/public-surface/generated-manifest.ts`
   - `src/public-surface/generated-manifest.json`

Why this seam comes first:

- It removes the largest remaining metadata split.
- It lets help become source-driven without needing runtime lookup.
- It preserves the existing architecture instead of layering new metadata beside it.

Acceptance criteria:

- Every CLI command entry in `PUBLIC_CLI_COMMAND_GROUPS` carries a non-empty description.
- Generated manifest command records include descriptions.
- Generated `CLI_COMMAND_HELP_DETAILS` includes descriptions.
- No new authored discoverability file exists.

Acceptance commands:

- `node scripts/generate-public-surface-manifest.mjs`
- `npm run test -- tests/public-surface-manifest.test.ts`

#### Seam 2 - Help convergence and cross-linking

Goal: make help render from the generated manifest for command descriptions and strengthen first-contact discoverability using existing docs.

Files to edit:

- `src/cli/help.ts`
- `tests/cli-help-parity.test.ts`
- `scripts/docs-drift-check.mjs`

Exact edits:

1. In `src/cli/help.ts`:
   - Remove the `listCommands()` import.
   - Remove `getCommandDescriptions()` entirely.
   - Update `formatCommandGroups(...)` to read `description` from `COMMAND_HELP_DETAILS[command]` instead of a runtime description map.
   - Update `assertCommandCoverage(...)` so it validates `COMMAND_HELP_DETAILS[command].description` is present and non-empty.
   - Add `docs/WORKFLOW_SURFACE_MAP.md` to `HELP_REFERENCE_ENTRIES` with wording that it is the code-derived workflow and validation inventory.
   - Add one explicit discoverability row in the first-contact help surface that calls out:
     - CLI-only commands: `install`, `update`, `uninstall`, `help`, `version`, `serve`, `daemon`, `native`, `artifacts`, `rpc`
     - tool-only helpers: `opendevbrowser_prompting_guide`, `opendevbrowser_skill_list`, `opendevbrowser_skill_load`
   - Keep this as guidance text only. Do not add a second inventory table.

2. In `tests/cli-help-parity.test.ts`:
   - Add an assertion that help reference labels include `docs/WORKFLOW_SURFACE_MAP.md`.
   - Add an assertion that every generated help detail now includes a non-empty `description`.
   - Add a parity assertion that runtime `registerCommand(...)` descriptions in `src/cli/index.ts` match the generated manifest descriptions exactly.

3. In `scripts/docs-drift-check.mjs`:
   - Add a help-surface drift check that requires the workflow surface map pointer to remain present in `src/cli/help.ts` output metadata.

Why this seam comes second:

- Once descriptions are canonical, help can become a pure consumer.
- This improves discoverability without changing runtime command execution.
- It uses existing doc surfaces instead of inventing a new registry.

Acceptance criteria:

- `src/cli/help.ts` no longer imports `listCommands()`.
- Command descriptions in help come from generated metadata.
- Help references `docs/WORKFLOW_SURFACE_MAP.md`.
- Runtime description drift is caught by tests instead of help-time lookup.

Acceptance commands:

- `npm run test -- tests/cli-help-parity.test.ts`
- `node scripts/docs-drift-check.mjs`

#### Seam 3 - Compact CLI next-step guidance

Goal: expose already-existing structured guidance in CLI text mode for the session-inspector family without changing tool payload schemas.

Files to edit:

- `src/cli/utils/workflow-message.ts`
- `src/cli/commands/session/inspector.ts`
- `src/cli/commands/session/inspector-plan.ts`
- `src/cli/commands/session/inspector-audit.ts`
- `tests/cli-next-step-guidance.test.ts`

Exact edits:

1. In `src/cli/utils/workflow-message.ts`:
   - Keep `buildWorkflowCompletionMessage(...)` as the canonical compact style: one summary sentence plus one `Next step:`.
   - Add `readSuggestedNextAction(data: unknown): string | null` that reads top-level or nested `suggestedNextAction` from structured payloads.
   - Add `readSuggestedStepReason(data: unknown): string | null` that reads the first `suggestedSteps[0].reason` from challenge-plan-shaped results.
   - Add one small formatter helper for non-workflow completion messages if that makes the session wrapper logic consistent.

2. In `src/cli/commands/session/inspector.ts`:
   - Replace the static message with a compact completion message that appends `result.suggestedNextAction` when present.
   - Keep `data: result` unchanged.

3. In `src/cli/commands/session/inspector-plan.ts`:
   - Replace the static message with a compact completion message that appends `result.suggestedSteps[0].reason` when present.
   - Do not dump the full challenge plan into the message.

4. In `src/cli/commands/session/inspector-audit.ts`:
   - Replace the static message with a compact completion message that prefers:
     1. `result.sessionInspector.suggestedNextAction`
     2. fallback `result.challengePlan.suggestedSteps[0].reason`
   - Keep `data: result` unchanged.

5. Add a new focused test file `tests/cli-next-step-guidance.test.ts`:
   - Unit-test the session-inspector wrapper message behavior.
   - Unit-test the session-inspector-plan wrapper message behavior.
   - Unit-test the session-inspector-audit precedence rule.
   - Mock daemon responses rather than running full end-to-end browser flows.

Why a dedicated test file is justified here:

- These assertions are about wrapper output behavior, not help parity.
- Keeping them separate avoids overloading `tests/cli-help-parity.test.ts` with unrelated command-wrapper mocking.
- This is a targeted new file, not a new registry or new production subsystem.

Why `src/cli/index.ts` is not in the first-pass edit list:

- Text mode already prints `result.message` verbatim.
- Once wrappers return better messages, no generic payload introspection is needed.
- Avoiding a generic `emitResult(...)` heuristic keeps presentation logic close to the command seam that owns the payload shape.

Non-edit decision for this phase:

- Leave `src/tools/response.ts` unchanged.
- Leave `src/tools/session_inspector.ts`, `src/tools/research_run.ts`, and `src/tools/inspiredesign_run.ts` unchanged in the first pass.
- Leave canvas producer guidance unchanged; it is already producer-owned and visible in text mode through raw result output.

Acceptance criteria:

- `session-inspector` text output includes `Next step:` when `suggestedNextAction` is present.
- `session-inspector-plan` text output includes the first suggested step reason when present.
- `session-inspector-audit` prefers session-inspector guidance before challenge-plan fallback.
- JSON output remains unchanged because `data` payloads are untouched.
- Workflow wrappers keep the existing compact style from `buildWorkflowCompletionMessage(...)`.

Acceptance commands:

- `npm run test -- tests/cli-next-step-guidance.test.ts`

#### Seam 4 - Docs evidence and cross-links

Goal: keep the user-facing documentation aligned with the implementation and make the discoverability chain bidirectional.

Files to edit:

- `docs/WORKFLOW_SURFACE_MAP.md`
- `docs/SURFACE_DISCOVERABILITY_AND_NEXT_STEP_GUIDANCE_INVESTIGATION_2026-04-16.md`

Exact edits:

1. In `docs/WORKFLOW_SURFACE_MAP.md`:
   - Add one short note near the top summary or references area pointing readers to this investigation document for the rationale and implementation plan behind discoverability work.
   - Keep the workflow map code-derived and inventory-focused. Do not turn it into a second authored registry.

2. In `docs/SURFACE_DISCOVERABILITY_AND_NEXT_STEP_GUIDANCE_INVESTIGATION_2026-04-16.md`:
   - Append this implementation plan only.
   - Do not rewrite or collapse the investigation sections above.

Acceptance criteria:

- The existing investigation report body remains intact.
- The workflow map stays inventory-oriented and code-derived.
- The cross-link is additive and does not introduce duplicated inventories.

Acceptance commands:

- `node scripts/docs-drift-check.mjs`

### File-by-file edit list

Planned file edits for implementation:

1. `src/public-surface/source.ts`
2. `scripts/generate-public-surface-manifest.mjs`
3. `src/public-surface/generated-manifest.ts`
4. `src/public-surface/generated-manifest.json`
5. `src/cli/help.ts`
6. `src/cli/utils/workflow-message.ts`
7. `src/cli/commands/session/inspector.ts`
8. `src/cli/commands/session/inspector-plan.ts`
9. `src/cli/commands/session/inspector-audit.ts`
10. `tests/public-surface-manifest.test.ts`
11. `tests/cli-help-parity.test.ts`
12. `tests/cli-next-step-guidance.test.ts`
13. `scripts/docs-drift-check.mjs`
14. `docs/WORKFLOW_SURFACE_MAP.md`

Planned non-edits in first pass:

- `src/cli/index.ts`
- `src/tools/response.ts`
- `src/tools/session_inspector.ts`
- `src/tools/research_run.ts`
- `src/tools/inspiredesign_run.ts`
- `scripts/shared/workflow-inventory.mjs`
- `docs/SURFACE_REFERENCE.md`

### Guardrails for implementation

- Do not add `discoverability.json`, YAML registries, or a second source-of-truth file.
- Do not move workflow validation metadata into `src/public-surface/source.ts`.
- Do not inject human prose into the generic tool envelope in `src/tools/response.ts`.
- Do not add long multi-step playbooks to runtime command messages.
- Do not hide advanced or guarded surfaces behind curated-only help.
- Do not create a generic `emitResult(...)` payload introspection layer in `src/cli/index.ts` during the first pass.

### Acceptance test matrix

Focused acceptance commands:

1. Regenerate manifest artifacts:
   - `node scripts/generate-public-surface-manifest.mjs`

2. Source-to-generated manifest parity:
   - `npm run test -- tests/public-surface-manifest.test.ts`

3. Help and runtime parity:
   - `npm run test -- tests/cli-help-parity.test.ts`

4. Session-inspector next-step guidance wrappers:
   - `npm run test -- tests/cli-next-step-guidance.test.ts`

5. Docs drift:
   - `node scripts/docs-drift-check.mjs`

Broader regression commands after the focused set passes:

6. Lint:
   - `npm run lint`

7. Build:
   - `npm run build`

8. Broader smoke on help-led onboarding:
   - `node scripts/cli-onboarding-smoke.mjs`

9. Broader CLI regression matrix if needed before release:
   - `node scripts/cli-smoke-test.mjs`

Expected outcomes:

- Manifest parity passes with descriptions included.
- Help parity passes without using runtime `listCommands()` for descriptions.
- Runtime description drift fails tests if it reappears.
- Session-inspector text outputs expose compact next steps.
- Tool payloads remain raw and machine-friendly.
- Docs drift checks continue to enforce inventory counts and now also enforce the workflow-map pointer.

### Implementation order

Use this order during the actual change set:

1. `src/public-surface/source.ts`
2. `scripts/generate-public-surface-manifest.mjs`
3. regenerate `src/public-surface/generated-manifest.ts` and `src/public-surface/generated-manifest.json`
4. `src/cli/help.ts`
5. `tests/public-surface-manifest.test.ts`
6. `tests/cli-help-parity.test.ts`
7. `src/cli/utils/workflow-message.ts`
8. `src/cli/commands/session/inspector.ts`
9. `src/cli/commands/session/inspector-plan.ts`
10. `src/cli/commands/session/inspector-audit.ts`
11. `tests/cli-next-step-guidance.test.ts`
12. `scripts/docs-drift-check.mjs`
13. `docs/WORKFLOW_SURFACE_MAP.md`
14. run focused acceptance commands
15. run lint, build, and optional smoke lanes

### Definition of done

This plan is complete when all of the following are true:

- CLI descriptions are authored in `src/public-surface/source.ts` and generated into the manifest.
- `src/cli/help.ts` no longer depends on runtime `listCommands()` for descriptions.
- Help explicitly points to `docs/WORKFLOW_SURFACE_MAP.md`.
- Session-inspector, session-inspector-plan, and session-inspector-audit expose compact next-step guidance in text mode.
- Generic tool envelopes remain unchanged.
- The docs drift and parity tests make it hard to regress back into split discoverability ownership.