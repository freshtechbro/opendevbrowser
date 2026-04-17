# opendevbrowser-website-deploy (Private Repo Template)

Bootstrap template for the private website deployment repository described in `docs/PUBLIC_PRIVATE_DISTRIBUTION_EXECUTION_PLAN.md`.

## Purpose

This repository is the private deployment target for website content while `opendevbrowser` remains the public source for the runtime, OpenCode tool-call integration, CLI, extension, docs, and npm release artifacts.
Public sync also mirrors the generated discovery/help inputs that drive website docs surfaces, including first-contact wording for browser replay, desktop observation, and the browser-scoped computer-use lane: `src/cli/help.ts`, `src/cli/onboarding-metadata.json`, `src/public-surface/generated-manifest.ts`, `src/public-surface/generated-manifest.json`, and `src/tools/index.ts`.

Branch model:
- `main`: integration branch updated by sync workflow.
- `website-production`: deploy-only branch updated by promotion workflow.

## Bootstrap Steps

1. Create private repo `opendevbrowser-website-deploy`.
2. Seed `frontend/` from your preserved private baseline/snapshot (the public repo no longer contains `frontend/`).
3. Copy this template content into the private repo root:
- `.github/workflows/sync-from-public.yml`
- `scripts/sync-from-public.mjs`
- `docs/DEPLOYMENT_RUNBOOK.md`
- `docs/HOSTING_CONFIGURATION.md`
- `docs/CUTOVER_CHECKLIST.md`
4. Add or restore `.github/workflows/promote-website-production.yml` from your private repo baseline before running the sync script.
   The bundled `scripts/sync-from-public.mjs` requires both workflows plus `frontend/package.json` to exist in the private repo root.
5. Configure private repo branch protection:
- protect `main` with required checks
- protect `website-production` and allow CI bot push only
6. Configure repository variables/secrets:
- `PUBLIC_REPO_URL` (optional; defaults to `https://github.com/freshtechbro/opendevbrowser.git`)

## Local Validation

Run from private repo root:

```bash
# prerequisite: private repo already includes .github/workflows/promote-website-production.yml
npm ci --prefix frontend
node scripts/sync-from-public.mjs --public-ref main
npm run sync:assets --prefix frontend
npm run generate:docs --prefix frontend
npm run lint --prefix frontend
npm run typecheck --prefix frontend
npm run build --prefix frontend
```

## Operations Docs

- `docs/DEPLOYMENT_RUNBOOK.md`
- `docs/HOSTING_CONFIGURATION.md`
- `docs/CUTOVER_CHECKLIST.md`
