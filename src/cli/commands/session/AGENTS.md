# src/cli/commands/session/ - Agent Guidelines

Session, cookie, and inspector command handlers. Extends `src/cli/commands/AGENTS.md`.

## Overview

Owns CLI command handlers for launch/connect/disconnect/status, cookie import/list, and session-inspector plan/audit/report flows.

## Structure

```text
src/cli/commands/session/
├── launch.ts             # Session launch flags and auth intent parsing
├── connect.ts            # CDP connect flags
├── disconnect.ts         # Session cleanup
├── status.ts             # Session status output
├── cookie-import.ts      # Cookie file parsing and import command
├── cookie-list.ts        # Cookie listing and URL filtering
├── inspector.ts          # Session inspector command
├── inspector-plan.ts     # Inspector plan output
├── inspector-audit.ts    # Inspector audit output
└── inspector-shared.ts   # Shared inspector args and sequence parsing
```

## Rules

- Keep handlers thin: parse args, call daemon/runtime helpers, return `CommandResult`.
- Launch mode flags must preserve root semantics for `extension`, `managed`, and `cdpConnect`.
- Google auth intent parsing belongs at the command boundary, then delegates to core auth helpers.
- Cookie commands may do file IO, but validation and URL normalization must stay explicit and strict-mode behavior must be preserved.
- Inspector commands share sequence fields through `inspector-shared.ts`; do not fork `sinceConsoleSeq`, `sinceNetworkSeq`, or `sinceExceptionSeq` parsing.
- Cross-imports from `../nav/review-shared` are allowed only for the inspector/review report contract.

## Anti-Patterns

| Never | Why |
|-------|-----|
| Duplicate launch/session flag parsing in sibling commands | Flag semantics drift quickly |
| Put inspector commands under `devtools/` | Files and ownership live in `session/` |
| Parse cookie records as loose objects | Cookie import is a boundary and must validate |
