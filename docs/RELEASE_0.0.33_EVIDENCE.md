# v0.0.33 Release Evidence

Status: released
Target release date: 2026-05-21
Target tag: `v0.0.33`

## Scope

Tracks the `0.0.33` release cycle for the typed guidance recipe architecture, Pinterest browser-native Inspired Design harvest hardening, and release metadata alignment.

Current status note:
- Source version metadata is aligned from `0.0.32` to `0.0.33`.
- Chrome Web Store publication is explicitly skipped for this release. This release targets npm and GitHub only.
- npm package `opendevbrowser@0.0.33` is published.
- GitHub release `v0.0.33` is published with extension assets.

## Reference State

- Previous npm `latest`: `0.0.32`
- Previous GitHub release: `v0.0.32`
- Release branch: `codex/release-v0.0.33`
- Target tag: `v0.0.33`
- GitHub release workflow: `.github/workflows/release-public.yml`

## Release Delta

- Shipped centralized typed guidance recipes for workflow next-step guidance and repair examples.
- Hardened Pinterest browser-native Inspired Design harvest so concrete Pinterest pin evidence is collected while interface chrome remains diagnostic-only.
- Blocked Canvas continuation for non-ready Inspired Design evidence and prevented rejected Pinterest references from leaking into design-facing artifacts.
- Kept release-facing source metadata aligned with the `0.0.33` package version.

## Version Alignment

- `package.json`: `0.0.33`
- `package-lock.json`: `0.0.33`
- `extension/package.json`: `0.0.33`
- `extension/manifest.json`: `0.0.33`

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
  - `node scripts/provider-direct-runs.mjs --release-gate --out artifacts/release/v0.0.33/provider-direct-runs.json`
  - `node scripts/live-regression-direct.mjs --release-gate --out artifacts/release/v0.0.33/live-regression-direct.json`

## Implementation Proof

- [x] Typed guidance PR #67 merged: `https://github.com/freshtechbro/opendevbrowser/pull/67`
- [x] Pinterest harvest hardening PR #68 merged: `https://github.com/freshtechbro/opendevbrowser/pull/68`
- [x] PR #68 passed required checks before merge: audit-zombie-files, build, chrome-store-compliance-check, cli-help-parity, docs-drift-check, focused-regression-tests, lint, skill-assets, and typecheck.

## Local Release Gate Results

- `npm run extension:sync`: passed; synced `extension/manifest.json` and `extension/package.json` to `0.0.33`.
- `npm run version:check`: passed; version check reported `0.0.33`.
- `npm run test:release-gate`: passed; groups completed with `99`, `40`, `15`, `5`, and `1` tests.
- `node scripts/audit-zombie-files.mjs`: passed; scanned `1069` files and flagged `[]`.
- `node scripts/docs-drift-check.mjs`: initially caught stale `0.0.32` local tarball references in `docs/CLI.md` and `docs/FIRST_RUN_ONBOARDING.md`; after fixing those references, it passed with `ok: true`.
- `node scripts/chrome-store-compliance-check.mjs`: passed; manifest version was `0.0.33`.
- `./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh`: passed.
- `./skills/opendevbrowser-motion-design/scripts/validate-skill-assets.sh`: passed.
- `npx opendevbrowser --help`: passed with `814` help lines and expected lookup labels present.
- `npx opendevbrowser help`: passed with `814` help lines and expected lookup labels present.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `npm run extension:build`: passed.
- `npm run test`: passed with `278` test files passed, `1` skipped; `4635` tests passed, `1` skipped; coverage summary was statements `98.27`, branches `97.01`, functions `97.94`, and lines `98.37`.
- `npm run extension:pack`: passed; produced `opendevbrowser-extension.zip`.
- Extension zip SHA-256: `d3431fe03dfa0d11c1f4213d32fa1c0a3a346266c4bbabec8faaf3c67012282e`.
- `npm pack --pack-destination /tmp`: passed; produced `/tmp/opendevbrowser-0.0.33.tgz`.
- npm tarball details: package size `2.4 MB`, unpacked size `12.2 MB`, total files `1268`, npm shasum `9e8e9902796db4ad71178547f75d584498d97cd4`.
- npm tarball SHA-256: `2742f0b86009d5d35870e2b8558d552c6e7bcd27402aa17bce99086f2bae3ab5`.
- `git diff --check`: passed.

## External Release Workflow Evidence

- [x] Tag-driven release workflow run: `https://github.com/freshtechbro/opendevbrowser/actions/runs/26201899906`
- [x] Tag-driven release workflow result: failed at `Publish npm package` because the repository npm token could not publish `opendevbrowser@0.0.33`; earlier release metadata, install, version alignment, quality gates, extension packaging, and checksum generation passed.
- [x] Local npm publish fallback: `npm publish --access public --loglevel warn` completed successfully from `main` at tag `v0.0.33` after `version:check`, `build`, and `extension:build`.
- [x] npm publish verification (`npm view opendevbrowser version dist-tags --json`): returned version `0.0.33` and `latest` dist-tag `0.0.33`.
- [x] Registry consumer smoke: `node scripts/registry-consumer-smoke.mjs --version 0.0.33 --output artifacts/release/v0.0.33/registry-consumer-smoke.json` passed with `success: true`, `installAttempts: 1`, `helpAliasMatches: true`, `findItFastPresent: true`, `extensionDirExists: true`, `skillsDirExists: true`, and `versionMatches: true`.
- [x] GitHub release-only workflow run: `https://github.com/freshtechbro/opendevbrowser/actions/runs/26203570734`
- [x] GitHub release-only workflow result: passed in `4m13s`; release metadata, checkout, install, version alignment, full release quality gates, extension packaging, checksum generation, and GitHub release publication passed. npm publish and registry smoke were intentionally skipped because npm had already been published locally.
- [x] GitHub release URL: `https://github.com/freshtechbro/opendevbrowser/releases/tag/v0.0.33`
- [x] GitHub release verification: `v0.0.33` is not draft, not prerelease, published at `2026-05-21T03:29:22Z`, target commitish `main`.
- [x] GitHub release asset verification: `opendevbrowser-extension.zip`, size `176328`, digest `sha256:243e21259fae37101f0664cdf489564a072b96a8e9316b3ee04e6aa92f8af866`.
- [x] GitHub release asset verification: `opendevbrowser-extension.zip.sha256`, size `95`, digest `sha256:e0b7bdb268b3477dcee98a7f90f27d5758a746f9a8798e54082a519a73e7b881`.
- [x] Chrome Web Store manual publish status: skipped by request for `v0.0.33`.

## Notes

- Strict live gates are separate from release quality gates and are deferred unless specifically run.
- The npm account uses write 2FA. The expired local publish token caused prior `EOTP` behavior. A new granular publish token scoped to `opendevbrowser`, with bypass 2FA enabled, read/write package access, no organization access, and maximum UI expiry through `2026-08-18`, was generated and configured in local `~/.npmrc` with file mode `600`.
- The release-only workflow emitted a GitHub Actions annotation that Node.js 20 actions are deprecated and will be forced to Node.js 24 by default starting `2026-06-02`; this is a follow-up maintenance item, not a `v0.0.33` release blocker.
