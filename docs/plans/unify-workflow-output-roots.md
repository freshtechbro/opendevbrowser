# Unify Workflow Output Roots

## Task 1 - Add Regression Coverage
Reasoning: The bug exists because CLI, direct tool, and daemon surfaces are not tested against the same omitted-output contract.
What to do: Add focused tests proving omitted workflow outputs use the workspace root and explicit output roots remain unchanged.
How:
1. Add direct tool tests for research, shopping, inspiredesign, and product-video omitted output roots with temp `process.cwd()` and separate workspace root.
2. Add explicit output-root preservation tests for direct tools.
3. Add daemon RPC tests for omitted output roots using `core.cacheRoot`.
Files impacted: `tests/tools-workflows.test.ts`, `tests/daemon-commands.integration.test.ts`.
Acceptance criteria:
- [x] Tests fail before implementation for omitted direct tool/daemon roots.
- [x] Existing CLI output-root tests remain unchanged and meaningful.
- [x] Explicit output-root tests preserve caller-provided values.

## Task 2 - Centralize Workflow Root Resolution
Reasoning: A single resolver prevents future drift between workflow surfaces.
What to do: Create a shared workflow artifact-root resolver and reuse the `.opendevbrowser` constant.
How:
1. Add `src/providers/workflow-output-root.ts`.
2. Move omitted, blank, and explicit output-root semantics into the shared resolver.
3. Import the shared resolver in provider workflows and CLI output helpers.
Files impacted: `src/providers/workflow-output-root.ts` (new), `src/providers/workflows.ts`, `src/cli/commands/workflow-output.ts`.
Acceptance criteria:
- [x] Omitted roots use `workspaceRoot/.opendevbrowser` when a workspace root is supplied.
- [x] Omitted roots still fall back to `process.cwd()/.opendevbrowser` when no workspace root is supplied.
- [x] Blank roots still throw `outputDir cannot be empty`.
- [x] Direct `createArtifactBundle()` temp fallback is unchanged.

## Task 3 - Plumb Workspace Roots Across Surfaces
Reasoning: OpenCode and daemon surfaces already know the workspace root through `core.cacheRoot`, but workflow tools cannot currently see it.
What to do: Pass `core.cacheRoot` into tool dependencies and daemon workflow dispatch.
How:
1. Add optional `workspaceRoot` to `ToolDeps`.
2. Set `workspaceRoot: core.cacheRoot` when constructing tool deps.
3. Add a direct-tool helper that defaults omitted workflow output roots from `deps.workspaceRoot`.
4. Use the helper in research, shopping, inspiredesign, and product-video tool entrypoints.
5. Use the shared resolver in daemon workflow cases for omitted roots.
Files impacted: `src/tools/deps.ts`, `src/index.ts`, `src/tools/workflow-output.ts` (new), `src/tools/research_run.ts`, `src/tools/shopping_run.ts`, `src/tools/inspiredesign_run.ts`, `src/tools/product_video_run.ts`, `src/cli/daemon-commands.ts`.
Acceptance criteria:
- [x] OpenCode direct workflow tools write omitted outputs to `<workspaceRoot>/.opendevbrowser/<workflow>/<uuid>`.
- [x] Daemon direct RPC omitted roots align with `core.cacheRoot`.
- [x] CLI path remains unchanged.
- [x] Explicit output roots are preserved.

## Task 4 - Update Documentation And Gates
Reasoning: The contract should be discoverable and verified after behavior changes.
What to do: Document the uniform output-root contract and run focused plus full gates.
How:
1. Update workflow output wording in `docs/CLI.md`.
2. Update relevant surface documentation if the direct tool contract is listed there.
3. Run focused tests, then build, typecheck, lint, full tests, and diff checks.
Files impacted: `docs/CLI.md`, `docs/SURFACE_REFERENCE.md` if needed.
Acceptance criteria:
- [x] Docs state omitted workflow outputs use invocation/workspace `.opendevbrowser/<workflow>/<uuid>`.
- [x] Docs preserve the distinction between workflow output roots and helper cleanup temp roots.
- [x] Focused workflow tests pass.
- [x] Full repo gates pass with expected test-owned stderr and no failures.
