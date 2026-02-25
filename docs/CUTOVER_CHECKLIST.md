# Public/Private Distribution Cutover Checklist

Last updated: 2026-02-25

## Phase 0 — Governance

- [ ] Private repo `opendevbrowser-website-deploy` is created.
- [ ] Public `main` and private `website-production` branch protections are active.
- [ ] Private deploy branch allows CI-only updates.
- [ ] Public/Private required secrets are configured.

## Phase 1 — Private Repo Bootstrap

- [ ] Copy `frontend/` from public repo into private repo.
- [ ] Apply `templates/website-deploy/*` assets in private repo.
- [ ] Validate private repo local gates:
  - `npm ci --prefix frontend`
  - `npm run sync:assets --prefix frontend`
  - `npm run generate:docs --prefix frontend`
  - `npm run lint --prefix frontend`
  - `npm run typecheck --prefix frontend`
  - `npm run build --prefix frontend`

## Phase 2 — Sync and Promotion

- [ ] Confirm private sync workflow runs from dispatch and schedule.
- [ ] Confirm no-op repeat sync is deterministic.
- [ ] Confirm promotion workflow updates only `website-production`.
- [ ] Confirm promotion metadata artifact is emitted.

## Phase 3 — Hosting Cutover

- [ ] Vercel production branch is `website-production`.
- [ ] Preview deployments use non-production branches.
- [ ] First production deploy from private repo succeeds.
- [ ] Rollback to previous deployment is tested.

## Phase 4 — Public Release Lane

- [ ] `release-public.yml` is active and validated.
- [ ] Tag-triggered release succeeds with npm + GitHub artifacts.
- [ ] Extension zip and checksum are attached to release.
- [ ] Optional Chrome Web Store lane is validated (if enabled).

## Phase 5 — Public Repo Frontend Extraction

- [ ] Remove `frontend/` from public repo after private production validation.
- [ ] Update public docs references (`README.md`, `docs/FRONTEND.md`, `docs/DISTRIBUTION_PLAN.md`).
- [ ] Re-run public repo quality gates after extraction.

## Exit Criteria

- [ ] Website deploys only from private `website-production`.
- [ ] Public release automation ships npm + extension artifacts reliably.
- [ ] Rollback playbooks are tested and documented.
