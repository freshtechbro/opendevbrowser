# Pinterest Pin-Media Readiness Closeout Plan

Status: active
Date: 2026-06-07
Branch: `codex/pinterest-pin-media-readiness-fix`

## Task 1 - Baseline And Focused Coverage
Reasoning: The branch has a known global branch coverage deficit and recent full-suite failures, so tests must be added from measured coverage data rather than guesswork.
What to do: Recompute coverage, identify the exact uncovered branches, and add the smallest focused tests that close the deficit.
How:
1. Run focused seam tests to capture current failures.
2. Run `node scripts/run-vitest-coverage.mjs` or `npm run test` and inspect the final branch coverage footer.
3. Add focused tests in the affected files only.
4. Rerun focused tests, then rerun full coverage.
Files impacted: `tests/inspiredesign-product-readiness.test.ts`, `tests/providers-inspiredesign-workflow.test.ts`, `tests/providers-inspiredesign-contract.test.ts`, `tests/tools.test.ts`, `tests/cli-workflows.test.ts`, `tests/zz-inspiredesign-media-analysis-coverage.test.ts`.
End goal: Global branch coverage is at or above the repo threshold with focused regression coverage.
Acceptance criteria:
- [ ] Exact branch deficit is recorded from fresh coverage output.
- [ ] Focused tests cover only relevant product-readiness, media-analysis, workflow, renderer, CLI, or tool branches.
- [ ] Full `npm run test` passes coverage thresholds without failures.

## Task 2 - Coverage Shard And Latency Baseline
Reasoning: The wrapper retry for missing Vitest V8 coverage shards masks a repo-specific failure path, and the latency baseline test failures need a deterministic fix.
What to do: Fix the coverage-shard ENOENT root cause and resolve `tests/cli-tools-latency-baseline.test.ts` without weakening assertions.
How:
1. Reproduce `tests/cli-tools-latency-baseline.test.ts` and the full coverage wrapper failure.
2. Inspect child process coverage environment, benchmark bundle cleanup, and coverage `.tmp` setup.
3. Centralize child benchmark environment sanitization if coverage env inheritance is the cause.
4. Keep coverage root setup explicit and deterministic.
5. Rerun the focused latency test and full coverage wrapper.
Files impacted: `scripts/run-vitest-coverage.mjs`, `scripts/cli-tools-latency-baseline.mjs`, `tests/cli-tools-latency-baseline.test.ts`.
End goal: The full coverage run no longer needs ENOENT retry recovery, and latency baseline tests are stable.
Acceptance criteria:
- [ ] The focused latency baseline test passes.
- [ ] Full coverage run does not emit the missing-shard retry warning.
- [ ] No timing budget is loosened without a measured and justified baseline update.

## Task 3 - Inspired Design Authority Gates
Reasoning: CLI and tool wrappers currently conflate transport completion with product-ready output, which allows diagnostic-only harvests to look successful.
What to do: Make user-facing Inspired Design Harvest readiness explicit while preserving execution completion semantics.
How:
1. Add a narrow helper that recognizes product-ready output only when `productSuccess === true`, `artifactAuthority === "product_ready"`, readiness is `ready`, and `evidenceAuthority` is `snapshot_ready`, `motion_ready`, or `pin_media_ready`.
2. Update CLI result shaping and messages so `success` means command completion and product readiness is reported separately.
3. Update tool response shaping or metadata so `ok` does not imply product success.
4. Add diagnostic-only and product-ready regressions.
Files impacted: `src/cli/commands/inspiredesign.ts`, `src/tools/inspiredesign_run.ts`, `tests/cli-workflows.test.ts`, `tests/tools.test.ts`.
End goal: Diagnostic-only harvest output is never presented as product-successful.
Acceptance criteria:
- [ ] Diagnostic-only harvest command output has explicit `productSuccess: false`.
- [ ] Product-ready harvest command output has explicit `productSuccess: true`.
- [ ] Tool output preserves execution completion while exposing product readiness separately.

## Task 4 - Real Pinterest Harvest Proof And Leak Inspection
Reasoning: A green unit suite is insufficient for this workflow; the branch must prove a real Pinterest Harvest bundle is design-ready or accurately classified as diagnostic.
What to do: Run an actual Pinterest Inspired Design Harvest workflow and inspect emitted artifacts.
How:
1. Preflight daemon freshness before the run.
2. Run `opendevbrowser inspiredesign harvest` against a canonical Pinterest pin URL with cookies and extension mode when available.
3. Inspect `pin-media-index.json`, `pin-media-evidence.json`, `media-analysis.json`, `evidence.json`, `design-agent-handoff.json`, and `canvas-plan.request.json` if emitted.
4. Check for temp path leaks, base64 blobs, raw media-analysis internals, remote-only readiness claims, and diagnostic warnings in product-ready artifacts.
Files impacted: runtime artifacts only.
End goal: The artifact bundle is either product-ready by authority gates or explicitly diagnostic with evidence.
Acceptance criteria:
- [ ] Product-ready claim includes `artifactAuthority: "product_ready"` and accepted evidence authority.
- [ ] `pin-media-index.json` is the only pin-media readiness authority.
- [ ] `media-analysis.json` contains design facts only and does not grant readiness.
- [ ] No local runtime artifacts are staged for commit.

## Task 5 - Final Gates, Review, Commit, And PR
Reasoning: This branch is close to handoff, but commit readiness requires clean gates, scoped adversarial review, and a verified PR.
What to do: Run all final gates, fix scoped blockers, then stage, commit, push, create PR, monitor checks, and hand off for merge approval.
How:
1. Run `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`, `npm run version:check`, skill validation, and docs drift checks.
2. Run RepoPrompt adversarial review on the current diff.
3. Fix only blockers in the changed scope and rerun affected gates.
4. Stage intended files only, excluding `CONTINUITY.md`, `sub_continuity.md`, `coverage/`, `.opendevbrowser/`, `prompt-exports/`, and local artifacts.
5. Commit with a scoped Conventional Commit and required co-author line.
6. Push, create PR, monitor checks, and hand off the PR URL plus check status.
Files impacted: changed branch files, git index, GitHub PR.
End goal: PR is ready for user merge approval with green checks or clearly reported external blockers.
Acceptance criteria:
- [ ] All required quality gates pass with zero errors and warnings.
- [ ] Final adversarial review has no unresolved blockers.
- [ ] Commit contains only intended branch work.
- [ ] PR exists and checks are monitored to a final state or documented blocker.
