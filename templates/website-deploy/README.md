# opendevbrowser-website-deploy (Private Repo Template)

Bootstrap template for the private website deployment repository described in `docs/PUBLIC_PRIVATE_DISTRIBUTION_EXECUTION_PLAN.md`.

## Purpose

This repository is the private deployment target for website content while `opendevbrowser` remains the public source for runtime, CLI, extension, docs, and npm release artifacts.

Branch model:
- `main`: integration branch updated by sync workflow.
- `website-production`: deploy-only branch updated by promotion workflow.

## Bootstrap Steps

1. Create private repo `opendevbrowser-website-deploy`.
2. Copy `frontend/` from the public repo into this private repo.
3. Copy this template content into the private repo root:
- `.github/workflows/sync-from-public.yml`
- `.github/workflows/promote-website-production.yml`
- `scripts/sync-from-public.mjs`
- `docs/DEPLOYMENT_RUNBOOK.md`
- `docs/HOSTING_CONFIGURATION.md`
- `docs/CUTOVER_CHECKLIST.md`
4. Configure private repo branch protection:
- protect `main` with required checks
- protect `website-production` and allow CI bot push only
5. Configure repository variables/secrets:
- `PUBLIC_REPO_URL` (optional; defaults to `https://github.com/freshtechbro/opendevbrowser.git`)

## Local Validation

Run from private repo root:

```bash
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
