# v0.0.27 Release Evidence

Status: active release ledger
Target release date: 2026-04-28
Last updated: 2026-04-28

## Scope

Tracks the `0.0.27` release cycle for the PR #41 and PR #42 consolidated review fixes, InspireDesign reference-first contract cleanup, CLI numeric validation cleanup, stale script removal, relay identity failure preservation, and public npm/GitHub publication proof.

## Baseline comparison

- Reference release: npm `latest` is `0.0.26` before publish.
- Target branch: `main`
- Release-prep branch: `codex/release-0-0-27`
- Target tag: `v0.0.27`
- GitHub release assets expected after release:
  - `opendevbrowser-extension.zip`
  - `opendevbrowser-extension.zip.sha256`

## Release summary

- Merged PR #41: InspireDesign reference-first contract and cache safety fixes.
- Merged PR #42: dead-code cleanup, CLI numeric parser reuse, and review-blocker fixes.
- Preserves relay identity mismatch guidance instead of replacing it with a generic retry message.
- Keeps failed InspireDesign reference fetches visible when captures only recover CSS/code-like shells.
- Aligns package, extension, lockfile, docs tarball references, and release-ledger pointers at `0.0.27`.

## Version authority

- `package.json`: `0.0.27`
- `package-lock.json`: `0.0.27`
- `extension/package.json`: `0.0.27`
- `extension/manifest.json`: `0.0.27`
- `npm view opendevbrowser version` before publish: `0.0.26`

## Merged-main baseline evidence

- [x] PR #41 checks
  - Result: passed on GitHub PR Checks run `25031241014`.
- [x] PR #42 checks
  - Result: passed on GitHub PR Checks run `25054910067`.
- [x] `npm run lint`
  - Result: passed on merged `main`.
- [x] `npm run typecheck`
  - Result: passed on merged `main`.
- [x] `npm run build`
  - Result: passed on merged `main`.
- [x] `npm run extension:build`
  - Result: passed on merged `main` before the version bump.
- [x] `npm run version:check`
  - Result: passed on merged `main` before the version bump, `Version check passed: 0.0.26`.
- [x] `npm run test`
  - Result: passed on merged `main`.
  - Test files: `268 passed | 1 skipped (269)`.
  - Tests: `4036 passed | 1 skipped (4037)`.
  - Coverage: `98.13%` statements, `97.01%` branches, `97.82%` functions, `98.19%` lines.
- [x] `node scripts/audit-zombie-files.mjs`
  - Result: passed, `ok=true`, `scanned=1010`, `flagged=[]`.
- [x] `node scripts/docs-drift-check.mjs`
  - Result: passed on merged `main` before the version bump, `ok=true`, version `0.0.26`, counts `77` CLI commands, `70` tools, `59` `/ops`, `35` `/canvas`.
- [x] `node scripts/chrome-store-compliance-check.mjs`
  - Result: passed, manifest v3, extension version `0.0.26`, all permission, privacy, and asset checks passed.
- [x] `./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh`
  - Result: passed, `22` files referenced/present and `10` JSON templates parsed.
- [x] `npx opendevbrowser --help`
  - Result: passed, `795` output lines captured.
- [x] `npx opendevbrowser help`
  - Result: passed, `795` output lines captured.
- [x] `git diff --check`
  - Result: passed on merged `main`.

## Release-prep branch gates

- [x] `npm run version:check`
  - Result: passed on `codex/release-0-0-27`, `Version check passed: 0.0.27`.
- [x] `node scripts/docs-drift-check.mjs`
  - Result: passed on `codex/release-0-0-27`, `ok=true`, version `0.0.27`.
- [x] `node scripts/chrome-store-compliance-check.mjs`
  - Result: passed on `codex/release-0-0-27`, extension version `0.0.27`.
- [x] `node scripts/audit-zombie-files.mjs`
  - Result: passed on `codex/release-0-0-27`, `ok=true`, `flagged=[]`.
- [x] `npm run lint`
  - Result: passed on `codex/release-0-0-27`.
- [x] `npm run typecheck`
  - Result: passed on `codex/release-0-0-27`.
- [x] `npm run build`
  - Result: passed on `codex/release-0-0-27`.
- [x] `npm run extension:build`
  - Result: passed on `codex/release-0-0-27`.
- [x] `npm run test`
  - Result: passed on `codex/release-0-0-27`.
  - Test files: `268 passed | 1 skipped (269)`.
  - Tests: `4036 passed | 1 skipped (4037)`.
  - Coverage: `98.13%` statements, `97.01%` branches, `97.82%` functions, `98.19%` lines.
- [x] `npm run test:release-gate`
  - Result: passed on `codex/release-0-0-27`; all `5` release gate groups passed.
- [x] `./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh`
  - Result: passed on `codex/release-0-0-27`, `22` files referenced/present and `10` JSON templates parsed.
- [x] `npx opendevbrowser --help`
  - Result: passed on `codex/release-0-0-27`.
- [x] `npx opendevbrowser help`
  - Result: passed on `codex/release-0-0-27`.
- [x] `git diff --check`
  - Result: passed on `codex/release-0-0-27`.
- [x] `npm pack`
  - Result: passed on `codex/release-0-0-27`, produced `opendevbrowser-0.0.27.tgz`.
  - SHA-256: `639017567bd2d23298ec6f1050c8a7e873b8c19dc4493a6396ddfb421554f9b9`.
- [x] `npm run extension:pack`
  - Result: passed on `codex/release-0-0-27`, produced `opendevbrowser-extension.zip`.
  - SHA-256: `8ca2540f3d497e77a6bb649900edff78322b8181fa53b9aaf3dcfdbedd523ed5`.
- [x] First-time registry consumer install smoke
  - Result: passed after publish with `node scripts/registry-consumer-smoke.mjs --version 0.0.27 --output artifacts/release/v0.0.27/registry-consumer-smoke.json`.
  - Checks: `versionMatches=true`, `helpAliasMatches=true`, `extensionDirExists=true`, `skillsDirExists=true`.
- [ ] Strict live provider gates
  - Status: deferred for tag-driven publish because the standard public release workflow default is `run_release_live_gates=false`.

## External release workflow evidence

- [x] Public Release workflow URL
  - URL: `https://github.com/freshtechbro/opendevbrowser/actions/runs/25056123043`.
  - Result: failed only at `Publish npm package` because repository secret `NPM_TOKEN` was not configured; release quality gates and packaging steps passed.
- [x] npm publish verification
  - Result: local authenticated publish completed with `npm publish opendevbrowser-0.0.27.tgz --access public`.
  - Registry verification: `npm view opendevbrowser version dist-tags --json` returned `version=0.0.27` and `latest=0.0.27`.
- [x] Registry consumer smoke JSON
  - Path: `artifacts/release/v0.0.27/registry-consumer-smoke.json`.
  - Result: `success=true`, `helpLineCount=796`, installed package graph `opendevbrowser=0.0.27`.
- [x] GitHub release URL
  - URL: `https://github.com/freshtechbro/opendevbrowser/releases/tag/v0.0.27`.
- [x] GitHub release asset verification
  - Assets: `opendevbrowser-extension.zip`, `opendevbrowser-extension.zip.sha256`.

## Notes

- Strict live provider release gates are deferred for this publish unless explicitly enabled in the workflow dispatch or tag path. The standard tag-driven release path runs `run_release_live_gates=false`, matching the runbook default.
- GitHub Actions reported Node 20 deprecation annotations in PR checks. These are workflow-environment warnings, not failed repository checks.
- The repository currently lacks `NPM_TOKEN`; configure it before the next tag-driven release to avoid manual npm publication.
