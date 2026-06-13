# Output Storage Contract Alignment: Plan

Status: implemented in `codex/investigate-output-storage-architecture`
Last updated: 2026-06-13

## Goal
Align artifact-bearing workflow storage around a stable project/worktree-local `.opendevbrowser` contract, remove cleanup and low-level bundle drift, preserve intentional non-bundle lanes, and add tests/docs that prevent future output-storage drift.

Implementation note: this plan is retained as the execution record for the branch. The implemented code also hardens bundle cleanup and bundle file writes against symlink and path traversal escapes found during the final adversarial review.

Success criteria:
- Research, shopping, inspiredesign, and product-video omitted outputs resolve to the active project/worktree `.opendevbrowser` root for CLI, direct daemon RPC, and direct OpenCode tools.
- Direct daemon and direct OpenCode omitted roots remain anchored through the current core project/worktree root, but the implementation stops describing that value as an OS cache location.
- `artifacts cleanup --expired-only` omitted behavior cleans cwd/project `.opendevbrowser`, not `${TMPDIR}/opendevbrowser`.
- `createArtifactBundle()` cannot silently create temp bundles when `outputDir` is omitted.
- Canvas, screenshot, screencast, annotation, desktop audit, and release proof lanes stay non-bundle contracts.
- Tests and docs describe and lock the storage matrix.

## Decision
Use project/worktree-local `.opendevbrowser` as the universal omitted-output contract for artifact-bearing workflows.

Keep direct daemon and direct OpenCode omitted roots anchored through the core root that is currently named `cacheRoot`, because investigation shows it is already the active project/worktree root chosen from `worktree`, `directory`, `PWD`, or cwd. Do not move those flows away from that value. Instead, add a behavior-preserving `workspaceRoot` alias and use that alias in workflow-output policy code.

Do not normalize direct tool explicit relative `outputDir` values in this plan. Existing tests lock that explicit caller-controlled behavior, and changing it would be a separate compatibility decision.

Do not change direct tool calls that lack `deps.workspaceRoot` into errors in this plan. Preserve the current provider-level `process.cwd()/.opendevbrowser` fallback and document it as the direct provider workflow behavior. The hardening target is the low-level bundle writer, not provider workflow root resolution.

## Background
- The investigation confirms the main critique: main workflows use `.opendevbrowser/<namespace>/<run-id>/bundle-manifest.json`, but cleanup and low-level bundle fallback still diverge, and direct tools/daemon omitted roots are described through `core.cacheRoot` (`docs/investigations/output-storage-architecture-2026-06-13.md:3-6`, `docs/investigations/output-storage-architecture-2026-06-13.md:89-94`).
- `core.cacheRoot` is a misleading name here. `resolveCacheRoot(options)` chooses the active project/worktree root from `options.worktree`, `options.directory`, `process.env.PWD`, or `process.cwd()`, rejects root directories, and returns it as `OpenDevBrowserCore.cacheRoot` (`src/core/bootstrap.ts:41-65`, `src/core/bootstrap.ts:173-194`, `src/core/types.ts:29-35`).
- The OS/global cache root is separate. Daemon metadata uses `OPENCODE_CACHE_DIR`, `XDG_CACHE_HOME`, or `~/.cache/opendevbrowser`, and browser profile/cache paths hash the worktree under that cache base (`src/cli/daemon.ts:54-63`, `src/cache/paths.ts:30-44`).
- Core wires `cacheRoot` into browser, ops, skills, agent inbox, runtime assemblies, and Canvas as the worktree/repo root (`src/core/bootstrap.ts:67-83`, `src/core/bootstrap.ts:112-116`).
- CLI workflow commands resolve omitted and relative `--output-dir` before daemon dispatch. `resolveWorkflowOutputDirFlag()` defaults to `.opendevbrowser`, rejects blank values, and returns `path.resolve(value)` (`src/cli/commands/workflow-output.ts:5-12`), with behavior locked by `tests/cli-workflows.test.ts:120-185`.
- Direct daemon workflow commands call `resolveWorkflowArtifactRoot(outputDir, { workspaceRoot: core.cacheRoot })`, so omitted direct daemon roots become `core.cacheRoot/.opendevbrowser`; explicit roots are preserved (`src/cli/daemon-commands.ts:76-79`, `src/cli/daemon-commands.ts:854-958`, `tests/daemon-commands.integration.test.ts:2010-2029`, `tests/daemon-commands.integration.test.ts:2379-2486`).
- Direct OpenCode tools use `resolveWorkflowToolOutputDir()`: explicit `outputDir` is preserved, omitted roots use `deps.workspaceRoot/.opendevbrowser` when available, and no workspace root returns `undefined` so providers fall back later (`src/tools/workflow-output.ts:4-14`, `src/index.ts:78-81`, `tests/tools-workflows.test.ts:270-367`).
- Provider workflows use `resolveWorkflowArtifactRoot()` before bundle creation, then call `createArtifactBundle()` with namespaces `research`, `shopping`, `inspiredesign`, and `product-video` (`src/providers/workflow-output-root.ts:3-19`, `src/providers/workflows.ts:5461-5640`, `src/providers/workflows.ts:5678-5851`, `src/providers/workflows.ts:5883-6238`, `src/providers/workflows.ts:6317-6677`).
- `createArtifactBundle()` still falls back to `${TMPDIR}/opendevbrowser` when called without `outputDir`; this is locked by `tests/providers-artifacts-workflows.test.ts:97-109` and is the main future-caller footgun (`src/providers/artifacts.ts:44-87`).
- `artifacts cleanup --expired-only` defaults to `${TMPDIR}/opendevbrowser`, not `.opendevbrowser`, unless `--output-dir` is supplied. Explicit-root cleanup is tested, but omitted-root cleanup execution is not (`src/cli/commands/artifacts.ts:111-134`, `tests/cli-artifacts.test.ts:31-111`, `scripts/artifacts-cleanup.sh:9-13`).
- Docs partly disclose the split, but public/generated help examples still emphasize `/tmp/opendevbrowser` cleanup (`docs/CLI.md:614-633`, `src/public-surface/source.ts:739`, `src/public-surface/generated-manifest.ts:630-639`).
- Intentional adjacent lanes should remain non-bundle contracts: Canvas under `.opendevbrowser/canvas` (`docs/DESIGN_CANVAS_TECHNICAL_SPEC.md:178-183`), browser screenshot/screencast under `.opendevbrowser/screenshot` and `.opendevbrowser/screencast` (`docs/CLI.md:1368-1395`), annotation temp screenshots plus `.opendevbrowser/annotate` inbox (`docs/ANNOTATE.md:138-151`), and release proof scripts under `/tmp/...` or `artifacts/release/vX.Y.Z/...` (`docs/CLI.md:1737-1788`, `skills/opendevbrowser-best-practices/SKILL.md:316-335`).
- Prior art matters. Commit `043ea9b` (`fix: unify workflow output roots`) and release `0.0.30` evidence treated `core.cacheRoot` plumbing as the fix for direct tools and raw daemon RPC, including direct OpenCode-style runs from temp cwd writing under repo `.opendevbrowser` (`docs/RELEASE_0.0.30_EVIDENCE.md:7-30`, `docs/RELEASE_0.0.30_EVIDENCE.md:76-80`).

## Approach
1. Keep `.opendevbrowser` as the canonical workflow artifact directory.
2. Add `workspaceRoot` as a behavior-preserving alias for the current core project/worktree root.
3. Use `workspaceRoot` terminology in direct workflow routing, while keeping `cacheRoot` for compatibility.
4. Keep direct daemon omitted workflow roots at `core.workspaceRoot/.opendevbrowser`.
5. Keep direct OpenCode omitted workflow roots at `deps.workspaceRoot/.opendevbrowser`, with `src/index.ts` injecting `core.workspaceRoot`.
6. Preserve explicit caller-provided output roots for CLI, direct daemon, and direct tools.
7. Change omitted `artifacts cleanup --expired-only` to cwd `.opendevbrowser`.
8. Keep `scripts/artifacts-cleanup.sh` repo-root cleanup behavior explicit: because the script changes to the repository root before invoking the CLI, omitted script cleanup should clean repo-root `.opendevbrowser`.
9. Remove implicit temp-root behavior from `createArtifactBundle()`. Temp bundles remain possible only through an explicit `outputDir`.
10. Document the storage matrix and preserve all intentional non-bundle lanes.

## Storage Contract Matrix
| Lane | Omitted output root | Bundle manifest | Cleanup behavior | Policy |
|---|---|---:|---|---|
| CLI research, shopping, inspiredesign, product-video | Invocation cwd `.opendevbrowser` resolved before daemon dispatch | Yes | `artifacts cleanup --expired-only` from same cwd | Preserve |
| Direct daemon RPC workflows | `core.workspaceRoot/.opendevbrowser` | Yes | Explicit cleanup root or cwd cleanup from project | Preserve through alias |
| Direct OpenCode workflow tools | `deps.workspaceRoot/.opendevbrowser` when registered by `src/index.ts`; no workspace root falls through to direct provider behavior | Yes | Explicit cleanup root or cwd cleanup from project | Preserve through alias |
| Direct provider workflow call | `process.cwd()/.opendevbrowser` when no output is supplied | Yes | Explicit cleanup root or cwd cleanup from same process cwd | Preserve |
| Low-level bundle writer | Requires explicit `outputDir` | Yes | Caller-owned | Harden |
| Canvas | `.opendevbrowser/canvas` | No | Not bundle cleanup | Preserve |
| Browser screenshot | `.opendevbrowser/screenshot/<uuid>` | No | Not bundle cleanup | Preserve |
| Screencast | `.opendevbrowser/screencast/<uuid>` | No | Not bundle cleanup | Preserve |
| Annotation inbox | `.opendevbrowser/annotate`; screenshot bytes can be temp-only | No | Own bounded retention | Preserve |
| Desktop audit | `.opendevbrowser/desktop-runtime` by default | No | Own audit policy | Preserve |
| Release proof artifacts | `artifacts/release/...` or explicit script output | No | Release-owned | Preserve |

## Work Items

## Task 1 - Add Core Workspace-Root Alias
Reasoning: `core.cacheRoot` is currently the project/worktree root in core construction, but the name creates the false impression that direct workflow artifacts are written to OS cache storage.
What to do: Add `workspaceRoot` to `OpenDevBrowserCore` and use it for direct workflow-output routing without removing `cacheRoot`.
How:
1. Add `workspaceRoot: string` to `OpenDevBrowserCore`.
2. Return `workspaceRoot: cacheRoot` from `createOpenDevBrowserCore()`.
3. Update tool dependency wiring so `src/index.ts` passes `workspaceRoot: core.workspaceRoot`.
4. Update `resolveDaemonWorkflowOutputDir()` to use `core.workspaceRoot`.
5. Do not rename `cacheRoot` globally in this task.
Files impacted: `src/core/types.ts`, `src/core/bootstrap.ts`, `src/index.ts`, `src/cli/daemon-commands.ts`.
End goal: Direct daemon and direct OpenCode workflow routing use project/worktree-root terminology while preserving the same physical output paths.
Acceptance criteria:
- `core.workspaceRoot` is available and equals the existing resolved root.
- Direct tool and daemon omitted-root behavior does not change.
- Typecheck passes.
Dependencies: none.
Size: small.

## Task 2 - Lock Direct Omitted-Root Policy In Tests
Reasoning: Tests should prevent future changes from treating the direct workflow root as OS/global cache storage.
What to do: Update direct daemon and direct tool tests so names and assertions describe workspace-root-local `.opendevbrowser`.
How:
1. Rename daemon test descriptions that refer to core cache root.
2. Assert omitted daemon workflow roots use `join(core.workspaceRoot, ".opendevbrowser")`.
3. Keep or add coverage that direct tool calls without `deps.workspaceRoot` fall through to provider `process.cwd()/.opendevbrowser` behavior rather than erroring.
4. Keep explicit root and blank root tests unchanged.
5. Keep direct tool explicit relative output root tests unchanged.
Files impacted: `tests/daemon-commands.integration.test.ts`, `tests/tools-workflows.test.ts`.
End goal: The direct omitted-root policy is explicit and behavior-locked.
Acceptance criteria:
- Daemon tests verify omitted roots through `core.workspaceRoot`.
- Direct tool tests continue to verify `workspaceRoot/.opendevbrowser`.
- Missing direct tool `workspaceRoot` behavior remains explicit and tested as provider-cwd fallback.
- Explicit relative path tests still document current behavior.
Dependencies: Task 1.
Size: small.

## Task 3 - Align Artifact Cleanup Default
Reasoning: Cleanup currently defaults to `${TMPDIR}/opendevbrowser`, which misses normal omitted workflow bundles and is the highest user-facing drift risk.
What to do: Make `artifacts cleanup --expired-only` default to cwd `.opendevbrowser`, while preserving explicit cleanup roots.
How:
1. Resolve cleanup omitted roots through the same semantics as CLI workflow omitted roots, either by reusing `resolveWorkflowOutputDirFlag()` or by extracting a shared helper with equivalent behavior.
2. Remove `tmpdir` default logic from `src/cli/commands/artifacts.ts`.
3. Keep explicit `--output-dir /tmp/opendevbrowser` working for legacy or temp cleanup.
4. Ensure blank `--output-dir` values are rejected.
5. Leave `scripts/artifacts-cleanup.sh` intentionally repo-root-local when no argument is passed, because it `cd`s to the repository root before invoking the CLI.
Files impacted: `src/cli/commands/artifacts.ts`, `src/cli/commands/workflow-output.ts`, `scripts/artifacts-cleanup.sh`.
End goal: Omitted cleanup and omitted CLI workflow output use the same cwd `.opendevbrowser` default.
Acceptance criteria:
- Omitted cleanup returns `rootDir=<cwd>/.opendevbrowser`.
- Explicit cleanup roots still work.
- Blank cleanup output dirs fail with usage errors.
- Running `scripts/artifacts-cleanup.sh` with no argument cleans the repository root `.opendevbrowser` by design.
Dependencies: none.
Size: small.

## Task 4 - Add Cleanup Default Regression Tests
Reasoning: The investigation found parser coverage and explicit-root coverage, but no execution-level test for omitted cleanup root.
What to do: Add cleanup tests that fail on the current temp-root default and pass after Task 3.
How:
1. Add an omitted-root cleanup execution fixture in `tests/cli-artifacts.test.ts`.
2. Run cleanup from a controlled cwd with expired and active bundles under `.opendevbrowser`.
3. Assert returned `rootDir` is the controlled cwd `.opendevbrowser`.
4. Assert only expired bundle directories are removed.
5. Add blank `--output-dir` rejection coverage for whitespace.
Files impacted: `tests/cli-artifacts.test.ts`.
End goal: Cleanup default behavior is behavior-locked and cannot drift back to temp silently.
Acceptance criteria:
- Omitted cleanup execution test fails before Task 3 and passes after Task 3.
- Existing explicit cleanup tests still pass.
- Blank cleanup output coverage exists.
Dependencies: Task 3.
Size: medium.

## Task 5 - Require Explicit Bundle Output Roots
Reasoning: Main workflows already pass resolved roots, but `createArtifactBundle()` remains a footgun for new callers because omitted `outputDir` silently writes to temp.
What to do: Make low-level bundle creation require an explicit output root.
How:
1. Change `createArtifactBundle()` args so `outputDir` is required.
2. Add runtime validation that rejects blank `outputDir`.
3. Resolve the required `outputDir` with `path.resolve()`.
4. Remove the `tmpdir` import and implicit temp branch.
5. Confirm all production callers compile.
Files impacted: `src/providers/artifacts.ts`, `src/providers/workflows.ts`.
End goal: New artifact-bearing workflows cannot accidentally bypass the shared root resolver.
Acceptance criteria:
- Typecheck fails for any caller that omits `outputDir`.
- Main workflow bundle creation still compiles.
- Blank bundle output roots throw a clear validation error.
Dependencies: none.
Size: small.

## Task 6 - Replace Bundle Fallback Tests
Reasoning: Existing tests currently lock the temp fallback that Task 5 removes.
What to do: Replace the implicit temp fallback test with explicit-root and blank-root coverage.
How:
1. Remove the test expecting omitted `createArtifactBundle()` to use `${TMPDIR}/opendevbrowser`.
2. Add a test that passes an explicit temp directory and verifies bundle output under that directory.
3. Add a test that passes blank `outputDir` and expects a clear validation error.
4. Keep manifest and cleanup lifecycle tests unchanged.
Files impacted: `tests/providers-artifacts-workflows.test.ts`.
End goal: Tests preserve explicit temp bundles but reject implicit temp bundle creation.
Acceptance criteria:
- No test expects implicit temp bundle creation.
- Explicit temp bundle creation remains supported by passing explicit `outputDir`.
- Manifest and cleanup lifecycle tests remain green.
Dependencies: Task 5.
Size: small.

## Task 7 - Guard Provider Workflow Root Propagation
Reasoning: Once `createArtifactBundle()` requires `outputDir`, provider workflows are the enforcement point for the storage contract.
What to do: Verify or add focused tests that every artifact-bearing provider workflow produces bundle output under the resolved root.
How:
1. Prefer behavior-level assertions on returned `artifact_path`, bundle manifests, and nested bundle roots over brittle spies on `createArtifactBundle()`.
2. Confirm research, shopping, inspiredesign, and product-video produce bundles under their resolved roots.
3. Confirm product-video named-product resolution produces nested shopping output under the same resolved root.
4. Add or update focused provider tests only where existing coverage is missing.
Files impacted: `src/providers/workflows.ts`, `tests/providers-artifacts-workflows.test.ts`.
End goal: A workflow cannot accidentally call the bundle writer without a resolved root.
Acceptance criteria:
- Provider workflow tests fail if any workflow output escapes the resolved root.
- Product-video nested shopping remains under the product-video resolved root.
Dependencies: Tasks 5 and 6.
Size: medium.

## Task 8 - Update CLI, Public Surface, Architecture, And Non-Bundle Docs
Reasoning: The code change must not leave users or agents with the old temp-root cleanup mental model.
What to do: Update docs and generated/public surfaces to match the storage contract while preserving intentional non-bundle lanes.
How:
1. Update `docs/CLI.md` workflow output notes to mention `workspaceRoot` semantics for direct daemon and direct tools.
2. Update `docs/CLI.md` cleanup docs so omitted cleanup targets cwd `.opendevbrowser`.
3. Keep explicit temp cleanup examples using `--output-dir`.
4. Update `src/public-surface/source.ts` so cleanup examples do not imply `/tmp/opendevbrowser` is the omitted default.
5. Add or update the architecture storage matrix near provider artifact lifecycle docs.
6. Explicitly list Canvas, browser screenshot, screencast, annotation, desktop audit, and release proof as intentional non-bundle lanes.
7. Run `node scripts/generate-public-surface-manifest.mjs` and commit generated manifest changes if `src/public-surface/source.ts` changes.
Files impacted: `docs/CLI.md`, `docs/ARCHITECTURE.md`, `docs/SURFACE_REFERENCE.md`, `src/public-surface/source.ts`, `src/public-surface/generated-manifest.ts`, `src/public-surface/generated-manifest.json`.
End goal: Docs have one authoritative storage matrix and no stale omitted-cleanup examples.
Acceptance criteria:
- Primary cleanup docs say omitted cleanup targets cwd `.opendevbrowser`.
- Temp cleanup is documented only as an explicit `--output-dir` operation.
- Bundle and non-bundle lanes are clearly distinguished.
- Non-bundle lanes do not promise `bundle-manifest.json` and are not described as cleanup targets for bundle manifest cleanup.
- Docs drift checks pass.
Dependencies: Tasks 1, 3, and 5.
Size: medium.

## Task 9 - Run Focused And Global Quality Gates
Reasoning: This touches CLI behavior, provider utilities, direct workflow routing, tests, and docs, so focused tests alone are not enough.
What to do: Verify the implementation is commit-ready.
How:
1. Run focused tests before the global suite.
2. Run branch coverage deficit checks before the full coverage run, and close deficits before rerunning the complete suite.
3. Run public-surface generation before docs drift if `src/public-surface/source.ts` changed.
4. Run lint, typecheck, docs drift, build, and full tests.
5. Inspect git status and staged diff before commit.
Files impacted: changed files from Tasks 1 through 8.
End goal: The implementation passes real quality gates with no unrelated changes.
Acceptance criteria:
- Focused artifact/workflow tests pass.
- Lint passes.
- Typecheck passes.
- Docs drift check passes.
- Build passes.
- Full test and coverage gate pass with branch deficit closed.
Dependencies: Tasks 1 through 8.
Size: medium.

Suggested focused commands:

```bash
npm run test -- tests/cli-artifacts.test.ts tests/providers-artifacts-workflows.test.ts tests/cli-workflows.test.ts tests/tools-workflows.test.ts tests/daemon-commands.integration.test.ts tests/browser-output-artifacts.test.ts tests/canvas-repo-store.test.ts
npm run lint
npm run typecheck
node scripts/generate-public-surface-manifest.mjs
node scripts/docs-drift-check.mjs
npm run build
```

## Tradeoffs
- Do not normalize direct tool explicit relative `outputDir` values in this plan. That would change existing explicit caller-controlled behavior and test expectations.
- Do not rename `cacheRoot` globally in this plan. Add `workspaceRoot` as a clarifying alias instead, because a broad rename would touch browser, Canvas, desktop, skill, and profile code without changing storage behavior.
- Do not add a temp-cleanup flag. Explicit `--output-dir ${TMPDIR}/opendevbrowser` is sufficient and avoids expanding the CLI surface.

## Open Questions
- None blocking implementation. The plan chooses project/worktree-local `.opendevbrowser` and treats `workspaceRoot` as the clarifying alias for the existing core root.

## Deferred Follow-Ups
- Rename `cacheRoot` across the codebase to `workspaceRoot` in a dedicated refactor after this behavior-preserving alignment lands.
- Decide whether direct tool explicit relative output paths should normalize against `workspaceRoot`.
- Add a docs drift rule that requires every new artifact-bearing workflow to document root, namespace, manifest, cleanup, and tests.

## References
- `docs/investigations/output-storage-architecture-2026-06-13.md`
- `docs/RELEASE_0.0.30_EVIDENCE.md`
- Historical commit `043ea9b`: `fix: unify workflow output roots`

## Version History
- 2026-06-13 v1: Initial executable plan based on investigation, seam probes, and context-builder synthesis.
