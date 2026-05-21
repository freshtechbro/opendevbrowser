# InspireDesign Harvest Recovery and Browser Output Artifacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `inspiredesign harvest` so Pinterest explicit URL recovery is valid, generated recovery guidance is executable, readiness is visible, diagnostic screenshot rejection is understandable, and omitted screenshot and screencast outputs save under workflow-style artifact roots.

**Architecture:** Keep the strict design-readiness gate and `interface_chrome_shell` rejection intact. Repair the command contract around it by sharing site-recipe URL compatibility validation, making Pinterest guidance URL-aware, and adding a browser artifact helper that writes omitted browser evidence to `.opendevbrowser/<namespace>/<uuid>` while preserving explicit caller paths.

**Tech Stack:** TypeScript, Node.js, Vitest, OpenDevBrowser daemon commands, provider workflows, guidance recipes, browser managers, Playwright or extension-backed screenshots, generated public-surface metadata.

---

## Background

The source investigation is `docs/investigations/inspiredesign-harvest-command-issues-2026-05-20.md`.

- `src/cli/commands/inspiredesign.ts:252-270` rejects `--provider` without `--query`, then separately allows harvest when either `--query` or `--url` exists. This blocks `--provider social/pinterest --url ...` before daemon dispatch.
- `src/providers/workflows.ts:1700-1717` repeats the same provider-without-query rejection in workflow normalization, so direct daemon and tool calls are also blocked.
- `src/guidance/recipes/pinterest.ts:146-176` registers Pinterest as an authenticated-preferred site recipe and explicitly lists URL recovery.
- `src/guidance/recipes/generic.ts:62-76`, `src/guidance/recipes/generic.ts:398-423`, and `src/guidance/recipes/generic.ts:558-572` route Pinterest recovery through a generic command builder that repeats query/provider search instead of URL-first recovery.
- `src/inspiredesign/reference-pattern-board.ts:274-321` emits `interface_chrome_shell`; `src/inspiredesign/reference-pattern-board.ts:424-477` rejects blocking diagnostic evidence unless the strict Pinterest metadata exception applies.
- `tests/providers-inspiredesign-contract.test.ts:1210-1294` requires chrome-only Pinterest captures to remain rejected while clean screenshot-backed Pinterest metadata can be usable.
- `tests/providers-inspiredesign-workflow.test.ts:2162-2186` requires accepted Pinterest URLs plus zero ranked references to produce `readiness === "diagnostic_only"` and block Canvas continuation.
- `src/providers/workflow-output-root.ts:3-18` defaults workflow artifacts to `.opendevbrowser`; `src/providers/artifacts.ts:44-60` writes `<root>/<namespace>/<uuid>`.
- `src/browser/browser-manager.ts:1999-2059` and `src/browser/ops-browser-manager.ts:891-918` return base64 when screenshot `path` is omitted.
- `src/browser/screencast-recorder.ts:104-118` writes omitted screencasts under `.opendevbrowser/replays/screencasts/<sessionId>/<screencastId>`, not `.opendevbrowser/screencast/<uuid>`.

## Recommended Decisions

- Use `.opendevbrowser/screenshot/<uuid>/capture.png` for omitted screenshot output.
- Use `.opendevbrowser/screencast/<uuid>/` for omitted screencast output, with existing replay files inside that directory.
- Treat `screencast` as the final namespace, not `browser-replay`, because the user named screenshot and screencast and the public CLI command is `screencast-start`.
- Preserve explicit `--path` and `--output-dir` behavior as caller-controlled paths.
- Apply omitted-output artifact behavior consistently across CLI, daemon, and tool calls because all route through the same managers.
- For omitted screenshots, switch all surfaces from base64-only output to persisted file output with `path` and `artifact_path`. Do not keep base64 additively unless a future explicit in-memory screenshot mode is requested.
- Serialize captured-but-rejected diagnostics in `ranked-references.json` under `rejectedReferences`, since that file already contains `qualitySummary`, ready `references`, rejected references, and synthesis.
- Do not weaken `interface_chrome_shell`; make diagnostics clearer instead.

## Dependency Map

```text
Task 1 browser artifact helper
  -> Task 2 omitted screenshot artifacts
  -> Task 3 omitted screencast artifacts
  -> Task 11 public surface and docs

Task 4 site-recipe URL validation helper
  -> Task 5 CLI validation
  -> Task 6 workflow normalization
  -> Task 7 URL-aware Pinterest guidance

Task 8 readiness messaging
Task 9 captured-but-rejected diagnostics
  -> Task 10 focused tests
  -> Task 11 docs and generated surface
```

## Workstream Order

Keep this as one plan, but implement in two atomic workstreams to reduce review risk.

1. Harvest recovery workstream: Tasks 4, 5, 6, 7, 8, 9, and their focused tests.
2. Browser output artifact workstream: Tasks 1, 2, 3, and their focused tests.
3. Shared closeout workstream: Tasks 10, 11, and 12 after both behavior lanes are implemented.

## Task Dependency Sequence

1. Browser artifact helper.
2. Screenshot omitted output.
3. Screencast omitted output.
4. Site-recipe URL compatibility helper.
5. CLI harvest validation.
6. Workflow normalization.
7. Pinterest recovery guidance.
8. Readiness surfacing.
9. Captured-but-rejected diagnostics.
10. Focused tests.
11. Public surface, docs, generated manifest, changelog.
12. Targeted and full verification.

## Task 1 - Add Browser Output Artifact Helper

Reasoning: Screenshot and screencast omitted outputs need one workflow-style root helper instead of duplicating path construction in managers.

What to do: Add a small helper that creates omitted browser artifact directories under `.opendevbrowser/<namespace>/<uuid>`.

How:
1. Create `src/providers/browser-output-artifacts.ts`.
2. Export `BROWSER_SCREENSHOT_ARTIFACT_NAMESPACE = "screenshot"` and `BROWSER_SCREENCAST_ARTIFACT_NAMESPACE = "screencast"`.
3. Add `createBrowserOutputArtifactDirectory({ workspaceRoot, namespace })`.
4. Inside the helper, call `resolveWorkflowArtifactRoot(undefined, { workspaceRoot })`.
5. Generate `randomUUID()` and create `<root>/<namespace>/<uuid>` with `mkdir(..., { recursive: true, mode: 0o700 })`.
6. Return `{ artifactPath, namespace, runId }`.
7. Add a unit test file `tests/browser-output-artifacts.test.ts`.

Files impacted:
- New: `src/providers/browser-output-artifacts.ts`
- New: `tests/browser-output-artifacts.test.ts`
- Existing: `src/providers/workflow-output-root.ts` only if a shared type export is needed.

End goal: Browser evidence has the same omitted-root contract as workflows without coupling browser managers to provider workflow bundles.

Acceptance criteria:
- [ ] Helper returns `.opendevbrowser/screenshot/<uuid>` for screenshot when no explicit path is provided.
- [ ] Helper returns `.opendevbrowser/screencast/<uuid>` for screencast when no explicit output directory is provided.
- [ ] Helper rejects blank namespaces.
- [ ] Helper does not process explicit caller paths.

## Task 2 - Persist Omitted Screenshot Output

Reasoning: The user requested screenshot output parity, but omitted screenshots currently return base64 and write no artifact.

What to do: Route omitted screenshot calls through the browser artifact helper and write `capture.png`.

How:
1. Update `src/browser/browser-manager.ts` screenshot handling.
2. When `options.path` is omitted, call `createBrowserOutputArtifactDirectory({ workspaceRoot: this.worktree, namespace: BROWSER_SCREENSHOT_ARTIFACT_NAMESPACE })`.
3. Set the Playwright or CDP write path to `<artifactPath>/capture.png`.
4. Return `path` and `artifact_path` for omitted outputs.
5. Preserve current explicit path behavior when `options.path` is provided.
6. Mirror the same omitted-path logic in `src/browser/ops-browser-manager.ts`.
7. Update screenshot result typing where the result shape is declared.
8. Remove omitted-path base64 expectations from CLI, daemon, tool, manager, and ops tests. Omitted screenshots now persist by default.

Files impacted:
- `src/browser/browser-manager.ts`
- `src/browser/ops-browser-manager.ts`
- Type definition file if screenshot result shape is declared outside those managers.
- `tests/cli-screenshot.test.ts`
- `tests/browser-manager.test.ts` if manager-level screenshot tests exist or need expansion.

End goal: `npx opendevbrowser screenshot --session-id <id>` writes a workspace-local PNG artifact by default.

Acceptance criteria:
- [ ] Omitted screenshot output writes `.opendevbrowser/screenshot/<uuid>/capture.png`.
- [ ] Omitted screenshot response includes a filesystem `path`.
- [ ] Omitted screenshot response includes `artifact_path` pointing to `.opendevbrowser/screenshot/<uuid>`.
- [ ] Omitted screenshot response does not return base64 by default on CLI, daemon, manager, ops, or direct tool surfaces.
- [ ] Explicit `--path ./somewhere/capture.png` does not create a screenshot artifact directory.
- [ ] Managed and extension-backed screenshot lanes are consistent.

## Task 3 - Persist Omitted Screencast Output Under Screencast Namespace

Reasoning: Omitted screencasts already write files, but the current root is `.opendevbrowser/replays/screencasts/<sessionId>/<screencastId>` instead of workflow-style `.opendevbrowser/screencast/<uuid>`.

What to do: Use the browser artifact helper for omitted screencast output and keep existing replay file names.

How:
1. Update `src/browser/screencast-recorder.ts`.
2. Keep explicit `options.outputDir` resolution unchanged, including relative resolution against `worktree`.
3. For omitted `options.outputDir`, call `createBrowserOutputArtifactDirectory({ workspaceRoot: worktree, namespace: BROWSER_SCREENCAST_ARTIFACT_NAMESPACE })`.
4. Set `outputDir` to the returned `artifactPath`.
5. Preserve `frames/`, `replay.json`, `replay.html`, and `preview.png`.
6. Add `artifact_path` to returned screencast metadata if the current result type can be expanded additively.
7. Keep non-empty explicit output directory rejection unchanged.

Files impacted:
- `src/browser/screencast-recorder.ts`
- `src/browser/browser-manager.ts`
- `src/browser/ops-browser-manager.ts`
- `tests/browser-screencast-recorder.test.ts`
- `tests/browser-manager.test.ts`
- `tests/cli-screencast.test.ts`

End goal: `screencast-start` without `--output-dir` writes replay artifacts to `.opendevbrowser/screencast/<uuid>`.

Acceptance criteria:
- [ ] Omitted screencast output directory matches `.opendevbrowser/screencast/<uuid>`.
- [ ] Directory contains `replay.json`, `replay.html`, `frames/`, and `preview.png` after completion.
- [ ] Explicit `--output-dir ./artifacts/replay` remains caller-controlled.
- [ ] Existing non-empty output directory protection still works.

## Task 4 - Add Site-Recipe URL Compatibility Validation

Reasoning: Provider-scoped URL recovery should be valid only for browser-native site recipes whose providers and URLs match.

What to do: Add one shared validation helper used by CLI and workflow normalization.

How:
1. Create `src/guidance/recipes/site-recipe-validation.ts`.
2. Import `resolveSiteRecipeForProvider` and `resolveSiteRecipeForUrl` from `src/guidance/recipes/site-registry.ts`.
3. Add `validateProviderUrlSiteRecipeCompatibility({ providers, urls })`.
4. Require at least one provider and one URL for this helper.
5. Require every provider to resolve to a site recipe.
6. Require every URL to resolve to a site recipe.
7. Require all resolved recipe ids to match.
8. Return a typed result such as `{ ok: true, recipeId }` or `{ ok: false, message }`.
9. Add tests covering Pinterest positive, Pinterest plus non-Pinterest URL negative, generic provider negative, and multiple-provider mismatch negative.

Files impacted:
- New: `src/guidance/recipes/site-recipe-validation.ts`
- New or existing test: `tests/guidance-site-recipe-validation.test.ts`

End goal: Provider-without-query validation has a precise shared rule instead of blanket rejection.

Acceptance criteria:
- [ ] `social/pinterest` plus a Pinterest URL is compatible.
- [ ] `pinterest` plus a Pinterest URL is compatible.
- [ ] `social/pinterest` plus `https://example.com/...` is incompatible.
- [ ] `web/default` plus any URL without query remains incompatible.
- [ ] Blank or missing URL/provider cases produce clear messages.

## Task 5 - Relax CLI Harvest Validation For Compatible URL Recovery

Reasoning: CLI validation currently rejects the exact Pinterest recovery command shape before daemon dispatch.

What to do: Replace blanket provider-without-query rejection in `src/cli/commands/inspiredesign.ts`.

How:
1. Import `validateProviderUrlSiteRecipeCompatibility`.
2. Keep `run` rejecting `--query`.
3. Keep `harvest` requiring either `--query` or `--url`.
4. If providers exist and query is absent, require URLs and validate provider-URL compatibility.
5. If compatibility fails, throw the helper message.
6. If compatibility succeeds, allow dispatch.
7. Add CLI tests for accepted Pinterest provider plus URL, rejected generic provider plus URL, and rejected provider without query or URL.

Files impacted:
- `src/cli/commands/inspiredesign.ts`
- `tests/cli-workflows.test.ts`

End goal: `inspiredesign harvest --provider social/pinterest --url <pinterest-url>` is a valid CLI recovery shape.

Acceptance criteria:
- [ ] Compatible provider plus URL dispatches to `inspiredesign.run`.
- [ ] Provider without query and without URL still rejects.
- [ ] Generic provider plus URL without query still rejects.
- [ ] Existing query/provider harvest behavior remains unchanged.

## Task 6 - Relax Workflow Normalization With The Same Rule

Reasoning: Direct tool and daemon callers must follow the same contract as CLI callers.

What to do: Apply the Task 4 helper inside `normalizeInspiredesignInput()` in `src/providers/workflows.ts`.

How:
1. Import `validateProviderUrlSiteRecipeCompatibility`.
2. Replace `providers.length > 0 && !query` rejection.
3. If providers exist and query is absent, require URLs and validate compatibility.
4. Preserve missing harvest input rejection.
5. Preserve query-only restrictions for non-harvest modes.
6. Update direct workflow and daemon tests.

Files impacted:
- `src/providers/workflows.ts`
- `tests/tools-workflows.test.ts`
- `tests/daemon-commands.integration.test.ts`

End goal: CLI, daemon, and direct workflow surfaces agree on provider-scoped explicit URL recovery.

Acceptance criteria:
- [ ] Direct workflow accepts Pinterest provider plus Pinterest URL.
- [ ] Direct workflow rejects generic provider plus URL without query.
- [ ] Daemon integration tests cover the same positive and negative paths.
- [ ] Existing missing-input validation remains intact.

## Task 7 - Make Pinterest Recovery Guidance URL-Aware

Reasoning: Recovery guidance currently recommends rerunning the same query/provider discovery instead of using accepted explicit URLs.

What to do: Carry accepted or requested URLs into guidance context and emit URL-first Pinterest recovery commands when available.

How:
1. Update `src/guidance/context.ts` to preserve relevant URLs from the inspiredesign guidance source.
2. Extend the guidance type in `src/guidance/types.ts` if needed with a narrow URL field.
3. Update `src/providers/workflows.ts:2893-2934` only if the source does not already include enough URL data.
4. Update `src/guidance/recipes/generic.ts` command construction.
5. If context is Pinterest-scoped and URLs exist, emit repeated `--url` flags and `--provider social/pinterest`.
6. Preserve query/provider command generation when no usable URL exists.
7. Preserve Pinterest browser settings: `--browser-mode extension`, `--use-cookies`, `--cookie-policy required`, and `--challenge-automation-mode browser_with_helper`.
8. Add workflow or guidance tests that assert the generated recovery command is executable under the new validation rule.

Files impacted:
- `src/guidance/context.ts`
- `src/guidance/types.ts`
- `src/providers/workflows.ts`
- `src/guidance/recipes/generic.ts`
- `tests/providers-inspiredesign-workflow.test.ts`
- Additional guidance tests if present.

End goal: Pinterest diagnostic-only recovery tells users to retry accepted explicit Pinterest URLs instead of repeating the failed discovery shape.

Acceptance criteria:
- [ ] Diagnostic-only Pinterest guidance includes URL-first recovery when URLs exist.
- [ ] URL-first command includes `--provider social/pinterest`.
- [ ] Guidance falls back to query/provider recovery only when no URLs are available.
- [ ] Canvas continuation remains gated until readiness is `ready`.

## Task 8 - Surface Readiness Beside Wrapper Success

Reasoning: `{ success: true }` is transport completion, not design readiness; CLI users need the readiness state surfaced without changing command success semantics.

What to do: Update inspiredesign CLI completion messaging and, if type-safe, add an additive readiness field.

How:
1. Update `src/cli/commands/inspiredesign.ts`.
2. Read `data.meta.nextStepGuidance.readiness` after daemon completion.
3. Include `readiness=<value>` in the success message when present.
4. Do not change wrapper `success: true`.
5. Do not treat `diagnostic_only` as a CLI error.
6. Add CLI tests for diagnostic-only and ready message output.

Files impacted:
- `src/cli/commands/inspiredesign.ts`
- `tests/cli-workflows.test.ts`

End goal: A successful non-ready harvest cannot be mistaken for design-ready output by reading only the CLI message.

Acceptance criteria:
- [ ] Diagnostic-only CLI result message includes `readiness=diagnostic_only`.
- [ ] Ready CLI result message includes `readiness=ready`.
- [ ] Existing `nextStepGuidance` payload remains nested under `data.meta`.
- [ ] Existing transport success semantics remain unchanged.

## Task 9 - Explain Captured-But-Rejected Screenshot Diagnostics

Reasoning: Strict screenshot rejection is correct, but artifacts should explain why captured screenshots did not become design references.

What to do: Populate `ranked-references.json.rejectedReferences` with explicit diagnostic metadata for captured visual evidence rejected due to interface chrome.

How:
1. Inspect current rejected reference serialization in `src/inspiredesign/reference-pattern-board.ts` and `src/inspiredesign/contract.ts`.
2. Ensure `ranked-references.json.rejectedReferences` is populated for diagnostic-only rejected captures instead of staying empty when `rejectedReferenceCount` is greater than zero.
3. Add narrow fields such as `captured: true`, `diagnosticReasons`, and `capturedButRejectedReason`.
4. Include capture status, diagnostic reason, and the evidence gap.
5. Do not include raw screenshot data, full DOM, full snapshot text, or browser chrome titles as design-facing reference content.
6. Update contract and workflow tests.

Files impacted:
- `src/inspiredesign/reference-pattern-board.ts`
- `src/inspiredesign/contract.ts`
- `tests/providers-inspiredesign-contract.test.ts`
- `tests/providers-inspiredesign-workflow.test.ts`

End goal: `ranked-references.json.rejectedReferences` makes captured-but-rejected Pinterest screenshots understandable without weakening safety.

Acceptance criteria:
- [ ] Chrome-only Pinterest screenshots remain rejected.
- [ ] Clean screenshot-backed Pinterest metadata remains usable.
- [ ] `ranked-references.json.rejectedReferences` is non-empty when captured screenshots are rejected and `rejectedReferenceCount` is greater than zero.
- [ ] Rejected diagnostics identify `interface_chrome_shell`.
- [ ] Design-facing artifacts do not promote diagnostic-only captures into reference patterns.

## Task 10 - Update Focused Tests

Reasoning: The changes alter validation, guidance, output artifacts, messaging, and docs surfaces; each branch needs regression coverage.

What to do: Add and adjust focused tests before full quality gates.

How:
1. Update `tests/browser-output-artifacts.test.ts` for helper roots and namespace validation.
2. Update `tests/cli-screenshot.test.ts` for omitted screenshot artifact output and explicit path preservation.
3. Update `tests/cli-screencast.test.ts` for omitted screencast artifact output and explicit output directory preservation.
4. Update `tests/browser-screencast-recorder.test.ts` for `.opendevbrowser/screencast/<uuid>` omitted output.
5. Update `tests/cli-workflows.test.ts` for CLI provider plus URL validation and readiness message.
6. Update `tests/tools-workflows.test.ts` for direct workflow provider plus URL validation.
7. Update `tests/daemon-commands.integration.test.ts` for daemon provider plus URL validation and browser omitted output dispatch if daemon tests cover it.
8. Update `tests/providers-inspiredesign-workflow.test.ts` for URL-first guidance.
9. Update `tests/providers-inspiredesign-contract.test.ts` for captured-but-rejected diagnostics.

Files impacted:
- `tests/browser-output-artifacts.test.ts`
- `tests/cli-screenshot.test.ts`
- `tests/cli-screencast.test.ts`
- `tests/browser-screencast-recorder.test.ts`
- `tests/cli-workflows.test.ts`
- `tests/tools-workflows.test.ts`
- `tests/daemon-commands.integration.test.ts`
- `tests/providers-inspiredesign-workflow.test.ts`
- `tests/providers-inspiredesign-contract.test.ts`

End goal: Every changed branch has a failing-before, passing-after test.

Acceptance criteria:
- [ ] Positive Pinterest provider plus URL recovery is tested.
- [ ] Negative generic provider plus URL recovery is tested.
- [ ] Omitted screenshot artifact path is tested.
- [ ] Omitted screencast artifact path is tested.
- [ ] Explicit output paths remain tested.
- [ ] Strict chrome diagnostic rejection remains tested.

## Task 11 - Update Public Surface, Docs, And Changelog

Reasoning: The behavior changes are user-facing and affect generated help, docs, and public surface inventory.

What to do: Update source-owned public surface metadata, generated output, docs, and changelog.

How:
1. Update `src/public-surface/source.ts` screenshot and screencast entries.
2. Regenerate checked-in manifests with `node scripts/generate-public-surface-manifest.mjs`.
3. Confirm both `src/public-surface/generated-manifest.ts` and `src/public-surface/generated-manifest.json` changed only as expected.
4. Update `src/cli/help.ts` only if it is not generated from the public-surface source.
5. Update `docs/CLI.md` with:
   - provider-scoped Pinterest URL recovery example
   - readiness wording
   - omitted screenshot artifact path
   - omitted screencast artifact path
   - explicit path preservation note
6. Update `docs/SURFACE_REFERENCE.md` with the same public-surface behavior.
7. Update `CHANGELOG.md` under `[Unreleased]`.
8. Do not rewrite historical release evidence as if it originally had the new behavior. If needed, add a short note that later browser evidence output behavior supersedes prior exception text.

Files impacted:
- `src/public-surface/source.ts`
- `src/public-surface/generated-manifest.ts`
- `src/public-surface/generated-manifest.json`
- `src/cli/help.ts`
- `docs/CLI.md`
- `docs/SURFACE_REFERENCE.md`
- `CHANGELOG.md`
- `docs/RELEASE_0.0.30_EVIDENCE.md` only if current wording would become misleading.

End goal: CLI help, docs, generated manifest, and changelog match the implemented behavior.

Acceptance criteria:
- [ ] Help and docs show omitted screenshot output under `.opendevbrowser/screenshot/<uuid>/capture.png`.
- [ ] Help and docs show omitted screencast output under `.opendevbrowser/screencast/<uuid>`.
- [ ] Docs distinguish omitted output behavior from explicit path behavior.
- [ ] Docs mention readiness as the design gate.
- [ ] Generated manifest has no drift from source metadata.

## Task 12 - Run Verification And Real-World Validation

Reasoning: The repo requires real validation, not only static review, and this work changes CLI behavior.

What to do: Run focused tests, full gates, help checks, and real CLI validation.

How:
1. Run focused tests:

```bash
npm run test -- tests/browser-output-artifacts.test.ts
npm run test -- tests/cli-screenshot.test.ts
npm run test -- tests/cli-screencast.test.ts
npm run test -- tests/browser-screencast-recorder.test.ts
npm run test -- tests/cli-workflows.test.ts
npm run test -- tests/tools-workflows.test.ts
npm run test -- tests/daemon-commands.integration.test.ts
npm run test -- tests/providers-inspiredesign-contract.test.ts
npm run test -- tests/providers-inspiredesign-workflow.test.ts
```

2. Run full quality gates:

```bash
npm run lint
npm run typecheck
npm run build
npm run test
npm run extension:build
npm run version:check
npm run test:release-gate
```

3. Run help checks when help or public surface changes:

```bash
npx opendevbrowser --help
npx opendevbrowser help
```

4. Run Pinterest explicit URL recovery after implementation:

```bash
npx opendevbrowser inspiredesign harvest \
  --brief "Fashion design studio landing page with atelier motion references" \
  --provider social/pinterest \
  --url "https://www.pinterest.com/pin/27654985208435505/" \
  --max-references 5 \
  --visual-evidence required \
  --browser-mode extension \
  --use-cookies \
  --cookie-policy required \
  --challenge-automation-mode browser_with_helper \
  --mode json \
  --output-format json
```

5. Run omitted screenshot validation against a real session:

```bash
npx opendevbrowser screenshot \
  --session-id <session-id> \
  --output-format json
```

6. Run omitted screencast validation against a real session:

```bash
npx opendevbrowser screencast-start \
  --session-id <session-id> \
  --interval-ms 1000 \
  --max-frames 3 \
  --output-format json
```

7. Run explicit output preservation checks:

```bash
npx opendevbrowser screenshot \
  --session-id <session-id> \
  --path ./artifacts/manual-capture.png \
  --output-format json

npx opendevbrowser screencast-start \
  --session-id <session-id> \
  --output-dir ./artifacts/manual-replay \
  --interval-ms 1000 \
  --max-frames 3 \
  --output-format json
```

Files impacted:
- None directly.

End goal: Implementation is proven through focused tests, full gates, help checks, and realistic CLI tasks.

Acceptance criteria:
- [ ] Focused tests pass.
- [ ] Full tests pass with required coverage.
- [ ] Lint, typecheck, build, extension build, version check, and release gate pass.
- [ ] Help commands render the new behavior.
- [ ] Real Pinterest explicit URL recovery command is accepted.
- [ ] Omitted screenshot writes `.opendevbrowser/screenshot/<uuid>/capture.png`.
- [ ] Omitted screencast writes `.opendevbrowser/screencast/<uuid>`.
- [ ] Explicit output paths remain caller-controlled.

## Risks And Mitigations

- Risk: Provider validation accidentally allows generic providers without query. Mitigation: require every provider and URL to resolve to the same site recipe.
- Risk: Some callers expect omitted screenshots to return base64 only. Mitigation: treat persistent omitted output as an intentional behavior change, update tests and docs, and keep explicit path behavior stable.
- Risk: Screencast namespace change breaks consumers of `.opendevbrowser/replays/screencasts/...`. Mitigation: preserve explicit output directory behavior and document the new omitted-output contract clearly.
- Risk: Readiness messaging could be mistaken for command failure. Mitigation: keep wrapper `success: true` and surface readiness as additional state.
- Risk: Generated public-surface drift. Mitigation: update `src/public-surface/source.ts`, regenerate `src/public-surface/generated-manifest.json`, and run help parity tests.

## Final Acceptance Criteria

- [ ] No source implementation happens during this planning task.
- [ ] `inspiredesign harvest --provider social/pinterest --url <pinterest-url>` is supported after implementation.
- [ ] Generic provider-without-query remains rejected.
- [ ] Pinterest recovery guidance emits executable URL-first recovery commands when accepted URLs exist.
- [ ] Strict `interface_chrome_shell` blocking is preserved.
- [ ] Captured-but-rejected screenshots are explained in artifacts or guidance.
- [ ] Omitted screenshots write to `.opendevbrowser/screenshot/<uuid>/capture.png`.
- [ ] Omitted screencasts write to `.opendevbrowser/screencast/<uuid>`.
- [ ] Explicit screenshot and screencast output paths are preserved.
- [ ] Tests, docs, help, public surface, generated manifest, and changelog are updated.
- [ ] Targeted and full quality gates pass with zero errors and zero warnings.
