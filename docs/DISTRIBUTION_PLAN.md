# OpenDevBrowser Distribution Plan

Last updated: 2026-02-25

This document is the active distribution plan for the split model:
- public repo for runtime + release artifacts
- private repo for website source + deployment

## Overview

### Distribution channels
- npm package: `opendevbrowser` (public repo release)
- GitHub release artifacts: extension zip + checksum (public repo release)
- Website deploy: private repo `website-production` branch

Public repo no longer carries the `frontend/` application directory.

### Public workflow inventory
- `.github/workflows/release-public.yml`
  - tag/manual release workflow
  - validates version alignment
  - runs quality gates
  - publishes npm package and GitHub release assets
- `.github/workflows/dispatch-private-sync.yml`
  - dispatches `repository_dispatch` to private website repo on docs/skills/assets/changelog/tool index updates
- `.github/workflows/chrome-store-publish.yml` (optional lane)
  - manual Chrome Web Store upload/publish workflow

### Private workflow inventory (in `opendevbrowser-website-deploy`)
- `.github/workflows/sync-from-public.yml`
- `.github/workflows/promote-website-production.yml`

## Release sequence (public)

1. Prepare release branch:
- bump `package.json` version
- sync extension version (`npm run extension:sync`)
- update release notes/docs as needed

2. Validate locally:

```bash
npm run version:check
npm run test:release-gate
node scripts/audit-zombie-files.mjs
node scripts/docs-drift-check.mjs
node scripts/chrome-store-compliance-check.mjs
npm run lint
npm run typecheck
npm run test
npm run build
npm run extension:build
node scripts/provider-live-matrix.mjs --release-gate --out artifacts/release/v0.0.16/provider-live-matrix.json
node scripts/live-regression-matrix.mjs --release-gate
```

If one grouped release-gate unit fails, rerun only that unit:

```bash
npm run test:release-gate:g1
npm run test:release-gate:g2
npm run test:release-gate:g3
npm run test:release-gate:g4
npm run test:release-gate:g5
```

First-time global install dry run is mandatory before tagging:

```bash
# follow docs/FIRST_RUN_ONBOARDING.md global-install simulation
npx opendevbrowser --global --full --no-prompt
```

3. Merge to `main`.

4. Tag release:

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

5. `release-public.yml` publishes:
- npm package (`npm publish --access public`)
- GitHub release with:
  - `opendevbrowser-extension.zip`
  - `opendevbrowser-extension.zip.sha256`

6. `dispatch-private-sync.yml` triggers private website sync for mirrored public content.

## Website deployment sequence (private)

1. `sync-from-public.yml` mirrors:
- `docs/`
- `skills/`
- `assets/`
- `CHANGELOG.md`
- `src/tools/index.ts`

2. Private workflow regenerates frontend content and validates:

```bash
npm run sync:assets --prefix frontend
npm run generate:docs --prefix frontend
npm run lint --prefix frontend
npm run typecheck --prefix frontend
npm run build --prefix frontend
```

3. `promote-website-production.yml` revalidates and force-updates `website-production`.

4. Hosting provider deploys production from `website-production` only.

## Required secrets and variables

### Public repo
- `NPM_TOKEN`
- `PRIVATE_REPO_DISPATCH_TOKEN`
- `PRIVATE_WEBSITE_REPO` (repository variable)

### Public repo (optional store lane)
- `CWS_CLIENT_ID`
- `CWS_CLIENT_SECRET`
- `CWS_REFRESH_TOKEN`
- `CWS_EXTENSION_ID`

### Private repo
- `PUBLIC_REPO_URL` (repository variable)

## Acceptance criteria

- [x] Public release workflow exists and validates version alignment.
- [x] Public dispatch workflow exists and targets private sync pipeline.
- [x] Private sync + promotion workflows are live.
- [x] Public repo frontend source was extracted after private validation baseline.
- [ ] Hosting production branch is enforced to `website-production`.
- [ ] Public first tagged release completed through new workflow path.

## Operational references

- `docs/RELEASE_RUNBOOK.md`
- `docs/EXTENSION_RELEASE_RUNBOOK.md`
- `docs/CUTOVER_CHECKLIST.md`
- `docs/PUBLIC_PRIVATE_DISTRIBUTION_EXECUTION_PLAN.md`
