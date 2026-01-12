# Local AGENTS.md (src/skills)

Applies to `src/skills/`. Extends `src/AGENTS.md` and root `AGENTS.md`.

## Local Architecture
- `SkillLoader` reads skill packs from OpenCode skill directories:
  - Project-local: `.opencode/skill/`
  - Global: `~/.config/opencode/skill/`
  - Compatibility: `.claude/skills/`, `~/.claude/skills/`
- `skillPaths` can add extra search paths as an advanced override.

## Responsibilities
- Load skill packs (e.g., `skills/opendevbrowser-best-practices/SKILL.md`).
- Filter guidance by `topic` headings when requested.

## Safety & Constraints
- Keep topic filtering deterministic; do not reorder or reformat content.
- Do not add new skill packs without aligning docs and tests.

## Documentation Sync
- Update `docs/REFACTORING_PLAN.md` and skill docs when adding or changing skill discovery behavior.

## Testing
- Add/adjust Vitest coverage for topic filtering and missing-skill behavior.

## Folder Structure
```
src/skills/
```
