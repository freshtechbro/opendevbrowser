# Parity Gates

## Purpose

Define hard pass/fail gates so CLI, tool, and runtime surfaces stay aligned.

## Parity Matrix

| Area | Modes | Surfaces | Gate |
|---|---|---|---|
| Session lifecycle | managed, extension, cdpConnect | CLI + tools + runtime | `launch/connect/disconnect/status` parity |
| Navigation + refs loop | managed, extension, cdpConnect | CLI + tools + runtime | `goto/wait/snapshot` parity |
| Interaction | managed, extension, cdpConnect | CLI + tools + runtime | click/type/select/scroll/press/check/uncheck parity |
| Targets + pages | managed, extension, cdpConnect | CLI + tools + runtime | target/page command parity |
| DOM + diagnostics + export | managed, extension, cdpConnect | CLI + tools + runtime | dom/perf/screenshot/console/network/clone parity |

## Surface Rules

- `rpc` is intentionally CLI-only (internal and unsafe).
- `opendevbrowser_prompting_guide`, `opendevbrowser_skill_list`, and `opendevbrowser_skill_load` are intentionally tool-only.
- Any new stable CLI runtime command must add a matching tool unless explicitly documented as CLI-only.

## Gate Commands

```bash
npm run test -- tests/parity-matrix.test.ts
npm run test -- tests/tools.test.ts tests/daemon-command.test.ts
npm run test -- tests/providers-performance-gate.test.ts
```

## Release Requirement

Ship only when parity tests pass and docs (`README.md`, `docs/CLI.md`, `docs/ARCHITECTURE.md`) reflect the same surface map.
Use `docs/RELEASE_PARITY_CHECKLIST.md` as the release gate source of truth.
