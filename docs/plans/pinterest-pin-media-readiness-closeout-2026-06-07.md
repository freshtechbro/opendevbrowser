# Pinterest Pin-Media Readiness Closeout Plan

Status: active
Date: 2026-06-07
Branch: `codex/pinterest-pin-media-readiness-fix`

## 2026-06-12 Add-On Scope

The closeout was extended after PR `#79` was opened. The prior commit `28b3362` made the branch green, but the user now requires a stronger live proof: the Pinterest Inspired Design flow must run straight through from user request to pin discovery, selected pin harvest, media analysis, and design-ready direction. A diagnostic-only artifact is not an acceptable final result when Pinterest auth, daemon state, and discoverable pin evidence are healthy.

New success criteria:

- The local daemon is aligned to the current branch build before live workflow validation.
- `inspiredesign harvest` with a Pinterest query discovers canonical pins, captures or harvests trusted evidence for selected pins, runs media analysis, and emits product-ready design direction.
- `inspiredesign harvest` with an explicit Pinterest pin validates the pin-harvest path independent of query discovery.
- `inspiredesign run` with a Pinterest reference validates the direct Inspired Design command path.
- `media-analysis.json` is present when pin media exists, contains usable design facts, and remains non-authoritative.
- `canvas-plan.request.json` exists only for product-ready output and does not leak raw media paths, direct Pinterest media URLs, or raw media-analysis internals.
- Branch coverage deficits are measured before adding tests or rerunning the full suite repeatedly.
- Any new fixes receive adversarial review, focused regressions, full gates, an additional atomic commit, a push to PR `#79`, and green PR checks.

## Task 6 - Daemon Alignment And Scenario Inventory
Reasoning: The last live run was blocked before Pinterest execution by `daemon_fingerprint_mismatch`, and validating the seamless user-facing flow requires a current daemon plus a concrete scenario inventory.
What to do: Align the daemon to the current branch build and document the exact live scenarios being validated.
How:
1. Run `npm run build` to ensure `dist/cli/index.js` matches the branch.
2. Run `node dist/cli/index.js status --daemon --output-format json` and inspect `data.fingerprintCurrent`.
3. If the daemon is stale, stop or restart the daemon from the current branch build without changing source.
4. Re-run daemon status until `fingerprintCurrent=true`.
5. Record the three scenarios: Pinterest query harvest, explicit Pinterest pin harvest, and direct Inspired Design run with Pinterest reference.
6. Preserve evidence under `.tmp/pinterest-closeout-*` only.
Files impacted: `docs/plans/pinterest-pin-media-readiness-closeout-2026-06-07.md`, local daemon state, `.tmp/pinterest-closeout-*`.
End goal: Live validation starts from a current daemon and a clear test matrix.
Acceptance criteria:
- [x] Current-build daemon status reports `fingerprintCurrent=true`.
- [x] Scenario matrix covers query harvest, explicit pin harvest, and direct run.
- [x] No source changes are made during daemon alignment unless a code defect is proven.

## Task 7 - Seamless Pinterest Flow Live Validation
Reasoning: The product requirement is a straight-through command flow from user request to design-ready direction, not a transport-level completion or diagnostic-only artifact.
What to do: Run multiple live command paths and inspect the output bundles for product readiness, media analysis, and leak safety.
How:
1. Run `node dist/cli/index.js inspiredesign harvest` with `--provider social/pinterest`, a design brief, a Pinterest query, extension mode, required cookies, required visual evidence, and `--timeout-ms 240000`.
2. Run `node dist/cli/index.js inspiredesign harvest` with a known canonical Pinterest pin URL.
3. Run `node dist/cli/index.js inspiredesign run` with a Pinterest reference URL and prototype guidance enabled if supported.
4. For every bundle, inspect `evidence.json`, `ranked-references.json`, `pin-media-index.json`, `pin-media-evidence.json`, `media-analysis.json`, `design-agent-handoff.json`, `advanced-brief.md`, `meta-prompt.md`, and `canvas-plan.request.json` when present.
5. Verify `productSuccess=true`, `artifactAuthority=product_ready`, `nextStepGuidance.readiness=ready`, and `evidenceAuthority` in `pin_media_ready`, `snapshot_ready`, or `motion_ready`.
6. Verify media analysis has design direction facts and no `artifactAuthority`, `evidenceAuthority`, `productSuccess`, or `diagnosticWarning`.
7. Verify rejected diagnostics do not dominate design-ready output.
Files impacted: runtime artifacts under `.tmp/pinterest-closeout-*` unless a code defect is proven.
End goal: The live commands prove the flow produces usable design-ready media direction instead of diagnostics.
Acceptance criteria:
- [x] Query harvest reaches product-ready output with non-empty ranked references and media-analysis design facts.
- [x] Explicit pin harvest reaches product-ready output with trusted evidence.
- [x] Direct Inspired Design run reaches product-ready output or exposes a scoped implementation gap.
- [x] Canvas request exists only for product-ready output and contains no raw media leakage.

### 2026-06-12 Live Evidence

- Explicit Pinterest pin harvest: `.tmp/pinterest-closeout-20260612/harvest-pin-843-after-networkidle-cap/inspiredesign/f9e5d438-1edd-4d97-afab-2b5c79853141`
  - `ranked-references.json`: `productSuccess=true`, `artifactAuthority=product_ready`, `evidenceAuthority=pin_media_ready`, `references.length=1`.
  - `pin-media-index.json`: `pinMediaIndex.length=1`, saved `pin-media-evidence/31d105f36553/main.jpg`.
  - `media-analysis.json`: `references.length=1`, kind `image`.
  - `canvas-plan.request.json`: present with `canvasSessionId`, `leaseId`, `documentId`, `requestId`, and `generationPlan` keys.
- Pinterest query harvest with discovery: `.tmp/pinterest-closeout-20260612/harvest-query-after-networkidle-cap/inspiredesign/7eb00cde-0d7c-4c34-bfb8-1549e23f7860`
  - CLI response accepted five canonical Pinterest pin URLs through discovery and returned `readiness=ready`.
  - `ranked-references.json`: `productSuccess=true`, `artifactAuthority=product_ready`, `evidenceAuthority=pin_media_ready`, `references.length=4`.
  - `pin-media-index.json`: `pinMediaIndex.length=4`, saved one video and three image media artifacts.
  - `media-analysis.json`: `references.length=4`, kinds `video`, `image`, `image`, and `image`.
  - `canvas-plan.request.json`: present with only Canvas request keys.
- Direct `inspiredesign run` with Pinterest pin: `.tmp/pinterest-closeout-20260612/direct-run-pin-after-networkidle-cap/inspiredesign/be19b99c-7976-438d-8eb9-75d7ddd5cb11`
  - `ranked-references.json`: `productSuccess=true`, `artifactAuthority=product_ready`, `evidenceAuthority=pin_media_ready`, `references.length=1`.
  - `pin-media-index.json`: `pinMediaIndex.length=1`, saved `pin-media-evidence/31d105f36553/main.jpg`.
  - `media-analysis.json`: `references.length=1`, kind `image`.
  - `canvas-plan.request.json`: present with `canvasSessionId`, `leaseId`, `documentId`, `requestId`, and `generationPlan` keys.

## Task 8 - Branch-Deficit-Aware Test Strategy
Reasoning: Full coverage runs are expensive, and the branch has repeatedly landed exactly at the branch threshold. New tests should be driven by measured deficits, not guesswork.
What to do: Measure branch coverage state before adding tests or running repeated full suites.
How:
1. Run focused regressions around any changed seam first.
2. Inspect current coverage artifacts if available.
3. Run the coverage wrapper only when needed to compute branch deficit.
4. Compute whether branch coverage is below the `97%` threshold and identify the exact files with uncovered changed branches.
5. Add only targeted tests that close the measured deficit.
6. Run the full suite only after focused tests and branch deficit checks are clean.
Files impacted: `tests/*` only when a measured branch deficit exists.
End goal: Coverage work is precise and does not waste repeated full-suite runs.
Acceptance criteria:
- [ ] Branch deficit is recorded before adding tests.
- [ ] Focused tests cover new branch outcomes.
- [ ] Full suite is run after focused/coverage checks show it is worth running.

## Task 9 - Add-On Review, Commit, Push, And PR Checks
Reasoning: The add-on changes final acceptance, so new evidence and any code changes must be reviewed and landed through the existing PR.
What to do: Run a final adversarial review, fix blockers, commit additional changes, push, and verify PR `#79`.
How:
1. Run a scoped adversarial RepoPrompt review over any new diff and live evidence.
2. Fix only real blockers in the Pinterest Inspired Design flow.
3. Rerun focused tests and full gates after fixes.
4. Stage only intended source, test, and doc changes.
5. Commit an additional atomic Conventional Commit with the required co-author trailer.
6. Push `codex/pinterest-pin-media-readiness-fix`.
7. Verify PR `#79` checks are green.
Files impacted: changed source/tests/docs, git index, GitHub PR `#79`.
End goal: PR `#79` includes the add-on validation/fix commit and remains merge-ready.
Acceptance criteria:
- [ ] Final review has no unresolved blockers.
- [ ] Full quality gates pass after all changes.
- [ ] Additional commit is pushed to PR `#79`.
- [ ] PR checks are green.

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
