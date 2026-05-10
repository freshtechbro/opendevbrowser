# v0.0.19 Release Evidence

Status: historical completed release ledger
Target release date: 2026-04-13  
Last updated: 2026-04-13

## Scope

Tracks the completed `0.0.19` release cycle after the published `v0.0.18` release, including npm registry-consumer smoke hardening, browser-scoped computer-use discoverability updates, the screencast stop-race fix, version alignment, packaging, and release closeout evidence.

## Baseline comparison

- Reference release: GitHub `v0.0.18`
  - URL: `https://github.com/freshtechbro/opendevbrowser/releases/tag/v0.0.18`
  - Published: `2026-04-13T03:14:55Z`
  - Target: `main`
  - GitHub assets:
    - `opendevbrowser-extension.zip`
    - `opendevbrowser-extension.zip.sha256`
- Current `0.0.19` delta is based on the post-`v0.0.18` hardening work that merged from `codex/generalfixes` via PR `#22`.

## Release summary

- Adds a post-publish registry-consumer smoke lane so npm releases are proven from a fresh consumer install instead of only repo-local `npm pack` validation.
- Makes browser-scoped computer use easier to discover by surfacing a concrete workflow entry command in help, onboarding metadata, and release-facing docs.
- Fixes the screencast recorder so a stop request during the first in-flight capture does not allow a later scheduled frame.
- Preserves the `0.0.18` release evidence as a historical record while moving the active release cycle to `0.0.19`.

## Current repo note

- Release-prep branch `codex/generalfixes` merged into `main` via PR `#22`
- Release tag pushed: `v0.0.19`
- npm `latest` points to `0.0.19`
- GitHub release published: `https://github.com/freshtechbro/opendevbrowser/releases/tag/v0.0.19`
- Local version authority is `package.json` at `0.0.19`; extension version owners stay synced via `npm run extension:sync`
- `docs/RELEASE_0.0.18_EVIDENCE.md` remains a historical release record

## Mandatory release gates

- [x] `npm run extension:sync`
  - `Extension version metadata already at 0.0.19`
- [x] `npm run version:check`
  - `Version check passed: 0.0.19`
- [x] `node scripts/audit-zombie-files.mjs`
  - `ok=true`, `scanned=947`, `flagged=[]`
- [x] `node scripts/docs-drift-check.mjs`
  - `ok=true`, source counts `commands=72`, `tools=65`, `/ops=59`, `/canvas=35`, `failed=[]`
- [x] `node scripts/chrome-store-compliance-check.mjs`
  - `ok=true`, `extensionVersion=0.0.19`, `failed=[]`
- [x] `./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh`
  - `Skill assets validated: 22 files referenced/present, 10 JSON templates parsed.`
- [x] `npx opendevbrowser --help`
  - `593` lines
  - contains `Find It Fast`, `screencast / browser replay`, `desktop observation`, `computer use / browser-scoped computer use`, and `computer_use_entry`
- [x] `npx opendevbrowser help`
  - alias matches `--help`
- [x] `npm run lint`
- [x] `npm run typecheck`
- [x] `npm run test:release-gate`
  - all 5 release-gate groups passed
- [x] `npm run test`
  - `241` files passed, `1` skipped
  - `3524` tests passed, `1` skipped
- [x] `npm run build`
  - also revalidated during `npm pack`
- [x] `npm run extension:build`
  - extension assets synced cleanly
- [x] `npm run extension:pack`
  - produced `opendevbrowser-extension.zip`
- [x] `npm pack`
  - produced `opendevbrowser-0.0.19.tgz`
  - tarball details: `package size=1.7 MB`, `unpacked size=9.1 MB`, `total files=919`
- [x] After npm publish, `node scripts/registry-consumer-smoke.mjs --version 0.0.19 --output artifacts/release/v0.0.19/registry-consumer-smoke.json`
  - completed against npm `latest` after publish
  - `success=true`
  - `installAttempts=4`
  - `helpLineCount=594`
  - consumer graph: `@opencode-ai/plugin@1.4.3`, `ws@8.20.0`, `zod@3.25.76`, nested plugin `zod@4.1.8`

## Repo sanity checks

- [x] `git diff --check`
- [x] `git status --short`
  - worktree contains only the intended release-prep bundle plus new release docs and scripts

## Artifacts

- [x] `opendevbrowser-extension.zip`
  - size: `170K`
  - sha256: `d584cb2bd7b77f0b1fb9fe15c10abbb558a15b9b79f14d97013849557c26a4a9`
- [x] `opendevbrowser-0.0.19.tgz`
  - size: `1.6M`
  - npm shasum: `953c4b27c03444668e6d33c2258b0743e0e5231c`
  - sha256: `f892c7a410e7c24d04216c1ebb85105d5d1af5640ce9cbd3a5d1d22ed766e333`

## Optional release-environment gates

- [ ] `node scripts/provider-direct-runs.mjs --release-gate --out artifacts/release/v0.0.19/provider-direct-runs.json`
- [ ] `node scripts/live-regression-direct.mjs --release-gate --out artifacts/release/v0.0.19/live-regression-direct.json`
- [ ] First-run onboarding dry run from `docs/FIRST_RUN_ONBOARDING.md`

## External release workflow evidence

- [x] Initial tag-triggered public release run failed because npm publish was enabled without `NPM_TOKEN`
  - workflow: `https://github.com/freshtechbro/opendevbrowser/actions/runs/24362526855`
  - conclusion: `failure`
  - head SHA: `0002d7ddeca8c170cec56cf1d1f97de9604955df`
- [x] GitHub release-only rerun completed successfully
  - workflow: `https://github.com/freshtechbro/opendevbrowser/actions/runs/24362731433`
  - conclusion: `success`
  - head SHA: `0002d7ddeca8c170cec56cf1d1f97de9604955df`
- [x] GitHub release URL
  - `https://github.com/freshtechbro/opendevbrowser/releases/tag/v0.0.19`
- [x] npm publish verification
  - `npm view opendevbrowser version` returned `0.0.19`

## Review note

- Diff review found no blocking issue in the recorder race fix, registry-consumer smoke lane, release workflow wiring, or the `0.0.19` doc/version cutover.

## Notes

- This ledger now captures completed `0.0.19` release evidence, not only release-prep proof.
- The mandatory publish-time registry-consumer smoke is closed with a successful post-publish run against npm `latest`.
- Keep `docs/RELEASE_0.0.18_EVIDENCE.md` historical; do not rewrite it as active `0.0.19` guidance.
