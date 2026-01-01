# Distribution and Versioning Plan

Align release artifacts across NPM, GitHub, and the Chrome extension so versioning is consistent and repeatable.

---

## Overview

### Distribution channels
- **NPM**: `opendevbrowser` package (plugin + CLI + bundled skills + extension sources).
- **GitHub**: source releases and tagged versions.
- **Chrome extension**: packaged `opendevbrowser-extension.zip`.

### Key decisions
- `package.json` version is the source of truth.
- `extension/manifest.json` must always match `package.json` (sync script already exists).
- GitHub release tags should match the exact package version (`vX.Y.Z`).

---

## Task 1 — Enforce version alignment

### Reasoning
Avoid mismatches between the NPM package and the extension manifest when publishing.

### What to do
Add a lightweight version check script and expose it as `npm run version:check`.

### How
1. Create `scripts/verify-versions.mjs` to compare `package.json` vs `extension/manifest.json`.
2. Add a `version:check` npm script that exits non-zero on mismatch.
3. Document when to run it in this plan.

### Files impacted
- `scripts/verify-versions.mjs` (new file)
- `package.json`

### End goal
One command reliably verifies version consistency before release.

### Acceptance criteria
- [ ] `npm run version:check` fails when versions differ.
- [ ] `npm run version:check` passes when versions match.

---

## Task 2 — Document the release workflow here

### Reasoning
Releases must update NPM, GitHub, and extension artifacts in sync.

### What to do
Add a release checklist section to this document.

### How
1. Add a step-by-step checklist in this file.
2. Include: bump `package.json`, run `npm run extension:sync`, `npm run build`, `npm run extension:build`, `npm run extension:pack`, and create a GitHub release tag.
3. Note where the extension zip is produced.

### Files impacted
- `docs/DISTRIBUTION_PLAN.md`
- `README.md` (link to this plan)

### End goal
Release steps are explicit and consistently followed.

### Acceptance criteria
- [ ] Release checklist lists NPM, GitHub, and extension steps.
- [ ] Release checklist states the version source of truth.

---

## Task 3 — Add agent installation instructions to README(s)

### Reasoning
Agents need a clear, minimal installation path that doesn’t rely on manual config edits.

### What to do
Add an “Agent Installation” section with CLI and manual config steps.

### How
1. Add a section to README that describes `npx opendevbrowser --global --with-config --skills-global`.
2. Include the manual config fallback.
3. Mention skill installation locations briefly.

### Files impacted
- `README.md`

### End goal
Agents can install the plugin with clear, copy-pasteable instructions.

### Acceptance criteria
- [ ] README includes an “Agent Installation” section.
- [ ] Instructions mention the CLI path and manual fallback.

---

## File-by-file implementation sequence

1. `scripts/verify-versions.mjs` — Task 1 (new)
2. `package.json` — Task 1
3. `docs/DISTRIBUTION_PLAN.md` — Task 2 (this doc)
4. `README.md` — Task 2, Task 3

---

## Dependencies to add

| Package | Version | Purpose |
|---------|---------|---------|
| None | | |

---

## Version history

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-01-01 | Initial distribution and versioning plan |

---

## Release checklist

1. Bump `package.json` version.
2. Run: `npm run extension:sync`
3. Run: `npm run version:check`
4. Run: `npm run build`
5. Run: `npm run extension:build`
6. Run: `npm run extension:pack` (generates `opendevbrowser-extension.zip`)
7. Publish to NPM: `npm publish`
8. Create GitHub release tag `vX.Y.Z` and attach `opendevbrowser-extension.zip`
