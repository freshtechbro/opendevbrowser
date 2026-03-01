# docs/ — Agent Guidelines

Documentation source-of-truth scope. Extends root `AGENTS.md`.

## Scope

Applies to all markdown and reference assets under `docs/`.

## Documentation policy

- Treat implementation code as source of truth before editing docs:
  - CLI commands/flags: `src/cli/args.ts`
  - Tool inventory: `src/tools/index.ts`
  - Relay/ops surfaces: `extension/src/ops/ops-runtime.ts`, `src/relay/protocol.ts`
  - Website ownership/sync contract: `docs/FRONTEND.md` and private repo `opendevbrowser-website-deploy/frontend/src/**`
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
- `docs/EXTENSION_RELEASE_RUNBOOK.md`

When release-gate automation changes:
- `docs/RELEASE_RUNBOOK.md`
- `docs/DISTRIBUTION_PLAN.md`
- `docs/RELEASE_0.0.16_EVIDENCE.md`
- automation scripts:
  - `scripts/audit-zombie-files.mjs`
  - `scripts/docs-drift-check.mjs`
  - `scripts/chrome-store-compliance-check.mjs`

When mirrored website inputs change (`docs/`, `skills/`, `assets/`, `CHANGELOG.md`, `src/tools/index.ts`):
- dispatch private sync via `.github/workflows/dispatch-private-sync.yml`
- validate private website generation/build:
  - `npm run sync:assets --prefix frontend`
  - `npm run generate:docs --prefix frontend`
  - `npm run lint --prefix frontend`
  - `npm run typecheck --prefix frontend`
  - `npm run build --prefix frontend`

## Anti-patterns

- Do not keep stale numeric claims when source has changed.
- Do not document unsupported flags/commands.
- Do not imply public-repo ownership of `frontend/`; website source is private.
- Do not edit private generated frontend docs JSON by hand when the source is in `docs/`, `CHANGELOG.md`, or `skills/*/SKILL.md`.
