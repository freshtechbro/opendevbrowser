# Public/Private Split + Multi-Channel Distribution Plan

Detailed execution plan to keep OpenDevBrowser core and extension public while moving website deployment to a private repository with automated sync, then standardize npm + Chrome extension + GitHub release distribution.

---

## Overview

### Scope and channels
- Public repository (`opendevbrowser`) remains source of truth for runtime core, CLI, extension source, tests, docs, and npm package.
- Private repository (`opendevbrowser-website-deploy`) hosts the website app and deployment workflows.
- npm distribution remains from public repo tag releases.
- Extension release artifacts remain produced from public repo release flow.
- Website deploys from private repo `website-production` branch.

### Key decisions
- Keep core and extension together in the public repo.
- Split website deployment into a private repo because branch-level privacy is not possible in a public repo.
- Use CI-driven sync from public `main` into private website integration branch.
- Use CI-driven promotion to private `website-production` branch only after website checks pass.
- Use Vercel as default website host; Railway is fallback when non-Next backend hosting is needed.

### Success criteria
- Public repo stays clean for npm/core/extension distribution without website deployment coupling.
- Private website repo deploys automatically from `website-production` with deterministic generated content.
- Public release flow publishes npm package, creates GitHub release, and uploads extension zip reliably.
- Each phase has an execution checklist and measurable acceptance criteria.

### Execution prerequisites
- Public repository write/admin access for release and workflow management.
- Private repository admin access for branch protection and deployment integration.
- Maintainer-level npm publish permission for `opendevbrowser`.
- Vercel project ownership or team permission to set production branch and protection.
- Optional Chrome Web Store publisher access if Stage 2 extension publishing is enabled.

### Implementation status (2026-02-25)

Completed in execution:
- Public repo release/sync/store workflows were implemented:
  - `.github/workflows/release-public.yml`
  - `.github/workflows/dispatch-private-sync.yml`
  - `.github/workflows/chrome-store-publish.yml` (optional lane)
- Public repo release/store tooling implemented:
  - `scripts/chrome-store-publish.mjs`
  - `package.json` script `extension:store`
- Private repo template pack implemented in public repo:
  - `templates/website-deploy/**`
- Private repo rollout executed in `freshtechbro/opendevbrowser-website-deploy`:
  - bootstrap commit: `12d18b4`
  - sync hardening commit: `bddc141`
  - validated frontend baseline + private sync guard commit: `c694860`
  - sync workflow success: <https://github.com/freshtechbro/opendevbrowser-website-deploy/actions/runs/22397870085>
  - promotion workflow success: <https://github.com/freshtechbro/opendevbrowser-website-deploy/actions/runs/22397913124>
- Private frontend replica validation completed before public removal:
  - parity sync completed from public to private
  - private gates passed (`sync:assets`, `generate:docs`, `lint`, `typecheck`, `build`)
  - private dev server QA completed on `/`, `/docs`, `/docs/quickstart/index`
- Public extraction completed:
  - removed `frontend/` from public repo
  - removed frontend-coupled tests (`tests/frontend-docs-links.test.ts`, `tests/frontend-focus-trap.test.ts`)

Open operational items:
- Hosting branch enforcement (`website-production`) must be finalized in provider settings.
- Private branch protection is constrained by current GitHub plan (`HTTP 403` when enforcing private branch protection via API).
- First production public tag release through `release-public.yml` is still pending.

---

## Task 1 — Architecture Boundary and Branch Governance

### Reasoning
Without hard repository and branch boundaries, release and deployment flows drift and become error-prone.

### What to do
Define explicit ownership for public and private repos, release branches, and deploy branches.

### How
1. Document canonical branch model for public repo: `main`, `release/x.y.z`, tags `vX.Y.Z`.
2. Document canonical branch model for private repo: `main` (integration), `website-production` (deploy-only), optional `preview/*`.
3. Restrict `website-production` push access to CI bot only.
4. Add protected branch rules for public `main` and private `website-production`.

### Files impacted
- `docs/PUBLIC_PRIVATE_DISTRIBUTION_EXECUTION_PLAN.md` (this file)
- `docs/DISTRIBUTION_PLAN.md`

### End goal
A stable governance model where public distribution and private website deployment are isolated and auditable.

### Acceptance criteria
- [x] Branch model is documented and approved.
- [ ] Protected branch rules are active on both repos. (Private repo branch protection is plan-limited on current GitHub tier.)
- [ ] Manual pushes to `website-production` are blocked. (Pending branch-protection controls.)

---

## Task 2 — Private Website Repository Creation and Frontend Migration

### Reasoning
Repository-level privacy is required to keep website deployment private.

### What to do
Create private repo and migrate website app and supporting scripts.

### How
1. Create private GitHub repo `opendevbrowser-website-deploy`.
2. Copy `frontend/` from public repo into private repo.
3. Add private-repo README and runbook for local development.
4. Validate local website gates in private repo with:
5. `npm install && npm run lint && npm run typecheck && npm run build`

### Files impacted
- `frontend/**` (copied into private repo)
- `README.md` (private repo)
- `docs/DEPLOYMENT_RUNBOOK.md` (private repo)

### End goal
Website is independently buildable and deployable from the private repo.

### Acceptance criteria
- [x] Private repo can run website dev/build locally.
- [x] No required runtime dependency on public repo checkout path.
- [x] Frontend route behavior matches existing production intent.

---

## Task 3 — Public-to-Private Content Sync Pipeline

### Reasoning
Website pages are generated from public docs/skills/assets, so a deterministic sync pipeline is required.

### What to do
Implement private-repo CI to pull selected public artifacts, regenerate content, and commit updates.

### How
1. Add private repo workflow `sync-from-public.yml` with three triggers: `repository_dispatch`, nightly schedule, and manual dispatch.
2. Sync source set from public repo: `docs/`, `skills/`, `assets/`, `CHANGELOG.md`, `src/tools/index.ts`.
3. Stage synced inputs under `upstream/` in private repo.
4. Run website generation and asset sync steps against staged content.
5. Commit generated outputs to private `main` with upstream commit SHA in commit message.

### Files impacted
- `.github/workflows/sync-from-public.yml` (private repo)
- `scripts/sync-from-public.mjs` (private repo)
- `upstream/**` (private repo)
- `frontend/src/content/**` (private repo generated outputs)

### End goal
Private repo remains current with public content sources through automated, reproducible sync.

### Acceptance criteria
- [x] Sync workflow completes successfully on dispatch and schedule.
- [x] Generated content updates are deterministic (no unrelated churn).
- [x] Sync commit message includes upstream SHA for traceability.

---

## Task 4 — Deploy Branch Promotion Pipeline

### Reasoning
Production deployments should be pinned to tested branch state, not direct integration branch commits.

### What to do
Promote private `main` to private `website-production` only after gates pass.

### How
1. Add private workflow `promote-website-production.yml`.
2. Gate promotion on sync completion plus `frontend` lint, typecheck, and build success.
3. Fast-forward or force-update `website-production` from validated `main` commit.
4. Emit deploy artifact metadata (`upstream_sha`, private commit SHA, build timestamp).

### Files impacted
- `.github/workflows/promote-website-production.yml` (private repo)
- `docs/DEPLOYMENT_RUNBOOK.md` (private repo)

### End goal
`website-production` is always validated and deploy-ready.

### Acceptance criteria
- [x] Promotion occurs only when checks pass.
- [x] Promotion writes metadata for traceability.
- [x] Failed checks prevent deploy branch updates.

---

## Task 5 — Hosting Integration (Vercel Primary, Railway Fallback)

### Reasoning
Hosting should consume only the private deploy branch while preserving predictable previews and rollbacks.

### What to do
Configure hosting to deploy production from private `website-production`.

### How
1. Connect private repo to Vercel project.
2. Set production branch to `website-production`.
3. Set root directory/build command matching private repo layout.
4. Configure preview deployments for non-production branches.
5. Add deployment protection and required checks before production deploy.
6. Document fallback Railway setup using same branch strategy.

### Files impacted
- `docs/HOSTING_CONFIGURATION.md` (private repo)
- `vercel.json` (private repo, optional)

### End goal
Website production is private and branch-controlled.

### Acceptance criteria
- [ ] Production deploys trigger only from `website-production`.
- [ ] Preview deploys do not affect production alias.
- [ ] Rollback to previous deployment is documented and tested.

---

## Task 6 — Public Release Pipeline for npm + Extension + GitHub Release

### Reasoning
Distribution channels should ship from one validated release flow to avoid artifact mismatch.

### What to do
Define and automate release process in public repo for npm package, extension zip, and GitHub release.

### How
1. On release prep branch, bump `package.json` version and sync extension manifest version.
2. Run release branch quality gates:
3. `npm run lint`
4. `npm run typecheck`
5. `npm run build`
6. `npm run extension:build`
7. `npm run test`
8. On tag `vX.Y.Z`, run publish flow:
9. `npm publish --access public`
10. `npm run extension:pack`
11. Compute checksums and create GitHub release.
12. Upload extension zip and checksum artifacts, then publish release notes.

### Files impacted
- `.github/workflows/release-public.yml` (public repo)
- `scripts/sync-extension-version.mjs`
- `scripts/verify-versions.mjs`
- `docs/DISTRIBUTION_PLAN.md`
- `docs/RELEASE_RUNBOOK.md`

### End goal
Public releases publish all required artifacts from one source-of-truth version.

### Acceptance criteria
- [ ] npm publish succeeds from tagged release.
- [ ] GitHub release contains extension zip and checksum.
- [ ] Version alignment checks fail fast on mismatch.

---

## Task 7 — Chrome Extension Distribution Track

### Reasoning
Extension distribution needs explicit operational ownership and release traceability.

### What to do
Run a two-stage extension distribution strategy: release artifact first, store publishing second.

### How
1. Stage 1: keep GitHub release zip as canonical extension artifact.
2. Stage 2: add optional Chrome Web Store publish job (manual approval gate).
3. Store credentials as repository secrets only.
4. Record extension published version and store listing URL in release notes.
5. Add rollback and emergency unpublish procedure.

### Files impacted
- `docs/EXTENSION_RELEASE_RUNBOOK.md`
- `.github/workflows/chrome-store-publish.yml` (optional, public repo)

### End goal
Extension delivery is reliable whether operating via GitHub artifact only or store publication.

### Acceptance criteria
- [x] Extension zip can be installed as unpacked/side-loaded artifact.
- [x] Store publish procedure is documented and validated.
- [x] Optional automation is gated and auditable.

---

## Task 8 — Cutover, Validation, and Rollback Drills

### Reasoning
Operational handover without dry runs creates hidden failure modes during first production releases.

### What to do
Execute staged cutover and rollback drills for both website and release pipelines.

### How
1. Dry-run sync + promotion + preview deploy in private repo.
2. Dry-run public release up to draft GitHub release without publish.
3. Execute first production website deploy from private `website-production`.
4. Execute first production tagged release on public repo.
5. Validate rollback by restoring previous website deployment and previous release docs state.

### Files impacted
- `docs/CUTOVER_CHECKLIST.md` (public repo path)
- `<private-repo>/docs/CUTOVER_CHECKLIST.md` (private repo path)

### End goal
Both pipelines are production-ready with tested rollback procedures.

### Acceptance criteria
- [ ] First production website deploy is successful.
- [ ] First production public release is successful.
- [ ] Rollback playbook has been executed at least once.

---

## CI Secrets and Permissions Matrix

| Scope | Key/Secret | Purpose | Minimum permission |
|------|------------|---------|--------------------|
| Public repo | `PRIVATE_REPO_DISPATCH_TOKEN` | trigger private sync workflow via `repository_dispatch` | private repo workflow trigger only |
| Public repo | `NPM_TOKEN` | publish npm package on tagged release | npm publish for `opendevbrowser` |
| Public repo | `GH_RELEASE_TOKEN` (or `GITHUB_TOKEN`) | create/upload GitHub release artifacts | contents:write on public repo |
| Public repo (optional) | `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN` | Chrome Web Store publish automation | CWS publish scope |
| Private repo | `PUBLIC_REPO_READ_TOKEN` | read public source content during sync if rate limits require auth | read-only public repo |
| Private repo | `VERCEL_TOKEN` (optional CLI mode) | trigger/manage Vercel deploys when using CLI path | deploy/project scoped token |

---

## Go/No-Go Gates

| Phase | Gate | Go condition | No-go condition | Evidence |
|------|------|--------------|-----------------|----------|
| Phase 1 | Website migration gate | private repo `lint/typecheck/build` all pass | any gate fails | CI logs + commit SHA |
| Phase 2 | Sync gate | sync workflow completes with deterministic diff | unstable/churning generated output | workflow run + diff summary |
| Phase 3 | Promotion gate | deploy branch updated only after checks pass | manual push or failed checks | protected branch audit + workflow log |
| Phase 4 | Hosting gate | production deploy from `website-production` succeeds | deploy from non-production branch or failed health checks | Vercel/Railway deployment log |
| Phase 5 | Public release gate | npm publish + GH release + extension artifact all succeed | partial publish or version mismatch | release record + npm view output |
| Phase 6 | Extension lane gate | artifact/store version aligned with release tag | store/artifact version drift | release notes + store listing metadata |
| Phase 7 | Operations gate | rollback drill and alerting checks pass | rollback untested or alerting missing | runbook execution logs |

---

## Failure Controls and Concurrency Guards

- Sync workflow must run with repository-level concurrency group per target branch to avoid overlapping writes.
- Promotion workflow must use a separate concurrency group and must depend on successful sync commit SHA.
- Public release workflow must be tag-serialized to prevent parallel publish attempts.
- Any failed publish attempt must stop before GitHub release publication to avoid partial distribution state.
- Rollback procedure must include both website deploy rollback and release communication update in a single operator checklist.

---

## Phase Ownership and Suggested Timeline

| Phase | Owner role | Target duration | Blockers to watch |
|------|------------|-----------------|-------------------|
| Phase 0 | Repo admin | 0.5 day | missing admin rights in one repo |
| Phase 1 | Frontend maintainer | 1 day | hidden path dependency on public repo |
| Phase 2 | DevOps/CI maintainer | 1 day | cross-repo auth and dispatch permissions |
| Phase 3 | DevOps/CI maintainer | 0.5 day | branch protection misconfiguration |
| Phase 4 | Platform maintainer | 0.5 day | host branch mapping and env config drift |
| Phase 5 | Release maintainer | 1 day | version mismatch or failed release gates |
| Phase 6 | Extension maintainer | 0.5 day | store credentials/publishing policy gaps |
| Phase 7 | Operations maintainer | ongoing quarterly | stale runbooks and untested rollback |

---

## Execution-Ready Checklist by Phase

### Phase 0 — Governance and repo setup
- [x] Confirm target repo names and owners.
- [x] Create private repo `opendevbrowser-website-deploy`.
- [ ] Configure branch protections in both repos.
- [x] Create required CI bot/service account credentials.
- [x] Document permissions matrix for maintainers and CI.
- [ ] Exit gate: both repos show enforced branch protection and CI-only push for deploy branch.
- [ ] Evidence: screenshot/export of branch protection settings and repo collaborators.

### Phase 1 — Website migration to private repo
- [x] Copy `frontend/` into private repo.
- [x] Add private repo setup docs.
- [x] Validate `lint`, `typecheck`, `build` in private repo.
- [x] Confirm production routes and metadata parity.
- [x] Commands: `npm install && npm run lint && npm run typecheck && npm run build` in private repo.
- [x] Exit gate: no private repo build path reads outside private repo workspace.
- [x] Evidence: workflow log + build output artifact hash.

### Phase 2 — Public-to-private sync automation
- [x] Implement `sync-from-public` workflow.
- [x] Implement sync script for `docs/`, `skills/`, `assets/`, `CHANGELOG.md`, `src/tools/index.ts`.
- [x] Implement dispatch trigger from public repo.
- [x] Add nightly fallback sync schedule.
- [x] Validate idempotent sync behavior.
- [x] Commands: run `workflow_dispatch` twice with identical source SHA and verify no second diff.
- [x] Exit gate: deterministic generation with stable output ordering.
- [x] Evidence: two workflow runs with identical output checksums.

### Phase 3 — Deploy branch promotion
- [x] Implement `promote-website-production` workflow.
- [x] Ensure promotion gated by website quality checks.
- [ ] Block manual pushes to `website-production`.
- [x] Add promotion metadata output and logs.
- [ ] Commands: fail one check intentionally in PR branch and confirm promotion is blocked.
- [ ] Exit gate: only passing pipeline can update `website-production`.
- [ ] Evidence: blocked run + successful run with promotion commit SHA.

### Phase 4 — Hosting cutover
- [ ] Connect private repo to Vercel (or Railway fallback).
- [ ] Set production branch to `website-production`.
- [ ] Configure preview deployments for non-production branches.
- [ ] Validate first production deploy and rollback path.
- [ ] Commands: deploy from `website-production`, then rollback to previous deployment alias.
- [ ] Exit gate: production alias tracks deploy branch only.
- [ ] Evidence: deployment IDs for forward deploy and rollback.

### Phase 5 — Public release automation
- [x] Implement/validate release workflow in public repo.
- [x] Enforce version sync checks.
- [x] Enforce release quality gates.
- [ ] Publish npm package from tag.
- [ ] Publish GitHub release with extension artifact.
- [ ] Commands: `npm run lint && npm run typecheck && npm run build && npm run extension:build && npm run test`.
- [ ] Commands: `npm publish --access public` on signed release tag context.
- [ ] Exit gate: npm version, git tag, and GitHub release artifact versions all match.
- [ ] Evidence: `npm view opendevbrowser version`, release URL, attached artifact checksums.

### Phase 6 — Extension distribution maturity
- [ ] Keep extension zip as required GitHub release artifact.
- [ ] Add documented Chrome Web Store process.
- [ ] Optionally add gated store publish workflow.
- [ ] Verify extension version traceability between manifest/release/store.
- [ ] Commands: `npm run extension:pack` and optional store publish workflow dispatch.
- [ ] Exit gate: `extension/manifest.json` version equals release tag and store version.
- [ ] Evidence: zip checksum + store listing snapshot/version.

### Phase 7 — Operational hardening
- [ ] Execute end-to-end dry runs quarterly.
- [ ] Validate secret rotation and CI permissions.
- [ ] Validate failure alerts for sync/promotion/release jobs.
- [ ] Validate rollback playbooks remain current.
- [ ] Commands: quarterly rehearsal script or manual runbook execution across both repos.
- [ ] Exit gate: no stale secret older than rotation policy window; alert channels confirmed.
- [ ] Evidence: runbook logs and secret rotation audit record.

---

## File-by-file implementation sequence

1. `docs/PUBLIC_PRIVATE_DISTRIBUTION_EXECUTION_PLAN.md` — baseline architecture and phase plan.
2. `<private-repo>/README.md` + `<private-repo>/docs/DEPLOYMENT_RUNBOOK.md` — establish migration and runbook.
3. `<private-repo>/scripts/sync-from-public.mjs` + `<private-repo>/.github/workflows/sync-from-public.yml` — automate upstream ingestion.
4. `<private-repo>/.github/workflows/promote-website-production.yml` — automate deploy branch updates.
5. `<private-repo>/docs/HOSTING_CONFIGURATION.md` (+ optional `<private-repo>/vercel.json`) — finalize production branch deploy settings.
6. `.github/workflows/release-public.yml` + `docs/RELEASE_RUNBOOK.md` — finalize npm + extension + GitHub release automation.
7. `docs/EXTENSION_RELEASE_RUNBOOK.md` (+ optional `.github/workflows/chrome-store-publish.yml`) — finalize extension publication operations.
8. `docs/CUTOVER_CHECKLIST.md` + `<private-repo>/docs/CUTOVER_CHECKLIST.md` — validate production readiness and rollback drills.

---

## Dependencies to add

### Task and subtask dependency mapping

| Task | Depends on | Subtasks connected | Unlocks |
|------|------------|--------------------|---------|
| Task 1 | None | branch model, protection rules, ownership matrix | Tasks 2-8 |
| Task 2 | Task 1 | private repo creation, frontend migration, local validation | Tasks 3-5 |
| Task 3 | Task 2 | sync workflow, dispatch trigger, nightly fallback | Task 4 |
| Task 4 | Task 3 | gated promotion and deploy metadata | Task 5 |
| Task 5 | Task 4 | hosting wiring and production branch deployment | Task 8 |
| Task 6 | Task 1 | release workflow, version checks, publish channels | Task 7, Task 8 |
| Task 7 | Task 6 | extension runbook and optional store automation | Task 8 |
| Task 8 | Tasks 5-7 | cutover drills and rollback validation | steady-state operations |

### External/service dependencies

| Package/Service | Version | Purpose |
|----------------|---------|---------|
| GitHub Actions | n/a | CI orchestration for sync, promotion, and release |
| Vercel | n/a | primary website deployment target |
| Railway (optional) | n/a | fallback website deployment target |
| Chrome Web Store API client (optional) | latest | optional automation for extension store publishing |

---

## Version history

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-02-24 | Initial complete plan with all phases, checklists, and distribution channels. |
| 1.1 | 2026-02-24 | Audit pass 1 fixes: added execution prerequisites, secrets matrix, go/no-go gates, ownership timeline, and expanded phase checklists with commands/evidence. |
| 1.2 | 2026-02-24 | Audit pass 2 fixes: removed ambiguous numbered placeholders, clarified cross-repo file paths, and added concurrency/failure control safeguards. |
| 1.3 | 2026-02-25 | Added deterministic generated-content strategy and upstream snapshot retention controls for private sync operations. |
| 1.4 | 2026-02-25 | Added public workflow inventory for release + private sync dispatch + optional store publish lanes. |
| 1.5 | 2026-02-25 | Fixed private command-path assumptions and aligned no-op sync behavior with normalized generated payload policy. |
| 1.6 | 2026-02-25 | Execution update: recorded implemented assets, live private rollout evidence, and remaining external blockers. |
