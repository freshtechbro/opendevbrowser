Goal (incl. success criteria):
- Update docs/README/AGENTS/architecture for Relay Hub + multi-tab flat-session routing (Chrome 125+), then validate with full test coverage and commit+push.

Constraints/Assumptions:
- Extension mode only (MV3) with Chrome 125+ baseline.
- Flat sessions only; route via DebuggerSession sessionId; avoid Target.sendMessageToTarget.
- Top-level discovery only; auto-attach child targets recursively.
- No local relay fallback when hub mode is enabled.
- Keep docs accurate and consistent with implemented hub-only behavior.

Key decisions:
- Keep deletions for `INVESTIGATION_REPORT.md`, `docs/REFACTORING_PLAN.md`, and `docs/RELAY_HUB_DAEMON_PLAN.md` as requested.
- Marked all acceptance criteria in `docs/MULTI_TAB_SESSION_MAPPING_PLAN.md` as complete to align with implementation status.

State:
  - Done:
    - Updated README with hub/flat-session features, requirements, and daemon config fields.
    - Updated docs/ARCHITECTURE with hub daemon, FIFO leases, flat-session routing, and status/source-of-truth notes.
    - Updated docs/CLI config example with daemonPort/daemonToken.
    - Updated docs/EXTENSION and docs/TROUBLESHOOTING for hub-only + Chrome 125+ guidance.
    - Marked plan docs as implemented with dates and checked all acceptance items.
    - Updated all AGENTS.md files to reflect relay hub + flat-session architecture changes.
    - Consistency scan for Chrome 125+ mentions completed.
    - Ran `npm run lint`, `npm run build`, and `npm run test` (coverage: 97.01% branch).
  - Now:
    - Stage changes (including deletions) and commit, then push.
  - Next:
    - `git add -A` (include deletions).
    - `git commit` with a conventional message.
    - `git push` to the configured remote.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/CLI.md`
- `docs/EXTENSION.md`
- `docs/TROUBLESHOOTING.md`
- `docs/RELAY_MULTI_CLIENT_PLAN.md`
- `docs/MULTI_TAB_SESSION_MAPPING_PLAN.md`
- `AGENTS.md`
- `src/AGENTS.md`
- `src/tools/AGENTS.md`
- `extension/AGENTS.md`
- `tests/AGENTS.md`
- `skills/AGENTS.md`
- Commands: `rg -n "Chrome 125" ...`, `npm run lint`, `npm run build`, `npm run test`, `git add -A`, `git commit`, `git push`
