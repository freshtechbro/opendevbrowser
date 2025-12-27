# OpenDevBrowser Plugin

OpenDevBrowser is an OpenCode plugin that provides fast, script-first browser automation with a snapshot → refs → actions workflow. It launches or connects to Chrome via CDP and stays lightweight by default.

## Install

Add the plugin to your OpenCode config (`~/.config/opencode/opencode.json`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opendevbrowser@latest"]
}
```

That's it! The plugin works out-of-box with sensible defaults. Use `@latest` to auto-update on each OpenCode start.

## Optional Configuration

For advanced customization, create `~/.config/opencode/opendevbrowser.jsonc`:

```jsonc
{
  "headless": false,
  "profile": "default",
  "persistProfile": true,
  "snapshot": { "maxChars": 16000 },
  "security": {
    "allowRawCDP": false,
    "allowNonLocalCdp": false,
    "allowUnsafeExport": false
  },
  "relayPort": 8787,
  "relayToken": "optional-secret",
  "chromePath": "/path/to/chrome",
  "flags": []
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

## Optional Extension (Mode C Relay)

The extension is optional and only needed if you want to attach to existing logged-in tabs.

Build the extension:

```bash
npm run extension:build
```

Load `extension/` as an unpacked extension in Chrome. The popup shows connection status and a connect/disconnect toggle.

Relay flow:

1. Keep `relayPort` at the default `8787` in the plugin config (or set a custom port).
2. If you changed the port, enter the same relay port in the extension popup.
3. Click Connect in the extension popup to attach to the active tab.
4. Call `opendevbrowser_launch` and it will auto-switch to Mode C when the extension is connected.

If the extension disconnects, the next launch falls back to managed mode.

Optional: set `relayToken` in the plugin config and enter the same token in the extension popup to lock down relay connections.

## Scripts

- `npm run build` - compile the plugin to `dist/`
- `npm run dev` - watch build
- `npm run lint` - ESLint checks
- `npm run test` - Vitest with coverage
- `npm run extension:build` - compile extension assets
