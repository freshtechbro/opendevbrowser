# v0.0.21 Release Evidence

Status: active release ledger
Target release date: 2026-04-19  
Last updated: 2026-04-19

## Scope

Tracks the `0.0.21` release cycle after the published `v0.0.20` release, including workflow success handoff parity, Inspire Design follow-through guidance, macro blocker messaging, live-harness hardening, packaging outputs, and distribution proof across GitHub release artifacts, npm, and the Chrome Web Store lane.

## Baseline comparison

- Reference release: GitHub `v0.0.20`
  - URL: `https://github.com/freshtechbro/opendevbrowser/releases/tag/v0.0.20`
  - Published: `2026-04-17T21:11:38Z`
  - Target: `main`
  - GitHub assets:
    - `opendevbrowser-extension.zip`
    - `opendevbrowser-extension.zip.sha256`
- Current `0.0.21` delta is based on merged PR `#27` plus the release-prep version or evidence updates on top of `main`.

## Release summary

- Makes workflow success outputs self-describing across research, shopping, product-video, and Inspire Design so operators get explicit follow-through guidance on successful runs.
- Treats Inspire Design's canvas handoff as the release-facing reference contract in help and docs.
- Fixes `macro-resolve --execute` so blocked execution states are reported honestly when blocker metadata survives execution.
- Hardens live validation by reusing healthy extension relay ownership and tightening product-video follow-through or timeout teardown behavior.

## Current repo note

- Release-prep branch: `codex/release-0-0-21`
- Release tag target: `v0.0.21`
- npm `latest`: pending
- GitHub release: pending
- Local version authority is `package.json` at `0.0.21`; extension version owners stay synced via `npm run extension:sync`
- `docs/RELEASE_0.0.20_EVIDENCE.md` remains historical release evidence

## Mandatory release gates

- [x] `npm run extension:sync`
- [x] `npm run version:check`
- [x] `node scripts/audit-zombie-files.mjs`
- [x] `node scripts/docs-drift-check.mjs`
- [x] `node scripts/chrome-store-compliance-check.mjs`
- [x] `./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh`
- [x] `npx opendevbrowser --help`
- [x] `npx opendevbrowser help`
- [x] `npm run lint`
- [x] `npm run typecheck`
- [x] `npm run test:release-gate`
- [x] `npm run test`
- [x] `npm run build`
- [x] `npm run extension:build`
- [x] `npm run extension:pack`
- [x] `npm pack`
- [ ] After npm publish, `node scripts/registry-consumer-smoke.mjs --version 0.0.21 --output artifacts/release/v0.0.21/registry-consumer-smoke.json`

## Optional release-environment gates

- [x] `node scripts/provider-direct-runs.mjs --release-gate --out artifacts/release/v0.0.21/provider-direct-runs.json`
- [x] `node scripts/live-regression-direct.mjs --release-gate --out artifacts/release/v0.0.21/live-regression-direct.json`
- [ ] First-run onboarding dry run from `docs/FIRST_RUN_ONBOARDING.md`

## Repo sanity checks

- [x] `git diff --check`
- [x] `git status --short`

## Artifacts

- [x] `opendevbrowser-extension.zip`
- [x] `opendevbrowser-0.0.21.tgz`

## Local verification snapshot

- Local gate sweep completed on `2026-04-19`.
- Passed:
  - `npm run extension:sync`
  - `git diff --check`
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
- Test summary:
  - `256` test files passed, `1` skipped
  - `3722` tests passed, `1` skipped
  - Coverage: `98.10%` statements, `97.01%` branches, `97.75%` functions, `98.16%` lines
- Packaging outputs:
  - `opendevbrowser-0.0.21.tgz`
  - `opendevbrowser-extension.zip`
- Provider direct release gate:
  - Artifact: `artifacts/release/v0.0.21/provider-direct-runs.json`
  - Counts: `19 pass`, `11 env_limited`, `0 fail`, `0 expected_timeout`, `0 skipped`
  - Notes: release-gate returned non-zero because env-limited lanes remain honest blockers for auth, challenge, or provider-policy constrained sources; there were no true failures.
- Live regression direct release gate:
  - Artifact: `artifacts/release/v0.0.21/live-regression-direct.json`
  - Counts: `6 pass`, `0 env_limited`, `0 fail`, `0 expected_timeout`, `2 skipped`
  - Skipped lanes:
    - `feature.annotate.relay` -> `manual_probe_boundary_observed:relay_annotation_timeout`
    - `feature.annotate.direct` -> `manual_probe_boundary_observed:direct_annotation_timeout`
- External pre-publish state:
  - `npm view opendevbrowser version dist-tags --json` still reports `latest=0.0.20`
  - `gh release view v0.0.21 --repo freshtechbro/opendevbrowser` -> `release not found`
  - `npm whoami` -> `bishopdotun`

## External release workflow evidence

- [ ] GitHub release workflow run URL
- [ ] GitHub release URL
- [ ] npm publish verification (`npm view opendevbrowser version`)
- [ ] Chrome Web Store upload or publish status

## Notes

- Use this ledger as the active release checklist until all publish lanes and post-publish proofs are complete.
- Keep `docs/RELEASE_0.0.20_EVIDENCE.md`, `docs/RELEASE_0.0.19_EVIDENCE.md`, `docs/RELEASE_0.0.18_EVIDENCE.md`, `docs/RELEASE_0.0.17_EVIDENCE.md`, and `docs/RELEASE_0.0.16_EVIDENCE.md` historical.
- Because the public repo still lacks repo-level `NPM_TOKEN` and `CWS_*` secrets, npm publish must run locally and the Chrome Web Store lane must use local credentials or a browser-manual dashboard flow from this operator machine.
