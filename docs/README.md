# Documentation Index

Canonical documentation map for the OpenDevBrowser runtime, OpenCode tool-call integration, extension, and distribution surfaces.

Generated help is the canonical first-contact discovery surface and must keep the exact lookup labels `screencast / browser replay`, `desktop observation`, and `computer use / browser-scoped computer use` easy to find.

## Active operational docs

- `<public-repo-root>/README.md` - product overview, installation, and first-run flow
- `<public-repo-root>/docs/ARCHITECTURE.md` - canonical ASCII runtime architecture map, relay modes, and security boundaries
- `<public-repo-root>/docs/CLI.md` - CLI commands, flags, generated help ownership, and operational usage
- `<public-repo-root>/docs/FIRST_RUN_ONBOARDING.md` - first-time local-package onboarding and the manual proof checklist for the help-led quick-start path
- `<public-repo-root>/docs/SURFACE_REFERENCE.md` - canonical command/tool/channel inventory mirrored by `npx opendevbrowser --help` and `npx opendevbrowser help`
- `<public-repo-root>/docs/EXTENSION.md` - extension setup, relay behavior, and diagnostics
- `<public-repo-root>/docs/DESIGN_CANVAS_TECHNICAL_SPEC.md` - active design-canvas runtime and document architecture reference
- `<public-repo-root>/docs/CANVAS_BIDIRECTIONAL_CODE_SYNC_TECHNICAL_SPEC.md` - active code-sync and framework-adapter reference
- `<public-repo-root>/docs/TROUBLESHOOTING.md` - deterministic recovery and verification guidance
- `<public-repo-root>/docs/ANNOTATE.md` - annotation workflows and artifact expectations
- `<public-repo-root>/docs/privacy.md` - extension privacy policy
- `<public-repo-root>/docs/LANDING_METRICS_SOURCE_OF_TRUTH.md` - landing metrics verification register
- `<public-repo-root>/docs/OPEN_SOURCE_ROADMAP.md` - public roadmap register
- `<public-repo-root>/docs/DEPENDENCIES.md` - dependency inventory and update policy
- `<public-repo-root>/docs/ASSET_INVENTORY.md` - brand, extension, and generated help/public-surface asset inventory
- `<public-repo-root>/docs/DISTRIBUTION_PLAN.md` - active public/private distribution strategy
- `<public-repo-root>/docs/RELEASE_RUNBOOK.md` - public npm + GitHub release operations
- `<public-repo-root>/docs/EXTENSION_RELEASE_RUNBOOK.md` - extension artifact/store publication operations
- `<public-repo-root>/docs/CUTOVER_CHECKLIST.md` - public/private cutover and rollback checklist
- `<public-repo-root>/CHANGELOG.md` - release delta history and version-to-version summaries
- `<public-repo-root>/skills/opendevbrowser-best-practices/SKILL.md` - canonical bundled quick-start runbook and direct-run release evidence policy

## Website and design docs

- `<public-repo-root>/docs/FRONTEND.md` - public/private website ownership, sync, and validation contract

## Version-scoped evidence

- `<public-repo-root>/docs/RELEASE_0.0.21_EVIDENCE.md` - current release evidence ledger for the active ship cycle
- `<public-repo-root>/docs/RELEASE_0.0.20_EVIDENCE.md` - historical v0.0.20 release evidence ledger
- `<public-repo-root>/docs/RELEASE_0.0.18_EVIDENCE.md` - historical `v0.0.18` release evidence ledger with the post-release npm parity audit
- `<public-repo-root>/docs/RELEASE_0.0.17_EVIDENCE.md` - historical v0.0.17 release evidence ledger
- `<public-repo-root>/docs/RELEASE_0.0.16_EVIDENCE.md` - historical v0.0.16 release evidence; keep as archival context, not evergreen guidance

## Planning/spec docs (historical or in-flight)

Use these as planning references only; verify against runtime code and active docs before treating them as implementation truth:

- `docs/*_SPEC.md`
- `docs/*_PLAN.md`

## Update workflow

1. Validate implementation truth in source files (`src/**`, `extension/**`) and mirrored website inputs (`docs/**`, `skills/**`, `assets/**`, `CHANGELOG.md`, `src/cli/help.ts`, `src/cli/onboarding-metadata.json`, `src/public-surface/generated-manifest.ts`, `src/public-surface/generated-manifest.json`, `src/tools/index.ts`).
2. Update active documentation sources in this directory.
3. Dispatch private website sync after public source updates:
   - `.github/workflows/dispatch-private-sync.yml`
4. Validate private website generation/build in `opendevbrowser-website-deploy`:
   - `npm run sync:assets --prefix frontend`
   - `npm run generate:docs --prefix frontend`
   - `npm run lint --prefix frontend`
   - `npm run typecheck --prefix frontend`
   - `npm run build --prefix frontend`
5. Keep local-only generated artifacts such as `prompt-exports/`, root `artifacts/`, `coverage/`, `CONTINUITY*.md`, and `sub_continuity.md` uncommitted; `.gitignore` is the policy owner, and `node scripts/audit-zombie-files.mjs` is the duplicate-file guard.
6. Run public quality gates before closing the task.
   - `npx opendevbrowser --help`
   - `npx opendevbrowser help`
   - `node scripts/cli-onboarding-smoke.mjs`
   - touched canonical skill validators (for example `./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh`)
   - `npm run test:release-gate`
   - `node scripts/audit-zombie-files.mjs`
   - `node scripts/docs-drift-check.mjs`
   - `node scripts/chrome-store-compliance-check.mjs`
7. Treat generated help as the canonical first-contact discovery surface, `docs/FIRST_RUN_ONBOARDING.md` as the first-run proof checklist, and `skills/opendevbrowser-best-practices/SKILL.md` as the canonical bundled runbook and direct-run release evidence owner. Keep the onboarding smoke lane isolated inside temp config/cache homes when validating bundled behavior or managed skill lifecycle changes.
