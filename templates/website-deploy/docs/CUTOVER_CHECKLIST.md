# Cutover Checklist (Private Website Repo)

## Pre-cutover

- [ ] Private repo exists and is accessible by maintainers and CI.
- [ ] `frontend/` copied from public repo and validated locally.
- [ ] `sync-from-public.yml` and `promote-website-production.yml` installed.
- [ ] Branch protections active (`main`, `website-production`).
- [ ] Hosting project connected with production branch `website-production`.

## Dry run

- [ ] Run `sync-from-public.yml` manually and verify deterministic output.
- [ ] Run promotion workflow and verify metadata artifact output.
- [ ] Verify no manual pushes are needed for `website-production`.
- [ ] Validate preview deployment from non-production branch.

## Production cutover

- [ ] Trigger sync from latest public `main`.
- [ ] Promote validated `main` SHA to `website-production`.
- [ ] Confirm production deploy health checks.
- [ ] Record deploy ID, source SHA, and upstream SHA.

## Rollback drill

- [ ] Select previous healthy `website-production` SHA.
- [ ] Force-update `website-production` to that SHA.
- [ ] Confirm host rollback and health check recovery.
- [ ] Record incident + rollback evidence.
