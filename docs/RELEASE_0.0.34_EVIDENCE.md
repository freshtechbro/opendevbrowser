# v0.0.34 Release Evidence

Status: prepared
Target release date: 2026-05-22
Target tag: `v0.0.34`

## Scope

Tracks the `0.0.34` release cycle for the Inspired Design harvest recovery follow-up, browser output artifact hardening, and release metadata alignment.

Current status note:
- Source version metadata is aligned from `0.0.33` to `0.0.34`.
- npm and GitHub release publication are planned through the public release workflow.
- Chrome Web Store publication is planned as a manual browser-gated lane for this release.

## Reference State

- Previous npm `latest`: `0.0.33`
- Previous GitHub release: `v0.0.33`
- Release branch: `codex/release-v0.0.34`
- Target tag: `v0.0.34`
- GitHub release workflow: `.github/workflows/release-public.yml`

## Release Delta

- Shipped PR #71 Inspired Design harvest recovery and browser output artifact behavior.
- Shipped PR #72 Pinterest harvest recovery validation hardening.
- Preserved diagnostic-only gating for non-ready Pinterest evidence and Canvas continuation.
- Kept release-facing source metadata aligned with the `0.0.34` package version.

## Version Alignment

- `package.json`: `0.0.34`
- `package-lock.json`: `0.0.34`
- `extension/package.json`: `0.0.34`
- `extension/manifest.json`: `0.0.34`

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
  - `node scripts/provider-direct-runs.mjs --release-gate --out artifacts/release/v0.0.34/provider-direct-runs.json`
  - `node scripts/live-regression-direct.mjs --release-gate --out artifacts/release/v0.0.34/live-regression-direct.json`

## Implementation Proof

- [x] Harvest/browser artifact PR #71 merged: `https://github.com/freshtechbro/opendevbrowser/pull/71`
- [x] Pinterest recovery follow-up PR #72 merged: `https://github.com/freshtechbro/opendevbrowser/pull/72`
- [x] PR #72 passed required checks before merge: audit-zombie-files, build, chrome-store-compliance-check, cli-help-parity, docs-drift-check, focused-regression-tests, lint, skill-assets, and typecheck.

## Local Release Gate Results

- `npm run extension:sync`: passed; synced `extension/manifest.json` and `extension/package.json` to `0.0.34`.
- `npm run version:check`: passed; version check reported `0.0.34`.
- `npm run test:release-gate`: passed; groups completed with `99`, `40`, `15`, `5`, and `1` tests.
- `node scripts/audit-zombie-files.mjs`: passed; scanned `1077` files and flagged `[]`.
- `node scripts/docs-drift-check.mjs`: passed with `ok: true` for version `0.0.34`.
- `node scripts/chrome-store-compliance-check.mjs`: passed; manifest version was `0.0.34`.
- `./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh`: passed; `22` referenced files present and `10` JSON templates parsed.
- `./skills/opendevbrowser-motion-design/scripts/validate-skill-assets.sh`: passed.
- `npx opendevbrowser --help`: passed with `823` help lines.
- `npx opendevbrowser help`: passed with `823` help lines.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `npm run extension:build`: passed.
- `npm run test`: passed with `280` test files passed, `1` skipped; `4677` tests passed, `1` skipped; coverage summary was statements `98.27`, branches `97`, functions `97.94`, and lines `98.37`.
- `npm run extension:pack`: passed; produced `opendevbrowser-extension.zip`.
- Extension zip SHA-256: `42b50b663ae0e627a931518b30408aea5a218d36ce5e0b826b7a183c069518a9`.
- `npm pack --pack-destination /tmp`: passed; produced `/tmp/opendevbrowser-0.0.34.tgz`.
- npm tarball details: package size `2.4 MB`, unpacked size `12.3 MB`, total files `1272`, npm shasum `4c817987915bc2285a2a40b6c595c21e1aabffc2`.
- npm tarball SHA-256: `9bfe1bcf4d29367007c1b97c232c7cc9345e663330f9b99ceb859f3bc3c82211`.
- `git diff --check`: passed.

## External Release Workflow Evidence

- Pending tag-driven release workflow.
- Pending npm publish verification.
- Pending registry consumer smoke.
- Pending GitHub release verification.
- Pending Chrome Web Store manual publish evidence.

## Notes

- Strict live gates are separate from release quality gates and are deferred unless specifically run.
