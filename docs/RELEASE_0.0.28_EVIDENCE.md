# v0.0.28 Release Evidence

Status: active release ledger
Target release date: 2026-04-30
Last updated: 2026-04-30

## Scope

Tracks the `0.0.28` release cycle for provider/workflow hardening after PR #45, including first-class next-step guidance, social shell classification, YouTube/provider coverage, and release publication proof.

## Baseline comparison

- Reference release: npm `latest` is `0.0.27` before publish.
- Target branch: `main`
- Release-prep branch: `codex/release-0-0-28`
- Target tag: `v0.0.28`
- GitHub release assets expected after release:
  - `opendevbrowser-extension.zip`
  - `opendevbrowser-extension.zip.sha256`

## Release summary

- Merged PR #45: provider workflow guidance and classification hardening.
- Preserves `env_limited` and challenge outcomes as explicit non-pass evidence.
- Adds direct social/provider classification coverage for X-adjacent social lanes, Threads, Facebook, Reddit, YouTube, product-video, shopping, and workflow guidance.
- Aligns package, extension, lockfile, docs tarball references, and release-ledger pointers at `0.0.28`.

## Version authority

- `package.json`: `0.0.28`
- `package-lock.json`: `0.0.28`
- `extension/package.json`: `0.0.28`
- `extension/manifest.json`: `0.0.28`
- `npm view opendevbrowser version` before publish: `0.0.27`

## Merged-main baseline evidence

- [x] PR #45 checks
  - Result: passed on GitHub PR Checks run `25145367468`.
- [x] Focused follow-up regression gate
  - Command: `npx vitest run tests/provider-direct-runs.test.ts tests/provider-live-matrix-script.test.ts tests/providers-product-video-workflow.test.ts tests/providers-social-search-quality.test.ts --coverage.enabled=false`
  - Result: passed, `4` files and `135` tests.
- [x] Workflow matrix proof
  - Path: `/tmp/odb-workflow-validation-nextstep.json`
  - Result: `pass=6`, `env_limited=2`, `fail=0`, `ok=true`.
- [x] Prior full provider/workflow branch gates
  - Result: `npm run typecheck`, `npm run lint`, `npm run version:check`, `node scripts/docs-drift-check.mjs`, `npm run build`, `npm run extension:build`, skill asset validation, and full coverage passed before PR merge.

## Release-prep branch gates

- [x] `npm run version:check`
  - Result: passed, version `0.0.28`.
- [x] `node scripts/docs-drift-check.mjs`
  - Result: passed.
- [x] `node scripts/chrome-store-compliance-check.mjs`
  - Result: passed.
- [x] `node scripts/audit-zombie-files.mjs`
  - Result: passed.
- [x] `npm run lint`
  - Result: passed.
- [x] `npm run typecheck`
  - Result: passed.
- [x] `npm run build`
  - Result: passed.
- [x] `npm run extension:build`
  - Result: passed.
- [x] `npm run test`
  - Result: passed on 2026-04-30, `268` files passed, `1` skipped, `4163` tests passed, `1` skipped, coverage `98.12%` statements / `97.01%` branches / `97.82%` functions / `98.19%` lines.
- [x] `npm run test:release-gate`
  - Result: passed all `5` groups.
- [x] `./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh`
  - Result: passed.
- [x] `git diff --check`
  - Result: passed after final coverage-test and release-evidence updates.
- [x] `npx opendevbrowser --help`
  - Result: passed, wrote `795` lines to `/tmp/odb-help-0.0.28.txt`.
- [x] `npx opendevbrowser help`
  - Result: passed, wrote `795` lines to `/tmp/odb-help-command-0.0.28.txt`.
- [x] `npm pack --pack-destination /tmp`
  - Result: passed, produced `/tmp/opendevbrowser-0.0.28.tgz`, package size `2.2 MB`, unpacked size `11.3 MB`, `986` files, shasum `2ea513b89f4f7098029dc18299ad249e1cd8a37d`.
- [x] `npm run extension:pack`
  - Result: passed, produced ignored local artifact `opendevbrowser-extension.zip`.
- [ ] First-time registry consumer install smoke after publish
- [ ] Strict live provider gates
  - Status: deferred unless `run_release_live_gates=true` is explicitly enabled.

## External release workflow evidence

- [x] Public Release workflow URL
  - URL: `https://github.com/freshtechbro/opendevbrowser/actions/runs/25145968841`
  - Result: quality gates, extension packaging, and checksum steps passed; `Publish npm package` failed because `NODE_AUTH_TOKEN` was empty and repo secret `NPM_TOKEN` is not configured.
- [x] npm publish verification
  - Command: `npm publish --access public`
  - Result: published `opendevbrowser@0.0.28` from local authenticated npm user `bishopdotun`.
  - Verification: `npm view opendevbrowser version` returned `0.0.28`.
- [x] Registry consumer smoke JSON
  - Command: `node scripts/registry-consumer-smoke.mjs --version 0.0.28 --output artifacts/release/v0.0.28/registry-consumer-smoke.json`
  - Result: passed; help alias matched, package version matched, packaged extension and skills directories were present, and consumer graph resolved `opendevbrowser=0.0.28`.
- [x] GitHub release URL
  - URL: `https://github.com/freshtechbro/opendevbrowser/releases/tag/v0.0.28`
  - Result: published, non-draft, non-prerelease.
- [x] GitHub release asset verification
  - Assets uploaded: `opendevbrowser-extension.zip`, `opendevbrowser-extension.zip.sha256`.
  - Zip checksum: `0e66f23e77200581f3fe07577337bb3948b4e5506d8ae2706340dea678ae1665`.

## Notes

- The standard tag-driven public release path defaults `run_release_live_gates=false`. Strict live gates remain separate evidence and must not be conflated with clean release quality gates.
- `0.0.27` is already published on npm and GitHub, so this release requires the new `0.0.28` version.
- `NPM_TOKEN` must be added to repository Actions secrets before the next tag-driven release can publish fully from CI.
