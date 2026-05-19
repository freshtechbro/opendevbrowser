# v0.0.32 Release Evidence

Status: released
Target release date: 2026-05-19
Target tag: `v0.0.32`

## Scope

Tracks the `0.0.32` release cycle for documentation artifact cleanup and package metadata alignment.

Current status note:
- As of the 2026-05-19 package metadata audit, `package.json`, `package-lock.json`, `package-lock.json#packages[""]`, `extension/manifest.json`, and `extension/package.json` are aligned at `0.0.32`.
- Chrome Web Store publication is explicitly skipped for this release. This release targets npm and GitHub only.
- The tag-driven public release workflow completed successfully on 2026-05-19, publishing npm package `opendevbrowser@0.0.32` and GitHub release `v0.0.32`.

## Reference State

- Previous npm `latest`: `0.0.31`
- Previous GitHub release: `v0.0.31`
- Release branch: `codex/release-v0.0.32`
- Target tag: `v0.0.32`
- GitHub release workflow: `.github/workflows/release-public.yml`

## Release Delta

- Removed tracked planning artifacts from `docs/plans`.
- Removed tracked investigation artifacts from `docs/investigations`.
- Kept release-facing source metadata aligned with the `0.0.32` package version.
- Skipped Chrome Web Store publication by request; GitHub release artifacts still include the extension zip and checksum from the public release workflow.

## Version Alignment

- `package.json`: `0.0.32`
- `package-lock.json`: `0.0.32`
- `extension/package.json`: `0.0.32`
- `extension/manifest.json`: `0.0.32`

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
- [x] `npm pack --pack-destination /tmp`
- [x] `git diff --check`

## Optional Strict Live Gates

- [ ] Deferred unless explicitly required for this release:
  - `node scripts/provider-direct-runs.mjs --release-gate --out artifacts/release/v0.0.32/provider-direct-runs.json`
  - `node scripts/live-regression-direct.mjs --release-gate --out artifacts/release/v0.0.32/live-regression-direct.json`

## Implementation Proof

- [x] Cleanup PR #64 merged: `https://github.com/freshtechbro/opendevbrowser/pull/64`
- [x] Cleanup PR #64 passed required checks before merge: audit-zombie-files, build, chrome-store-compliance-check, cli-help-parity, docs-drift-check, focused-regression-tests, lint, skill-assets, and typecheck.

## Local Release Gate Results

- `npm run extension:sync`: passed; extension version metadata already at `0.0.32`.
- `npm run version:check`: passed; version check reported `0.0.32`.
- `node scripts/docs-drift-check.mjs`: passed with `ok: true`; generated counts were `77` commands, `70` tools, `59` macros, and `35` channels.
- `node scripts/audit-zombie-files.mjs`: passed; scanned `1047` files and flagged `[]`.
- `node scripts/chrome-store-compliance-check.mjs`: passed; manifest version was `0.0.32`.
- `./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh`: passed.
- `./skills/opendevbrowser-motion-design/scripts/validate-skill-assets.sh`: passed.
- `npx opendevbrowser --help`: passed with `806` help lines and expected lookup labels present.
- `npx opendevbrowser help`: passed with `806` help lines and expected lookup labels present.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm run test:release-gate`: passed; groups completed with `99`, `40`, `15`, `5`, and `1` tests.
- `npm run build`: passed.
- `npm run test`: passed with `272` test files passed, `1` skipped; `4502` tests passed, `1` skipped; coverage summary was statements `98.29`, branches `97.01`, functions `97.98`, and lines `98.36`.
- `npm run extension:build`: passed.
- `npm run extension:pack`: passed; produced `opendevbrowser-extension.zip`.
- Extension zip SHA-256: `979791718498540075e3476fa71586a7a4b4bd19c3d05e1448e507f8cbbfb060`.
- `npm pack --pack-destination /tmp`: passed; produced `/tmp/opendevbrowser-0.0.32.tgz`.
- npm tarball details: package size `2.3 MB`, unpacked size `11.9 MB`, total files `1244`, npm shasum `2e4b8f52c72839d3a9e7445ed2a37cb8d493bc38`.
- npm tarball SHA-256: `7ed84fb2218a2dbee4de9da2afb3af521672c1f781e8f9cde12443081e9a03d6`.
- `git diff --check`: passed before packaging and will be rerun after this evidence update.

## External Release Workflow Evidence

- [x] Release workflow run URL: `https://github.com/freshtechbro/opendevbrowser/actions/runs/26095138803`
- [x] npm publish verification: `npm view opendevbrowser version dist-tags --json` returned version `0.0.32` and `latest: 0.0.32`.
- [x] Registry consumer smoke: workflow smoke passed; local post-publish smoke also passed with `helpLineCount: 807`, `versionMatches: true`, `extensionDirExists: true`, and `skillsDirExists: true`.
- [x] GitHub release URL: `https://github.com/freshtechbro/opendevbrowser/releases/tag/v0.0.32`
- [x] GitHub release asset verification: release is not draft, not prerelease, published at `2026-05-19T11:52:45Z`, and includes `opendevbrowser-extension.zip` plus `opendevbrowser-extension.zip.sha256`.
- [x] Chrome Web Store manual publish status: skipped by request for `v0.0.32`.

Release workflow result:
- Run `26095138803`: completed with conclusion `success`.
- Event: tag push for `v0.0.32`.
- Head SHA: `c5c4a37f705050eebff1486022f2c05f79b1549f`.
- Completed at: `2026-05-19T11:52:50Z`.

GitHub release assets:
- `opendevbrowser-extension.zip`: size `176329`, digest `sha256:0741f25b00df7c0c52a8b93549ca91b5502e9ccfe80b358cf296c83f5fc4e232`.
- `opendevbrowser-extension.zip.sha256`: size `95`, digest `sha256:e738bd3106a8d653c3da53d12030377a9484a38e41f03f80ed49306f1ebb136f`.

## Notes

- Strict live gates are separate from release quality gates and are deferred unless specifically run.
- If the tag-driven release workflow cannot publish npm because repository `NPM_TOKEN` is unavailable, use local npm auth to publish and rerun the GitHub release artifact path with npm publication disabled.
