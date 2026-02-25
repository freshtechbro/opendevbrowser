# frontend/ — Agent Guidelines

OpenDevBrowser web frontend (Next.js) scope. Extends root `AGENTS.md`.

## Stack

- Next.js 15
- React 19
- TypeScript strict mode

## Project structure

- `src/app/` — routes and layouts
- `src/components/` — UI composition
- `src/data/` — static data contracts used by routes/components
- `src/lib/` — docs/SEO/analytics helpers
- `src/content/` — generated docs + metrics + roadmap JSON
- `scripts/` — asset sync and docs generation
- `public/brand/` — synchronized brand assets

## Build and validation

Run from `frontend/`:

```bash
npm run lint
npm run typecheck
npm run build
```

Use these generators before dev/build:

```bash
npm run sync:assets
npm run generate:docs
```

## Documentation coupling

- Frontend docs routes are generated from repo docs + skills via `scripts/generate-docs.mjs`.
- Do not edit `src/content/docs-generated/pages.json` manually; regenerate from sources.
- Keep CLI examples aligned with current command surface (for example use `launch --no-extension` for managed mode).

## UI constraints

- Preserve current design system tokens and accessibility patterns.
- Keep route-level metadata accurate (`src/lib/seo/metadata.ts`).
