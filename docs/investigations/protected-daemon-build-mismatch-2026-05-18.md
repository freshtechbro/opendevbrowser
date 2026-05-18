# Investigation: Protected Daemon Build Mismatch

## Summary
Agents can hit an environment blocker when a running daemon on `127.0.0.1:8788` belongs to a different OpenDevBrowser build than the CLI or package currently being invoked. The investigation tests whether durable prevention should be instruction-only, CLI auto-remediation, or a combination.

## Symptoms
- Running a workflow through `npx opendevbrowser research run ...` can fail with: `Daemon on 127.0.0.1:8788 pid=42446 is protected by a different opendevbrowser build. Start with opendevbrowser serve.`
- Agents classify this as an environment blocker, but the recurring failure interrupts real workflow execution and makes OpenDevBrowser feel unreliable for build work.
- The user wants a future-proof way to tell agents what to do before they report the blocker or stop.

## Background / Prior Research
- Memory entry for a prior `inspiredesign` live run records the same error string and says the cause was an active daemon owned by a different OpenDevBrowser build. The recommended recovery was to run `opendevbrowser status --daemon`, identify which binary owns the daemon, and use the matching binary before assuming the workflow is broken.
- Memory entry for OpenCode verification says package updates can leave daemon fingerprint or native-host binding stale. The durable checks were daemon fingerprint status plus `opendevbrowser native status`, with native-host reinstall when the extension ID or package binding drifted.
- Memory entry for release verification says if `opendevbrowser launch` fails with the protected-daemon message, another protected daemon build is already running. If the daemon is not part of the task, use alternate proof paths; if it is part of the task, resolve the daemon/build relationship first.

## Investigator Findings

### 2026-05-18 source verification

- Guard confirmed: `scripts/postbuild-dist.mjs:56-86` hashes built `dist/**/*.js` files into `dist/daemon-fingerprint.json`, while `src/cli/daemon.ts:148-162` builds the current daemon fingerprint from that artifact or the local module hash. This means package/build drift intentionally changes the daemon identity.
- Runtime protection confirmed: `startDaemon()` stores the current fingerprint and returns it from `/status` at `src/cli/daemon.ts:260-296`; `/stop` compares `x-opendevbrowser-stop-fingerprint` with the running fingerprint and returns HTTP `409` on mismatch at `src/cli/daemon.ts:302-312`. `createDaemonStopHeaders()` sends the caller build fingerprint at `src/cli/daemon.ts:166-175`.
- Status preflight already exposes the correct signal: `fetchDaemonStatus()` adds `fingerprintCurrent` via `isCurrentDaemonFingerprint()` at `src/cli/daemon-status.ts:65-67` and persists refreshed daemon metadata at `src/cli/daemon-status.ts:190-207`; `status --daemon` renders `Daemon fingerprint: mismatch with current build` when false at `src/cli/commands/status.ts:58-70`. `tests/cli-status.test.ts:125-153` covers both the text and JSON data signal.
- Protected rejection is covered in multiple paths. Daemon-backed commands turn a 409 stop into `fingerprint_rejected` at `src/cli/daemon-client.ts:769-781`, then throw the protected-build error at `src/cli/daemon-client.ts:999-1003`. `serve` uses stronger remediation wording at `src/cli/commands/serve.ts:280-285` and refuses to kill the protected daemon in the tested 409 path at `tests/cli-serve.test.ts:552-561`. Hub mode also throws a protected-build error on 409 at `src/index.ts:191-199`, with tests in `tests/index-hooks.test.ts:384-398` and `tests/index-hooks.test.ts:461-481`.
- Wording is inconsistent. `serve` and `daemon uninstall` tell operators to run `opendevbrowser status --daemon` and restart from the current install at `src/cli/commands/serve.ts:280-285` and `src/cli/commands/daemon.ts:68-71`; daemon-backed commands still say only `Start with opendevbrowser serve` at `src/cli/daemon-client.ts:999-1003`; hub mode gives no `status --daemon` or current-install guidance at `src/index.ts:191-199`.
- Harnesses already show the safest standard preflight. `scripts/skill-runtime-probe-utils.mjs:47-62` requires `fingerprintCurrent === true` and classifies false as `daemon_fingerprint_mismatch`; `scripts/skill-runtime-probe-utils.mjs:123-155` creates isolated config/cache plus unique daemon/relay ports; `scripts/skill-runtime-probe-utils.mjs:285-314` stops a configured stale daemon before replacement and fails closed if stop is not successful. `tests/skill-runtime-probe-utils.test.ts:72-98` and `tests/skill-runtime-probe-utils.test.ts:156-191` cover these expectations.
- Provider harnesses apply the same policy: `ensureProviderDaemon()` reuses only a current daemon, stops configured stale daemons before starting a replacement, and starts a fresh configured daemon at `scripts/provider-direct-runs.mjs:408-437`; daemon preflight emits `infra.daemon_status` with `daemon_fingerprint_mismatch` and aborts unusable runs at `scripts/provider-direct-runs.mjs:439-453`. `tests/provider-direct-runs.test.ts:1000-1072` covers stale classification, abort, fresh restart, and fail-closed stop behavior.
- Live regression is more permissive than the skill/provider harnesses: `scripts/live-regression-direct.mjs:35-46` treats any status where `fingerprintCurrent !== false` as current and only labels explicit false as `daemon_fingerprint_mismatch`. Recommendation: either tighten this to `fingerprintCurrent === true` for release/agent runs or label missing fingerprints as a separate compatibility case.
- Durable guidance belongs in first-contact operational surfaces. Current README and CLI docs cover `serve`, `serve --stop`, stale cleanup, and config/cache isolation at `README.md:216-247`, `README.md:748-775`, and `docs/CLI.md:309-327`, but not the protected build mismatch sequence. Troubleshooting documents daemon status and shared-environment isolation at `docs/TROUBLESHOOTING.md:6-35` and `docs/TROUBLESHOOTING.md:154-169`, but not `fingerprintCurrent` remediation. The best-practices skill currently preflights extension readiness only at `skills/opendevbrowser-best-practices/SKILL.md:176-189`, and its workflow/templates check daemon status without requiring `fingerprintCurrent` at `skills/opendevbrowser-best-practices/scripts/odb-workflow.sh:215-229` and `skills/opendevbrowser-best-practices/assets/templates/mode-flag-matrix.json:15-25`.
- Documentation update locations are clear: root `AGENTS.md:88-103` points agents to CLI/daemon, docs policy requires implementation-backed docs and relevant AGENTS sync at `docs/AGENTS.md:9-28`, and docs sync points include `docs/CLI.md`, `README.md`, and relevant `AGENTS.md` files at `docs/AGENTS.md:30-38`.

### Recommended standard daemon preflight

1. Before daemon-backed workflows, run `opendevbrowser status --daemon --output-format json` with the same binary/install intended for the workflow.
2. Proceed only when `data.fingerprintCurrent === true`; for extension workflows also require `data.relay.extensionConnected === true` and `data.relay.extensionHandshakeComplete === true`.
3. If `fingerprintCurrent === false`, do not classify the provider/workflow as broken. Use the matching binary that started the daemon, or stop/restart from the current install with `opendevbrowser serve --stop` then `opendevbrowser serve`.
4. If stop is rejected as protected, do not force-kill by default. Use the matching install, or isolate the run with temporary `OPENCODE_CONFIG_DIR`, `OPENCODE_CACHE_DIR`, and unique daemon/relay ports as shown by `createTempHarness()`.
5. Check `opendevbrowser native status` only for extension/native-host binding drift. It is adjacent remediation, not the primary fix for daemon fingerprint mismatch.

### Product and docs recommendations

- Add a shared protected-mismatch message builder used by `daemon-client`, `serve`, `daemon uninstall`, and hub `ensureHub()` so all paths mention `status --daemon --output-format json`, `data.fingerprintCurrent`, matching binary/current install, and config/cache/port isolation.
- Add a stable structured error detail such as `daemon_fingerprint_mismatch` for JSON/automation surfaces that currently only expose message text.
- Add the standard preflight to `docs/TROUBLESHOOTING.md`, `docs/CLI.md`, `README.md`, root `AGENTS.md`, and `skills/opendevbrowser-best-practices/SKILL.md`; update workflow templates so daemon status expectations include `fingerprintCurrent: true`.
- Align `scripts/live-regression-direct.mjs` with the stricter `skill-runtime-probe-utils` and provider direct preflight policy, or explicitly document why missing `fingerprintCurrent` remains acceptable there.

## Investigation Log

### Phase 1 - Initial Assessment
**Hypothesis:** The error is not a workflow or provider failure; it is a daemon build-fingerprint guard intended to stop one package build from controlling another build's protected daemon.
**Findings:** Prior memory supports the hypothesis, but current source evidence is needed for the guard location, status reporting surface, and agent guidance points.
**Evidence:** Memory references in `MEMORY.md` around protected daemon mismatch, OpenCode verification, and daemon autostart/update.
**Conclusion:** Confirmed enough to guide codebase investigation, but source line evidence remains required.

## Root Cause
The error is an intentional daemon ownership guard, not a provider, research, or browser-mode failure.

OpenDevBrowser fingerprints the active build from built `dist/**/*.js` output through `dist/daemon-fingerprint.json`. The running daemon exposes that fingerprint through `/status`. When another CLI build tries to stop or reuse the daemon, the caller sends its own build fingerprint through `x-opendevbrowser-stop-fingerprint`; `/stop` rejects the request with HTTP `409` when the fingerprints differ.

The recurring blocker happens because agents run daemon-backed workflows with a CLI/package build that does not match the daemon already listening on `127.0.0.1:8788`. The guard correctly prevents one build from killing another build's protected daemon, but current agent-facing recovery guidance is inconsistent across CLI entrypoints, hub mode, docs, and skills.

## Recommendations
1. Add a standard agent preflight before daemon-backed workflows: `opendevbrowser status --daemon --output-format json` with the same binary/install that will run the workflow. Proceed only when `data.fingerprintCurrent === true`.
2. If `data.fingerprintCurrent === false`, do not classify the provider or workflow as broken. Try normal recovery with `opendevbrowser serve --stop`, then `opendevbrowser serve`, then rerun status.
3. If stop is rejected as protected, do not force-kill by default. Use the matching binary/install that started the daemon, or isolate the run with separate `OPENCODE_CONFIG_DIR`, `OPENCODE_CACHE_DIR`, daemon port, relay port, and tokens.
4. Unify protected mismatch wording in `src/cli/daemon-client.ts`, `src/cli/commands/serve.ts`, `src/cli/commands/daemon.ts`, and hub `ensureHub()` so all paths mention `status --daemon --output-format json`, `data.fingerprintCurrent`, matching binary/current install, and config/cache/port isolation.
5. Add a structured automation reason such as `daemon_fingerprint_mismatch` for JSON and agent surfaces instead of forcing agents to parse message text.
6. Update `status --daemon` text so a mismatch includes direct recovery guidance.
7. Align harness policy around the stricter existing pattern in `skill-runtime-probe-utils` and provider direct runs: require `fingerprintCurrent === true`, classify false as `daemon_fingerprint_mismatch`, and fail closed if stale daemon replacement cannot be confirmed.
8. Add a protected-daemon runbook to `docs/TROUBLESHOOTING.md`, `docs/CLI.md`, `README.md`, root `AGENTS.md`, and `skills/opendevbrowser-best-practices/SKILL.md`; update best-practices workflow templates so daemon status expectations include `fingerprintCurrent: true`.

## Preventive Measures
- Tell future agents to preflight daemon state before `research`, `shopping`, `inspiredesign`, `canvas`, `launch`, extension mode, and release/live-regression workflows.
- Require `data.fingerprintCurrent === true` as the reusable agent gate for daemon-backed work.
- Keep native-host checks separate: `opendevbrowser native status` is for extension/native binding drift, not the primary fix for daemon fingerprint mismatch.
- Prefer matching binary/current install or isolated config/cache/ports over force-killing a protected daemon.
- Treat protected mismatch as infrastructure classification, not research evidence or provider evidence.
- Implement product-level consistency so agents get the same remediation path from daemon-client, serve, hub mode, docs, and skills. Instruction-only is not sufficient because agents currently encounter divergent messages depending on entrypoint.
