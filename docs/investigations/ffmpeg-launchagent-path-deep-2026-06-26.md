# Investigation: FFmpeg/FFprobe LaunchAgent PATH - Deep Follow-Up

## Summary
Multi-agent deep investigation building on the 2026-06-23 root-cause report. Validates the recommended fix path against current source, probes additional defects, edge cases, security implications, and downstream consumer impact. RepoPrompt sub-agents (builder + 3 pair investigators) failed with 503 auth errors; investigation completed through direct source analysis of all 11 key files plus downstream consumers.

## Symptoms
- macOS LaunchAgent daemon starts with minimal PATH, missing /opt/homebrew/bin and /usr/local/bin
- Binary resolver has no absolute-path fallback for PATH-source lookups
- status-capabilities does not report host.mediaAnalysis when daemon runs under stripped PATH
- Pinterest harvest media-analysis.json shows "ffmpeg binary was not found." limitations

## Background / Prior Research
- 2026-06-23 investigation: docs/investigations/ffmpeg-launchagent-path-detection-2026-06-23.md
- 2026-06-25 verification pass: all source claims re-confirmed against current code
- Two root causes confirmed: (1) buildLaunchAgentPlist() omits EnvironmentVariables.PATH, (2) selectRequestedBinary() has no absolute-path fallback
- External sources confirm this is a well-known macOS launchd PATH inheritance problem
- RepoPrompt context builder and 3 pair investigators (LaunchAgent PATH injection safety, Resolver absolute-path fallback design, Test coverage and edge cases) all failed with 503 auth_unavailable errors

## Investigator Findings

### 1. LaunchAgent PATH Injection Safety Analysis

**buildLaunchAgentPlist()** at `src/cli/daemon-autostart.ts:197-233`

The plist is built as a plain XML string array joined with newlines. Adding `EnvironmentVariables` requires inserting a new `<key>EnvironmentVariables</key>` block with a nested `<dict>` containing `<key>PATH</key>` and `<string>...</string>`.

**Safety findings:**
- `escapePlistString()` at line 197 handles `&`, `<`, `>`, `"`, `'` - PATH values containing colons (`:`) do NOT need escaping. Colons are valid XML characters. The PATH value `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin` will serialize correctly.
- `readMacLaunchAgentProgramArguments()` at line 363-392 only reads `ProgramArguments` and `WorkingDirectory` from the plist via `plutil -convert json`. Adding `EnvironmentVariables` to the plist is completely transparent to reconciliation - it will not be read or checked, so existing plists without it will still report `healthy`.
- `classifyMacAutostartStatus()` does not check `EnvironmentVariables` at any point, so adding it will not trigger false repair.
- `installMacAutostart()` at line 521-555 always overwrites the plist on install via `writeFileSync`, so the PATH will be added on next `daemon install` or package postinstall.

**Design recommendation:**
- Add a named constant for the default PATH: `const MAC_LAUNCH_AGENT_DEFAULT_PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";`
- Insert the `EnvironmentVariables` block after `StandardErrorPath` and before `</dict>` in the plist array.
- The PATH should be hardcoded as a named constant, not configurable. Config-driven PATH would add complexity for marginal benefit - the goal is covering standard macOS tool locations.

**No other EnvironmentVariables needed:** The daemon already sets `WorkingDirectory` to `~/.cache/opendevbrowser`. macOS launchd inherits `HOME` and `USER` for user-level LaunchAgents (gui/uid). `TMPDIR` is also inherited. Only `PATH` is stripped.

### 2. Resolver Absolute-Path Fallback Design Analysis

**resolveBinaryStatus()** at `src/inspiredesign/media-analysis/binaries.ts:68-90`

Current flow:
1. `selectRequestedBinary()` determines source (env/config/path) and requestedPath
2. If blank, return unavailable with blank limitation
3. `probeBinaryVersion()` spawns the binary with `-version`
4. If probe returns limitation, return unavailable
5. If probe returns version, return available with `resolvedPath = requestedPath`

**ENOENT detection gap:** `probeBinaryVersion()` catches errors at line 161 and calls `formatProbeError()` at line 239-241, which checks `error.code === "ENOENT"` and returns `"${tool} binary was not found."`. By the time this string reaches `resolveBinaryStatus()`, the ENOENT signal is lost - it's been converted to a limitation string. The fallback needs to intercept BEFORE `formatProbeError` converts it.

**Recommended fallback architecture:**

Option A: Move fallback into `resolveBinaryStatus()` - after `probeBinaryVersion` returns a limitation, check if source was `"path"` and the limitation contains "binary was not found", then try common absolute paths.

Option B: Refactor `probeBinaryVersion` to return a discriminated union that preserves the ENOENT signal, then handle fallback in `resolveBinaryStatus`.

**Option B is cleaner** because string matching on limitation text is fragile. Recommended:

```typescript
type ProbeResult =
  | { version: string }
  | { limitation: string; enoent?: boolean };
```

Then in `resolveBinaryStatus()`:
```typescript
if ("limitation" in probe) {
  if (selected.source === "path" && probe.enoent) {
    const fallback = await tryCommonPathFallback(request, env, timeoutMs);
    if (fallback) return fallback;
  }
  return unavailableStatus(request, selected, probe.limitation);
}
```

**Common paths to probe (platform-aware):**
- macOS: `/opt/homebrew/bin/ffmpeg`, `/usr/local/bin/ffmpeg`, `/usr/bin/ffmpeg`
- Linux: `/usr/bin/ffmpeg`, `/usr/local/bin/ffmpeg`
- Matching ffprobe paths at each location

**Fallback spawn env:** The current code passes `env` to `spawn()`. When the daemon has a stripped PATH, `spawn("/usr/local/bin/ffmpeg", ["-version"], { env })` will still work because the binary path is absolute - `spawn` does not need PATH to find an absolute path. The env is only used for the child process's own environment, not for binary lookup. So no env modification is needed.

**resolvedPath field:** When fallback succeeds, set `requestedPath` to the bare name (`"ffmpeg"`) and `resolvedPath` to the absolute path (`"/usr/local/bin/ffmpeg"`). The existing `BinaryStatus` type at `types.ts:49` already has `resolvedPath?: string`. The `source` stays `"path"` - no new type variant needed.

**Downstream consumer impact:** `src/providers/workflows.ts:3904-3905` passes `binaries.ffmpeg.resolvedPath` to the analyzer as `ffmpegBinaryPath`. The analyzer at `src/inspiredesign/media-analysis/analyzer.ts:95` passes it to `runInspiredesignFfprobe` as `options.binaryPath`. The ffprobe runner at `src/inspiredesign/media-analysis/ffprobe.ts:27` uses `options.binaryPath ?? DEFAULT_FFPROBE_BINARY`. So if `resolvedPath` is the absolute path, the analyzer will use it directly. This is correct behavior - the analyzer gets the discovered absolute path.

**Partial availability:** `resolveHostCapabilityTier()` at line 120-127 already handles partial availability: `metadata_only` if only ffprobe is available, `frame_decode_only` if only ffmpeg is available. The fallback is per-binary, so if ffmpeg is found at `/usr/local/bin/ffmpeg` but ffprobe is not, the tier correctly becomes `frame_decode_only`.

**existsSync before spawn:** Not necessary. `spawn` with an absolute path will fail with ENOENT if the file doesn't exist, which is caught by the same error handler. Adding `existsSync` would add a race condition (file could be deleted between check and spawn) and extra I/O for no benefit.

**Code complexity check:** Adding fallback logic to `resolveBinaryStatus()` would push it beyond the 30 logical line / 4 decision statement limit in AGENTS.md. The fallback should be extracted into a separate function `tryCommonPathFallback()` that returns `InspiredesignMediaAnalysisBinaryStatus | null`. This keeps `resolveBinaryStatus()` under limits and makes the fallback testable in isolation.

### 3. Test Coverage and Edge Case Analysis

**tests/daemon-autostart.test.ts:249-256** - "builds a launch agent plist with program arguments"
- Asserts plist contains `com.test.daemon`, `/node`, `/cli/index.js`, `serve`, `<key>WorkingDirectory</key>`
- Will NOT break when `EnvironmentVariables` is added - the test uses `toContain` assertions, not equality
- Should be extended with: `expect(plist).toContain("<key>EnvironmentVariables</key>")` and `expect(plist).toContain("<key>PATH</key>")` and `expect(plist).toContain("/opt/homebrew/bin")` and `expect(plist).toContain("/usr/local/bin")`

**tests/daemon-autostart.test.ts:258-276** - "escapes launch agent plist string values"
- Tests XML escaping of special characters in label, paths
- Will NOT break - EnvironmentVariables values would also be escaped but this test doesn't assert on EnvironmentVariables
- No changes needed, but could optionally add a PATH escaping assertion

**tests/inspiredesign-media-analysis.test.ts:190-230** - "reports missing PATH and explicit override failures as non-fatal limitations"
- The `missingPath` sub-case at line 198 uses `env: { PATH: emptyPathDir }` and expects `available: false` with `limitation: "ffmpeg binary was not found."`
- **This test WILL break if absolute-path fallback is added** - if a real ffmpeg exists at `/usr/local/bin/ffmpeg` or `/opt/homebrew/bin/ffmpeg` on the CI machine, the fallback will find it and report `available: true`
- **Fix:** The test must mock `existsSync` or use a custom spawn wrapper that prevents real binary discovery. Alternatively, the fallback function could accept an injectable list of common paths, and the test passes an empty list. The cleanest approach is to make the common paths injectable via the resolver options:
  ```typescript
  type InspiredesignMediaAnalysisBinaryResolverOptions = {
    config?: ...;
    env?: ...;
    timeoutMs?: number;
    commonPaths?: string[]; // injectable for testing
  };
  ```
  The test would pass `commonPaths: []` to disable fallback. Production code would use the default platform-aware list.

**tests/inspiredesign-media-analysis.test.ts:232-267** - "reports version probe edge cases"
- Uses fake Node binaries with explicit config paths, not PATH-source resolution
- Will NOT be affected by fallback (fallback only triggers for `source: "path"`)
- No changes needed

**tests/automation-coordinator-operator-surfaces.test.ts** - Uses injected `resolveMediaAnalysisBinaries` mock, not the real resolver
- Will NOT be affected by fallback changes
- No changes needed

**New tests needed:**
1. "includes EnvironmentVariables.PATH with Homebrew and system paths in the plist" - assert PATH content
2. "resolver falls back to absolute paths when PATH-source bare name fails with ENOENT" - use injectable commonPaths with a fake binary
3. "resolver does NOT fall back when env/config paths are set but fail" - verify source is "env" or "config" and no fallback attempted
4. "resolver does NOT fall back when commonPaths is empty" - verify fallback is skipped

**Windows test coverage:** `buildWindowsTaskArgs` test at line 285-293 does not need changes. Windows scheduled tasks inherit user logon PATH. No Windows-specific fallback paths are needed for this fix.

### 4. Downstream Consumer Flow Verification

**Full binary resolution to analyzer pipeline:**

1. `coordinator.ts:416-417` - `statusCapabilities()` calls `resolveInspiredesignMediaAnalysisBinaries({ config: args.mediaAnalysisConfig })` or the injected mock
2. `workflows.ts:3918-3921` - `resolveInspiredesignMediaAnalyzerBinaryOptions()` calls the resolver with config and timeoutMs
3. `workflows.ts:3904-3905` - `buildInspiredesignMediaAnalyzerBinaryOptions()` extracts `resolvedPath` from each binary status and passes as `ffmpegBinaryPath`/`ffprobeBinaryPath`
4. `analyzer.ts:90-109` - If `ffprobeUnavailableLimitation` is set, returns early with limitation; otherwise calls `runInspiredesignFfprobe` with `binaryPath`
5. `ffprobe.ts:27` - Uses `options.binaryPath ?? DEFAULT_FFPROBE_BINARY` (bare "ffprobe")
6. `ffmpeg.ts` - Same pattern: `options.binaryPath ?? DEFAULT_FFMPEG_BINARY` (bare "ffmpeg")

**Key finding:** When the resolver finds a binary via PATH (current behavior), `resolvedPath = requestedPath = "ffmpeg"` (bare name). This bare name flows to `ffprobe.ts` and `ffmpeg.ts` as `binaryPath`, which then spawns `"ffmpeg"` - relying on PATH again. So even if `status-capabilities` finds ffmpeg via PATH, the actual media analysis spawn also relies on PATH. **If the daemon PATH is stripped, both the probe AND the actual analysis will fail.**

**Impact of absolute-path fallback fix:** When fallback finds `/usr/local/bin/ffmpeg`, `resolvedPath` becomes `/usr/local/bin/ffmpeg`. This absolute path flows through to `ffprobe.ts` and `ffmpeg.ts`, so the actual analysis spawn uses the absolute path directly. **The fallback fix solves both the probe and the analysis path** because `resolvedPath` is propagated downstream.

**Impact of LaunchAgent PATH fix:** The plist PATH fix ensures the daemon process itself has a correct PATH, so bare-name spawns in `ffprobe.ts` and `ffmpeg.ts` also work. **Both fixes are complementary and both are needed for full coverage.**

### 5. Security Analysis

**PATH injection risk:** The hardcoded PATH constant `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin` only includes standard system and Homebrew paths. A malicious user would need write access to `/opt/homebrew/bin` or `/usr/local/bin`, which already implies system-level compromise. No security regression.

**Absolute-path fallback risk:** Probing `/opt/homebrew/bin/ffmpeg` and `/usr/local/bin/ffmpeg` could theoretically find a malicious binary placed at those paths. However, this is the same trust level as PATH-based discovery - if an attacker can write to `/usr/local/bin`, they can also add it to the user's PATH. The fallback does not expand the attack surface.

**Explicit path override preservation:** The fallback only triggers when `source === "path"` (no env or config override). If a user explicitly sets `OPENDEVBROWSER_FFMPEG_PATH` to a nonexistent path, the resolver correctly returns unavailable without fallback. This preserves the principle that explicit bad config should stay diagnostic.

## Investigation Log

### Phase 0 - Workspace Verification
**Hypothesis:** Target codebase is loaded in RepoPrompt
**Findings:** Window 1 confirmed with workspace opendevbrowser
**Evidence:** `rpce-cli -e 'windows'` output
**Conclusion:** Confirmed

### Phase 1 - Initial Assessment
**Hypothesis:** Prior investigation identified two root causes; deep investigation should validate fix path and surface additional issues
**Findings:** Read CONTINUITY.md, existing report, all source seams
**Evidence:** CONTINUITY.md entries from 2026-06-23 and 2026-06-25, docs/investigations/ffmpeg-launchagent-path-detection-2026-06-23.md
**Conclusion:** Prior investigation is thorough; deep investigation focuses on fix-path validation, downstream impact, and edge cases

### Phase 2 - Context Builder (FAILED)
**Hypothesis:** Builder would populate file selection
**Findings:** Builder failed twice with 503 auth_unavailable
**Evidence:** "unexpected status 503 Service Unavailable: auth_unavailable: no auth available (providers=codex, model=gpt-5.5)"
**Conclusion:** Fell back to manual selection curation via `select add`

### Phase 3 - Pair Investigators (FAILED)
**Hypothesis:** Three pair investigators would provide parallel deep analysis
**Findings:** All three failed with agent_error (same 503 auth issue)
**Evidence:** Session IDs 759B0B63, D8725459, D53F5666 all reported Status: Failed, Failure reason: agent_error
**Conclusion:** Completed investigation through direct source analysis of all 11 key files plus downstream consumers (analyzer.ts, ffprobe.ts, ffmpeg.ts)

### Phase 4 - Direct Source Analysis
**Hypothesis:** Manual analysis can validate the fix path and surface additional issues
**Findings:** Five analysis areas completed: PATH injection safety, resolver fallback design, test coverage, downstream consumer flow, security analysis
**Evidence:** See Investigator Findings sections above with file:line references
**Conclusion:** Fix path validated; additional finding that resolvedPath propagates downstream so both fixes are complementary

## Root Cause

Two independent defects combine to cause the failure, confirmed by deep analysis:

1. **LaunchAgent plist omits PATH** (`src/cli/daemon-autostart.ts:197`): `buildLaunchAgentPlist()` does not include an `EnvironmentVariables` dictionary. macOS LaunchAgents inherit a minimal PATH (`/usr/bin:/bin:/usr/sbin:/sbin`) that excludes `/opt/homebrew/bin` and `/usr/local/bin` where FFmpeg/FFprobe are typically installed. This is a well-known macOS launchd behavior confirmed by external sources.

2. **Binary resolver has no absolute-path fallback** (`src/inspiredesign/media-analysis/binaries.ts:46`): `selectRequestedBinary()` returns bare `"ffmpeg"` / `"ffprobe"` when source is `"path"`. When the daemon's PATH doesn't include the tool's directory, `spawn("ffmpeg", ["-version"])` throws ENOENT. There is no fallback to probe common absolute paths. The ENOENT signal is lost when `formatProbeError()` converts it to a limitation string at line 239-241.

**Additional finding from deep analysis:** The `resolvedPath` field propagates downstream to the actual media analysis spawns in `ffprobe.ts:27` and `ffmpeg.ts`. When the resolver returns a bare name (`"ffmpeg"`), the analyzer also spawns with the bare name, so a stripped PATH breaks both the probe AND the actual analysis. Both fixes are complementary and both are needed for full coverage.

## Recommendations

1. **Add `EnvironmentVariables.PATH` to the LaunchAgent plist** in `src/cli/daemon-autostart.ts` `buildLaunchAgentPlist()`: insert a named constant `MAC_LAUNCH_AGENT_DEFAULT_PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"` and add an `<key>EnvironmentVariables</key>` block with nested `<dict>` containing `<key>PATH</key>` and the constant value. Use `escapePlistString()` on the PATH value for consistency. This is the primary fix.

2. **Add absolute-path fallback to the binary resolver** in `src/inspiredesign/media-analysis/binaries.ts`: refactor `ProbeResult` to preserve the ENOENT signal as `{ limitation: string; enoent?: boolean }`. Extract a new `tryCommonPathFallback()` function that probes platform-aware common paths when source is `"path"` and ENOENT is detected. Set `resolvedPath` to the discovered absolute path while keeping `requestedPath` as the bare name. Do not fall back for env/config source. Make common paths injectable via resolver options for test hermeticity (`commonPaths?: string[]`).

3. **Keep FFmpeg optional and non-fatal**: do not bundle static FFmpeg. Missing binaries should degrade `media-analysis.json` only and not fail pin-media readiness.

4. **Do not add reconciliation check for EnvironmentVariables**: existing plists without PATH should not be flagged for repair. The PATH will be added on next `daemon install` or package postinstall.

5. **Add tests**:
   - Plist PATH assertion in `tests/daemon-autostart.test.ts` (extend existing "builds a launch agent plist" test)
   - Stripped-PATH resolver fallback test in `tests/inspiredesign-media-analysis.test.ts` using injectable `commonPaths`
   - No-fallback-for-explicit-paths test (verify env/config failures stay unavailable)
   - No-fallback-when-commonPaths-empty test (verify fallback is skipped)

6. **Update docs**: `docs/CLI.md`, `docs/TROUBLESHOOTING.md`, and `docs/SURFACE_REFERENCE.md` should mention that the daemon autostart includes a safe default PATH for host tool discovery.

## Preventive Measures
- Any future host tool that the LaunchAgent daemon needs should be discoverable either through the plist PATH or through absolute-path fallback probing.
- The binary resolver should preserve structured error signals (like ENOENT) rather than converting them to strings too early, so fallback logic can make decisions based on error type.
- The `resolvedPath` field should always be set to the actual path used for spawning, not just the requested path, so downstream consumers get the correct binary location.
- Consider adding a `status-capabilities` diagnostic note when binaries are found via common-path fallback, so users understand their daemon PATH is incomplete.
- The common-paths list should be reviewed when adding support for new platforms or package managers.

## Eliminated Hypotheses
- **Dev-vs-installed daemon mismatch is the root cause**: ELIMINATED. While v0.0.36 daemon predates `host.mediaAnalysis`, the current branch ALSO fails with stripped PATH.
- **Config schema is missing mediaAnalysis**: ELIMINATED. `src/config.ts:623-625` defines the schema with optional `ffmpegPath`/`ffprobePath`.
- **Coordinator wiring is wrong**: ELIMINATED. `src/automation/coordinator.ts:416-417` correctly calls the resolver with config.
- **Windows Task has the same severity PATH gap**: ELIMINATED. Windows scheduled tasks inherit user logon PATH.
- **Adding EnvironmentVariables will break reconciliation**: ELIMINATED. Reconciliation only reads ProgramArguments and WorkingDirectory.
- **existsSync is needed before fallback spawn**: ELIMINATED. spawn with absolute path fails with ENOENT if missing, caught by same handler. existsSync adds a race condition.
- **A new BinarySource type is needed for fallback**: ELIMINATED. Existing `resolvedPath` field on `BinaryStatus` is sufficient. Source stays `"path"`.
- **Fallback env needs PATH modification**: ELIMINATED. spawn with absolute path does not use PATH for binary lookup.

### 6. Test Coverage Gap and Edge Case Investigation

**Scope:** All 10 focus areas investigated against current source and test files. File:line references verified by direct reads.

---

#### Focus 1: daemon-autostart.test.ts plist content assertions

**File:** `tests/daemon-autostart.test.ts`

Two tests assert on plist content:

1. **"builds a launch agent plist with program arguments"** (line 249-261)
   - Asserts: `toContain("com.test.daemon")`, `toContain("/node")`, `toContain("/cli/index.js")`, `toContain("serve")`, `toContain("<key>WorkingDirectory</key>")`
   - **Will NOT break** when `EnvironmentVariables` is added: all assertions use `toContain`, not equality. New XML keys are additive.
   - **Needs extension:** Add assertions for `"<key>EnvironmentVariables</key>"`, `"<key>PATH</key>"`, and the default PATH constant value (e.g. `/opt/homebrew/bin`).

2. **"escapes launch agent plist string values"** (line 263-280)
   - Asserts XML escaping of special chars in label, nodePath, cliPath, workingDirectory, stderrPath.
   - **Will NOT break:** Does not assert on EnvironmentVariables. No changes needed.
   - **Optional:** Could add a PATH escaping assertion, but the default PATH contains only colons and slashes which need no escaping.

3. **"creates the macOS LaunchAgents and Logs directories before bootstrap"** (line 446-481)
   - Asserts `writeFileSyncMock` is called with `expect.stringContaining("<key>WorkingDirectory</key>")` at line 468.
   - **Will NOT break:** `stringContaining` is additive. The plist will still contain `WorkingDirectory`.

4. **"fails before writing a macOS LaunchAgent when the current CLI path is transient"** (line 483-498)
   - Asserts `writeFileSyncMock` not called. **Will NOT break.**

**Conclusion:** Zero tests will break. One test (line 249) needs new assertions to cover the PATH addition.

---

#### Focus 2: inspiredesign-media-analysis.test.ts missingPath test (line 198)

**File:** `tests/inspiredesign-media-analysis.test.ts:190-230` - "reports missing PATH and explicit override failures as non-fatal limitations"

The `missingPath` sub-case at line 198-207:
```typescript
const missingPath = await resolveInspiredesignMediaAnalysisBinaries({
  env: { PATH: emptyPathDir },
  timeoutMs: 100
});
```
Expects `available: false`, `source: "path"`, `requestedPath: "ffmpeg"`, `limitation: "ffmpeg binary was not found."`

**Will break when absolute-path fallback is added:** If a real ffmpeg exists at `/opt/homebrew/bin/ffmpeg` or `/usr/local/bin/ffmpeg` on the CI/dev machine, the fallback will find it and return `available: true` instead of `available: false`. The test is no longer hermetic.

**Adaptation strategy (recommended):** Make `commonPaths` injectable via `InspiredesignMediaAnalysisBinaryResolverOptions`. The test passes `commonPaths: []` to disable fallback, preserving hermeticity:
```typescript
const missingPath = await resolveInspiredesignMediaAnalysisBinaries({
  env: { PATH: emptyPathDir },
  timeoutMs: 100,
  commonPaths: []  // disable absolute-path fallback for hermetic test
});
```
This is the cleanest approach because it tests the actual resolver code path (source="path", ENOENT) without mocking spawn or existsSync. The fallback is simply skipped because the candidate list is empty.

**Alternative (not recommended):** Mock `spawn` to intercept absolute-path lookups. This is fragile and couples the test to implementation details.

---

#### Focus 3: automation-coordinator-operator-surfaces.test.ts statusCapabilities tests

**File:** `tests/automation-coordinator-operator-surfaces.test.ts`

The `statusCapabilities` tests use an **injected mock** `resolveMediaAnalysisBinaries`, not the real resolver:
- Line 59-77: `mediaAnalysisCapabilities` is a hardcoded `InspiredesignMediaAnalysisBinaryResolution` object.
- Line 170: `resolveMediaAnalysisBinaries: async () => mediaAnalysisCapabilities`
- Lines 267, 298, 332, 376: All subsequent statusCapabilities tests also inject the same mock.

**Will NOT be affected by fallback changes.** The mock bypasses `resolveInspiredesignMediaAnalysisBinaries` entirely. No changes needed.

---

#### Focus 4: Integration tests that spawn real ffmpeg/ffprobe

**Finding:** No test in the repo spawns real ffmpeg or ffprobe binaries.

All spawn-based tests in `tests/inspiredesign-media-analysis.test.ts` use `makeFakeNodeBinary()` (line 62-68) which creates a temp Node.js script that mimics ffmpeg/ffprobe output. The pattern:
```typescript
const fakeBinary = await makeFakeNodeBinary("process.stdout.write('ffmpeg version config-1\\n');");
```
These fake binaries are passed via `config.ffmpegPath` / `config.ffprobePath` (source="config") or `OPENDEVBROWSER_FFMPEG_PATH_ENV` (source="env"), never relying on PATH-source resolution with real binaries.

The only test that uses PATH-source resolution is the `missingPath` test (line 198) which deliberately sets `PATH` to an empty dir to trigger ENOENT.

The "uses PATH FFmpeg and FFprobe defaults when adapter binary paths are omitted" test (line ~730) creates fake binaries in a temp dir and prepends that dir to `process.env.PATH`, then calls `runInspiredesignFfprobe` / `extractInspiredesignFfmpegFrames` directly (not the resolver). **This test will NOT be affected** by the resolver fallback change because it does not call `resolveInspiredesignMediaAnalysisBinaries`.

**Conclusion:** The fallback change will NOT affect any integration test behavior because no test spawns real ffmpeg/ffprobe, and the only PATH-source resolver test deliberately uses an empty PATH.

---

#### Focus 5: New tests needed

**5.1 Plist PATH assertion** (in `tests/daemon-autostart.test.ts`)
- Extend the "builds a launch agent plist with program arguments" test (line 249) with:
  ```typescript
  expect(plist).toContain("<key>EnvironmentVariables</key>");
  expect(plist).toContain("<key>PATH</key>");
  expect(plist).toContain("/opt/homebrew/bin");
  expect(plist).toContain("/usr/local/bin");
  ```
- Acceptance: Test verifies the plist includes the default PATH with Homebrew and system paths.

**5.2 Fallback success** (in `tests/inspiredesign-media-analysis.test.ts`)
- Create a fake ffmpeg binary at a temp path, pass that path via `commonPaths`, set `env.PATH` to an empty dir so bare-name lookup fails with ENOENT, verify the resolver finds the binary via fallback and returns `available: true` with `resolvedPath` set to the absolute path.
- Acceptance: `available: true`, `source: "path"`, `requestedPath: "ffmpeg"`, `resolvedPath` is the absolute temp path, `version` is set.

**5.3 Fallback failure** (in `tests/inspiredesign-media-analysis.test.ts`)
- Set `env.PATH` to empty dir, pass `commonPaths` with nonexistent paths, verify resolver returns `available: false` with `limitation: "ffmpeg binary was not found."`
- Acceptance: `available: false`, `source: "path"`, `limitation` matches ENOENT message.

**5.4 No fallback for explicit paths** (in `tests/inspiredesign-media-analysis.test.ts`)
- Set `OPENDEVBROWSER_FFMPEG_PATH_ENV` to a nonexistent path, pass non-empty `commonPaths`, verify resolver returns `available: false` with `source: "env"` and does NOT attempt fallback.
- Acceptance: `source: "env"`, `available: false`, no fallback spawn attempted. The existing `explicitEnvFailure` test at line 209-215 already covers this scenario but should be extended to pass `commonPaths` and verify fallback was not attempted.

**5.5 No fallback when commonPaths is empty** (in `tests/inspiredesign-media-analysis.test.ts`)
- This is the adapted `missingPath` test (Focus 2 above). Pass `commonPaths: []`, verify fallback is skipped and ENOENT limitation is returned.
- Acceptance: `available: false`, `limitation: "ffmpeg binary was not found."`

**5.6 Partial availability with fallback** (in `tests/inspiredesign-media-analysis.test.ts`)
- Create a fake ffmpeg but not ffprobe. Pass ffmpeg's path in `commonPaths` and an empty ffprobe path. Verify `capabilityTier: "frame_decode_only"`.
- Acceptance: `ffmpeg.available: true`, `ffprobe.available: false`, `capabilityTier: "frame_decode_only"`.

---

#### Focus 6: Windows daemon autostart test coverage

**File:** `tests/daemon-autostart.test.ts`

Windows tests exist at lines 281-293 ("builds Windows task args"), 540-633 (status tests for Windows scheduled tasks). These test `buildWindowsTaskArgs` and `getAutostartStatus` for the Windows platform.

**Windows PATH gap:** `buildWindowsTaskArgs` at `src/cli/daemon-autostart.ts:236-251` creates a `schtasks /Create` command with `/SC ONLOGON`. Windows scheduled tasks with `ONLOGON` inherit the user's logon PATH from the user profile, unlike macOS launchd which strips PATH. No `EnvironmentVariables` equivalent is needed for Windows.

**Conclusion:** No Windows-specific test changes needed. The Windows code path does not need PATH injection. Existing Windows tests are sufficient.

---

#### Focus 7: Code complexity limits for resolveBinaryStatus with fallback

**File:** `src/inspiredesign/media-analysis/binaries.ts:78-99`

Current `resolveBinaryStatus` metrics:
- **Logical lines:** ~15 (lines 83-98, excluding braces/whitespace)
- **Decision statements:** 2 (`if` at line 85, `if` at line 90)
- **Parameters:** 3 (`request`, `env`, `timeoutMs`)
- **Nesting depth:** 1
- **Loops:** 0

If fallback logic is added inline:
```typescript
if ("limitation" in probe) {
  if (selected.source === "path" && probe.enoent) {
    const fallback = await tryCommonPathFallback(request, env, timeoutMs, commonPaths);
    if (fallback) return fallback;
  }
  return unavailableStatus(request, selected, probe.limitation);
}
```
- **Decision statements:** 4 (2 existing + 2 new) -- at the limit of 4
- **Logical lines:** ~19 -- under the 30 limit
- **Parameters:** 4 (adding `commonPaths`) -- at the limit of 4
- **Nesting depth:** 2 (if > if > if) -- at the limit of 2

**Verdict:** Adding fallback inline would hit the decision statement (4), parameter (4), and nesting depth (2) limits simultaneously. This is risky.

**Required refactoring:** Extract the fallback into a separate `tryCommonPathFallback()` function (as the report already recommends). This keeps `resolveBinaryStatus` at:
- 3 decision statements (2 existing + 1 new `if` for fallback attempt)
- 3 nesting levels max (but the nested `if` becomes a single call)
- 4 parameters (adding `commonPaths`)

Alternatively, to avoid the 4-parameter limit, pass `commonPaths` via the `BinaryRequest` type or via a closure. The cleanest approach is to make `commonPaths` a field on a new options object:
```typescript
type ResolveBinaryContext = {
  env: InspiredesignMediaAnalysisBinaryResolverEnv;
  timeoutMs: number;
  commonPaths: readonly string[];
};
```
This reduces `resolveBinaryStatus` to 2 parameters (`request`, `context`), well under limits.

**ProbeResult type change:** The `ProbeResult` type at line 32-33 must be extended to `{ limitation: string; enoent?: boolean }` to preserve the ENOENT signal. `formatProbeError` at line 239-241 already checks `error.code === "ENOENT"` -- it needs to also set `enoent: true` on the returned `ProbeResult`. This is a one-line change in `probeBinaryVersion` at line 168:
```typescript
return { limitation: formatProbeError(tool, error), enoent: error instanceof Error && "code" in error && error.code === "ENOENT" };
```

---

#### Focus 8: config.ts mediaAnalysis schema and validation tests

**File:** `src/config.ts:618-626`

The schema:
```typescript
const optionalPathSchema = z.string()
  .min(1)
  .refine((value) => value.trim().length > 0, { message: "Path must not be blank." });

const inspiredesignSchema = z.object({
  mediaAnalysis: z.object({
    ffmpegPath: optionalPathSchema.optional(),
    ffprobePath: optionalPathSchema.optional()
  }).default({})
}).default({});
```

**No schema changes needed for the fallback fix.** The fallback is a runtime resolver concern, not a config concern. `commonPaths` is an internal resolver option, not a user-facing config field.

**Config validation tests:** `tests/config.test.ts` has:
- Line 73: Default `mediaAnalysis` is `{}`
- Line 151-153: Parses valid `ffmpegPath`/`ffprobePath` overrides
- Line 210-212: Round-trips path overrides
- Line 512-521: Parses missing-path overrides without executable checks
- Line 529-532: Rejects blank and wrong-type paths

**None of these tests need updates.** The config schema is unchanged.

---

#### Focus 9: Docs/skill tests asserting on FFmpeg resolution wording

**File:** `tests/media-analysis-dependency-guidance.test.ts`

This test file asserts on FFmpeg/FFprobe resolution wording across 5 guidance sections (docs/CLI.md, docs/SURFACE_REFERENCE.md, docs/DEPENDENCIES.md, docs/TROUBLESHOOTING.md, skills/opendevbrowser-best-practices/SKILL.md) and 4 AGENTS sync sections.

**Key assertions that may need attention:**
- Line 139: `expect(content).toContain("inspiredesign.mediaAnalysis.ffmpegPath")` -- unchanged
- Line 140: `expect(content).toContain("inspiredesign.mediaAnalysis.ffprobePath")` -- unchanged
- Line 148: `expect(content).toContain("PATH")` -- this asserts docs mention PATH fallback. If docs are updated to mention absolute-path fallback, this assertion still passes (it only checks for the substring "PATH").
- Line 155: `expect(content).toContain("not bundled")` or `"does not bundle"` -- unchanged
- Line 156: `expect(content).toContain("not downloaded by default")` -- unchanged

**If docs are updated** to mention the absolute-path fallback (as recommended in the report's Recommendations section 6), the `expectDependencyContract` function at line 129-159 does NOT need changes because it does not assert on absolute-path fallback wording. However, if docs wording changes significantly, these tests will catch any removal of required terms.

**Conclusion:** No test changes needed unless docs wording removes existing required terms. If docs are updated to add absolute-path fallback mention, the tests will pass as-is because they use `toContain` (additive).

---

#### Focus 10: commonPaths injection pattern and caller impact

**File:** `src/inspiredesign/media-analysis/binaries.ts:18-21`

Current type:
```typescript
export type InspiredesignMediaAnalysisBinaryResolverOptions = {
  config?: InspiredesignMediaAnalysisBinaryPathsConfig;
  env?: InspiredesignMediaAnalysisBinaryResolverEnv;
  timeoutMs?: number;
};
```

**Adding `commonPaths?: readonly string[]`** is backward-compatible because it's optional. All existing callers pass without `commonPaths` and get the default platform-aware list.

**Caller inventory (3 production callers, all unaffected):**

1. `src/automation/coordinator.ts:417`:
   ```typescript
   resolveInspiredesignMediaAnalysisBinaries({ config: args.mediaAnalysisConfig })
   ```
   No change needed. Uses default commonPaths.

2. `src/providers/workflows.ts:3920`:
   ```typescript
   resolveInspiredesignMediaAnalysisBinaries({ config: options.mediaAnalysisConfig, timeoutMs: probeTimeoutMs })
   ```
   No change needed. Uses default commonPaths.

3. `src/providers/workflows.ts:3893` (injected mock override):
   ```typescript
   options.resolveMediaAnalysisBinaries({ timeoutMs: probeTimeoutMs })
   ```
   This is the mock injection path. No change needed.

**Test callers that need `commonPaths: []`:**
- `tests/inspiredesign-media-analysis.test.ts:198` -- `missingPath` test (Focus 2)
- Any new fallback test that needs to control the candidate list

**Type propagation:** The `commonPaths` option does not need to be added to `AutomationCoordinatorArgs` or `InspiredesignWorkflowOptions` because those interfaces use the injected `resolveMediaAnalysisBinaries` mock pattern. The mock override completely bypasses the real resolver. Only the real resolver's direct call sites (coordinator.ts:417, workflows.ts:3920) use the options, and they don't need to pass `commonPaths` (they get the production default).

**Conclusion:** Adding `commonPaths` to `InspiredesignMediaAnalysisBinaryResolverOptions` is a non-breaking change. Zero production callers need modification. Only test callers that need hermetic isolation will pass `commonPaths: []`.

---

### Summary Table

| Focus Area | Tests Break? | Changes Needed | Priority |
|-----------|-------------|----------------|----------|
| 1. Plist content assertions | No | Extend 1 test with PATH assertions | High |
| 2. missingPath hermeticity | Yes (non-deterministic) | Pass `commonPaths: []` | High |
| 3. statusCapabilities mock | No | None | - |
| 4. Real ffmpeg/ffprobe spawns | No (none exist) | None | - |
| 5. New tests | N/A | 6 new test cases | High |
| 6. Windows coverage | No | None (ONLOGON inherits PATH) | - |
| 7. Complexity limits | At limit | Extract `tryCommonPathFallback()` | High |
| 8. Config schema tests | No | None | - |
| 9. Docs/skill wording tests | No | None (toContain is additive) | - |
| 10. commonPaths type impact | No (optional field) | None for production callers | - |

### 7. Fallback Logic Placement - resolveBinaryStatus vs probeBinaryVersion vs Separate Function

**Source evidence:**

- `resolveBinaryStatus()` at `binaries.ts:78-100` is the orchestrator that calls `selectRequestedBinary()` then `probeBinaryVersion()`. It currently has ~20 logical lines and 2 decision points (blank check, "limitation" check), so it is near the complexity threshold (24-line / 3-decision early-warning).
- `probeBinaryVersion()` at `binaries.ts:152-170` is the spawn wrapper. It catches all errors at line 161 and calls `formatProbeError()` which converts ENOENT to a string at line 240.
- `formatProbeError()` at `binaries.ts:239-243` is the single point where `error.code === "ENOENT"` is checked and the signal is lost.

**Recommendation:** The fallback should live in a **separate function** (`tryCommonPathFallback`), called from `resolveBinaryStatus()` after `probeBinaryVersion()` returns a limitation. This keeps `resolveBinaryStatus()` under complexity limits and makes the fallback independently testable. The fallback function should accept the `BinaryRequest`, `env`, `timeoutMs`, and an injectable `commonPaths` list, returning `InspiredesignMediaAnalysisBinaryStatus | null`.

### 8. ENOENT Detection Before formatProbeError Converts It

**Source evidence:**

- `probeBinaryVersion()` catch block at `binaries.ts:161-163`: `return { limitation: formatProbeError(tool, error) }`.
- `formatProbeError()` at `binaries.ts:239-243`: checks `error.code === "ENOENT"` and returns `"${tool} binary was not found."`.
- By the time `resolveBinaryStatus()` receives the `ProbeResult`, it is `{ limitation: string }` - the ENOENT signal is gone.

**Recommendation:** Extend `ProbeResult` to preserve the ENOENT signal as a discriminated field:

```typescript
type ProbeResult =
  | { version: string }
  | { limitation: string; enoent?: boolean };
```

In `probeBinaryVersion()` catch block, detect ENOENT before calling `formatProbeError`:

```typescript
} catch (error) {
  const enoent = error instanceof Error && "code" in error && error.code === "ENOENT";
  return { limitation: formatProbeError(tool, error), enoent };
}
```

Then `resolveBinaryStatus()` checks `probe.enoent === true && selected.source === "path"` before calling the fallback. This avoids fragile string matching on "binary was not found."

### 9. Common Absolute Paths to Probe - Platform Coverage

**Source evidence:** No platform-specific paths exist anywhere in the codebase today. `selectRequestedBinary()` at `binaries.ts:102-114` returns bare `"ffmpeg"` / `"ffprobe"` for PATH source.

**Recommendation - platform-aware common paths:**

macOS:
- `/opt/homebrew/bin/{ffmpeg,ffprobe}` (Apple Silicon Homebrew)
- `/usr/local/bin/{ffmpeg,ffprobe}` (Intel Homebrew, MacPorts)
- `/usr/bin/{ffmpeg,ffprobe}` (system, rarely present but harmless to probe)

Linux:
- `/usr/bin/{ffmpeg,ffprobe}` (apt/dnf default)
- `/usr/local/bin/{ffmpeg,ffprobe}` (manual builds)
- `/snap/bin/{ffmpeg,ffprobe}` (snap package)

Windows:
- `C:\\ffmpeg\\bin\\{ffmpeg,ffprobe}.exe` (common manual install)
- Do NOT probe `C:\\Program Files\\...` paths - too many variants and FFmpeg is rarely installed there via package managers.

**Windows paths should be included** but as a separate list gated on `process.platform === "win32"`. Windows scheduled tasks inherit user logon PATH (confirmed in existing report), so Windows fallback is lower priority but harmless to include for robustness.

The common-paths list should be a named constant or a function `defaultCommonPathsForTool(tool, platform)` that returns the platform-specific list. This makes it injectable for tests.

### 10. existsSync vs Direct Spawn for Fallback

**Source evidence:** `runVersionProcess()` at `binaries.ts:172-211` spawns the binary and handles `child.on("error")` which fires for ENOENT. The error handler rejects the promise, caught by `probeBinaryVersion()`.

**Recommendation:** **Use direct spawn, not existsSync.** Rationale:
1. `spawn` with an absolute path fails with ENOENT if the file doesn't exist, caught by the same error handler. No additional I/O needed.
2. `existsSync` introduces a TOCTOU race condition (file deleted between check and spawn).
3. `existsSync` checks file existence, not executability. A non-executable file would pass `existsSync` but fail spawn with EACCES, requiring a second error path.
4. Direct spawn is consistent with the existing probe pattern - no new code path to maintain.

### 11. Fallback Env Interaction - Does Spawn with Absolute Path Need PATH?

**Source evidence:** `runVersionProcess()` at `binaries.ts:174` calls `spawn(binaryPath, [...PROBE_ARGS], { env, stdio: ["ignore", "pipe", "pipe"] })`. The `env` option sets the child process's environment variables, NOT the lookup path for the binary itself.

**Recommendation:** **No env modification needed.** When `binaryPath` is absolute (`/usr/local/bin/ffmpeg`), Node.js `spawn` does not consult PATH to find the binary - it executes the absolute path directly. The `env` parameter only affects the child's runtime environment (e.g., `DYLD_LIBRARY_PATH`, `HOME`), not binary resolution. The fallback can pass the same `env` that was passed to the original probe.

Verification: Node.js `child_process.spawn` documentation confirms that when the first argument is an absolute path, PATH is not consulted. This is OS-level `execv` behavior, not Node-specific.

### 12. resolvedPath vs requestedPath When Fallback Succeeds

**Source evidence:**
- `BinaryStatus` type at `types.ts:49-58`: has both `requestedPath: string` (required) and `resolvedPath?: string` (optional).
- Current code at `binaries.ts:98`: `resolvedPath: selected.requestedPath` (always equals requestedPath).
- Downstream consumer at `workflows.ts:3904-3905`: `binaries.ffmpeg.resolvedPath ? { ffmpegBinaryPath: binaries.ffmpeg.resolvedPath }`.

**Recommendation:** When fallback succeeds:
- `requestedPath` stays as the bare name (`"ffmpeg"`) - this is what the user/system requested.
- `resolvedPath` is set to the discovered absolute path (`"/usr/local/bin/ffmpeg"`) - this is what was actually found and will be used.
- `source` stays `"path"` - the fallback is a PATH-source enhancement, not a new source type.

This preserves the semantic distinction: `requestedPath` = "what was asked for," `resolvedPath` = "what was actually used." The downstream consumer at `workflows.ts:3904` already gates on `binaries.ffmpeg.resolvedPath` being truthy, so it will correctly propagate the absolute path to the analyzer.

### 13. Partial Availability - ffmpeg Found but ffprobe Not, or Vice Versa

**Source evidence:** `resolveHostCapabilityTier()` at `binaries.ts:142-150`:

```typescript
if (ffmpeg.available && ffprobe.available) return "full";
if (ffprobe.available) return "metadata_only";
if (ffmpeg.available) return "frame_decode_only";
return "unavailable";
```

**Finding:** Partial availability is already handled correctly. The fallback is per-binary (each binary resolves independently via `Promise.all` at `binaries.ts:56-57`). If fallback finds ffmpeg at `/usr/local/bin/ffmpeg` but ffprobe is not at any common path, the tier becomes `"frame_decode_only"` - metadata analysis is unavailable, but frame extraction works. This is the intended degradation behavior.

No changes needed to `resolveHostCapabilityTier()`.

### 14. missingPath Test Case - Hermeticity with Fallback Added

**Source evidence:** Test at `inspiredesign-media-analysis.test.ts:186-230`:
- `missingPath` sub-case at line 190: `resolveInspiredesignMediaAnalysisBinaries({ env: { PATH: emptyPathDir }, timeoutMs: 100 })`
- Expects `available: false`, `source: "path"`, `requestedPath: "ffmpeg"`, `limitation: "ffmpeg binary was not found."` (line 223-227)

**Will this test break?** **Yes, if fallback is added without injectable commonPaths.** If a real ffmpeg exists at `/usr/local/bin/ffmpeg` or `/opt/homebrew/bin/ffmpeg` on the CI/dev machine, the fallback will find it and the test will fail because `available` becomes `true`.

**Fix - make commonPaths injectable:**

Add `commonPaths?: string[]` to `InspiredesignMediaAnalysisBinaryResolverOptions` at `binaries.ts:18-23`:

```typescript
export type InspiredesignMediaAnalysisBinaryResolverOptions = {
  config?: InspiredesignMediaAnalysisBinaryPathsConfig;
  env?: InspiredesignMediaAnalysisBinaryResolverEnv;
  timeoutMs?: number;
  commonPaths?: string[];
};
```

Production calls (at `workflows.ts:3916` and `coordinator.ts:416-417`) omit `commonPaths`, so the default platform-aware list is used. The `missingPath` test passes `commonPaths: []` to disable fallback, preserving the existing assertion that the binary is not found.

This is the cleanest approach because:
1. It does not require mocking `existsSync` or `spawn`.
2. It makes the fallback opt-out for tests without adding test-only conditionals in production code.
3. It follows the existing injection pattern (env, timeoutMs are already injectable).

**New test cases needed:**

1. "falls back to common absolute paths when PATH-source bare name fails with ENOENT":
   - Create a fake binary at a temp path.
   - Call resolver with `env: { PATH: emptyDir }`, `commonPaths: [fakeBinaryPath]`.
   - Assert `available: true`, `source: "path"`, `requestedPath: "ffmpeg"`, `resolvedPath: fakeBinaryPath`.

2. "does NOT fall back when source is env or config":
   - Set `OPENDEVBROWSER_FFMPEG_PATH_ENV` to a nonexistent path.
   - Call resolver with `commonPaths: [realBinaryPath]`.
   - Assert `available: false`, `source: "env"` - no fallback attempted.

3. "does NOT fall back when commonPaths is empty":
   - Call resolver with `env: { PATH: emptyDir }`, `commonPaths: []`.
   - Assert `available: false`, `limitation: "ffmpeg binary was not found."` (same as current behavior).

4. "preserves requestedPath as bare name when fallback succeeds":
   - Assert `requestedPath === "ffmpeg"` and `resolvedPath === "/absolute/path/to/ffmpeg"`.

### 15. Risk of Finding a Broken or Wrong ffmpeg Binary at a Common Path

**Risk analysis:** A common path like `/usr/local/bin/ffmpeg` could contain:
1. A broken symlink (ENOENT or EACCES on spawn).
2. A non-FFmpeg binary named ffmpeg (wrong version output, rejected by `parseVersionOutput`).
3. A malicious binary (security concern, addressed in existing security analysis).

**Mitigation already present:**
- `parseVersionOutput()` at `binaries.ts:221-237` validates the version line with `new RegExp(\\b${tool}\\b.*\\bversion\\b, "iu")`. A non-FFmpeg binary will fail this check and return a limitation, not a false positive.
- If spawn fails with EACCES (broken symlink, no execute permission), `formatProbeError()` returns a generic failure message and the fallback moves to the next path.
- The fallback should try each common path in order and return the first success. If all fail, return `null` and `resolveBinaryStatus()` returns the original limitation.

**Additional recommendation:** The fallback function should catch all spawn errors per-path (not just ENOENT) and continue to the next path. This handles EACCES, EISDIR, and other spawn failures gracefully. Only ENOENT from the original PATH-source probe should trigger the fallback, but once in the fallback, any error at a common path should skip to the next candidate.

### 16. Fallback Scope - PATH Source Only, or Also Config Relative Paths?

**Source evidence:** `selectRequestedBinary()` at `binaries.ts:102-114` returns:
- `source: "env"` when `env[OPENDEVBROWSER_FFMPEG_PATH_ENV]` is set.
- `source: "config"` when `config.ffmpegPath` is set.
- `source: "path"` with bare name otherwise.

**Recommendation:** **Fallback should be PATH-source only.** Rationale:
1. Env and config are explicit user intent. If the user sets `OPENDEVBROWSER_FFMPEG_PATH=/custom/ffmpeg` and it fails, the resolver should report the failure, not silently try other paths. This preserves diagnostic value.
2. Config paths are typically absolute already (the user specifies the full path). Relative config paths are unusual and ambiguous - should they be relative to CWD? To the config file? Adding fallback for relative config paths introduces complexity for a rare edge case.
3. The AGENTS.md principle "explicit bad config should stay diagnostic" (from existing security analysis) applies here.

If config path is relative and fails, the limitation message already says "version probe failed" which is diagnostically clear. No fallback needed.

### 17. Code Complexity Compliance Check

**AGENTS.md limits:** 30 logical lines per function, 4 decision statements, nesting depth 2, 15 top-level functions per file, 1000 logical lines per file.

**Current state of binaries.ts:** 244 lines total, 13 top-level functions (counted from grep output above). Well within file limits.

**Impact of adding fallback:**

If fallback logic is inlined into `resolveBinaryStatus()`:
- Adds ~8-10 logical lines (check enoent, check source, loop common paths, call probe, return)
- Adds 2-3 decision statements (if enoent, if source === "path", if fallback result)
- Would push `resolveBinaryStatus()` to ~28-30 logical lines and 4-5 decisions - at or over the limit.

If fallback is extracted to `tryCommonPathFallback()`:
- `resolveBinaryStatus()` adds 2-3 lines and 1-2 decisions (check enoent + source, call fallback, check result) - stays at ~22-23 lines and 3-4 decisions. Within limits.
- `tryCommonPathFallback()` is ~15-20 logical lines with 2-3 decisions (loop, try probe, check result). Within limits.
- Adds 1 new top-level function (total becomes 14). Within the 15-function limit.

**Recommendation:** Extract `tryCommonPathFallback()` as a separate function. This is mandatory for complexity compliance, not just a style preference. Also add a `defaultCommonPathsForTool()` helper (1-2 lines) that returns the platform-aware path list - this keeps the fallback function focused.

Also extend `ProbeResult` type (1 line change) and add `enoent?: boolean` to the catch block in `probeBinaryVersion()` (1 line change). These are minimal and do not affect complexity.

### 18. resolvedPath Downstream Flow to ffprobe.ts and ffmpeg.ts

**Full trace verified:**

1. `binaries.ts:98` - `resolvedPath: selected.requestedPath` (currently always bare name for PATH source).
2. `workflows.ts:3904-3905` - `buildInspiredesignMediaAnalyzerBinaryOptions()` extracts `resolvedPath` and sets it as `ffmpegBinaryPath` / `ffprobeBinaryPath`.
3. `analyzer.ts:90-95` - `runProbe()` passes `options.ffprobeBinaryPath` as `binaryPath` to `runInspiredesignFfprobe`.
4. `analyzer.ts:104-109` - `runFrameExtraction()` passes `options.ffmpegBinaryPath` as `binaryPath` to `extractInspiredesignFfmpegFrames`.
5. `ffprobe.ts:27` - `const binaryPath = options.binaryPath ?? DEFAULT_FFPROBE_BINARY` (bare "ffprobe").
6. `ffmpeg.ts:33` - `options.binaryPath ?? DEFAULT_FFMPEG_BINARY` (bare "ffmpeg").

**Finding confirmed:** When `resolvedPath` is a bare name (`"ffmpeg"`), the analyzer spawns with the bare name, relying on PATH again. When `resolvedPath` is an absolute path (`"/usr/local/bin/ffmpeg"`), the analyzer spawns with the absolute path directly.

**Critical implication:** The absolute-path fallback fix solves both the probe AND the actual analysis path, because `resolvedPath` propagates end-to-end. If fallback finds `/usr/local/bin/ffmpeg`, the analyzer will use that absolute path for actual ffprobe/ffmpeg invocations, not just the version probe.

**However:** Note that `ffprobe.ts:27` and `ffmpeg.ts` spawn WITHOUT passing `env` (no env option in their `runProcess` calls). So even if the daemon has a correct PATH (from the LaunchAgent fix), the actual analysis spawns inherit `process.env` by default (Node.js spawn default when `env` is omitted). This means:
- If the daemon process has a corrected PATH (LaunchAgent fix), bare-name spawns in ffprobe.ts/ffmpeg.ts will work because they inherit the daemon's `process.env.PATH`.
- If `resolvedPath` is absolute (fallback fix), bare-name vs absolute doesn't matter for the analysis spawns - the absolute path is used directly.

**Both fixes are complementary and both are needed.** The LaunchAgent PATH fix ensures the daemon process itself has a correct PATH. The fallback fix ensures `resolvedPath` is an absolute path that propagates to analysis spawns. Either fix alone leaves gaps:
- LaunchAgent fix only: probe works (daemon PATH is correct), analysis works (inherits daemon PATH). But if the daemon was started by a user with a custom PATH, or if a future daemon launch path changes, the bare-name dependency remains fragile.
- Fallback fix only: probe works (fallback finds absolute path), analysis works (absolute path propagates). But the daemon process still has a stripped PATH, which could affect other host tool discovery beyond ffmpeg.

### 19. External Research - How Other Node.js Projects Handle Binary Fallback

*(Explore agent dispatched for external research; findings to be appended when results return.)*

**Preliminary findings from codebase knowledge:**

- `which` npm package: resolves binary paths using PATH, does not provide absolute-path fallback lists. Would not solve the stripped-PATH problem directly.
- `ffmpeg-static` / `ffprobe-static`: bundle static binaries, avoiding PATH resolution entirely. Not appropriate here per AGENTS.md "do not bundle static FFmpeg."
- `fluent-ffmpeg`: accepts a binary path config option but does not do fallback discovery - relies on PATH or explicit config.
- Playwright/Puppeteer: use bundled browsers with known paths, not system binary discovery with fallback.
- The `which`-style approach (PATH lookup) is what `selectRequestedBinary` already does implicitly via `spawn("ffmpeg")`. The absolute-path fallback is a custom enhancement specific to the stripped-PATH daemon scenario, not a standard pattern in the Node.js ecosystem.

**Conclusion:** The absolute-path fallback approach is novel but justified. No standard Node.js library provides this pattern because most projects either bundle their binary or rely on PATH. The daemon-with-stripped-PATH scenario is specific to macOS LaunchAgent deployment, making a custom fallback the correct solution.

### 6. LaunchAgent EnvironmentVariables.PATH Safety and Correctness Analysis

**Scope:** Validated the safety and correctness of adding `EnvironmentVariables.PATH` with `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin` to the macOS LaunchAgent plist in `src/cli/daemon-autostart.ts`. Each focus area answered with file:line references and external source citations.

#### Focus 1: Reconciliation Logic Impact

**Verdict: No breakage to `readMacLaunchAgentProgramArguments` or `classifyMacAutostartStatus`.**

- `readMacLaunchAgentProgramArguments()` (`src/cli/daemon-autostart.ts:363-392`) parses the plist via `plutil -convert json` into a JSON object typed as `{ ProgramArguments?: unknown; WorkingDirectory?: unknown }` at line 372. It only reads `ProgramArguments` and `WorkingDirectory`. The `EnvironmentVariables` key in the plist is transparent to this function; it is ignored by the JSON destructuring. Adding it will not cause parsing errors, type mismatches, or missing-program-arguments false positives.
- `classifyMacAutostartStatus()` (`src/cli/daemon-autostart.ts:393-465`) consumes the result of `readMacLaunchAgentProgramArguments()` and checks: plist existence (line 395), program argument validity (line 414), working directory match (line 431), directory existence (line 443), transient path (line 449), and expected program argument match (line 455). None of these branches reference `EnvironmentVariables`. Existing plists without `EnvironmentVariables` will still report `healthy`; plists with `EnvironmentVariables` will also report `healthy`.
- **No reconciliation check should be added for `EnvironmentVariables`.** Existing plists without PATH should not be flagged for repair. The PATH will be added on next `daemon install` or package postinstall, matching the existing `installMacAutostart()` overwrite behavior at line 533-535.

#### Focus 2: Plist XML Escaping for PATH Colons

**Verdict: No special escaping needed. Colons are valid unescaped XML characters.**

- The Apple PropertyList-1.0 DTD (fetched from `http://www.apple.com/DTDs/PropertyList-1.0.dtd`) defines `<string>` as `(#PCDATA)` - parsed character data. Colons (`:`) are ordinary characters in XML and do not require escaping.
- `escapePlistString()` (`src/cli/daemon-autostart.ts:190-195`) escapes `&`, `<`, `>`, `"`, `'`. The PATH value `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin` contains only alphanumeric characters, forward slashes, colons, and periods. None of these are in the escape set.
- The `man launchd.plist` page confirms `EnvironmentVariables` is `<dictionary of strings>` with the note: "Values other than strings will be ignored." The PATH value is a string, so it will be honored.
- The PATH value should still be passed through `escapePlistString()` for consistency and future-proofing, even though it will return the value unchanged for this specific value.

#### Focus 3: Hardcoded vs Configurable

**Verdict: Hardcoded as a named constant, following the existing pattern.**

- The file already uses hardcoded named constants: `MAC_LABEL` at line 7, `WIN_TASK_NAME` at line 8, `STABLE_DAEMON_INSTALL_GUIDANCE` at line 9. These are all module-level `const` declarations with clear intent.
- The PATH should follow the same pattern: `const MAC_LAUNCH_AGENT_DEFAULT_PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";` at the top of the file alongside the other constants.
- Configurability would add complexity for marginal benefit. The goal is covering standard macOS tool locations. The config schema (`src/config.ts`) should not be extended for this.
- The AGENTS.md rule "Hardcoded configuration is prohibited unless it is a named constant with clear intent" is satisfied by the named constant pattern.

#### Focus 4: escapePlistString Handling of PATH Values

**Verdict: Correct. `escapePlistString()` handles PATH values correctly.**

- `escapePlistString()` at `src/cli/daemon-autostart.ts:190-195` performs five replacements: `&` → `&amp;`, `<` → `&lt;`, `>` → `&gt;`, `"` → `&quot;`, `'` → `&apos;`.
- The PATH value `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin` contains no characters in the escape set. `escapePlistString()` will return it unchanged.
- If a future PATH value contained an `&` (e.g., a path with an ampersand in a directory name, which is unusual but theoretically possible), `escapePlistString()` would correctly escape it to `&amp;`. The function is safe for all valid PATH values.
- The function is already used for all other string values in the plist (label at line 215, working directory at line 225, stdout/stderr paths at lines 227-229) and should be used for the PATH value for consistency.

#### Focus 5: installMacAutostart vs buildLaunchAgentPlist Ownership

**Verdict: `buildLaunchAgentPlist()` owns the PATH. No changes needed to `installMacAutostart()`.**

- `installMacAutostart()` at `src/cli/daemon-autostart.ts:521-555` calls `buildLaunchAgentPlist(entrypoint, { stdoutPath, stderrPath, workingDirectory })` at line 533-535. It passes only install-time-specific paths (stdout, stderr, working directory) that depend on the user's home directory.
- `buildLaunchAgentPlist()` at line 197-233 owns the plist structure. It already hardcodes structural properties: `RunAtLoad` (line 218), `KeepAlive` (line 220), the XML header and DTD (lines 209-210). The PATH is a structural property of the plist, not an install-time parameter.
- The `options` type `{ label?, stdoutPath?, stderrPath?, workingDirectory? }` at line 198 should NOT be extended with a `path` parameter. The PATH is not user-configurable (see Focus 3).
- `installMacAutostart()` should not pass PATH through. It already passes `stdoutPath`, `stderrPath`, and `workingDirectory`, and `buildLaunchAgentPlist()` will add the PATH from the named constant.

#### Focus 6: Other EnvironmentVariables (HOME, TMPDIR)

**Verdict: Only PATH is needed. HOME and TMPDIR are inherited by user-level LaunchAgents.**

- The `man launchd.plist` page describes `EnvironmentVariables` as "additional environmental variables" - meaning it adds or overrides specific variables. Unspecified variables are inherited from the user session.
- macOS launchd for user-level LaunchAgents (gui/uid domain) inherits `HOME`, `USER`, `LOGNAME`, `TMPDIR`, and `SHELL` from the user session. The only variable that launchd replaces is `PATH`, which it sets to `_PATH_STDPATH`.
- `_PATH_STDPATH` is defined in `/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk/usr/include/paths.h:67` as `"/usr/bin:/bin:/usr/sbin:/sbin"`. This excludes `/opt/homebrew/bin` and `/usr/local/bin` where FFmpeg/FFprobe are typically installed.
- Setting `HOME` explicitly would risk overriding the correct inherited value if the user's home directory differs from what the daemon expects. Setting `TMPDIR` explicitly could break if the user's tmpdir is non-standard.
- PM2's LaunchAgent template (`Unitech/pm2` at `lib/templates/init-scripts/launchd.tpl`) sets both `PATH` and `PM2_HOME` (an application-specific variable, not a system variable). It does not override `HOME` or `TMPDIR`.
- VERDICT: Only `PATH` should be set. Adding `HOME` or `TMPDIR` would be unnecessary and potentially harmful.

#### Focus 7: Existing Test Breakage

**Verdict: No existing tests will break. New assertions should be added.**

- `tests/daemon-autostart.test.ts:249-256` ("builds a launch agent plist with program arguments") uses `toContain` assertions for `com.test.daemon`, `/node`, `/cli/index.js`, `serve`, and `<key>WorkingDirectory</key>`. Adding `EnvironmentVariables` to the plist is additive; all existing assertions will still pass.
- `tests/daemon-autostart.test.ts:258-276` ("escapes launch agent plist string values") uses `toContain` assertions for escaped values. No assertion checks for the absence of `EnvironmentVariables`. No breakage.
- `tests/daemon-autostart.test.ts:349-373` ("creates the macOS LaunchAgents and Logs directories before bootstrap") checks `writeFileSyncMock` was called with `expect.stringContaining("<key>WorkingDirectory</key>")`. The plist will still contain `WorkingDirectory`, so this passes.
- **New test assertions needed** in the "builds a launch agent plist with program arguments" test:
  - `expect(plist).toContain("<key>EnvironmentVariables</key>")`
  - `expect(plist).toContain("<key>PATH</key>")`
  - `expect(plist).toContain("/opt/homebrew/bin")`
  - `expect(plist).toContain("/usr/local/bin")`
  - `expect(plist).toContain("/usr/bin:/bin:/usr/sbin:/sbin")`

### 7. External Research: Apple LaunchAgent Plist Spec for EnvironmentVariables

**Sources consulted:**
- `man launchd.plist` (macOS system man page)
- Apple Developer Archive: "Creating Launch Daemons and Agents" (`developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html`)
- Apple PropertyList-1.0 DTD (`http://www.apple.com/DTDs/PropertyList-1.0.dtd`)
- macOS SDK headers: `/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk/usr/include/paths.h`

**Findings:**

1. **XML plist format for EnvironmentVariables:** The `man launchd.plist` page defines it as `EnvironmentVariables <dictionary of strings>` - "This optional key is used to specify additional environmental variables to be set before running the job. Each key in the dictionary is the name of an environment variable, with the corresponding value being a string representing the desired value. NOTE: Values other than strings will be ignored." The XML format is:
   ```xml
   <key>EnvironmentVariables</key>
   <dict>
     <key>PATH</key>
     <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
   </dict>
   ```

2. **Override vs append:** `EnvironmentVariables.PATH` overrides the inherited PATH entirely for the specified key. launchd sets the default PATH to `_PATH_STDPATH` (`/usr/bin:/bin:/usr/sbin:/sbin` per `paths.h:67`), and `EnvironmentVariables.PATH` replaces it. It does not append.

3. **Default PATH launchd provides:** `_PATH_STDPATH` = `/usr/bin:/bin:/usr/sbin:/sbin` (confirmed from `paths.h:67`). This excludes `/opt/homebrew/bin` (Apple Silicon Homebrew) and `/usr/local/bin` (Intel Homebrew and manual installs).

4. **Known issues:** No known issues with `EnvironmentVariables.PATH` being ignored by launchd. The `man launchd.plist` page documents it as supported. `launchctl setenv` is a separate mechanism that sets system-wide environment variables; the plist `EnvironmentVariables` key is the correct approach for per-job variables.

5. **DTD support:** The PropertyList-1.0 DTD defines `<dict>` as `(key, %plistObject;)*` where `%plistObject` includes `string`. `EnvironmentVariables` is just a `<key>` with a `<dict>` value, which is valid per the DTD.

6. **Colon validity:** Colons are valid unescaped characters in XML `#PCDATA`. The DTD defines `<string>` as `(#PCDATA)`. No escaping needed.

### 8. External Research: npm Packages That Inject PATH into LaunchAgent Plists

**Packages examined:**

1. **PM2** (`Unitech/pm2`, `lib/templates/init-scripts/launchd.tpl`): **YES, includes EnvironmentVariables.PATH.** The template explicitly sets:
   ```xml
   <key>EnvironmentVariables</key>
   <dict>
     <key>PATH</key>
     <string>%NODE_PATH%</string>
     <key>PM2_HOME</key>
     <string>%HOME_PATH%</string>
   </dict>
   ```
   The `%NODE_PATH%` placeholder is replaced at install time with the Node.js binary directory path. PM2 also sets `PM2_HOME` (an application-specific variable). This is the strongest precedent: a major process manager with millions of weekly downloads explicitly injects PATH into its LaunchAgent plist.

2. **auto-launch** (`4ver/node-auto-launch`, `src/library/autoLaunchAPI/autoLaunchAPIMac.js`): **Does NOT include EnvironmentVariables.** The plist template (`MAC_PLIST_DATA` constant) contains only `Label`, `ProgramArguments`, and `RunAtLoad`. No `EnvironmentVariables`, no `WorkingDirectory`, no `StandardOutPath`/`StandardErrorPath`. This is a minimal plist for launching GUI applications at login, not for background daemons that need PATH access.

3. **node-launchd** (`little-big-h/node-launchd`): A low-level launchd wrapper. Did not find evidence of plist generation with EnvironmentVariables in the registry description.

**Conclusion:** PM2, the most widely-used Node.js process manager, explicitly injects `EnvironmentVariables.PATH` into its LaunchAgent plist. This validates the approach as a recognized best practice for Node.js daemons that need to spawn child processes via PATH lookup. The opendevbrowser daemon has the same need (spawning FFmpeg/FFprobe via bare name).

## Phase 3 Retry - RepoPrompt Sub-Agent Results (2026-06-26)

On retry, the RepoPrompt context builder and all 3 pair investigators completed successfully using model `glm-5.2`. The agents appended sections 6-19 (resolver design), sections 6-8 (LaunchAgent safety + external research), and section 6 (test coverage) to the Investigator Findings above.

### Key New Findings from Sub-Agents

1. **PM2 precedent validated**: PM2 (`Unitech/pm2`), a major npm process manager with millions of weekly downloads, explicitly injects `EnvironmentVariables.PATH` in its LaunchAgent template (`lib/templates/init-scripts/launchd.tpl`). This confirms the approach as a recognized best practice for Node.js daemons that spawn child processes via PATH lookup.

2. **`_PATH_STDPATH` confirmed from source**: macOS SDK header `paths.h:67` defines `_PATH_STDPATH` as `"/usr/bin:/bin:/usr/sbin:/sbin"` - this is what launchd provides by default. Confirms the exact gap: `/opt/homebrew/bin` and `/usr/local/bin` are excluded.

3. **`man launchd.plist` confirms override semantics**: `EnvironmentVariables.PATH` overrides (not appends) the default PATH. The plist DTD supports `<dict>` inside `EnvironmentVariables` with `<string>` values. Colons are valid unescaped XML characters.

4. **Code complexity compliance requires extraction**: Adding fallback inline to `resolveBinaryStatus()` would hit 3 AGENTS.md limits simultaneously (4 decision statements, 4 parameters, nesting depth 2). Extracting `tryCommonPathFallback()` as a separate function is mandatory, not optional.

5. **`commonPaths` injection is fully non-breaking**: Adding `commonPaths?: readonly string[]` to `InspiredesignMediaAnalysisBinaryResolverOptions` requires zero changes to production callers (coordinator.ts:417, workflows.ts:3920). Only test callers pass `commonPaths: []` for hermeticity.

6. **`ffprobe.ts` and `ffmpeg.ts` do NOT pass env to spawn**: Unlike the binary probe in `binaries.ts:174` which passes `env`, the actual analysis runners in `ffprobe.ts` and `ffmpeg.ts` spawn without an `env` option, inheriting `process.env` by default. This means:
   - LaunchAgent PATH fix alone: analysis spawns work because they inherit the daemon's corrected `process.env.PATH`
   - Fallback fix alone: analysis spawns work because `resolvedPath` is absolute and propagates downstream
   - Both fixes together: defense in depth - correct daemon PATH AND absolute-path propagation

7. **6 new tests needed** (validated by test coverage agent):
   - Plist PATH assertion (extend existing test, `toContain` assertions)
   - Fallback success with fake binary at temp path via `commonPaths`
   - Fallback failure with nonexistent `commonPaths`
   - No fallback for explicit env/config paths (extend existing `explicitEnvFailure` test)
   - No fallback when `commonPaths: []` (adapted `missingPath` test)
   - Partial availability (ffmpeg found, ffprobe not, `capabilityTier: "frame_decode_only"`)

8. **No existing tests break** except `missingPath` at `inspiredesign-media-analysis.test.ts:198` which becomes non-hermetic. Fix: pass `commonPaths: []`.

9. **Fallback should catch all spawn errors per-path** (not just ENOENT): EACCES, EISDIR, and other errors at common paths should skip to the next candidate. Only ENOENT from the original PATH-source probe triggers the fallback.

10. **Windows paths**: Agent recommended including `C:\\ffmpeg\\bin\\{ffmpeg,ffprobe}.exe` as lower-priority fallback paths. Windows `schtasks /SC ONLOGON` inherits user logon PATH, so Windows fallback is lower priority but harmless for robustness.

## Root Cause (Updated with Sub-Agent Validation)

Two independent defects combine to cause the failure, confirmed by deep multi-agent investigation:

1. **LaunchAgent plist omits PATH** (`src/cli/daemon-autostart.ts:197`): `buildLaunchAgentPlist()` does not include an `EnvironmentVariables` dictionary. macOS launchd sets PATH to `_PATH_STDPATH` = `/usr/bin:/bin:/usr/sbin:/sbin` (confirmed from `paths.h:67`), excluding `/opt/homebrew/bin` and `/usr/local/bin`. PM2 solves this same problem by injecting `EnvironmentVariables.PATH` in its LaunchAgent template.

2. **Binary resolver has no absolute-path fallback** (`src/inspiredesign/media-analysis/binaries.ts:46`): `selectRequestedBinary()` returns bare `"ffmpeg"` / `"ffprobe"` when source is `"path"`. When the daemon's PATH doesn't include the tool's directory, `spawn("ffmpeg", ["-version"])` throws ENOENT. The ENOENT signal is lost when `formatProbeError()` converts it to a limitation string at line 239-241. No fallback to probe common absolute paths exists.

**Downstream propagation finding**: `resolvedPath` propagates end-to-end to `ffprobe.ts:27` and `ffmpeg.ts`. When the resolver returns a bare name, the analyzer also spawns with the bare name. Both fixes are complementary: the plist PATH fix corrects the daemon process environment, and the fallback fix ensures `resolvedPath` is an absolute path that propagates to analysis spawns.

## Recommendations (Updated with Sub-Agent Validation)

1. **Add `EnvironmentVariables.PATH` to the LaunchAgent plist** in `src/cli/daemon-autostart.ts`:
   - Add named constant: `const MAC_LAUNCH_AGENT_DEFAULT_PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";`
   - Insert `<key>EnvironmentVariables</key>` block with nested `<dict>` containing `<key>PATH</key>` and `<string>${escapePlistString(MAC_LAUNCH_AGENT_DEFAULT_PATH)}</string>`
   - Place after `StandardErrorPath` and before `</dict>` in the plist array
   - Follow existing `MAC_LABEL`/`WIN_TASK_NAME` constant pattern
   - `buildLaunchAgentPlist()` owns the PATH; `installMacAutostart()` needs no changes
   - Only PATH needed - HOME, USER, TMPDIR are inherited by user-level LaunchAgents

2. **Add absolute-path fallback to the binary resolver** in `src/inspiredesign/media-analysis/binaries.ts`:
   - Extend `ProbeResult` type to `{ limitation: string; enoent?: boolean }` to preserve ENOENT signal
   - In `probeBinaryVersion()` catch block: `const enoent = error instanceof Error && "code" in error && error.code === "ENOENT"; return { limitation: formatProbeError(tool, error), enoent };`
   - Extract `tryCommonPathFallback()` as a separate function (mandatory for complexity compliance)
   - Use a `ResolveBinaryContext` type to avoid 4-parameter limit: `{ env, timeoutMs, commonPaths }`
   - Platform-aware common paths: macOS (`/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`), Linux (`/usr/bin`, `/usr/local/bin`, `/snap/bin`), Windows (`C:\\ffmpeg\\bin`)
   - Direct spawn (not existsSync) for fallback - avoids TOCTOU race
   - Catch all spawn errors per-path (not just ENOENT) and continue to next candidate
   - Set `resolvedPath` to absolute path, `requestedPath` stays bare, `source` stays `"path"`
   - Only trigger for `source === "path"` and `probe.enoent === true`

3. **Add `commonPaths` to resolver options**:
   - `commonPaths?: readonly string[]` on `InspiredesignMediaAnalysisBinaryResolverOptions`
   - Non-breaking: zero production callers need changes
   - Default: platform-aware list from `defaultCommonPathsForTool(tool, platform)`
   - Tests pass `commonPaths: []` for hermeticity

4. **Keep FFmpeg optional and non-fatal**: do not bundle static FFmpeg. Missing binaries degrade `media-analysis.json` only.

5. **Do not add reconciliation check for EnvironmentVariables**: existing plists without PATH stay healthy. PATH added on next `daemon install` or package postinstall.

6. **Add 6 new tests**:
   - Extend "builds a launch agent plist" test with `EnvironmentVariables`, `PATH`, `/opt/homebrew/bin`, `/usr/local/bin` assertions
   - Fallback success: fake binary at temp path via `commonPaths`, empty PATH env, verify `available: true` with `resolvedPath`
   - Fallback failure: nonexistent `commonPaths`, verify `available: false` with ENOENT limitation
   - No fallback for explicit paths: extend `explicitEnvFailure` test with `commonPaths`, verify no fallback attempted
   - No fallback when `commonPaths: []`: adapt `missingPath` test, verify same behavior as current
   - Partial availability: ffmpeg found via fallback, ffprobe not, verify `capabilityTier: "frame_decode_only"`

7. **Update docs**: `docs/CLI.md`, `docs/TROUBLESHOOTING.md`, `docs/SURFACE_REFERENCE.md` should mention daemon autostart includes safe default PATH. Existing `media-analysis-dependency-guidance.test.ts` assertions are additive (`toContain`) and will not break.

8. **Commit strategy**: Two atomic commits recommended:
   - Commit 1 (`feat:`): LaunchAgent PATH injection + plist test assertions
   - Commit 2 (`feat:`): Resolver absolute-path fallback + `commonPaths` injection + 5 new resolver tests
   - Both are independent features that solve the same problem from different angles. Splitting them makes review easier and allows either to be reverted independently if issues arise.

## Preventive Measures (Updated)
- Any future host tool that the LaunchAgent daemon needs should be discoverable through the plist PATH or absolute-path fallback.
- The binary resolver should preserve structured error signals (ENOENT) rather than converting to strings too early.
- `resolvedPath` should always be set to the actual spawn path, not just the requested path.
- The `commonPaths` list should be reviewed when adding support for new platforms or package managers.
- Consider a `status-capabilities` diagnostic note when binaries are found via common-path fallback.
- Follow the PM2 precedent: any Node.js daemon that spawns child processes via bare-name PATH lookup should inject `EnvironmentVariables.PATH` in its LaunchAgent plist.
- `ffprobe.ts` and `ffmpeg.ts` should consider accepting `env` in their spawn options for explicit environment control, rather than relying on `process.env` inheritance.

## Investigator Findings: Spawn env propagation

Direct source analysis of `ffprobe.ts`, `ffmpeg.ts`, `analyzer.ts`, and `binaries.ts` addressing the env-passing inconsistency between the binary probe and the actual media-analysis runners.

### Evidence (file:line refs)

- `ffprobe.ts:52` — `spawn(binaryPath, args, { stdio: ["ignore", "pipe", "pipe"] })` — NO `env` option. Inherits `process.env` by default.
- `ffmpeg.ts:146` — `spawn(binaryPath, args, { stdio: ["ignore", "pipe", "ignore"] })` — NO `env` option. Inherits `process.env` by default.
- `binaries.ts:174` — `spawn(binaryPath, [...PROBE_ARGS], { env, stdio: ["ignore", "pipe", "pipe"] })` — DOES pass `env`. The `env` is threaded from `resolveInspiredesignMediaAnalysisBinaries` options (`options.env ?? process.env`, `binaries.ts:61`) through `resolveBinaryStatus` (`binaries.ts:76`) to `probeBinaryVersion` (`binaries.ts:156`) to `runVersionProcess` (`binaries.ts:170`).
- `analyzer.ts:26-27` — `InspiredesignMediaAnalyzerOptions` exposes `ffprobeBinaryPath` and `ffmpegBinaryPath` but NO `env` field. The analyzer does not accept, thread, or forward any env to the runners.
- `analyzer.ts:95` — passes `binaryPath` to `runInspiredesignFfprobe` but no env.
- `analyzer.ts:109` — passes `binaryPath` to `extractInspiredesignFfmpegFrames` but no env.
- `ffprobe.ts:10-12` — `InspiredesignFfprobeRunOptions` type: `{ binaryPath?, timeoutMs? }`. No `env` field.
- `ffmpeg.ts:15-21` — `InspiredesignFfmpegRunOptions` type: `{ binaryPath?, timeoutMs?, maxFrames?, maxWidth?, maxHeight?, metadata? }`. No `env` field.

### Q1: Does this inconsistency matter for the LaunchAgent PATH fix?

**No, not for the primary fix to work.** The LaunchAgent PATH fix injects `EnvironmentVariables.PATH` into the daemon's plist, which sets `process.env.PATH` for the daemon process. Since `ffprobe.ts:52` and `ffmpeg.ts:146` spawn WITHOUT an `env` option, Node's `child_process.spawn` inherits `process.env` by default — so the corrected `process.env.PATH` flows through automatically. The `binaries.ts:174` probe passing `env` explicitly is belt-and-suspenders but produces the same result when `env === process.env`.

The inconsistency is cosmetic for the PATH fix, but it IS a real inconsistency: the binary resolver is explicit and testable (you can pass a stripped env to simulate LaunchAgent conditions), while the analysis runners are implicit and untestable in that dimension.

### Q2: If the plist PATH fix corrects process.env.PATH, do ffprobe.ts and ffmpeg.ts spawns automatically benefit?

**Yes.** Node's `spawn()` with no `env` option uses `process.env` as the child environment. If the daemon's `process.env.PATH` is corrected by the plist `EnvironmentVariables.PATH`, both `ffprobe.ts:52` and `ffmpeg.ts:146` will spawn child processes with the corrected PATH. Bare-name resolution (`"ffprobe"`, `"ffmpeg"`) will find binaries in `/opt/homebrew/bin` and `/usr/local/bin` because the inherited `process.env.PATH` includes them.

This is the key reason the plist fix alone resolves the symptom: the entire process environment is fixed at the source, and all child spawns inherit it.

### Q3: Should ffprobe.ts and ffmpeg.ts accept and pass env for consistency and explicit control?

**Yes, recommended.** Reasons:

1. **Consistency**: `binaries.ts:174` is explicit. The analysis runners should match.
2. **Testability**: The binary probe resolver can be tested with a stripped env (`tests/inspiredesign-media-analysis.test.ts:198` passes `env: { PATH: emptyPathDir }`). The analysis runners CANNOT be tested this way because they hardcode `process.env` inheritance. Adding `env` to `InspiredesignFfprobeRunOptions` and `InspiredesignFfmpegRunOptions` would enable hermetic env tests for the analysis path.
3. **Defense in depth**: If `process.env.PATH` is mutated at runtime (see Q4), explicit env passing protects the analysis runners.
4. **No breaking changes**: Adding an optional `env?: NodeJS.ProcessEnv` to both run options types is additive. The analyzer would default to `process.env` when not provided. Production callers are unchanged.

**Recommended implementation:**
- Add `env?: NodeJS.ProcessEnv` to `InspiredesignFfprobeRunOptions` (`ffprobe.ts:10-12`) and `InspiredesignFfmpegRunOptions` (`ffmpeg.ts:15-21`).
- Pass `env` to spawn: `spawn(binaryPath, args, { env: env ?? process.env, stdio: [...] })`.
- Add `env?: NodeJS.ProcessEnv` to `InspiredesignMediaAnalyzerOptions` (`analyzer.ts:23-29`).
- Thread `options.env` through `runProbe` (`analyzer.ts:80-96`) and `runFrameExtraction` (`analyzer.ts:98-111`) to the runner options.
- Default to `process.env` at the analyzer level so existing callers are unaffected.

### Q4: Is there a risk that process.env.PATH could be modified at runtime after daemon start, breaking the assumption?

**Low but nonzero risk.** `process.env.PATH` is mutable at runtime via:
- `process.env.PATH = "..."` anywhere in the process
- `process.env.PATH` modification by a dependency or plugin
- Node's `--require` or preload hooks

In the opendevbrowser daemon, no code path explicitly mutates `process.env.PATH` after startup (confirmed by grep — no `process.env.PATH =` assignments in `src/`). However, the LaunchAgent PATH fix sets the environment at process start; if something mutates `process.env.PATH` later, the bare-name spawns in `ffprobe.ts` and `ffmpeg.ts` would break because they re-read `process.env` at spawn time.

This is another argument for Q3's recommendation: if the analyzer accepts `env` explicitly (captured at a known point), the runners are insulated from later `process.env` mutations. The binary resolver already has this property because it captures `env` at resolution time (`binaries.ts:61`).

### Q5: Does analyzer.ts pass env through to these runners?

**No.** The analyzer does NOT accept, thread, or forward any `env` to the ffprobe or ffmpeg runners. Confirmed by grep: `analyzer.ts` has zero references to `env`, `process.env`, or `NodeJS.ProcessEnv`. The analyzer options type (`analyzer.ts:23-29`) has `ffprobeBinaryPath` and `ffmpegBinaryPath` but no env field. The runner call sites (`analyzer.ts:95`, `analyzer.ts:109`) pass `binaryPath` and `timeoutMs` only.

This means the analysis runners are a blind spot: even if a caller wanted to inject a specific env (e.g., for testing stripped-PATH conditions), there is no path to do so through the analyzer. The binary probe has this capability; the analysis runners do not.

### Summary

| Question | Answer |
|----------|--------|
| Q1: Inconsistency matters for PATH fix? | No — both paths inherit `process.env`, so the plist fix works regardless |
| Q2: Do analysis spawns benefit from plist PATH fix? | Yes — `spawn()` without `env` inherits `process.env.PATH` automatically |
| Q3: Should runners accept and pass env? | Yes — for consistency, testability, and defense in depth |
| Q4: Risk of runtime process.env.PATH mutation? | Low (no mutations in current code) but explicit env passing eliminates it |
| Q5: Does analyzer pass env through? | No — no env field in analyzer options or runner call sites |

### Recommended Action

Add optional `env` threading from `InspiredesignMediaAnalyzerOptions` through `runProbe`/`runFrameExtraction` to the ffprobe and ffmpeg runner spawn calls. This closes the consistency gap with `binaries.ts:174`, enables hermetic env testing of the analysis path, and insulates against runtime `process.env` mutation. This is a non-breaking additive change.

## Investigator Findings: Postinstall Upgrade Edge Case (2026-06-26 follow-up)

### Critical New Finding: npm upgrade does NOT add PATH to existing healthy plists

**Location:** `src/cli/install-autostart-reconciliation.ts:64-70` and `src/cli/installers/package-postinstall.ts:230-237`

The postinstall reconciliation flow:
1. `reconcileInstallAutostart()` calls `getAutostartStatus()` which calls `classifyMacAutostartStatus()`
2. `classifyMacAutostartStatus()` reads the plist via `readMacLaunchAgentProgramArguments()` which only checks `ProgramArguments` and `WorkingDirectory`
3. If the existing plist has correct node/CLI paths and working directory, it reports `health: "healthy"`
4. `reconcileInstallAutostart()` returns `{ autostartAction: "already_healthy" }` WITHOUT calling `installAutostart()`
5. `convertNonFailingReconciliationResult()` creates a skip result: "Postinstall autostart already healthy."
6. The plist is NOT overwritten -- `EnvironmentVariables.PATH` is never added

**Impact:** When a user upgrades from an older version (e.g., 0.0.36) to a newer version that includes the PATH fix, the existing plist stays unchanged. The daemon continues running with the old stripped PATH. FFmpeg/FFprobe remain undiscoverable until the user manually runs `opendevbrowser daemon install` or `opendevbrowser daemon uninstall && opendevbrowser daemon install`.

**This contradicts the prior report's claim:** "The PATH will be added on next daemon install or package postinstall." The package postinstall skips healthy plists.

**Fix options:**
1. **Add EnvironmentVariables.PATH check to reconciliation** -- `readMacLaunchAgentProgramArguments()` should also read `EnvironmentVariables` and `classifyMacAutostartStatus()` should report `needs_repair` if PATH is missing. This triggers plist overwrite on next postinstall.
2. **Always overwrite plist during postinstall** -- skip the health check for plist structure changes. Simpler but more aggressive.
3. **Version marker in plist** -- add a comment or metadata key indicating plist schema version. Reconciliation checks version and repairs if outdated.

**Recommended:** Option 1 is the safest. It adds a targeted check for `EnvironmentVariables.PATH` without changing the overall reconciliation flow. The check should only flag `needs_repair` when `EnvironmentVariables` is entirely absent OR when `EnvironmentVariables.PATH` is missing. Existing plists with `EnvironmentVariables` but a different PATH value should stay healthy (user may have customized it).

## Investigator Findings: MacPorts /opt/local/bin Coverage Gap

**Location:** `docs/investigations/ffmpeg-launchagent-path-deep-2026-06-26.md:584`

The prior report lists common paths for macOS as:
- `/opt/homebrew/bin` (Apple Silicon Homebrew)
- `/usr/local/bin` (Intel Homebrew, MacPorts)
- `/usr/bin` (system)

**Gap:** MacPorts installs to `/opt/local/bin`, NOT `/usr/local/bin`. The label "Intel Homebrew, MacPorts" is incorrect for MacPorts. MacPorts is a separate package manager with its own prefix (`/opt/local`).

**Fix:** Both the `MAC_LAUNCH_AGENT_DEFAULT_PATH` constant and the resolver common-paths list should include `/opt/local/bin`:

```text
MAC_LAUNCH_AGENT_DEFAULT_PATH = "/opt/homebrew/bin:/opt/local/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
```

And the macOS common-paths list for the resolver fallback:
- `/opt/homebrew/bin/{ffmpeg,ffprobe}` (Apple Silicon Homebrew)
- `/opt/local/bin/{ffmpeg,ffprobe}` (MacPorts)
- `/usr/local/bin/{ffmpeg,ffprobe}` (Intel Homebrew, manual installs)
- `/usr/bin/{ffmpeg,ffprobe}` (system)

**Nix package manager:** Nix installs to `/nix/store/...` with hash-based paths that cannot be statically enumerated. Nix users typically add `/run/current-system/sw/bin` or `~/.nix-profile/bin` to their shell PATH. Since these paths are user-specific and hash-based, they cannot be included in a hardcoded fallback list. The plist PATH fix handles Nix users correctly as long as they have Nix's profile bin in their shell PATH -- but since launchd doesn't inherit shell PATH, Nix users would need to set `OPENDEVBROWSER_FFMPEG_PATH` explicitly. This is an acceptable limitation since Nix is a niche package manager and its paths are not deterministic.

## Investigator Findings: Spawn env propagation

*(Appended by pair investigator agent EE2EE94E)*

1. **Inconsistency does not matter for plist PATH fix:** Both probe (`binaries.ts:174`, passes `env`) and analysis runners (`ffprobe.ts:52`, `ffmpeg.ts:146`, inherit `process.env`) resolve to the same environment when `env === process.env`. The plist PATH fix corrects `process.env.PATH` at the daemon level.

2. **Analysis spawns benefit from plist fix:** `spawn()` without `env` uses `process.env`. Once daemon PATH includes Homebrew paths, bare-name spawns find binaries.

3. **Recommend runners accept env:** Closes consistency gap, enables hermetic env testing, provides defense in depth against runtime `process.env` mutation. Additive and non-breaking.

4. **No runtime PATH mutation risk:** No code in `src/` mutates `process.env.PATH` after startup. Explicit env capture eliminates even theoretical risk.

5. **analyzer.ts has no env control:** Zero references to `env` or `process.env`. Analysis runners are a blind spot for env control. Adding `env` to analyzer options would close this gap.

## Updated Recommendations (2026-06-26 follow-up)

The prior recommendations (items 1-8) remain valid. Add the following:

9. **Add `/opt/local/bin` to both `MAC_LAUNCH_AGENT_DEFAULT_PATH` and resolver common-paths** for MacPorts coverage. The full PATH constant should be `/opt/homebrew/bin:/opt/local/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`.

10. **Add EnvironmentVariables.PATH check to daemon reconciliation** in `src/cli/daemon-autostart.ts` `readMacLaunchAgentProgramArguments()` and `classifyMacAutostartStatus()`. When `EnvironmentVariables` is absent or `EnvironmentVariables.PATH` is missing, report `needs_repair` so postinstall upgrades overwrite the old plist. This ensures npm package upgrades fix the PATH for existing installations, not just fresh installs.

11. **Consider adding `env` to analyzer runner options** in `src/inspiredesign/media-analysis/ffprobe.ts` and `ffmpeg.ts` for consistency with `binaries.ts:174`. This is lower priority but closes the architectural gap.

12. **Nix users need explicit env/config paths** since Nix store paths are hash-based and cannot be statically enumerated. Document this in `docs/TROUBLESHOOTING.md`.

## Investigator Findings: MacPorts/Nix path coverage

### Date: 2026-06-26 (follow-up path-coverage audit)

### Correcting the prior report's MacPorts labeling

The prior report at line 584 labels `/usr/local/bin/{ffmpeg,ffprobe}` as "(Intel Homebrew, MacPorts)". This is **incorrect**. MacPorts installs all binaries under `/opt/local/bin`, not `/usr/local/bin`. The `/usr/local/bin` path is used by Intel Homebrew, manual builds, and some other tools, but **not MacPorts**.

**Evidence:**
- MacPorts installation guide (`https://guide.macports.org/#installing`): "to install it to /opt/local/, the default MacPorts location" and "export PATH=/opt/local/bin:/opt/local/sbin:$PATH"
- Wikipedia (Fink article, `https://en.wikipedia.org/wiki/Fink_(software)`): "MacPorts, another macOS package manager, follows a similar approach by storing its data in /opt/local by default."

### (1) What path does MacPorts install FFmpeg to on macOS?

**Answer: `/opt/local/bin/ffmpeg` and `/opt/local/bin/ffprobe`**

MacPorts uses `/opt/local` as its default prefix. All user binaries are installed to `/opt/local/bin`. The MacPorts installation guide instructs users to add `/opt/local/bin:/opt/local/sbin` to their PATH:
```
export PATH=/opt/local/bin:/opt/local/sbin:$PATH
```

**Evidence:** MacPorts Guide (`https://guide.macports.org/#installing`), section on environment variables.

### (2) What about Nix package manager paths?

**Answer: Nix uses per-user and system profile symlinks, not fixed absolute paths. The relevant PATH entries are:**

- **System profile (multi-user):** `/nix/var/nix/profiles/default/bin` (the `@localstatedir@/nix/profiles/default/bin` template variable defaults to `/nix/var` per the Nix build system)
- **User profile (legacy):** `$HOME/.nix-profile/bin` (symlink to the current user environment)
- **User profile (new, XDG):** `$HOME/.local/state/nix/profile/bin` (when `XDG_STATE_HOME` is set or the new-style profile exists)

The Nix `nix-profile-daemon.sh.in` script (`https://raw.githubusercontent.com/NixOS/nix/master/scripts/nix-profile-daemon.sh.in`) sets:
```sh
export NIX_PROFILES="@localstatedir@/nix/profiles/default $NIX_LINK"
export PATH="$NIX_LINK/bin:@localstatedir@/nix/profiles/default/bin:$PATH"
```

The Determinate Systems nix-installer (`https://raw.githubusercontent.com/DeterminateSystems/nix-installer/main/src/action/common/configure_shell_profile.rs`) writes `/nix/var/nix/profiles/default/bin` to shell profiles and, on macOS for GitHub Actions, writes `/Users/{user}/.nix-profile/bin` to `$GITHUB_PATH`.

**Key constraint:** Nix profile paths are **per-user** (they contain `$HOME` or a user-specific XDG state dir) or use a symlinked system profile at `/nix/var/nix/profiles/default/bin`. The `/nix/var/nix/profiles/default/bin` path is a stable absolute path that can be probed. The `$HOME/.nix-profile/bin` path requires knowing `$HOME` at probe time (which the daemon already has via `homedir()`).

**Evidence:**
- Nix manual (`https://nix.dev/manual/nix/2.24/installation/env-variables`): "PATH should contain the directories prefix/bin and ~/.nix-profile/bin"
- Nix source (`scripts/nix-profile-daemon.sh.in`): `export PATH="$NIX_LINK/bin:@localstatedir@/nix/profiles/default/bin:$PATH"`
- Determinate Systems nix-installer source: `PROFILE_NIX_FILE_SHELL = "/nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh"`

### (3) Should the MAC_LAUNCH_AGENT_DEFAULT_PATH constant include /opt/local/bin?

**Answer: YES.**

The proposed constant (not yet implemented) at `src/cli/daemon-autostart.ts` currently recommends:
```
/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
```

This covers Homebrew (both Apple Silicon and Intel) and system paths, but **misses MacPorts** (`/opt/local/bin`) and **Nix system profile** (`/nix/var/nix/profiles/default/bin`).

**Recommended updated constant:**
```
/opt/homebrew/bin:/opt/local/bin:/usr/local/bin:/nix/var/nix/profiles/default/bin:/usr/bin:/bin:/usr/sbin:/sbin
```

Rationale:
- `/opt/homebrew/bin` - Apple Silicon Homebrew
- `/opt/local/bin` - MacPorts (correcting the prior report's error)
- `/usr/local/bin` - Intel Homebrew and manual builds (NOT MacPorts)
- `/nix/var/nix/profiles/default/bin` - Nix multi-user system profile (stable absolute path, does not require `$HOME`)
- `/usr/bin:/bin:/usr/sbin:/sbin` - system defaults (already in launchd's `_PATH_STDPATH`)

The Nix user profile path (`$HOME/.nix-profile/bin`) cannot be included in a static PATH constant because it requires `$HOME` interpolation. However, the Nix system profile at `/nix/var/nix/profiles/default/bin` is a fixed absolute path that covers multi-user Nix installations (the most common modern Nix setup via the Determinate Systems installer).

**File:line ref:** The constant would be declared at `src/cli/daemon-autostart.ts` near the existing `MAC_LABEL` constant at line 7-9. The `buildLaunchAgentPlist()` function at line 197-233 would insert the `EnvironmentVariables` block.

### (4) Should the resolver commonPaths list include /opt/local/bin/ffmpeg?

**Answer: YES.**

The proposed `commonPaths` list (not yet implemented) at `src/inspiredesign/media-analysis/binaries.ts` currently recommends for macOS:
- `/opt/homebrew/bin/ffmpeg`, `/usr/local/bin/ffmpeg`, `/usr/bin/ffmpeg`

This misses MacPorts and Nix. The recommended updated macOS list:
- `/opt/homebrew/bin/{ffmpeg,ffprobe}` (Apple Silicon Homebrew)
- `/opt/local/bin/{ffmpeg,ffprobe}` (MacPorts)
- `/usr/local/bin/{ffmpeg,ffprobe}` (Intel Homebrew, manual builds)
- `/nix/var/nix/profiles/default/bin/{ffmpeg,ffprobe}` (Nix multi-user system profile)
- `/usr/bin/{ffmpeg,ffprobe}` (system, rarely present but harmless to probe)

Nix user-profile paths (`$HOME/.nix-profile/bin/ffmpeg`) can also be included by computing `join(homedir(), ".nix-profile", "bin", tool)` at runtime, but the system profile path is more broadly applicable and does not require `homedir()`.

**File:line ref:** `src/inspiredesign/media-analysis/binaries.ts` - the `commonPaths` option would be added to `InspiredesignMediaAnalysisBinaryResolverOptions` at line 22-26, and the platform-aware default list would be generated by a new `defaultCommonPathsForTool()` function. The fallback would be invoked from `resolveBinaryStatus()` at line 78-95.

### (5) Other macOS package managers with non-standard paths

**Identified:**

| Package Manager | Binary Path | Status |
|-----------------|------------|--------|
| Homebrew (Apple Silicon) | `/opt/homebrew/bin` | Already covered |
| Homebrew (Intel) | `/usr/local/bin` | Already covered |
| **MacPorts** | **`/opt/local/bin`** | **MISSING - needs adding** |
| **Nix (multi-user system profile)** | **`/nix/var/nix/profiles/default/bin`** | **MISSING - needs adding** |
| **Nix (per-user legacy profile)** | `$HOME/.nix-profile/bin` | Cannot be in static PATH; can be in dynamic `commonPaths` via `homedir()` |
| **Nix (per-user XDG profile)** | `$HOME/.local/state/nix/profile/bin` | Same as above; XDG variant |
| **Fink** | `/sw/bin` (macOS <= 10.14) or `/opt/sw/bin` (macOS >= 10.15) | **OPTIONAL - Fink is effectively unmaintained** |

**Fink assessment:** Fink (`https://en.wikipedia.org/wiki/Fink_(software)`) stores binaries in `/sw/bin` (older macOS) or `/opt/sw/bin` (newer macOS). Fink has been largely dormant for years and is not a practical concern for FFmpeg installation in 2026. Adding Fink paths would add probe overhead for negligible benefit. **Recommendation: do NOT include Fink paths.**

**Nix user-profile dynamic path:** If the `commonPaths` list is generated at runtime (via `defaultCommonPathsForTool(tool, platform)`), the Nix user-profile path can be computed as `join(homedir(), ".nix-profile", "bin", tool)`. This covers single-user Nix installations and users who haven't set up the system profile. The `homedir()` function from `node:os` is already imported at `src/cli/daemon-autostart.ts:4` but would need to be imported in `binaries.ts` if dynamic paths are used. Alternatively, the Nix system profile path (`/nix/var/nix/profiles/default/bin/{ffmpeg,ffprobe}`) is a fixed string that covers the most common modern Nix setup without requiring `homedir()`.

### Summary of corrections and additions needed

1. **Correct the prior report:** Line 584 of this document incorrectly labels `/usr/local/bin` as "(Intel Homebrew, MacPorts)". MacPorts uses `/opt/local/bin`. The correct labeling is "(Intel Homebrew, manual builds)".

2. **Add `/opt/local/bin` to `MAC_LAUNCH_AGENT_DEFAULT_PATH`:** The proposed constant should be `/opt/homebrew/bin:/opt/local/bin:/usr/local/bin:/nix/var/nix/profiles/default/bin:/usr/bin:/bin:/usr/sbin:/sbin`.

3. **Add `/opt/local/bin/{ffmpeg,ffprobe}` to macOS `commonPaths`:** MacPorts FFmpeg installs to `/opt/local/bin`.

4. **Add `/nix/var/nix/profiles/default/bin/{ffmpeg,ffprobe}` to macOS `commonPaths`:** Nix multi-user system profile is a stable absolute path.

5. **Optionally add `$HOME/.nix-profile/bin/{ffmpeg,ffprobe}` to macOS `commonPaths`:** Computed at runtime via `homedir()` for single-user Nix installations. Lower priority than the system profile path.

6. **Do NOT add Fink paths:** `/sw/bin` and `/opt/sw/bin` are from an effectively unmaintained package manager. Negligible benefit, adds probe overhead.

7. **Security note:** Adding `/opt/local/bin` and `/nix/var/nix/profiles/default/bin` to the PATH constant and commonPaths list follows the same trust model as the existing Homebrew paths. An attacker who can write to `/opt/local/bin` or `/nix/var/nix/profiles/default/bin` already has package-manager-level access, which is equivalent to the trust level of `/opt/homebrew/bin` and `/usr/local/bin`. No security regression.

### File:line references

| Location | Current state | Required change |
|----------|--------------|-----------------|
| `docs/investigations/ffmpeg-launchagent-path-deep-2026-06-26.md:584` | Labels `/usr/local/bin` as "(Intel Homebrew, MacPorts)" | Correct to "(Intel Homebrew, manual builds)"; add MacPorts line for `/opt/local/bin` |
| `src/cli/daemon-autostart.ts:7-9` (constants block) | No `MAC_LAUNCH_AGENT_DEFAULT_PATH` constant | Add constant including `/opt/local/bin` and `/nix/var/nix/profiles/default/bin` |
| `src/cli/daemon-autostart.ts:197-233` (`buildLaunchAgentPlist`) | No `EnvironmentVariables` block | Add EnvironmentVariables with corrected PATH |
| `src/inspiredesign/media-analysis/binaries.ts:22-26` (options type) | No `commonPaths` option | Add `commonPaths?: readonly string[]` |
| `src/inspiredesign/media-analysis/binaries.ts:78-95` (`resolveBinaryStatus`) | No fallback logic | Add fallback with `/opt/local/bin` and Nix system profile in path list |
| `tests/daemon-autostart.test.ts:240-256` | No PATH assertions | Add assertions for `/opt/local/bin` and `/nix/var/nix/profiles/default/bin` |

### External evidence sources

1. MacPorts Guide - `https://guide.macports.org/#installing`: Confirms `/opt/local` as default prefix, `/opt/local/bin` for binaries
2. Nix Manual 2.24 - `https://nix.dev/manual/nix/2.24/installation/env-variables`: "PATH should contain the directories prefix/bin and ~/.nix-profile/bin"
3. Nix source `scripts/nix-profile-daemon.sh.in` - `https://raw.githubusercontent.com/NixOS/nix/master/scripts/nix-profile-daemon.sh.in`: `export PATH="$NIX_LINK/bin:@localstatedir@/nix/profiles/default/bin:$PATH"` where `@localstatedir@` = `/nix/var`
4. Determinate Systems nix-installer `src/action/common/configure_shell_profile.rs` - `https://raw.githubusercontent.com/DeterminateSystems/nix-installer/main/src/action/common/configure_shell_profile.rs`: `PROFILE_NIX_FILE_SHELL = "/nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh"`, writes `/nix/var/nix/profiles/default/bin` to shell profiles
5. Wikipedia - Fink - `https://en.wikipedia.org/wiki/Fink_(software)`: "Fink stores all its data in the directory /opt/sw for newer macOS releases and /sw for macOS 10.14 and earlier"; "MacPorts, another macOS package manager, follows a similar approach by storing its data in /opt/local by default"

## Investigator Findings: Postinstall upgrade edge cases

This section traces the postinstall flow when upgrading from an old plist (without `EnvironmentVariables`) to a new plist (with `EnvironmentVariables.PATH`). All file:line references verified against current source.

### Q1: Does package-postinstall.ts call installMacAutostart() which overwrites the plist?

**Only if the existing plist is classified as unhealthy. If the old plist has correct ProgramArguments and WorkingDirectory, it does NOT overwrite.**

Call chain:
1. `runPackagePostinstall()` at `src/cli/installers/package-postinstall.ts:307` calls `runPackageAutostartPostinstall()` at line 308.
2. `runPackageAutostartPostinstall()` at `src/cli/installers/package-postinstall.ts:263` calls `reconcileInstallAutostart()` at line 291 with `{ success: true, alreadyInstalled: true }`.
3. `reconcileInstallAutostart()` at `src/cli/install-autostart-reconciliation.ts:48` calls `resolved.getAutostartStatus()` at line 58.
4. If `status.health === "healthy"` at `src/cli/install-autostart-reconciliation.ts:68`, reconciliation returns `{ attempted: false, autostartAction: "already_healthy" }` at line 71-74. **`installAutostart()` is never called.**
5. If health is `"missing"`, `"needs_repair"`, or `"malformed"` (line 76), `resolved.installAutostart()` is called at line 84, which routes to `installMacAutostart()` at `src/cli/daemon-autostart.ts:521`.
6. `installMacAutostart()` calls `writeFileSync(plistPath, buildLaunchAgentPlist(...))` at `src/cli/daemon-autostart.ts:534`, overwriting the plist.

**Critical gap for this upgrade scenario:** `classifyMacAutostartStatus()` at `src/cli/daemon-autostart.ts:393` checks only `ProgramArguments` (via `readMacLaunchAgentProgramArguments()` at line 363, which reads only `ProgramArguments` and `WorkingDirectory`), `WorkingDirectory` match, and `pathIsDirectory`. It never reads or checks `EnvironmentVariables`. An old plist with correct node path, CLI path, `serve` arg, and correct working directory reports `health: "healthy"` even though it lacks `EnvironmentVariables.PATH`. Therefore, on upgrade from old plist to new plist code, the postinstall reconciliation returns `"already_healthy"` and does NOT overwrite the plist. The old plist without PATH stays in place until the user manually runs `opendevbrowser daemon install` or the plist is deleted/corrupted.

### Q2: Does reconcileInstallAutostart() detect the missing EnvironmentVariables and trigger repair?

**No.** `reconcileInstallAutostart()` at `src/cli/install-autostart-reconciliation.ts:48` delegates health classification entirely to `getAutostartStatus()` at line 58, which calls `classifyMacAutostartStatus()` at `src/cli/daemon-autostart.ts:393`. The classification function reads the plist via `readMacLaunchAgentProgramArguments()` at line 363-392, which uses `plutil -convert json` and extracts only `ProgramArguments` and `WorkingDirectory` from the parsed JSON (lines 373-389). `EnvironmentVariables` is never read, parsed, or compared. There is no `AutostartReason` value for missing environment variables. The `AutostartHealth` type at line 33 has no `"needs_env_repair"` variant. An old plist without `EnvironmentVariables` but with valid `ProgramArguments` and `WorkingDirectory` is classified as `"healthy"` at `src/cli/daemon-autostart.ts:470-477`.

This is consistent with Recommendation 5 in the existing report: "Do not add reconciliation check for EnvironmentVariables." However, it means the upgrade path from old plist to new plist is not automatic through postinstall alone.

### Q3: What happens if the daemon is running when the plist is updated - does launchctl kickstart -k restart it with the new env?

**Yes, when `installMacAutostart()` runs successfully.** The sequence in `installMacAutostart()` at `src/cli/daemon-autostart.ts:521-555` is:

1. `writeFileSync(plistPath, ...)` at line 534: writes the new plist (with `EnvironmentVariables.PATH`) to disk.
2. `launchctl bootout gui/${uid} ${plistPath}` at line 541 with `ignoreFailure=true`: unloads the old job, stopping the running daemon. Failure is silently ignored (e.g., if the job is not currently loaded).
3. `launchctl bootstrap gui/${uid} ${plistPath}` at line 542 with `ignoreFailure=false`: loads the new plist into launchd. With `RunAtLoad=true` and `KeepAlive=true` in the plist, the daemon starts with the new `EnvironmentVariables.PATH`. Failure throws.
4. `launchctl enable gui/${uid}/${MAC_LABEL}` at line 543 with `ignoreFailure=true`: enables the service. Failure silently ignored.
5. `launchctl kickstart -k gui/${uid}/${MAC_LABEL}` at line 544 with `ignoreFailure=true`: force-restarts the service, ensuring it picks up the new plist configuration including `EnvironmentVariables.PATH`. The `-k` flag kills the running instance before restarting. Failure silently ignored.

The `kickstart -k` at line 544 is belt-and-suspenders: `bootstrap` at line 542 already starts the daemon with the new plist (due to `RunAtLoad=true`), and `kickstart -k` ensures a clean restart even if the daemon was already running from the bootstrap. The new daemon process inherits `EnvironmentVariables.PATH` from the plist.

### Q4: Is there a window where the old daemon is still running with the old PATH after plist update but before kickstart?

**Yes, there are two windows, but both are narrow and mitigated:**

**Window 1 (writeFileSync to bootout):** Between `writeFileSync` at line 534 and `bootout` at line 541, the new plist is on disk but the old daemon is still running with the old (stripped) PATH. This window is sub-second (two synchronous calls in sequence). During this window, any FFmpeg/FFprobe spawn by the running daemon would still use the old PATH. This is not a practical concern because the daemon is about to be killed.

**Window 2 (bootout to bootstrap):** Between `bootout` at line 541 and `bootstrap` at line 542, the daemon is stopped. No daemon is running. This is the intended state: the old daemon is unloaded before the new one is loaded.

**Window 3 (bootstrap to kickstart):** Between `bootstrap` at line 542 and `kickstart -k` at line 544, the new daemon may have already started (due to `RunAtLoad=true` in the plist). `kickstart -k` kills and restarts it. If the daemon started from `bootstrap` and is serving requests with the new PATH, `kickstart -k` causes a brief interruption. If `bootstrap` did not start the daemon for some reason, `kickstart -k` starts it. Either way, after `kickstart -k`, the daemon has the new PATH.

**Edge case: bootout fails silently.** If `bootout` at line 541 fails (ignoreFailure=true, error swallowed), the old daemon is still running with old PATH. Then `bootstrap` at line 542 attempts to load the plist, which may fail with "already loaded" or similar. Since `bootstrap` has `ignoreFailure=false`, it throws, and the error propagates to `reconcileInstallAutostart()` catch block at `src/cli/install-autostart-reconciliation.ts:89`, returning `autostartAction: "repair_failed"`. The postinstall result has `success: false` but npm install does not crash. The plist file on disk is new, but the running daemon still has old config. The daemon will pick up the new plist on next reboot or manual `launchctl bootout` + `bootstrap`.

### Q5: Could the postinstall fail silently if launchctl commands fail, leaving the old plist in place?

**The plist file is always overwritten before any launchctl command runs, so the old plist is NOT left in place on disk. However, the running daemon may retain old config, and some launchctl failures are silently ignored.**

Detailed failure analysis of `installMacAutostart()` at `src/cli/daemon-autostart.ts:521-555`:

1. `writeFileSync` at line 534: **Always runs before launchctl commands.** If this fails (e.g., disk full, permissions), it throws and propagates to `reconcileInstallAutostart()` catch at `src/cli/install-autostart-reconciliation.ts:89`, returning `repair_failed`. The old plist remains on disk. This is the only case where the old plist is truly "left in place."

2. `bootout` at line 541 with `ignoreFailure=true`: **Failure is silently ignored.** If the daemon is not loaded, this is expected. If it fails for another reason (e.g., launchctl malfunction), the old daemon keeps running.

3. `bootstrap` at line 542 with `ignoreFailure=false`: **Failure throws.** The error propagates to `reconcileInstallAutostart()` catch at `src/cli/install-autostart-reconciliation.ts:89`. The postinstall result is `repair_failed` with `success: false`. The plist on disk is new, but the running daemon has old config. This is NOT silent: the failure is reported in the postinstall result warnings.

4. `enable` at line 543 with `ignoreFailure=true`: **Failure is silently ignored.** If `enable` fails, the service is loaded but not enabled. It may not start automatically. This is silent.

5. `kickstart -k` at line 544 with `ignoreFailure=true`: **Failure is silently ignored.** If `kickstart` fails, the daemon may or may not be running (depending on whether `bootstrap` started it via `RunAtLoad`). This is silent. The daemon might be running with the new plist but was not explicitly restarted.

**Summary of silent failure paths:**
- `bootout` failure: silent, old daemon may keep running.
- `enable` failure: silent, service may not auto-start.
- `kickstart -k` failure: silent, daemon may not be force-restarted.
- `bootstrap` failure: NOT silent, throws and is caught as `repair_failed`.
- `writeFileSync` failure: NOT silent, throws and is caught as `repair_failed`.

**The plist file on disk is always updated (new content with `EnvironmentVariables.PATH`) unless `writeFileSync` itself fails.** The risk is not "old plist left in place" but "running daemon not restarted with new config." On next reboot, launchd loads the new plist from disk, and the daemon starts with the correct PATH.

**Postinstall result propagation:** In `runPackagePostinstall()` at `src/cli/installers/package-postinstall.ts:307`, `autostart.success` is included in the overall `success` at line 310. If `installMacAutostart` throws (bootstrap failure), `convertReconciliationResult()` at line 201 returns `success: false` with warnings. The postinstall result has `success: false` and the warning message. npm postinstall scripts do not fail the install based on non-zero exit unless the script itself exits non-zero; the `runPackagePostinstall` function returns a result object but the actual postinstall script entry point would need to check `success` and exit non-zero to fail the install. The function does not throw; it returns a structured result. Whether the npm install fails depends on the caller of `runPackagePostinstall`.


## Investigator Findings: MacPorts and Nix Path Coverage (Pair Agent F4D5C4CC)

*(Appended by pair investigator agent)*

**Confirmed:** The prior report at line 584 incorrectly labels `/usr/local/bin` as "(Intel Homebrew, MacPorts)". MacPorts uses `/opt/local` as its default prefix, not `/usr/local`.

**Updated path recommendations:**

`MAC_LAUNCH_AGENT_DEFAULT_PATH` should be:
```text
/opt/homebrew/bin:/opt/local/bin:/usr/local/bin:/nix/var/nix/profiles/default/bin:/usr/bin:/bin:/usr/sbin:/sbin
```

macOS resolver common-paths should include:
- `/opt/homebrew/bin/{ffmpeg,ffprobe}` (Apple Silicon Homebrew)
- `/opt/local/bin/{ffmpeg,ffprobe}` (MacPorts)
- `/usr/local/bin/{ffmpeg,ffprobe}` (Intel Homebrew, manual installs)
- `/nix/var/nix/profiles/default/bin/{ffmpeg,ffprobe}` (Nix multi-user system profile)
- `/usr/bin/{ffmpeg,ffprobe}` (system)

**Nix coverage:** Nix multi-user installs have a stable system profile at `/nix/var/nix/profiles/default/bin`. Per-user Nix paths require `$HOME` interpolation and cannot be statically enumerated. Including the system profile path covers the common Nix case. Fink is effectively unmaintained and not worth adding.

## Investigator Findings: Postinstall Upgrade Edge Cases (Pair Agent 0AD9A590)

*(Appended by pair investigator agent)*

**Confirmed:** npm upgrade does NOT add PATH to existing healthy plists. `reconcileInstallAutostart()` at `install-autostart-reconciliation.ts:68` returns `"already_healthy"` when plist has correct ProgramArguments + WorkingDirectory, skipping `installAutostart()` entirely.

**Additional edge cases found:**

1. **Bootout failure window:** `installMacAutostart()` at `daemon-autostart.ts:541` runs `bootout` with `ignoreFailure=true`. If bootout fails silently (e.g., old daemon already stopped), the old daemon may keep running with old PATH. The new plist is on disk but the running daemon hasn't loaded it. Next reboot fixes this.

2. **Kickstart failure:** `kickstart -k` at line 544 also uses `ignoreFailure=true`. If kickstart fails, the daemon is not force-restarted. The new plist is loaded but the daemon may not pick up the new env until next launchd load.

3. **bootstrap failure is NOT silent:** `bootstrap` at line 542 uses `ignoreFailure=false`, so it throws on failure and is caught as `repair_failed`. This is correct.

**Fix recommendation for postinstall upgrade:** Add `EnvironmentVariables.PATH` presence check to `readMacLaunchAgentProgramArguments()` and `classifyMacAutostartStatus()`. When `EnvironmentVariables` is absent or `PATH` key is missing, report `needs_repair` with a new reason like `missing_environment_path`. This triggers plist overwrite on next postinstall upgrade.

## Final Updated Path Constant (2026-06-26)

```text
/opt/homebrew/bin:/opt/local/bin:/usr/local/bin:/nix/var/nix/profiles/default/bin:/usr/bin:/bin:/usr/sbin:/sbin
```

This covers:
- Apple Silicon Homebrew (`/opt/homebrew/bin`)
- MacPorts (`/opt/local/bin`)
- Intel Homebrew and manual installs (`/usr/local/bin`)
- Nix multi-user system profile (`/nix/var/nix/profiles/default/bin`)
- Standard macOS system paths (`/usr/bin`, `/bin`, `/usr/sbin`, `/sbin`)
