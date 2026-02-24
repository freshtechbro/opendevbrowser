# OpenDevBrowser Frontend

Marketing and documentation frontend for OpenDevBrowser (Next.js 15 + React 19).

## What this app serves

- Marketing routes (`/`, `/product`, `/workflows`, `/use-cases`, `/security`, `/open-source`, `/resources`, `/company`)
- Docs gateway (`/docs`) and generated reference pages (`/docs/*`)
- Runtime metrics and roadmap views sourced from repo docs

## Commands

Run from `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/frontend`:

```bash
npm install
npm run dev
npm run lint
npm run typecheck
npm run build
```

## Content generation pipeline

Before dev/build, the app syncs and regenerates content:

- `npm run sync:assets` copies `/assets` -> `frontend/public/brand`
- `npm run generate:docs` builds:
  - `frontend/src/content/docs-generated/pages.json`
  - `frontend/src/content/docs-manifest.json`
  - `frontend/src/content/metrics.json`
  - `frontend/src/content/roadmap.json`

Generation sources include:

- `docs/ARCHITECTURE.md`
- `docs/CLI.md`
- `docs/EXTENSION.md`
- `docs/SURFACE_REFERENCE.md`
- `docs/LANDING_METRICS_SOURCE_OF_TRUTH.md`
- `docs/OPEN_SOURCE_ROADMAP.md`
- `CHANGELOG.md`
- `skills/*/SKILL.md`

## Source map

- App routes: `frontend/src/app`
- UI components: `frontend/src/components`
- Data contracts: `frontend/src/data`
- Docs helpers: `frontend/src/lib/docs`
- Styles/tokens: `frontend/src/styles`

## Notes

- Generated docs content is not hand-authored; update source docs and rerun generators.
- CLI examples in frontend copy must match current CLI flags and command surface.
