# OpenDevBrowser Extension

Chrome extension runtime for OpenDevBrowser relay mode.

## Purpose

Connects Chrome tabs to the local OpenDevBrowser relay so sessions can run against logged-in browser contexts.

## Key behavior

- Connects to local relay (`/extension`) and participates in `/ops`, `/cdp` (legacy), and `/annotation` workflows.
- Uses flat CDP sessions (Chrome 125+) with `sessionId`-based routing.
- Supports auto-connect, auto-pair, and optional native-host fallback.
- Tracks a primary tab for handshake/status while keeping multi-target routing intact.
- Uses canonical toolbar/store icons from `assets/extension-icons` synced into `extension/icons` at build time.
- Shows a small badge dot for status (`green` connected, `red` disconnected).

## Build

Run from repo root:

```bash
npm run extension:sync
npm run extension:build
node scripts/chrome-store-compliance-check.mjs
npm run extension:pack
```

## Load unpacked

1. Build extension assets.
2. Open `chrome://extensions`.
3. Enable Developer mode.
4. Load unpacked from:
   - `~/.config/opencode/opendevbrowser/extension`, or
   - repo `extension/` for local development, or
   - pre-release local package install path: `<WORKDIR>/node_modules/opendevbrowser/extension`.

## Source map

- `extension/src/background.ts` — relay + command routing coordinator
- `extension/src/popup.tsx` — settings UI
- `extension/src/services/*` — connection manager, relay client, CDP router/session mapping
- `extension/src/ops/*` — high-level ops runtime
- `extension/src/annotate-content.ts` — in-page annotation UI

## Runtime prerequisites

- Chrome 125+
- Local daemon/relay running (`npx opendevbrowser serve`)
- Matching relay port/token settings

See `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/docs/EXTENSION.md` for full operational and troubleshooting details.
