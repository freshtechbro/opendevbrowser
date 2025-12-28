# Local AGENTS.md (src/skills)

Applies to `src/skills/`. Extends `src/AGENTS.md` and root `AGENTS.md`.

## Local Architecture
- `SkillLoader` reads skill packs from `skills/` (fallback to parent dir) and filters by heading `topic`.

## Responsibilities
- Load skill packs (e.g., `skills/opendevbrowser-best-practices/SKILL.md`).
- Filter guidance by `topic` headings when requested.

## Safety & Constraints
- Keep topic filtering deterministic; do not reorder or reformat content.
- Do not add new skill packs without aligning docs and tests.

## Testing
- Add/adjust Vitest coverage for topic filtering and missing-skill behavior.

## Folder Structure
```
src/skills/
```
