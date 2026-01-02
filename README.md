# OpenDevBrowser

[![npm version](https://img.shields.io/npm/v/opendevbrowser.svg?style=flat-square)](https://registry.npmjs.org/opendevbrowser)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg?style=flat-square)](https://www.typescriptlang.org/)
[![OpenCode Plugin](https://img.shields.io/badge/OpenCode-Plugin-green.svg?style=flat-square)](https://opencode.ai)
[![Test Coverage](https://img.shields.io/badge/coverage-95%25-brightgreen.svg?style=flat-square)](https://registry.npmjs.org/opendevbrowser)

> **Script-first browser automation for AI agents.** Snapshot → Refs → Actions.

OpenDevBrowser is an [OpenCode](https://opencode.ai) plugin that gives AI agents direct browser control via Chrome DevTools Protocol. Launch browsers, capture page snapshots, and interact with elements using stable refs.

---

## Installation

### For Humans

```bash
# Interactive installer (recommended)
npx opendevbrowser

# Or specify location
npx opendevbrowser --global   # ~/.config/opencode/opencode.json
npx opendevbrowser --local    # ./opencode.json

# Full install (config + extension assets)
npx opendevbrowser --full
```

Restart OpenCode after installation.

OpenCode discovers skills in `.opencode/skill` (project) and `~/.config/opencode/skill` (global) first; `.claude/skills` is compatibility-only. The CLI installs bundled skills into the OpenCode-native locations by default.

### Agent Installation (OpenCode)

Recommended (CLI, installs plugin + config + bundled skills + extension assets):

```bash
npx opendevbrowser --full --global --no-prompt
```

Explicit flags (config + skills, no prompt):

```bash
npx opendevbrowser --global --with-config --skills-global --no-prompt
```

Manual fallback (edit OpenCode config):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opendevbrowser"]
}
```

Config location: `~/.config/opencode/opencode.json`

Restart OpenCode, then run `opendevbrowser_status` to verify the plugin is loaded.

---

## Quick Start

```
1. Launch a browser session
2. Navigate to a URL
3. Take a snapshot to get element refs
4. Interact using refs (click, type, select)
5. Re-snapshot after navigation
```

### Core Workflow

| Step | Tool | Purpose |
|------|------|---------|
| 1 | `opendevbrowser_launch` | Start managed Chrome session |
| 2 | `opendevbrowser_goto` | Navigate to URL |
| 3 | `opendevbrowser_snapshot` | Get page structure with refs |
| 4 | `opendevbrowser_click` / `opendevbrowser_type` | Interact with elements |
| 5 | `opendevbrowser_close` | Clean up session |

---

## Features

### Browser Control
- **Launch & Connect** - Start managed Chrome or connect to existing browsers
- **Multi-Tab Support** - Create, switch, and manage browser tabs
- **Profile Persistence** - Maintain login sessions across runs
- **Headless Mode** - Run without visible browser window

### Page Interaction
- **Snapshot** - Accessibility-tree based page capture (token-efficient)
- **Click** - Click elements by ref
- **Type** - Enter text into inputs
- **Select** - Choose dropdown options
- **Scroll** - Scroll page or elements
- **Wait** - Wait for selectors or navigation

### DevTools Integration
- **Console Capture** - Monitor console.log, errors, warnings
- **Network Tracking** - Capture XHR/fetch requests and responses
- **Screenshot** - Full page or element screenshots
- **Performance** - Page load metrics

### Export & Clone
- **DOM Capture** - Extract sanitized HTML with inline styles
- **React Emitter** - Generate React component code from pages
- **CSS Extraction** - Pull computed styles

---

## Tool Reference

OpenDevBrowser provides **30 tools** organized by category:

### Session Management
| Tool | Description |
|------|-------------|
| `opendevbrowser_launch` | Launch managed Chrome session with optional profile |
| `opendevbrowser_connect` | Connect to existing Chrome CDP endpoint |
| `opendevbrowser_disconnect` | Disconnect browser session |
| `opendevbrowser_status` | Get session status and connection info |

### Tab/Target Management
| Tool | Description |
|------|-------------|
| `opendevbrowser_targets_list` | List all browser tabs/targets |
| `opendevbrowser_target_use` | Switch to a specific tab by targetId |
| `opendevbrowser_target_new` | Open new tab (optionally with URL) |
| `opendevbrowser_target_close` | Close a tab by targetId |

### Named Pages
| Tool | Description |
|------|-------------|
| `opendevbrowser_page` | Open or focus a named page (logical tab alias) |
| `opendevbrowser_list` | List all named pages in session |
| `opendevbrowser_close` | Close a named page |

### Navigation & Interaction
| Tool | Description |
|------|-------------|
| `opendevbrowser_goto` | Navigate to URL |
| `opendevbrowser_wait` | Wait for load state or element |
| `opendevbrowser_snapshot` | Capture page accessibility tree with refs |
| `opendevbrowser_click` | Click element by ref |
| `opendevbrowser_type` | Type text into input by ref |
| `opendevbrowser_select` | Select dropdown option by ref |
| `opendevbrowser_scroll` | Scroll page or element |
| `opendevbrowser_run` | Execute multiple actions in sequence |

### DOM Inspection
| Tool | Description |
|------|-------------|
| `opendevbrowser_dom_get_html` | Get outerHTML of element by ref |
| `opendevbrowser_dom_get_text` | Get innerText of element by ref |

### DevTools & Analysis
| Tool | Description |
|------|-------------|
| `opendevbrowser_console_poll` | Poll console logs since sequence |
| `opendevbrowser_network_poll` | Poll network requests since sequence |
| `opendevbrowser_screenshot` | Capture page screenshot |
| `opendevbrowser_perf` | Get page performance metrics |
| `opendevbrowser_prompting_guide` | Get best-practice prompting guidance |

### Export & Cloning
| Tool | Description |
|------|-------------|
| `opendevbrowser_clone_page` | Export page as React component + CSS |
| `opendevbrowser_clone_component` | Export element subtree as React component |

### Skills
| Tool | Description |
|------|-------------|
| `opendevbrowser_skill_list` | List available skills |
| `opendevbrowser_skill_load` | Load a skill by name (with optional topic filter) |

---

## Bundled Skills

OpenDevBrowser includes **5 task-specific skill packs**:

| Skill | Purpose |
|-------|---------|
| `opendevbrowser-best-practices` | Core prompting patterns and workflow guidance |
| `opendevbrowser-continuity-ledger` | Long-running task state management |
| `login-automation` | Authentication flow patterns |
| `form-testing` | Form validation and submission workflows |
| `data-extraction` | Structured data scraping patterns |

Skills are discovered from (priority order):
1. `.opencode/skill/` (project)
2. `~/.config/opencode/skill/` (global)
3. `.claude/skills/` (compatibility)
4. `~/.claude/skills/` (compatibility)
5. Custom paths via `skillPaths` config

Load a skill: `opendevbrowser_skill_load` with `name` and optional `topic` filter.

---

## Browser Modes

| Mode | Tool | Use Case |
|------|------|----------|
| **Managed** | `opendevbrowser_launch` | Fresh browser, full control, automatic cleanup |
| **CDP Connect** | `opendevbrowser_connect` | Attach to existing Chrome with `--remote-debugging-port` |
| **Extension Relay** | Chrome Extension | Attach to logged-in tabs via relay server |

---

## Chrome Extension (Optional)

The extension enables **Mode C** - attach to existing logged-in browser tabs without launching a new browser.

### Auto-Pair Feature

The plugin and extension can automatically pair:

1. **Plugin side**: Starts a local relay server and config discovery endpoint
2. **Extension side**: Enable "Auto-Pair" toggle and click Connect
3. Extension fetches relay port from discovery, then fetches token from the relay server
4. Connection established with color indicator (green = connected)

### Manual Setup

1. Start OpenCode once so the plugin can extract the extension assets.
2. Load unpacked from `~/.config/opencode/opendevbrowser/extension`
   (fallback: `~/.cache/opencode/node_modules/opendevbrowser/extension`).
3. Open extension popup
4. Enter the same relay port and token as the plugin config
   (if `relayToken` is missing, either add one to `opendevbrowser.jsonc` or use Auto-Pair).
5. Click Connect

---

## Configuration

Optional config file: `~/.config/opencode/opendevbrowser.jsonc`

```jsonc
{
  // Browser settings
  "headless": false,
  "profile": "default",
  "persistProfile": true,
  "chromePath": "/path/to/chrome",  // Custom Chrome executable
  "flags": ["--disable-extensions"],  // Additional Chrome flags

  // Snapshot limits
  "snapshot": { "maxChars": 16000, "maxNodes": 1000 },

  // Export limits
  "export": { "maxNodes": 1000, "inlineStyles": true },

  // DevTools output
  "devtools": { "showFullUrls": false, "showFullConsole": false },

  // Security (all default false for safety)
  "security": {
    "allowRawCDP": false,
    "allowNonLocalCdp": false,
    "allowUnsafeExport": false
  },

  // Skills configuration
  "skills": {
    "nudge": {
      "enabled": true,
      "keywords": ["form", "login", "extract", "scrape"],
      "maxAgeMs": 60000
    }
  },
  "skillPaths": ["./custom-skills"],  // Additional skill directories

  // Continuity ledger
  "continuity": {
    "enabled": true,
    "filePath": "opendevbrowser_continuity.md",
    "nudge": {
      "enabled": true,
      "keywords": ["plan", "multi-step", "refactor", "migration"],
      "maxAgeMs": 60000
    }
  },

  // Extension relay
  "relayPort": 8787,
  "relayToken": "auto-generated-on-first-run",

  // Updates
  "checkForUpdates": false
}
```

All fields optional. Plugin works with sensible defaults.

---

## CLI Commands

| Command | Description |
|---------|-------------|
| `npx opendevbrowser` | Interactive install |
| `npx opendevbrowser --global` | Install to global config |
| `npx opendevbrowser --local` | Install to project config |
| `npx opendevbrowser --with-config` | Also create opendevbrowser.jsonc |
| `npx opendevbrowser --full` | Full install (config + extension assets) |
| `npx opendevbrowser --update` | Clear cache, trigger reinstall |
| `npx opendevbrowser --uninstall` | Remove from config |
| `npx opendevbrowser --version` | Show version |

---

## Security

- **Relay Authentication** - Cryptographically secure tokens, timing-safe comparison
- **Origin Validation** - Only localhost and Chrome extensions can pair
- **CDP Localhost-Only** - Remote CDP endpoints blocked by default
- **Data Redaction** - Console/network output redacts tokens and API keys
- **Export Sanitization** - Scripts and event handlers stripped from exports
- **Atomic Config Writes** - Prevents config corruption on crash

---

## Updating

```bash
# Option 1: Clear cache (recommended)
rm -rf ~/.cache/opencode/node_modules/opendevbrowser
# Then restart OpenCode

# Option 2: Use CLI
npx opendevbrowser --update
```

Release checklist: [docs/DISTRIBUTION_PLAN.md](docs/DISTRIBUTION_PLAN.md)

---

## Development

```bash
npm install
npm run build      # Compile to dist/
npm run test       # Run tests with coverage
npm run lint       # ESLint checks
npm run extension:build  # Compile extension
```

---

## Privacy

See [Privacy Policy](docs/privacy.md) for data handling details.

---

## License

MIT
