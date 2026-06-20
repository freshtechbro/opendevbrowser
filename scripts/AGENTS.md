# scripts/ - Agent Guidelines

Operational scripts scope. Extends root `AGENTS.md`.

## Scope

Applies to script files under `scripts/`.

## Conventions

- Keep scripts deterministic and non-interactive by default.
- Prefer explicit paths and clear failure messages.
- Preserve cross-platform behavior where feasible (macOS/Linux first, Windows-aware where already supported).
- Keep script outputs machine-readable when used by docs or CI flows.
- Keep generation scripts deterministic. `scripts/generate-public-surface-manifest.mjs` is the only way to update public-surface generated manifests; do not patch those outputs by hand.

## Safety

- Never add destructive filesystem operations without clear guards.
- Avoid silent failures; surface actionable exit messages.
- Do not hardcode secrets/tokens in scripts.
- Preserve `scripts/postinstall-sync-skills.mjs` as a best-effort package lifecycle shim: `OPDEVBROWSER_SKIP_POSTINSTALL_SKILL_SYNC=1` and repo checkout skips exit before importing built code, warnings are non-fatal, and the shim delegates package work to the built `runPackagePostinstall()` export.

## Verification

- If script behavior or output format changes, update relevant docs in `docs/`.
- For package postinstall changes, verify the shim still imports `dist/cli/installers/postinstall-skill-sync.js`, not source TypeScript, and never persists `scripts/postinstall-sync-skills.mjs` as an autostart target.
- For CLI/runtime scripts, run the corresponding validation commands after changes.
