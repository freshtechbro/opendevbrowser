# Troubleshooting

Status: active  
Last updated: 2026-02-24

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
- `opsConnected` – any `/ops` client attached (expected **false** until a relay client launches/connects)
- `cdpConnected` – any `/cdp` client attached (legacy path, expected **false** unless `--extension-legacy` is used)
- `annotationConnected` – annotation websocket attached (expected **false** unless annotate relay transport is active)
- `pairingRequired` – relay token required for `/ops` and `/cdp`
- `health.reason` – relay health summary (`ok`, `no_extension`, `extension_no_handshake`, etc.)

If `opsConnected` stays `false` after extension-mode `launch`/`connect`, restart the daemon and reconnect the extension.
`cdpConnected` remaining `false` is normal for default `/ops` sessions.

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

- Workflow outputs: `meta.metrics.reason_code_distribution`/`meta.metrics.reasonCodeDistribution` and `meta.metrics.transcript_strategy_failures`/`meta.metrics.transcriptStrategyFailures`.
- Strategy-detail workflow diagnostics: `meta.metrics.transcript_strategy_detail_failures`/`meta.metrics.transcriptStrategyDetailFailures` and `meta.metrics.transcript_strategy_detail_distribution`/`meta.metrics.transcriptStrategyDetailDistribution`.
- Workflow health dimensions: `meta.metrics.transcriptDurability` (or `meta.metrics.transcript_durability`) and `meta.metrics.antiBotPressure` (or `meta.metrics.anti_bot_pressure`).
- Provider failure entries: `error.reasonCode`.
- YouTube record metadata: `transcript_strategy` (legacy bucket), `transcript_strategy_detail` (exact strategy), `attempt_chain`, and failure `reasonCode`.

Transcript controls checklist:

1. Default behavior is exhaustive chain-on (`enableYtdlpAudioAsr=true`, `enableApify=true`, `enableBrowserFallback=true`).
2. Mode precedence is `filters.youtube_mode > providers.transcript.modeDefault > auto`; no new CLI mode flag is added in this phase.
3. Keep the progressive fallback chain enabled for non-forced modes: `youtubei -> native_caption_parse -> ytdlp_audio_asr -> apify`.
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
8. If `env_limited` appears for browser fallback, disable browser fallback and continue with deterministic resolver strategies.

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
- `node scripts/live-regression-matrix.mjs`
- `node scripts/provider-live-matrix.mjs --smoke`
- `node scripts/provider-live-matrix.mjs`
- `node scripts/cli-smoke-test.mjs`
- `node scripts/chrome-store-compliance-check.mjs`
- `node scripts/docs-drift-check.mjs`
- `node scripts/audit-zombie-files.mjs`

`provider-live-matrix` full mode now probes browser social flows across `managed`, `extension`, and `cdpConnect`; keep the extension connected before running.
By default it skips auth-gated provider cases, high-friction provider cases, and social post probes (research-first mode). Add `--include-auth-gated`, `--include-high-friction`, or `--include-social-posts` when you intentionally want those checks.

For release hardening, use strict gate mode:
- `node scripts/provider-live-matrix.mjs --release-gate --out artifacts/release/v0.0.16/provider-live-matrix.json`
- `node scripts/live-regression-matrix.mjs --release-gate`

## Chrome version too old

Extension relay requires **Chrome 125+** for flat CDP sessions. Upgrade Chrome if you see errors about unsupported flat sessions.

## Hub-only mode

When hub mode is enabled, the plugin will not fall back to a local relay. If the hub daemon cannot be reached:
- Start it: `npx opendevbrowser serve`
- Verify `/status` with the configured `daemonPort`/`daemonToken`
