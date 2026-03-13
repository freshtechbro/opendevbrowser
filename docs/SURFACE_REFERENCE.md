# OpenDevBrowser Surface Reference

Source-accurate inventory for CLI commands, plugin tools, relay channel commands, flags, and modes.
Status: active  
Last updated: 2026-03-12

This reference is intentionally exhaustive and should stay synchronized with:
- `src/cli/args.ts`
- `src/tools/index.ts`
- `extension/src/ops/ops-runtime.ts`
- `extension/src/canvas/canvas-runtime.ts`
- `src/relay/protocol.ts`

Operational mirror:
- `npx opendevbrowser --help`
- `npx opendevbrowser help`

---

## CLI Command Inventory (56)

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

### Design canvas (1)
- `canvas`

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

## Tool Inventory (49)

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

### Design canvas (1)
- `opendevbrowser_canvas`

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

### `/canvas` command names (26)

`/canvas` is the typed design-canvas relay protocol used by `opendevbrowser_canvas` and the `canvas` CLI command. Canonical document mutations execute in core; extension runtime support is used for the extension-hosted `canvas.html` infinite-canvas editor, converged design-tab state sync, and overlay commands.

#### Session and governance (7)
- `canvas.session.open`
- `canvas.session.attach`
- `canvas.session.status`
- `canvas.session.close`
- `canvas.capabilities.get`
- `canvas.plan.set`
- `canvas.plan.get`

#### Document (4)
- `canvas.document.load`
- `canvas.document.patch`
- `canvas.document.save`
- `canvas.document.export`

#### Live targets and overlay (5)
- `canvas.tab.open`
- `canvas.tab.close`
- `canvas.overlay.mount`
- `canvas.overlay.unmount`
- `canvas.overlay.select`

#### Preview and feedback (4)
- `canvas.preview.render`
- `canvas.preview.refresh`
- `canvas.feedback.poll`
- `canvas.feedback.subscribe`

#### Code sync (6)
- `canvas.code.bind`
- `canvas.code.unbind`
- `canvas.code.pull`
- `canvas.code.push`
- `canvas.code.status`
- `canvas.code.resolve`

Extension runtime subset (internal relay helpers, not public agent commands):
- `canvas.tab.open`
- `canvas.tab.close`
- `canvas.tab.sync`
- `canvas.overlay.mount`
- `canvas.overlay.unmount`
- `canvas.overlay.select`
- `canvas.overlay.sync`

Behavior notes:
- `canvas.session.open` creates a session and lease; `canvas.session.attach` joins an existing session as an `observer` or reclaims the write lease with `attachMode=lease_reclaim`.
- `canvas.document.patch` supports governance completion through `governance.update` patch batches in addition to scene/node operations.
- Accepted `canvas.document.patch` batches now auto-refresh every active preview target so browser verification stays in the same edit loop as the design tab.
- `canvas.document.save` and `canvas.document.export` can fail with `policy_violation` when `requiredBeforeSave` governance blocks are still missing.
- Extension-hosted design tabs persist full same-origin editor state in `IndexedDB`, rebroadcast converged state over `BroadcastChannel`, and forward editor-originated patch requests through `canvas_event` payloads.
- `canvas.tab.open` is the public command; internal `canvas.tab.sync` keeps extension-hosted design tabs on the same core-rendered HTML materialization path after public mutations.
- `canvas.code.*` manages TSX-first bindings (`adapter=tsx-react-v1`) with repo-local manifests under `.opendevbrowser/canvas/code-sync/<documentId>/<bindingId>.json`.
- `canvas.preview.render` and `canvas.preview.refresh` default to projected `canvas_html`, but bindings that opt into `projection=bound_app_runtime` attempt in-place runtime reconciliation before falling back to canonical HTML projection.
- `canvas.feedback.subscribe` returns the initial filtered batch publicly. The underlying manager also creates a live async stream (`feedback.item`, `feedback.heartbeat`, `feedback.complete`); the CLI now exposes that through a `stream-json` polling bridge, while the tool wrapper still returns only the initial payload.
- `canvas.session.status` and `canvas.code.status` surface attached clients, active lease holder, watch state, drift/conflict state, projection mode, fallback reasons, and parity artifacts.

Envelope contract:
- request: `canvas_request` (`requestId`, `canvasSessionId`, `leaseId`, `command`, `payload`)
- success: `canvas_response`
- error: `canvas_error`
- stream/event: `canvas_event`, `canvas_chunk`
- liveness: `canvas_ping`, `canvas_pong`

Canvas event types:
- `canvas_session_created`
- `canvas_session_closed`
- `canvas_session_expired`
- `canvas_target_closed`
- `canvas_document_snapshot`
- `canvas_document_update`
- `canvas_presence`
- `canvas_lease_changed`
- `canvas_feedback_item`
- `canvas_patch_requested`
- `canvas_code_sync_started`
- `canvas_code_sync_applied`
- `canvas_code_sync_conflict`
- `canvas_code_sync_failed`
- `canvas_client_disconnected`

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
- `/ops`, `/canvas`, and `/cdp` require `?token=<relayToken>` when pairing is enabled.
- `/ops` is multi-client by design.
- `/canvas` exposes typed design-session envelopes and reports relay usage via `canvasConnected`.
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
- Canvas wrapper flags: `canvas --command <canvas.*> --params|--params-file [--timeout-ms]`.
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
