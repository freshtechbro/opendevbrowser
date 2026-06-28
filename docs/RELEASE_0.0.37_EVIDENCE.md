# v0.0.37 Release Evidence

Status: npm and GitHub release complete; Chrome Web Store lane blocked on credentials/session
Target release date: 2026-06-28
Target tag: `v0.0.37`

## Scope

Tracks the `0.0.37` release cycle for the Inspiredesign product-authority and output-specificity closeout.

Current status note:
- Source version metadata is aligned from `0.0.36` to `0.0.37`.
- `opendevbrowser@0.0.37` is published on npm and tagged as `latest`.
- GitHub release `v0.0.37` is published with extension zip and checksum assets.
- Chrome Web Store upload/publish is blocked because required CWS credentials are missing in GitHub secrets and local environment, and manual dashboard access could not be verified from this session.

## Reference State

- Previous npm `latest`: `0.0.36`
- Previous GitHub release: `v0.0.36`
- Release source branch: `codex/release-0.0.37`
- Target tag: `v0.0.37`
- GitHub release workflow: `.github/workflows/release-public.yml`
- Chrome Web Store workflow: `.github/workflows/chrome-store-publish.yml`

## Release Delta

- Hardened Inspiredesign product-ready semantics so canonical Pinterest `/pin/...` references require manifest-backed `pin_media_ready` evidence.
- Kept CLI and skill guidance from treating transport success or guidance readiness as final product success.
- Improved Inspiredesign design outputs, Canvas handoff, and token strategy with run-specific media evidence, advisory-only media-analysis provenance, and separate light/dark token maps.
- Preserved Pinterest `search_shell` as diagnostic provenance when rendered canonical pin links can still produce first-party pin-media authority.

## Version Alignment

- `package.json`: `0.0.37`
- `package-lock.json`: `0.0.37`
- `extension/package.json`: `0.0.37`
- `extension/manifest.json`: `0.0.37`

## RepoPrompt Release Audit

- npm/GitHub release audit agent: `9C742D08-74D5-441D-93FB-75AEBC76AB57`.
  - Result: initial fail until release prep was committed or merged, stale AGENTS pointers were fixed, and gates were recorded.
  - Follow-up: active stale `0.0.36` release pointers were fixed in `src/cli/AGENTS.md` and `tests/AGENTS.md`.
- Chrome release lane audit agent: `0190B5A1-8C28-4C91-A5FE-8B5C64104642`.
  - Result: local version and Chrome compliance checks passed; publish remains blocked on merged release ref plus Chrome Web Store credentials and dashboard review.
  - Recommendation retained: use the Chrome Store publish workflow upload-only first, then publish after dashboard review.
- Final release-prep review agent: `AE93B3B7-4735-45A3-ACB1-ACB55B5A0223`.
  - Initial finding: duplicate optional strict-live decision wording.
  - Rereview result: no blocker after removing the stale pending decision.
- CI release-gate fix review agent: `986A8586-E54D-47BD-A443-C914FC6F0FB2`.
  - Result: pass. The platform injection seam keeps runtime callers on `process.platform` while making the public direct SQLite test hermetic on Linux CI.
- Release-lane audit agent: `09FDB4E7-846F-4E20-8A52-91D28D054A90`.
  - Result: npm `0.0.37` was already published, GitHub release was blocked by the failed cookie bootstrap test until PR #97, and Chrome Web Store remained blocked by missing CWS credentials.

## Mandatory Local Release Gates

- [x] `npm run extension:sync`
- [x] `npm run version:check`
- [x] `npm run test:release-gate`
- [x] `node scripts/audit-zombie-files.mjs`
- [x] `node scripts/docs-drift-check.mjs`
- [x] `node scripts/chrome-store-compliance-check.mjs`
- [x] `./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh`
- [x] `./skills/opendevbrowser-motion-design/scripts/validate-skill-assets.sh`
- [x] `npx opendevbrowser --help`
- [x] `npx opendevbrowser help`
- [x] `npm run lint`
- [x] `npm run typecheck`
- [x] `npm run test`
- [x] `npm run build`
- [x] `npm run extension:build`
- [x] `npm run extension:pack`
- [x] `npm pack`
- [x] `git diff --check`

## Optional Strict Live Gates

- [ ] `node scripts/provider-direct-runs.mjs --release-gate --out artifacts/release/v0.0.37/provider-direct-runs.json`
- [ ] `node scripts/live-regression-direct.mjs --release-gate --out artifacts/release/v0.0.37/live-regression-direct.json`

Decision: deferred for local release prep. The strict live lane remains optional in `docs/RELEASE_RUNBOOK.md`; it should be enabled through the release workflow only when `run_release_live_gates=true`.

## Local Release Gate Results

- `npm run extension:sync`: passed, extension metadata already at `0.0.37`.
- `npm run version:check`: passed, version check reported `0.0.37`.
- `node scripts/audit-zombie-files.mjs`: passed with `ok: true`, `scanned: 1164`, and no flagged paths.
- `node scripts/docs-drift-check.mjs`: passed with `ok: true`, version `0.0.37`, 77 CLI commands, 70 tools, 59 `/ops` commands, and 35 `/canvas` commands.
- `node scripts/chrome-store-compliance-check.mjs`: passed with `ok: true`, manifest version 3, extension version `0.0.37`, and no failed checks.
- `./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh`: passed, 22 referenced files present and 10 JSON templates parsed.
- `./skills/opendevbrowser-motion-design/scripts/validate-skill-assets.sh`: passed.
- `npx opendevbrowser --help`: passed and rendered the generated first-contact help with `screencast / browser replay`, `desktop observation`, and `computer use / browser-scoped computer use`.
- `npx opendevbrowser help`: passed and rendered the same generated help.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm run test:release-gate`: passed all five groups:
  - group 1 `provider-direct-contracts`: 99 tests passed.
  - group 2 `live-direct-regression-contracts`: 40 tests passed.
  - group 3 `cli-help-parity`: 18 tests passed.
  - group 4 `docs-and-zombie-audits`: 5 tests passed.
  - group 5 `chrome-store-compliance`: 1 test passed.
- `npm run test`: passed, 294 test files passed and 1 skipped; 5,499 tests passed and 1 skipped.
- Coverage from `coverage/lcov.info`: 25,364/26,146 branches, 97.0091% branch coverage, deficit 0 against the 97% threshold.
- `npm run build`: passed.
- `npm run extension:build`: passed.
- `npm run extension:pack`: passed and created `opendevbrowser-extension.zip`.
- `npm pack`: passed and created `opendevbrowser-0.0.37.tgz`.
- `git diff --check`: passed.

## Local Artifact Evidence

- Extension zip: `opendevbrowser-extension.zip`
  - Size: 172 KB
  - SHA-256: `0d83add2a083235a07e3921d28fc6ce1e4c1ea2789641b2100a212edded5b6dd`
- npm pack tarball: `opendevbrowser-0.0.37.tgz`
  - Size: 2,882,791 bytes
  - Unpacked size: 14,486,467 bytes
  - Entry count: 1,356
  - npm shasum: `1d839ffb4eb6cc87e4e7f0fdb0a90ca4e871291d`
  - SHA-256: `6fc7f945c05348b6f1f6770c2944add120e3bc839c1471130c625b803466fa5f`
  - Integrity: `sha512-PICscAMYawEaCMD/5LYjs9jv2jN3K5/Eu/qqGOgzFqAFwDbgbiiMmxT2xFXOk+vwAlWY5uHS4qn6BFN2XuqpYA==`

## External Pre-Publish Checks

- `npm view opendevbrowser version dist-tags --json`: returned package version `0.0.36` and `latest: 0.0.36`.
- `npm view opendevbrowser@0.0.37 version --json`: returned `E404`, confirming `0.0.37` is absent before local publish.
- `gh release view v0.0.37 --json tagName,url,isDraft,name`: returned `release not found`.

## External Release Evidence

- Release prep PR: `https://github.com/freshtechbro/opendevbrowser/pull/96`.
- CI release-gate fix PR: `https://github.com/freshtechbro/opendevbrowser/pull/97`.
- Release tag commit: `v0.0.37` points at `71c82af6d7a1a7cd5e5cbd7d1b6d75690db9a372`.
- npm package: `opendevbrowser@0.0.37`.
- npm `latest` dist-tag: `0.0.37`.
- npm shasum: `1d839ffb4eb6cc87e4e7f0fdb0a90ca4e871291d`.
- npm integrity: `sha512-PICscAMYawEaCMD/5LYjs9jv2jN3K5/Eu/qqGOgzFqAFwDbgbiiMmxT2xFXOk+vwAlWY5uHS4qn6BFN2XuqpYA==`.
- Initial GitHub release workflow: `https://github.com/freshtechbro/opendevbrowser/actions/runs/28309950207`.
  - Result: failed in `Run release quality gates`.
  - Root cause: `tests/system-chrome-cookies.test.ts` expected the Darwin direct SQLite branch while running on Linux CI.
  - Fix: PR #97 added an injected platform test seam and forced `"darwin"` in the public-path regression.
- Successful GitHub release workflow: `https://github.com/freshtechbro/opendevbrowser/actions/runs/28310391628`.
  - Result: success in 5m55s.
  - Head branch: `main`.
  - Head SHA: `71c82af6d7a1a7cd5e5cbd7d1b6d75690db9a372`.
  - `publish_npm=false`, so npm publish and in-workflow registry smoke were skipped intentionally.
- GitHub release: `https://github.com/freshtechbro/opendevbrowser/releases/tag/v0.0.37`.
  - Name: `v0.0.37`.
  - Draft: false.
  - Prerelease: false.
  - Published: `2026-06-28T03:50:10Z`.
  - Target commitish: `main`.
- GitHub release assets:
  - `opendevbrowser-extension.zip`, size 176,329 bytes, digest `sha256:bab2dbe190bda7fcd8163e7b360e719ea1c7d456cfc746b1e1e24132a245cce9`.
  - `opendevbrowser-extension.zip.sha256`, digest `sha256:99944089a92aa0686664a624988129bcd09d6377a4e76f168a7d78c4f68bff9e`.
- Release asset verification: downloaded both assets to `/tmp/opendevbrowser-v0.0.37-release.IfBVV0`; `shasum -a 256 -c opendevbrowser-extension.zip.sha256` returned `opendevbrowser-extension.zip: OK`.

## Post-Release Verification

- [x] `npm view opendevbrowser version dist-tags --json` returned `0.0.37` and `latest: 0.0.37`.
- [x] `node scripts/registry-consumer-smoke.mjs --version 0.0.37 --output artifacts/release/v0.0.37/registry-consumer-smoke.json` passed.
  - `success: true`
  - `installAttempts: 1`
  - `helpAliasMatches: true`
  - `findItFastPresent: true`
  - `extensionDirExists: true`
  - `skillsDirExists: true`
  - `versionMatches: true`
- [x] GitHub release `v0.0.37` exists and includes `opendevbrowser-extension.zip` plus `opendevbrowser-extension.zip.sha256`.
- [x] GitHub release extension checksum verified locally with `shasum -a 256 -c`.

## Chrome Web Store Release Lane

- Status: blocked pending Chrome Web Store credentials or dashboard access.
- Evidence to retain:
  - Chrome Store publish workflow URL or local upload/publish JSON output summary.
  - Store listing URL and visible version.
  - Listing-copy or generated-asset review note for browser replay, desktop observation, and browser-scoped computer-use boundary wording.
- Current blocker evidence:
  - Required GitHub secrets from `.github/workflows/chrome-store-publish.yml`: `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`, and `CWS_EXTENSION_ID`.
  - `gh secret list --repo freshtechbro/opendevbrowser` returned only `NPM_TOKEN` and `PRIVATE_REPO_DISPATCH_TOKEN`.
  - Local environment check returned all required CWS variables as missing.
  - Browser dashboard inspection was attempted from the in-app Browser plugin, but dashboard navigation timed out before exposing page state.
  - Computer Use inspection was attempted for Google Chrome, but no Chrome window was available through the accessibility surface even after opening the developer console URL.
  - Manual upload can proceed once a CWS-authenticated dashboard or the four CWS workflow secrets are available; the verified release zip is attached to GitHub release `v0.0.37`.

## Out Of Scope

- Website deploy cutover remains governed by `docs/CUTOVER_CHECKLIST.md` and the private website repository.
