# frontend/src/ — Agent Guidelines

Frontend source module scope. Extends `frontend/AGENTS.md`.

## Boundaries

- `app/`: route composition and metadata wiring
- `components/`: reusable UI blocks
- `data/`: stable content primitives
- `lib/`: helpers and typed adapters
- `styles/`: tokenized styling and global rules
- `content/`: generated artifacts consumed by docs routes

## Rules

- Keep route and component files focused; avoid large mixed-purpose files.
- Prefer data-driven page sections via `src/data/*` over duplicated inline strings.
- If docs-generation inputs change (`docs/*.md`, `CHANGELOG.md`, `skills/*/SKILL.md`, generation script), regenerate `src/content/*`.
- Do not hand-edit generated files under `src/content/docs-generated/`; update source and rerun generators.

## Validation

- `npm run lint`
- `npm run typecheck`
- `npm run build`
