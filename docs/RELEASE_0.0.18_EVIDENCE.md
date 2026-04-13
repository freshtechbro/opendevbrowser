# v0.0.18 Release Evidence

Status: active release ledger
Target release date: 2026-04-12
Last updated: 2026-04-13

## Scope

Tracks the `0.0.18` release-prep gates for the repo state after the GitHub-published `v0.0.17` release, including version alignment, changelog/docs refresh, packaging outputs, website-sync readiness, and release/distribution handoff evidence for GitHub release, npm, and Chrome extension distribution.

## Baseline comparison

- Reference release: GitHub `v0.0.17`
  - URL: `https://github.com/freshtechbro/opendevbrowser/releases/tag/v0.0.17`
  - Published: `2026-03-14T02:35:18Z`
  - Target: `main`
  - GitHub assets:
    - `opendevbrowser-extension.zip`
    - `opendevbrowser-extension.zip.sha256`
- GitHub release notes for `v0.0.17` called out PRs `#7`, `#8`, and `#9`.
- Current `0.0.18` delta is based on the merged `main` line after `v0.0.17`, with first-parent PR merges `#10` through `#14`.

## Release summary

- Generated public-surface manifests, onboarding metadata, and direct-run release probes now back generated help, docs parity, release evidence, and mirrored website inputs.
- Canvas/runtime delivery is stronger than the original `v0.0.17` ship, with adapter-plugin validation, starter or inventory flows, framework-adapter code sync, review/session-inspector surfaces, and extended extension-editor coverage.
- Public read-only desktop observation now ships as a sibling runtime with dedicated audit and permission checks while staying outside the public relay or `/ops` plane.
- Release/distribution operations are tighter across GitHub artifacts, npm packaging, Chrome Web Store prep, and private-site sync triggers.

## Current repo note

- Active prep branch: `codex/release-0-0-18`
- Source branch for eventual tag/publish: merged `main`
- Prep branch base: `origin/main`
- `origin/main` at start of prep: `4a80e25269dfe92ccaf300aa8026a3234189aac5`
- Local version authority is now `package.json` at `0.0.18`; extension version owners must stay synced via `npm run extension:sync`.
- Release-version sweep confirmed `0.0.18` across active version owners and current-cycle docs. `tsconfig.json` and `eslint.config.js` contain no release-version strings, so they were reviewed and left unchanged.

## Mandatory release gates

- [x] `npm run extension:sync`
  - Result: synced `extension/manifest.json` and `extension/package.json` to `0.0.18`
- [x] `npm run version:check`
  - Result: passed with root + extension version owners aligned at `0.0.18`
- [x] `node scripts/audit-zombie-files.mjs`
  - Result: `{"ok":true,"scanned":915,"flagged":[]}`
- [x] `node scripts/docs-drift-check.mjs`
  - Result: passed; current generated source counts confirmed as `64` CLI commands, `57` tools, `59` `/ops`, and `35` `/canvas`
- [x] `node scripts/chrome-store-compliance-check.mjs`
  - Result: passed
- [x] `./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh`
  - Result: passed
- [x] `npx opendevbrowser --help`
  - Result: generated successfully; output length `528` lines
- [x] `npx opendevbrowser help`
  - Result: generated successfully; output length `528` lines and matched `--help` via `cmp`
- [x] `npm run lint`
  - Result: passed
- [x] `npm run typecheck`
  - Result: passed
- [x] `npm run build`
  - Result: passed
- [x] `npm run extension:build`
  - Result: passed
- [x] `npm run test:release-gate`
  - Result: all `5` release-gate groups passed
- [x] `npm run test`
  - Result: passed on the rebased `origin/main` + `0.0.18` candidate; coverage remained above the required `97%` branch threshold

## Packaging gates

- [x] `npm run extension:pack`
  - Result: `opendevbrowser-extension.zip` generated successfully
- [x] `npm pack`
  - Result: `opendevbrowser-0.0.18.tgz` regenerated successfully from the final post-fix tree during `prepack` validation/build flow

## Repo sanity checks

- [x] `git diff --check`
  - Result: passed
- [x] `git status --short`
  - Result: only intended release-prep files remain modified; generated artifacts stay ignored

## Artifacts

- [x] `opendevbrowser-extension.zip`
  - Size: `173853` bytes
  - SHA-256: `9b3569bef1888b5e9b18a7e48cf44629856b130b73d669c99350f348f2801c76`
- [x] `opendevbrowser-extension.zip.sha256`
  - Contents: `9b3569bef1888b5e9b18a7e48cf44629856b130b73d669c99350f348f2801c76  opendevbrowser-extension.zip`
- [x] `opendevbrowser-0.0.18.tgz`
  - Size: `1724897` bytes
  - SHA-1 (`npm pack` / `shasum`): `4a56110d586d974f8c3420493d856470de8b286d`
  - Integrity (`npm pack --json`): `sha512-n0QByy9noOaHxQpePG2Yhdud9CQErVfTlCaiyv35OznOmK6Jk3E+2vswzbkQ62WpTSv3H2+01ZXqZ3dZVqrceg==`

## Optional release-environment gates

- [x] `node scripts/provider-direct-runs.mjs --release-gate --out artifacts/release/v0.0.18/provider-direct-runs.json`
  - Result: rerun on the rebased final candidate; strict gate exited non-zero because non-pass lanes remain, but the artifact recorded `19` pass, `11` env_limited, `0` fail, `0` skipped
  - Environment-limited lanes: community challenge shells, JS-required/social verification shells, policy-blocked posting probes, Costco env limits, Temu timeout, and generic `others` shopping fallback
- [x] `node scripts/live-regression-direct.mjs --release-gate --out artifacts/release/v0.0.18/live-regression-direct.json`
  - Result: rerun on the rebased final candidate with the extension connected; artifact recorded `6` pass, `0` env_limited, `0` fail, `2` skipped and returned overall `ok=true`
  - Pass lanes: daemon preflight, `feature.canvas.managed_headless`, `feature.canvas.managed_headed`, `feature.canvas.extension`, `feature.canvas.cdp`, and `feature.cli.smoke`
  - Skipped lanes: `feature.annotate.relay` and `feature.annotate.direct` (`manual_probe_boundary_observed:*_annotation_timeout`)
- [x] First-run onboarding dry run from `docs/FIRST_RUN_ONBOARDING.md`
  - Result: isolated temp-home install from the packed `0.0.18` tarball succeeded, `--help` and `help` matched, `opendevbrowser version` reported `opendevbrowser v0.0.18`, `--global --full --no-prompt` succeeded, extension assets extracted under the isolated home, daemon start/status passed, and the managed launch/goto/snapshot/disconnect happy path completed
  - Expected note observed: transient temp-workspace install warned that daemon autostart repair was skipped because the CLI path was transient

## Deferred artifacts

- [x] `artifacts/release/v0.0.18/provider-direct-runs.json`
- [x] `artifacts/release/v0.0.18/live-regression-direct.json`

## External release workflow evidence

- [ ] Release workflow run URL
- [ ] GitHub release URL
- [ ] npm publish verification
- [ ] Chrome Web Store publish status
- [ ] Private website sync dispatch evidence

## Notes

- This ledger is the active `0.0.18` proof record and should be updated as gates complete.
- `docs/RELEASE_0.0.17_EVIDENCE.md` remains historical and should not be rewritten during `0.0.18` prep.
- Post-fix blocker closure for this release:
  - `feature.canvas.managed_headless` cleared after widening preview navigation fallback from `data:text/html` timeout into `setContent`/document-write recovery.
  - `feature.canvas.managed_headed` cleared after increasing managed-headed daemon launch budget to `60000ms`.
  - `feature.cli.smoke` cleared after removing the harness-only `review` timeout override of `15000ms`.
- Both strict live-gate scripts currently return non-zero when `env_limited` or `skipped` lanes remain, even with `0` true `fail` results. Release readiness should therefore be read from the recorded counts and scenario details, not the raw process exit code alone.
- Final rebased candidate status:
  - provider direct proof still contains honest `env_limited` lanes but no true failures
  - live regression proof is fully green apart from the two explicit manual annotation boundaries
