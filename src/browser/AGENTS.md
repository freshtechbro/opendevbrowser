# Local AGENTS.md (src/browser)

Applies to `src/browser/`. Extends `src/AGENTS.md` and root `AGENTS.md`.

## Local Architecture
- `BrowserManager` owns Playwright lifecycle, `TargetManager` routing, and page listener cleanup.
- Config gates devtools verbosity, snapshot limits, and unsafe export before delegating to modules.
- Endpoint validation normalizes hostname case and re-validates /json/version responses.

## Responsibilities
- Manage Playwright session lifecycle and target routing in `BrowserManager`.
- Coordinate snapshots, refs, and user actions (click/type/select/scroll).
- Validate all CDP endpoints (wsEndpoint, /json/version responses) against localhost allowlist.

## Safety & Constraints
- Enforce localhost-only CDP endpoints and config-controlled overrides.
- Normalize hostname to lowercase before validation (prevents LOCALHOST bypass).
- Re-validate webSocketDebuggerUrl from /json/version before use (prevents injection).
- Clean up temporary profiles; avoid persisting data unless configured.

## Testing
- Add/adjust Vitest coverage for lifecycle and action paths in `tests/`.

## Folder Structure
```
src/browser/
```
