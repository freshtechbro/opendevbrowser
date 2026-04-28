# v0.0.26 Release Evidence

Status: historical release ledger
Target release date: 2026-04-24
Last updated: 2026-04-24

## Scope

Tracks the `0.0.26` release cycle for the post-`0.0.25` review fixes, daemon lifecycle hardening, canvas/CDP live proof, annotation timeout-boundary evidence, packaging proof, and public publication evidence.

## Baseline comparison

- Reference release: npm `latest` is `0.0.25` before publish.
- Target branch: `main`
- Release-prep branch: `codex/release-0-0-26`
- Target tag: `v0.0.26`
- GitHub release assets expected after release:
  - `opendevbrowser-extension.zip`
  - `opendevbrowser-extension.zip.sha256`

## Release summary

- Recovers from stale cached relay bindings even when the retried daemon call already requires a binding.
- Keeps `/status` probes inside the requested timeout budget even if the daemon stalls after returning headers.
- Rejects stale daemon stop attempts using current daemon fingerprints, including stale OpenCode cached package attempts.
- Reports fingerprint-rejected `serve --stop` and `daemon uninstall` paths explicitly instead of silently ignoring them.
- Keeps live-regression release-gate child process failures truthful: nonzero child exit forces scenario `fail` while preserving child summary status as evidence.
- Aligns package, extension, lockfile, and tarball-reference versions at `0.0.26`.

## Version authority

- `package.json`: `0.0.26`
- `package-lock.json`: `0.0.26`
- `extension/package.json`: `0.0.26`
- `extension/manifest.json`: `0.0.26`
- `npm view opendevbrowser version` before publish: `0.0.25`

## Mandatory release gates

- [x] `npm run lint`
  - Result: passed.
- [x] `npm run typecheck`
  - Result: passed.
- [x] `npm run extension:sync`
  - Result: passed; extension metadata already at `0.0.26`.
- [x] `npm run build`
  - Result: passed.
- [x] `npm run extension:build`
  - Result: passed.
- [x] `npm run version:check`
  - Result: passed, `Version check passed: 0.0.26`.
- [x] `npm run test:release-gate`
  - Result: passed.
- [x] `npm run test`
  - Result: passed.
  - Test files: `266 passed | 1 skipped (267)`.
  - Tests: `3943 passed | 1 skipped (3944)`.
  - Coverage: `98.11%` statements, `97.01%` branches, `97.78%` functions, `98.17%` lines.
- [x] `node scripts/audit-zombie-files.mjs`
  - Result: passed, `ok=true`, `scanned=1008`, `flagged=[]`.
- [x] `node scripts/docs-drift-check.mjs`
  - Result: passed, `ok=true`, version `0.0.26`, counts `77` CLI commands, `70` tools, `59` `/ops`, `35` `/canvas`.
- [x] `node scripts/chrome-store-compliance-check.mjs`
  - Result: passed, manifest v3, extension version `0.0.26`, all permission, privacy, and asset checks passed.
- [x] `./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh`
  - Result: passed, `22` files referenced/present and `10` JSON templates parsed.
- [x] `./skills/opendevbrowser-best-practices/scripts/run-robustness-audit.sh`
  - Result: passed for all robustness checks.
- [x] `npx opendevbrowser --help`
  - Result: passed, generated help lists `77` commands and `70` tools.
- [x] `npx opendevbrowser help`
  - Result: passed, generated help lists `77` commands and `70` tools.
- [x] `node scripts/cli-smoke-test.mjs`
  - Result: passed on sequential run.
- [x] `node scripts/cli-onboarding-smoke.mjs`
  - Result: passed on sequential run.
- [x] `npm pack --json`
  - Result: passed.
  - Prepack reran `version:check`, `build`, and `extension:build`.
- [x] `npm run extension:pack`
  - Result: passed after final `npm pack` build.

## Live release proof

- [x] `node scripts/live-regression-direct.mjs --release-gate --out artifacts/release/v0.0.26/live-regression-direct.json`
  - Result: passed with `ok=true` after final packaging rebuild.
  - Counts: `pass=6`, `skipped=2`, `fail=0`, `env_limited=0`, `expected_timeout=0`.
  - Canvas extension: `pass`.
  - Canvas CDP: `pass`.
  - Annotation relay: `skipped`, expected manual annotation timeout boundary, not a passing annotation capture proof.
  - Annotation direct: `skipped`, expected manual annotation timeout boundary, not a passing annotation capture proof.

- [ ] `node scripts/provider-direct-runs.mjs --release-gate --out artifacts/release/v0.0.26/provider-direct-runs.json`
  - Result: executed, but not a passing strict gate. It exited nonzero by strict release-gate policy because strict mode promotes live `env_limited` rows.
  - Counts: `pass=18`, `env_limited=12`, `fail=0`, `skipped=0`, `expected_timeout=0`.
  - Verdict: no provider code failures; strict live environment limitations remain truthfully recorded and need explicit release acceptance before publish.

- [x] `node scripts/provider-direct-runs.mjs --smoke --out artifacts/release/v0.0.26/provider-direct-runs-smoke.json`
  - Result: passed with `ok=true`.
  - Counts: `pass=8`, `env_limited=3`, `skipped=2`, `fail=0`, `expected_timeout=0`.

## Artifacts

- [x] `opendevbrowser-0.0.26.tgz`
  - SHA-256: `68790192961d6a0838dcdea46440a4ac7e2ec74acf67382c6d981efd06093117`
  - npm pack shasum: `b4b7ad44bb4271f2a4b5ca9e1bcda21cf81d8b09`
  - npm pack integrity: `sha512-yKAQNPhY8WZU04Gt2CIk1cHW2ULpBAb+q9z+SVyb0acPGd8yKdF7JdV9y5xpFhTw7Vc8jISRXVGT/9CpJkOaPw==`
  - Package size: `2102968` bytes.
  - Unpacked size: `10961171` bytes.
  - Total files: `982`

- [x] `opendevbrowser-extension.zip`
  - SHA-256: `5c30b065251e9c32df9db34d40c0d113a924a202f0052d6b90bf16e1960c6575`
  - Package size: `174915` bytes.

## Repo sanity checks

- [x] `git diff --check`
  - Result: passed with no whitespace errors.
- [x] `git status --short`
  - Result: expected release-prep source, test, docs, and version-owner changes only.

## External release workflow evidence

- [x] npm publish verification
  - Pre-publish `npm view opendevbrowser version`: `0.0.25`
  - Local npm auth: `npm whoami` returned `bishopdotun`
  - Publish command: `npm publish --access public`
  - Result: published `opendevbrowser@0.0.26`.
  - Post-publish `npm view opendevbrowser version`: `0.0.26`
  - Registry dist shasum: `b4b7ad44bb4271f2a4b5ca9e1bcda21cf81d8b09`
  - Registry dist integrity: `sha512-yKAQNPhY8WZU04Gt2CIk1cHW2ULpBAb+q9z+SVyb0acPGd8yKdF7JdV9y5xpFhTw7Vc8jISRXVGT/9CpJkOaPw==`
- [x] Registry consumer smoke JSON
  - Command: `node scripts/registry-consumer-smoke.mjs --version 0.0.26 --output artifacts/release/v0.0.26/registry-consumer-smoke.json`
  - Result: passed with `success=true`, `installAttempts=1`, `versionMatches=true`, `helpAliasMatches=true`, `extensionDirExists=true`, and `skillsDirExists=true`.
  - Consumer graph: `opendevbrowser=0.0.26`, `@opencode-ai/plugin=1.14.22`, `ws=8.20.0`, `zod=3.25.76`.
- [x] GitHub release URL
  - Release: `https://github.com/freshtechbro/opendevbrowser/releases/tag/v0.0.26`
  - Target commit: `1bb6c57b2088cd26ead55022f6484ab18c8e0930`
  - Published at: `2026-04-24T11:53:56Z`
- [x] GitHub release asset verification
  - `opendevbrowser-extension.zip`: uploaded, size `174915`, digest `sha256:5c30b065251e9c32df9db34d40c0d113a924a202f0052d6b90bf16e1960c6575`.
  - `opendevbrowser-extension.zip.sha256`: uploaded, size `95`, digest `sha256:d1c784ebba4bb122ed22bccf114f6e954474b00bbf284ff05f9ace068dbf38e1`.
- [x] Chrome Web Store upload status
  - API publish remains blocked in this shell: `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`, and `CWS_EXTENSION_ID` are not present.
  - Repository secret check: `gh secret list --repo freshtechbro/opendevbrowser` lists only `PRIVATE_REPO_DISPATCH_TOKEN`; no `CWS_*` secrets are configured.
  - Direct script attempt: `node scripts/chrome-store-publish.mjs --zip opendevbrowser-extension.zip --publish` exited before upload with `CWS_EXTENSION_ID is required`.
  - Manual dashboard upload: completed through Chrome Web Store Developer Dashboard for item `mfajibjdacmecipgcpnagccbieabglhk`.
  - Uploaded file: `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/opendevbrowser-extension.zip`.
  - Uploaded file SHA-256: `5c30b065251e9c32df9db34d40c0d113a924a202f0052d6b90bf16e1960c6575`.
- [x] Chrome Web Store publish or submit-for-review status
  - Store item URL: `https://chromewebstore.google.com/detail/mfajibjdacmecipgcpnagccbieabglhk`
  - Developer dashboard URL: `https://chrome.google.com/webstore/devconsole/ca194bec-a1d3-46ce-90f0-1c2fd8ab9a71/mfajibjdacmecipgcpnagccbieabglhk/edit/package`
  - Manual submission result: Chrome Web Store confirmed, `Your extension was submitted for review`.
  - Dashboard status after submission: `Pending review`.
  - Draft package version after upload: `0.0.26`.
  - Published package version remains `0.0.24` until Chrome Web Store review passes.
  - Submission option: dashboard checkbox `Publish OpenDevBrowser Relay automatically after it has passed review` was checked during submission.

## Notes

- `0.0.25` is already published to npm and is the baseline for this follow-up fix release.
- CLI smoke and onboarding smoke share the default relay port. The release evidence uses sequential runs to avoid a false relay-port collision.
- npm and GitHub release lanes are complete for `0.0.26`; Chrome Web Store `0.0.26` is submitted and pending review with automatic publish enabled after approval.
