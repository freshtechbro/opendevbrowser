# src/cli/installers/ - Agent Guidelines

Installer and package lifecycle helpers. Extends `src/cli/AGENTS.md`.

## Overview

Owns global/local install helpers, bundled skill installation, package postinstall reconciliation, and stable package lifecycle exports.

## Structure

```text
src/cli/installers/
├── global.ts                 # Global OpenCode plugin install
├── local.ts                  # Project-local install
├── skills.ts                 # Bundled skill target resolution and copy logic
├── package-postinstall.ts    # Best-effort npm package lifecycle orchestration
└── postinstall-skill-sync.ts # Stable built import path and re-exports
```

## Rules

- Keep installers deterministic and non-interactive when `--no-prompt` or lifecycle env requires it.
- Package postinstall is best effort: skip unsafe, ambiguous, local, non-npm, or conflicting contexts without failing package install.
- Package postinstall targets the packaged `dist/cli/index.js`; never persist `scripts/postinstall-sync-skills.mjs` as an autostart command.
- Keep `postinstall-skill-sync.ts` re-export compatibility stable for the shipped script.
- Skill installation must preserve managed target resolution and integrity checks; do not copy partial packs silently.
- Codex-managed OpenDevBrowser packs install through the shared Agents roots, not standalone `.codex/skills` roots; standalone Codex roots are compatibility discovery roots and cleanup is limited to marker or sentinel owned duplicates.
- Full canonical skill sync may adopt markerless canonical packs only when the target already has an OpenDevBrowser managed root marker, such as partial-marker repair. Unmanaged markerless directories must stay preserved.
- Config writes must preserve private permissions and atomic-write behavior.

## Related Surfaces

- Daemon autostart implementation lives in `src/cli/daemon-autostart.ts`.
- Script wrapper behavior lives in `scripts/postinstall-sync-skills.mjs`.
- Install docs sync through `README.md`, `docs/CLI.md`, `docs/FIRST_RUN_ONBOARDING.md`, and `docs/ARCHITECTURE.md`.

## Anti-Patterns

| Never | Why |
|-------|-----|
| Treat package postinstall as equivalent to manual daemon install | They have different entrypoint and safety rules |
| Fail npm install because optional autostart could not reconcile | Lifecycle work is best effort |
| Write LaunchAgent or Task Scheduler state from this directory | Platform autostart owner is `src/cli/daemon-autostart.ts` |
