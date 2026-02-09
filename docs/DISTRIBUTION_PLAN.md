# OpenDevBrowser Distribution Plan

This plan prepares and ships a release to all distribution channels: npm, GitHub repository history, and GitHub Releases.

---

## Overview

### Distribution channels
- npm package: `opendevbrowser`
- GitHub code changes: branch + pull request into `main`
- GitHub Release: version tag + release notes + extension zip asset

### Key decisions
- Source of truth for version is root `package.json`.
- `extension/manifest.json` must be synced to the same version before publishing.
- `main` is protected; release changes must be merged via pull request.

---

## Task 1 — Release Preflight

### Reasoning
Publishing from inconsistent or unverified state causes broken artifacts and rollback overhead.

### What to do
Confirm repo state, auth, and branch strategy before changing version.

### How
1. Verify git status and active branch.
2. Confirm remote push strategy (PR-required workflow for `main`).
3. Confirm npm auth with `npm whoami`.

### Files impacted
- None.

### End goal
Release operator has a valid authenticated environment and known git path to merge release changes.

### Acceptance criteria
- [ ] Git state is known and documented.
- [ ] Push target branch is available remotely.
- [ ] npm authentication is valid.

---

## Task 2 — Version Bump and Alignment

### Reasoning
Release artifacts across package and extension must carry exactly the same version.

### What to do
Bump semver and sync extension manifest to that value.

### How
1. Run one of:
   - Patch: `npm version patch --no-git-tag-version`
   - Minor: `npm version minor --no-git-tag-version`
   - Major: `npm version major --no-git-tag-version`
2. Run `npm run extension:sync`.
3. Run `npm run version:check`.

### Files impacted
- `package.json`
- `package-lock.json`
- `extension/manifest.json`

### End goal
All version-bearing files match the new semver.

### Acceptance criteria
- [ ] `package.json` contains new version.
- [ ] `extension/manifest.json` matches `package.json` version.
- [ ] `npm run version:check` exits successfully.

---

## Task 3 — Build, Test, and Package Artifacts

### Reasoning
Publishing unvalidated outputs risks broken installs and extension payload failures.

### What to do
Run quality gates and build both npm and extension artifacts.

### How
1. Run `npm run lint`.
2. Run `npm run test`.
3. Run `npm run build`.
4. Run `npm run extension:build`.
5. Run `npm run extension:pack` and keep generated zip for release assets.

### Files impacted
- `dist/**` (generated)
- `extension/dist/**` (generated)
- `opendevbrowser-extension.zip` (generated)

### End goal
Validated, releasable package and extension artifacts exist locally.

### Acceptance criteria
- [ ] Lint/test/build commands pass.
- [ ] Extension build and pack commands pass.
- [ ] Extension zip artifact exists.

---

## Task 4 — GitHub Branch and Pull Request

### Reasoning
Protected `main` requires a reviewable, auditable merge path.

### What to do
Commit version changes, push branch, and open PR to `main`.

### How
1. Commit release-prep files with a conventional commit message.
2. Push to remote release branch.
3. Open PR targeting `main`.
4. Merge after checks pass.

### Files impacted
- `package.json`
- `package-lock.json`
- `extension/manifest.json`
- `docs/DISTRIBUTION_PLAN.md`

### End goal
Release version changes are merged into `main` through required repository policy.

### Acceptance criteria
- [ ] Release PR exists and targets `main`.
- [ ] Required checks pass.
- [ ] PR merged to `main`.

---

## Task 5 — Publish to npm

### Reasoning
npm is the canonical install channel; publish must map exactly to merged git state.

### What to do
Publish the new package version from the merged commit.

### How
1. Checkout merged `main` commit.
2. Verify package version one final time.
3. Run `npm publish --access public`.
4. Confirm published version on npm registry.

### Files impacted
- None (registry operation).

### End goal
New version is installable via npm.

### Acceptance criteria
- [ ] `npm publish` succeeds.
- [ ] `npm view opendevbrowser version` returns released version.

---

## Task 6 — Create GitHub Release

### Reasoning
GitHub Release provides changelog visibility and extension binary distribution.

### What to do
Create version tag, publish release notes, and attach extension zip artifact.

### How
1. Create tag `vX.Y.Z` on merged `main` commit.
2. Push tag to origin.
3. Create GitHub Release from that tag.
4. Attach `opendevbrowser-extension.zip`.
5. Include highlights and breaking-change notes (if any).

### Files impacted
- Git tag: `vX.Y.Z`
- GitHub Release assets/notes

### End goal
GitHub users can discover release notes and download extension artifact from the release page.

### Acceptance criteria
- [ ] Tag exists on remote.
- [ ] GitHub Release is published.
- [ ] Extension zip is attached and downloadable.

---

## File-by-file implementation sequence

1. `package.json` — set new semver
2. `package-lock.json` — lockfile version update from npm
3. `extension/manifest.json` — sync extension version
4. `docs/DISTRIBUTION_PLAN.md` — maintain release workflow

---

## Dependencies to add

No new dependencies are required for release workflow.

---

## Version history

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-02-09 | Initial distribution plan for npm + GitHub + GitHub Releases |
