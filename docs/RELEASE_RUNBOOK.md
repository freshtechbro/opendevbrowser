# Public Release Runbook

Last updated: 2026-02-25

Canonical runbook for shipping OpenDevBrowser public releases (npm package + GitHub release artifacts) from this repository.

## Scope

This runbook covers:
- release prep on a branch
- tagged release execution through `.github/workflows/release-public.yml`
- post-release validation and rollback controls

It does not cover website hosting deploys. Website deploy cutover is handled in `docs/CUTOVER_CHECKLIST.md` and private-repo docs.

## Required inputs

- Release version: `X.Y.Z`
- Release tag: `vX.Y.Z`
- Public repo branch with merged release changes
- npm publish token (`NPM_TOKEN`) configured in GitHub Actions secrets

## Required CI configuration

- Workflow: `.github/workflows/release-public.yml`
- Optional workflow dispatch inputs:
  - `release_ref`
  - `release_tag`
  - `publish_npm`
  - `publish_github_release`
  - `draft_release`
  - `run_release_live_gates`

## Preflight checklist

- [ ] `package.json` version is updated to target semver.
- [ ] `extension/manifest.json` is synced (`npm run extension:sync`).
- [ ] Local quality gates pass:
  - `npm run version:check`
  - `npm run test:release-gate` (grouped release-gate units; rerun only failed group with `npm run test:release-gate:g<N>`)
  - `node scripts/audit-zombie-files.mjs`
  - `node scripts/docs-drift-check.mjs`
  - `node scripts/chrome-store-compliance-check.mjs`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test`
  - `npm run build`
  - `npm run extension:build`
- [ ] First-time global install dry run passes (`docs/FIRST_RUN_ONBOARDING.md`) with daemon + extension + mode validation evidence captured.
- [ ] Release branch is merged to `main`.

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
- validates `release_tag` format (`vX.Y.Z`)
- validates `package.json` version matches the tag
- runs release quality gates
- optionally runs strict live gates when `run_release_live_gates=true`
- builds and packs extension zip
- computes checksum (`opendevbrowser-extension.zip.sha256`)
- publishes npm package
- publishes GitHub release and uploads extension artifacts

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
- npm published version output
- GitHub release URL
- checksum artifact
- rollback/deprecation record (if incident occurred)
