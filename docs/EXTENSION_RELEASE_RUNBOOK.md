# Extension Release Runbook

Last updated: 2026-02-25

Operational runbook for publishing extension artifacts from the public repo.

## Distribution lanes

### Lane A (required): GitHub release artifact

Always produced from `.github/workflows/release-public.yml`:
- `opendevbrowser-extension.zip`
- `opendevbrowser-extension.zip.sha256`

This is the canonical extension release lane.

### Lane B (optional): Chrome Web Store publish

Manual-gated workflow:
- `.github/workflows/chrome-store-publish.yml`
- script: `scripts/chrome-store-publish.mjs`

Use this lane when store publication is enabled for the release.

## Required secrets (Lane B)

Configure in public GitHub repo secrets:
- `CWS_CLIENT_ID`
- `CWS_CLIENT_SECRET`
- `CWS_REFRESH_TOKEN`
- `CWS_EXTENSION_ID`

## Preflight checklist

- [ ] `package.json` version equals intended release version.
- [ ] `extension/manifest.json` version is synced.
- [ ] `extension/package.json` version is synced.
- [ ] `npm run extension:build` passes.
- [ ] `node scripts/chrome-store-compliance-check.mjs` passes.
- [ ] `npm run extension:pack` creates `opendevbrowser-extension.zip`.
- [ ] `npm run version:check` passes.

## Lane A execution

1. Run tag-driven public release flow (`docs/RELEASE_RUNBOOK.md`).
2. Confirm GitHub release includes extension zip + checksum.
3. Verify checksum locally if required:

```bash
shasum -a 256 opendevbrowser-extension.zip
```

## Lane B execution (workflow)

Trigger workflow dispatch for `Chrome Store Publish` with:
- `release_ref`: tag or commit to publish
- `release_tag`: `vX.Y.Z`
- `publish`: `false` for upload-only validation, `true` for live publish
- `publish_target`: `default` or `trustedTesters`

Workflow behavior:
- validates tag format and version match
- builds extension artifact
- uploads zip to Chrome Web Store
- optionally publishes to selected target

## Lane B execution (local/manual)

```bash
npm run extension:build
npm run extension:pack
npm run extension:store -- --zip opendevbrowser-extension.zip --publish-target default --publish
```

For upload-only dry run, omit `--publish`.

## Post-publish validation

- [ ] Store dashboard shows expected version.
- [ ] Release notes include store publication status and version.
- [ ] GitHub release tag and extension manifest versions match store version.

## Failure handling

### Upload fails

- verify OAuth credentials and extension ID
- retry upload-only path first (`publish=false`)

### Publish fails after upload

- validate listing readiness in store dashboard
- retry publish with `publish_target=trustedTesters` to isolate policy/review issues

### Version drift detected

- stop publication
- rebuild from correct release tag
- republish aligned version only

## Rollback controls

If a bad extension release is published:
- move users to previous stable release via store controls (if available)
- publish hotfix version from corrected tag
- update incident notes in release documentation

## Evidence to retain

- workflow run URL(s)
- upload/publish JSON output summary
- store listing URL and visible version
- checksum artifact from GitHub release
