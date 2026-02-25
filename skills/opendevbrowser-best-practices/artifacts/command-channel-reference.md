# Command and Channel Reference

## Purpose

Provide a compact, operationally useful map of OpenDevBrowser command surfaces and relay channels for parity checks.

## Current coverage snapshot

- CLI commands: `55`
- Plugin tools: `48`
- `/ops` command names: `38`
- Legacy `/cdp` relay: generic CDP forwarding (method-level)

Canonical exhaustive reference: `docs/SURFACE_REFERENCE.md`.
CLI help mirror: `npx opendevbrowser --help` (surfaces CLI + tools + `/ops` + `/cdp` controls).

## Agent skill-sync coverage

Skill-pack installation/discovery is synchronized for:
- `opencode`: `~/.config/opencode/skill` and `./.opencode/skill`
- `codex`: `$CODEX_HOME/skills` (fallback `~/.codex/skills`) and `./.codex/skills`
- `claudecode`: `$CLAUDECODE_HOME/skills` or `$CLAUDE_HOME/skills` (fallback `~/.claude/skills`) and `./.claude/skills`
- `ampcli`: `$AMPCLI_HOME/skills` or `$AMP_CLI_HOME/skills` or `$AMP_HOME/skills` (fallback `~/.amp/skills`) and `./.amp/skills`

Legacy aliases `claude` and `amp` remain present in installer target metadata for compatibility.

## CLI surface categories

- Install/runtime: install, update, uninstall, help, version, serve, daemon, native, run
- Session/connection: launch, connect, disconnect, status, cookie-import, cookie-list
- Navigation: goto, wait, snapshot
- Interaction: click, hover, press, check, uncheck, type, select, scroll, scroll-into-view
- Targets/pages: targets-list, target-use, target-new, target-close, page, pages, page-close
- DOM: dom-html, dom-text, dom-attr, dom-value, dom-visible, dom-enabled, dom-checked
- Export/diagnostics/macro/annotation/power: clone-page, clone-component, perf, screenshot, console-poll, network-poll, debug-trace-snapshot, macro-resolve, annotate, rpc

## Tool surface categories

- Runtime parity tools map to the CLI runtime categories.
- Tool-only: `opendevbrowser_prompting_guide`, `opendevbrowser_skill_list`, `opendevbrowser_skill_load`.
- CLI-only: `rpc`.

## Relay channels

### `/ops` (default)

Namespace groups:
- `session.*`
- `storage.*`
- `targets.*`
- `page.*`
- `nav.*`
- `interact.*`
- `dom.*`
- `export.*`
- `devtools.*`

Handshake/liveness envelope types:
- `ops_hello`, `ops_hello_ack`
- `ops_ping`, `ops_pong`
- `ops_request`, `ops_response`, `ops_error`
- `ops_event`, `ops_chunk`

Concurrency policy:
- `/ops` supports multiple clients and multiple sessions.
- Reliable parallel execution is session-scoped (`session-per-worker`).
- Avoid concurrent independent streams that switch targets inside one session (`targets.use` races can cross-wire active target state).

### `/cdp` (legacy)

- Opt-in via `--extension-legacy`.
- Forwards raw CDP commands through relay command envelopes (`id`, `method`, `params`, optional `sessionId`).
- Use for compatibility-specific paths only.
- Treat as a legacy/single-writer path; do not use as the primary route for concurrent automation.

## Mode and flag checkpoints

- Managed: `launch --no-extension`
- Extension default: `launch` or relay-normalized `connect`
- Extension legacy: `launch --extension-legacy` or `connect --extension-legacy`
- Direct CDP: `connect --ws-endpoint ...` or `connect --host ... --cdp-port ...`

Required readiness/status checks:
- `extensionConnected`
- `extensionHandshakeComplete`
- `opsConnected`
- `cdpConnected`
- `pairingRequired`

## Fast verification commands

```bash
npm run test -- tests/parity-matrix.test.ts
./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh
```
