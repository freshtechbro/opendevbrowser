# v0.0.20 Release Evidence

Status: active release ledger
Target release date: 2026-04-17  
Last updated: 2026-04-18

## Scope

Tracks the `0.0.20` release cycle after the published `v0.0.19` release, including the operator review or inspection surfaces, the first-class Inspire Design workflow lane, help-led discoverability hardening, release-gate validation, packaging outputs, and distribution proof across GitHub release artifacts, npm, and the Chrome Web Store lane.

## Baseline comparison

- Reference release: GitHub `v0.0.19`
  - URL: `https://github.com/freshtechbro/opendevbrowser/releases/tag/v0.0.19`
  - Published: `2026-04-13T19:34:59Z`
  - Target: `main`
  - GitHub assets:
    - `opendevbrowser-extension.zip`
    - `opendevbrowser-extension.zip.sha256`
- Current `0.0.20` delta is based on the merged `main` line after `v0.0.19`, primarily PR `#24` and PR `#25`.

## Release summary

- Adds first-class operator review and inspection surfaces, including review-desktop, session-inspector audit or plan flows, and capability status reporting.
- Ships Inspire Design as a first-class workflow surface with provider contracts, capture flows, docs, and parity coverage.
- Canonicalizes generated help or release-facing discoverability metadata so the new workflow and operator lanes are easy to find from the public CLI surface.
- Hardens live audit and release harnesses around env-limited classification, relay ownership truth, desktop observation capture, and shopping follow-up classification.

## Current repo note

- Release-prep branch: `codex/release-0-0-20`
- Release tag target: `v0.0.20`
- npm `latest`: pending
- GitHub release: pending
- Local version authority is `package.json` at `0.0.20`; extension version owners stay synced via `npm run extension:sync`
- `docs/RELEASE_0.0.19_EVIDENCE.md` remains historical release evidence

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
- [ ] After npm publish, `node scripts/registry-consumer-smoke.mjs --version 0.0.20 --output artifacts/release/v0.0.20/registry-consumer-smoke.json`

## Optional release-environment gates

- [x] `node scripts/provider-direct-runs.mjs --release-gate --out artifacts/release/v0.0.20/provider-direct-runs.json`
  - Result: command exited non-zero because `--release-gate` promotes live-environment limits to hard failures.
  - Artifact: `artifacts/release/v0.0.20/provider-direct-runs.json`
  - Summary: `pass=19`, `env_limited=11`, `fail=0`, `skipped=0`
  - Observed env-limited lanes: community challenge wall, X shell-only, Reddit verification wall, Bluesky shell-only, Instagram token-required, policy-blocked post lanes, Macy's env-limited, Temu env-limited, Others env-limited.
- [x] `node scripts/live-regression-direct.mjs --release-gate --out artifacts/release/v0.0.20/live-regression-direct.json`
  - Artifact: `artifacts/release/v0.0.20/live-regression-direct.json`
  - Final rerun summary: `pass=6`, `skipped=2`, `fail=0`, `env_limited=0`
  - Note: an initial attempt failed before scenario execution because the daemon had been started from the `npx` wrapper and the dist CLI treated that as a fingerprint mismatch. Rerunning with the daemon started from `node dist/cli/index.js serve` produced the passing result above.
- [x] First-run onboarding dry run from `docs/FIRST_RUN_ONBOARDING.md`
  - Command: `node scripts/cli-onboarding-smoke.mjs`
  - Result: `CLI onboarding smoke test completed.`

## Repo sanity checks

- [x] `git diff --check`
- [x] `git status --short`
  - Current worktree is limited to the intended `0.0.20` release-prep version, docs, and evidence files.

## Artifacts

- [x] `opendevbrowser-extension.zip`
- [x] `opendevbrowser-0.0.20.tgz`

## Local verification snapshot

- `npm run test`
  - Result: `256 passed | 1 skipped` test files, `3720 passed | 1 skipped` tests
  - Coverage: `98.10%` statements, `97.01%` branches, `97.75%` functions, `98.16%` lines
- `npm run test:release-gate`
  - Result: all grouped release-gate suites passed
- `npx opendevbrowser --help` and `npx opendevbrowser help`
  - Result: both commands produced matching help output with the release-facing `Find It Fast` terms for `screencast / browser replay`, `desktop observation`, and `computer use / browser-scoped computer use`
- `npm pack`
  - Artifact: `opendevbrowser-0.0.20.tgz`
  - Tarball summary: package size `1.8 MB`, unpacked size `9.6 MB`, files `957`

## External release workflow evidence

- [ ] GitHub release workflow run URL
- [ ] GitHub release URL
- [ ] npm publish verification (`npm view opendevbrowser version`)
- [ ] Chrome Web Store upload or publish status

## Notes

- Use this ledger as the active release checklist until all publish lanes and post-publish proofs are complete.
- Supporting matrix harnesses were revalidated on 2026-04-18 after aligning relay reuse with the documented `/ops` presence-only status signal: a healthy extension-only relay may report `opsConnected=true` without forcing a daemon recycle, while strict release proof remains anchored on `provider-direct-runs` and `live-regression-direct`.
- Keep `docs/RELEASE_0.0.19_EVIDENCE.md`, `docs/RELEASE_0.0.18_EVIDENCE.md`, `docs/RELEASE_0.0.17_EVIDENCE.md`, and `docs/RELEASE_0.0.16_EVIDENCE.md` historical.
- Because the public repo still lacks `NPM_TOKEN` and `CWS_*` secrets, the remaining npm and Chrome Web Store lanes must be completed from the current operator machine or documented as blocked after direct verification.
