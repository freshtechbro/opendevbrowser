# v0.0.37 Release Evidence

Status: local release gates passed, PR pending
Target release date: 2026-06-28
Target tag: `v0.0.37`

## Scope

Tracks the `0.0.37` release cycle for the Inspiredesign product-authority and output-specificity closeout.

Current status note:
- Source version metadata is aligned from `0.0.36` to `0.0.37`.
- `opendevbrowser@0.0.37` must be verified absent from npm before local publish.
- `opendevbrowser@0.0.36` and GitHub release `v0.0.36` already exist, so this release uses the next patch version.

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

- Release PR: pending.
- Merge commit: pending.
- npm package: pending.
- npm `latest` dist-tag: pending.
- npm tarball: pending.
- npm shasum: pending.
- GitHub release: pending.
- GitHub release workflow: pending.
- Release workflow result: pending.
- Release tag `v0.0.37`: pending.
- Release asset verification: pending.

## Post-Release Verification

- [ ] `npm view opendevbrowser version dist-tags --json` returns `0.0.37` and `latest: 0.0.37`.
- [ ] `node scripts/registry-consumer-smoke.mjs --version 0.0.37 --output artifacts/release/v0.0.37/registry-consumer-smoke.json` passes.
- [ ] GitHub release `v0.0.37` exists and includes `opendevbrowser-extension.zip` plus `opendevbrowser-extension.zip.sha256`.

## Chrome Web Store Release Lane

- Status: pending manual release lane.
- Evidence to retain:
  - Chrome Store publish workflow URL or local upload/publish JSON output summary.
  - Store listing URL and visible version.
  - Listing-copy or generated-asset review note for browser replay, desktop observation, and browser-scoped computer-use boundary wording.

## Out Of Scope

- Website deploy cutover remains governed by `docs/CUTOVER_CHECKLIST.md` and the private website repository.
