# Investigation: npm 0.0.18 parity and consumer install drift

Status: historical post-release audit  
Last updated: 2026-04-13

## Summary

`opendevbrowser@0.0.18` on npm is not an older implementation than the release-aligned local source that was investigated. At that investigation point, the published tarball and the local packed tarball were identical. The current worktree can move ahead after that snapshot. The perceived mismatch came from two real gaps:

- release proof stopped at local tarball validation instead of a true post-publish registry-consumer smoke
- published consumers can resolve a different direct dependency graph than the local lockfile because `package.json` uses caret ranges

The earlier `ERR_MODULE_NOT_FOUND` signal was not reproduced from a fresh consumer install or an isolated serial `npx --package` run.

## Symptoms

- npm was reported as showing a different implementation than local source
- earlier ephemeral `npx` runs failed with missing-module errors involving `zod/v3/external.js` and later `ws`
- local source, help output, and live headed replay behaved correctly

## Investigation log

### Published artifact versus local pack
**Hypothesis:** npm published a stale or different tarball.  
**Findings:** the published tarball and the release-aligned local packed tarball used during the investigation were byte-identical.  
**Evidence:** both tarballs resolved to SHA1 `9860b7ad5ca383684d922459df22a399b5f2b4a1` and both contained `919` files.  
**Conclusion:** eliminated. The npm tarball itself was not stale relative to the release-aligned local source used for the parity check.

### Fresh registry consumer install
**Hypothesis:** a clean consumer install from npm still reproduces the mismatch.  
**Findings:** a fresh temp-workspace install succeeded; `--help` printed `590` lines, `help` matched, and `version` returned `opendevbrowser v0.0.18`.  
**Evidence:** isolated temp install of `opendevbrowser@0.0.18`, direct bin execution, and identical help output counts.  
**Conclusion:** eliminated. The shipped package is functional on a clean install path.

### Isolated `npx --package` execution
**Hypothesis:** the published package is broken specifically for ephemeral execution.  
**Findings:** a serial `npx --yes --package opendevbrowser@0.0.18 opendevbrowser --help` run with a fresh npm cache succeeded.  
**Evidence:** isolated temp cache run completed and printed the expected `Find It Fast` output.  
**Conclusion:** unconfirmed as a package defect. The earlier failure is more consistent with transient `_npx` sandbox corruption or partial install state.

### Consumer dependency graph drift
**Hypothesis:** npm consumers can resolve a different runtime graph than the local lockfile.  
**Findings:** the fresh consumer install resolved `@opencode-ai/plugin@1.4.3` and `ws@8.20.0`, while the local lockfile resolves `@opencode-ai/plugin@1.2.25` and `ws@8.19.0`. Top-level `zod` stayed on `3.25.76`, and the nested plugin still resolved `zod@4.1.8`.  
**Evidence:** `package.json` publishes caret ranges; fresh `npm ls opendevbrowser @opencode-ai/plugin ws zod --all --json` differed from `package-lock.json`.  
**Conclusion:** confirmed. This is a real alignment risk even when the tarball itself is correct.

### Release-process validation gap
**Hypothesis:** release automation already proves the real npm consumer path.  
**Findings:** the release workflow and runbooks validated repo-local gates, `npm pack`, and local onboarding, but not a post-publish registry install.  
**Evidence:** `.github/workflows/release-public.yml`, `docs/RELEASE_RUNBOOK.md`, `docs/DISTRIBUTION_PLAN.md`, and `docs/FIRST_RUN_ONBOARDING.md` were local-artifact-first before this fix.  
**Conclusion:** confirmed. This is the main reason the earlier npm mismatch report was hard to classify quickly.

## Root cause

The npm package did not diverge from the release-aligned local source used during the parity check. The root cause was process and evidence drift:

1. release validation proved the source tree and local tarball, not the published registry-consumer path
2. the published package contract allowed direct dependency drift because consumers are not bound to the local lockfile
3. a prior `_npx` sandbox failure was misread as a published-package mismatch because there was no first-class registry smoke lane to close the loop quickly

## Recommendations

1. Add a post-publish registry-consumer smoke lane that installs `opendevbrowser@<version>` in a fresh temp workspace, verifies `--help`, `help`, `version`, packaged assets, and captures `npm ls` output.
2. Keep the captured dependency graph as release evidence so consumer resolution drift is visible on every release.
3. Clarify browser-scoped computer use with a concrete entry command in help and onboarding rather than adding a new command family.
4. Revisit selective dependency pinning only if the new registry smoke reproduces a real runtime defect caused by graph drift.

## Preventive measures

- Treat local tarball proof and published registry proof as separate gates.
- Keep `README.md`, `docs/CLI.md`, and `docs/FIRST_RUN_ONBOARDING.md` explicit about which path is local-artifact validation and which path is published npm validation.
- Do not diagnose future `_npx` or npm cache failures as publish drift until a fresh isolated registry smoke fails.
