# skills/ — Agent Guidelines

Bundled OpenDevBrowser skill directories (11 total: 9 canonical packs + 2 compatibility aliases, `research/` and `shopping/`). Extends root `AGENTS.md`.

## Structure

```
skills/
├── opendevbrowser-best-practices/SKILL.md
├── opendevbrowser-design-agent/SKILL.md
├── opendevbrowser-continuity-ledger/SKILL.md
├── opendevbrowser-login-automation/SKILL.md
├── opendevbrowser-form-testing/SKILL.md
├── opendevbrowser-data-extraction/SKILL.md
├── opendevbrowser-research/SKILL.md
├── opendevbrowser-shopping/SKILL.md
├── opendevbrowser-product-presentation-asset/SKILL.md
├── research/      # Empty compatibility alias dir; keep non-canonical
└── shopping/      # Empty compatibility alias dir; keep non-canonical
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
3. `.codex/skills/` (project compatibility)
4. `$CODEX_HOME/skills` (global compatibility; fallback `~/.codex/skills`)
5. `.claude/skills/` (ClaudeCode project compatibility)
6. `$CLAUDECODE_HOME/skills` or `$CLAUDE_HOME/skills` (ClaudeCode global compatibility; fallback `~/.claude/skills`)
7. `.amp/skills/` (AmpCLI project compatibility)
8. `$AMPCLI_HOME/skills` or `$AMP_CLI_HOME/skills` or `$AMP_HOME/skills` (AmpCLI global compatibility; fallback `~/.amp/skills`)
9. `skillPaths` config (custom)
10. Bundled package `skills/` directory as a fallback when no installed copy is available

## Constraints

- Directory name must match `name` in frontmatter
- Keep guidance short, script-first, snapshot-first
- Examples must use `opendevbrowser_*` tool names
- Never include secrets or page data in content
- Keep canonical guidance in `opendevbrowser-*` packs; do not add legacy alias directories.
- Leave `skills/research/` and `skills/shopping/` empty unless a verified migration plan explicitly repurposes them.
- Match the snapshot → refs → actions flow in `docs/ARCHITECTURE.md` and tool list in `docs/CLI.md`.
- Note that extension relay requires Chrome 125+ and uses hub-only relay ownership when enabled.
- Refer to root `AGENTS.md` for connection flag/status semantics (extensionConnected, handshake, cdpConnected, pairingRequired).
- Keep skill operational guidance aligned with release-gate scripts in `docs/CLI.md` (`provider-direct-runs --release-gate`, `live-regression-direct --release-gate`).

## Adding Skills

1. Create `skills/<skill-name>/SKILL.md`
2. Follow frontmatter format above
3. Update `README.md`, root `AGENTS.md`, and `docs/CLI.md` when the canonical skill-pack count changes
