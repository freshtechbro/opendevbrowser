# Tool + CLI Coverage Expansion Plan

Expand OpenDevBrowser tool and CLI coverage with high-value element actions and state queries, aligned with competitor baselines (agent-browser) and current architecture.

---

## Overview

### Scope
- Add element interaction and state/query capabilities missing from current tool/CLI surface.
- Keep implementation within existing manager/daemon/tool architecture.
- Provide tests and docs updates to maintain coverage targets and clarity.

### Key decisions
- Add a focused set of new actions: hover, press, check/uncheck, scroll-into-view, get attr/value, is-visible/enabled/checked.
- Keep tools thin; implement logic in BrowserManager and route through daemon.

---

## Task 1 — Extend BrowserManager capabilities

### Reasoning
New tools/CLI commands must reuse the same manager layer for lifecycle consistency and ref resolution.

### What to do
Add BrowserManager methods for the new actions and queries.

### How
1. Implement manager methods: `hover`, `press`, `check`, `uncheck`, `scrollIntoView`, `getAttr`, `getValue`, `isVisible`, `isEnabled`, `isChecked`.
2. Use ref-based selector resolution and mutex locking for interactive actions.
3. Return minimal, structured results (timingMs for actions; booleans/values for queries).

### Files impacted
- `src/browser/browser-manager.ts`
- `src/browser/manager-types.ts`

### End goal
BrowserManager exposes the new action/query surface for both tools and CLI.

### Acceptance criteria
- [ ] All new manager methods resolve refs and execute with Playwright primitives.
- [ ] Interactive methods use session mutex for stability.
- [ ] Query methods return deterministic values without side effects.

---

## Task 2 — Wire daemon + remote manager

### Reasoning
CLI and tool calls must route through the daemon and remote manager to keep parity across modes.

### What to do
Add daemon command handlers and RemoteManager methods for the new actions.

### How
1. Add new cases in `src/cli/daemon-commands.ts` for each action.
2. Extend `src/cli/remote-manager.ts` with matching client calls.
3. Update typing to include new BrowserManagerLike methods.

### Files impacted
- `src/cli/daemon-commands.ts`
- `src/cli/remote-manager.ts`
- `src/browser/manager-types.ts`

### End goal
All new actions are callable through daemon and remote manager.

### Acceptance criteria
- [ ] Daemon handles each new action without throwing "Unknown command".
- [ ] RemoteManager methods match BrowserManager signatures.

---

## Task 3 — Add tools for new actions

### Reasoning
opendevbrowser_* tools are the primary surface for AI agents; missing actions reduce automation coverage.

### What to do
Add tool wrappers for each new action and register them.

### How
1. Create tool files for each action in `src/tools/`.
2. Register new tools in `src/tools/index.ts`.
3. Update tool tests to include the new tools.

### Files impacted
- `src/tools/*.ts` (new files)
- `src/tools/index.ts`
- `tests/tools.test.ts`

### End goal
New tools are exposed and covered by tests.

### Acceptance criteria
- [ ] Tools validate inputs with Zod and return ok/failure responses.
- [ ] `tests/tools.test.ts` includes all new tools.

---

## Task 4 — Add CLI commands for new actions

### Reasoning
CLI parity ensures smoke testing and scripted workflows can access the same capabilities.

### What to do
Add CLI commands and argument parsing for each new action.

### How
1. Add new command handlers under `src/cli/commands/`.
2. Register commands in `src/cli/index.ts`.
3. Update `src/cli/args.ts` with new commands and flags.
4. Extend CLI smoke test script to cover new commands.

### Files impacted
- `src/cli/commands/**/*` (new files)
- `src/cli/index.ts`
- `src/cli/args.ts`
- `scripts/cli-smoke-test.mjs`

### End goal
CLI supports the same new actions as tools and passes smoke tests.

### Acceptance criteria
- [ ] CLI commands parse flags correctly and call daemon.
- [ ] Smoke test runs new commands without failures.

---

## Task 5 — Documentation + AGENTS updates

### Reasoning
Docs must reflect the new surface area and updated workflows.

### What to do
Update CLI docs, tool list references, and AGENTS guidance.

### How
1. Update `docs/CLI.md` with new commands and flags.
2. Update `README.md` and tool count references.
3. Update `AGENTS.md` files to reflect new workflow/testing commands.

### Files impacted
- `docs/CLI.md`
- `README.md`
- `AGENTS.md`
- `src/AGENTS.md`
- `src/tools/AGENTS.md`
- `extension/AGENTS.md`
- `tests/AGENTS.md`
- `skills/AGENTS.md`

### End goal
Documentation and agent guidance stay in sync with implementation.

### Acceptance criteria
- [ ] Docs list all new commands/tools accurately.
- [ ] AGENTS mention the CLI smoke test and coverage expectations.

---

## File-by-file implementation sequence

1. `src/browser/browser-manager.ts` — Task 1
2. `src/browser/manager-types.ts` — Task 1/2
3. `src/cli/daemon-commands.ts` — Task 2
4. `src/cli/remote-manager.ts` — Task 2
5. `src/tools/*.ts` + `src/tools/index.ts` — Task 3
6. `src/cli/commands/**/*` + `src/cli/index.ts` + `src/cli/args.ts` — Task 4
7. `tests/tools.test.ts` + `scripts/cli-smoke-test.mjs` — Task 3/4
8. Docs + AGENTS — Task 5

---

## Dependencies to add

| Package | Version | Purpose |
|---------|---------|---------|
| (none) | - | Use existing Playwright APIs |

---

## Version history

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-01-19 | Initial plan for tool/CLI expansion |
