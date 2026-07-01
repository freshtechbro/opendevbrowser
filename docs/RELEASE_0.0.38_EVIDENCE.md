# v0.0.38 Release Evidence

Status: local release prep in progress; npm publish, GitHub release, push, PR, and merge intentionally deferred
Target release date: 2026-07-01
Target tag: `v0.0.38`

## Scope

Tracks the `0.0.38` release cycle through local release-prep commits only. This ledger records version alignment, local prep gates, external absence checks, and release blockers before QA or publish execution. It is not final release proof: PR/merge, npm publish, registry-consumer smoke, GitHub release assets, checksum verification, and Chrome Web Store publication remain pending or blocked as noted below.

Current status note:
- Source version metadata is aligned from `0.0.37` to `0.0.38`.
- npm `opendevbrowser` latest remains `0.0.37`; `opendevbrowser@0.0.38` is absent before publish.
- GitHub release `v0.0.38` is absent before release workflow dispatch.
- Local-token release order later is npm publish first, then GitHub release workflow dispatch with `publish_npm=false`.
- Chrome Web Store upload/publish remains blocked because required CWS credentials/session are unavailable.

## Reference State

- Previous npm `latest`: `0.0.37`
- Previous GitHub release: `v0.0.37`
- Release source branch: `codex/release-0.0.38`
- Target tag: `v0.0.38`
- GitHub release workflow: `.github/workflows/release-public.yml`
- Chrome Web Store workflow: `.github/workflows/chrome-store-publish.yml`

## Release Delta

- Prepared the next patch release after `0.0.37` without changing runtime behavior.
- Updated package, lockfile, extension, changelog, runbook, and active evidence references for `0.0.38`.
- Preserved local-only release preparation constraints: no npm publish, no GitHub release creation, no push, no PR, and no merge.

## Version Alignment

- `package.json`: `0.0.38`
- `package-lock.json`: `0.0.38`
- `extension/package.json`: `0.0.38`
- `extension/manifest.json`: `0.0.38`

## Mandatory Local Release Prep Gates

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

## Optional Strict Live Gates

- [ ] `node scripts/provider-direct-runs.mjs --release-gate --out artifacts/release/v0.0.38/provider-direct-runs.json`
- [ ] `node scripts/live-regression-direct.mjs --release-gate --out artifacts/release/v0.0.38/live-regression-direct.json`

Decision: deferred for local release prep. The strict live lane remains optional in `docs/RELEASE_RUNBOOK.md`; it should be enabled through the release workflow only when `run_release_live_gates=true`.

## Local Release Prep Gate Results

- `npm version 0.0.38 --no-git-tag-version`: passed and updated root package metadata without creating a git tag.
- `npm run extension:sync`: passed and synced `extension/manifest.json` plus `extension/package.json` to `0.0.38`.
- `npm run version:check`: passed, version check reported `0.0.38`.
- `node scripts/docs-drift-check.mjs`: passed with `ok: true`, version `0.0.38`, 77 CLI commands, 70 tools, 59 `/ops` commands, and 41 `/canvas` commands.
- `git diff --check`: passed.
- `npm ci`: passed after dependencies were missing in the resumed worktree; npm reported 13 existing audit vulnerabilities.
- Initial `npm run test:release-gate`: could not start before `npm ci` because `node_modules/vitest/vitest.mjs` was missing.
- `node scripts/chrome-store-compliance-check.mjs`: passed with `ok: true`, manifest version 3, extension version `0.0.38`, and no failed checks.
- `npm run test:release-gate`: passed after `npm ci`; groups 1 through 5 passed with 99, 40, 18, 5, and 1 tests respectively.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `npm run extension:build`: passed and confirmed extension metadata already at `0.0.38`.

## External Pre-Publish Checks

- `npm view opendevbrowser version dist-tags --json`: returned package version `0.0.37` and `latest: 0.0.37`.
- `npm view opendevbrowser@0.0.38 version --json`: returned `E404`, confirming `0.0.38` is absent before local publish.
- `gh release view v0.0.38 --json tagName,url,isDraft,name`: returned `release not found`.

## Deferred Publish/Release Steps

Do not execute during local release prep. After this branch is merged and QA approves:

1. Publish npm locally with `npm publish --access public` from the merged release commit.
2. Run `node scripts/registry-consumer-smoke.mjs --version 0.0.38 --output artifacts/release/v0.0.38/registry-consumer-smoke.json`.
3. Dispatch `.github/workflows/release-public.yml` with `release_ref=main`, `release_tag=v0.0.38`, `publish_npm=false`, `publish_github_release=true`, `draft_release=false`, and `run_release_live_gates=false`.
4. Verify the GitHub release assets and checksum.

## Chrome Web Store Release Lane

- Status: blocked pending Chrome Web Store credentials or an authenticated dashboard session.
- Required GitHub secrets from `.github/workflows/chrome-store-publish.yml`: `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`, and `CWS_EXTENSION_ID`.
- Manual upload can proceed once a CWS-authenticated dashboard or the four CWS workflow secrets are available.

## Out Of Scope

- npm publish.
- GitHub release creation.
- Push, PR, or merge.
- Chrome Web Store upload or publish.
- Website deploy cutover, governed by `docs/CUTOVER_CHECKLIST.md` and the private website repository.
