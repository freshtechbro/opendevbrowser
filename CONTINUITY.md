Goal (incl. success criteria):
- Bump version to 0.0.13, sync extension manifest, tag v0.0.13, and push commit + tag.

Constraints/Assumptions:
- Use package.json as source of truth.
- Keep extension manifest version aligned via `npm run extension:sync`.
- Use git tag format `vX.Y.Z` per distribution guidance.

Key decisions:
- Use `npm version 0.0.13 --no-git-tag-version` + manual commit/tag for controlled ordering.

State:
  - Done:
    - Bumped package version to 0.0.13 (package.json + package-lock.json).
    - Synced extension manifest version.
    - Version check passed.
  - Now:
    - Commit version bump, create tag `v0.0.13`, and push.
  - Next:
    - None.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `package.json`
- `package-lock.json`
- `extension/manifest.json`
- Commands: `npm version 0.0.13 --no-git-tag-version`, `npm run extension:sync`, `npm run version:check`, `git commit`, `git tag`, `git push --tags`
