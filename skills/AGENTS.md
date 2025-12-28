# Local AGENTS.md (skills/)

Applies to `skills/` and subdirectories. Extends root `AGENTS.md`.

## Skill Pack Architecture
- Each skill pack lives in its own folder with `SKILL.md` as the entry point.
- `opendevbrowser-best-practices` is the canonical prompting guide source.

## Skill Pack Rules
- `skills/opendevbrowser-best-practices/SKILL.md` is the source for prompting guide output.
- Keep guidance short, script-first, and snapshot-first.
- Keep examples aligned with `opendevbrowser_*` tool names.
- Do not include secrets or captured page data in skill content.

## Folder Structure
```
skills/
`-- opendevbrowser-best-practices/
```
