# Code Review Fixes Plan

Fixes for code review findings related to file operations and error handling.

---

## Overview

### Scope
- Windows file lock resilience in browser profile cleanup
- Sync vs async file I/O consistency
- Silent error suppression improvements

### Key decisions
- Use Node.js built-in `maxRetries`/`retryDelay` options for `rm()` - no new dependencies
- Keep `extension-extractor.ts` synchronous (remove misleading `async`) since it runs once at startup
- Add `console.warn()` for silent failures to aid debugging

---

## Task 1 — Add retry options to rm() calls in browser-manager.ts

### Reasoning
Windows often has "file busy" (EBUSY) errors when deleting browser profile directories because the browser process hasn't fully released file locks despite `context.close()` being called. Node.js `fs/promises.rm` has built-in retry support.

### What to do
Add `maxRetries` and `retryDelay` options to both `rm()` calls in browser-manager.ts.

### How
1. Locate the two `rm()` calls:
   - Line 166: Error cleanup during failed launch
   - Line 210: Profile cleanup during disconnect
2. Add options: `{ recursive: true, force: true, maxRetries: 5, retryDelay: 100 }`
3. These options handle EBUSY, EMFILE, ENFILE, ENOTEMPTY, EPERM with linear backoff

### Files impacted
- `src/browser/browser-manager.ts`

### End goal
Browser profile cleanup succeeds on Windows even when files are briefly locked.

### Acceptance criteria
- [ ] Both `rm()` calls include `maxRetries: 5, retryDelay: 100`
- [ ] Existing tests pass
- [ ] No new dependencies added

---

## Task 2 — Remove async keyword from extractExtension()

### Reasoning
The function is marked `async` but performs only synchronous file I/O (`mkdirSync`, `cpSync`, `writeFileSync`, `rmSync`, `renameSync`). This is misleading - it returns a Promise but blocks the event loop. Since this runs once at plugin startup, blocking is acceptable, but the async keyword is deceptive.

### What to do
Remove the `async` keyword and update the return type.

### How
1. Change `export async function extractExtension(): Promise<string | null>` to `export function extractExtension(): string | null`
2. Remove any unnecessary `await` if present (none expected in current code)
3. Update any callers to not await (check `src/tools/status.ts` and tests)

### Files impacted
- `src/extension-extractor.ts`
- `src/tools/status.ts` (if it awaits extractExtension)
- `tests/extension-extractor.test.ts`

### End goal
Function signature accurately reflects blocking behavior.

### Acceptance criteria
- [ ] Function is synchronous (no `async` keyword)
- [ ] Return type is `string | null` (not `Promise<string | null>`)
- [ ] All callers updated to not use `await`
- [ ] All tests pass

---

## Task 3 — Add warning logs for silent error suppression

### Reasoning
Completely silencing errors with `void error` makes debugging permission issues difficult. Users should see warnings on stderr when extraction logic fails silently.

### What to do
Replace `void error` patterns with `console.warn()` calls that provide context.

### How
1. In `getPackageVersion()` (line 18-21): Log warning about package.json read failure
2. In `getInstalledVersion()` (line 30-33): Log warning about version file read failure
3. In catch blocks (lines 110-111, 118-119, 126-127): Log warnings for rollback/cleanup failures
4. Use format: `console.warn("[opendevbrowser] <context>:", error)` for consistency

### Files impacted
- `src/extension-extractor.ts`

### End goal
Users can diagnose extraction failures from stderr output.

### Acceptance criteria
- [ ] All `void error` patterns replaced with `console.warn()`
- [ ] All empty catch blocks have warning logs
- [ ] Warning messages include enough context to debug
- [ ] Lint and tests pass

---

## Task 4 — Update tests for new behavior

### Reasoning
Tests should verify the new retry behavior and warning output patterns.

### What to do
Add/update tests to cover retry behavior and warning output.

### How
1. For browser-manager: Verify rm is called with retry options (mock inspection)
2. For extension-extractor: 
   - Update async test calls to sync
   - Optionally spy on console.warn to verify warnings are logged on failure

### Files impacted
- `tests/browser-manager.test.ts`
- `tests/extension-extractor.test.ts`

### End goal
Test coverage validates the fixes.

### Acceptance criteria
- [ ] Tests verify retry options in rm() calls
- [ ] Tests verify extractExtension is synchronous
- [ ] Tests verify console.warn is called on failures
- [ ] 95%+ coverage maintained

---

## File-by-file implementation sequence

1. `src/browser/browser-manager.ts` — Task 1
2. `src/extension-extractor.ts` — Tasks 2, 3
3. `src/tools/status.ts` — Task 2 (if caller update needed)
4. `tests/browser-manager.test.ts` — Task 4
5. `tests/extension-extractor.test.ts` — Task 4

---

## Dependencies to add

None required - all fixes use Node.js built-in functionality.

---

## Version history

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-12-29 | Initial plan from code review validation |
