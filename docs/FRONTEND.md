# OpenDevBrowser Frontend

Status: active  
Last updated: 2026-02-24

## Overview

The frontend (`frontend/`) is a Next.js 15 application that serves:

- marketing pages for product, workflows, and operations messaging
- a docs gateway plus generated reference pages by category
- surfaced metrics and roadmap data derived from repository source-of-truth docs

## Route map

Marketing routes:
- `/`
- `/product`
- `/workflows`
- `/use-cases`
- `/security`
- `/open-source`
- `/resources`
- `/company`

Docs routes:
- `/docs`
- `/docs/[category]`
- `/docs/[category]/[slug]`

Docs pages are generated from repository docs, source code metadata, and skill pack definitions.

## Source structure

- `frontend/src/app` — route/layout files
- `frontend/src/components` — reusable UI components
- `frontend/src/data` — typed page content contracts
- `frontend/src/lib/docs` — docs manifest/page lookup helpers
- `frontend/src/content` — generated docs + metrics + roadmap JSON
- `frontend/src/styles` — token and global CSS
- `frontend/scripts` — generation/sync scripts

## Content generation pipeline

Generated files:
- `frontend/src/content/docs-generated/pages.json`
- `frontend/src/content/docs-manifest.json`
- `frontend/src/content/metrics.json`
- `frontend/src/content/roadmap.json`

Generation command:

```bash
cd frontend
npm run generate:docs
```

Generation sources:
- `docs/ARCHITECTURE.md`
- `docs/CLI.md`
- `docs/EXTENSION.md`
- `docs/ANNOTATE.md`
- `docs/TROUBLESHOOTING.md`
- `docs/FIRST_RUN_ONBOARDING.md`
- `docs/DEPENDENCIES.md`
- `docs/SURFACE_REFERENCE.md`
- `docs/LANDING_METRICS_SOURCE_OF_TRUTH.md`
- `docs/OPEN_SOURCE_ROADMAP.md`
- `CHANGELOG.md`
- `skills/*/SKILL.md`

Generated categories include `quickstart`, `installation`, `cli`, `tools`, `workflows`, `guides`, `extension`, `concepts`, `skills`, and `changelog`.

Asset sync command:

```bash
cd frontend
npm run sync:assets
```

Copies `/assets` into `frontend/public/brand`.

## Frontend validation

```bash
cd frontend
npm run lint
npm run typecheck
npm run build
```

## Documentation alignment rules

- Do not hand-edit generated JSON under `frontend/src/content/docs-generated/`.
- Keep CLI examples aligned with implemented flags/commands.
- If docs or skill sources change, rerun generation before shipping frontend changes.
- When docs copy is updated, verify generated page summaries and route-level descriptions in `/docs` still match implementation behavior.
