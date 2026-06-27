# Investigation: FFmpeg/FFprobe LaunchAgent PATH Detection Failure (Deep Dive)

## Summary
Deeper investigation beyond the 2026-06-23 report, focusing on analyzer binary path propagation, daemon IPC env isolation, cross-platform PATH coverage gaps (MacPorts/Nix), postinstall hook behavior, and spawn env edge cases.

## Symptoms
- macOS LaunchAgent daemon starts with minimal PATH (`/usr/bin:/bin:/usr/sbin:/sbin`), excluding `/opt/homebrew/bin` and `/usr/local/bin`
- `status-capabilities` from installed global daemon (v0.0.36) does not show `host.mediaAnalysis` diagnostics
- Current branch daemon with stripped launchd-like PATH reports both binaries unavailable
- Interactive shell finds FFmpeg/FFprobe at `/usr/local/bin`
- Adding `/opt/homebrew/bin:/usr/local/bin` to daemon PATH makes detection pass

## Background / Prior Research
<!-- To be populated by Phase 1.5 explore agents -->

## Investigator Findings
<!-- To be populated by pair investigator -->

## Investigation Log

### Phase 1 - Initial Assessment
**Hypothesis:** Prior investigation identified two root causes (plist omits PATH, resolver has no absolute-path fallback). Deep dive will verify analyzer binary path propagation, daemon IPC env isolation, cross-platform PATH coverage, and spawn env edge cases.
**Findings:** In progress
**Evidence:** Prior report at `docs/investigations/ffmpeg-launchagent-path-detection-2026-06-23.md`
**Conclusion:** In progress

## Root Cause
<!-- To be finalized -->

## Recommendations
<!-- To be finalized -->

## Preventive Measures
<!-- To be finalized -->
