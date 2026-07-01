# v0.0.38 Release Evidence

Status: released and verified
Release date: 2026-07-01
Tag: `v0.0.38`
Release URL: https://github.com/freshtechbro/opendevbrowser/releases/tag/v0.0.38

## Scope

Tracks the `0.0.38` release cycle from local release preparation through npm publish, registry smoke, GitHub release, and post-release verification. Chrome Web Store publication was not attempted because credentials or an authenticated dashboard session were not established.

## Final Release State

- npm package: `opendevbrowser@0.0.38`
- npm `latest`: `0.0.38`
- npm tarball shasum: `5631700a972a375c2da0fac46ec5e3ab154e79f0`
- Release tag: `v0.0.38`
- Tag target: `b45babc2235585c4d8e1759232348e6e3e3d5bcc`
- GitHub release: https://github.com/freshtechbro/opendevbrowser/releases/tag/v0.0.38
- Successful release workflow run: https://github.com/freshtechbro/opendevbrowser/actions/runs/28550839407
- Chrome Web Store: not attempted, blocked until CWS credentials or authenticated dashboard session are available.

## Release History

- PR #103, `chore: prepare 0.0.38 release`, merged at `42263e4d058a106fb90106ccb3f2c324ac550f8c`.
- Initial GitHub release workflow run `28548069523` failed at `42263e4d058a106fb90106ccb3f2c324ac550f8c` because coverage was `96.99%`, below the required release threshold.
- PR #104, `test: raise release branch coverage margin`, merged at `b45babc2235585c4d8e1759232348e6e3e3d5bcc`.
- GitHub release workflow run `28550839407` succeeded at `b45babc2235585c4d8e1759232348e6e3e3d5bcc` and published `v0.0.38` release assets.

## Version Alignment

- `package.json`: `0.0.38`
- `package-lock.json`: `0.0.38`
- `extension/package.json`: `0.0.38`
- `extension/manifest.json`: `0.0.38`

## Local Release Prep Gates

- [x] `npm version 0.0.38 --no-git-tag-version`
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

## Full Gate Matrix Rerun - 2026-07-01

Evidence directory: `.opendevbrowser/release-gates-0.0.38-20260701T201057Z/`

- Formatter: not available; `package.json` has no formatter script.
- `git status --short --branch`: passed before and after gates; branch remained `codex/release-0.0.38` ahead of `origin/main` by two commits with no tracked file changes from generated artifacts before the local ledger update.
- `git diff --check`: passed in 0s.
- `npm run lint`: passed in 23s.
- `npm run typecheck`: passed in 4s.
- `npm run version:check`: passed in 0s.
- `npm run build`: passed in 5s.
- `npm run extension:build`: passed in 2s.
- `npm run test`: passed in 475s. Coverage branch math from `coverage/lcov.info`: 25,986 covered of 26,789 branches, 97.0025%.
- `node scripts/docs-drift-check.mjs`: passed in 1s.
- `node scripts/audit-zombie-files.mjs`: passed in 0s.
- `node scripts/chrome-store-compliance-check.mjs`: passed in 0s.
- `./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh`: passed in 1s.
- `./skills/opendevbrowser-motion-design/scripts/validate-skill-assets.sh`: passed in 0s.
- `npx opendevbrowser --help`: passed in 2s.
- `npx opendevbrowser help`: passed in 0s.
- `npm run extension:pack`: passed in 1s and created ignored artifact `opendevbrowser-extension.zip` at 186 KB.
- `npm pack --dry-run`: passed in 15s and reported `opendevbrowser-0.0.38.tgz`, package size 3.0 MB, unpacked size 14.8 MB, shasum `799e5db38d2ce21c847f1d09a90c8f53bdea2c45`, integrity `sha512-xPZIiYNxBb3B8[...]zvLMJ7Ssh0fvQ==`, total files 1356. No publish was performed during local prep.

Note: two initial validator attempts used non-existent `.mjs` paths and failed with `MODULE_NOT_FOUND`; these were command-selection mistakes, not release defects. The exact runbook shell validators above passed.

## npm Publish Evidence

Verified with `npm view opendevbrowser version dist-tags dist.shasum --json` and `npm view opendevbrowser@0.0.38 version dist.shasum dist.integrity --json` on 2026-07-01:

- Published package: `opendevbrowser@0.0.38`
- npm `latest`: `0.0.38`
- shasum: `5631700a972a375c2da0fac46ec5e3ab154e79f0`
- integrity: `sha512-sJKfiuATYroZRQPnF+jYXJtR8gmfUUkMgXxlVcifEpW3DdV9G36qhQdlIaN9s1WPdDIdBJhYhKVYjMhppAbJ6A==`

## Registry Consumer Smoke

- Result: passed.
- Evidence path: `artifacts/release/v0.0.38/registry-consumer-smoke.json`.
- Purpose: verified a registry consumer can install and smoke `opendevbrowser@0.0.38` from npm after publish.

## GitHub Release Evidence

Verified with `gh release view v0.0.38 --repo freshtechbro/opendevbrowser --json tagName,targetCommitish,url,isDraft,isPrerelease,assets` and `git ls-remote --tags origin v0.0.38` on 2026-07-01:

- Release URL: https://github.com/freshtechbro/opendevbrowser/releases/tag/v0.0.38
- Release is draft: `false`
- Release is prerelease: `false`
- Tag `v0.0.38` points to `b45babc2235585c4d8e1759232348e6e3e3d5bcc`.
- Asset `opendevbrowser-extension.zip`: size `190671`, digest `sha256:e9a294e02b2b699df6276c883373332f2f287a8181738f4b074d58e267a9c89b`.
- Asset `opendevbrowser-extension.zip.sha256`: size `95`.
- Checksum verification: `e9a294e02b2b699df6276c883373332f2f287a8181738f4b074d58e267a9c89b OK`.

## GitHub Workflow Evidence

- Failed initial release workflow: run `28548069523`, completed with `failure`, URL https://github.com/freshtechbro/opendevbrowser/actions/runs/28548069523.
- Failure reason: coverage `96.99%` blocked the release gate.
- Coverage fix: PR #104 merged at `b45babc2235585c4d8e1759232348e6e3e3d5bcc`.
- Successful release workflow: run `28550839407`, completed with `success`, URL https://github.com/freshtechbro/opendevbrowser/actions/runs/28550839407.

## Chrome Web Store Release Lane

- Status: not attempted.
- Blocker: Chrome Web Store credentials or an authenticated dashboard session were not established.
- Required GitHub secrets from `.github/workflows/chrome-store-publish.yml`: `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`, and `CWS_EXTENSION_ID`.
- Manual upload can proceed once a CWS-authenticated dashboard or the four CWS workflow secrets are available.

## Out Of Scope For This Evidence Update

- npm publish, already completed before this ledger update.
- GitHub release creation, already completed before this ledger update.
- Creating or moving tags.
- Chrome Web Store upload or publish.
- Website deploy cutover, governed by `docs/CUTOVER_CHECKLIST.md` and the private website repository.
