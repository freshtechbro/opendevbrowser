# Investigation: FFmpeg/FFprobe LaunchAgent PATH Detection Failure

## Summary
macOS LaunchAgent daemon starts with no PATH environment, so FFmpeg/FFprobe binary resolution fails even when both tools are installed at `/usr/local/bin`. Two independent defects combine: the plist generator omits `EnvironmentVariables.PATH` and the binary resolver has no absolute-path fallback for PATH-sourced lookups. This is a well-known macOS launchd problem confirmed by external sources.

## Symptoms
- `status-capabilities` from the installed global daemon (v0.0.36) does not show `host.mediaAnalysis` diagnostics
- Current branch daemon (with stripped launchd-like PATH) reports `ffmpeg binary was not found.` and `ffprobe binary was not found.`
- Interactive shell (with normal PATH) finds both FFmpeg at `/usr/local/bin/ffmpeg` and FFprobe at `/usr/local/bin/ffprobe`
- Adding `/opt/homebrew/bin:/usr/local/bin` to daemon PATH makes detection pass
- Saved Pinterest harvest `media-analysis.json` contains `ffmpeg binary was not found.` and `ffprobe binary was not found.` limitations

## Background / Prior Research

### External Sources (via opendevbrowser research + direct browse)
- **thimslugga gist** (https://gist.github.com/thimslugga/f38f3d39bd254c1321165e1f41922f41): "Script to manually apply your shell PATH to macOS GUI apps. Fixes issues finding Homebrew/custom tools via launchd & launchctl setenv." Confirms this is a well-known macOS problem where GUI/launchd apps do not inherit shell PATH. The workaround script generates a LaunchAgent plist that calls `launchctl setenv PATH "$current_path"` to propagate shell PATH to GUI context. This validates that injecting PATH via plist is the correct fix pattern.
- **Stack Harbor KB** (https://stackharbor.com/en/knowledge-base/openclaw-as-launchd-service): Documents LaunchAgent best practices including `EnvironmentVariables`, `RunAtLoad`, `KeepAlive` semantics, `StandardOutPath`, and plist linting. Confirms that `EnvironmentVariables` is a standard plist key for daemon environment injection.
- **vpsmac.com** (https://vpsmac.com/en/blog/mac-cloud-cron-launchd-background-jobs-migration-2026.html): References stable paths under `/opt/homebrew/bin` or `/usr/local/bin` for macOS nodes.
- **Apple Stack Exchange** (https://apple.stackexchange.com/questions/64916/defining-environment-variables-with-launchd-launchctl): Community discussion on defining environment variables with launchd/launchctl, confirming the pattern.

### Prior Investigation (2026-06-23 CONTINUITY.md)
- Installed LaunchAgent plist points to `/opt/homebrew/bin/opendevbrowser serve` with no `EnvironmentVariables`; `launchctl getenv PATH` is empty in the daemon context.
- Global daemon `status-capabilities` succeeds but lacks `host.mediaAnalysis`; local branch daemon blocked by `daemon_fingerprint_mismatch`.
- Dev-vs-installed mismatch is secondary: v0.0.36 daemon predates the `host.mediaAnalysis` feature in the current branch.

## Investigator Findings

### Root Cause 1: LaunchAgent plist omits EnvironmentVariables.PATH

**Location:** `src/cli/daemon-autostart.ts:197-233` - `buildLaunchAgentPlist()`

The plist generator creates these keys: `Label`, `ProgramArguments`, `RunAtLoad`, `KeepAlive`, `WorkingDirectory`, `StandardOutPath`, `StandardErrorPath`. There is no `EnvironmentVariables` dictionary at all.

macOS launchd provides a minimal default PATH (`/usr/bin:/bin:/usr/sbin:/sbin`) when no `EnvironmentVariables` are set. This excludes:
- `/opt/homebrew/bin` (Homebrew on Apple Silicon)
- `/usr/local/bin` (Homebrew on Intel, manual installs)

The daemon process therefore cannot find FFmpeg/FFprobe via bare-name PATH lookup.

**External validation:** The thimslugga gist confirms this is a known macOS issue. The Stack Harbor article confirms `EnvironmentVariables` is a standard plist key. The solution is to inject a safe default PATH.

### Root Cause 2: Binary resolver has no absolute-path fallback

**Location:** `src/inspiredesign/media-analysis/binaries.ts:46-113` - `selectRequestedBinary()` and `resolveBinaryStatus()`

The resolution order is:
1. `OPENDEVBROWSER_FFMPEG_PATH` / `OPENDEVBROWSER_FFPROBE_PATH` env vars
2. `inspiredesign.mediaAnalysis.ffmpegPath` / `ffprobePath` config
3. Bare `"ffmpeg"` / `"ffprobe"` from PATH

When source is `"path"`, the resolver returns the bare command name (`"ffmpeg"`, `"ffprobe"`). If `spawn("ffmpeg", ["-version"])` throws ENOENT because PATH doesn't include the tool's directory, the error is caught at `binaries.ts:239-241` and mapped to `"ffmpeg binary was not found."` - the final result. There is no fallback to probe common absolute paths.

### Daemon Reconciliation Impact Analysis

**Location:** `src/cli/daemon-autostart.ts:362-376` - `readMacLaunchAgentProgramArguments()`

The reconciliation logic reads the plist via `plutil -convert json` and extracts only `ProgramArguments` and `WorkingDirectory`. It does NOT read or check `EnvironmentVariables`.

**Impact of adding EnvironmentVariables.PATH to plist:**
- `classifyMacAutostartStatus()` will still report `"healthy"` for existing plists that lack `EnvironmentVariables` - no false repair trigger
- `installMacAutostart()` at line 521-554 always overwrites the plist on install, so existing installs get the new PATH on next `daemon install` or package postinstall
- No existing reconciliation test will break because none assert on `EnvironmentVariables` presence
- **Decision point:** Should reconciliation detect missing `EnvironmentVariables.PATH` and flag for repair? Analysis: No. This would force unnecessary repair of all existing installs for a non-critical optional tool. The PATH will be added on next reinstall. Adding a repair trigger adds complexity for marginal benefit.

### Windows Task PATH Analysis

**Location:** `src/cli/daemon-autostart.ts:236-254` - `buildWindowsTaskArgs()`

Windows uses `schtasks /Create /TN ... /TR <command> /SC ONLOGON /RL LIMITED`. The `schtasks` command does not support custom environment variables directly. Windows scheduled tasks running as `ONLOGON` with `LIMITED` privileges inherit the user's environment at logon time, which typically includes the user's full PATH (including Chocolatey, Scoop, or Winget paths if configured).

**Assessment:** The Windows PATH issue is less severe than macOS because:
- Windows scheduled tasks inherit the user's logon PATH, which usually includes package manager paths
- macOS launchd explicitly does NOT inherit shell PATH, which is the core bug
- However, the resolver-level absolute-path fallback (Root Cause 2 fix) should be platform-agnostic, providing a safety net for both platforms

**Windows-specific fallback paths** (lower priority, not needed for current issue):
- `C:\ProgramData\chocolatey\bin\ffmpeg.exe`
- `%USERPROFILE%\scoop\shims\ffmpeg.exe`
- These can be added later if Windows users report similar issues

### Test Impact Analysis

**Tests that need changes:**

1. `tests/daemon-autostart.test.ts:249-256` - "builds a launch agent plist with program arguments"
   - Currently asserts plist contains `com.test.daemon`, `/node`, `/cli/index.js`, `serve`, `WorkingDirectory`
   - Needs additional assertion: `expect(plist).toContain("EnvironmentVariables")` and `expect(plist).toContain("/opt/homebrew/bin")` and `expect(plist).toContain("/usr/local/bin")`

2. `tests/daemon-autostart.test.ts:611-618` - "creates the macOS LaunchAgents and Logs directories before bootstrap"
   - Currently asserts `writeFileSyncMock` was called with `expect.stringContaining("<key>WorkingDirectory</key>")`
   - This assertion would still pass since `WorkingDirectory` key is still present, but should also check for `EnvironmentVariables` if we want full coverage

**Tests that need NEW additions:**

3. New test: "includes EnvironmentVariables.PATH with Homebrew and system paths in the plist"
   - Assert plist contains `<key>EnvironmentVariables</key>`
   - Assert plist contains `<key>PATH</key>` inside EnvironmentVariables
   - Assert PATH value includes `/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`, `/bin`, `/usr/sbin`, `/sbin`

4. New test: "resolver falls back to absolute paths when PATH-source bare name fails with ENOENT"
   - Set up: empty PATH dir, fake ffmpeg binary at a known absolute path
   - Assert: resolver finds the binary at the absolute path and reports `source: "path"` (or new source type)
   - Assert: `available: true`, correct version string

5. New test: "resolver does NOT fall back when env/config paths are set but fail"
   - Set up: `OPENDEVBROWSER_FFMPEG_PATH` pointing to nonexistent path
   - Assert: `available: false`, `limitation: "ffmpeg binary was not found."` (no fallback)

6. Updated test: `tests/inspiredesign-media-analysis.test.ts:183-267` - "reports missing PATH and explicit override failures as non-fatal limitations"
   - The `missingPath` test (line 190-193) uses `env: { PATH: emptyPathDir }` and expects `available: false` with `limitation: "ffmpeg binary was not found."`
   - If absolute-path fallback is added, this test needs to either:
     a. Use a PATH that also doesn't contain ffmpeg in common absolute paths (e.g., mock `existsSync` to return false for common paths), or
     b. Expect the fallback to succeed if a real ffmpeg exists at a common path (not ideal for CI)
   - **Recommended:** The test should mock filesystem to prevent real binary discovery. The fallback should only trigger when `spawn` returns ENOENT, not when `existsSync` returns false at common paths.

**Tests that remain unchanged:**
- `tests/daemon-autostart.test.ts:267-283` - "escapes launch agent plist string values" - EnvironmentVariables values would also be escaped but this test doesn't need to assert that specifically
- `tests/daemon-autostart.test.ts:285-293` - "builds Windows task args" - no Windows env changes needed
- All reconciliation/status tests (lines 300-746) - `readMacLaunchAgentProgramArguments` only reads `ProgramArguments` and `WorkingDirectory`, so adding `EnvironmentVariables` to the plist does not affect reconciliation logic or its tests
- `tests/automation-coordinator-operator-surfaces.test.ts:222-253` - uses injected `resolveMediaAnalysisBinaries` mock, not the real resolver
- `tests/inspiredesign-media-analysis.test.ts:98-180` - config/env resolution tests, not affected by PATH fallback

### Resolver Fallback Design Analysis

**Key design question:** Should the fallback add a new `BinarySource` type like `"common_path"` or reuse `"path"`?

**Analysis:**
- Current type: `InspiredesignMediaAnalysisBinarySource = "env" | "config" | "path"` at `src/inspiredesign/media-analysis/types.ts:37`
- Adding `"common_path"` would be more transparent in `status-capabilities` output, showing the user that the binary was found via fallback rather than normal PATH
- However, it adds a new type variant that all consumers must handle
- **Recommended:** Reuse `"path"` source but add a `resolvedPath` field that differs from `requestedPath`. The `BinaryStatus` type already has `resolvedPath?: string` at `types.ts:49`. When fallback finds `/usr/local/bin/ffmpeg`, set `requestedPath: "ffmpeg"` and `resolvedPath: "/usr/local/bin/ffmpeg"`. This is transparent, minimal, and uses existing fields.

**ENOENT detection for fallback triggering:**
- `formatProbeError()` at `binaries.ts:239-241` maps ENOENT to `"binary was not found."`
- The fallback needs to be triggered BEFORE `formatProbeError` converts the error to a limitation string
- **Recommended:** Move fallback logic into `resolveBinaryStatus()`. When source is `"path"` and `probeBinaryVersion` returns a limitation containing ENOENT, try common absolute paths before returning `unavailableStatus`.

**Common paths to probe (macOS):**
- `/opt/homebrew/bin/ffmpeg` (Apple Silicon Homebrew)
- `/usr/local/bin/ffmpeg` (Intel Homebrew / manual install)
- `/usr/bin/ffmpeg` (system, rare but possible)

**Common paths to probe (Linux):**
- `/usr/bin/ffmpeg`
- `/usr/local/bin/ffmpeg`

**Common paths to probe (Windows):**
- `C:\ProgramData\chocolatey\bin\ffmpeg.exe`
- Skip for now; Windows scheduled task PATH inheritance is more reliable

### Pin-Media Readiness Authority Preservation

**Location:** `src/providers/workflows.ts:6400-6430`

The workflow correctly separates binary resolution from pin-media readiness:
- Binary resolution happens at line 6413-6414 only when `mediaAnalysisInputs.length > 0`
- Unavailable binaries produce limitations that flow into `media-analysis.json` as limitation strings
- Pin-media readiness (`pin-media-index.json`) is never affected by FFmpeg/FFprobe availability
- `media-analysis.json` cannot satisfy product readiness per the contract

**Impact of fix:** The fix improves `media-analysis.json` richness (metadata, palette, tone, sampled motion facts) but does not change readiness authority. This is the correct behavior.

## Investigation Log

### Phase 1 - Initial Assessment
**Hypothesis:** LaunchAgent plist has no EnvironmentVariables.PATH, and binary resolver has no absolute-path fallback
**Findings:** Confirmed via source code inspection
**Evidence:** `src/cli/daemon-autostart.ts:197-233`, `src/inspiredesign/media-analysis/binaries.ts:46-113`
**Conclusion:** Confirmed

### Phase 2 - External Research
**Hypothesis:** Other projects have solved this same macOS launchd PATH problem
**Findings:** thimslugga gist provides a script to propagate shell PATH to GUI apps via LaunchAgent plist. Stack Harbor confirms EnvironmentVariables is standard plist practice.
**Evidence:** https://gist.github.com/thimslugga/f38f3d39bd254c1321165e1f41922f41, https://stackharbor.com/en/knowledge-base/openclaw-as-launchd-service
**Conclusion:** Confirmed - this is a well-known macOS issue with established fix patterns

### Phase 3 - Daemon Reconciliation Analysis
**Hypothesis:** Adding EnvironmentVariables.PATH will not break existing reconciliation logic
**Findings:** `readMacLaunchAgentProgramArguments()` only reads `ProgramArguments` and `WorkingDirectory`. Adding `EnvironmentVariables` to plist is transparent to reconciliation.
**Evidence:** `src/cli/daemon-autostart.ts:362-376`
**Conclusion:** Confirmed - no reconciliation breakage

### Phase 4 - Windows Task Analysis
**Hypothesis:** Windows has a similar PATH discovery gap
**Findings:** Windows `schtasks /ONLOGON` inherits user logon PATH, which typically includes package manager paths. Less severe than macOS.
**Evidence:** `src/cli/daemon-autostart.ts:236-254`
**Conclusion:** Lower priority. Resolver-level fallback provides safety net for both platforms.

### Phase 5 - Test Impact Audit
**Hypothesis:** Existing tests do not cover EnvironmentVariables or absolute-path fallback
**Findings:** No test asserts EnvironmentVariables in plist. No test covers resolver absolute-path fallback. The `missingPath` test at line 190 expects failure with no fallback.
**Evidence:** `tests/daemon-autostart.test.ts:249-256`, `tests/inspiredesign-media-analysis.test.ts:183-267`
**Conclusion:** New tests needed. One existing test may need adjustment depending on fallback implementation.

### Phase 6 - Resolver Fallback Design
**Hypothesis:** The fallback can be implemented minimally using existing types
**Findings:** `BinaryStatus` already has `resolvedPath?: string` field. Reusing `"path"` source with different `resolvedPath` vs `requestedPath` is transparent and minimal.
**Evidence:** `src/inspiredesign/media-analysis/types.ts:37,49`
**Conclusion:** Minimal implementation possible without new type variants

### Phase 7 - Runtime Verification
**Hypothesis:** Current branch fails with stripped PATH, passes with Homebrew PATH
**Findings:** Isolated daemon with `PATH="/usr/bin:/bin:/usr/sbin:/sbin"` reports both binaries unavailable. Same daemon with `PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"` reports both available at version 7.1.1.
**Evidence:** `.opendevbrowser/ffmpeg-daemon-investigation/current-branch-empty-path/status-capabilities.json`, `.opendevbrowser/ffmpeg-daemon-investigation/current-branch-homebrew-path/status-capabilities.json`
**Conclusion:** Confirmed - PATH is the determining factor

## Root Cause
Two independent defects combine to cause the failure:

1. **LaunchAgent plist omits PATH** (`src/cli/daemon-autostart.ts:197`): `buildLaunchAgentPlist()` does not include an `EnvironmentVariables` dictionary. macOS LaunchAgents inherit a minimal PATH (`/usr/bin:/bin:/usr/sbin:/sbin`) that excludes `/opt/homebrew/bin` and `/usr/local/bin` where FFmpeg/FFprobe are typically installed. This is a well-known macOS launchd behavior confirmed by external sources.

2. **Binary resolver has no absolute-path fallback** (`src/inspiredesign/media-analysis/binaries.ts:46`): `selectRequestedBinary()` returns bare `"ffmpeg"` / `"ffprobe"` when source is `"path"`. When the daemon's PATH doesn't include the tool's directory, `spawn("ffmpeg", ["-version"])` throws ENOENT. There is no fallback to probe common absolute paths.

## Recommendations
1. **Add `EnvironmentVariables.PATH` to the LaunchAgent plist** in `src/cli/daemon-autostart.ts` `buildLaunchAgentPlist()`: include `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`. This ensures the daemon inherits a PATH that covers Homebrew and standard macOS tool locations. This is the primary fix.

2. **Add absolute-path fallback to the binary resolver** in `src/inspiredesign/media-analysis/binaries.ts`: when PATH-source probing fails with ENOENT, try `/opt/homebrew/bin/ffmpeg`, `/usr/local/bin/ffmpeg`, `/usr/bin/ffmpeg`, and matching ffprobe paths before declaring unavailable. Only fall back for implicit PATH misses (source is `"path"`), not when the user explicitly set env/config paths. Use existing `resolvedPath` field to record the discovered absolute path while keeping `requestedPath` as the bare name. This is the defense-in-depth fix.

3. **Keep FFmpeg optional and non-fatal**: do not bundle static FFmpeg. Missing binaries should degrade `media-analysis.json` only and not fail pin-media readiness.

4. **Do not add reconciliation check for EnvironmentVariables**: existing plists without PATH should not be flagged for repair. The PATH will be added on next `daemon install` or package postinstall. This avoids unnecessary repair triggers for a non-critical optional tool.

5. **Add tests**: LaunchAgent PATH generation test in the daemon-autostart test suite; stripped-PATH resolver fallback test in the media-analysis binaries test suite; no-fallback-for-explicit-paths test in the media-analysis binaries test suite.

6. **Update docs**: `docs/CLI.md`, `docs/TROUBLESHOOTING.md`, and `docs/SURFACE_REFERENCE.md` should mention that the daemon autostart includes a safe default PATH for host tool discovery.

## Preventive Measures
- Any future host tool that LaunchAgent daemon needs should be discoverable either through the plist PATH or through absolute-path fallback probing.
- The binary resolver should log which source and path it ultimately resolved, so daemon environment issues are diagnosable through `status-capabilities`.
- Consider adding a `status-capabilities` diagnostic note when binaries are found via common-path fallback, so users understand their daemon PATH is incomplete.

## Eliminated Hypotheses
- **Dev-vs-installed daemon mismatch is the root cause**: ELIMINATED. While v0.0.36 daemon predates `host.mediaAnalysis`, the current branch ALSO fails with stripped PATH. The mismatch is a secondary issue.
- **Config schema is missing mediaAnalysis**: ELIMINATED. `src/config.ts:623` defines the schema with optional `ffmpegPath`/`ffprobePath`.
- **Coordinator wiring is wrong**: ELIMINATED. `src/automation/coordinator.ts:409` correctly calls the resolver with config and inherits process.env.
- **Windows Task has the same severity PATH gap**: ELIMINATED. Windows scheduled tasks inherit user logon PATH. Lower severity than macOS launchd.
- **Adding EnvironmentVariables will break reconciliation**: ELIMINATED. Reconciliation only reads ProgramArguments and WorkingDirectory.
