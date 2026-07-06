# v0.0.40 Release Evidence

Status: npm and GitHub released; Chrome Web Store manual lane blocked on dashboard authentication
Release date: 2026-07-06 UTC
Tag: `v0.0.40`
Release URL: `https://github.com/freshtechbro/opendevbrowser/releases/tag/v0.0.40`

## Scope

Tracks the `0.0.40` release cycle from local release preparation through npm publish, registry smoke, GitHub release, and Chrome Web Store manual release evidence or exact browser-visible blocker.

## Final Release State

- npm package: `opendevbrowser@0.0.40` published.
- npm `latest`: `0.0.40`.
- npm tarball shasum: `47a2437ec3853e471b68eae3791207deb11e66dd`.
- npm tarball integrity: `sha512-wG/PO9hI7mQEJFETjyDYqc+neWHqZS+YvTduK+haOemQN2ha9ZtoGZw51/Tk9hhdhr6Ih6W96iERkn/RG/zPPg==`.
- Release tag: `v0.0.40`.
- Tag target: `16e8bae0ca9766e8674ec28ef56005d22faa5712`.
- GitHub release: published, not draft, not prerelease.
- Successful release workflow run: `https://github.com/freshtechbro/opendevbrowser/actions/runs/28811136824`.
- Chrome Web Store: blocked by browser-visible Google account chooser/auth requirement before upload controls.

## Release History

- Release prep branch: `codex/release-0.0.40`.
- Release prep base: `fe15388eae1ad260341877b2feb9d58da019f2d6`.
- Release prep PR: `https://github.com/freshtechbro/opendevbrowser/pull/112`, merged at `2026-07-06T17:37:18Z`.
- Release prep merge commit: `16e8bae0ca9766e8674ec28ef56005d22faa5712`.
- npm publish: local-auth publish succeeded for `opendevbrowser@0.0.40`.
- GitHub release workflow: dispatch succeeded with `publish_npm=false`, `publish_github_release=true`, `draft_release=false`, and `run_release_live_gates=false`.
- Chrome Web Store manual release: attempted via browser, blocked by Google account chooser/auth requirement before upload controls.

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

Final duplicate-release recheck after release prep merge and immediately before `npm publish`: passed.

Publish result: `npm publish --access public` succeeded with `+ opendevbrowser@0.0.40`.

Post-publish registry verification:

- Evidence path: `.omo/ulw-loop/release-0-0-40-2026-07-06/evidence/npm-registry-view-0.0.40.json`.
- `npm view opendevbrowser@0.0.40 version dist-tags dist.shasum dist.integrity --json` returned version `0.0.40`, `latest` `0.0.40`, shasum `47a2437ec3853e471b68eae3791207deb11e66dd`, and integrity `sha512-wG/PO9hI7mQEJFETjyDYqc+neWHqZS+YvTduK+haOemQN2ha9ZtoGZw51/Tk9hhdhr6Ih6W96iERkn/RG/zPPg==`.

## Registry Consumer Smoke

- Result: passed.
- Evidence path: `artifacts/release/v0.0.40/registry-consumer-smoke.json`.
- Purpose: verify a registry consumer can install and smoke `opendevbrowser@0.0.40` from npm after publish.
- Key checks: `success=true`, `version=0.0.40`, `installAttempts=1`, `helpAliasMatches=true`, `findItFastPresent=true`, `extensionDirExists=true`, `skillsDirExists=true`, and `versionMatches=true`.

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

- Release URL exists for `v0.0.40`: `https://github.com/freshtechbro/opendevbrowser/releases/tag/v0.0.40`.
- Release is draft: `false`.
- Release is prerelease: `false`.
- Release published at: `2026-07-06T17:45:25Z`.
- Tag `v0.0.40` points to: `16e8bae0ca9766e8674ec28ef56005d22faa5712`.
- Release target commitish: `main`.
- Asset `opendevbrowser-extension.zip`: uploaded, size `190671`, digest `sha256:9847e61c6a3886b3162039af3327496a38e737c3ad2113e90530c5afe6f29098`.
- Asset `opendevbrowser-extension.zip.sha256`: uploaded, size `95`, digest `sha256:ee67ad29394603de4f6bedf21310a29cc6a82d31684c07d31eddc3788760ca30`.
- Checksum verification: passed, `opendevbrowser-extension.zip: OK`.

## GitHub Workflow Evidence

- Successful release workflow: `https://github.com/freshtechbro/opendevbrowser/actions/runs/28811136824`.
- Workflow job: release completed in `6m13s`.
- Workflow head SHA: `16e8bae0ca9766e8674ec28ef56005d22faa5712`.
- Workflow inputs: `release_ref=main`, `release_tag=v0.0.40`, `publish_npm=false`, `publish_github_release=true`, `draft_release=false`, `run_release_live_gates=false`.
- Skipped steps were intentional by input: strict live release gates, npm package publish, and workflow registry consumer smoke. Local gates, local npm publish, and local registry smoke are recorded above.

## Chrome Web Store Release Lane

- Status: blocked by exact browser-visible authentication/session requirement.
- Required artifact: GitHub release `opendevbrowser-extension.zip` for `v0.0.40`.
- Required proof retained: redacted account-chooser screenshot and sanitized browser action log under `.omo/ulw-loop/release-0-0-40-2026-07-06/evidence/browser/`.
- Browser-visible blocker: Google account chooser for `accounts.google.com/v3/signin/accountchooser` with `service=chromewebstore` before reaching Developer Dashboard upload controls.
- Managed evidence run: isolated no-extension browser session captured OpenDevBrowser blocker `auth_required` with reason code `token_required`; `googleAuthIntent=none`, `authProof=none`, and Google-sensitive cookies skipped.
- Real Chrome attempt: opening the Developer Dashboard package URL redirected to account chooser; macOS Computer Use could not bind the Chrome window and OS screencapture returned unusable black output, so no private logged-in Chrome screenshot was retained.
- No Chrome Web Store upload or submit-for-review action was performed because an authenticated dashboard session was not available to this automation lane.
- Secrets and private account identifiers were excluded: raw/private screenshots were removed, the retained screenshot is redacted, and scoped evidence scan found no token, secret, email, or Chrome profile database path.

## Out Of Scope For This Evidence Update

- Website deploy cutover, governed by `docs/CUTOVER_CHECKLIST.md` and the private website repository.
