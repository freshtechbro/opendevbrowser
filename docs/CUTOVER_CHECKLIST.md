# Public/Private Cutover Checklist

Status: active  
Last updated: 2026-03-23

Use this checklist when a public release changes mirrored docs, skills, assets, or changelog content that must reach the private website repository.

## Preconditions

- [ ] Public release docs and release artifacts are finalized.
- [ ] Challenge override docs are synchronized across `README.md`, `docs/ARCHITECTURE.md`, `docs/CLI.md`, `docs/SURFACE_REFERENCE.md`, `docs/privacy.md`, `docs/DEPENDENCIES.md`, and `docs/CUTOVER_CHECKLIST.md`.
- [ ] `challengeAutomationMode` wording is consistent everywhere, including `off|browser|browser_with_helper`, `run > session > config`, and the browser-scoped helper boundary.
- [ ] `docs/RELEASE_RUNBOOK.md` and the current version-scoped evidence doc are updated for the target release.
- [ ] `PRIVATE_REPO_DISPATCH_TOKEN` and `PRIVATE_WEBSITE_REPO` are configured in the public repo if automatic sync is expected.
- [ ] Private repo access is available for validation and promotion checks.

## Public Repo Validation

- [ ] `node scripts/docs-drift-check.mjs`
- [ ] `./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh`
- [ ] Record whether package or config surfaces changed for the release (`package.json`, `tsconfig.json`, `eslint.config.js`, `vitest.config.ts`, and any Vite config if one exists). If none changed, note that no config drift was required.
- [ ] `npm run version:check`
- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `npm run extension:build`
- [ ] `npm run test`
- [ ] `npm run extension:pack`
- [ ] `npm pack`

## Sync Trigger

- [ ] Merge or push the public docs/source update that should mirror into the private repo.
- [ ] Confirm `.github/workflows/dispatch-private-sync.yml` fired, or manually dispatch it with the intended `public_ref` and `public_sha`.
- [ ] If the workflow warns that `PRIVATE_REPO_DISPATCH_TOKEN` cannot access `PRIVATE_WEBSITE_REPO`, treat that as an infra credential issue, fix the token/repo access, and re-dispatch manually.
- [ ] Record the public SHA sent to the private repo.

## Private Repo Validation

- [ ] `npm run sync:assets --prefix frontend`
- [ ] `npm run generate:docs --prefix frontend`
- [ ] `npm run lint --prefix frontend`
- [ ] `npm run typecheck --prefix frontend`
- [ ] `npm run build --prefix frontend`
- [ ] Confirm generated docs include the new changelog/docs/skill content.

## Production Promotion

- [ ] Promote validated private `main` state to `website-production`.
- [ ] Confirm hosting points production at `website-production`.
- [ ] Verify the production docs routes load and show the expected release content.

## Rollback

- [ ] If sync output is wrong, stop promotion and retain the prior `website-production` commit.
- [ ] Re-dispatch sync from the last known-good public SHA or repromote the last known-good private commit.
- [ ] Record the rollback SHA pair in the release evidence doc.
