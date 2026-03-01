# Resend + Cloudflare Email and Distribution Completion Plan

Integrated execution plan for:
- private website contact email workflow (`Cloudflare inbound forwarding + Resend outbound`)
- remaining public/private distribution tasks to full closeout

Date: 2026-02-25

---

## Overview

### Scope
- Private repo contact flow currently uses `mailto`; no server-side send/ack path yet.
- Target is low-volume, free-tier-first operations.
- Existing distribution automation is already in place and partially validated.

### Key decisions
- Keep inbound routing on Cloudflare Email Routing.
- Use Resend only for outbound transactional sending (API/SMTP).
- Use Gmail as operator mailbox UI with `Send mail as` through Resend SMTP.
- Execute email lane first, then complete cutover/release tasks in sequence.

### Execution repos
- Private website repo (implement website/email behavior): `freshtechbro/opendevbrowser-website-deploy`
- Private local path: `/Users/bishopdotun/Documents/DevProjects/opendevbrowser-website-deploy`
- Public product repo (release/distribution orchestration): `freshtechbro/opendevbrowser`
- Public local path: `/Users/bishopdotun/Documents/DevProjects/opendevbrowser`

### Task-to-repo matrix
| Task | Task title | Primary repo | Primary local working directory |
|------|------------|--------------|----------------------------------|
| 1 | Finalize Email Architecture and Address Contracts | private | `/Users/bishopdotun/Documents/DevProjects/opendevbrowser-website-deploy` |
| 2 | Configure Cloudflare Inbound Forwarding | private | `/Users/bishopdotun/Documents/DevProjects/opendevbrowser-website-deploy` |
| 3 | Configure Resend Outbound and Gmail Send-As | private | `/Users/bishopdotun/Documents/DevProjects/opendevbrowser-website-deploy` |
| 4 | Implement Private Repo Contact API with Resend | private | `/Users/bishopdotun/Documents/DevProjects/opendevbrowser-website-deploy` |
| 5 | Validate Email Flow End-to-End on Private Deploys | private | `/Users/bishopdotun/Documents/DevProjects/opendevbrowser-website-deploy` |
| 6 | Hosting Cutover (Private Repo) | private | `/Users/bishopdotun/Documents/DevProjects/opendevbrowser-website-deploy` |
| 7 | Rollback Drill (Private Repo) | private | `/Users/bishopdotun/Documents/DevProjects/opendevbrowser-website-deploy` |
| 8 | First Public Tagged Release (`v0.0.16`) | public | `/Users/bishopdotun/Documents/DevProjects/opendevbrowser` |
| 9 | Post-Release Public -> Private Sync Validation | public + private | `/Users/bishopdotun/Documents/DevProjects/opendevbrowser` and `/Users/bishopdotun/Documents/DevProjects/opendevbrowser-website-deploy` |
| 10 | Close Plan Checklists and Exceptions | public + private | `/Users/bishopdotun/Documents/DevProjects/opendevbrowser` and `/Users/bishopdotun/Documents/DevProjects/opendevbrowser-website-deploy` |

### Canonical doc references
- Public checklist: `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/docs/CUTOVER_CHECKLIST.md`
- Public release runbook: `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/docs/RELEASE_RUNBOOK.md`
- Public distribution plan: `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/docs/PUBLIC_PRIVATE_DISTRIBUTION_EXECUTION_PLAN.md`
- Private checklist: `/Users/bishopdotun/Documents/DevProjects/opendevbrowser-website-deploy/docs/CUTOVER_CHECKLIST.md`
- Private deploy runbook: `/Users/bishopdotun/Documents/DevProjects/opendevbrowser-website-deploy/docs/DEPLOYMENT_RUNBOOK.md`
- Private sync workflow: `/Users/bishopdotun/Documents/DevProjects/opendevbrowser-website-deploy/.github/workflows/sync-from-public.yml`
- Private promotion workflow: `/Users/bishopdotun/Documents/DevProjects/opendevbrowser-website-deploy/.github/workflows/promote-website-production.yml`
- Public dispatch workflow: `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/.github/workflows/dispatch-private-sync.yml`
- Public release workflow: `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/.github/workflows/release-public.yml`

### Implementation rules (repo boundaries)
1. Tasks 1-7 are implemented in private repo only: `/Users/bishopdotun/Documents/DevProjects/opendevbrowser-website-deploy`.
2. Task 8 is implemented/executed in public repo only: `/Users/bishopdotun/Documents/DevProjects/opendevbrowser`.
3. Tasks 9-10 span both repos and must be executed in the order defined in this plan.
4. Do not implement website-runtime behavior (contact form/API/email sending) in the public repo.
5. Do not run public npm release tagging/publish steps from the private repo.

---

## Task 1 — Finalize Email Architecture and Address Contracts

### Reasoning
Stable address contracts prevent DNS and app drift during implementation and operations.

### What to do
Define canonical sender, recipient, and forwarding addresses for support traffic.

### Execution repo
Private repo: `freshtechbro/opendevbrowser-website-deploy`

### Working directory
`/Users/bishopdotun/Documents/DevProjects/opendevbrowser-website-deploy`

### How
1. Set canonical values:
   - `CONTACT_FROM_EMAIL=team@opendevbrowser.dev`
   - `CONTACT_TO_EMAIL=team@opendevbrowser.dev`
   - Forward destination: maintainer Gmail address.
2. Confirm support replies should be sent as `team@opendevbrowser.dev`.
3. Record these values in private runbook/checklist.

### Files impacted
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser-website-deploy/docs/DEPLOYMENT_RUNBOOK.md`
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser-website-deploy/docs/CUTOVER_CHECKLIST.md`

### End goal
One explicit email contract used across DNS, app env vars, and operator workflow.

### Acceptance criteria
- [ ] Canonical addresses are documented in private repo docs.
- [ ] No conflicting sender/recipient aliases remain in docs.

---

## Task 2 — Configure Cloudflare Inbound Forwarding

### Reasoning
Cloudflare Email Routing provides free inbound forwarding to the operator mailbox.

### What to do
Enable and verify inbound forwarding for `team@opendevbrowser.dev`.

### Execution repo
Private repo: `freshtechbro/opendevbrowser-website-deploy`

### Working directory
`/Users/bishopdotun/Documents/DevProjects/opendevbrowser-website-deploy`

### How
1. In Cloudflare, enable Email Routing for `opendevbrowser.dev`.
2. Add destination mailbox (Gmail) and complete verification.
3. Add route rule:
   - `team@opendevbrowser.dev -> <maintainer-gmail>`.
4. Send test email to `team@opendevbrowser.dev` and verify receipt in Gmail.
5. Record DNS and test evidence in private checklist.

### Files impacted
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser-website-deploy/docs/CUTOVER_CHECKLIST.md`

### End goal
Inbound support email reaches operator inbox reliably.

### Acceptance criteria
- [ ] Cloudflare route is active and verified.
- [ ] Test inbound email reaches Gmail.
- [ ] Evidence (timestamp + test sender/recipient) is recorded.

---

## Task 3 — Configure Resend Outbound and Gmail Send-As

### Reasoning
Resend handles outbound app emails and Gmail alias sending so end users see the custom domain sender.

### What to do
Verify domain on Resend and connect Gmail send-as via Resend SMTP.

### Execution repo
Private repo: `freshtechbro/opendevbrowser-website-deploy`

### Working directory
`/Users/bishopdotun/Documents/DevProjects/opendevbrowser-website-deploy`

### How
1. In Resend:
   - add and verify sending domain,
   - create API key for app sending.
2. Ensure SPF/DKIM records are correct and non-conflicting.
3. In Gmail, add `Send mail as` alias:
   - address: `team@opendevbrowser.dev`
   - SMTP host: `smtp.resend.com`
   - SMTP user: `resend`
   - SMTP password: Resend API key.
4. Set Gmail reply behavior to:
   - `Reply from the same address the message was sent to`.
5. Send alias test mail to external inbox and verify sender shows `team@opendevbrowser.dev`.

### Files impacted
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser-website-deploy/docs/CUTOVER_CHECKLIST.md`
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser-website-deploy/docs/DEPLOYMENT_RUNBOOK.md`

### End goal
All operator replies can be sent from custom domain while using Gmail UI.

### Acceptance criteria
- [ ] Resend domain is verified.
- [ ] Gmail alias is verified and usable.
- [ ] External recipient sees custom sender address.

---

## Task 4 — Implement Private Repo Contact API with Resend

### Reasoning
Current `mailto` flow cannot send reliable transactional email or structured acknowledgements.

### What to do
Replace `mailto` submission with server-side API route that sends team notification + user acknowledgement.

### Execution repo
Private repo: `freshtechbro/opendevbrowser-website-deploy`

### Working directory
`/Users/bishopdotun/Documents/DevProjects/opendevbrowser-website-deploy`

### How
1. In private `frontend`, replace form submit target from `mailto:` to app POST endpoint.
2. Add API route:
   - `frontend/src/app/api/contact/route.ts`
   - validate payload fields (`name`, `email`, `subject`, `message`, optional `company`).
3. Integrate Resend send call:
   - notification email to `CONTACT_TO_EMAIL`,
   - acknowledgement email to submitter address.
4. Set `Reply-To` on team notification to submitter email.
5. Add minimal anti-spam:
   - honeypot field + lightweight request throttling.
6. Add env vars in Vercel/private runtime:
   - `RESEND_API_KEY`
   - `CONTACT_FROM_EMAIL`
   - `CONTACT_TO_EMAIL`
   - optional `CONTACT_ACK_ENABLED=true`.
7. Update private docs with env var setup and test procedure.

### Files impacted
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser-website-deploy/frontend/src/app/(marketing)/contact/page.tsx`
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser-website-deploy/frontend/src/app/api/contact/route.ts` (new file)
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser-website-deploy/frontend/package.json` (if `resend` dependency is added)
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser-website-deploy/docs/DEPLOYMENT_RUNBOOK.md`
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser-website-deploy/docs/CUTOVER_CHECKLIST.md`

### End goal
Contact form is fully server-backed and produces both team and user emails.

### Acceptance criteria
- [ ] Form submit succeeds without opening mail client.
- [ ] Team notification email is delivered.
- [ ] User acknowledgement email is delivered.
- [ ] Team notification supports direct reply to submitter via `Reply-To`.

---

## Task 5 — Validate Email Flow End-to-End on Private Deploys

### Reasoning
Email workflows must be validated on the hosted runtime before distribution closeout.

### What to do
Run preview and production contact-form smoke tests with evidence capture.

### Execution repo
Private repo: `freshtechbro/opendevbrowser-website-deploy`

### Working directory
`/Users/bishopdotun/Documents/DevProjects/opendevbrowser-website-deploy`

### How
1. Deploy private preview branch and run contact form test.
2. Verify:
   - UI success acknowledgement,
   - inbound team notification delivery,
   - user acknowledgement delivery.
3. Repeat on production deployment from `website-production`.
4. Record message IDs/screenshots/timestamps in private checklist.

### Files impacted
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser-website-deploy/docs/CUTOVER_CHECKLIST.md`
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser-website-deploy/docs/DEPLOYMENT_RUNBOOK.md`

### End goal
Hosted email workflow is proven on preview and production.

### Acceptance criteria
- [ ] Preview email flow passes.
- [ ] Production email flow passes.
- [ ] Evidence is recorded in private docs.

---

## Task 6 — Hosting Cutover (Private Repo)

### Reasoning
Deployment branch control ensures production stability and deterministic releases.

### What to do
Complete Vercel production/preview branch cutover and record evidence.

### Execution repo
Private repo: `freshtechbro/opendevbrowser-website-deploy`

### Working directory
`/Users/bishopdotun/Documents/DevProjects/opendevbrowser-website-deploy`

### How
1. In Vercel project settings, set production branch to `website-production`.
2. Confirm non-production branches deploy as Preview.
3. Trigger deployment from latest `website-production`.
4. Run production health checks and smoke pages.
5. Record deployment evidence in private checklist.

### Files impacted
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser-website-deploy/docs/CUTOVER_CHECKLIST.md`

### End goal
Website production deploys only from `website-production`.

### Acceptance criteria
- [ ] Vercel production branch is `website-production`.
- [ ] Preview deployments are non-production branches.
- [ ] Health checks pass and evidence is recorded.

---

## Task 7 — Rollback Drill (Private Repo)

### Reasoning
Rollback needs proven operational evidence before declaring cutover complete.

### What to do
Run controlled rollback and forward-restore using promotion workflow.

### Execution repo
Private repo: `freshtechbro/opendevbrowser-website-deploy`

### Working directory
`/Users/bishopdotun/Documents/DevProjects/opendevbrowser-website-deploy`

### How
1. Roll back to previous healthy SHA:
```bash
gh workflow run "Promote Website Production" -R freshtechbro/opendevbrowser-website-deploy -f source_ref=f8bfc6c
gh run watch -R freshtechbro/opendevbrowser-website-deploy <run_id> --exit-status
```
2. Verify branch moved:
```bash
cd /Users/bishopdotun/Documents/DevProjects/opendevbrowser-website-deploy
git fetch --all --prune
git rev-parse origin/website-production
```
3. Promote back to latest `origin/main` SHA and verify recovery.
4. Record rollback evidence in private runbook/checklist.

### Files impacted
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser-website-deploy/docs/CUTOVER_CHECKLIST.md`
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser-website-deploy/docs/DEPLOYMENT_RUNBOOK.md`

### End goal
Rollback and restore procedures are validated with reproducible commands.

### Acceptance criteria
- [ ] Rollback promotion succeeds.
- [ ] Forward restore succeeds.
- [ ] Branch tip transitions are documented.

---

## Task 8 — First Public Tagged Release (`v0.0.16`)

### Reasoning
Public release lane must be validated with real tag, npm publish, and GitHub artifacts.

### What to do
Run preflight, tag `v0.0.16`, and verify release outputs.

### Execution repo
Public repo: `freshtechbro/opendevbrowser`

### Working directory
`/Users/bishopdotun/Documents/DevProjects/opendevbrowser`

### How
1. Preflight in public repo:
```bash
cd /Users/bishopdotun/Documents/DevProjects/opendevbrowser
git status --short --branch
npm run version:check
npm run lint
npm run typecheck
npm run test
npm run build
npm run extension:build
```
2. Create/push tag:
```bash
git tag v0.0.16
git push origin v0.0.16
```
3. Watch workflow:
```bash
gh run list -R freshtechbro/opendevbrowser --workflow "Public Release" --limit 1
gh run watch -R freshtechbro/opendevbrowser <run_id> --exit-status
```
4. Verify publish:
```bash
npm view opendevbrowser version
gh release view v0.0.16 -R freshtechbro/opendevbrowser
```

### Files impacted
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/docs/CUTOVER_CHECKLIST.md`
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/docs/RELEASE_RUNBOOK.md` (only if procedure/evidence wording needs updates)

### End goal
`v0.0.16` ships with npm + GitHub release assets and validated workflow evidence.

### Acceptance criteria
- [ ] Public Release workflow succeeds for `v0.0.16`.
- [ ] `npm view` returns `0.0.16`.
- [ ] GitHub release includes expected extension assets.

---

## Task 9 — Post-Release Public -> Private Sync Validation

### Reasoning
Post-release sync confirms ongoing governance and docs/content propagation remain healthy.

### What to do
Trigger dispatch, validate sync PR path, run checks, merge, and verify promotion parity.

### Execution repo
Public + private repos:
- `freshtechbro/opendevbrowser`
- `freshtechbro/opendevbrowser-website-deploy`

### Working directory
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser`
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser-website-deploy`

### How
1. Trigger dispatch from public:
```bash
gh workflow run "Dispatch Private Website Sync" -R freshtechbro/opendevbrowser -f public_ref=main -f public_sha="$(git -C /Users/bishopdotun/Documents/DevProjects/opendevbrowser rev-parse HEAD)"
```
2. Confirm private sync and PR:
```bash
gh run list -R freshtechbro/opendevbrowser-website-deploy --workflow "Sync From Public" --limit 1
gh pr list -R freshtechbro/opendevbrowser-website-deploy --state open
```
3. Run PR checks for sync PR branch:
```bash
gh workflow run "PR Checks" -R freshtechbro/opendevbrowser-website-deploy --ref automation/sync-from-public
```
4. Merge sync PR.
5. Verify promotion and branch equality:
```bash
gh run list -R freshtechbro/opendevbrowser-website-deploy --workflow "Promote Website Production" --limit 1
cd /Users/bishopdotun/Documents/DevProjects/opendevbrowser-website-deploy
git fetch --all --prune
git rev-list --left-right --count origin/main...origin/website-production
```
6. Expect `0 0`.

### Files impacted
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/docs/CUTOVER_CHECKLIST.md`
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser-website-deploy/docs/CUTOVER_CHECKLIST.md`

### End goal
Sync PR workflow and post-merge promotion are validated after first public release.

### Acceptance criteria
- [ ] Sync PR is created and merged.
- [ ] Promotion workflow succeeds after merge.
- [ ] `origin/main...origin/website-production` equals `0 0`.

---

## Task 10 — Close Plan Checklists and Exceptions

### Reasoning
Formal closeout requires both repos to show completion evidence and known plan constraints.

### What to do
Update public/private checklists and mark plan-limited branch protection constraint.

### Execution repo
Public + private repos:
- `freshtechbro/opendevbrowser`
- `freshtechbro/opendevbrowser-website-deploy`

### Working directory
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser`
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser-website-deploy`

### How
1. Update public `docs/CUTOVER_CHECKLIST.md` with:
   - public release evidence,
   - post-release dispatch/sync validation.
2. Update private `docs/CUTOVER_CHECKLIST.md` with:
   - email flow evidence,
   - hosting cutover evidence,
   - rollback evidence.
3. Mark private branch-protection hard enforcement as:
   - plan-limited exception under current GitHub plan.

### Files impacted
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/docs/CUTOVER_CHECKLIST.md`
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser-website-deploy/docs/CUTOVER_CHECKLIST.md`
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser-website-deploy/docs/DEPLOYMENT_RUNBOOK.md`

### End goal
All remaining tasks are closed with evidence and explicit exceptions documented.

### Acceptance criteria
- [ ] Public checklist is updated and complete.
- [ ] Private checklist is updated and complete.
- [ ] Plan-limited exception is clearly documented.

---

## File-by-file implementation sequence

1. `/Users/bishopdotun/Documents/DevProjects/opendevbrowser-website-deploy/docs/DEPLOYMENT_RUNBOOK.md` — email architecture and operations updates.
2. `/Users/bishopdotun/Documents/DevProjects/opendevbrowser-website-deploy/docs/CUTOVER_CHECKLIST.md` — private execution evidence tracking.
3. `/Users/bishopdotun/Documents/DevProjects/opendevbrowser-website-deploy/frontend/src/app/(marketing)/contact/page.tsx` — replace `mailto` submit path.
4. `/Users/bishopdotun/Documents/DevProjects/opendevbrowser-website-deploy/frontend/src/app/api/contact/route.ts` — add Resend-backed contact API.
5. `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/docs/CUTOVER_CHECKLIST.md` — post-release closeout evidence.
6. `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/docs/RELEASE_RUNBOOK.md` — optional updates if release evidence flow changes.

---

## Dependencies to add

| Package | Version | Purpose |
|---------|---------|---------|
| `resend` | `latest stable` | Outbound transactional email from private Next.js contact API |

---

## Dependencies and task mapping

1. Task 1 -> Tasks 2 and 3 (address contract must exist before DNS/provider config).
2. Tasks 2 and 3 -> Task 4 (infra readiness before app integration).
3. Task 4 -> Task 5 (app must exist before E2E email validation).
4. Task 5 -> Tasks 6 and 7 (email path should be validated before final cutover drills).
5. Tasks 6 and 7 -> Task 8 (private hosting stability before first public release closeout).
6. Task 8 -> Task 9 (post-release sync validation depends on released public state).
7. Task 9 -> Task 10 (checklists close only after validation evidence is complete).

---

## Version history

| Version | Date | Changes |
|---------|------|---------|
| 1.1 | 2026-02-25 | Added explicit repo ownership, absolute local paths, per-task execution directories, implementation boundary rules, and canonical doc/workflow references |
| 1.0 | 2026-02-25 | Initial integrated plan: Resend + Cloudflare email lane and remaining distribution tasks |
