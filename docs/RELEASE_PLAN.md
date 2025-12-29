# Release & Distribution Implementation Plan

This document provides a task-by-task implementation plan for packaging and releasing the OpenDevBrowser plugin (npm/OpenCode) and Chrome extension (Web Store + manual download).

---

## Overview

### Distribution channels
1. **npm** — plugin package with prebuilt extension assets
2. **OpenCode** — users add `"opendevbrowser"` to `opencode.json` (or pinned version like `"opendevbrowser@1.2.3"`)
3. **Chrome Web Store** — extension published separately
4. **Manual download** — extension ZIP attached to GitHub Releases

### Key decisions
- **Icon**: Charcoal `#2D2D2D`, "Browser Window" glyph, flat, no text
- **Privacy policy**: hosted via GitHub Pages from `/docs`
- **Auto-extraction**: plugin copies extension to `~/.config/opencode/opendevbrowser/extension/`
- **Version sync**: extension manifest version auto-synced with plugin version

---

## Task 1 — Package extension assets in npm publish

### Reasoning
Users should not run `npm run extension:build`. OpenCode should install a fully usable plugin package.

### What to do
Include extension assets in published npm package and ensure they are built at publish time.

### How
1. Update `package.json` `files` array to include:
   - `extension/manifest.json`
   - `extension/popup.html`
   - `extension/dist/**`
   - `extension/icons/**`
2. Add `prepack` script to run: `npm run build && npm run extension:build`

### Files impacted
- `package.json`

### End goal
`npm pack` contains extension artifacts; no user build steps.

### Acceptance criteria
- [ ] `npm pack` shows extension assets in the tarball
- [ ] `npm publish` ships extension files
- [ ] README no longer requires manual `extension:build`

---

## Task 2 — Auto-extract extension to stable path

### Reasoning
Smooth UX; users shouldn't search `node_modules` to load unpacked extension.

### What to do
Copy bundled extension from plugin package to a stable user path on startup or status.

### How
1. Add a helper in plugin init (likely `src/index.ts`) to copy `extension/` into:
   - `~/.config/opencode/opendevbrowser/extension/`
2. Make it idempotent by checking a version file or manifest version.
3. Update `opendevbrowser_status` to print the extracted path.

### Files impacted
- `src/index.ts`
- `src/tools/status.ts`

### End goal
Users can load unpacked from a stable path automatically.

### Acceptance criteria
- [ ] On first run, extension files appear in the stable path
- [ ] Re-running does not overwrite if versions match
- [ ] Status tool prints the path

---

## Task 3 — Sync extension version with plugin version

### Reasoning
Keep Web Store and bundled extension aligned with npm package version.

### What to do
Auto-update `extension/manifest.json` version from root `package.json`.

### How
1. Add a script `extension:sync` (new file `scripts/sync-extension-version.mjs` or inline node script in `package.json`).
2. Wire `extension:sync` into `extension:build` or `prepack`.

### Files impacted
- `package.json`
- `extension/manifest.json`
- `scripts/sync-extension-version.mjs` (new file)

### End goal
Extension version always matches plugin version.

### Acceptance criteria
- [ ] Running `npm run extension:build` updates manifest version
- [ ] Version shown in Web Store package matches npm plugin version

---

## Task 4 — Replace JSONC parsing with robust parser

### Reasoning
Regex stripping breaks valid JSONC strings containing `//` and doesn't support trailing commas.

### What to do
Use `jsonc-parser` in `src/config.ts` and strengthen tests.

### How
1. Add dependency: `jsonc-parser`
2. Replace regex comment stripping with `jsonc-parser`'s parse function
3. Add tests for `http://` strings and trailing commas

### Files impacted
- `package.json` (new dependency)
- `src/config.ts`
- `tests/config.test.ts`

### End goal
JSONC works reliably for real-world configs.

### Acceptance criteria
- [ ] Tests pass for trailing commas
- [ ] Tests pass for URLs with `//` (e.g., `http://proxy.example.com`)
- [ ] No regressions in config parsing
- [ ] Build and lint pass

---

## Task 5 — Create and wire icons (Charcoal Black #2D2D2D)

### Reasoning
Chrome Web Store requires icons; branding needs a consistent, simple icon.

### What to do
Generate PNG icons and declare them in manifest.

### How
1. Create `extension/icons/` directory with:
   - `icon16.png` (16×16)
   - `icon32.png` (32×32)
   - `icon48.png` (48×48)
   - `icon128.png` (128×128)
2. Create `icon512.png` for GitHub/Web Store listing (store in `docs/assets/` or repo root)
3. Add `icons` field in `extension/manifest.json`:
   ```json
   "icons": {
     "16": "icons/icon16.png",
     "32": "icons/icon32.png",
     "48": "icons/icon48.png",
     "128": "icons/icon128.png"
   }
   ```

### Icon specification
- **Concept**: "Browser Window" — rounded window outline with header bar
- **Color**: Charcoal `#2D2D2D`
- **Style**: flat, single-color glyph, no text, generous padding
- **Safe area**: ~96×96 artwork inside 128×128 canvas (16px padding)

### Files impacted
- `extension/manifest.json`
- `extension/icons/icon16.png` (new)
- `extension/icons/icon32.png` (new)
- `extension/icons/icon48.png` (new)
- `extension/icons/icon128.png` (new)
- `docs/assets/icon512.png` (new)

### End goal
Compliant, reusable icon assets.

### Acceptance criteria
- [ ] Manifest includes icons field
- [ ] Chrome loads icons at all sizes without errors
- [ ] 512px icon available for Web Store listing
- [ ] Icons are simple and readable at 16×16

---

## Task 6 — Web Store packaging & compliance

### Reasoning
Ensure extension can be uploaded to the Chrome Web Store.

### What to do
Create ZIP packaging script and ensure compliance.

### How
1. Add `extension:pack` script to `package.json`:
   ```json
   "extension:pack": "cd extension && zip -r ../opendevbrowser-extension.zip manifest.json popup.html dist/ icons/"
   ```
2. Verify:
   - No remote code (MV3 requirement)
   - All permissions (`debugger`, `tabs`, `storage`) are justified
   - Single-purpose statement prepared

### Files impacted
- `package.json`

### End goal
Web Store ZIP ready for upload.

### Acceptance criteria
- [ ] `npm run extension:pack` outputs a valid ZIP
- [ ] ZIP contains manifest at root with built files
- [ ] No remote code violations

---

## Task 7 — Privacy policy on GitHub Pages

### Reasoning
Web Store requires a privacy policy URL.

### What to do
Add privacy policy to `/docs` and host on GitHub Pages.

### How
1. Create `docs/privacy.md` with standard privacy policy content:
   - What data is collected (none stored remotely)
   - How extension communicates (local relay only)
   - User rights
2. Ensure GitHub Pages is configured to serve from `/docs` folder
3. Link policy URL in README and prepare for Web Store listing

### Files impacted
- `docs/privacy.md` (new)
- `README.md` (add link)

### End goal
Compliance with Web Store privacy requirements.

### Acceptance criteria
- [ ] Privacy policy accessible at GitHub Pages URL
- [ ] Policy accurately describes extension behavior
- [ ] README links to privacy policy

---

## Task 8 — Docs updates for distribution + config

### Reasoning
Users need a clear install path and complete config reference.

### What to do
Update README and plan docs for npm/OpenCode/Web Store/manual installs.

### How
1. Update `README.md`:
   - Remove manual `npm run extension:build` step
   - Add auto-extraction path info
   - Add full config options list (all schema fields)
   - Document three extension install paths (Web Store, unpacked, manual ZIP)
2. Update plan docs to reflect distribution strategy:
   - `docs/PLAN.md`
   - `docs/opendevbrowser-plan.md`
   - `docs/IMPLEMENTATION_BLUEPRINT.md`

### Files impacted
- `README.md`
- `docs/PLAN.md`
- `docs/opendevbrowser-plan.md`
- `docs/IMPLEMENTATION_BLUEPRINT.md`

### End goal
Consistent, accurate docs across repo.

### Acceptance criteria
- [ ] README is accurate for all install flows
- [ ] All three plan docs reflect updated distribution strategy
- [ ] Config section documents all implemented options

---

## Task 9 — Validation & release checklist

### Reasoning
Ensure nothing breaks and release artifacts are correct.

### What to do
Run build/lint/tests, verify npm package contents, and verify Web Store ZIP.

### How
1. Run validation commands:
   ```bash
   npm run lint
   npm run build
   npm run test
   npm run extension:build
   npm run extension:pack
   npm pack
   ```
2. Verify npm tarball includes extension assets
3. Verify Web Store ZIP is valid

### Files impacted
None (execution only)

### End goal
Verified release readiness.

### Acceptance criteria
- [ ] All commands succeed with exit code 0
- [ ] npm tarball includes `extension/` assets
- [ ] Web Store ZIP is valid and contains all required files
- [ ] Test coverage remains ≥95%

---

## File-by-file implementation sequence

Execute tasks in this order to minimize conflicts:

1. `package.json` — Tasks 1, 3, 4, 6
2. `scripts/sync-extension-version.mjs` — Task 3 (new file)
3. `extension/manifest.json` — Tasks 3, 5
4. `extension/icons/*` — Task 5 (new files)
5. `src/config.ts` — Task 4
6. `tests/config.test.ts` — Task 4
7. `src/index.ts` — Task 2
8. `src/tools/status.ts` — Task 2
9. `docs/privacy.md` — Task 7 (new file)
10. `docs/assets/icon512.png` — Task 5 (new file)
11. `README.md` — Tasks 1, 7, 8
12. `docs/PLAN.md` — Task 8
13. `docs/opendevbrowser-plan.md` — Task 8
14. `docs/IMPLEMENTATION_BLUEPRINT.md` — Task 8
15. Run validation — Task 9

---

## Release checklists

### A) NPM (Plugin)
1. `npm ci`
2. `npm run build`
3. `npm run extension:build`
4. `npm pack` (verify extension assets included)
5. `npm publish --access public`

### B) OpenCode Plugin
1. User adds to `~/.config/opencode/opencode.json`:
   ```json
  { "plugin": ["opendevbrowser"] }
   ```
2. Restart OpenCode
3. `opendevbrowser_status` shows auto-extracted extension path

### C) Chrome Web Store (Extension)
1. `npm run extension:build`
2. `npm run extension:pack`
3. Upload ZIP to Web Store Developer Dashboard
4. Provide:
   - Icons (16/32/48/128 in package, 128 for store)
   - Screenshots
   - Privacy policy URL (GitHub Pages)
   - Single-purpose statement
   - Permission justifications

### D) Manual install
1. Download `opendevbrowser-extension.zip` from GitHub Releases
2. Unzip
3. Chrome → `chrome://extensions` → "Load unpacked" → select folder

---

## Chrome Web Store compliance checklist

- [ ] MV3 manifest
- [ ] No remote code or eval
- [ ] Permissions justified:
  - `debugger` — required for CDP access
  - `tabs` — required for tab management
  - `storage` — required for relay config persistence
- [ ] Single-purpose: "Local bridge between OpenDevBrowser and Chrome for automation"
- [ ] Privacy policy URL provided
- [ ] Icons at all required sizes

---

## Dependencies to add

| Package | Version | Purpose |
|---------|---------|---------|
| `jsonc-parser` | `^3.2.0` | Robust JSONC parsing |

---

## Task 10 — Fix plugin declaration pattern in docs

### Reasoning
Current docs incorrectly claim `"opendevbrowser@latest"` auto-updates on each OpenCode start. The official OpenCode docs show:
- npm plugins are installed with Bun at startup and cached in `~/.cache/opencode/node_modules/`
- config examples use bare npm package names (no `@latest` in examples)
- no official plugin auto-update behavior is documented

### What to do
Update all docs to use correct plugin declaration pattern and accurately describe update behavior.

### How
1. Replace `"opendevbrowser@latest"` with `"opendevbrowser"` (just package name)
2. Remove or correct claims about "auto-update on each OpenCode start"
3. Document the tradeoffs between pinned versions vs. unpinned
4. Add manual update instructions

### Files impacted
- `AGENTS.md` (lines 172-174, 207-208, 214)
- `README.md` (lines 12, 16)
- `docs/PLAN.md`
- `docs/opendevbrowser-plan.md`
- `docs/IMPLEMENTATION_BLUEPRINT.md`
- `docs/RELEASE_PLAN.md` (overview section)

### End goal
Accurate documentation that matches actual OpenCode plugin behavior.

### Acceptance criteria
- [ ] All docs use `"opendevbrowser"` (not `@latest`) as the default example
- [ ] Docs explain pinned vs. unpinned version tradeoffs
- [ ] Manual update instructions are documented
- [ ] No false claims about "auto-update"

---

## Task 11 — Document pinned vs. unpinned version tradeoffs

### Reasoning
Users need to understand the implications of their plugin version choice for offline use, startup speed, and predictability.

### What to do
Add a clear section explaining version pinning options.

### How
1. Add "Plugin Versioning" section to README.md with:
   - Default (unpinned): `"opendevbrowser"` — installed at startup and cached until refreshed
   - Pinned: `"opendevbrowser@1.0.0"` — fast, offline-friendly, predictable
2. Recommend pinned versions for production use
3. Document cache location: `~/.cache/opencode/node_modules/`

### Files impacted
- `README.md`
- `AGENTS.md`

### End goal
Users understand version options and can make informed choices.

### Acceptance criteria
- [ ] README has "Plugin Versioning" section
- [ ] Tradeoffs are clearly explained
- [ ] Cache location is documented
- [ ] Pinned versions recommended for production

---

## Task 12 — Add manual update instructions

### Reasoning
Users need clear instructions on how to update the plugin when using pinned versions or when automatic resolution doesn't work.

### What to do
Document how to manually update the plugin.

### How
1. Add "Updating the Plugin" section to README.md with:
   - For pinned: bump version in `opencode.json`, then restart
   - Force reinstall: clear `~/.cache/opencode/` and restart
   - Optional: `cd ~/.cache/opencode && bun update opendevbrowser`
2. Add same instructions to AGENTS.md Installation Playbook

### Files impacted
- `README.md`
- `AGENTS.md`

### End goal
Users know how to update regardless of their version strategy.

### Acceptance criteria
- [ ] Update instructions for all version strategies documented
- [ ] Cache clear instructions included
- [ ] Instructions tested and verified

---

## Task 13 — Add version check hint to status tool (optional)

### Reasoning
Help users discover when a newer version is available without forcing updates.

### What to do
Optionally enhance `opendevbrowser_status` to compare installed version vs. npm latest and print an update hint.

### How
1. In `src/tools/status.ts`, add logic to:
   - Read installed version from package.json
   - Fetch latest version from npm registry (fail-soft if offline)
   - If newer version available, include hint in status output
2. Make this optional/configurable to avoid network calls if user prefers

### Files impacted
- `src/tools/status.ts`
- `src/config.ts` (optional: add `checkForUpdates` config option)
- `tests/tools.test.ts` (add test coverage)

### End goal
Users are informed about available updates without forced behavior.

### Acceptance criteria
- [ ] Status tool shows current version
- [ ] Status tool shows update hint when newer version available (if online)
- [ ] Fails gracefully when offline (no error, just omits hint)
- [ ] Can be disabled via config if needed
- [ ] Tests pass

---

## Updated file-by-file implementation sequence

Execute tasks in this order to minimize conflicts:

1. `package.json` — Tasks 1, 3, 4, 6
2. `scripts/sync-extension-version.mjs` — Task 3 (new file)
3. `extension/manifest.json` — Tasks 3, 5
4. `extension/icons/*` — Task 5 (new files)
5. `src/config.ts` — Tasks 4, 13
6. `tests/config.test.ts` — Task 4
7. `src/index.ts` — Task 2
8. `src/tools/status.ts` — Tasks 2, 13
9. `tests/tools.test.ts` — Task 13
10. `docs/privacy.md` — Task 7 (new file)
11. `docs/assets/icon512.png` — Task 5 (new file)
12. `README.md` — Tasks 1, 7, 8, 10, 11, 12
13. `AGENTS.md` — Tasks 10, 11, 12
14. `docs/PLAN.md` — Tasks 8, 10
15. `docs/opendevbrowser-plan.md` — Tasks 8, 10
16. `docs/IMPLEMENTATION_BLUEPRINT.md` — Tasks 8, 10
17. `docs/RELEASE_PLAN.md` — Task 10 (update overview)
18. Run validation — Task 9

---

## Version history

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-12-28 | Initial release plan |
| 1.1 | 2025-12-28 | Added Tasks 10-13 for plugin declaration pattern fix and version documentation |
