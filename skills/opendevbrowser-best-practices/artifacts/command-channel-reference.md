# Command and Channel Reference

## Purpose

Compact operational map of the current OpenDevBrowser surfaces, with the `/canvas` handshake and blocker paths called out explicitly for preflight audits.

## Current coverage snapshot

- CLI commands: `56`
- Plugin tools: `49`
- `/ops` command names: `38`
- `/canvas` command names: `26`
- Legacy `/cdp` relay: generic CDP forwarding (method-level)

Canonical exhaustive reference: `docs/SURFACE_REFERENCE.md`.
CLI help mirror: `npx opendevbrowser --help` and `npx opendevbrowser help` (identical inventories).

## Agent skill-sync coverage

Skill-pack installation and discovery are synchronized for:
- `opencode`: `~/.config/opencode/skill` and `./.opencode/skill`
- `codex`: `$CODEX_HOME/skills` (fallback `~/.codex/skills`) and `./.codex/skills`
- `claudecode`: `$CLAUDECODE_HOME/skills` or `$CLAUDE_HOME/skills` (fallback `~/.claude/skills`) and `./.claude/skills`
- `ampcli`: `$AMPCLI_HOME/skills` or `$AMP_CLI_HOME/skills` or `$AMP_HOME/skills` (fallback `~/.amp/skills`) and `./.amp/skills`

Legacy aliases `claude` and `amp` remain present in installer target metadata for compatibility.

## CLI surface categories

- Install/runtime: `install`, `update`, `uninstall`, `help`, `version`, `serve`, `daemon`, `native`, `run`, `artifacts`
- Session/connection/workflow: `launch`, `connect`, `disconnect`, `status`, `cookie-import`, `cookie-list`, `research`, `shopping`, `product-video`
- Navigation/interaction: `goto`, `wait`, `snapshot`, `click`, `hover`, `press`, `check`, `uncheck`, `type`, `select`, `scroll`, `scroll-into-view`
- Targets/pages/DOM: `targets-list`, `target-use`, `target-new`, `target-close`, `page`, `pages`, `page-close`, `dom-html`, `dom-text`, `dom-attr`, `dom-value`, `dom-visible`, `dom-enabled`, `dom-checked`
- Design canvas: `canvas`
- Export/diagnostics/power: `clone-page`, `clone-component`, `perf`, `screenshot`, `console-poll`, `network-poll`, `debug-trace-snapshot`, `macro-resolve`, `annotate`, `rpc`

## Tool surface categories

- Runtime parity tools map to the CLI runtime categories, including `opendevbrowser_canvas`.
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

Envelope types:
- `ops_hello`, `ops_hello_ack`
- `ops_ping`, `ops_pong`
- `ops_request`, `ops_response`, `ops_error`
- `ops_event`, `ops_chunk`

Concurrency policy:
- `/ops` supports multiple clients and multiple sessions.
- Reliable parallel execution is session-scoped (`session-per-worker`).
- Avoid concurrent independent streams that switch targets inside one session.

### `/canvas`

Core command families:
- Session and governance: `canvas.session.open`, `canvas.session.attach`, `canvas.session.status`, `canvas.session.close`, `canvas.capabilities.get`, `canvas.plan.set`, `canvas.plan.get`
- Document: `canvas.document.load`, `canvas.document.patch`, `canvas.document.save`, `canvas.document.export`
- Live targets and overlay: `canvas.tab.open`, `canvas.tab.close`, `canvas.overlay.mount`, `canvas.overlay.unmount`, `canvas.overlay.select`
- Preview and feedback: `canvas.preview.render`, `canvas.preview.refresh`, `canvas.feedback.poll`, `canvas.feedback.subscribe`
- Code sync: `canvas.code.bind`, `canvas.code.unbind`, `canvas.code.pull`, `canvas.code.push`, `canvas.code.status`, `canvas.code.resolve`

Extension runtime subset:
- `canvas.tab.open`, `canvas.tab.close`, `canvas.tab.sync`
- `canvas.overlay.mount`, `canvas.overlay.unmount`, `canvas.overlay.select`, `canvas.overlay.sync`

Envelope types:
- `canvas_request`, `canvas_response`, `canvas_error`
- `canvas_event`, `canvas_chunk`
- `canvas_ping`, `canvas_pong`

Minimum handshake payload shape:

```json
{
  "canvasSessionId": "canvas_session_01",
  "browserSessionId": "browser_session_01",
  "documentId": "dc_01",
  "leaseId": "lease_01",
  "preflightState": "handshake_read",
  "attachModes": ["observer", "lease_reclaim"],
  "governanceRequirements": {
    "requiredBeforeMutation": ["intent", "generationPlan", "designLanguage"],
    "requiredBeforeSave": ["intent", "generationPlan", "runtimeBudgets"]
  },
  "generationPlanRequirements": {
    "requiredBeforeMutation": ["targetOutcome", "visualDirection", "layoutStrategy"]
  },
  "allowedLibraries": {
    "components": ["shadcn"],
    "icons": ["lucide"],
    "styling": ["tailwindcss"]
  },
  "mutationPolicy": {
    "planRequiredBeforePatch": true,
    "allowedBeforePlan": [
      "canvas.capabilities.get",
      "canvas.plan.get",
      "canvas.plan.set",
      "canvas.document.load",
      "canvas.session.attach",
      "canvas.session.status"
    ]
  }
}
```

Preflight state machine:
- `handshake_read`
- `plan_submitted`
- `plan_accepted`
- `patching_enabled`

The first mutation path must stay blocked until `canvas.plan.set` has been accepted. The canonical blocker is `plan_required` and should carry `details.auditId: "CANVAS-01"`.

Recommended blocker envelope:

```json
{
  "code": "plan_required",
  "blockingCommand": "canvas.document.patch",
  "requiredNextCommands": ["canvas.plan.set"],
  "message": "generationPlan must be accepted before mutation.",
  "details": { "auditId": "CANVAS-01" }
}
```

Feedback contract markers:
- Poll categories: `render`, `console`, `network`, `validation`, `performance`, `asset`, `export`, `code-sync`, `parity`
- Feedback items must preserve `documentId`, `pageId`, `prototypeId`, `targetId`, `documentRevision`, `severity`, `class`, and `evidenceRefs`
- Subscribe event types: `feedback.item`, `feedback.heartbeat`, `feedback.complete`

Current operational constraints:
- `canvas.feedback.subscribe` returns the initial payload on every public surface. For ongoing events:
  - CLI: use `opendevbrowser canvas --command canvas.feedback.subscribe --output-format stream-json`
  - tool/daemon loops: reuse the returned cursor with repeated `canvas.feedback.poll`
- `canvas.tab.sync` and `canvas.overlay.sync` are internal extension runtime helpers only.
- `canvas_html` remains the default preview/export contract; `bound_app_runtime` is valid only when the binding explicitly opts in and runtime preflight succeeds.
- Library metadata is preserved, but rendered output is still semantic rather than package-faithful.
- Popup and canvas both ship per-item and combined annotation `Copy` / `Send` actions. Today, `Send` stores the payload for later `annotate --stored` retrieval rather than proactively delivering it into the active agent chat.

Operational rule:
- Read `canvas.session.open` or `canvas.capabilities.get` before mutation.
- Use `canvas.feedback.poll` after each patch/render loop.
- Do not save if `governanceRequirements.requiredBeforeSave` still reports missing governance blocks.

### `/cdp` (legacy)

- Opt-in via `--extension-legacy`.
- Forwards raw CDP command envelopes (`id`, `method`, `params`, optional `sessionId`).
- Use for compatibility-specific paths only.
- Treat as a legacy single-writer route, not the primary concurrent path.

## Mode and flag checkpoints

- Managed: `launch --no-extension`
- Extension default: `launch` or relay-normalized `connect`
- Extension legacy: `launch --extension-legacy` or `connect --extension-legacy`
- Direct CDP: `connect --ws-endpoint ...` or `connect --host ... --cdp-port ...`

Required readiness/status checks:
- `extensionConnected`
- `extensionHandshakeComplete`
- `opsConnected`
- `canvasConnected`
- `cdpConnected`
- `pairingRequired`

## Fast verification commands

```bash
npm run test -- tests/parity-matrix.test.ts
./skills/opendevbrowser-best-practices/scripts/odb-workflow.sh canvas-preflight
./skills/opendevbrowser-best-practices/scripts/odb-workflow.sh canvas-feedback-eval
./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh
```
