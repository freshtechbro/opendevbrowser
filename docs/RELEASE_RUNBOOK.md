# Public Release Runbook

Last updated: 2026-04-12

Canonical runbook for shipping OpenDevBrowser public releases (npm package + GitHub release artifacts) from this repository.

## Scope

This runbook covers:
- release prep on a branch
- tagged release execution through `.github/workflows/release-public.yml`
- post-release validation and rollback controls

It does not cover website hosting deploys. Website deploy cutover is handled in `docs/CUTOVER_CHECKLIST.md` plus the private-repo deployment docs.

## Required inputs

- Release version: `X.Y.Z`
- Release tag: `vX.Y.Z`
- Public repo branch with merged release changes
- npm publish token (`NPM_TOKEN`) configured in GitHub Actions secrets

## Required CI configuration

- Workflow: `.github/workflows/release-public.yml`
- Trigger modes:
  - Tag push: pushing `vX.Y.Z` runs the publish-enabled release path with `publish_npm=true`, `publish_github_release=true`, `draft_release=false`, and `run_release_live_gates=false`.
  - `workflow_dispatch`: manual dry runs or controlled publishes use the inputs below.
- Workflow dispatch inputs:
  - `release_ref`
  - `release_tag`
  - `publish_npm`
  - `publish_github_release`
  - `draft_release`
  - `run_release_live_gates`

## Preflight checklist

- ### Local preflight policy

- [ ] `package.json` version is updated to target semver.
- [ ] Extension version metadata is synced (`npm run extension:sync` updates `extension/manifest.json` and `extension/package.json`).
- [ ] Local policy gates pass:
  - `npm run version:check`
  - `npm run test:release-gate` (grouped contract coverage only; rerun only failed group with `npm run test:release-gate:g<N>`)
  - `node scripts/audit-zombie-files.mjs`
  - `node scripts/docs-drift-check.mjs`
  - `node scripts/chrome-store-compliance-check.mjs`
  - `./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh`
  - `npx opendevbrowser --help`
  - `npx opendevbrowser help`
  - Treat the two help commands above as release-facing wording proof for `screencast / browser replay`, `desktop observation`, and `computer use / browser-scoped computer use`.
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test`
  - `npm run build`
  - `npm run extension:build`
  - `node scripts/provider-direct-runs.mjs --release-gate --out artifacts/release/vX.Y.Z/provider-direct-runs.json`
  - `node scripts/live-regression-direct.mjs --release-gate --out artifacts/release/vX.Y.Z/live-regression-direct.json`
  - Treat the two direct-run commands above as the optional strict live release-proof lane. Keep them distinct from grouped contract checks such as `npm run test:release-gate`.
  - `npm run extension:pack`
  - `npm pack`
- [ ] First-time global install dry run passes (`docs/FIRST_RUN_ONBOARDING.md`) with daemon + extension + mode validation evidence captured.
- [ ] Release branch is merged to `main`.

### CI workflow gates executed by `.github/workflows/release-public.yml`

- [ ] `npm ci`
- [ ] `npm run version:check`
- [ ] `node scripts/audit-zombie-files.mjs`
- [ ] `node scripts/docs-drift-check.mjs`
- [ ] `node scripts/chrome-store-compliance-check.mjs`
- [ ] `./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh`
- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm run test`
- [ ] `npm run build`
- [ ] `npx opendevbrowser --help`
- [ ] `npx opendevbrowser help`
- [ ] `npm run extension:build`
- [ ] Optional strict live gates run only when `run_release_live_gates=true`:
  - `node scripts/provider-direct-runs.mjs --release-gate --out artifacts/release/vX.Y.Z/provider-direct-runs.json`
  - `node scripts/live-regression-direct.mjs --release-gate --out artifacts/release/vX.Y.Z/live-regression-direct.json`
- [ ] `npm run extension:pack`
- [ ] GitHub release artifact packaging computes `opendevbrowser-extension.zip.sha256` before publish.

## Release execution

### Standard tag-driven release (recommended)

1. Create and push tag from merged commit:

```bash
git checkout main
git pull --ff-only
git tag vX.Y.Z
git push origin vX.Y.Z
```

2. GitHub Actions automatically runs `Public Release` with publish enabled.
3. Workflow gates:
- resolves publish defaults from the trigger mode and validates `release_tag` format (`vX.Y.Z`)
- validates `package.json` version matches the tag
- runs `npm run version:check`
- runs `node scripts/audit-zombie-files.mjs`
- runs `node scripts/docs-drift-check.mjs`
- runs `node scripts/chrome-store-compliance-check.mjs`
- runs `./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh`
- runs `npm run lint`
- runs `npm run typecheck`
- runs `npm run test`
- runs `npm run build`
- runs `npx opendevbrowser --help` and `npx opendevbrowser help` as release-facing wording proof for `screencast / browser replay`, `desktop observation`, and `computer use / browser-scoped computer use`
- runs `npm run extension:build`
- optionally runs strict live gates when `run_release_live_gates=true`
  - this input executes only `node scripts/provider-direct-runs.mjs --release-gate ...` and `node scripts/live-regression-direct.mjs --release-gate ...`, not grouped wrappers or matrix scripts
- runs `npm run extension:pack`
- computes checksum (`opendevbrowser-extension.zip.sha256`)
- publishes npm package when enabled
- publishes GitHub release and uploads extension artifacts when enabled

### Manual dry-run release

Use workflow dispatch when validating release flow without publishing npm:

- `publish_npm=false`
- `publish_github_release=true`
- `draft_release=true`

This path validates build/package/release artifact generation before production tag release.

## Post-release validation

Run and record:

```bash
npm view opendevbrowser version
```

Confirm all of the following:
- npm version equals tag version (`X.Y.Z`)
- GitHub release `vX.Y.Z` exists
- release assets include:
  - `opendevbrowser-extension.zip`
  - `opendevbrowser-extension.zip.sha256`
- checksum file matches uploaded zip

## Failure handling

### Tag/version mismatch

- Symptom: workflow fails at version validation.
- Action: fix `package.json` and manifest sync, retag with corrected version.

### npm publish failure

- Symptom: release job fails on `npm publish`.
- Action:
  - verify `NPM_TOKEN`
  - verify package version is not already published
  - rerun using workflow dispatch once corrected
  - if npm is already live and only the GitHub release is missing, rerun the same tag with `publish_npm=false`, `publish_github_release=true`, and `draft_release=false`

### GitHub release artifact failure

- Symptom: tag exists but release/assets missing.
- Action:
  - rerun workflow dispatch for the same tag with `publish_github_release=true`
  - ensure artifact packaging step is green

## Rollback controls

If release is bad after publish:

1. Deprecate problematic npm version:

```bash
npm deprecate opendevbrowser@X.Y.Z "deprecated: use <fixed-version>"
```

2. Prepare and publish corrective release `X.Y.Z+1` (or next semver).
3. Update release notes with incident summary and migration guidance.

## Evidence to retain

- Release workflow run URL
- npm published version output (or explicit publish deferral for manual dry runs)
- GitHub release URL
- checksum artifact
- If `run_release_live_gates=true`, retain `artifacts/release/vX.Y.Z/provider-direct-runs.json` and `artifacts/release/vX.Y.Z/live-regression-direct.json`; otherwise record explicit deferral in the active version-scoped release evidence ledger.
- rollback/deprecation record (if incident occurred)
