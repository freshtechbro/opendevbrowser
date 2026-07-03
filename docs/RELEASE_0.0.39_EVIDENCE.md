# v0.0.39 Release Evidence

Status: released
Release date: 2026-07-03 UTC
Tag: `v0.0.39`
Release URL: `https://github.com/freshtechbro/opendevbrowser/releases/tag/v0.0.39`

## Scope

Tracks the `0.0.39` release cycle from local release preparation through npm publish, registry smoke, GitHub release, and post-release verification. Chrome Web Store publication is not part of this public release workflow unless credentials or an authenticated dashboard session are available.

## Final Release State

- npm package: `opendevbrowser@0.0.39`
- npm `latest`: `0.0.39`
- npm tarball shasum: `5151f3816a0572856fce0368cab60ba257c10c95`
- npm tarball integrity: `sha512-a2iInFUy2Di+uq5SCdDEJliJCMIBOXqGNNy/+C1RpxjZzUhg4afEHCjq9UzOhoDGG286yuHk5rvIJmDrqjlIqg==`
- Release tag: `v0.0.39`
- Tag target: `d5eb215844587e3dde702392e19fb19681147495`
- GitHub release: `https://github.com/freshtechbro/opendevbrowser/releases/tag/v0.0.39`
- Successful release workflow run: `https://github.com/freshtechbro/opendevbrowser/actions/runs/28631754826`
- Chrome Web Store: not attempted in this lane.

## Release History

- Release prep branch: `codex/release-0.0.39`.
- Release prep PR: `#107`, merged at `2026-07-03T01:07:47Z` with merge commit `d5eb215844587e3dde702392e19fb19681147495`.
- npm publish: local-auth publish succeeded for `opendevbrowser@0.0.39`.
- GitHub release workflow: dispatch succeeded with `publish_npm=false`, `publish_github_release=true`, `draft_release=false`, and `run_release_live_gates=false`.

## Version Alignment

- `package.json`: `0.0.39`
- `package-lock.json`: `0.0.39`
- `extension/package.json`: `0.0.39`
- `extension/manifest.json`: `0.0.39`

## Dependency And Audit Evidence

- `package.json` dependency ranges were not changed for this release.
- `package-lock.json` was refreshed intentionally with `npm audit fix --package-lock-only` and `npm audit fix` to resolve production advisories within existing declared ranges.
- `npm ci`: passed from the refreshed lockfile.
- `npm audit --omit=dev`: passed with `found 0 vulnerabilities`.
- `npm audit --audit-level=moderate`: passed. Residual advisory is one low-severity dev-only `esbuild` advisory from the current toolchain range, below the release audit gate.

## Local Release Prep Gates

- [x] `npm version 0.0.39 --no-git-tag-version`
- [x] `npm run extension:sync`
- [x] `npm run version:check`
- [x] `node scripts/docs-drift-check.mjs`
- [x] `git diff --check`
- [x] `npm ci`
- [x] `node scripts/chrome-store-compliance-check.mjs`
- [x] `npm run test:release-gate`
- [x] `npm run lint`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm run extension:build`
- [x] `npm run test`
- [x] `node scripts/audit-zombie-files.mjs`
- [x] `./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh`
- [x] `./skills/opendevbrowser-motion-design/scripts/validate-skill-assets.sh`
- [x] `npx opendevbrowser --help`
- [x] `npx opendevbrowser help`
- [x] `npm run extension:pack`
- [x] `npm pack --dry-run`

## Full Gate Matrix Rerun

Evidence directory: `artifacts/release/v0.0.39/`

- Formatter: not available; `package.json` has no formatter script.
- `git status --short --branch`: release-prep branch dirty only with intended tracked release files plus preserved unrelated untracked investigation/review docs.
- `git diff --check`: passed in the local gate set and will be rerun before commit.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm run version:check`: passed with `0.0.39`.
- `npm run build`: passed.
- `npm run extension:build`: passed.
- `npm run test`: passed, 297 files passed, 1 skipped; 5654 tests passed, 1 skipped; branch coverage `25978/26779 = 97.00885021845475%`.
- `node scripts/docs-drift-check.mjs`: passed.
- `node scripts/audit-zombie-files.mjs`: passed.
- `node scripts/chrome-store-compliance-check.mjs`: passed.
- `./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh`: passed.
- `./skills/opendevbrowser-motion-design/scripts/validate-skill-assets.sh`: passed.
- `npx opendevbrowser --help`: passed.
- `npx opendevbrowser help`: passed.
- `npm run extension:pack`: passed and produced `opendevbrowser-extension.zip` locally for packaging proof.
- `npm pack --dry-run`: passed through `prepack`, `npm run version:check`, `npm run build`, and `npm run extension:build`; dry-run tarball inventory reported `opendevbrowser-0.0.39.tgz`, package size `3.0 MB`, unpacked size `14.9 MB`, total files `1356`, shasum `5151f3816a0572856fce0368cab60ba257c10c95`.

## Live Release Gate Evidence

- `node scripts/provider-direct-runs.mjs --release-gate --out artifacts/release/v0.0.39/provider-direct-runs.json`: completed with no implementation failures but strict status `ok=false` because the live third-party environment had provider auth/token/policy limits. Counts were `17` pass, `13` env-limited, `0` fail, `0` skipped. Environment-limited cases were community keyword auth, Bluesky/Facebook/Instagram/Threads auth or environment limits, social write-path policy blocks, Costco/Macy's environment limits, AliExpress/Others auth, and Temu token requirement.
- `node scripts/live-regression-direct.mjs --release-gate --out artifacts/release/v0.0.39/live-regression-direct.json`: passed with `ok=true`; counts were `6` pass, `0` env-limited, `0` fail, and `2` skipped. The skipped cases were existing annotation manual-probe boundaries: `feature.annotate.relay` and `feature.annotate.direct`.
- Daemon preflight: the stale temporary daemon on default ports was stopped, then the current source daemon was started on `127.0.0.1:8788` with relay `8787`; `status --daemon --output-format json` showed `fingerprintCurrent=true`, extension connected, and extension handshake complete before the successful live-regression run.

## npm Publish Evidence

Local-auth publish completed after release prep PR `#107` merged to `main`.

- `npm run version:check`: passed with `0.0.39`.
- `npm whoami`: authenticated as the local npm user.
- `npm view opendevbrowser@0.0.39 version`: returned `E404` before publish, confirming the version was absent.
- `npm publish --access public`: succeeded and published `+ opendevbrowser@0.0.39`.
- Published tarball: `opendevbrowser-0.0.39.tgz`.
- Published package size: `3.0 MB`; unpacked size: `14.9 MB`; total files: `1356`.
- Published shasum: `5151f3816a0572856fce0368cab60ba257c10c95`.
- `npm view opendevbrowser version dist-tags --json`: reported version `0.0.39` and `latest` `0.0.39`.
- `npm view opendevbrowser@0.0.39 version dist.shasum dist.integrity --json`: reported version `0.0.39`, shasum `5151f3816a0572856fce0368cab60ba257c10c95`, and integrity `sha512-a2iInFUy2Di+uq5SCdDEJliJCMIBOXqGNNy/+C1RpxjZzUhg4afEHCjq9UzOhoDGG286yuHk5rvIJmDrqjlIqg==`.

## Registry Consumer Smoke

- Result: passed.
- Evidence path: `artifacts/release/v0.0.39/registry-consumer-smoke.json`.
- Purpose: verify a registry consumer can install and smoke `opendevbrowser@0.0.39` from npm after publish.
- Fresh temp workspace: `/var/folders/_l/0q__8smd075f8qlj7sz2559r0000gn/T/opendevbrowser-registry-consumer-79jWTX`.
- Install attempts: `1`.
- Help line count: `873`.
- Checks: `helpAliasMatches`, `findItFastPresent`, `extensionDirExists`, `skillsDirExists`, and `versionMatches` were all `true`.
- Resolved consumer graph: `opendevbrowser` `0.0.39`, `@opendevbrowser/plugin` `1.17.13`, `ws` `8.21.0`, `zod` `3.25.76`, nested plugin `zod` `4.1.8`.

## GitHub Release Evidence

Workflow dispatch after npm publish:

```bash
gh workflow run release-public.yml \
  -f release_ref=main \
  -f release_tag=v0.0.39 \
  -F publish_npm=false \
  -F publish_github_release=true \
  -F draft_release=false \
  -F run_release_live_gates=false
```

- Release URL exists for `v0.0.39`: `https://github.com/freshtechbro/opendevbrowser/releases/tag/v0.0.39`.
- Release is draft: `false`.
- Release is prerelease: `false`.
- Release published at: `2026-07-03T01:16:01Z`.
- Tag `v0.0.39` points to `d5eb215844587e3dde702392e19fb19681147495`.
- Release target commitish: `main`.
- Asset `opendevbrowser-extension.zip` exists, size `190671`, state `uploaded`, digest `sha256:a3da20e0951ae2a082250cf97dcdaea14cb1253fae2ac26c58f2918e74aad144`.
- Asset `opendevbrowser-extension.zip.sha256` exists, size `95`, state `uploaded`, digest `sha256:85f7d3f50284944f7e57018ec8118fd204fd52d40c3d0750114f17212f8fa2f4`.
- Downloaded assets to `/tmp/opendevbrowser-v0.0.39-release-assets-20260703T011624Z`.
- Checksum verification returned `opendevbrowser-extension.zip: OK`.

## GitHub Workflow Evidence

- Successful release workflow: `https://github.com/freshtechbro/opendevbrowser/actions/runs/28631754826`.
- Workflow job: `release`, job id `84909946041`, completed with conclusion `success`.
- Workflow head SHA: `d5eb215844587e3dde702392e19fb19681147495`.
- Workflow started at `2026-07-03T01:09:57Z` and completed at `2026-07-03T01:16:04Z`.
- Workflow inputs: `release_ref=main`, `release_tag=v0.0.39`, `publish_npm=false`, `publish_github_release=true`, `draft_release=false`, `run_release_live_gates=false`.
- Successful steps included release quality gates, extension artifact packing, checksum computation, and GitHub release publication.
- Skipped steps were intentional by input: strict live release gates, npm package publish, and workflow registry consumer smoke. Strict live gate and registry smoke proof were captured locally in this ledger.
- Non-blocking annotation: GitHub Actions reported Node.js 20 deprecation warnings for upstream actions being forced to Node.js 24.

## Chrome Web Store Release Lane

- Status: not attempted.
- Blocker: Chrome Web Store credentials or an authenticated dashboard session were not established for this release lane.
- Required GitHub secrets from `.github/workflows/chrome-store-publish.yml`: `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`, and `CWS_EXTENSION_ID`.
- Manual upload can proceed later from the verified GitHub release zip once Chrome Web Store access is available.

## Out Of Scope For This Evidence Update

- Chrome Web Store upload or publish.
- Website deploy cutover, governed by `docs/CUTOVER_CHECKLIST.md` and the private website repository.
