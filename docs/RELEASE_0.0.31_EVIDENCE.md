# v0.0.31 Release Evidence

Status: active release ledger
Target release date: 2026-05-17
Target tag: `v0.0.31`

## Scope

Tracks the `0.0.31` release cycle for the PR #58/#59 OpenCode update-cache hardening follow-up.

## Reference State

- Previous npm `latest`: `0.0.30`
- Previous GitHub release: `v0.0.30`
- Release branch: `main`
- Target tag: `v0.0.31`
- GitHub release workflow: `.github/workflows/release-public.yml`
- Local npm auth: `npm whoami` returned `bishopdotun`
- Shell `NPM_TOKEN`: not set

## Release Delta

- `opendevbrowser --update` now consistently describes its scope as OpenCode package cache repair plus managed skill refresh.
- Update troubleshooting docs explicitly mention the active OpenCode alias cache path `~/.cache/opencode/packages/opendevbrowser@latest/`.
- The update command is covered through the real CLI entrypoint path with isolated `OPENCODE_CACHE_DIR`.
- The OpenCode package alias cache assumption is documented in code and verified by tests while preserving unrelated package aliases.

## Version Alignment

- `package.json`: `0.0.31`
- `package-lock.json`: `0.0.31`
- `extension/package.json`: `0.0.31`
- `extension/manifest.json`: `0.0.31`

## Mandatory Local Release Gates

- [x] `npm run extension:sync`
- [x] `npm run version:check`
- [x] `npm run test:release-gate`
- [x] `node scripts/audit-zombie-files.mjs`
- [x] `node scripts/docs-drift-check.mjs`
- [x] `node scripts/chrome-store-compliance-check.mjs`
- [x] `./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh`
- [x] `npx opendevbrowser --help`
- [x] `npx opendevbrowser help`
- [x] `npm run lint`
- [x] `npm run typecheck`
- [x] `npm run test`
- [x] `npm run build`
- [x] `npm run extension:build`
- [x] `npm run extension:pack`
- [x] `npm pack --pack-destination /tmp`

## Optional Strict Live Gates

- [ ] Deferred unless explicitly required for this release:
  - `node scripts/provider-direct-runs.mjs --release-gate --out artifacts/release/v0.0.31/provider-direct-runs.json`
  - `node scripts/live-regression-direct.mjs --release-gate --out artifacts/release/v0.0.31/live-regression-direct.json`

## Implementation Proof

- [x] PR #58 merged: `https://github.com/freshtechbro/opendevbrowser/pull/58`
- [x] Follow-up PR #59 merged: `https://github.com/freshtechbro/opendevbrowser/pull/59`
- [x] RepoPrompt rereview for PR #59 found no remaining P0/P1/P2 issues.
- [x] Built CLI smoke with isolated OpenCode cache removed `packages/opendevbrowser@latest`, `node_modules/opendevbrowser`, and `package-lock.json` while preserving unrelated package aliases.
- [x] Full test gate before release prep passed:
  - Command: `npm run test`
  - Result: 271 files passed, 1 skipped; 4418 tests passed, 1 skipped; all-files coverage 98.22% statements, 97% branches, 97.95% functions, 98.29% lines.

## Local Release Gate Results

- `npm run extension:sync`: passed; extension version metadata already at `0.0.31`.
- `npm run version:check`: passed; version check reported `0.0.31`.
- `npm run test:release-gate`: passed.
  - Group 1 provider-direct-contracts: 2 files, 99 tests passed.
  - Group 2 live-direct-regression-contracts: 3 files, 37 tests passed.
  - Group 3 cli-help-parity: 1 file, 15 tests passed.
  - Group 4 docs-and-zombie-audits: 2 files, 5 tests passed.
  - Group 5 chrome-store-compliance: 1 file, 1 test passed.
- `node scripts/audit-zombie-files.mjs`: passed; scanned 1029 files and flagged none.
- `node scripts/docs-drift-check.mjs`: passed after refreshing stale `0.0.30` package references to `0.0.31`.
- `node scripts/chrome-store-compliance-check.mjs`: passed with manifest version `0.0.31`.
- `./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh`: passed; 22 referenced files present and 10 JSON templates parsed.
- `npx opendevbrowser --help`: passed; generated 798 lines.
- `npx opendevbrowser help`: passed; generated 798 lines.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `npm run extension:build`: passed.
- `npm run test`: passed.
  - Test files: 271 passed, 1 skipped.
  - Tests: 4418 passed, 1 skipped.
  - Coverage: 98.22% statements, 97% branches, 97.95% functions, 98.29% lines.
- `npm run extension:pack`: passed; produced `opendevbrowser-extension.zip`.
  - SHA256: `08dd5189bb7781d38c891f7e896936c1a88f693dc26b6fe8f2267473ba74c3fb`
- `npm pack --pack-destination /tmp`: passed; produced `/tmp/opendevbrowser-0.0.31.tgz`.
  - Package size: 2.3 MB.
  - Unpacked size: 11.6 MB.
  - Total files: 1218.
  - SHA256: `29079292e7adf21bf0eb61f7449b1aa3553d9ed0d1ad3fa806da4c3061c57ee3`
- `git diff --check`: passed.

## External Release Workflow Evidence

- [ ] Release workflow run URL
- [ ] npm publish verification
- [ ] Registry consumer smoke
- [ ] GitHub release URL
- [ ] GitHub release asset verification
- [ ] Chrome Web Store manual publish status

## Notes

- Strict live gates are separate from release quality gates and are deferred unless specifically run.
- If the tag-driven release workflow cannot publish npm because repository `NPM_TOKEN` is unavailable, use local npm auth to publish and rerun the GitHub release artifact path with npm publication disabled.
