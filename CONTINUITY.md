# Continuity Ledger

## Goal
Implement all 7 remediation tasks from `docs/REMEDIATION_PLAN.md` to align the codebase with planned architecture, security requirements, and OpenCode plugin guidelines.

**Success criteria**: All gaps closed, build/lint/tests pass, docs updated.

## Constraints/Assumptions
- Config: global file only (`~/.config/opencode/opendevbrowser.jsonc`)
- Export: sanitized HTML (not JSON→TSX)
- OpenCode schema: no plugin-specific keys in `opencode.json`
- `@latest` tag for auto-updates

## Key Decisions
1. Config reads from plugin-owned file, not OpenCode config object
2. CDP endpoint validation uses URL.hostname allowlist (not substring)
3. Export sanitization uses regex (works in Node + browser)
4. Devtools redact sensitive query params and token-like strings
5. Refs prefer stable selectors (data-testid, aria-label) and filter to main frame

## State

### Done
- [x] Task 5: Fixed empty catch block in `src/snapshot/snapshotter.ts`
- [x] Task 2: Secured CDP endpoint validation in `src/browser/browser-manager.ts` + tests
- [x] Task 1: Plugin-owned global config in `src/config.ts`, `src/index.ts` + tests
- [x] Task 4: Redacted secrets in `src/devtools/network-tracker.ts`, `src/devtools/console-tracker.ts` + tests
- [x] Task 3: Safe-by-default export in `src/export/dom-capture.ts`, `src/export/react-emitter.ts` + tests
- [x] Task 6: Improved ref stability in `src/snapshot/snapshotter.ts`
- [x] Task 7: Updated `docs/ARCHITECTURE_COMPARISON.md`, `AGENTS.md`, `README.md`

### Now
All implementation tasks complete. Ready for review/commit.

### Next
1. Review all changes for consistency
2. Commit grouped by task similarity
3. Create PR with summary referencing `docs/REMEDIATION_PLAN.md`
4. Publish release to npm

## Open Questions
None - all resolved.

## Working Set
- `docs/ARCHITECTURE_GAPS_REPORT.md` - created
- `docs/REMEDIATION_PLAN.md` - created
- `src/config.ts` - refactored for file-based config
- `src/index.ts` - removed config hook
- `src/browser/browser-manager.ts` - secure CDP validation
- `src/snapshot/snapshotter.ts` - empty catch fix + ref stability
- `src/devtools/network-tracker.ts` - URL redaction
- `src/devtools/console-tracker.ts` - text redaction
- `src/export/dom-capture.ts` - HTML sanitization
- `src/export/react-emitter.ts` - uses sanitized HTML
- `docs/ARCHITECTURE_COMPARISON.md` - updated gaps section
- `AGENTS.md` - added installation playbook + security defaults
- `README.md` - updated config/install instructions
- `tests/*.test.ts` - updated for new signatures
