# Local AGENTS.md (src/skills)

Applies to `src/skills/`. Extends `src/AGENTS.md` and root `AGENTS.md`.

## Responsibilities
- Load skill packs (e.g., `skills/opendevbrowser-best-practices/SKILL.md`).
- Filter guidance by `topic` headings when requested.

## Safety & Constraints
- Keep topic filtering deterministic; do not reorder or reformat content.
- Do not add new skill packs without aligning docs and tests.

## Testing
- Add/adjust Vitest coverage for topic filtering and missing-skill behavior.
