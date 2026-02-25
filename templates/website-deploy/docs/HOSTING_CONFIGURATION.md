# Hosting Configuration (Private Website Repo)

## Primary: Vercel

1. Connect private repository to Vercel project.
2. Set production branch to `website-production`.
3. Set root directory to `frontend`.
4. Build command: `npm run build`.
5. Install command: `npm ci`.
6. Enable preview deployments for non-production branches.
7. Enable deployment protection checks on production.

## Fallback: Railway

Use Railway only when private repo adds non-Next runtime services.

1. Link repo to Railway project.
2. Configure deployment branch as `website-production`.
3. Mirror production env vars from Vercel source of truth.
4. Validate rollback by pinning to a previous deploy artifact.

## Required Controls

- Production deploys must be branch-gated (`website-production` only).
- Preview deploys must never mutate production alias.
- Production deploy metadata must map to `source_sha` and `upstream_sha`.
