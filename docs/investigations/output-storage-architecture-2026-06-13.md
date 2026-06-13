# Investigation: Output Storage Architecture

Historical note: this investigation records the pre-implementation state that motivated the output-storage alignment work. The branch implementing `docs/plans/output-storage-contract-alignment-2026-06-13.md` removes the `${TMPDIR:-/tmp}/opendevbrowser` cleanup default, removes the low-level bundle writer temp fallback, and hardens bundle cleanup and file writes against path escape risks.

## Summary
The critique is mostly confirmed. The four main artifact bundle workflows use `.opendevbrowser/<namespace>/<run-id>/bundle-manifest.json` when their entrypoint supplies or resolves a workflow root, but adjacent output lanes are intentionally non-bundle contracts and two legacy seams still point at `${TMPDIR:-/tmp}/opendevbrowser`.

The biggest nuance is entrypoint-specific root selection. CLI workflow invocations are project or invocation cwd local by default, while direct tools and direct daemon RPC route omitted roots through `core.cacheRoot`; that may be correct, but it is not the same as a universal project-root contract.

## Symptoms
- The expected mental model is `<project-root>/.opendevbrowser/<workflow-namespace>/<run-id>/` for artifact-bearing workflows.
- Prior read-only tracing found the four workflow bundle families mostly honor that model, while Canvas, screenshot, screencast, annotation, desktop observation, and release scripts have different storage contracts.
- Prior critique identified three suspected risks: artifact cleanup defaulting to `/tmp/opendevbrowser`, the low-level bundle writer retaining a `/tmp/opendevbrowser` fallback, and direct tool relative `outputDir` handling differing from CLI daemon dispatch.

## Background / Prior Research
- No external web research was required. The question is about current workspace architecture and source-level contracts.
- Prior user-facing investigation summary reported that `research`, `shopping`, `inspiredesign`, and `product-video` workflow bundles use `.opendevbrowser/<namespace>/<uuid>/bundle-manifest.json` when output is omitted.
- Prior user-facing critique reported non-bundle exceptions for Canvas, screenshots, screencasts, annotation inbox/screenshots, desktop audit, and release scripts.

## Investigator Findings
<!-- Pair investigator appends structured findings here. -->

### 2026-06-13 main investigator verification

Conclusion: the critique is mostly confirmed. The main provider workflow bundles use the workspace or invocation `.opendevbrowser/<namespace>/<run-id>/bundle-manifest.json` contract when output is omitted, while Canvas, browser captures, annotation, and desktop observation intentionally use adjacent non-bundle contracts. The real drift risks are the low-level bundle writer's temp fallback and `artifacts cleanup` defaulting to `${TMPDIR:-/tmp}/opendevbrowser`, which does not match the omitted workflow bundle root.

#### Hypothesis 1 - main workflow bundles
- Confirmed. `resolveWorkflowArtifactRoot()` defines `.opendevbrowser` and sends omitted output to `options.workspaceRoot ?? process.cwd()` plus that directory, rejects blank strings, and preserves explicit strings (`src/providers/workflow-output-root.ts:3`, `src/providers/workflow-output-root.ts:9-19`).
- Confirmed. `createArtifactBundle()` creates `<root>/<namespace>/<uuid>/`, writes bundle files, and writes `bundle-manifest.json`; manifest fields are `run_id`, `created_at`, `ttl_hours`, `expires_at`, and `files` (`src/providers/artifacts.ts:16-22`, `src/providers/artifacts.ts:44-78`).
- Confirmed call sites: research resolves `outputDir` then bundles namespace `research` (`src/providers/workflows.ts:5461-5463`, `src/providers/workflows.ts:5635-5640`); shopping does the same for `shopping` (`src/providers/workflows.ts:5678-5680`, `src/providers/workflows.ts:5846-5851`); inspiredesign does the same for `inspiredesign` (`src/providers/workflows.ts:5883-5885`, `src/providers/workflows.ts:6228-6238`); product-video resolves snake_case `output_dir` and bundles namespace `product-video` (`src/providers/workflows.ts:6317-6319`, `src/providers/workflows.ts:6672-6677`).
- Eliminated overclaim: omitted main workflow output does not fall through to `/tmp/opendevbrowser`, because every workflow passes the resolved root into `createArtifactBundle()` (`src/providers/artifacts.ts:53-55`, call-site refs above). Product-video also invokes shopping resolution when it must resolve a product name, so a product-name run can create a supporting `shopping` bundle under the same root before the final `product-video` bundle (`src/providers/workflows.ts:6404-6417`).

#### Hypothesis 2 - CLI, daemon, and direct tool output-dir resolution
- Confirmed. CLI workflow flags use `resolveWorkflowOutputDirFlag()`, which defaults to `.opendevbrowser`, rejects blanks, and returns `path.resolve(value)`, so omitted and relative CLI `--output-dir` become absolute before daemon dispatch (`src/cli/commands/workflow-output.ts:5-12`).
- Confirmed per command: research parses and sends resolved `outputDir` (`src/cli/commands/research.ts:185-192`, `src/cli/commands/research.ts:292-294`); shopping does the same (`src/cli/commands/shopping.ts:175-182`, `src/cli/commands/shopping.ts:262-264`); inspiredesign does the same (`src/cli/commands/inspiredesign.ts:207-214`, `src/cli/commands/inspiredesign.ts:353-355`); product-video parses `--output-dir` and sends resolved `output_dir` (`src/cli/commands/product-video.ts:106-113`, `src/cli/commands/product-video.ts:220-222`).
- Confirmed. Direct OpenCode tools preserve explicit relative output roots because `resolveWorkflowToolOutputDir()` immediately returns provided `outputDir`; omitted roots use `deps.workspaceRoot` if present, and `src/index.ts` supplies `workspaceRoot: core.cacheRoot` in tool deps (`src/tools/workflow-output.ts:5-14`, `src/index.ts:78-90`). Tool wrappers feed that helper into all four workflows (`src/tools/research_run.ts:49`, `src/tools/shopping_run.ts:47`, `src/tools/inspiredesign_run.ts:108`, `src/tools/product_video_run.ts:82`).
- Confirmed. Direct daemon RPC uses `resolveDaemonWorkflowOutputDir(core, outputDir)`, so omitted roots become `core.cacheRoot/.opendevbrowser` and explicit strings remain caller-controlled (`src/cli/daemon-commands.ts:76-79`, `src/cli/daemon-commands.ts:854-869`, `src/cli/daemon-commands.ts:876-890`, `src/cli/daemon-commands.ts:895-914`, `src/cli/daemon-commands.ts:939-953`).

#### Hypothesis 3 - adjacent non-bundle contracts
- Confirmed. Canvas persists repo-native design documents and code-sync manifests under `.opendevbrowser/canvas/...`, not bundle manifests (`src/canvas/repo-store.ts:22-39`, `src/canvas/repo-store.ts:55-60`, `src/browser/canvas-manager.ts:1202-1248`).
- Confirmed. Omitted screenshots use a browser evidence helper that creates `.opendevbrowser/screenshot/<uuid>/capture.png` and returns `artifact_path`, with no bundle manifest (`src/providers/browser-output-artifacts.ts:6-39`, `src/browser/browser-manager.ts:2721-2761`).
- Confirmed. Screencasts use `.opendevbrowser/screencast/<uuid>` for `replay.json`, `replay.html`, `preview.png`, and `frames/`, with explicit output dirs resolved separately (`src/browser/screencast-recorder.ts:56-60`, `src/browser/screencast-recorder.ts:115-130`, `src/browser/screencast-recorder.ts:247-257`, `src/browser/screencast-recorder.ts:299-310`, `src/browser/screencast-recorder.ts:419-443`).
- Confirmed. Annotation screenshots are written to system temp as `opendevbrowser-annotate-*.png`, while shared inbox storage strips screenshot bytes and keeps only asset refs (`src/annotate/output.ts:14-31`, `src/annotate/output.ts:132-142`, `src/annotate/agent-inbox-store.ts:107-159`, `src/annotate/agent-inbox-store.ts:272-294`).
- Confirmed. Desktop observation writes audit JSON and capture PNGs through `config.desktop.auditArtifactsDir`, whose default is `.opendevbrowser/desktop-runtime` resolved against the cache root (`src/config.ts:463-467`, `src/desktop/runtime.ts:503-507`, `src/desktop/runtime.ts:596-598`, `src/desktop/audit.ts:55-84`, `src/desktop/runtime.ts:696-721`, `src/desktop/runtime.ts:788-845`).
- Confirmed. Release and validation scripts are a separate root `artifacts/` lane, not workflow bundles. For example, the live regression matrix writes `artifacts/live-regression-matrix-report.json` and, in release-gate mode, `artifacts/release/v<version>/live-regression-matrix-report.json` (`scripts/live-regression-matrix.mjs:53-54`, `scripts/live-regression-matrix.mjs:2251-2258`). Canvas competitive validation defaults to `artifacts/canvas-competitive-validation-report.json` (`scripts/canvas-competitive-validation.mjs:10-11`), and the product-video fixture probe uses `artifacts/skill-runtime-audit/review-bundles/product-video-fixture` (`scripts/product-video-fixture-live-probe.mjs:156-158`).

#### Hypothesis 4 - cleanup and low-level temp fallback drift
- Confirmed. Low-level `createArtifactBundle()` still falls back to `join(tmpdir(), "opendevbrowser")` if a caller omits `outputDir` (`src/providers/artifacts.ts:53-55`). This is bypassed by the four main workflows, but remains a footgun for new or test-only direct callers.
- Confirmed. `opendevbrowser artifacts cleanup --expired-only` defaults to `join(tmpdir(), "opendevbrowser")`, not `.opendevbrowser`, unless `--output-dir` is passed (`src/cli/commands/artifacts.ts:111-114`). The helper script inherits that default when called without an argument (`scripts/artifacts-cleanup.sh:9-13`).
- Docs partly disclose the split: the CLI guide says default cleanup root is `${TMPDIR:-/tmp}/opendevbrowser` and tells users to pass `--output-dir ./.opendevbrowser` for workspace workflow artifacts (`docs/CLI.md:614-633`). However, public-surface examples still show cleanup with `/tmp/opendevbrowser` and no adjacent warning (`src/public-surface/source.ts:739`).

#### Hypothesis 5 - tests and docs coverage
- Covered and locked in: CLI omitted and relative workflow roots (`tests/cli-workflows.test.ts:38`, `tests/cli-workflows.test.ts:126-180`, `tests/cli-workflows.test.ts:202-206`, `tests/cli-workflows.test.ts:525-529`, `tests/cli-workflows.test.ts:1179-1183`); direct tool omitted, explicit relative, and blank roots (`tests/tools-workflows.test.ts:275-354`); daemon omitted, explicit, and blank roots (`tests/daemon-commands.integration.test.ts:2018-2028`, `tests/daemon-commands.integration.test.ts:2338-2374`, `tests/daemon-commands.integration.test.ts:2376-2488`).
- Covered and locked in: direct low-level `createArtifactBundle()` temp fallback (`tests/providers-artifacts-workflows.test.ts:97-109`), explicit cleanup roots (`tests/cli-artifacts.test.ts:69-108`), browser screenshot and screencast artifact namespaces (`tests/browser-output-artifacts.test.ts:28-50`, `tests/browser-manager.test.ts:7337-7362`, `tests/browser-manager.test.ts:9067-9072`), and Canvas repo paths (`tests/canvas-repo-store.test.ts:28-50`).
- Partially covered docs: workflow root contract (`docs/CLI.md:600`), cleanup split (`docs/CLI.md:614-633`), Canvas storage (`docs/CLI.md:1047-1071`, `docs/SURFACE_REFERENCE.md:421-429`), browser capture storage (`docs/CLI.md:1369-1404`, `docs/SURFACE_REFERENCE.md:103-107`), annotation storage (`docs/ANNOTATE.md:138-150`), and desktop audit storage (`docs/CLI.md:1531-1538`).
- Coverage gap: `tests/cli-artifacts.test.ts` parses omitted cleanup output as `undefined` but does not execute `runArtifactsCommand()` without `--output-dir` and assert the returned root is `${tmpdir()}/opendevbrowser` (`tests/cli-artifacts.test.ts:45-56`, `src/cli/commands/artifacts.ts:111-121`). That gap matters because the default cleanup root is the largest user-facing mismatch with omitted workflow bundles.

#### Recommended fixes
1. Pick one cleanup contract and encode it. Best option: make `artifacts cleanup --expired-only` default to `resolveWorkflowArtifactRoot(undefined, { workspaceRoot: process.cwd() })`, matching omitted CLI workflow bundles, and add a separate explicit temp-cleanup option or examples for legacy temp bundles.
2. If temp cleanup must remain default, surface it in generated help and public examples next to the workflow-root warning, not only in `docs/CLI.md` (`src/public-surface/source.ts:739`, `docs/CLI.md:614-633`).
3. Remove or harden the low-level `createArtifactBundle()` implicit temp fallback. Prefer requiring `outputDir` at the provider boundary, or introduce an explicitly named helper for temp bundles so new workflow families cannot accidentally bypass `.opendevbrowser` (`src/providers/artifacts.ts:44-55`).
4. Add regression tests for cleanup default behavior, including one test for omitted cleanup root and one for `--output-dir ./.opendevbrowser`, then update docs/help expectations in the same pass.
5. Decide whether direct OpenCode explicit relative roots should stay invocation-cwd-relative. If yes, keep the existing tests and improve docs. If no, change `resolveWorkflowToolOutputDir()` to resolve explicit relative paths against `workspaceRoot` for parity with CLI pre-resolution, and update `tests/tools-workflows.test.ts:293-334` accordingly.

## Investigation Log

### Phase 1 - Initial Triage
**Hypothesis:** The main workflow bundle path is sound, but adjacent output families and cleanup/default-root seams make the public mental model leaky.
**Findings:** Confirmed with nuance. Main workflow bundle storage is sound, but "project-local" is entrypoint-specific and cannot be applied uniformly to direct tool or daemon roots without checking `core.cacheRoot`.
**Evidence:** Report findings above, plus oracle synthesis over the refreshed RepoPrompt selection.
**Conclusion:** Confirmed.

### Phase 2 - RepoPrompt Context Builder
**Hypothesis:** The relevant seams are broader than provider workflows alone.
**Findings:** Confirmed. Context builder selected provider bundle writer/root code, CLI workflow commands, direct tool wrappers, daemon workflow commands, Canvas, browser evidence, annotation, desktop, cleanup, docs, and focused tests.
**Evidence:** Selection covered `src/providers/*`, `src/cli/commands/*`, `src/tools/*`, `src/browser/*`, `src/canvas/*`, `src/annotate/*`, `src/desktop/*`, `tests/*`, and documentation slices.
**Conclusion:** Confirmed.

### Phase 3 - Pair Investigator
**Hypothesis:** The critique should survive adversarial source and test tracing.
**Findings:** Mostly confirmed. The pair investigator verified the main bundle flow, adjacent lanes, cleanup drift, direct tool relative path semantics, and test/doc coverage gaps.
**Evidence:** `## Investigator Findings`.
**Conclusion:** Confirmed with caveats about direct tools, direct daemon RPC, and documented cleanup split.

### Phase 4 - Oracle Synthesis
**Hypothesis:** The final critique needs to distinguish active bugs from intentional contracts and future footguns.
**Findings:** Confirmed. The oracle agreed that cleanup and low-level temp fallback are real risks, but noted that adjacent non-bundle lanes are intentional and that direct tool/daemon omitted roots should not be described as universally project-local without deciding the `core.cacheRoot` contract.
**Evidence:** Oracle synthesis over refreshed selection and pair findings.
**Conclusion:** Confirmed.

## Root Cause
OpenDevBrowser has a correct shared workflow root resolver, and the four main artifact-bearing provider workflows use it correctly when their entrypoint passes a resolved root. The inconsistency comes from storage policy being split across entrypoints and legacy artifact utilities instead of being expressed as one canonical contract.

CLI workflows eagerly resolve omitted and relative `--output-dir` values to the invocation directory before daemon dispatch. Direct tool wrappers and direct daemon RPC instead use `core.cacheRoot` for omitted roots, while preserving explicit strings. Direct provider calls without a workspace root fall back to `process.cwd()`. Separately, `createArtifactBundle()` and `artifacts cleanup` still preserve a legacy temp-root contract under `${TMPDIR:-/tmp}/opendevbrowser`.

Canvas, browser screenshots, screencasts, annotation, desktop observation, and release validation scripts are not broken workflow bundles. They are adjacent artifact lanes with different lifecycle needs. The architecture risk is that these contracts are not summarized in one storage policy matrix, and the cleanup/default-root seams make it easy for users and future code to assume the wrong root.

## Recommendations
1. Define the canonical omitted-output contract. If the product contract is project-local output, direct tools and daemon workflow calls need a real project or worktree root rather than a cache-root stand-in. If cache-root behavior is intentional, docs and surface references should explicitly say so.
2. Align cleanup with the dominant workflow default. Prefer `artifacts cleanup --expired-only` defaulting to cwd `.opendevbrowser`, and keep temp cleanup as an explicit legacy or temp option.
3. Harden `createArtifactBundle()`. Require `outputDir`, or split temp behavior into a clearly named helper so new workflow families cannot accidentally bypass `resolveWorkflowArtifactRoot()`.
4. Decide direct explicit relative path semantics. Either keep direct tool relative roots as process-cwd-relative and document that behavior, or resolve them against `workspaceRoot` for parity with CLI.
5. Add a storage contract matrix to docs. Cover CLI workflow, direct OpenCode tool, direct daemon RPC, provider call, Canvas, screenshot, screencast, annotation, desktop, release scripts, and cleanup.
6. Update generated/public help examples if cleanup remains temp-root by default. `docs/CLI.md` discloses the split, but public examples should not show `/tmp/opendevbrowser` cleanup without the workflow-root caveat.

## Preventive Measures
1. Add characterization tests for omitted, blank, absolute, and relative output roots per entrypoint before changing behavior.
2. Add an omitted cleanup execution test, not only parser coverage, so the default cleanup root is locked intentionally.
3. Add a guard test that each artifact-bearing provider workflow passes an explicit resolved root into `createArtifactBundle()`.
4. Keep adjacent lanes documented as intentional non-bundle contracts. They should not promise `bundle-manifest.json`, and manifest cleanup should not be expected to clean them.
5. Add docs parity checks for the storage matrix across `docs/CLI.md`, `docs/SURFACE_REFERENCE.md`, `docs/ARCHITECTURE.md`, and generated public-surface help.
6. Treat new output-producing commands as storage-contract changes: they should pick a namespace, root resolver, cleanup story, and tests before shipping.
