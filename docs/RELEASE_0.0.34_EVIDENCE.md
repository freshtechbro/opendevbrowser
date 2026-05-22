# v0.0.34 Release Evidence

Status: npm and GitHub released; Chrome Web Store manual handoff pending
Target release date: 2026-05-22
Target tag: `v0.0.34`

## Scope

Tracks the `0.0.34` release cycle for the Inspired Design harvest recovery follow-up, browser output artifact hardening, and release metadata alignment.

Current status note:
- Source version metadata is aligned from `0.0.33` to `0.0.34`.
- npm package `opendevbrowser@0.0.34` is published.
- GitHub release `v0.0.34` is published with extension assets.
- Chrome Web Store publication remains a manual browser-gated lane because Chrome Web Store developer pages cannot be scripted and this repo has no `CWS_*` secrets configured for API publication.

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

- [x] Tag-driven release workflow run: `https://github.com/freshtechbro/opendevbrowser/actions/runs/26306270497`
- [x] Tag-driven release workflow result: failed at `Publish npm package`; earlier release metadata, checkout, install, version alignment, release quality gates, extension packaging, and checksum generation passed. npm returned `E404` while publishing `opendevbrowser@0.0.34` from the repository token.
- [x] Local npm publish fallback: `npm publish --access public --loglevel warn` completed successfully from `main` at tag `v0.0.34` after `version:check`, `build`, and `extension:build`.
- [x] npm publish verification: `npm view opendevbrowser version dist-tags dist.tarball dist.integrity --json --cache /tmp/npm-cache-odb-release-034-final --prefer-online` returned version `0.0.34`, `latest` dist-tag `0.0.34`, tarball `https://registry.npmjs.org/opendevbrowser/-/opendevbrowser-0.0.34.tgz`, and integrity `sha512-SG7TSv4bO4EEpUHdzntFaNrsad7x5eJm7OvT/HuQ4zM5zLsrKtx4SYetDeBw+Tqeef+AAH6K8mhNtzQvqJsa+Q==`.
- [x] Registry consumer smoke: `npm_config_cache=/tmp/npm-cache-odb-release-034-smoke node scripts/registry-consumer-smoke.mjs --version 0.0.34 --output artifacts/release/v0.0.34/registry-consumer-smoke.json` passed with `success: true`, `installAttempts: 1`, `helpAliasMatches: true`, `findItFastPresent: true`, `extensionDirExists: true`, `skillsDirExists: true`, and `versionMatches: true`. The first immediate smoke attempt failed during npm propagation with stale cached `0.0.33` metadata, then passed with an isolated npm cache after registry metadata exposed `0.0.34`.
- [x] GitHub release-only workflow run: `https://github.com/freshtechbro/opendevbrowser/actions/runs/26306757983`
- [x] GitHub release-only workflow result: passed in `4m51s`; release metadata, checkout, install, version alignment, full release quality gates, extension packaging, checksum generation, and GitHub release publication passed. npm publish and registry smoke were intentionally skipped because npm had already been published locally and verified by local consumer smoke.
- [x] GitHub release URL: `https://github.com/freshtechbro/opendevbrowser/releases/tag/v0.0.34`
- [x] GitHub release verification: `v0.0.34` is not draft, not prerelease, published at `2026-05-22T19:10:38Z`, target commitish `main`.
- [x] GitHub release asset verification: downloaded `opendevbrowser-extension.zip` and `opendevbrowser-extension.zip.sha256` to `/tmp/opendevbrowser-release-v0.0.34-assets`; `shasum -a 256 -c opendevbrowser-extension.zip.sha256` returned `opendevbrowser-extension.zip: OK`.
- [x] GitHub release asset digest: `opendevbrowser-extension.zip` uploaded with digest `sha256:f1de8d882b86773a72192cd5d9bc91963a95c0d605a7f58daff7805c7cb836bb`, size `176329`.
- [x] GitHub release checksum asset digest: `opendevbrowser-extension.zip.sha256` uploaded with digest `sha256:52477a05cacf552ba6e61c86ffd0ecc1d836dc506da7e954e67ca1b42d4d6d89`, size `95`.
- [ ] Chrome Web Store manual publish evidence: pending user completion in Chrome Web Store Developer Dashboard.
- [x] Chrome Web Store manual lane preflight: local env has no `CWS_*` variables, `gh secret list --repo freshtechbro/opendevbrowser` lists no `CWS_*` secrets, and API/workflow publication is unavailable without those credentials.
- [x] Chrome Web Store dashboard handoff: Chrome extension-backed browser reached `https://chrome.google.com/webstore/devconsole/ca194bec-a1d3-46ce-90f0-1c2fd8ab9a71/mfajibjdacmecipgcpnagccbieabglhk/edit/package?pli=1` with title `Package Information`, but Chrome Web Store pages return `The extensions gallery cannot be scripted`. The in-app browser redirected to Google sign-in for Chrome Web Store. Manual upload should use `/tmp/opendevbrowser-release-v0.0.34-assets/opendevbrowser-extension.zip`.

## Notes

- Strict live gates are separate from release quality gates and are deferred unless specifically run.
- GitHub Actions emitted the existing Node.js 20 action deprecation warning for `actions/checkout@v4`, `actions/setup-node@v4`, and `softprops/action-gh-release@v2`; this is a follow-up maintenance item, not a `v0.0.34` release blocker.
