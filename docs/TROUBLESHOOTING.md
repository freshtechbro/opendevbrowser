# Troubleshooting

Status: active  
Last updated: 2026-04-06

## Hub daemon status

If the extension or tools fail to connect, confirm the hub daemon is running:

- Start the daemon: `npx opendevbrowser serve`
- Stop the daemon: `npx opendevbrowser serve --stop`
- `serve` auto-cleans stale daemon processes by default; check `staleDaemonsCleared` in JSON output when diagnosing collisions.

The daemon `/status` response includes:
- `hub.instanceId` – hub daemon identifier
- `relay.instanceId` – relay server identifier
- `binding` – current binding owner + expiry
The daemon port/token are persisted in `opendevbrowser.jsonc` as `daemonPort`/`daemonToken` to recover from stale cache metadata.

### Relay status quick read

`npx opendevbrowser status --daemon` includes a legend for:
- `extensionConnected` – popup websocket connected
- `extensionHandshakeComplete` – extension handshake finished
- `opsConnected` – any `/ops` client attached (presence only; not a guarantee that the current extension target is ops-owned)
- `canvasConnected` – any `/canvas` client attached (expected **false** unless design-canvas preview or overlay flows are active)
- `cdpConnected` – any `/cdp` client attached (legacy path, expected **false** unless `--extension-legacy` is used)
- `annotationConnected` – annotation websocket attached (expected **false** unless annotate relay transport is active)
- `pairingRequired` – relay token required for `/ops`, `/canvas`, `/annotation`, and `/cdp`
- `health.reason` – relay health summary (`ok`, `extension_disconnected`, `handshake_incomplete`, etc.)

If `opsConnected` stays `false` after extension-mode `launch`/`connect`, restart the daemon and reconnect the extension.
If `canvasConnected` stays `false` during `opendevbrowser canvas` preview/overlay work, confirm the extension is connected and retry the canvas command after `status --daemon`.
`cdpConnected` remaining `false` is normal for default `/ops` sessions.

## Desktop observation returns `desktop_unsupported` on macOS

If `desktop-status` or another `desktop-*` command reports `reason=desktop_unsupported` on macOS:

1. Confirm the same shell that starts `npx opendevbrowser serve` can resolve `swift`:
   `swift --version`
2. If `swift` is missing, install Xcode or a Swift toolchain, then restart the daemon.
3. Retry `npx opendevbrowser desktop-status --output-format json`.

The shipped desktop runtime uses `swift -e` for availability, window, and accessibility probes, and the built-in `screencapture` utility for image capture.

### Canvas inventory vs starter commands

Built-in design kits still ship through the inventory surface, and starter commands now compose those same inventory and token paths instead of using a second store.

- Use `npx opendevbrowser canvas --command canvas.inventory.list --params '{"canvasSessionId":"<canvas-session-id>"}' --output-format json` to confirm the merged inventory surface.
- Document-promoted items and built-in kit catalog entries can both be inserted with `canvas.inventory.insert`.
- Use `npx opendevbrowser canvas --command canvas.starter.list --params '{"canvasSessionId":"<canvas-session-id>"}' --output-format json` to inspect the eight shipped built-in starters and their kit linkage.
- Use `canvas.starter.apply` when you want OpenDevBrowser to seed a starter shell, merge starter tokens, and install required kit inventory into the live document. If the requested framework or adapter is unsupported, the command still succeeds with `degraded=true` and a typed reason such as `framework_unavailable:<id>`.

### Canvas history and extension-stage annotation

- `canvas.history.undo` and `canvas.history.redo` require both an accepted generation plan and the active `leaseId`.
- Before the first accepted-plan mutation, both commands return `reason=history_empty`; this is expected.
- If history suddenly clears after an out-of-band mutation, inspect canvas feedback for `history_invalidated`; the recorded stack was reset because the document revision drifted outside the stored preimage.
- Extension design-tab history clicks emit the internal `canvas_history_requested` event, but operator-facing recovery still happens through public `canvas.history.undo` and `canvas.history.redo`.
- Freeform region annotation is only available inside the extension-hosted `canvas.html` stage. Existing page overlays still use `canvas.overlay.*` selection instead of remote freeform capture.

### Canvas framework adapters and local plugins

`canvas.code.status` is the quickest adapter audit surface. It now reports:

- `frameworkAdapterId`, `frameworkId`, and `sourceFamily`
- `declaredCapabilities`, `grantedCapabilities`, and `capabilityDenials`
- deterministic `reasonCode` values such as `framework_migrated`, `manifest_migrated`, `plugin_not_found`, and `plugin_load_failed`

Quick checks:

- React TSX, static HTML, custom elements, Vue SFC, and Svelte SFC are the built-in framework lanes currently covered by named fixtures.
- Legacy `tsx-react-v1` manifests and bindings migrate at load time to `builtin:react-tsx-v2`.
- Repo-local BYO plugins are discovered from workspace `package.json`, `.opendevbrowser/canvas/adapters.json`, and explicit local config declarations only.
- Package declarations that resolve outside the active worktree are rejected with `trust_denied`.
- Broken plugin entrypoints or malformed manifests surface deterministic load errors instead of silently disappearing.

## Annotation send fallback and shared inbox

Popup, canvas, and in-page annotation `Send` actions now attempt shared inbox delivery through `/annotation` before they fall back to local storage.
The extension background owns the `annotation:sendPayload` bridge, posts `store_agent_payload`, and the relay resolves the shared path through `AgentInbox` before falling back to local storage.

Quick checks:

1. If the UI says `Delivered to agent`, the payload was scoped to the active chat session for the current worktree.
2. If the UI says `Stored only; fetch with annotate --stored`, retrieve it explicitly:
   - `npx opendevbrowser annotate --session-id <session-id> --stored`
3. If `--stored` returns the sanitized payload without screenshots, add `--include-screenshots` only when you want to prefer the extension-local in-memory fallback copy.
4. Shared inbox files live under `.opendevbrowser/annotate/`; inspect `agent-inbox.jsonl` only for local debugging, not as a public API contract.

Common reasons for stored-only receipts:

- `no_active_scope` — no current chat scope was registered for the worktree.
- `ambiguous_scope` — more than one active chat scope exists for the same worktree.
- Relay enqueue failed — the extension could still keep the payload available via the local stored fallback path.

## Popup annotation start failures

If the extension popup says `Annotation UI did not load in the page. Reload the tab and retry.`:

1. Focus the intended http(s) tab once. The popup now prefers the active web tab and otherwise falls back to the last annotatable web tab it observed, not `canvas.html` or another extension page.
   It also restores that last annotatable web tab after an MV3 service-worker restart, so a fresh popup open does not have to guess from unrelated recent tabs.
2. Reload the target page and retry `Annotate`.
3. If you rebuilt the unpacked extension locally, reload the extension in Chrome before retrying so the current background and annotation content-script bundles are active.

If relay `annotate --transport relay` still reaches a normal timeout on that same tab, the annotation UI loaded and is waiting for selection; the popup error then points to stale extension code or popup-time tab resolution rather than a broken page-side annotation runtime.

## Temp-profile unpacked extension harnesses appear inert

If you launch a separate browser process with flags such as `--disable-extensions-except` and `--load-extension`, but the unpacked extension never appears:

1. Do not trust the result if the browser binary is Google Chrome stable.
2. Chrome stable can log `--disable-extensions-except is not allowed in Google Chrome, ignoring.` and silently skip the isolated unpacked-extension harness.
3. Use Chromium or Chrome for Testing for isolated extension automation, or reload the already-installed unpacked extension in your real Chrome profile and reconnect it to the relay.

This only affects startup-flag-driven temp-profile harnesses. It does not change the supported real-profile unpacked-extension flow described elsewhere in the docs.

## Canvas design-tab stale-runtime failures

If live `/canvas` design-tab commands fail with:

`[restricted_url] Cannot access contents of url "chrome-extension://.../canvas.html". Extension manifest must request permission to access this host.`

then Chrome is still serving stale unpacked-extension runtime code.

1. Run `npm run extension:build` if you have not rebuilt since the latest source changes.
2. Reload the unpacked extension in Chrome from `chrome://extensions`.
3. Reconnect the extension to the relay, then retry the `/canvas` command sequence.

If the same command succeeds after reload, treat the earlier `restricted_url` result as stale-runtime drift, not as a source regression in the current repo.

## Legacy `/cdp` attach blocked by `/ops`

If `launch --extension-legacy` or another legacy relay `/cdp` flow fails with:

`cdp_attach_blocked: target is owned by an ops session`

then the relay is already serving that extension target through `/ops`.

1. Disconnect the active `/ops` browser session, or restart the daemon if the old lease is stale.
2. Use `npx opendevbrowser status --daemon --output-format json` as a quick hint only:
   `opsConnected=false` is sufficient, but `opsConnected=true` can still be compatible when the attached `/ops` client owns a different target.
3. Retry the legacy `/cdp` command. If it still returns `cdp_attach_blocked`, the requested extension target is still owned by `/ops`; disconnect that session or recycle the daemon and retry.

This is expected exclusivity between the concurrent `/ops` channel and the compatibility-only legacy `/cdp` channel; it is not a daemon crash condition anymore.

## First-run daemon collisions in shared environments

If onboarding tests run on a machine that already has OpenDevBrowser active, isolate config/cache before starting daemon tests:

```bash
export OPENCODE_CONFIG_DIR=/tmp/opendevbrowser-first-run-isolated/config
export OPENCODE_CACHE_DIR=/tmp/opendevbrowser-first-run-isolated/cache
mkdir -p "$OPENCODE_CONFIG_DIR" "$OPENCODE_CACHE_DIR"
```

Then start and verify in that same shell context:

```bash
npx opendevbrowser serve --output-format json
npx opendevbrowser status --daemon --output-format json
```

Without isolation, existing daemon metadata can cause session/token/port collisions and misleading `Unknown sessionId` errors.

## Managed or CDP session is missing expected login cookies

If a headed or headless managed session, or a direct `cdpConnect` session, does not appear logged in:

1. Check what the session actually has:
   `npx opendevbrowser cookie-list --session-id <session-id> --output-format json`
2. Remember the mode boundary:
   - `extension` mode reuses the cookies already present in the live tab or profile you attached to.
   - `managed` and direct `cdpConnect` sessions attempt automatic Chrome-family cookie bootstrap from the discovered system profile before first navigation.
3. If the target site has no cookie in the source Chrome-family profile, nothing will be imported. This commonly explains site-by-site mismatches more often than a runtime regression.
4. Use `cookie-import` only when you intentionally need to add or override cookies after session creation; it is the explicit additive lane, not the automatic bootstrap path.

## Provider anti-bot and transcript failures

When provider workflows degrade, check normalized reason codes first:

- `rate_limited` — upstream pacing/cooldown pressure.
- `challenge_detected` — anti-bot challenge surface detected.
- `token_required` — provider API/session token is required.
- `auth_required` — authenticated browser/session state is required (including strict cookie policy failures).
- `ip_blocked` — upstream hard block.
- `transcript_unavailable` or `caption_missing` — transcript extraction path failed.
- `env_limited` — fallback capability is unavailable in the current environment.

### Cookie policy quick triage

Provider workflows support cookie controls with defaults from `providers.cookiePolicy` and `providers.cookieSource`.

1. For no-auth runs (for example, deal hunting), disable cookie work:
   - CLI: `--use-cookies=false` or `--cookie-policy off`
2. Default mode is `auto`:
   - injects only when cookies are available
   - continues if cookie source is missing/invalid/empty
3. Strict mode is `required`:
   - fails fast with `reasonCode=auth_required` when cookie load/injection/verification fails
4. Inspect diagnostics in:
   - workflow metrics: `meta.metrics.cookie_diagnostics`/`meta.metrics.cookieDiagnostics`
   - failure details: `error.details.cookieDiagnostics`
5. Common strict failure causes:
   - cookie source missing (`Cookie file not found ...`, missing env var)
   - cookies loaded but injection imported `0`
   - cookies injected but verification count is `0`

Where to inspect:

- Workflow outputs: `meta.primaryConstraintSummary`, `meta.metrics.reasonCodeDistribution` for research/shopping, `meta.reasonCodeDistribution` for product-video, and `meta.metrics.transcript_strategy_failures`/`meta.metrics.transcriptStrategyFailures`.
- Strategy-detail workflow diagnostics: `meta.metrics.transcript_strategy_detail_failures`/`meta.metrics.transcriptStrategyDetailFailures` and `meta.metrics.transcript_strategy_detail_distribution`/`meta.metrics.transcriptStrategyDetailDistribution`.
- Workflow health dimensions: `meta.metrics.transcriptDurability` (or `meta.metrics.transcript_durability`) and `meta.metrics.antiBotPressure` (or `meta.metrics.anti_bot_pressure`).
- Provider failure entries: `error.reasonCode`.
- YouTube record metadata: `transcript_strategy` (legacy bucket), `transcript_strategy_detail` (exact strategy), `attempt_chain`, and failure `reasonCode`.

Transcript controls checklist:

1. Default behavior is public-first (`enableYtdlpAudioAsr=true`, `enableApify=true`, `enableBrowserFallback=false`).
2. Mode precedence is `filters.youtube_mode > providers.transcript.modeDefault > auto`; no new CLI mode flag is added in this phase.
3. Keep the progressive resolver chain enabled for non-forced modes: `youtubei -> native_caption_parse -> ytdlp_audio_asr -> apify`.
4. Enable Apify only when all are true:
   - `providers.transcript.enableApify`
   - `providers.transcript.apifyActorId` is configured
   - `APIFY_TOKEN` is present
   - legal checklist approval includes `apify`
5. Forced modes (`yt-dlp`, `apify`) fail fast when disabled or misconfigured; they do not bypass config/legal gates.
6. In non-forced modes, disabled strategies are skipped with attempt diagnostics.
7. Enable browser fallback only when all are true:
   - `providers.transcript.enableBrowserFallback`
   - `providers.antiBotPolicy.allowBrowserEscalation`
8. If browser fallback is enabled, use an isolated automation profile instead of a daily logged-in Google profile.
9. If `env_limited` appears for browser fallback, disable browser fallback and continue with deterministic resolver strategies.

Strategy-specific quick checks:

1. `transcript_strategy_detail=youtubei` failures:
   - confirm watch-page bootstrap includes `INNERTUBE_API_KEY`, `INNERTUBE_CONTEXT`, transcript params
2. `transcript_strategy_detail=native_caption_parse` failures:
   - `caption_missing`: no eligible caption tracks (`no-auto` excludes auto-generated tracks)
   - `transcript_unavailable`: caption endpoint returned empty/invalid payload
3. `transcript_strategy_detail=ytdlp_audio_asr` failures:
   - ensure `providers.transcript.enableYtdlpAudioAsr=true`
   - confirm `yt-dlp` binary exists and ASR provider is configured
4. `transcript_strategy_detail=apify` failures:
   - ensure `providers.transcript.enableApify=true`
   - confirm `APIFY_TOKEN` and legal approval for `apify`
5. `transcript_strategy_detail=browser_assisted` failures:
   - verify browser escalation policy and fallback enablement settings
   - rerun in an isolated automation profile before treating the failure as a resolver regression

### Shopping region trust quick check

1. Treat `--region` as advisory unless `meta.selection.region_authoritative=true`.
2. Inspect `meta.selection.region_support` and `meta.alerts` for `reasonCode=region_unenforced`.
3. If `meta.primaryConstraintSummary` says the requested region was not enforced or that offers were filtered by the currency heuristic, do not present the run as a trustworthy regional comparison.

Reliability promotion and rollback criteria:

1. Promote only when `meta.metrics.transcriptDurability.attempted >= 10` and `meta.metrics.transcriptDurability.success_rate >= 0.85`.
2. Promote only when `meta.metrics.antiBotPressure.anti_bot_failure_ratio <= 0.15`.
3. Trigger remediation if either threshold fails in two consecutive windows.
4. Keep reliability checks tied to `tests/providers-performance-gate.test.ts` so the criteria remain enforceable in CI.

## Macro resolve slow-run timeout

If `macro-resolve --execute` fails due to daemon-side timeout during slow provider workflows, extend the client-side call timeout:

```bash
npx opendevbrowser macro-resolve \
  --expression '@media.search("youtube transcript parity", "youtube", 5)' \
  --execute \
  --timeout-ms 120000 \
  --output-format json
```

Quick checks:

1. Start from `--timeout-ms 120000` for slow transcript/media pipelines and tune upward only when needed.
2. Confirm the timeout is actually passed by using `--output-format json` and checking that execution completed (not transport timeout).
3. Use `npx opendevbrowser --help` to verify current macro/timeout flag inventory in your installed CLI.

## Verify OpenCode is loading local plugin updates

When validating local fixes in OpenCode, verify both plugin registration and resolved local path:

- Check OpenCode config:
  - `cat ~/.config/opencode/opencode.json`
- Confirm runtime-loaded plugin paths:
  - `opencode debug config`
- Confirm OpenDevBrowser is loaded from your intended local path (for example a repo symlink) and not a stale cache copy.

If OpenCode is still resolving an old cached install:
- Clear plugin cache: `rm -rf ~/.cache/opencode/node_modules/opendevbrowser`
- Restart OpenCode and re-run `opencode debug config`.

## Relay binding busy

When multiple plugin instances run, only one client can hold the relay binding at a time.

Symptoms:
- Errors starting with `RELAY_BINDING_REQUIRED` or `RELAY_WAIT_TIMEOUT`

Fixes:
- Wait for the current binding to expire (default TTL 60s)
- Ensure the other client releases the relay by closing its extension session
- Restart the daemon if a binding is stuck: `npx opendevbrowser serve --stop` then `npx opendevbrowser serve`
- If queued, retry after the wait timeout (default 30s)

## Same-session parallel contention or backpressure

Runtime scheduling is target-scoped (`ExecutionKey = (sessionId,targetId)`): same target is FIFO, different targets run in parallel up to `effectiveParallelCap`.

Symptoms:
- Commands time out with `parallelism_backpressure`.
- Throughput drops under memory pressure.
- Cross-target work stalls when all slots are occupied by long-running operations.

Fixes:
- Keep `target-id` explicit for concurrent flows and avoid unnecessary `target-use` switching.
- Use `session-per-worker` for strict operational isolation when workloads are noisy.
- Prefer default extension `/ops`; use legacy `/cdp` only for compatibility paths (sequential by design).
- For managed parallel runs with persisted profiles, use unique profile paths per session (or disable persistence) to avoid profile lock failures.

## Extension instance mismatch

If the extension pairs with a different relay instance, it will refuse to auto-pair and reconnect.

Fixes:
- Open the extension popup and click **Connect** to refresh pairing
- Ensure the daemon and extension are both using the same relay port
- If needed, restart the daemon and reconnect the extension

If the daemon logs `handshake_failed` with `invalid_token`, the extension is using a stale pairing token:
- Click **Connect** in the extension popup (auto-pair fetches the current token)
- Verify `relayPort` matches the daemon’s relay port

## `unsupported_mode` on extension headless launch/connect

If you request extension mode with headless, the runtime fails with `unsupported_mode` by design.

Fixes:
- Use managed headless explicitly: `npx opendevbrowser launch --no-extension --headless`
- For extension mode, run headed (`--headless` off)
- For direct CDP connect, connect to an explicit CDP endpoint instead of relay routing

## OpenCode `run --command` reports `command3.agent`

If prompt-driven background runs fail with errors that mention `command3.agent`, force explicit shell command routing:

- Preferred: `opencode run --command shell "echo hello"`
- Also valid: `opencode run --command "echo hello"` (single quoted command string)
- Avoid split forms that can be parsed as agent command selectors.

After upgrading/replacing `opencode`, re-run a quick probe in JSON mode to confirm `command3.agent` is no longer present in stderr/log output.

## Extension-only quick verification flow

Use this sequence to validate extension-only mode end-to-end:

1. Start daemon: `npx opendevbrowser serve`
2. Confirm relay health: `npx opendevbrowser status --daemon --output-format json`
3. Launch extension session: `npx opendevbrowser launch --extension-only --wait-for-extension`
4. Run a simple command (`status`, `snapshot`, or `targets-list`) and then disconnect.

For broad regression checks, run:
- `npm run build`
- `node scripts/live-regression-direct.mjs`
- `node scripts/provider-direct-runs.mjs --smoke`
- `node scripts/provider-direct-runs.mjs`
- `node scripts/cli-smoke-test.mjs`
- `node scripts/chrome-store-compliance-check.mjs`
- `node scripts/docs-drift-check.mjs`
- `node scripts/audit-zombie-files.mjs`

`provider-direct-runs` executes direct provider-by-provider cases for web, community, social, and shopping without nesting a separate live-regression pack or relying on synthetic matrix artifacts.
By default it skips auth-gated provider cases, high-friction provider cases, and social post probes (research-first mode). Add `--include-auth-gated`, `--include-high-friction`, or `--include-social-posts` when you intentionally want those checks.
The direct provider harness now keeps generic timeout outcomes as real `fail` rows instead of collapsing them into `env_limited`; only explicit capability/auth/challenge boundaries should remain `env_limited`.
`live-regression-direct` executes explicit child runs for CLI smoke, `/canvas` on managed headless/headed + extension + CDP, and `annotate` relay/direct probes. Keep the daemon healthy and the extension connected before running extension or CDP scenarios.
The direct harness now uses temporary managed profiles for managed `/canvas` surfaces and the direct annotate probe, and it waits for `/ops` ownership to clear before the legacy `/cdp` step. In strict release mode, manual annotation timeouts remain explicit `skipped` boundaries rather than runtime failures.

For release hardening, use strict gate mode:
- `node scripts/provider-direct-runs.mjs --release-gate --out artifacts/release/vX.Y.Z/provider-direct-runs.json`
- `node scripts/live-regression-direct.mjs --release-gate --out artifacts/release/vX.Y.Z/live-regression-direct.json`

The canonical direct-run release evidence policy lives in `skills/opendevbrowser-best-practices/SKILL.md`; keep matrix wrappers debug-only.

## Chrome version too old

Extension relay requires **Chrome 125+** for flat CDP sessions. Upgrade Chrome if you see errors about unsupported flat sessions.

## Hub-only mode

When hub mode is enabled, the plugin will not fall back to a local relay. If the hub daemon cannot be reached:
- Start it: `npx opendevbrowser serve`
- Verify `/status` with the configured `daemonPort`/`daemonToken`
