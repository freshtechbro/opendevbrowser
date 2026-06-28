# Release 0.0.37 Workflow Plan

Goal: release OpenDevBrowser `0.0.37` to npm, GitHub Releases, and the Chrome Web Store lane with evidence-backed gates.

## Task 1 - Finalize Release Prep
Reasoning: Version and release-facing docs must agree before any gate, commit, or publish action is trustworthy.
What to do: Align package metadata, extension metadata, release docs, changelog, AGENTS release pointers, and the active evidence ledger for `0.0.37`.
How:
1. Verify `package.json`, `package-lock.json`, `extension/package.json`, and `extension/manifest.json` all use `0.0.37`.
2. Refresh release docs and changelog references to the active `docs/RELEASE_0.0.37_EVIDENCE.md` ledger.
3. Keep historical `0.0.36` entries historical-only.
Files impacted: `package.json`, `package-lock.json`, `extension/package.json`, `extension/manifest.json`, `CHANGELOG.md`, `README.md`, `docs/**/*.md`, `src/cli/AGENTS.md`, `tests/AGENTS.md`.
Acceptance criteria:
- [x] `npm run version:check` passes.
- [x] Stale-version scan has no active `0.0.36` release pointers except historical or dependency references.

## Task 2 - Run Local Release Gates
Reasoning: Publishing must be blocked until source, docs, public help, extension compliance, tests, builds, and packaging all pass locally.
What to do: Run the runbook's mandatory local gate matrix and record results in the evidence ledger.
How:
1. Run docs, zombie-file, Chrome compliance, skill, generated help, lint, typecheck, release-gate, full test, build, extension build, extension pack, npm pack, and diff checks.
2. Parse full coverage evidence from `coverage/lcov.info`.
3. Record any optional strict-live gate deferral or success explicitly.
Files impacted: `docs/RELEASE_0.0.37_EVIDENCE.md`.
Acceptance criteria:
- [x] Every mandatory local gate is recorded with pass evidence.
- [x] Package and extension artifact details are recorded.

## Task 3 - Merge Release Prep
Reasoning: npm and GitHub releases must come from the intended merged release source, not an uncommitted branch.
What to do: Commit release prep atomically, push the branch, open a PR, wait for checks, and merge to `main`.
How:
1. Stage only release-scoped tracked files.
2. Commit with a scoped Conventional Commit message and required co-author trailer.
3. Push and create a PR.
4. Wait for required checks and merge only after they pass.
Files impacted: git branch `codex/release-0.0.37`, release PR.
Acceptance criteria:
- [ ] `main` contains the release prep commit.
- [ ] PR checks pass before merge.

## Task 4 - Publish npm and GitHub Release
Reasoning: The local npm token lane requires npm publish first, then GitHub release workflow dispatch with npm publishing disabled.
What to do: Publish npm from merged `main`, run registry-consumer smoke, then create the GitHub release with extension artifacts.
How:
1. Verify `opendevbrowser@0.0.37` is absent before publish.
2. Run `npm publish --access public` without printing credentials.
3. Run registry-consumer smoke against `0.0.37`.
4. Dispatch `.github/workflows/release-public.yml` with `publish_npm=false`, `publish_github_release=true`, and `draft_release=false`.
5. Verify release assets and checksums.
Files impacted: npm registry, GitHub release `v0.0.37`, `docs/RELEASE_0.0.37_EVIDENCE.md`.
Acceptance criteria:
- [ ] npm latest is `0.0.37`.
- [ ] GitHub release `v0.0.37` exists with zip and checksum assets.
- [ ] Registry consumer smoke passes.

## Task 5 - Complete Chrome Store Lane
Reasoning: Chrome publishing is credential and dashboard gated, so release evidence must distinguish completed publication from an exact manual blocker.
What to do: Run the Chrome Store upload-only workflow first, review dashboard state, then publish or record the exact blocker.
How:
1. Prefer `.github/workflows/chrome-store-publish.yml` with `publish=false` for upload-only validation.
2. Review package version, listing, privacy practices, permissions, screenshots, distribution target, reviewer notes, and policy warnings.
3. Rerun with `publish=true` only when dashboard review passes.
4. Record workflow URLs, dashboard evidence, or exact credential/session/policy blockers.
Files impacted: Chrome Web Store, `docs/RELEASE_0.0.37_EVIDENCE.md`.
Acceptance criteria:
- [ ] Chrome Web Store visible version is `0.0.37`, or the ledger contains an exact blocker and next manual action.
