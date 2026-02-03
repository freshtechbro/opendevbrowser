# Serve Native Auto-Install Plan

Add an auto-install check for the native messaging host when running `opendevbrowser serve`, installing it when missing if an extension ID is available.

---

## Overview

### Scope
- Add a config field for the native extension ID (optional).
- Reuse existing native install scripts via CLI helpers.
- Update `serve` to attempt install before daemon startup.
- Document the new behavior.

### Key decisions
- Auto-install runs when a valid extension ID is available via config or auto-detected from Chrome profiles; otherwise serve continues with a warning.
- Keep behavior non-blocking for daemon startup.

---

## Task 1 — Add config support for native extension ID

### Reasoning
The install scripts require an extension ID, so `serve` needs a stable source for this value.

### What to do
Add an optional `nativeExtensionId` field to the global config schema and type.

### How
1. Extend `OpenDevBrowserConfig` with `nativeExtensionId?: string`.
2. Add `nativeExtensionId` to the Zod schema as an optional string.
3. Optionally add a commented example in the default JSONC template.

### Files impacted
- `src/config.ts`

### End goal
Config can carry an extension ID without breaking existing installs.

### Acceptance criteria
- [ ] `nativeExtensionId` is optional and does not change defaults
- [ ] Existing config files load without changes

---

## Task 2 — Reuse native install helpers and update serve startup

### Reasoning
We should not duplicate native install logic, and `serve` should only attempt install when needed.

### What to do
Expose a helper in `native.ts` for installing the host and call it from `serve` when the host is missing.

### How
1. Add an exported `installNativeHost(extensionId)` helper that validates the ID and runs the install script.
2. Add a `discoverExtensionId()` helper that scans Chrome/Brave/Chromium profiles for the extension ID (path/name match).
3. In `runServe`, load config, check `getNativeStatusSnapshot()`, and if missing:
   - attempt install when `nativeExtensionId` is available or auto-detected
   - otherwise continue and include a warning in the serve output
3. Pass the loaded config into `startDaemon` to avoid double-loads.

### Files impacted
- `src/cli/commands/native.ts`
- `src/cli/commands/serve.ts`

### End goal
`serve` installs the native host when possible and continues startup regardless of outcome.

### Acceptance criteria
- [ ] `serve` attempts install only when not already installed
- [ ] `serve` does not fail if install is skipped or fails
- [ ] `native install` CLI behavior is unchanged

---

## Task 3 — Document serve auto-install behavior

### Reasoning
Users need to know how to set the extension ID and what `serve` does on startup.

### What to do
Update CLI documentation to mention the auto-install and config key.

### How
1. Update the `serve` section to mention the native host auto-install.
2. Update the native host notes to include `nativeExtensionId` usage.

### Files impacted
- `docs/CLI.md`

### End goal
Docs accurately reflect the new `serve` behavior.

### Acceptance criteria
- [ ] Docs mention `nativeExtensionId` and auto-install behavior

---

## File-by-file implementation sequence

1. `src/config.ts` — Task 1
2. `src/cli/commands/native.ts` — Task 2
3. `src/cli/commands/serve.ts` — Task 2
4. `docs/CLI.md` — Task 3

---

## Dependencies to add

None.

---

## Version history

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-02-02 | Initial plan |
