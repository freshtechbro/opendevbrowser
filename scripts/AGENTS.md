# scripts/ — Agent Guidelines

Operational scripts scope. Extends root `AGENTS.md`.

## Scope

Applies to script files under `scripts/`.

## Conventions

- Keep scripts deterministic and non-interactive by default.
- Prefer explicit paths and clear failure messages.
- Preserve cross-platform behavior where feasible (macOS/Linux first, Windows-aware where already supported).
- Keep script outputs machine-readable when used by docs or CI flows.

## Safety

- Never add destructive filesystem operations without clear guards.
- Avoid silent failures; surface actionable exit messages.
- Do not hardcode secrets/tokens in scripts.

## Verification

- If script behavior or output format changes, update relevant docs in `docs/`.
- For CLI/runtime scripts, run the corresponding validation commands after changes.
