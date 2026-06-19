# v0.0.36 Release Evidence

Status: released
Target release date: 2026-06-19
Target tag: `v0.0.36`

## Scope

Tracks the `0.0.36` release cycle for the AGENTS guidance and generated-artifact cleanup contract update.

Current status note:
- Source version metadata is aligned from `0.0.35` to `0.0.36`.
- `opendevbrowser@0.0.36` was verified absent from npm before release prep.
- `opendevbrowser@0.0.35` and GitHub release `v0.0.35` already exist, so this release uses the next patch version.

## Reference State

- Previous npm `latest`: `0.0.35`
- Previous GitHub release: `v0.0.35`
- Release source branch: `codex/audit-agents-and-clean-artifacts`
- Target tag: `v0.0.36`
- GitHub release workflow: `.github/workflows/release-public.yml`

## Release Delta

- Updated root and layered `AGENTS.md` guidance for current source modules, provider workflow artifact storage, release evidence pointers, and safe generated-output cleanup.
- Documented `page.dialog` in the extension ops command inventory.
- Removed stale local prompt-export and transient skill-pack planning references from tracked plan and review docs.
- Cleaned generated workflow and test artifacts while preserving tracked `.opendevbrowser/canvas/adapters.json`.

## Version Alignment

- `package.json`: `0.0.36`
- `package-lock.json`: `0.0.36`
- `extension/package.json`: `0.0.36`
- `extension/manifest.json`: `0.0.36`

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

- [x] `node scripts/provider-direct-runs.mjs --release-gate --out artifacts/release/v0.0.36/provider-direct-runs.json`
- [x] `node scripts/live-regression-direct.mjs --release-gate --out artifacts/release/v0.0.36/live-regression-direct.json`

## Local Release Gate Results

- `npm run extension:sync`: passed. Extension metadata was already at `0.0.36`.
- `npm run version:check`: passed. Root package, lockfile, lockfile root package, extension package, and extension manifest all report `0.0.36`.
- `git diff --check`: passed.
- `node scripts/docs-drift-check.mjs`: passed with 77 CLI commands, 70 tools, 59 `/ops` commands, and 35 `/canvas` commands.
- `node scripts/audit-zombie-files.mjs`: passed with `scanned: 1145`, `flagged: []`.
- `node scripts/chrome-store-compliance-check.mjs`: passed for MV3 extension version `0.0.36`.
- `./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh`: passed with 22 referenced files and 10 JSON templates validated.
- `./skills/opendevbrowser-motion-design/scripts/validate-skill-assets.sh`: passed.
- `npx opendevbrowser --help`: passed after clearing a stale npm `_npx` cache symlink collision.
- `npx opendevbrowser help`: passed.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm run test:release-gate`: passed all five release groups, 160 tests total.
- `npm run test`: passed. 290 test files passed, 1 skipped live Figma smoke, 5,291 tests passed, 1 skipped. Coverage summary reported global branch coverage at 97%.
- Raw branch coverage from `coverage/lcov.info`: 24,639 covered branches out of 25,399 total, 97.007756210874%. Required covered branches for 97% is 24,638, so the branch deficit is 0.
- `npm run build`: passed.
- `npm run extension:build`: passed.
- `npm run extension:pack`: passed. `opendevbrowser-extension.zip` SHA-256: `742fa6d180f552909bc5a428781ed4237b1aa769464f6ad0973360f1fb07563e`.
- `npm pack`: passed. Produced `opendevbrowser-0.0.36.tgz`; package size 2.8 MB; unpacked size 14.1 MB; total files 1,346; npm shasum `2c38d6ba3eadbc164af149569098013b77274816`; local SHA-256 `3c7e4545f7cc0453e8eed2f8836e761fe875c349dda2ea029909d963476e6f54`.
- `node scripts/live-regression-direct.mjs --release-gate --out artifacts/release/v0.0.36/live-regression-direct.json`: passed on rerun with current daemon. Counts: 6 pass, 0 expected timeout, 0 env-limited, 0 fail, 2 skipped manual annotation boundary probes.
- `node scripts/provider-direct-runs.mjs --release-gate --out artifacts/release/v0.0.36/provider-direct-runs.json`: completed but did not pass strict optional live mode in this local environment. Counts: 14 pass, 15 env-limited, 1 fail. Non-green cases were external-provider auth, policy, token, extension preflight, or no-record conditions. This optional strict live lane is retained as evidence but is not a required tag workflow gate because `.github/workflows/release-public.yml` runs strict live gates only when `run_release_live_gates=true`.

## External Release Evidence

- Release PR: `https://github.com/freshtechbro/opendevbrowser/pull/88`
- Merge commit: `8ea77b35591e77c848d7cff004c2719ebca69b91`
- npm package: `opendevbrowser@0.0.36`
- npm `latest` dist-tag: `0.0.36`
- npm tarball: `https://registry.npmjs.org/opendevbrowser/-/opendevbrowser-0.0.36.tgz`
- npm shasum: `2c38d6ba3eadbc164af149569098013b77274816`
- GitHub release: `https://github.com/freshtechbro/opendevbrowser/releases/tag/v0.0.36`
- GitHub release workflow: `https://github.com/freshtechbro/opendevbrowser/actions/runs/27803202778`
- Release workflow result: success.
- Release tag `v0.0.36` points to `8ea77b35591e77c848d7cff004c2719ebca69b91`.
- Release asset verification: downloaded `opendevbrowser-extension.zip` validated successfully against `opendevbrowser-extension.zip.sha256`.

## Post-Release Verification

- [x] `npm view opendevbrowser version dist-tags --json` returns `0.0.36` and `latest: 0.0.36`.
- [x] `node scripts/registry-consumer-smoke.mjs --version 0.0.36 --output artifacts/release/v0.0.36/registry-consumer-smoke.json` passes.
- [x] GitHub release `v0.0.36` exists and includes `opendevbrowser-extension.zip` plus `opendevbrowser-extension.zip.sha256`.

## Out Of Scope

- Chrome Web Store publication is not part of this release unless explicitly triggered separately.
