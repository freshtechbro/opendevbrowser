# Critique: FFmpeg/FFprobe LaunchAgent PATH and Resolver Fallback Plan

**Plan:** `docs/plans/ffmpeg-launchagent-path-fix-2026-06-26.md`

## Top 3 Under-Specified Seams

1. **Transient entrypoint bypass (Task 3, `daemon-autostart.ts:460-470`)**: The reconciliation check for `missing_environment_path` is planned to run only for non-transient entrypoints because the existing `isTransient` guard at line 461 returns "healthy" and short-circuits. The plan never addresses this: a transient install with an old plist gets no PATH repair. The check needs to be placed *before* the `isTransient` guard for `missing_environment_path` (or the transient guard needs rethinking). Task 3's line reference of "after line ~460" hints at this but never states the dependency explicitly.

2. **`commonPaths` thread-through to both binaries (Task 7-8)**: The plan adds `commonPaths` to `InspiredesignMediaAnalysisBinaryResolverOptions` but never shows how it reaches `resolveBinaryStatus` for *both* ffmpeg and ffprobe calls. The two parallel calls in `resolveInspiredesignMediaAnalysisBinaries` (line 51-63) use `resolveBinaryStatus` with `env` and `timeoutMs` only. Each call needs its own tool-aware common path list, but the plan only mentions `tryCommonPathFallback` generically. The wiring for "tool-specific common paths per call" is absent.

3. **`formatProbeError` return type change (Task 6)**: `formatProbeError` returns a `string`, and `probeBinaryVersion` at line 167 wraps it as `{ limitation: formatProbeError(...) }`. The plan says "refactor `formatProbeError` to return `{ limitation: string; enoent?: boolean }`" but never addresses the two other callers that use the limitation string generically (`unavailableStatus` at line 122 accepts `string`). The full type chain from `ProbeResult` through `unavailableStatus` needs updating, not just `formatProbeError`.

## Contradictions or Missing Dependencies

- **Task 1 mis-cites line 6**: The plan says "add constant after `WIN_TASK_NAME` at line 6." `WIN_TASK_NAME` is at line 8, not line 6. Line 6 is an import. Minor, but indicative of imprecise line references.
- **No dependency declared on `install-autostart-reconciliation.ts`**: Task 5 task says only stage `daemon-autostart.ts` and its test, but the reconciliation *consumer* (`reconcileInstallAutostart` in `install-autostart-reconciliation.ts`) will now receive a new reason (`missing_environment_path`). That file may need to handle the new reason or pass it through. The plan lists no change to reconciliation consumer tests or the reconciler itself beyond the classifier.
- **Test at line 198 is part of a multi-object test block**: The existing `missingPath` is not a standalone test case; it's one of several resolve calls inside the try-block (lines 190-205), with assertions at 221-236. Simply adding `commonPaths: []` to one call object doesn't cover the `explicitEnvFailure` at line 197 (which also passes `config` but uses a bad env path). The plan treats line 198 as isolated; it isn't.

## Risk of Over-Planning (Cut/Simplify)

- **Open Questions section should be deleted**: Both questions are answered within the plan itself ("recommends a hardcoded constant", "lower priority"). They add no decision weight and read as investigation notes, not plan work.
- **Task 11 (docs update) is premature**: The plan changes behavior before verifying the approach works. Docs updates should follow the quality gate (Task 12), not precede it. Merge into a post-gate checklist item or defer.
- **Task 12 duplicates Task 5/10 commit steps**: Both commit tasks already run build and tests. A separate full-gate task adds a third full test run for a 2-file change. Simplify to: run full suite once after both commits, skip the per-commit partial runs (or vice versa).
- **References block**: 5 references including 2 prior investigations. Cut to just the investigation report this plan derives from; the others are context for that report, not for execution.

## Questions Whose Answers Would Change Implementation Order

1. Does the `missing_environment_path` check need to run before or after the `isTransient` guard? If before, it affects *all* installs and is higher-risk; if the answer is "transient installs don't get repaired," that's a product decision worth stating explicitly.
2. Should `commonPaths` be a single shared list or per-tool (`ffmpeg` vs `ffprobe` paths differ by tool name)? This determines whether `tryCommonPathFallback` takes a tool parameter and builds paths dynamically, or receives a pre-resolved list. It changes Task 7's signature and Task 8's implementation.
3. Is the reconciliation classifier allowed to return multiple reasons (e.g., both `working_directory_mismatch` and `missing_environment_path`), or does the new check replace or augment the existing mismatch exit? Current `classifyMacAutostartStatus` short-circuits on first mismatch; adding a new check after working-directory means it's never reached if working-directory fails first.
