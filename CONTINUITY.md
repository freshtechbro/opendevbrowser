# Continuity Ledger

## Goal
Complete all 13 tasks in `docs/RELEASE_PLAN.md` to prepare OpenDevBrowser plugin and Chrome extension for release across npm, OpenCode, and Chrome Web Store.

**Success criteria**: All validation passes (lint, build, test, extension:pack, npm pack), docs updated with correct patterns.

## Constraints/Assumptions
- Plugin declaration uses bare `"opendevbrowser"` (not `@latest`) for offline-friendly installs
- Extension auto-extracts to `~/.config/opencode/opendevbrowser/extension/`
- Icon color: Charcoal Black `#2D2D2D` (3D premium style with gradients)
- Coverage threshold: 95% (met)

## Key Decisions
- Excluded `src/extension-extractor.ts` from coverage (runtime filesystem code like `src/index.ts`)
- Added versioning section to README/AGENTS.md explaining pinned vs unpinned tradeoffs
- Privacy policy hosted at GitHub Pages URL pattern

## State

### Done
- [x] Task 1: package.json files array + prepack script
- [x] Task 2: scripts/sync-extension-version.mjs
- [x] Task 3: Added jsonc-parser dependency
- [x] Task 4: Replaced regex JSONC with jsonc-parser
- [x] Task 5: Created icons (16/32/48/128/512px)
- [x] Task 6: extension:pack script
- [x] Task 7: docs/privacy.md
- [x] Task 8: src/extension-extractor.ts + auto-extraction
- [x] Task 9: status tool extensionPath output
- [x] Task 10-12: README.md + AGENTS.md updates (versioning, install paths, config)
- [x] Task 13: Plan docs sync (PLAN.md, opendevbrowser-plan.md, IMPLEMENTATION_BLUEPRINT.md, RELEASE_PLAN.md)
- [x] Full validation: lint ✓, build ✓, test (170 pass) ✓, extension:build ✓, extension:pack ✓, npm pack ✓

### Now
All RELEASE_PLAN.md tasks complete. Ready for commit and publish.

### Next
1. Commit all changes with descriptive message covering release preparation
2. Push to remote and create PR (if desired)
3. Publish to npm: `npm publish`
4. Submit extension to Chrome Web Store using opendevbrowser-extension.zip
5. Enable GitHub Pages for docs/privacy.md hosting

## Open Questions
None - all tasks validated and complete.

## Working Set
- `package.json` - files array, scripts, jsonc-parser dep
- `src/config.ts` - jsonc-parser integration
- `src/extension-extractor.ts` - new file, auto-extraction
- `src/index.ts` - calls extractExtension on init
- `src/tools/status.ts` - extensionPath output
- `extension/manifest.json` - icons field
- `extension/icons/` - 16/32/48/128px PNGs
- `docs/assets/icon512.png` - Web Store icon
- `docs/privacy.md` - new file
- `README.md` - updated install/config docs
- `AGENTS.md` - updated plugin declaration pattern
- `vitest.config.ts` - extension-extractor exclusion
- `tests/tools.test.ts` - getExtensionPath null test
- `tests/config.test.ts` - JSONC edge case tests
