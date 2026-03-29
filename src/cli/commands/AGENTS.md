# src/cli/commands/ — Agent Guidelines

CLI command handlers. Extends `src/cli/AGENTS.md`.

## Overview

Owns the per-command handler layer for the 61-command CLI surface. These files should stay thin: parse command-local args, call the appropriate manager/runtime helper, and return `CommandResult` for shared output formatting.

## Structure

```text
src/cli/commands/
├── session/      # launch, connect, disconnect, status, cookie-* wrappers
├── nav/          # goto, wait, snapshot, review
├── interact/     # click/hover/press/check/type/select/scroll/pointer*
├── targets/      # list/use/new/close
├── pages/        # open/list/close named pages
├── dom/          # html/text/attr/value/visible/enabled/checked
├── devtools/     # perf/screenshot/console-poll/network-poll/debug-trace-snapshot
├── export/       # clone-page, clone-component
├── annotate.ts   # annotation transport wrapper
├── canvas.ts     # typed design-canvas command wrapper
├── research.ts   # research workflow command
├── shopping.ts   # shopping workflow command
├── product-video.ts # product presentation workflow command
├── artifacts.ts  # artifact lifecycle commands
├── macro-resolve.ts # macro resolution/execute wrapper
├── serve.ts / daemon.ts / native.ts / rpc.ts
└── registry.ts / types.ts
```

## Rules

- Register commands only through `src/cli/index.ts` plus `registry.ts`.
- Return `CommandResult`; shared output and fatal-error shaping live above this layer.
- Reuse shared helpers for pointer, session, and output behavior instead of duplicating transport logic.
- Keep command categories aligned with `src/cli/help.ts`, `src/cli/args.ts`, `docs/CLI.md`, and `docs/SURFACE_REFERENCE.md`.

## Anti-Patterns

| Never | Why |
|-------|-----|
| Reimplement output formatting in a command handler | Shared JSON/text formatting lives in `src/cli/output.ts` |
| Bypass daemon-aware helpers for runtime commands | Command behavior must match hub/local execution paths |
| Scatter command registration outside `src/cli/index.ts` | Help parity and inventory drift become harder to verify |
| Duplicate pointer/session parsing logic across files | Use shared helpers like `pointer-shared.ts` and existing arg parsing |
