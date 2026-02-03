## Continuity Ledger

### Goal (incl. success criteria)
Fix `/ops` screenshot timeout and legacy `/cdp` instability, keep tests at >=97% branch coverage, run lint/build/typecheck, then commit all changes.

### Constraints/Assumptions
- Follow AGENTS.md: no stubs/placeholders, DRY, remove dead code, prefer `rg`, no destructive git.
- Only main agent edits `CONTINUITY.md`; sub-agents append to `sub_continuity.md`.
- Approval policy is `never`; run checks locally without prompts.
- Use the daemon started by the user (do not start our own daemon).
- Must use RepoPrompt for repo context before starting work.

### Key Decisions
- Add timeout + fallback around ops screenshot capture to avoid hanging CDP requests.
- Add extension readiness gating + detached-frame retry in navigation, plus timeout guard in target listing.

### State
- **Done**:
  - Implemented ops screenshot CDP timeout + fallback in `extension/src/ops/ops-runtime.ts`.
  - Added extension ready gating + detached-frame retry + unstable URL handling in `src/browser/browser-manager.ts`.
  - Added timeout guard for title/url + target sync helper in `src/browser/target-manager.ts`.
  - Added extension fallbacks for stale tab ids and HTTP tab selection in `extension/src/services/*`.
  - Added tests to close branch coverage gaps; `npm run test` passes with 97% branch coverage.
  - `npm run lint`, `npm run build`, and `npx tsc -p tsconfig.json --noEmit` all pass.
  - Committed all changes (4 commits: fix/test/docs/chore).
- **Now**:
  - Ready to re-validate `/ops` + legacy `/cdp` via user daemon if needed.
- **Next**:
  - Run live `/ops` + legacy `/cdp` checks against the user-started daemon and report remaining runtime issues.

### Open Questions (UNCONFIRMED if needed)
- None.

### Working Set (files/ids/commands)
- `extension/src/ops/ops-runtime.ts`
- `extension/src/services/{ConnectionManager,CDPRouter,TabManager}.ts`
- `src/browser/browser-manager.ts`
- `src/browser/target-manager.ts`
- `tests/browser-manager.test.ts`
- `tests/target-manager.test.ts`
- `npm run test`, `npm run lint`, `npm run build`, `npx tsc -p tsconfig.json --noEmit`

### Key learnings
- Ops screenshot path now succeeds; ops session disconnect still times out in live test.
- Legacy `/cdp` still hits frame-detached errors in live test despite retry logic.
