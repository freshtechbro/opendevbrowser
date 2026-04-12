# OpenDevBrowser Frontend

Status: active  
Last updated: 2026-04-12

## Overview

The frontend source is no longer maintained in this public repository.

- Frontend source of truth: private repo `opendevbrowser-website-deploy` (`frontend/`).
- Production deploy branch: private `website-production`.
- Public repo role: provide mirrored content inputs and trigger private sync.
- Mirrored help/public-surface inputs include the exact first-contact discovery labels `screencast / browser replay`, `desktop observation`, and `computer use / browser-scoped computer use`.

## Public/Private contract

Public repo (`opendevbrowser`) supplies:
- `docs/`
- `skills/`
- `assets/`
- `CHANGELOG.md`
- `src/cli/help.ts`
- `src/cli/onboarding-metadata.json`
- `src/public-surface/generated-manifest.ts`
- `src/public-surface/generated-manifest.json`
- `src/tools/index.ts`

Private repo (`opendevbrowser-website-deploy`) owns:
- Next.js frontend implementation
- generated frontend content files
- website build and deployment workflows

## Sync and promotion flow

1. Public workflow `.github/workflows/dispatch-private-sync.yml` dispatches `opendevbrowser_public_sync`.
2. Private workflow `sync-from-public.yml` mirrors public inputs and regenerates frontend content.
3. Private workflow `promote-website-production.yml` validates and promotes to `website-production`.

## Private repo validation commands

Run in private repo root:

```bash
npm ci --prefix frontend
npm run sync:assets --prefix frontend
npm run generate:docs --prefix frontend
npm run lint --prefix frontend
npm run typecheck --prefix frontend
npm run build --prefix frontend
```

## Documentation alignment rules

- Do not hand-edit generated frontend JSON in the private repo.
- Keep public docs/skills/assets/changelog/help/onboarding/public-surface metadata aligned before dispatching sync.
- Validate private workflow output determinism on repeated sync runs.
