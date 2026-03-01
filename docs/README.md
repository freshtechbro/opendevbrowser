# Documentation Index

Canonical documentation map for OpenDevBrowser runtime, extension, and distribution surfaces.

## Active operational docs

- `<public-repo-root>/README.md` - product overview, installation, and first-run flow
- `<public-repo-root>/docs/ARCHITECTURE.md` - canonical ASCII runtime architecture map, relay modes, and security boundaries
- `<public-repo-root>/docs/CLI.md` - CLI commands, flags, and operational usage
- `<public-repo-root>/docs/FIRST_RUN_ONBOARDING.md` - first-time local-package onboarding and first-task verification flow
- `<public-repo-root>/docs/SURFACE_REFERENCE.md` - canonical command/tool/channel inventory
- `<public-repo-root>/docs/EXTENSION.md` - extension setup, relay behavior, and diagnostics
- `<public-repo-root>/docs/TROUBLESHOOTING.md` - deterministic recovery and verification guidance
- `<public-repo-root>/docs/ANNOTATE.md` - annotation workflows and artifact expectations
- `<public-repo-root>/docs/privacy.md` - extension privacy policy
- `<public-repo-root>/docs/LANDING_METRICS_SOURCE_OF_TRUTH.md` - landing metrics verification register
- `<public-repo-root>/docs/OPEN_SOURCE_ROADMAP.md` - public roadmap register
- `<public-repo-root>/docs/DEPENDENCIES.md` - dependency inventory and update policy
- `<public-repo-root>/docs/DISTRIBUTION_PLAN.md` - active public/private distribution strategy
- `<public-repo-root>/docs/RELEASE_RUNBOOK.md` - public npm + GitHub release operations
- `<public-repo-root>/docs/EXTENSION_RELEASE_RUNBOOK.md` - extension artifact/store publication operations
- `<public-repo-root>/docs/CUTOVER_CHECKLIST.md` - public/private cutover and rollback checklist
- `<public-repo-root>/docs/RELEASE_0.0.16_EVIDENCE.md` - v0.0.16 release evidence ledger
- `<public-repo-root>/CHANGELOG.md` - release delta history and version-to-version summaries

## Website and design docs

- `<public-repo-root>/docs/FRONTEND.md` - public/private website ownership, sync, and validation contract
- `<public-repo-root>/docs/ASSET_INVENTORY.md` - brand and marketing asset inventory

## Planning/spec docs (historical or in-flight)

Use these as planning references only; verify against runtime code and active docs before treating them as implementation truth:

- `docs/*_SPEC.md`
- `docs/*_PLAN.md`

## Update workflow

1. Validate implementation truth in source files (`src/**`, `extension/**`) and mirrored website inputs (`docs/**`, `skills/**`, `assets/**`, `CHANGELOG.md`, `src/tools/index.ts`).
2. Update active documentation sources in this directory.
3. Dispatch private website sync after public source updates:
   - `.github/workflows/dispatch-private-sync.yml`
4. Validate private website generation/build in `opendevbrowser-website-deploy`:
   - `npm run sync:assets --prefix frontend`
   - `npm run generate:docs --prefix frontend`
   - `npm run lint --prefix frontend`
   - `npm run typecheck --prefix frontend`
   - `npm run build --prefix frontend`
5. Run public quality gates before closing the task.
   - `npm run test:release-gate`
   - `node scripts/audit-zombie-files.mjs`
   - `node scripts/docs-drift-check.mjs`
   - `node scripts/chrome-store-compliance-check.mjs`
