# v0.0.24 Release Evidence

Status: active release ledger
Target release date: 2026-04-20  
Last updated: 2026-04-20

## Scope

Tracks the `0.0.24` release cycle for the merged OpenCode startup fix and its follow-up lazy-cwd regression fix, plus the version bump, packaging proof, and multi-platform publication evidence.

## Baseline comparison

- Reference release: GitHub `v0.0.23`
  - Published npm `latest`: `0.0.23`
  - Target: `main`
  - GitHub release assets expected after release:
    - `opendevbrowser-extension.zip`
    - `opendevbrowser-extension.zip.sha256`
- Current `0.0.24` delta is based on merged PR `#35` on top of `main`, plus release-prep version and evidence updates.

## Release summary

- Fixes the cache-root selection bug that could route OpenCode startup writes to `/.opendevbrowser`.
- Keeps bounded `worktree` and `directory` roots authoritative even when `process.cwd()` throws.
- Preserves repo-local `.opendevbrowser` auto-creation through existing writers.
- Bundles `yjs` into the shipped package so the OpenCode plugin loader no longer fails on missing cached-package `yjs` paths.

## Current repo note

- Release-prep branch: `main`
- Release tag target: `v0.0.24`
- Current `HEAD`: `aefa88cd50f8dba64e7a4468acb9d262d2162831`
- Local version authority is `package.json` at `0.0.24`; extension version owners stay synced via `npm run extension:sync`
- npm `latest` before publish is still `0.0.23`
- GitHub release is not yet created for `v0.0.24`
- `docs/RELEASE_0.0.22_EVIDENCE.md` remains historical release evidence and is intentionally left untouched in this release diff

## Mandatory release gates

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
- [x] `npm pack`
- [ ] After npm publish, `node scripts/registry-consumer-smoke.mjs --version 0.0.24 --output artifacts/release/v0.0.24/registry-consumer-smoke.json`

## Optional release-environment gates

- [ ] `node scripts/provider-direct-runs.mjs --release-gate --out artifacts/release/v0.0.24/provider-direct-runs.json`
- [ ] `node scripts/live-regression-direct.mjs --release-gate --out artifacts/release/v0.0.24/live-regression-direct.json`
- [ ] First-run onboarding dry run from `docs/FIRST_RUN_ONBOARDING.md`

## Repo sanity checks

- [x] `git diff --check`
- [ ] `git status --short`

## Artifacts

- [x] `opendevbrowser-extension.zip`
- [x] `opendevbrowser-0.0.24.tgz`

## Local verification snapshot

- Release-prep sweep completed on `2026-04-20 21:12:40 CDT` with fresh `0.0.24` artifact output:
  - `npm run extension:sync`
  - `npm run version:check`
  - `node scripts/audit-zombie-files.mjs`
  - `node scripts/docs-drift-check.mjs`
  - `node scripts/chrome-store-compliance-check.mjs`
  - `./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh`
  - `npx opendevbrowser --help`
  - `npx opendevbrowser help`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:release-gate`
  - `npm run test`
  - `npm run build`
  - `npm run extension:build`
  - `npm run extension:pack`
  - `npm pack`
- Clean `npm run test` rerun on the `0.0.24` working tree:
  - `262` test files passed, `1` skipped
  - `3808` tests passed, `1` skipped
  - Coverage: `98.08%` statements, `97.00%` branches, `97.76%` functions, `98.14%` lines
  - Duration: `155.92s`
  - Note: local counts include the preserved untracked `tests/cli-lifecycle-command.test.ts`
- Packaging proof:
  - Extension zip: `opendevbrowser-extension.zip`
    - Size: `171K`
    - SHA-256: `8e5df930a704e809837c04003e05199dc83e63b85d1ff6a46a1e41f44104ae00`
  - npm tarball: `opendevbrowser-0.0.24.tgz`
    - Size: `1.9M`
    - SHA-256: `cd751033cef644eb3d73a13b6dde6b7809d4d004650e4ef23552c6ec011e5e15`
  - `npm pack` details:
    - package size: `2.0 MB`
    - unpacked size: `10.6 MB`
    - total files: `974`
- Repo/auth sanity:
  - `git diff --check` passed
  - `npm whoami` -> `bishopdotun`
  - `gh auth status` -> authenticated as `freshtechbro`
  - `npm view opendevbrowser version dist-tags --json` before publish:
    - `version: 0.0.23`
    - `dist-tags.latest: 0.0.23`

## Functional proof carried into this release

- OpenCode plugin load now succeeds from the local package cache instead of failing on `/.opendevbrowser` or missing cached `yjs` modules.
- Repo-local `.opendevbrowser` creation was proven live by the annotate lane under the bounded repo root.
- `inspiredesign run` completed successfully through the built CLI with public references and bundle output written to `/tmp/odb-inspiredesign-live/inspiredesign/def5bcfe-6616-4a74-aca9-d8b034dd6cc8`.

## External release workflow evidence

- [ ] npm publish verification (`npm view opendevbrowser version`)
- [ ] Registry consumer smoke JSON
- [ ] GitHub release workflow run URL
- [ ] GitHub release URL
- [ ] GitHub release asset verification (`opendevbrowser-extension.zip`, `.sha256`)
- [ ] Chrome Web Store upload status
- [ ] Chrome Web Store publish or submit-for-review status

## Notes

- Public repo secrets still expose only `PRIVATE_REPO_DISPATCH_TOKEN`, so npm publish must run locally and the GitHub release workflow must be dispatched with `publish_npm=false`.
- Chrome Web Store publication remains a manual browser lane for this operator machine.
- Preserved unrelated dirt at release-prep time:
  - modified: `docs/RELEASE_0.0.22_EVIDENCE.md`
  - untracked: `tests/cli-lifecycle-command.test.ts`
- Keep this ledger active until npm publish, GitHub release assets, and the Chrome Web Store lane are completed or blocked with evidence.
