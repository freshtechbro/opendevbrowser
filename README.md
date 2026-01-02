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

## Chrome Extension (Optional)

The extension enables **Mode C** - attach to existing logged-in browser tabs without launching a new browser.

### Auto-Pair Feature

The plugin and extension can automatically pair:

1. **Plugin side**: Auto-generates secure token on first run (saved to config)
2. **Extension side**: Enable "Auto-Pair" toggle and click Connect
3. Extension fetches token from plugin's relay server
4. Connection established with color indicator (green = connected)

### Manual Setup

1. Install extension from Chrome Web Store or load unpacked from `~/.cache/opencode/opendevbrowser-extension/`
2. Open extension popup
3. Enter same port/token as plugin config
4. Click Connect

---

## Configuration

Optional config file: `~/.config/opencode/opendevbrowser.jsonc`

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
  "continuity": {
    "enabled": true,
    "filePath": "opendevbrowser_continuity.md",
    "nudge": {
      "enabled": true,
      "keywords": [
        "plan",
        "multi-step",
        "multi step",
        "long-running",
        "long running",
        "refactor",
        "migration",
        "rollout",
        "release",
        "upgrade",
        "investigate",
        "follow-up",
        "continue"
      ],
      "maxAgeMs": 60000
    }
  },
  "relayPort": 8787,
  "relayToken": "auto-generated-on-first-run"
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

Release checklist: `docs/DISTRIBUTION_PLAN.md`

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
