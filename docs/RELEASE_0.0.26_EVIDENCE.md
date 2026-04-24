# v0.0.26 Release Evidence

Status: active release ledger
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
  - SHA-256: `a49b1b651f62bbb713db3a50d359b6a6284a0c269e6a5cea268c41ac95fad4d6`
  - Package size: `174915` bytes.

## Repo sanity checks

- [x] `git diff --check`
  - Result: passed with no whitespace errors.
- [x] `git status --short`
  - Result: expected release-prep source, test, docs, and version-owner changes only.

## External release workflow evidence

- [ ] npm publish verification
  - Pre-publish `npm view opendevbrowser version`: `0.0.25`
  - Local npm auth: `npm whoami` returned `bishopdotun`
- [ ] Registry consumer smoke JSON
  - Pending until npm publish.
- [ ] GitHub release URL
  - Pending until PR merge or release cut.
- [ ] GitHub release asset verification
  - Pending until GitHub release upload.
- [ ] Chrome Web Store upload status
  - Blocked in this shell: `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`, and `CWS_EXTENSION_ID` are not present.
- [ ] Chrome Web Store publish or submit-for-review status
  - Blocked until Chrome Web Store credentials are available.

## Notes

- `0.0.25` is already published to npm and is the baseline for this follow-up fix release.
- CLI smoke and onboarding smoke share the default relay port. The release evidence uses sequential runs to avoid a false relay-port collision.
- Keep this ledger active until npm publish, GitHub release assets, and Chrome Web Store status are completed or blocked with final evidence.
