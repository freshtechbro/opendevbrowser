# Deployment Runbook (Private Website Repo)

## Scope

This runbook governs sync, promotion, deploy, and rollback for the private website repo.

## Required Inputs

- Public source repository (`PUBLIC_REPO_URL`, default `https://github.com/freshtechbro/opendevbrowser.git`)
- Branches: `main` and `website-production`
- Hosting provider linked to `website-production`

## Routine Sync Flow

1. Public repo dispatches `opendevbrowser_public_sync` on updates to docs/skills/assets/changelog/tool index.
2. `sync-from-public.yml` mirrors inputs into this repo and records an upstream snapshot under `upstream/<public_sha>/`.
3. Workflow runs:
- `npm run sync:assets --prefix frontend`
- `npm run generate:docs --prefix frontend`
- `npm run lint --prefix frontend`
- `npm run typecheck --prefix frontend`
- `npm run build --prefix frontend`
4. Generated timestamp fields are normalized for deterministic diffs.
5. If changes exist, workflow commits to `main` with upstream SHA in commit message.

## Promotion Flow

1. `promote-website-production.yml` runs after successful sync workflow (or manual dispatch).
2. Workflow re-runs website quality gates on the source ref.
3. Workflow uploads promotion metadata (`source_sha`, `upstream_sha`, timestamp).
4. Workflow force-updates `website-production` to the validated source SHA.

## Rollback Flow

1. Identify previous healthy `website-production` commit.
2. Promote previous SHA back to `website-production`:

```bash
git push origin <healthy_sha>:refs/heads/website-production --force
```

3. Redeploy from hosting dashboard if required.
4. Log rollback reason and incident link in release notes.

## Failure Handling

- Sync failure: fix upstream mirror/generation break, re-run `sync-from-public.yml`.
- Promotion failure: fix failing gate, re-run promotion.
- Host failure: rollback `website-production` to previous healthy SHA.

## Retention Policy

- `upstream/` snapshots are retained with bounded history (`retain` default: 20).
