# Local AGENTS.md (skills/)

Applies to `skills/` and subdirectories. Extends root `AGENTS.md`.

## Skill Pack Architecture
- Each skill pack lives in its own folder with `SKILL.md` as the entry point.
- `opendevbrowser-best-practices` is the canonical prompting guide source.
- Skills are discovered via `SkillLoader.listSkills()` and loaded via `SkillLoader.loadSkill(name, topic?)`.

## Skill Pack Rules
- `skills/opendevbrowser-best-practices/SKILL.md` is the source for prompting guide output.
- Keep guidance short, script-first, and snapshot-first.
- Keep examples aligned with `opendevbrowser_*` tool names.
- Do not include secrets or captured page data in skill content.

## Skill Format Specification

### Naming Conventions (OpenCode alignment)
- Skill names: lowercase, hyphens only, 1-64 characters
- Directory name must match skill name in frontmatter
- Examples: `login-automation`, `form-testing`, `data-extraction`

### SKILL.md Structure
```markdown
---
name: skill-name
description: Brief description (1-1024 chars)
version: 1.0.0
---

# Skill Title

## Section Heading
Content organized by topic for filtering.
```

### Required Frontmatter
| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Skill identifier (lowercase, hyphens) |
| `description` | Yes | Brief description for listing |
| `version` | No | Semantic version (defaults to 1.0.0) |

## Available Skills

| Skill | Purpose |
|-------|---------|
| `opendevbrowser-best-practices` | Core prompting guide for browser automation |
| `login-automation` | Authentication and credential handling |
| `form-testing` | Form validation and submission testing |
| `data-extraction` | Table extraction and pagination handling |

## Custom Skill Paths
Users can add custom skills via `skillPaths` in `opendevbrowser.jsonc`:
```jsonc
{
  "skillPaths": ["~/.config/opencode/opendevbrowser-skills"]
}
```

## Folder Structure
```
skills/
|-- opendevbrowser-best-practices/
|   `-- SKILL.md
|-- login-automation/
|   `-- SKILL.md
|-- form-testing/
|   `-- SKILL.md
|-- data-extraction/
|   `-- SKILL.md
`-- AGENTS.md
```
