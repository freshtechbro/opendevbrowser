# skills/ — Agent Guidelines

Bundled skill packs. Extends root `AGENTS.md`.

## Structure

```
skills/
├── opendevbrowser-best-practices/SKILL.md   # Core prompting guide
├── opendevbrowser-continuity-ledger/SKILL.md
├── login-automation/SKILL.md
├── form-testing/SKILL.md
└── data-extraction/SKILL.md
```

## SKILL.md Format

```markdown
---
name: skill-name          # lowercase, hyphens, 1-64 chars
description: Brief desc   # 1-1024 chars
version: 1.0.0           # optional, defaults to 1.0.0
---

# Skill Title

## Section Heading
Content organized by topic for filtering.
```

## Discovery Priority

1. `.opencode/skill/` (project-local)
2. `~/.config/opencode/skill/` (global)
3. `.claude/skills/` (compatibility)
4. `~/.claude/skills/` (compatibility)
5. `skillPaths` config (custom)

## Constraints

- Directory name must match `name` in frontmatter
- Keep guidance short, script-first, snapshot-first
- Examples must use `opendevbrowser_*` tool names
- Never include secrets or page data in content
- Match the snapshot → refs → actions flow in `docs/ARCHITECTURE.md` and tool list in `docs/CLI.md`.
- Note that extension relay requires Chrome 125+ and uses hub-only relay ownership when enabled.
- Refer to root `AGENTS.md` for connection flag/status semantics (extensionConnected, handshake, cdpConnected, pairingRequired).

## Adding Skills

1. Create `skills/<skill-name>/SKILL.md`
2. Follow frontmatter format above
3. Update `docs/CLI.md` if adding CLI-related guidance
