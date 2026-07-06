# v0.0.40 Release Evidence

Status: release prep complete; external publish pending
Release date: 2026-07-06 UTC, pending final publish
Tag: `v0.0.40`
Release URL: pending

## Scope

Tracks the `0.0.40` release cycle from local release preparation through npm publish, registry smoke, GitHub release, and Chrome Web Store manual release evidence or exact browser-visible blocker.

## Final Release State

- npm package: pending
- npm `latest`: pending
- npm tarball shasum: pending
- npm tarball integrity: pending
- Release tag: pending
- Tag target: pending
- GitHub release: pending
- Successful release workflow run: pending
- Chrome Web Store: pending manual browser release or exact auth/session blocker.

## Release History

- Release prep branch: `codex/release-0.0.40`.
- Release prep base: `fe15388eae1ad260341877b2feb9d58da019f2d6`.
- npm publish: pending local-auth publish for `opendevbrowser@0.0.40`.
- GitHub release workflow: pending dispatch with `publish_npm=false`, `publish_github_release=true`, `draft_release=false`, and `run_release_live_gates=false`.
- Chrome Web Store manual release: pending browser dashboard flow.

## Version Alignment

- `package.json`: `0.0.40`
- `package-lock.json`: `0.0.40`
- `extension/package.json`: `0.0.40`
- `extension/manifest.json`: `0.0.40`

## Dependency And Audit Evidence

- `package.json` dependency ranges were not changed for this release prep.
- `npm ci`: passed from the current lockfile.
- `npm audit --omit=dev`: passed with `found 0 vulnerabilities`.
- `npm audit --audit-level=moderate`: passed. Residual advisory is one low-severity dev-only `esbuild` advisory from the current toolchain range, below the release audit gate.

## Local Release Prep Gates

- [x] `npm version 0.0.40 --no-git-tag-version`
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

Evidence directory: `artifacts/release/v0.0.40/`

- Formatter: not available. `package.json` has no formatter script.
- `git status --short --branch`: release-prep branch dirty only with intended tracked release files plus preserved unrelated untracked investigation/review docs.
- `git diff --check`: passed in the local gate set and rerun after review-driven doc edits.
- `npm ci`: passed.
- `npm audit --omit=dev`: passed with `found 0 vulnerabilities`.
- `npm audit --audit-level=moderate`: passed with only the existing low-severity dev-only `esbuild` advisory.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm run version:check`: passed with `0.0.40`.
- `npm run build`: passed.
- `npm run extension:build`: passed.
- `npm run test`: passed, 302 files passed, 1 skipped; 5802 tests passed, 1 skipped; branch coverage `26831/27655 = 97.02043030193454%`.
- `node scripts/docs-drift-check.mjs`: passed.
- `node scripts/audit-zombie-files.mjs`: passed.
- `node scripts/chrome-store-compliance-check.mjs`: passed.
- `./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh`: passed.
- `./skills/opendevbrowser-motion-design/scripts/validate-skill-assets.sh`: passed.
- `npx opendevbrowser --help`: passed.
- `npx opendevbrowser help`: passed.
- `npm run extension:pack`: passed and produced `opendevbrowser-extension.zip` locally for packaging proof.
- `npm pack --dry-run`: passed through `prepack`, `npm run version:check`, `npm run build`, and `npm run extension:build`; dry-run tarball inventory reported `opendevbrowser-0.0.40.tgz`, package size `3.0 MB`, unpacked size `15.2 MB`, total files `1390`, shasum `47a2437ec3853e471b68eae3791207deb11e66dd`.

## Live Release Gate Evidence

- Strict live release gates are deferred unless explicitly enabled for this release run. If deferred, record that `run_release_live_gates=false` was used for GitHub release workflow dispatch and keep this distinct from grouped contract gates.

## npm Publish Evidence

Prepublish baseline captured before local release prep publish:

- Evidence path: `.omo/ulw-loop/release-0-0-40-2026-07-06/evidence/prepublish-absence-and-auth.txt`.
- `npm view opendevbrowser version dist-tags --json`: reported version `0.0.39` and `latest` `0.0.39`.
- `npm view opendevbrowser@0.0.40 version`: returned `E404` before publish, confirming the version was absent.
- `gh release view v0.0.40`: returned release not found.
- `git ls-remote --tags origin v0.0.40`: returned no refs.
- `npm whoami`: authenticated successfully with identity redacted.

Final duplicate-release recheck after release prep merge and immediately before `npm publish`: pending.

Publish result: pending.

## Registry Consumer Smoke

- Result: pending.
- Evidence path: `artifacts/release/v0.0.40/registry-consumer-smoke.json`.
- Purpose: verify a registry consumer can install and smoke `opendevbrowser@0.0.40` from npm after publish.

## GitHub Release Evidence

Workflow dispatch after npm publish:

```bash
gh workflow run release-public.yml \
  -f release_ref=main \
  -f release_tag=v0.0.40 \
  -F publish_npm=false \
  -F publish_github_release=true \
  -F draft_release=false \
  -F run_release_live_gates=false
```

- Release URL exists for `v0.0.40`: pending.
- Release is draft: pending.
- Release is prerelease: pending.
- Release published at: pending.
- Tag `v0.0.40` points to: pending.
- Release target commitish: pending.
- Asset `opendevbrowser-extension.zip`: pending.
- Asset `opendevbrowser-extension.zip.sha256`: pending.
- Checksum verification: pending.

## GitHub Workflow Evidence

- Successful release workflow: pending.
- Workflow job: pending.
- Workflow head SHA: pending.
- Workflow inputs: `release_ref=main`, `release_tag=v0.0.40`, `publish_npm=false`, `publish_github_release=true`, `draft_release=false`, `run_release_live_gates=false`.

## Chrome Web Store Release Lane

- Status: pending manual browser flow.
- Required artifact: GitHub release `opendevbrowser-extension.zip` for `v0.0.40`.
- Required proof: redacted Chrome Web Store Developer Dashboard screenshot or action log showing uploaded/submitted version `0.0.40`, or an exact browser-visible auth/account/session blocker.
- Secrets and private account identifiers must not appear in screenshots, logs, or copied JSON.

## Out Of Scope For This Evidence Update

- Website deploy cutover, governed by `docs/CUTOVER_CHECKLIST.md` and the private website repository.
