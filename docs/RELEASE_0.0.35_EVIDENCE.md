# v0.0.35 Release Evidence

Status: active release ledger
Target release date: 2026-06-12
Target tag: `v0.0.35`

## Scope

Tracks the `0.0.35` release cycle for PR #79, which closes the Pinterest harvest readiness work by proving straight-through Pinterest discovery, selected-pin harvest, media analysis, and design-ready Inspired Design output.

Current status note:
- Source version metadata is aligned from `0.0.34` to `0.0.35`.
- npm package `opendevbrowser@0.0.35` is published and tagged `latest`.
- GitHub release `v0.0.35` is published with extension zip and checksum assets.
- Chrome Web Store and Google release lanes are intentionally out of scope for this release.

## Reference State

- Previous npm `latest`: `0.0.34`
- Previous GitHub release: `v0.0.34`
- Release source branch: `main`
- Target tag: `v0.0.35`
- GitHub release workflow: `.github/workflows/release-public.yml`

## Release Delta

- Shipped PR #79 Pinterest harvest readiness closeout.
- Proved `inspiredesign harvest` from Pinterest query discovery to selected-pin harvest, media analysis, and design-ready handoff.
- Proved direct `inspiredesign run` uses the same media-analysis path and product-ready authority.
- Fixed canonical Pinterest pin warmup so it shares one absolute pin-media capture deadline with primary capture.
- Preserved non-authoritative `media-analysis.json` semantics so workflow authority fields do not leak into media guidance.

## Version Alignment

- `package.json`: `0.0.35`
- `package-lock.json`: `0.0.35`
- `extension/package.json`: `0.0.35`
- `extension/manifest.json`: `0.0.35`

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

- [ ] Deferred unless explicitly required for this release:
  - `node scripts/provider-direct-runs.mjs --release-gate --out artifacts/release/v0.0.35/provider-direct-runs.json`
  - `node scripts/live-regression-direct.mjs --release-gate --out artifacts/release/v0.0.35/live-regression-direct.json`

## Implementation Proof

- [x] PR #79 merged: `https://github.com/freshtechbro/opendevbrowser/pull/79`
- [x] PR #79 merge commit: `ddc125f7c9a7c3b921f55b72373c9fbde457c81a`
- [x] PR #79 passed required checks before merge: audit-zombie-files, build, chrome-store-compliance-check, cli-help-parity, docs-drift-check, focused-regression-tests, lint, skill-assets, and typecheck.
- [x] PR #80 merged release prep: `https://github.com/freshtechbro/opendevbrowser/pull/80`
- [x] PR #80 merge commit: `4a1c593731f6ee158a49626b53b6e4481fe5a687`
- [x] PR #80 passed required checks before merge: audit-zombie-files, build, chrome-store-compliance-check, cli-help-parity, docs-drift-check, focused-regression-tests, lint, skill-assets, and typecheck.
- [x] Live explicit pin harvest evidence: `.tmp/pinterest-closeout-20260612/harvest-pin-843-after-networkidle-cap/inspiredesign/f9e5d438-1edd-4d97-afab-2b5c79853141`
- [x] Live query harvest evidence: `.tmp/pinterest-closeout-20260612/harvest-query-after-networkidle-cap/inspiredesign/7eb00cde-0d7c-4c34-bfb8-1549e23f7860`
- [x] Live direct run evidence: `.tmp/pinterest-closeout-20260612/direct-run-pin-after-networkidle-cap/inspiredesign/be19b99c-7976-438d-8eb9-75d7ddd5cb11`

## Local Release Gate Results

- `npm run extension:sync`: passed. Extension version metadata already at `0.0.35`.
- `npm run version:check`: passed. Version check reported `0.0.35`.
- `npm run test:release-gate`: passed.
- `node scripts/audit-zombie-files.mjs`: passed.
- `node scripts/docs-drift-check.mjs`: passed.
- `node scripts/chrome-store-compliance-check.mjs`: passed.
- `./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh`: passed.
- `./skills/opendevbrowser-motion-design/scripts/validate-skill-assets.sh`: passed.
- `npx opendevbrowser --help`: passed.
- `npx opendevbrowser help`: passed.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm run test`: passed. Fresh branch coverage is `23114/23828`, or `97.00352526439482%`; required branches are `23114`, deficit `0`.
- `npm run build`: passed.
- `npm run extension:build`: passed.
- `npm run extension:pack`: passed and regenerated local `opendevbrowser-extension.zip`.
- `npm pack`: passed and produced `opendevbrowser-0.0.35.tgz`; packed package size is `2.6 MB`, unpacked size is `13.3 MB`, total files `1298`, shasum `f3620ae31b35e47e0ad27a322eb1e950c897acbb`.
- `git diff --check`: passed.

## Adversarial Review Loop

- Initial release-prep diff review: no release blockers; residual release-doc polish was identified.
- Release-doc cleanup completed: `CHANGELOG.md` now has a `0.0.35` section and compare link, release runbooks use the 2026-06-12 release prep date, and the docs evidence index includes the historical `0.0.34` ledger.
- Rereview found three metadata blockers: stale changelog compare links plus stale 2026-06-05 audit labels in dependency and distribution docs.
- Metadata blockers fixed, then rerun gates passed: `node scripts/docs-drift-check.mjs`, `node scripts/audit-zombie-files.mjs`, and `git diff --check`.
- Final metadata blocker spot-check: no blockers.

## External Release Workflow Evidence

- [x] Initial tag-driven GitHub release workflow run: `https://github.com/freshtechbro/opendevbrowser/actions/runs/27447337042`
  - Result: failed at `Publish npm package`.
  - Failure: npm returned `E404 Not Found - PUT https://registry.npmjs.org/opendevbrowser` even though `NODE_AUTH_TOKEN` was present, indicating the GitHub Actions token was not authorized for this package publish.
  - Completed before failure: release quality gates, extension packing, and extension checksum computation.
- [x] npm publish verification:
  - Local publish with authenticated npm user `bishopdotun` succeeded: `+ opendevbrowser@0.0.35`.
  - `npm view opendevbrowser version dist-tags --json` returned version `0.0.35` and `latest: 0.0.35`.
- [x] Registry consumer smoke:
  - Command: `node scripts/registry-consumer-smoke.mjs --version 0.0.35 --output artifacts/release/v0.0.35/registry-consumer-smoke.json`
  - Result: success, one install attempt, `helpLineCount: 829`, package version matched, extension and skills directories existed.
  - Consumer graph: `opendevbrowser@0.0.35`, `@opencode-ai/plugin@1.17.4`, `ws@8.21.0`, `zod@3.25.76`, nested plugin `zod@4.1.8`.
- [x] GitHub release recovery workflow run:
  - URL: `https://github.com/freshtechbro/opendevbrowser/actions/runs/27447601136`
  - Inputs: `release_ref=v0.0.35`, `release_tag=v0.0.35`, `publish_npm=false`, `publish_github_release=true`, `draft_release=false`, `run_release_live_gates=false`.
  - Result: success. Release quality gates, extension packing, checksum computation, and GitHub release publication passed.
- [x] GitHub release URL: `https://github.com/freshtechbro/opendevbrowser/releases/tag/v0.0.35`
- [x] GitHub release asset verification:
  - `opendevbrowser-extension.zip`, size `176328`, GitHub asset digest `sha256:07a23dd346f99b2420c944ddeb2800b2fed06457d50229862ecd6ef4acc76099`
  - `opendevbrowser-extension.zip.sha256`, size `95`, GitHub asset digest `sha256:19dd4a2d052327c5f4ecbf89ad045c797c4dcc0bb51ca13c5bbb13018bf994e9`

## Out Of Scope

- Chrome Web Store publication and Google release workflow are intentionally not run for `v0.0.35`.

## Notes

- `opendevbrowser@0.0.35` was verified absent from npm before release prep.
- Repository secret `NPM_TOKEN` exists, and local `npm whoami` returned `bishopdotun`.
