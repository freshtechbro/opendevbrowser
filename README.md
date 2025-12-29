# OpenDevBrowser Plugin

OpenDevBrowser is an OpenCode plugin that provides fast, script-first browser automation with a snapshot → refs → actions workflow. It launches or connects to Chrome via CDP and stays lightweight by default.

## Install

Add the plugin to your OpenCode config (`~/.config/opencode/opencode.json`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opendevbrowser"]
}
```

Restart OpenCode. The plugin works out-of-box with sensible defaults.

## Plugin Versioning

OpenCode installs npm plugins via Bun at startup and caches them in `~/.cache/opencode/node_modules/`.

| Pattern | Behavior | Best For |
|---------|----------|----------|
| `"opendevbrowser"` | Installed at startup and cached until you change version or refresh cache | Most users |
| `"opendevbrowser@1.0.0"` | Fixed version, reproducible and offline-friendly | Production, CI |

**Recommendation**: Use unpinned (`"opendevbrowser"`) for development, pinned versions for production.

## Updating the Plugin

- **Recommended**: Bump the version in `opencode.json`, then restart OpenCode
- **Force reinstall**: Delete `~/.cache/opencode/` and restart
- **Optional**: `cd ~/.cache/opencode && bun update opendevbrowser` (if you prefer a Bun-driven update)
- **Optional**: Set `checkForUpdates` to show update hints in `opendevbrowser_status`

## Configuration

For advanced customization, edit `~/.config/opencode/opendevbrowser.jsonc`. The plugin auto-creates this file with relay defaults on first run.

```jsonc
{
  // Browser settings
  "headless": false,              // Run Chrome in headless mode
  "profile": "default",           // Browser profile name
  "persistProfile": true,         // Persist profile between sessions
  "chromePath": "/path/to/chrome", // Custom Chrome executable path
  "flags": [],                    // Additional Chrome flags
  "checkForUpdates": false,       // Check npm for updates in status tool

  // Snapshot settings
  "snapshot": {
    "maxChars": 16000,            // Max characters in snapshot output
    "maxNodes": 1000              // Max nodes to include in snapshot
  },

  // Export/clone settings
  "export": {
    "maxNodes": 1000,             // Max nodes to export
    "inlineStyles": true          // Inline computed styles in export
  },

  // DevTools capture settings
  "devtools": {
    "showFullUrls": false,        // Show full URLs (vs redacted)
    "showFullConsole": false      // Show full console output (vs redacted)
  },

  // Security settings
  "security": {
    "allowRawCDP": false,         // Allow raw CDP commands
    "allowNonLocalCdp": false,    // Allow non-localhost CDP endpoints
    "allowUnsafeExport": false    // Skip HTML sanitization in exports
  },

  // Relay settings (for extension)
  "relayPort": 8787,              // Local relay server port
  "relayToken": "some-test-token" // Set to false to disable pairing
}
```

All fields are optional. Omit any to use defaults.

## Core Flow

1. Launch a managed session.
2. Capture a snapshot to get refs.
3. Click/type/select using refs.
4. Re-snapshot after navigation or big DOM changes.

## Tool Examples

Launch and snapshot:

```json
{
  "tool": "opendevbrowser_launch",
  "args": { "profile": "default", "headless": false }
}
```

```json
{
  "tool": "opendevbrowser_snapshot",
  "args": { "sessionId": "SESSION_ID", "format": "outline" }
}
```

Click and type:

```json
{
  "tool": "opendevbrowser_click",
  "args": { "sessionId": "SESSION_ID", "ref": "r12" }
}
```

```json
{
  "tool": "opendevbrowser_type",
  "args": { "sessionId": "SESSION_ID", "ref": "r21", "text": "hello" }
}
```

Batch run:

```json
{
  "tool": "opendevbrowser_run",
  "args": {
    "sessionId": "SESSION_ID",
    "steps": [
      { "action": "goto", "args": { "url": "https://example.com" } },
      { "action": "snapshot", "args": { "format": "outline" } }
    ]
  }
}
```

## Chrome Extension (Mode C Relay)

The extension is optional and only needed to attach to existing logged-in browser tabs.

### Install Options

#### Option 1: Chrome Web Store (Recommended)
Install from the [Chrome Web Store](https://chrome.google.com/webstore) (search "OpenDevBrowser").

#### Option 2: Auto-extracted from plugin
The plugin auto-extracts the extension to a stable path on first run. Check `opendevbrowser_status` output for the path, then:
1. Open `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the extracted extension folder

#### Option 3: Manual download
Download `opendevbrowser-extension.zip` from [GitHub Releases](https://github.com/anthropics/opendevbrowser/releases), unzip, and load as unpacked.

### Using the Extension

1. Keep `relayPort` at the default `8787` in the plugin config (or set a custom port).
2. The extension defaults to pairing on; leave it enabled and keep the token in sync with `relayToken`.
3. If you changed the port or token, enter the same values in the extension popup.
4. Click Connect in the extension popup to attach to the active tab.
5. Call `opendevbrowser_launch` and it will auto-switch to Mode C when the extension is connected.

If the extension disconnects, the next launch falls back to managed mode.

Pairing is enforced by default. To disable it, set `"relayToken": false` in the plugin config and uncheck "Require pairing token" in the extension popup.

## Privacy Policy

See our [Privacy Policy](docs/privacy.md) for information about data handling.

## Scripts

- `npm run build` - compile the plugin to `dist/`
- `npm run dev` - watch build
- `npm run lint` - ESLint checks
- `npm run test` - Vitest with coverage
- `npm run extension:build` - compile extension assets
- `npm run extension:pack` - create Web Store ZIP
