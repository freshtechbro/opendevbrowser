# docs/ — Agent Guidelines

Documentation source-of-truth scope. Extends root `AGENTS.md`.

## Scope

Applies to all markdown and reference assets under `docs/`.

## Documentation policy

- Treat implementation code as source of truth before editing docs:
  - CLI commands/flags: `src/cli/args.ts`
  - Tool inventory: `src/tools/index.ts`
  - Relay/ops surfaces: `extension/src/ops/ops-runtime.ts`, `src/relay/protocol.ts`
  - Canvas/session/code-sync surface: `src/browser/canvas-manager.ts`, `src/canvas/repo-store.ts`, `extension/src/canvas/canvas-runtime.ts`
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

When canvas session/code-sync/projection behavior changes:
- `docs/CLI.md`
- `docs/SURFACE_REFERENCE.md`
- `docs/ARCHITECTURE.md`
- `docs/CANVAS_ADAPTER_PLUGIN_CONTRACT.md`
- `docs/EXTENSION.md`
- `docs/TROUBLESHOOTING.md`
- `docs/CANVAS_COMPETITIVE_IMPLEMENTATION_SPEC.md`
- relevant `AGENTS.md` files under `src/`, `src/browser/`, `src/canvas/`, and `extension/`

When extension behavior changes:
- `docs/EXTENSION.md`
- `docs/TROUBLESHOOTING.md`
- `docs/privacy.md` (if permissions/data-handling claims change)
- `docs/EXTENSION_RELEASE_RUNBOOK.md`

When annotation delivery or stored-payload behavior changes:
- `docs/ANNOTATE.md`
- `docs/CLI.md`
- `docs/SURFACE_REFERENCE.md`
- `docs/ARCHITECTURE.md`
- `docs/EXTENSION.md`
- `docs/TROUBLESHOOTING.md`
- `docs/privacy.md`

When release-gate automation changes:
- `docs/RELEASE_RUNBOOK.md`
- `docs/DISTRIBUTION_PLAN.md`
- the current version-scoped release evidence doc (for this release: `docs/RELEASE_0.0.17_EVIDENCE.md`)
- automation scripts:
  - `scripts/audit-zombie-files.mjs`
  - `scripts/docs-drift-check.mjs`
  - `scripts/chrome-store-compliance-check.mjs`

When mirrored website inputs change (`docs/`, `skills/`, `assets/`, `CHANGELOG.md`, `src/cli/help.ts`, `src/tools/surface.ts`, `src/tools/index.ts`):
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
- Do not describe `canvas.starter.list` or `canvas.starter.apply` as unshipped once `PUBLIC_CANVAS_COMMANDS` includes them.
- Do not describe `tsx-react-v1` as the shipped adapter lane; current docs must describe it as a legacy binding that migrates to `builtin:react-tsx-v2`.
- Do not imply public-repo ownership of `frontend/`; website source is private.
- Do not over-claim `bound_app_runtime`; `canvas_html` remains the default preview/export contract unless the binding opts in and runtime instrumentation exists.
- Do not edit private generated frontend docs JSON by hand when the source is in `docs/`, `CHANGELOG.md`, or `skills/*/SKILL.md`.
