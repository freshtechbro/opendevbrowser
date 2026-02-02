## Continuity Ledger

### Goal (incl. success criteria)
Implement `docs/OPS_WS_GAP_FIX_PLAN.md` end-to-end with all tests passing and coverage >=97%.

### Constraints/Assumptions
- Follow AGENTS.md: no stubs/placeholders, DRY, remove dead code, prefer `rg`, no destructive git.
- Only main agent edits `CONTINUITY.md`; sub-agents append to `sub_continuity.md`.
- Approval policy is `never`; run tests locally without prompts.
- Must use RepoPrompt for repo context; use Exa + Context7 for relevant external context.

### Key Decisions
- Use per-session `leaseId` for Ops requests and daemon authorization.
- Align Ops snapshot logic between extension and core via shared builders.
- Use visible-only screenshot fallback on CDP failure with warning propagation.
- Add targeted ops-client tests to lift branch coverage above 97%.

### State
- **Done**:
  - Added `leaseId` to ops protocol; ops-client reconnect/heartbeat + handshake error handling; ops-runtime lease TTL/reclaim + snapshot size cap + visible-only screenshot fallback; shared ops snapshot builder; daemon lease state helpers.
  - Updated ops tests (lease propagation + screenshot warning), ops-client heartbeat/reconnect coverage, and annotate tool relay success coverage.
  - Documented local-only tools in `docs/CLI.md`.
  - Fixed regex parse error in `extension/src/ops/ops-runtime.ts`.
  - `npm test` passes with coverage: lines 99.76%, branches 97.05%, functions 99.17%, statements 99.43%.
  - User approved committing all changes with message "add ops parity/E2E coverage (daemon + relay)".
- **Now**: Stage all changes and commit using the approved message (Conventional Commits format).
- **Next**:
  - Summarize changes for user and note tests already passing.
  - Optionally revisit remaining ops parity/E2E test ideas if user requests follow-up.

### Open Questions (UNCONFIRMED if needed)
- None.

### Working Set (files/ids/commands)
- `docs/OPS_WS_GAP_FIX_PLAN.md`
- `docs/CLI.md`
- `src/browser/ops-client.ts`
- `src/browser/ops-browser-manager.ts`
- `extension/src/ops/ops-runtime.ts`
- `src/cli/daemon-commands.ts`
- `src/cli/daemon-state.ts`
- `tests/ops-client.test.ts`
- `tests/ops-browser-manager.test.ts`
- `tests/tools-annotate.test.ts`
- `npm test`
