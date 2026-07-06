# docs/ - Agent Guidelines

Documentation source-of-truth scope. Extends root `AGENTS.md`.

## Scope

Applies to all markdown and reference assets under `docs/`.

## Documentation policy

- Treat implementation code as source of truth before editing docs:
  - CLI commands/flags: `src/cli/args.ts`
  - Generated help/public-surface metadata source: `src/public-surface/source.ts`; generated outputs: `src/public-surface/generated-manifest.ts`, `src/public-surface/generated-manifest.json`; related help sources: `src/cli/help.ts`, `src/cli/onboarding-metadata.json`
  - Tool inventory: `src/tools/index.ts`
  - Relay/ops surfaces: `extension/src/ops/ops-runtime.ts`, `src/relay/protocol.ts`
  - Canvas/session/code-sync surface: `src/browser/canvas-manager.ts`, `src/canvas/repo-store.ts`, `extension/src/canvas/canvas-runtime.ts`
  - Website ownership/sync contract: `docs/FRONTEND.md` and private repo `opendevbrowser-website-deploy/frontend/src/**`
- Keep public docs concise and operational; avoid speculative claims.
- Workflow docs should teach omitted workflow output roots first. Routine workflow examples must not normalize `/tmp/...` or custom `artifacts/...` roots; preserve external roots only when explicitly scoped as cleanup, debug, release, screenshot, screencast, or other evidence exceptions.
- If numbers (commands/tools/coverage) are mentioned, verify from code or generated artifacts in the same pass.
- Keep first-contact help wording explicit for the exact lookup labels `screencast / browser replay`, `desktop observation`, and `computer use / browser-scoped computer use`; do not imply a desktop agent.
- Prefer adding status context (for example `active`, `historical`) over deleting useful historical design docs.
- Treat `prompt-exports/`, root `artifacts/`, `coverage/`, `.tmp/`, untracked `.opendevbrowser` workflow/run outputs, continuity ledgers, and duplicate `* 2.*` scratch files as local-only artifacts; do not cite or commit them as documentation truth. Before cleaning `.opendevbrowser`, preserve every path returned by `git ls-files .opendevbrowser`, including `.opendevbrowser/canvas/adapters.json`.

## Required sync points

When command/tool/channel surface changes:
- `docs/CLI.md`
- `docs/SURFACE_REFERENCE.md`
- `docs/ARCHITECTURE.md`
- `docs/ASSET_INVENTORY.md`
- `docs/README.md`
- `README.md`
- relevant `AGENTS.md` files

When install, package postinstall, or daemon auto-start behavior changes:
- `README.md`
- `docs/CLI.md`
- `docs/FIRST_RUN_ONBOARDING.md`
- `docs/ARCHITECTURE.md`
- `src/cli/AGENTS.md`
- `scripts/AGENTS.md`
- `tests/AGENTS.md`

When workflow output guidance changes:
- `docs/CLI.md`
- `docs/SURFACE_REFERENCE.md`
- `src/public-surface/source.ts`
- `src/public-surface/generated-manifest.ts`
- `src/public-surface/generated-manifest.json`
- `skills/opendevbrowser-best-practices/SKILL.md`
- relevant workflow guidance tests

When Inspiredesign media-analysis dependency/status guidance changes:
- `docs/CLI.md`
- `docs/SURFACE_REFERENCE.md`
- `docs/DEPENDENCIES.md`
- `docs/TROUBLESHOOTING.md`
- `src/public-surface/source.ts`
- `src/public-surface/generated-manifest.ts`
- `src/public-surface/generated-manifest.json`
- `skills/opendevbrowser-best-practices/SKILL.md`
- relevant media-analysis dependency guidance tests

The synced guidance must preserve the branch contract: FFmpeg and FFprobe are recommended optional host tools, not bundled static binaries or default downloads; binary resolution is env, then config, then `PATH`, then common absolute install directories for implicit `PATH`-source ENOENT misses only; invalid env or config paths stay diagnostic and do not fall back; `status-capabilities.host.mediaAnalysis` is diagnostic/preflight visibility only, not product-readiness proof; missing binaries degrade `media-analysis.json` only; `pin-media-index.json` remains the Pinterest pin-media readiness authority, `media-analysis.json` remains advisory, and `motion-evidence.json` remains browser replay authority; missing screenshot or motion capture is non-blocking only when `pin_media_ready` is backed by byte-backed first-party media.

When canvas session/code-sync/projection behavior changes:
- `docs/CLI.md`
- `docs/SURFACE_REFERENCE.md`
- `docs/ARCHITECTURE.md`
- `docs/CANVAS_ADAPTER_PLUGIN_CONTRACT.md`
- `docs/DESIGN_CANVAS_TECHNICAL_SPEC.md`
- `docs/CANVAS_BIDIRECTIONAL_CODE_SYNC_TECHNICAL_SPEC.md`
- `docs/EXTENSION.md`
- `docs/TROUBLESHOOTING.md`
- relevant `AGENTS.md` files under `src/`, `src/browser/`, `src/canvas/`, and `extension/`

When extension behavior changes:
- `docs/EXTENSION.md`
- `docs/TROUBLESHOOTING.md`
- `docs/privacy.md` (if permissions/data-handling claims change)
- `docs/EXTENSION_RELEASE_RUNBOOK.md`
- `extension/README.md`
- `extension/store-assets/LISTING.md`

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
- `docs/EXTENSION_RELEASE_RUNBOOK.md`
- `docs/DISTRIBUTION_PLAN.md`
- the current version-scoped release evidence doc (for this release: `docs/RELEASE_0.0.40_EVIDENCE.md`)
- older ledgers stay historical-only and should receive explicit status clarifications only
- automation scripts:
  - `scripts/audit-zombie-files.mjs`
  - `scripts/docs-drift-check.mjs`
  - `scripts/chrome-store-compliance-check.mjs`
- `extension/store-assets/LISTING.md` when extension release/store wording or reviewer-note boundaries change with the release lane

When mirrored website inputs change (`docs/`, `skills/`, `assets/`, `CHANGELOG.md`, `src/cli/help.ts`, `src/cli/onboarding-metadata.json`, `src/public-surface/generated-manifest.ts`, `src/public-surface/generated-manifest.json`, `src/tools/index.ts`):
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
- Do not conflate CLI/plugin install auto-start reconciliation with raw package postinstall. Package postinstall is best effort, uses `dist/cli/index.js`, and skips local, ambiguous, conflicting, or non-npm package-manager contexts without failing installation.
- Do not describe `canvas.starter.list` or `canvas.starter.apply` as unshipped once `PUBLIC_CANVAS_COMMANDS` includes them.
- Do not describe `tsx-react-v1` as the shipped adapter lane; current docs must describe it as a legacy binding that migrates to `builtin:react-tsx-v2`.
- Do not imply public-repo ownership of `frontend/`; website source is private.
- Do not over-claim `bound_app_runtime`; `canvas_html` remains the default preview/export contract unless the binding opts in and runtime instrumentation exists.
- Do not edit private generated frontend docs JSON by hand when the source is in `docs/`, `CHANGELOG.md`, or `skills/*/SKILL.md`.
- Do not collapse extension relay, browser replay, public desktop observation, and browser-scoped helper lanes into one capability or any desktop-agent description.
- Do not preserve local-only generated artifacts just because they are ignored; clean them when a doc sweep or release gate calls them out.
