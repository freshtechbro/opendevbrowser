# OpenDevBrowser CLI

Command-line interface for installing and managing the OpenDevBrowser plugin.

## Installation

```bash
# Interactive installation (prompts for location)
npx opendevbrowser

# Non-interactive with flags
npx opendevbrowser --global   # Install to ~/.config/opencode/opencode.json
npx opendevbrowser --local    # Install to ./opencode.json
```

By default, the CLI also installs bundled skills to `~/.config/opencode/skill`. Use `--skills-local` for project-local skills or `--no-skills` to skip skill installation. Use `--full` to always create `opendevbrowser.jsonc` and pre-extract extension assets.

### Skill discovery order (OpenCode-native)

OpenCode discovers skills in this order (first match wins):

1. Project-local: `./.opencode/skill`
2. Global: `~/.config/opencode/skill` (or `$OPENCODE_CONFIG_DIR/skill`)
3. Compatibility: `./.claude/skills`
4. Compatibility: `~/.claude/skills`
5. Extra paths from `skillPaths` (advanced)

## Commands

### Install (Default)

When run without maintenance flags, the CLI installs the plugin.

```bash
# Interactive - prompts for global or local
npx opendevbrowser

# Global installation (user-wide)
npx opendevbrowser --global
npx opendevbrowser -g

# Local installation (current project)
npx opendevbrowser --local
npx opendevbrowser -l

# Skip prompts, use default (global)
npx opendevbrowser --no-prompt

# Full install (config + extension assets)
npx opendevbrowser --full

# Also create opendevbrowser.jsonc config file
npx opendevbrowser --global --with-config

# Full install (plugin + config + bundled skills)
npx opendevbrowser --global --with-config --skills-global

# Install skills locally (project scope)
npx opendevbrowser --skills-local

# Skip installing skills
npx opendevbrowser --no-skills
```

### Update

Clear the OpenCode cache to trigger reinstallation of the latest version.

```bash
npx opendevbrowser --update
npx opendevbrowser -u
```

This removes cached files from `~/.cache/opencode/node_modules/opendevbrowser/`. OpenCode will download the latest version on next run.

### Uninstall

Remove the plugin from configuration.

```bash
# Remove from global config
npx opendevbrowser --uninstall --global

# Remove from local config
npx opendevbrowser --uninstall --local

# Interactive - prompts which to remove if both exist
npx opendevbrowser --uninstall
```

### Help

```bash
npx opendevbrowser --help
npx opendevbrowser -h
```

### Version

```bash
npx opendevbrowser --version
npx opendevbrowser -v
```

## Flags Reference

| Flag | Short | Description |
|------|-------|-------------|
| `--global` | `-g` | Install to `~/.config/opencode/opencode.json` |
| `--local` | `-l` | Install to `./opencode.json` |
| `--update` | `-u` | Clear cache to trigger reinstall |
| `--uninstall` | | Remove plugin from config |
| `--with-config` | | Also create `opendevbrowser.jsonc` |
| `--full` | `-f` | Create config and pre-extract extension assets |
| `--no-prompt` | | Skip prompts, use defaults |
| `--skills-global` | | Install skills to `~/.config/opencode/skill` (default) |
| `--skills-local` | | Install skills to `./.opencode/skill` |
| `--no-skills` | | Skip installing bundled skills |
| `--help` | `-h` | Show usage information |
| `--version` | `-v` | Show version number |

## Configuration Files

### OpenCode Config

The CLI modifies `opencode.json` to register the plugin:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opendevbrowser"]
}
```

**Locations:**
- Global: `~/.config/opencode/opencode.json`
- Local: `./opencode.json`

### Plugin Config (Optional)

When using `--with-config`, a `opendevbrowser.jsonc` is created with documented defaults:

```jsonc
{
  "headless": false,
  "profile": "default",
  "persistProfile": true,
  "snapshot": { "maxChars": 16000, "maxNodes": 1000 },
  "export": { "maxNodes": 1000, "inlineStyles": true },
  "devtools": { "showFullUrls": false, "showFullConsole": false },
  "security": {
    "allowRawCDP": false,
    "allowNonLocalCdp": false,
    "allowUnsafeExport": false
  },
  "skillPaths": [],
  "skills": {
    "nudge": {
      "enabled": true,
      "keywords": ["login", "form", "extract"],
      "maxAgeMs": 60000
    }
  },
  "continuity": {
    "enabled": true,
    "filePath": "opendevbrowser_continuity.md",
    "nudge": {
      "enabled": true,
      "keywords": ["plan", "multi-step", "long-running", "refactor", "migration", "rollout", "continue"],
      "maxAgeMs": 60000
    }
  }
}
```

The optional `skills.nudge` section controls the small one-time prompt hint that encourages early `skill(...)` usage on skill-relevant tasks.
The optional `continuity` section controls the long-running task nudge and the ledger file path.

## Examples

### First-time Setup

```bash
# Install globally for all projects
npx opendevbrowser --global

# Verify installation
# (restart OpenCode or start new session)
# Run opendevbrowser_status to confirm
```

### Project-specific Installation

```bash
cd my-project
npx opendevbrowser --local
```

### Update to Latest Version

```bash
npx opendevbrowser --update
# Restart OpenCode
```

### Clean Uninstall

```bash
npx opendevbrowser --uninstall --global
```

## Troubleshooting

### Plugin not loading after install

1. Restart OpenCode or start a new session
2. Verify config file exists and contains `"opendevbrowser"` in plugins array
3. Check for syntax errors in `opencode.json`

### Cache issues

```bash
# Force reinstall by clearing cache
npx opendevbrowser --update

# Or manually delete cache
rm -rf ~/.cache/opencode/node_modules/opendevbrowser
```

### Permission errors

Ensure you have write access to:
- `~/.config/opencode/` (global install)
- Current directory (local install)
