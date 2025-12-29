# OpenDevBrowser Local Testing Workflow Plan

Step-by-step workflow to build, install, configure, and test the OpenDevBrowser plugin and optional extension before a public release.

---

## Overview

### Scope
- Build local plugin and extension artifacts.
- Install the plugin into OpenCode for hands-on testing.
- Configure `opencode.json` and optional plugin config.
- Load and connect the Chrome extension for relay mode.
- Run a smoke test using the OpenCode tools.

### Key decisions
- Use a prerelease npm tag for pre-publish testing because OpenCode does not reliably install plugins from local file paths (see opencode issue #4324).
- Prefer the plugin's auto-extracted extension path for unpacked extension installs.

---

## Task 1 — Build local artifacts

### Reasoning
OpenCode loads compiled artifacts from the npm package, so you need fresh `dist/` and extension build outputs.

### What to do
Install dependencies and build both the plugin and extension, then generate test packages.

### How
1. Install dependencies: `npm install`
2. Build the plugin: `npm run build`
3. Build the extension: `npm run extension:build`
4. Create a tarball for install testing: `npm pack`
5. (Optional) Create the extension zip: `npm run extension:pack`

### Files impacted
- `node_modules/`
- `dist/`
- `extension/dist/`
- `opendevbrowser-0.1.0.tgz` (or current version)
- `opendevbrowser-extension.zip` (optional)

### End goal
Local build artifacts exist and match the current source.

### Acceptance criteria
- [ ] `dist/` and `extension/dist/` exist with fresh outputs
- [ ] `opendevbrowser-0.1.0.tgz` exists after `npm pack`
- [ ] `opendevbrowser-extension.zip` exists if you ran `npm run extension:pack`

---

## Task 2 — Publish a prerelease package for OpenCode to install

### Reasoning
OpenCode installs plugins via Bun from a registry; local file-path installs are not reliably supported.

### What to do
Publish a prerelease version to npm (or a private registry) so OpenCode can install it.

### How
1. Pick a prerelease version (example): `npm version prerelease --preid dev`
2. Publish with a non-default tag: `npm publish --tag dev`
3. Note the version string printed by npm for use in `opencode.json`.
4. If you need a private workflow, publish to a private registry instead (e.g., Verdaccio), then use the same tag/version steps there.

### Files impacted
- `package.json` (version bump)
- `package-lock.json` (version bump)
- `opendevbrowser-0.1.0.tgz` (new build output)

### End goal
A prerelease package is available from a registry for OpenCode to install.

### Acceptance criteria
- [ ] `npm view opendevbrowser@dev version` returns the prerelease version
- [ ] The prerelease tarball includes `dist/`, `skills/`, and `extension/` assets

---

## Task 3 — Configure OpenCode to load the prerelease plugin

### Reasoning
OpenCode only loads plugins listed in `opencode.json`.

### What to do
Add the prerelease package version to the OpenCode plugin list.

### How
1. Open `~/.config/opencode/opencode.json`.
2. Ensure the `plugin` array exists and add the prerelease spec, for example:
   ```json
   {
     "$schema": "https://opencode.ai/config.json",
     "plugin": ["opendevbrowser@0.1.0-dev.0"]
   }
   ```
3. Restart OpenCode to trigger plugin installation.

### Files impacted
- `~/.config/opencode/opencode.json`
- `~/.cache/opencode/node_modules/opendevbrowser/` (installed plugin)

### End goal
OpenCode installs and recognizes the prerelease plugin.

### Acceptance criteria
- [ ] `opendevbrowser_status` runs without errors in OpenCode
- [ ] OpenCode cache contains `~/.cache/opencode/node_modules/opendevbrowser/`

---

## Task 4 — Review plugin relay config for pairing

### Reasoning
Extension relay settings live in the plugin-owned config file, which is auto-created with pairing defaults.

### What to do
Confirm `~/.config/opencode/opendevbrowser.jsonc` exists and adjust relay settings if needed.

### How
1. Run `opendevbrowser_status` once to let the plugin auto-create the config file.
2. Open `~/.config/opencode/opendevbrowser.jsonc` and confirm relay settings, for example:
   ```jsonc
   {
     "relayPort": 8787,
     "relayToken": "some-test-token"
   }
   ```
3. If you want to disable pairing, set `"relayToken": false`.
4. Keep `relayPort` and `relayToken` handy for the extension popup.

### Files impacted
- `~/.config/opencode/opendevbrowser.jsonc` (new or updated)

### End goal
Relay settings are confirmed for the extension to connect with default pairing.

### Acceptance criteria
- [ ] `opendevbrowser_status` shows the configured relay port
- [ ] Relay token (or disabled pairing) is documented for use in the extension

---

## Task 5 — Install the Chrome extension and connect

### Reasoning
The extension is required to attach to existing logged-in tabs (Mode C).

### What to do
Load the unpacked extension and connect it to the local relay.

### How
1. Run `opendevbrowser_status` once to trigger auto-extraction.
2. In the status output, copy the extracted path (expected under `~/.config/opencode/opendevbrowser/extension/`).
3. Open `chrome://extensions`, enable Developer mode, click "Load unpacked", and select the extracted folder.
4. Open the extension popup, confirm `relayPort`, toggle "Require pairing token" as desired, and set the token to match the plugin if enabled.

### Files impacted
- `~/.config/opencode/opendevbrowser/extension/` (auto-extracted)
- Chrome profile extension state

### End goal
The extension is loaded and connected to the relay.

### Acceptance criteria
- [ ] Extension shows "Connected" in the popup
- [ ] `opendevbrowser_status` reflects extension connectivity

---

## Task 6 — Run a smoke test in OpenCode

### Reasoning
Validates the plugin tools and relay integration end-to-end.

### What to do
Launch a session, capture a snapshot, and perform a simple click/type action.

### How
1. Launch a session:
   ```json
   { "tool": "opendevbrowser_launch", "args": { "headless": false } }
   ```
2. Navigate and snapshot:
   ```json
   { "tool": "opendevbrowser_run", "args": { "sessionId": "SESSION_ID", "steps": [
     { "action": "goto", "args": { "url": "https://example.com" } },
     { "action": "snapshot", "args": { "format": "outline" } }
   ] } }
   ```
3. Use a ref from the snapshot to click or type:
   ```json
   { "tool": "opendevbrowser_click", "args": { "sessionId": "SESSION_ID", "ref": "r12" } }
   ```

### Files impacted
- `~/.config/opencode/opendevbrowser/` (runtime state)

### End goal
Core tools function and the relay mode works if the extension is connected.

### Acceptance criteria
- [ ] `opendevbrowser_launch` returns a valid `sessionId`
- [ ] `opendevbrowser_snapshot` returns a valid outline with refs
- [ ] Click/type actions succeed without errors

---

## File-by-file implementation sequence

1. `package.json` — Task 2 (version bump for prerelease)
2. `package-lock.json` — Task 2 (version bump for prerelease)
3. `~/.config/opencode/opencode.json` — Task 3
4. `~/.config/opencode/opendevbrowser.jsonc` — Task 4 (optional)
5. `~/.config/opencode/opendevbrowser/extension/` — Task 5 (auto-extracted)

---

## Dependencies to add

| Package | Version | Purpose |
|---------|---------|---------|
| None | N/A | N/A |

---

## Version history

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-12-28 | Initial testing workflow plan |
