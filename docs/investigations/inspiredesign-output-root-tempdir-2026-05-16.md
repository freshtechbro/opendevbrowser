# Investigation: InspireDesign Output Root Tempdir

## Summary
The confirmed design issue is that the OpenCode direct tool path does not default omitted `outputDir` from the known workspace root. It forwards `undefined` into the workflow path, making output placement depend on runtime process state, while the CLI path eagerly defaults omitted `--output-dir` to absolute `.opendevbrowser`.

## Resolution Applied
- Added a shared workflow artifact-root resolver so omitted workflow roots consistently resolve to `<workspaceRoot>/.opendevbrowser` when a workspace root is available, while preserving explicit roots and rejecting blank values.
- Plumbed `core.cacheRoot` into direct OpenCode tool dependencies and daemon direct workflow RPC handling.
- Updated research, shopping, inspiredesign, and product-video direct tools so omitted roots write under `<workspaceRoot>/.opendevbrowser/<workflow>/<uuid>`.
- Kept CLI behavior intact: CLI still resolves omitted or relative `--output-dir` values from the CLI invocation directory before daemon dispatch.
- Kept `createArtifactBundle()` and artifact cleanup temp defaults separate, because those are low-level helper paths rather than workflow entry-point defaults.

## Symptoms
- OpenCode-triggered InspireDesign artifacts were saved under macOS temp storage.
- The expected default is `<project cwd>/.opendevbrowser/<workflow>/`, specifically `.opendevbrowser/inspiredesign/` for this workflow.
- The supplied temp directory contains a complete InspireDesign bundle, including `bundle-manifest.json`, `design-agent-handoff.json`, `canvas-plan.request.json`, and `evidence.json`.

## Background / Prior Research
- Memory index records a previous workflow artifact-root hardening pass that intended omitted workflow artifact roots to default to workspace-local `.opendevbrowser/<namespace>` while preserving explicit `outputDir` values.
- Memory index specifically flags the prior root cause as default root resolution being too low in the stack and says the intended fix was to resolve omitted workflow roots in `src/providers/workflows.ts`, not only the generic bundle helper.
- Current investigation must verify that current source and OpenCode execution still follow that intended path.
- RepoPrompt git archaeology found commit `92c9470871f534fcd1d76c8f0c83a0bf861bab16` (`fix: standardize workflow artifact contracts`, May 8, 2026) as the main hardening commit. The implementation assumes `process.cwd()` is the intended workspace root when runtime receives no `outputDir`.
- Git archaeology also found current source evidence: `src/cli/commands/workflow-output.ts` defaults CLI `--output-dir` to `.opendevbrowser`, while `src/providers/workflows.ts` defensively defaults missing runtime `outputDir` to `join(process.cwd(), ".opendevbrowser")`.

## Investigator Findings

### 2026-05-16 - OpenCode inspiredesign temp-root investigation

#### 1. CLI path defaulting versus OpenCode tool path defaulting
- CLI defaulting is explicit and eager: `resolveWorkflowOutputDirFlag(value = ".opendevbrowser")` rejects blanks and returns `resolve(value)`, so an omitted CLI `--output-dir` becomes an absolute `.opendevbrowser` path from the CLI process cwd before daemon dispatch. Evidence: `src/cli/commands/workflow-output.ts:1-9`.
- `opendevbrowser inspiredesign run` parses explicit `--output-dir` values at parse time and, even when omitted, sends `outputDir: resolveWorkflowOutputDirFlag(parsed.outputDir)` in the daemon payload. Evidence: `src/cli/commands/inspiredesign.ts:111-118`, `src/cli/commands/inspiredesign.ts:215-231`.
- CLI tests lock that contract with `defaultWorkflowOutputDir = resolve(".opendevbrowser")` and expect workflow commands to pass that default to the daemon. Evidence: `tests/cli-workflows.test.ts:1-40`, `tests/cli-workflows.test.ts:150-190`.
- The OpenCode tool schema leaves `outputDir` optional and forwards `outputDir: args.outputDir` directly to `runInspiredesignWorkflow`; it does not call `resolveWorkflowOutputDirFlag()` or inject a workspace root. Evidence: `src/tools/inspiredesign_run.ts:18-34`, `src/tools/inspiredesign_run.ts:40-57`.
- Current tool tests cover capture behavior, mode, timeout, and cookie parity, but they do not assert omitted `outputDir` under an OpenCode `directory/worktree` that differs from `process.cwd()`. Evidence: `tests/tools-workflows.test.ts:241-374`.

#### 2. Can current source produce `/T/opendevbrowser/inspiredesign/<uuid>` through `runInspiredesignWorkflow`?
- Current workflow source normalizes omitted runtime output roots in `resolveWorkflowArtifactRoot()`: `undefined` becomes `join(process.cwd(), ".opendevbrowser")`, blank strings throw, and explicit values are preserved. Evidence: `src/providers/workflows.ts:2066-2075`.
- `runInspiredesignWorkflow()` calls that resolver before writing, stores the result in `artifactRoot`, and passes `outputDir: artifactRoot` into `createArtifactBundle({ namespace: "inspiredesign", ... })`. Evidence: `src/providers/workflows.ts:3306-3314`, `src/providers/workflows.ts:3387-3392`.
- Therefore, with omitted `outputDir`, current source should produce `<process.cwd()>/.opendevbrowser/inspiredesign/<uuid>`, not `<tmpdir>/opendevbrowser/inspiredesign/<uuid>`. The exact reported shape `/var/folders/.../T/opendevbrowser/inspiredesign/<uuid>` matches the lower-level bundle fallback instead.
- The lower-level fallback is real: `createArtifactBundle()` uses `args.outputDir ? resolve(args.outputDir) : join(tmpdir(), "opendevbrowser")`, then appends namespace and run id. Evidence: `src/providers/artifacts.ts:45-56`.
- Tests explicitly preserve that fallback for direct bundle callers without `outputDir`. Evidence: `tests/providers-artifacts-workflows.test.ts:97-106`.
- Current inspiredesign workflow tests expect omitted output to land under a mocked workspace cwd plus `.opendevbrowser`. Evidence: `tests/providers-inspiredesign-workflow.test.ts:363-390`.
- Local built `dist` matches current source for these points: `dist/chunk-S6S2UP6U.js:17137-17143` normalizes omitted output to `process.cwd()/.opendevbrowser`, `dist/chunk-S6S2UP6U.js:18134-18139` applies it in `runInspiredesignWorkflow`, and `dist/chunk-S6S2UP6U.js:18205-18210` passes `outputDir: artifactRoot` to the bundle helper. `dist/chunk-S5KZQJJI.js:20-27` still contains the direct helper fallback.
- Conclusion: current repo source and local `dist` should not produce `/T/opendevbrowser/inspiredesign/<uuid>` through the normal `runInspiredesignWorkflow()` omitted-output path. That shape implies one of: a stale installed package/build, a direct `createArtifactBundle()` call without outputDir, or an explicit `outputDir` of `/var/folders/.../T/opendevbrowser`. Package entrypoints make stale installed `dist` plausible if OpenCode loaded a different package copy: `package.json:5-12`.

#### 3. What `directory`, `worktree`, `cacheRoot`, `ToolDeps`, and provider runtime expose
- The OpenCode plugin receives `{ directory, worktree }` and creates `createOpenDevBrowserCore({ directory, worktree })`. Evidence: `src/index.ts:44-45`.
- Core root resolution prefers `options.worktree`, then `options.directory`, then `process.env.PWD`, then `process.cwd()`, and returns that as `cacheRoot`. Evidence: `src/core/bootstrap.ts:17-51`.
- `cacheRoot` is used to construct browser/session managers, skills, agent inbox, canvas manager, desktop runtime, automation coordinator, and provider runtime assemblies. Evidence: `src/core/bootstrap.ts:58-86`, `src/core/bootstrap.ts:110-114`, `src/core/bootstrap.ts:178-191`.
- `OpenDevBrowserCore` exposes `cacheRoot`, but `ToolDeps` does not include `cacheRoot`, `directory`, `worktree`, or a workflow artifact root. Evidence: `src/core/types.ts:30-78`, `src/tools/deps.ts:32-50`.
- The tool dependency object built in the plugin omits `core.cacheRoot`; remote binding updates manager/runtime fields but still does not add workspace root context. Evidence: `src/index.ts:72-86`, `src/index.ts:99-121`.
- Hub startup passes `{ config, directory, worktree }` to `startDaemon()`, but daemon workflow dispatch still forwards only `optionalString(params.outputDir)` to `runInspiredesignWorkflow`; omitted remains `undefined`. Evidence: `src/index.ts:246-247`, `src/cli/daemon-commands.ts:856-877`, `src/cli/daemon-commands.ts:1707-1710`.
- Provider runtime assembly does not carry `cacheRoot` into workflow tools; it builds search/fetch/crawl/post runtime and browser fallback from config, manager, challenge config, and optional init. Evidence: `src/core/runtime-assemblies.ts:30-58`, `src/providers/runtime-bundle.ts:23-32`, `src/providers/runtime-bundle.ts:79-122`.
- Conclusion: the workspace root exists as `core.cacheRoot`, but direct workflow tools and workflow functions cannot see it today. They can only rely on explicit `outputDir` or `process.cwd()`.

#### 4. Fix options and focused tests
- Best fix option: add a workspace artifact root to tool/core plumbing, for example `ToolDeps.workspaceRoot` or `ToolDeps.workflowOutputRoot` derived from `core.cacheRoot`, then have direct workflow tools default omitted `outputDir` to `<workspaceRoot>/.opendevbrowser` before calling workflows. This preserves explicit `outputDir` because only `undefined` is filled.
- Broader fix option: extend workflow input/options to accept `defaultOutputRoot` or `workspaceRoot`, and update daemon/tool callers to pass it. Keep `resolveWorkflowArtifactRoot()` semantics: explicit nonblank outputDir wins, blank rejects, omitted uses provided workspace root then current fallback.
- CLI fix is probably unnecessary for the CLI path because CLI already sends an absolute default, but daemon direct RPC callers can still omit `outputDir`; decide whether daemon should also default omitted workflow output from `core.cacheRoot` for parity. Evidence for current daemon omission: `src/cli/daemon-commands.ts:856-877`.
- Focused tests needed: (1) `createInspiredesignRunTool()` with omitted outputDir, `process.cwd()` mocked to a temp dir, and `deps.workspaceRoot` or equivalent set to a workspace dir, expecting `artifact_path` under workspace `.opendevbrowser/inspiredesign`; (2) same tool with explicit `outputDir`, expecting explicit path unchanged; (3) daemon `inspiredesign.run` omitted `outputDir` if daemon parity is changed; (4) existing workflow tests for blank outputDir rejection and direct `createArtifactBundle()` temp fallback remain green.

## Investigation Log

### Phase 0 - Workspace Binding
**Hypothesis:** RepoPrompt must be bound to the target repository before broad context discovery.
**Findings:** RepoPrompt bound successfully to `/Users/bishopdotun/Documents/DevProjects/opendevbrowser`.
**Evidence:** RepoPrompt `bind_context` returned workspace `opendevbrowser (1)` matched by `working_dirs`.
**Conclusion:** Confirmed.

### Phase 1 - Initial State
**Hypothesis:** The working tree may contain unrelated changes that could affect investigation.
**Findings:** `git status --short --branch` showed `## main...origin/main`; `git diff --stat` returned empty output.
**Evidence:** Local shell preflight on `2026-05-16`.
**Conclusion:** Clean tracked tree confirmed before read-only investigation.

### Phase 1.5 - Prior Fix History
**Hypothesis:** The reported temp path may be a regression of the prior artifact-root hardening fix.
**Findings:** Prior hardening standardized workflow artifacts under `.opendevbrowser/<workflow>/<run-id>` and moved omitted runtime defaulting into the workflow layer. The current implementation still assumes `process.cwd()` is the workspace root when `outputDir` is omitted.
**Evidence:** RepoPrompt explore agent reported commit `92c9470871f534fcd1d76c8f0c83a0bf861bab16` and current references in `src/cli/commands/workflow-output.ts`, `src/providers/workflows.ts`, `src/providers/artifacts.ts`, and `tests/providers-inspiredesign-workflow.test.ts`.
**Conclusion:** Prior fix is present conceptually, but it may be insufficient for OpenCode if OpenCode's current working directory is a temp directory or if the tool path does not pass a project workspace root.

## Root Cause
Confirmed design root cause: `opendevbrowser_inspiredesign_run` leaves `outputDir` optional and forwards `args.outputDir` directly to `runInspiredesignWorkflow`, so omitted tool output is not anchored to OpenCode `directory`, `worktree`, or `core.cacheRoot`.

Current workflow source then falls back to `process.cwd()/.opendevbrowser`, which is still weaker than the desired project-root default when OpenCode launches the plugin from a temp working directory.

The exact observed path, `/var/folders/.../T/opendevbrowser/inspiredesign/<uuid>`, remains a separate unconfirmed discrepancy. Current source and local `dist` should produce `/var/folders/.../T/.opendevbrowser/inspiredesign/<uuid>` through the normal `runInspiredesignWorkflow()` omitted-output path. The observed shape matches `createArtifactBundle()`'s direct fallback to `join(tmpdir(), "opendevbrowser")`, so it likely indicates a stale loaded package/build, a direct helper bypass, or an explicit temp `outputDir` value.

## Recommendations
1. Before implementing, capture the failing OpenCode runtime facts: loaded package/version or dist path, plugin `process.cwd()`, OpenCode `directory` and `worktree`, actual `opendevbrowser_inspiredesign_run` args, and returned `artifact_path`.
2. Plumb a workspace artifact root into direct tool dependencies, derived from `core.cacheRoot` in `src/index.ts`.
3. Default direct workflow tools only when `outputDir` is `undefined`, passing `<workspaceRoot>/.opendevbrowser` into workflow calls. Preserve explicit `outputDir` and current blank-string rejection.
4. Decide whether direct daemon RPC calls should get the same `core.cacheRoot` default for parity. CLI calls already send an absolute default.
5. Add focused regression tests for tool omitted-output behavior under temp `process.cwd()` with a separate workspace root, explicit `outputDir` preservation, and daemon omitted-output parity if changed.

## Preventive Measures
- Add direct tool tests for every artifact-bearing workflow where `process.cwd()` differs from the OpenCode workspace root.
- Keep CLI, daemon, and OpenCode tool output-root contracts documented together.
- Add runtime diagnostics or debug metadata for workflow artifact roots so future reports can distinguish explicit output paths, workspace-root defaults, process-cwd defaults, and helper temp fallbacks.
