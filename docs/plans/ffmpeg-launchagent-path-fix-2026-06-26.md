# FFmpeg/FFprobe LaunchAgent PATH and Resolver Fallback: Plan

## Goal
Fix the macOS LaunchAgent and media-analysis binary-resolution gaps that make FFmpeg/FFprobe unavailable even when they are installed on the host.

Success means:
- Fresh macOS daemon autostart installs create a LaunchAgent with a safe default `EnvironmentVariables.PATH`.
- Existing old LaunchAgent plists without the required PATH entries are classified as repairable during install-time reconciliation.
- The media-analysis resolver finds FFmpeg/FFprobe from common absolute install directories when bare `ffmpeg` / `ffprobe` lookup fails with ENOENT.
- Explicit env/config paths remain authoritative and do not silently fall back when invalid.
- FFmpeg/FFprobe remain optional and non-fatal. Missing binaries degrade `media-analysis.json` only.
- Unit tests, docs sync tests, generated public-surface checks, build, lint, full coverage, extension build, and version check pass.

## Validated Evidence
The plan was re-audited against current source, the existing critique, and both investigation reports.

Confirmed defects:
- `buildLaunchAgentPlist()` has no `EnvironmentVariables` block. See `src/cli/daemon-autostart.ts:197`.
- `readMacLaunchAgentProgramArguments()` reads only `ProgramArguments` and `WorkingDirectory`. See `src/cli/daemon-autostart.ts:363`.
- `classifyMacAutostartStatus()` never checks `EnvironmentVariables`. See `src/cli/daemon-autostart.ts:393`.
- `resolveBinaryStatus()` passes bare path defaults into `probeBinaryVersion()` and returns unavailable immediately on limitation. See `src/inspiredesign/media-analysis/binaries.ts:78`.
- `formatProbeError()` converts ENOENT to a plain string, losing the structured error signal needed for fallback. See `src/inspiredesign/media-analysis/binaries.ts:239`.
- `resolvedPath` flows into real analyzer spawns through `src/providers/workflows.ts:3904`, `src/inspiredesign/media-analysis/analyzer.ts:95`, `src/inspiredesign/media-analysis/ffprobe.ts:52`, and `src/inspiredesign/media-analysis/ffmpeg.ts:146`.

Validated critique findings folded into this plan:
- The LaunchAgent environment check must run before the transient-entrypoint healthy short-circuit at `src/cli/daemon-autostart.ts:461`.
- The resolver injection seam must be tool-aware for both parallel calls in `resolveInspiredesignMediaAnalysisBinaries()` at `src/inspiredesign/media-analysis/binaries.ts:52` and `src/inspiredesign/media-analysis/binaries.ts:59`.
- The plan needs direct tests for `missing_environment_path` classification, not only plist generation.
- Exact PATH equality would overwrite user-customized LaunchAgent PATH values. The classifier should instead require the default path entries to be present and allow extra user entries.
- Docs sync must include `src/public-surface/source.ts`, generated manifests, `docs/DEPENDENCIES.md`, `skills/opendevbrowser-best-practices/SKILL.md`, and media-analysis dependency guidance tests.
- Fallback success tests must not use `#!/usr/bin/env node` under stripped PATH. They need a fake executable with an absolute `process.execPath` shebang.

## Implementation Approach

### Commit 1: LaunchAgent PATH and Upgrade Repair Detection
Add a named default PATH and require those entries in parsed LaunchAgent plists.

Use two constants instead of one opaque string:

```ts
const MAC_LAUNCH_AGENT_DEFAULT_PATH_ENTRIES = [
  "/opt/homebrew/bin",
  "/opt/local/bin",
  "/usr/local/bin",
  "/nix/var/nix/profiles/default/bin",
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/sbin"
] as const;

const MAC_LAUNCH_AGENT_DEFAULT_PATH = MAC_LAUNCH_AGENT_DEFAULT_PATH_ENTRIES.join(":");
```

The generated plist should write the exact default string. The classifier should not require exact equality. It should split the parsed PATH by `:` and require every entry in `MAC_LAUNCH_AGENT_DEFAULT_PATH_ENTRIES` to be present. Extra custom entries should remain healthy.

Add `missing_environment_path` to `AutostartReason`. The name covers missing or incomplete `EnvironmentVariables.PATH`.

No production change is needed in `src/cli/install-autostart-reconciliation.ts` or `src/cli/installers/package-postinstall.ts`. They already treat `health: "needs_repair"` as repairable and do not branch on the specific reason.

### Commit 2: Resolver ENOENT Fallback With Tool-Aware Common Directories
Do not add a top-level `commonPaths` list of full binary paths. That is ambiguous because the public resolver resolves both tools in parallel. Use common directories instead:

```ts
export type InspiredesignMediaAnalysisBinaryResolverOptions = {
  config?: InspiredesignMediaAnalysisBinaryPathsConfig;
  env?: InspiredesignMediaAnalysisBinaryResolverEnv;
  timeoutMs?: number;
  commonPathDirs?: readonly string[];
};
```

Thread `options.commonPathDirs` into both `resolveBinaryStatus()` calls. Each call derives its own tool-specific candidate path by joining the directory with `request.tool`.

Refactor `ProbeResult` to preserve ENOENT:

```ts
type ProbeResult =
  | { version: string }
  | { limitation: string; enoent?: boolean };
```

`formatProbeError()` should return a structured limitation object. `unavailableStatus()` should remain unchanged and receive only `probe.limitation`.

Fallback should run only when all conditions hold:
- Selected source is `path`.
- The original bare-name probe failed with ENOENT.
- The requested path is non-blank.

Fallback must not run for env or config sources. Explicit bad user configuration should stay visible and diagnostic.

### Commit 3: Docs, Public Surface, and Generated Manifest Sync
The behavior changes user-facing dependency guidance. Update docs and generated surfaces after source/tests are green, then run the guidance tests that lock this contract.

## Work Items

## Task 1 - Add LaunchAgent PATH constants
Reasoning: A named, auditable default PATH avoids launchd's minimal PATH without hiding magic strings in plist generation.
What to do: Add `MAC_LAUNCH_AGENT_DEFAULT_PATH_ENTRIES` and `MAC_LAUNCH_AGENT_DEFAULT_PATH`.
How:
1. Add constants near `MAC_LABEL` and `WIN_TASK_NAME` in `src/cli/daemon-autostart.ts`.
2. Include Homebrew Apple Silicon, MacPorts, Homebrew Intel/manual installs, Nix multi-user system profile, and standard macOS system paths.
3. Keep the constant macOS-only. Do not change Windows Task Scheduler behavior.
Files impacted: `src/cli/daemon-autostart.ts`.
Acceptance criteria:
- [ ] Constants are named and contain all required path entries.
- [ ] No new config option is introduced.
- [ ] No Windows behavior changes.

## Task 2 - Write EnvironmentVariables.PATH into generated LaunchAgent plists
Reasoning: Fresh macOS autostart installs should work without the user's shell profile.
What to do: Add an `EnvironmentVariables` dictionary to `buildLaunchAgentPlist()`.
How:
1. Insert the block after `StandardErrorPath` and before `</dict>`.
2. Write nested `PATH` using `escapePlistString(MAC_LAUNCH_AGENT_DEFAULT_PATH)`.
3. Keep `ProgramArguments`, `WorkingDirectory`, `RunAtLoad`, `KeepAlive`, stdout, and stderr behavior unchanged.
Files impacted: `src/cli/daemon-autostart.ts`.
Acceptance criteria:
- [ ] Generated plist contains `<key>EnvironmentVariables</key>`.
- [ ] Generated plist contains nested `<key>PATH</key>`.
- [ ] PATH value includes `/opt/homebrew/bin`, `/opt/local/bin`, `/usr/local/bin`, `/nix/var/nix/profiles/default/bin`, and system paths.

## Task 3 - Parse LaunchAgent EnvironmentVariables.PATH
Reasoning: Upgrade repair depends on reading old plist environment state, not only writing new plist state.
What to do: Extend the macOS plist parse result.
How:
1. Add `environmentPath?: string` to the ok variant of `MacLaunchAgentParseResult`.
2. Parse JSON as an object that may include `EnvironmentVariables`.
3. Extract `EnvironmentVariables.PATH` only when `EnvironmentVariables` is a non-null object and `PATH` is a string.
4. Return `environmentPath` only when present.
Files impacted: `src/cli/daemon-autostart.ts`.
Acceptance criteria:
- [ ] Malformed plist behavior remains unchanged.
- [ ] Missing `ProgramArguments` behavior remains unchanged.
- [ ] Parsed `environmentPath` is available to `classifyMacAutostartStatus()`.

## Task 4 - Detect missing or incomplete LaunchAgent PATH entries
Reasoning: Old plists must be repairable on npm upgrade, but user-added PATH entries should not force repair when required entries are present.
What to do: Add a focused helper and classify stale environment paths as `needs_repair`.
How:
1. Add `missing_environment_path` to `AutostartReason`.
2. Add a helper such as `launchAgentPathHasRequiredEntries(value: string | undefined): boolean`.
3. The helper should split by `:` and require every `MAC_LAUNCH_AGENT_DEFAULT_PATH_ENTRIES` value.
4. In `classifyMacAutostartStatus()`, run the helper after working-directory checks and before the transient-entrypoint healthy short-circuit.
5. If required entries are missing, return `health: "needs_repair"`, `needsRepair: true`, and `reason: "missing_environment_path"`.
6. Preserve existing precedence: program argument repair first, working-directory repair second, environment PATH repair third, expected command mismatch after that.
Files impacted: `src/cli/daemon-autostart.ts`.
Acceptance criteria:
- [ ] Old plist without `EnvironmentVariables` is `needs_repair`.
- [ ] Old plist with `EnvironmentVariables` but no `PATH` is `needs_repair`.
- [ ] Plist with incomplete PATH is `needs_repair`.
- [ ] Plist with all required entries plus custom entries is `healthy`.
- [ ] Program-argument and working-directory failures still take precedence over environment PATH failures.

## Task 5 - Add LaunchAgent classification and plist tests
Reasoning: The bug is both write-side and read-side; both need direct regression tests.
What to do: Extend `tests/daemon-autostart.test.ts`.
How:
1. Add plist generation assertions to the existing `builds a launch agent plist with program arguments` test.
2. Update `createDarwinStatusFixture()` to accept `environmentPath?: string | null`.
3. Make the fixture default to the expected generated PATH so existing healthy tests stay healthy after the classifier change.
4. Add a test for missing `EnvironmentVariables.PATH` returning `reason: "missing_environment_path"`.
5. Add a test for incomplete PATH returning `reason: "missing_environment_path"`.
6. Add a test for custom PATH with all required entries plus an extra directory staying healthy.
7. Add a precedence test proving working-directory mismatch remains `working_directory_mismatch` even when PATH is missing.
8. Add a transient-current-entrypoint test proving stale environment PATH is reported before the transient healthy shortcut.
Files impacted: `tests/daemon-autostart.test.ts`.
Acceptance criteria:
- [ ] Write-side plist generation is covered.
- [ ] Read-side upgrade repair classification is covered.
- [ ] Custom PATH preservation is covered.
- [ ] Precedence and transient ordering are covered.

## Task 6 - Verify install-time reconciliation remains behavior-compatible
Reasoning: The classifier will produce a new reason, but the reconciler should already handle any `needs_repair` status.
What to do: Verify no production changes are needed in reconciliation or package postinstall.
How:
1. Inspect `src/cli/install-autostart-reconciliation.ts` and confirm it branches on `status.health`, not specific `reason`.
2. Inspect `src/cli/installers/package-postinstall.ts` and confirm package postinstall delegates to reconciliation.
3. Run existing reconciliation and package-postinstall tests.
4. Add a focused reconciliation test only if current tests do not already prove `needs_repair` triggers `installAutostart()`.
Files impacted: `tests/install-autostart-reconciliation.test.ts` only if needed.
Acceptance criteria:
- [ ] Existing repair behavior remains unchanged.
- [ ] New reason does not require source branching in the reconciler.
- [ ] Upgrade path is covered by classifier plus existing reconciliation behavior.

## Task 7 - Refactor probe error reporting to preserve ENOENT
Reasoning: Fallback must distinguish missing binary lookup from timeout, bad output, non-zero exit, and permission failures.
What to do: Preserve `enoent` in `ProbeResult`.
How:
1. Change `ProbeResult` limitation variant to `{ limitation: string; enoent?: boolean }`.
2. Refactor `formatProbeError()` to return a structured limitation object.
3. In `probeBinaryVersion()`, return the structured object from `formatProbeError()`.
4. Do not change `parseVersionOutput()` behavior.
5. Do not change `unavailableStatus()`; it should still receive only a limitation string.
Files impacted: `src/inspiredesign/media-analysis/binaries.ts`.
Acceptance criteria:
- [ ] ENOENT failures produce `{ limitation: "... binary was not found.", enoent: true }`.
- [ ] Non-ENOENT failures remain limitation-only.
- [ ] Existing limitation strings remain unchanged.

## Task 8 - Add tool-aware common directory fallback
Reasoning: A top-level full-path list is ambiguous for two tools. Directory injection keeps test seams hermetic and tool-aware.
What to do: Add `commonPathDirs?: readonly string[]` and fallback helpers.
How:
1. Add `commonPathDirs?: readonly string[]` to `InspiredesignMediaAnalysisBinaryResolverOptions`.
2. Pass `options.commonPathDirs` as the fourth parameter to both `resolveBinaryStatus()` calls at `binaries.ts:52` and `binaries.ts:59`.
3. Add `defaultCommonPathDirs(platform: NodeJS.Platform): readonly string[]`.
4. macOS defaults: `/opt/homebrew/bin`, `/opt/local/bin`, `/usr/local/bin`, `/nix/var/nix/profiles/default/bin`, `/usr/bin`.
5. Linux defaults: `/usr/local/bin`, `/usr/bin`.
6. Other platforms default to an empty list.
7. Add `tryCommonPathFallback(request, env, timeoutMs, commonPathDirs)` that joins each directory with `request.tool`, probes each absolute candidate, and returns the first successful status.
8. Keep `resolveBinaryStatus()` under complexity limits by delegating fallback decisions to a small helper if necessary.
Files impacted: `src/inspiredesign/media-analysis/binaries.ts`.
Acceptance criteria:
- [ ] Fallback is attempted only for `source: "path"` plus ENOENT.
- [ ] Fallback never runs for env/config source.
- [ ] Fallback success returns `requestedPath: request.pathDefault`, `resolvedPath: <absolute candidate>`, `source: "path"`, and the correct capability tier.
- [ ] `commonPathDirs: []` disables fallback for tests.
- [ ] Function parameter counts stay within project limits.

## Task 9 - Add resolver fallback tests
Reasoning: The resolver bug is environment-sensitive and must remain hermetic in CI.
What to do: Extend `tests/inspiredesign-media-analysis.test.ts`.
How:
1. Update every resolver call in the existing missing/blank PATH test that can leave either tool at `source: "path"` to pass `commonPathDirs: []`.
2. Add a helper for fallback tests that writes fake executables with an absolute `process.execPath` shebang, not `#!/usr/bin/env node`.
3. Add fallback success test: bare-name PATH fails, common directory contains both `ffmpeg` and `ffprobe`, resolver returns full availability and absolute `resolvedPath` values.
4. Add no-fallback-for-explicit-env/config test: invalid env/config path remains unavailable even when `commonPathDirs` contains working binaries.
5. Add empty-common-dirs test: `commonPathDirs: []` keeps the original missing-binary limitation.
6. Add no-common-candidate test: candidate directories with missing files return unavailable.
7. Add partial availability tests: only `ffmpeg` found yields `frame_decode_only`; only `ffprobe` found yields `metadata_only`.
Files impacted: `tests/inspiredesign-media-analysis.test.ts`.
Acceptance criteria:
- [ ] Tests do not depend on host FFmpeg/FFprobe.
- [ ] Tests cover both tools, explicit override non-fallback, empty fallback list, no candidates, and partial availability.
- [ ] Existing limitation strings are preserved.

## Task 10 - Update public docs and generated surfaces
Reasoning: The behavior changes operator-facing dependency and daemon guidance.
What to do: Update all synced guidance surfaces.
How:
1. Update `docs/CLI.md` daemon auto-start behavior to mention macOS `EnvironmentVariables.PATH`.
2. Update `docs/CLI.md` Inspiredesign media-analysis notes to say resolution is env, then config, then PATH, then common absolute install directories for implicit PATH-source misses.
3. Update `docs/TROUBLESHOOTING.md` media-analysis remediation with LaunchAgent PATH and common-dir fallback behavior.
4. Update `docs/SURFACE_REFERENCE.md` media-analysis resolution wording.
5. Update `docs/DEPENDENCIES.md` optional host tool wording.
6. Update `src/public-surface/source.ts` `MEDIA_ANALYSIS_DEPENDENCY_NOTE`.
7. Regenerate `src/public-surface/generated-manifest.ts` and `src/public-surface/generated-manifest.json`.
8. Update `skills/opendevbrowser-best-practices/SKILL.md`.
9. Audit AGENTS sync sections referenced by `tests/media-analysis-dependency-guidance.test.ts`. Do not edit root `AGENTS.md` governance unless explicitly needed and task-scoped.
Files impacted: `docs/CLI.md`, `docs/TROUBLESHOOTING.md`, `docs/SURFACE_REFERENCE.md`, `docs/DEPENDENCIES.md`, `src/public-surface/source.ts`, generated public-surface manifests, `skills/opendevbrowser-best-practices/SKILL.md`, AGENTS sync docs if needed.
Acceptance criteria:
- [ ] Docs preserve optional-host-tool wording.
- [ ] Docs preserve no-bundled-binaries and no-default-downloads wording.
- [ ] Docs preserve media-analysis non-authority wording.
- [ ] Public-surface generated manifests match source.

## Task 11 - Run focused and docs-sync tests before full gates
Reasoning: The highest-risk breakpoints are parser classification, resolver hermeticity, and guidance sync.
What to do: Run focused test suites before full gates.
How:
1. `npm run test -- tests/daemon-autostart.test.ts tests/install-autostart-reconciliation.test.ts`
2. `npm run test -- tests/inspiredesign-media-analysis.test.ts`
3. `npm run test -- tests/media-analysis-dependency-guidance.test.ts tests/public-surface-manifest.test.ts tests/cli-help-parity.test.ts`
4. `node scripts/generate-public-surface-manifest.mjs` before public-surface manifest tests if `src/public-surface/source.ts` changed.
5. `./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh` if the best-practices skill changed.
Files impacted: none.
Acceptance criteria:
- [ ] Focused runtime tests pass.
- [ ] Docs/public-surface tests pass.
- [ ] Skill validation passes when applicable.

## Task 12 - Commit atomically
Reasoning: Separate runtime fixes from docs/public-surface sync so review and rollback stay clear.
What to do: Create three scoped commits.
How:
1. Commit 1: `feat: add LaunchAgent PATH environment repair`
2. Commit 2: `feat: add FFmpeg common-directory fallback`
3. Commit 3: `docs: document FFmpeg LaunchAgent path fallback`
4. Each commit message must include `Co-authored-by: Codex <noreply@openai.com>` exactly once.
Files impacted: commit-dependent.
Acceptance criteria:
- [ ] Runtime plist/reconciliation work is separate from resolver work.
- [ ] Docs/generated-surface sync is separate from runtime code.
- [ ] No unrelated files are staged.

## Task 13 - Run full quality gates and inspect diff
Reasoning: The change touches runtime, tests, docs, generated manifests, and skill guidance.
What to do: Run the repo's full gates and inspect final state.
How:
1. `npm run lint`
2. `npm run build`
3. `npm run test`
4. `npm run extension:build`
5. `npm run version:check`
6. `git diff --check`
7. Inspect `git status --short` and `git diff --stat` for unrelated files.
Files impacted: none.
Acceptance criteria:
- [ ] Lint passes with zero warnings.
- [ ] Build exits 0.
- [ ] Full test suite passes with coverage thresholds.
- [ ] Extension build passes.
- [ ] Version check passes.
- [ ] Diff contains only intended runtime, test, docs, generated-manifest, and skill guidance changes.

## Non-Goals
- Do not bundle `ffmpeg-static`, `ffprobe-static`, `@ffmpeg/ffmpeg`, or any static FFmpeg package.
- Do not add postinstall downloads.
- Do not make FFmpeg/FFprobe required for workflow readiness.
- Do not let `media-analysis.json` become pin-media or product-readiness authority.
- Do not add user config for LaunchAgent PATH in this change.
- Do not change Windows autostart behavior.

## References
- Primary investigation: `docs/investigations/ffmpeg-launchagent-path-deep-2026-06-26.md`
- Prior investigation: `docs/investigations/ffmpeg-launchagent-path-detection-2026-06-23.md`
- Critique incorporated: `docs/reviews/ffmpeg-launchagent-path-fix-critique-2026-06-26.md`
