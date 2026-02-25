# docs/ — Agent Guidelines

Documentation source-of-truth scope. Extends root `AGENTS.md`.

## Scope

Applies to all markdown and reference assets under `docs/`.

## Documentation policy

- Treat implementation code as source of truth before editing docs:
  - CLI commands/flags: `src/cli/args.ts`
  - Tool inventory: `src/tools/index.ts`
  - Relay/ops surfaces: `extension/src/ops/ops-runtime.ts`, `src/relay/protocol.ts`
  - Frontend behavior/routes: `frontend/src/**`
- Keep public docs concise and operational; avoid speculative claims.
- If numbers (commands/tools/coverage) are mentioned, verify from code or generated artifacts in the same pass.
- Prefer adding status context (for example `active`, `historical`) over deleting useful historical design docs.

## Required sync points

When command/tool/channel surface changes:
- `docs/CLI.md`
- `docs/SURFACE_REFERENCE.md`
- `docs/ARCHITECTURE.md`
- `README.md`
- relevant `AGENTS.md` files

When extension behavior changes:
- `docs/EXTENSION.md`
- `docs/TROUBLESHOOTING.md`
- `docs/privacy.md` (if permissions/data-handling claims change)

When frontend docs content changes:
- regenerate frontend docs content with:
  - `cd frontend && npm run generate:docs`

## Anti-patterns

- Do not keep stale numeric claims when source has changed.
- Do not document unsupported flags/commands.
- Do not edit generated frontend docs by hand when the source is in `docs/`, `CHANGELOG.md`, or `skills/*/SKILL.md`.
