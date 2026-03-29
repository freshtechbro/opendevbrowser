# Popup Attach Probe Investigation

## Objective

Instrument the focused-popup extension-mode direct-launch failure so `[cdp_attach_failed] ... Not allowed` can be classified as exactly one of these seams:

- `root_attach`: `chrome.debugger.attach({ tabId })` failed before flat-session bootstrap
- `flat_session_bootstrap`: root attach succeeded, then flat-session setup failed during `Target.setAutoAttach`

This probe is limited to:

- `extension/src/services/CDPRouter.ts`
- `extension/src/ops/ops-runtime.ts`
- closest tests

## Evidence Matrix

| Signal | Meaning | Owning seam |
| --- | --- | --- |
| `ops.direct_attach_stage` with `origin: "root_attach"` | Chrome rejected direct root attach itself | `CDPRouter.attachRootDebuggee()` |
| `ops.direct_attach_stage` with `origin: "flat_session_bootstrap"` | Root attach succeeded, but flat-session bootstrap failed | `CDPRouter.attachRootDebuggeeWithFallback()` / `ensureFlatSessionSupport()` |
| `ops.popup_attach_stage` with `stage: ...` | Popup child adoption failed after launch already succeeded | existing popup attach flow in `OpsRuntime.attachTargetViaOpenerSession()` |

Current direct-attach diagnostic payload fields:

- `origin`
- `stage`
- `attachBy`
- `probeMethod` when the failure is bootstrap-side
- `reason`

## Non-Goals

- No provider fallback changes
- No `/ops` versus `/cdp` route-classifier work
- No transport swap or transport rewrite in this probe
- No popup ownership redesign beyond diagnostics
- No broad troubleshooting or product-doc rewrite

## Live Rerun Instructions

1. Build the current extension bundle:

```bash
npm run extension:build
```

2. Rebuild the repo code used by the CLI and daemon:

```bash
npm run build
```

3. Restart the daemon:

```bash
node dist/cli/index.js serve --stop --output-format json
node dist/cli/index.js serve --output-format json
```

4. Reload the unpacked extension in Chrome from `chrome://extensions/?id=jmhlfninmadkljgnahjnaleonjdncaml`.

5. Verify extension handshake is back:

```bash
node dist/cli/index.js status --output-format json
```

6. Focus the popup tab directly in Chrome, then run a fresh extension-only launch probe:

```bash
node dist/cli/index.js launch --extension-only --output-format json
```

7. Interpret the result:

- `cdp_attach_failed` message suffix `origin: root_attach` means Chrome blocked `chrome.debugger.attach({ tabId })` itself.
- `cdp_attach_failed` message suffix `origin: flat_session_bootstrap` means root attach worked and the failure happened later during flat-session setup.
- If direct launch succeeds but popup adoption still fails later, switch back to `ops.popup_attach_stage` and inspect the popup child stage instead.

## Replacement-Track Trigger

Open the replacement track only after one fresh rerun records a direct-attach stage conclusively:

- `root_attach` means extension-mode same-tab root attach is the blocker.
- `flat_session_bootstrap` means the blocker is still local to flat-session bootstrap and can be reasoned about without guessing.
