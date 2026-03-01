# OpenDevBrowser Surface Reference

Source-accurate inventory for CLI commands, plugin tools, relay channel commands, flags, and modes.
Status: active  
Last updated: 2026-02-24

This reference is intentionally exhaustive and should stay synchronized with:
- `src/cli/args.ts`
- `src/tools/index.ts`
- `extension/src/ops/ops-runtime.ts`
- `src/relay/protocol.ts`

Operational mirror:
- `npx opendevbrowser --help`
- `npx opendevbrowser help`

---

## CLI Command Inventory (55)

### Install and runtime management (10)
- `install`
- `update`
- `uninstall`
- `help`
- `version`
- `serve`
- `daemon`
- `native`
- `run`
- `artifacts`

### Session, connection, and workflow wrappers (9)
- `launch`
- `connect`
- `disconnect`
- `status`
- `cookie-import`
- `cookie-list`
- `research`
- `shopping`
- `product-video`

### Navigation (3)
- `goto`
- `wait`
- `snapshot`

### Interaction (9)
- `click`
- `hover`
- `press`
- `check`
- `uncheck`
- `type`
- `select`
- `scroll`
- `scroll-into-view`

### Targets and pages (7)
- `targets-list`
- `target-use`
- `target-new`
- `target-close`
- `page`
- `pages`
- `page-close`

### DOM inspection (7)
- `dom-html`
- `dom-text`
- `dom-attr`
- `dom-value`
- `dom-visible`
- `dom-enabled`
- `dom-checked`

### Export, diagnostics, macro, annotation, power (10)
- `clone-page`
- `clone-component`
- `perf`
- `screenshot`
- `console-poll`
- `network-poll`
- `debug-trace-snapshot`
- `macro-resolve`
- `annotate`
- `rpc` (CLI-only, internal power surface)

---

## Tool Inventory (48)

### Session and cookies (6)
- `opendevbrowser_launch`
- `opendevbrowser_connect`
- `opendevbrowser_disconnect`
- `opendevbrowser_status`
- `opendevbrowser_cookie_import`
- `opendevbrowser_cookie_list`

### Targets and pages (7)
- `opendevbrowser_targets_list`
- `opendevbrowser_target_use`
- `opendevbrowser_target_new`
- `opendevbrowser_target_close`
- `opendevbrowser_page`
- `opendevbrowser_list`
- `opendevbrowser_close`

### Navigation and interaction (13)
- `opendevbrowser_goto`
- `opendevbrowser_wait`
- `opendevbrowser_snapshot`
- `opendevbrowser_click`
- `opendevbrowser_hover`
- `opendevbrowser_press`
- `opendevbrowser_check`
- `opendevbrowser_uncheck`
- `opendevbrowser_type`
- `opendevbrowser_select`
- `opendevbrowser_scroll`
- `opendevbrowser_scroll_into_view`
- `opendevbrowser_run`

### DOM inspection (7)
- `opendevbrowser_dom_get_html`
- `opendevbrowser_dom_get_text`
- `opendevbrowser_get_attr`
- `opendevbrowser_get_value`
- `opendevbrowser_is_visible`
- `opendevbrowser_is_enabled`
- `opendevbrowser_is_checked`

### Diagnostics and export (8)
- `opendevbrowser_console_poll`
- `opendevbrowser_network_poll`
- `opendevbrowser_debug_trace_snapshot`
- `opendevbrowser_perf`
- `opendevbrowser_screenshot`
- `opendevbrowser_clone_page`
- `opendevbrowser_clone_component`
- `opendevbrowser_annotate`

### Macro, workflow, and skill surfaces (7)
- `opendevbrowser_macro_resolve`
- `opendevbrowser_research_run`
- `opendevbrowser_shopping_run`
- `opendevbrowser_product_video_run`
- `opendevbrowser_prompting_guide` (tool-only)
- `opendevbrowser_skill_list` (tool-only)
- `opendevbrowser_skill_load` (tool-only)

---

## Relay Channel Inventory

### `/ops` command names (38)

`/ops` is the high-level relay protocol used by default extension sessions.

#### Session (4)
- `session.launch`
- `session.connect`
- `session.disconnect`
- `session.status`

#### Storage (2)
- `storage.setCookies`
- `storage.getCookies`

#### Targets (4)
- `targets.list`
- `targets.use`
- `targets.new`
- `targets.close`

#### Pages (4)
- `page.open`
- `page.list`
- `page.close`
- `page.screenshot`

#### Navigation (3)
- `nav.goto`
- `nav.wait`
- `nav.snapshot`

#### Interaction (9)
- `interact.click`
- `interact.hover`
- `interact.press`
- `interact.check`
- `interact.uncheck`
- `interact.type`
- `interact.select`
- `interact.scroll`
- `interact.scrollIntoView`

#### DOM (7)
- `dom.getHtml`
- `dom.getText`
- `dom.getAttr`
- `dom.getValue`
- `dom.isVisible`
- `dom.isEnabled`
- `dom.isChecked`

#### Export (2)
- `export.clonePage`
- `export.cloneComponent`

#### DevTools (3)
- `devtools.perf`
- `devtools.consolePoll`
- `devtools.networkPoll`

Envelope contract:
- request: `ops_request` (`requestId`, `opsSessionId`, `leaseId`, `command`, `payload`)
- success: `ops_response`
- error: `ops_error`
- stream/event: `ops_event`, `ops_chunk`
- liveness: `ops_ping`, `ops_pong`

### `/cdp` channel contract (legacy)

`/cdp` relays low-level CDP messages and is explicitly opt-in (`--extension-legacy`).

Request envelope:
```json
{
  "id": 1,
  "method": "Runtime.evaluate",
  "params": { "expression": "document.title" },
  "sessionId": "optional-flat-session-id"
}
```

Response envelope:
```json
{
  "id": 1,
  "result": { "result": { "type": "string", "value": "Example" } },
  "sessionId": "optional-flat-session-id"
}
```

Event envelope:
```json
{
  "method": "forwardCDPEvent",
  "params": {
    "method": "Runtime.consoleAPICalled",
    "params": { "type": "log" },
    "sessionId": "optional-flat-session-id"
  }
}
```

Auth and policy:
- `/ops` and `/cdp` require `?token=<relayToken>` when pairing is enabled.
- `/ops` is multi-client by design.
- `/cdp` is legacy and is typically subject to binding/lease coordination in hub mode.
- Runtime concurrency key is `ExecutionKey = (sessionId,targetId)`.
- Same target commands are FIFO; different targets in one session can run in parallel up to the governor cap.
- Legacy `/cdp` remains sequential (`effectiveParallelCap=1`) for compatibility.
- Extension headless is unsupported and returns `unsupported_mode` when extension-intent launch/connect is requested with headless.
- Intentional parity exceptions must be listed in `docs/PARITY_DECLARED_DIVERGENCES.md`.

### Command taxonomy (contract)

- `TargetScoped`:
  - `nav.*`, `interact.*`, `dom.*`, `export.*`, `devtools.*`, `page.screenshot`
- `SessionStructural`:
  - `session.*`, `targets.*`, `page.open`, `page.list`, `page.close`, storage commands

---

## Mode and Flag Matrix

### Session modes
- `extension` (default when relay is available): launch/connect through `/ops`.
- `managed`: `launch --no-extension` (or explicit managed launch flags).
- `extension-legacy`: `launch --extension-legacy` or `connect --extension-legacy` through `/cdp`.
- `cdpConnect`: direct `connect --ws-endpoint ...` or `connect --host ... --cdp-port ...`.

### Key mode flags
- `--no-extension`
- `--extension-only`
- `--extension-legacy`
- `--wait-for-extension`
- `--wait-timeout-ms`

### Transport flags
- Global transport flag: `--transport relay|native` (status and transport-aware flows).
- Annotation transport flag: `annotate --transport auto|direct|relay`.
- Macro execute timeout flag: `macro-resolve --timeout-ms <ms>` extends daemon-call timeout for slow execute runs.

For complete argument and flag coverage by command, see `docs/CLI.md`.

---

## Verification Commands

```bash
npm run lint
npm run typecheck
npm run build
npm run test
npm run test -- tests/parity-matrix.test.ts
./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh
```
