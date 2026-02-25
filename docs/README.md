# Documentation Index

Canonical documentation map for OpenDevBrowser runtime, extension, and frontend docs surfaces.

## Active operational docs

- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/README.md` - product overview, installation, and first-run flow
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/docs/ARCHITECTURE.md` - canonical ASCII runtime architecture map, relay modes, and security boundaries
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/docs/CLI.md` - CLI commands, flags, and operational usage
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/docs/FIRST_RUN_ONBOARDING.md` - first-time local-package onboarding and first-task verification flow
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/docs/SURFACE_REFERENCE.md` - canonical command/tool/channel inventory
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/docs/EXTENSION.md` - extension setup, relay behavior, and diagnostics
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/docs/TROUBLESHOOTING.md` - deterministic recovery and verification guidance
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/docs/ANNOTATE.md` - annotation workflows and artifact expectations
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/docs/privacy.md` - extension privacy policy
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/docs/LANDING_METRICS_SOURCE_OF_TRUTH.md` - landing metrics verification register
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/docs/OPEN_SOURCE_ROADMAP.md` - public roadmap register
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/docs/DEPENDENCIES.md` - dependency inventory and update policy
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/docs/DISTRIBUTION_PLAN.md` - active public/private distribution strategy
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/docs/RELEASE_RUNBOOK.md` - public npm + GitHub release operations
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/docs/EXTENSION_RELEASE_RUNBOOK.md` - extension artifact/store publication operations
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/docs/CUTOVER_CHECKLIST.md` - public/private cutover and rollback checklist

## Frontend and design docs

- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/docs/FRONTEND.md` - frontend architecture, routes, and docs generation pipeline
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/docs/FRONTEND_DESIGN_AUDIT.md` - implementation audit record
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/docs/ASSET_INVENTORY.md` - brand and marketing asset inventory

## Planning/spec docs (historical or in-flight)

Use these as planning references only; verify against runtime code and active docs before treating them as implementation truth:

- `docs/*_SPEC.md`
- `docs/*_PLAN.md`
- `docs/landing-prototypes/*`
- `docs/LANDING_DASHBOARD_DESIGN_FINDINGS.md`

## Update workflow

1. Validate implementation truth in source files (`src/**`, `extension/**`, `frontend/src/**`).
2. Update active documentation sources in this directory.
3. Regenerate frontend docs content:
   - `cd /Users/bishopdotun/Documents/DevProjects/opendevbrowser/frontend && npm run generate:docs`
4. Run quality gates before closing the task.
