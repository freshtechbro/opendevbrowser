# OpenDevBrowser CLI

Command-line interface for installing and managing the OpenDevBrowser plugin, plus automation commands for agents.
Status: active  
Last updated: 2026-04-13

OpenDevBrowser exposes 70 `opendevbrowser_*` tools; see `README.md` and `docs/SURFACE_REFERENCE.md` for the full inventories.
Generated help is the primary first-contact inventory and onboarding surface. Agent runs should start with `opendevbrowser_prompting_guide` or `opendevbrowser_skill_load opendevbrowser-best-practices "quick start"` before low-level browser commands, then load `opendevbrowser_skill_load opendevbrowser-best-practices "validated capability lanes"` when they need the currently proven transcript, research, and shopping workflows. Load `opendevbrowser_skill_load opendevbrowser-design-agent "canvas-contract"` immediately after that baseline for frontend, screenshot-to-code, or `/canvas` design work. Use continuity guidance only for long-running handoff or compaction.
That generated help surface now leads with a `Find It Fast` block that uses the exact lookup terms `screencast / browser replay`, `desktop observation`, and `computer use / browser-scoped computer use`. It maps replay to `screencast-start` / `screencast-stop`, desktop observation to the public read-only `desktop-*` family, and browser-scoped computer use to `--challenge-automation-mode` on `research run`, `shopping run`, `product-video run`, `inspiredesign run`, and `macro-resolve --execute`, with `research run --topic ... --challenge-automation-mode browser` as the first entry command.
Tool-only commands `opendevbrowser_prompting_guide`, `opendevbrowser_skill_list`, and `opendevbrowser_skill_load` run locally via the skill loader. They are onboarding helpers, not browser-runtime commands, and they do not require relay or daemon bootstrap.
CLI-only power command `rpc` intentionally has no tool equivalent; it is an internal daemon escape hatch behind an explicit safety flag and should be used with extreme caution.
Public-surface metadata now flows from `src/public-surface/source.ts` through `scripts/generate-public-surface-manifest.mjs` into `src/public-surface/generated-manifest.ts` and `src/public-surface/generated-manifest.json`, which are consumed by `src/cli/help.ts`, `src/cli/args.ts`, inventory scripts, mirrored website inputs, and re-export paths in `src/tools/index.ts`. Onboarding literals still live in `src/cli/onboarding-metadata.json`, and runtime execution authority remains `src/cli/args.ts` plus `src/tools/index.ts`.
The generated first-contact inventory mirrored into downstream website and release flows is tracked in `docs/ASSET_INVENTORY.md`.

Dependency inventory: `docs/DEPENDENCIES.md`
First-run local-artifact onboarding: `docs/FIRST_RUN_ONBOARDING.md`

Parity and skill-pack gates:

```bash
npm run test -- tests/cli-help-parity.test.ts
npm run test -- tests/parity-matrix.test.ts
./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh
./skills/opendevbrowser-design-agent/scripts/validate-skill-assets.sh
./skills/opendevbrowser-design-agent/scripts/design-workflow.sh research-harvest
./skills/opendevbrowser-design-agent/scripts/design-workflow.sh release-gate
```

Treat those checks as contract and documentation guards. Live release proof comes from the direct-run harnesses documented later in this guide and in `docs/RELEASE_RUNBOOK.md`.

## Installation

Requires Node.js `>=18`.

```bash
# Interactive installation (prompts for location)
npx opendevbrowser

# Non-interactive with flags
npx opendevbrowser --global   # Install to ~/.config/opencode/opencode.json
npx opendevbrowser --local    # Install to ./opencode.json

# Optional: persistent global CLI
npm install -g opendevbrowser
opendevbrowser --version
```

### Local package onboarding from a source tarball

```bash
cd <public-repo-root>
npm pack

WORKDIR=$(mktemp -d /tmp/opendevbrowser-first-run-XXXXXX)
ISOLATED_ROOT=$(mktemp -d /tmp/opendevbrowser-first-run-isolated-XXXXXX)
export HOME="$ISOLATED_ROOT/home"
export OPENCODE_CONFIG_DIR="$ISOLATED_ROOT/opencode-config"
export OPENCODE_CACHE_DIR="$ISOLATED_ROOT/opencode-cache"
export CODEX_HOME="$ISOLATED_ROOT/codex-home"
export CLAUDECODE_HOME="$ISOLATED_ROOT/claudecode-home"
export AMP_CLI_HOME="$ISOLATED_ROOT/ampcli-home"
cd "$WORKDIR"
npm init -y
npm install <public-repo-root>/opendevbrowser-0.0.28.tgz
npx --no-install opendevbrowser --help
npx --no-install opendevbrowser help
```

Load extension unpacked from:
- `$WORKDIR/node_modules/opendevbrowser/extension`

Set `OPDEVBROWSER_SKIP_POSTINSTALL_SKILL_SYNC=1` before `npm install` only if you need a packaging smoke test that avoids the install-time managed-skill refresh entirely.

By default (`--skills-global`), the CLI installs bundled skills to global OpenCode/Codex/ClaudeCode/AmpCLI locations. Use `--skills-local` for project-local locations or `--no-skills` to skip CLI-managed skill installation. Package installation (`npm install -g`, local tarball install, or equivalent) also best-effort syncs the canonical bundled packs into the managed global skill targets during package `postinstall`. Use `--full` to always create `opendevbrowser.jsonc` and pre-extract extension assets.

Installer inventory:
- `--skills-global` and `--skills-local` sync the 9 canonical `opendevbrowser-*` packs under `skills/` into managed global or project-local agent directories.
- Managed installs write a target-level ownership marker, so default updates and uninstall only act on CLI-managed targets or older config installs that already contain canonical packs.
- Reinstall and update refresh drifted managed copies and leave matching packs unchanged.
- Uninstall removes managed canonical packs, retires repo-owned legacy alias directories that match shipped content, and leaves unrelated directories untouched.

`OPENCODE_CONFIG_DIR` changes config lookup, but the extracted unpacked-extension copy created by `--full` still lives at `~/.config/opencode/opendevbrowser/extension`.

Published npm consumer proof is a separate release gate:

```bash
node scripts/registry-consumer-smoke.mjs --version X.Y.Z --output artifacts/release/vX.Y.Z/registry-consumer-smoke.json
```

### Skill discovery order

The skill loader discovers skills in this order (first match wins):

1. Project-local: `./.opencode/skill`
2. Global: `~/.config/opencode/skill` (or `$OPENCODE_CONFIG_DIR/skill`)
3. Compatibility (project): `./.codex/skills`
4. Compatibility (global): `$CODEX_HOME/skills` (fallback `~/.codex/skills`)
5. Compatibility (project): `./.claude/skills`
6. Compatibility (global): `$CLAUDECODE_HOME/skills` (fallback `~/.claude/skills`)
7. Compatibility (project): `./.amp/skills`
8. Compatibility (global): `$AMP_CLI_HOME/skills` (fallback `~/.amp/skills`)
9. Extra paths from `skillPaths` (advanced)
10. Bundled package fallback: packaged `skills/` directory after `skillPaths` when no installed copy matches

---

## Output formats

Use `--output-format` to switch output formats for automation.

- `text` (default): human-friendly output
- `json`: single JSON object
- `stream-json`: emit one JSON object per line for arrays; otherwise emits a single JSON object

Use `--quiet` to suppress output. Use `--no-interactive` (alias of `--no-prompt`) to disable prompts.

---

## Exit codes

- `0`: success
- `1`: usage error (invalid args, missing flags)
- `2`: execution error (runtime/daemon failures)
- `10`: disconnected (daemon not running or unreachable)

Fatal errors are emitted even when `--quiet` is set. For JSON output, fatal errors are emitted as:

```json
{ "success": false, "error": "message", "exitCode": 2 }
```

---

## Argument validation

The CLI validates common flags early and returns a usage error (`exitCode: 1`) when inputs are invalid.

- Conflicting flags are rejected (examples: `--global` + `--local`, `--skills-global` + `--skills-local`).
- Positive integer flags must use plain decimal digits:
  - `--port`, `--cdp-port`
  - `--wait-timeout-ms`, `--timeout-ms`, `--max`, `--max-chars`
- Non-negative cursor flags allow `0` and use plain decimal digits: `--since-seq`, `--since-console-seq`, `--since-network-seq`, `--since-exception-seq`.
- Signed movement flags use plain decimal integers and may be negative: `--dy`.

---

## Surface inventory (source-accurate)

Canonical inventory document: `docs/SURFACE_REFERENCE.md`.

### CLI command surface

- Total commands: `77`.
- Categories: install/runtime management, session/connection plus capability discovery, navigation plus desktop-assisted browser review, interaction plus low-level pointer control, targets/pages, DOM inspection, browser capture and replay, desktop observation, design canvas, export plus session-centric diagnostics and browser-scoped inspection, macro/annotation, and internal power (`rpc`).

### Tool surface

- Total tools: `70` (`opendevbrowser_*`).
- CLI-tool pairs: `67`.
- Tool-only surface (no CLI equivalent): `opendevbrowser_prompting_guide`, `opendevbrowser_skill_list`, `opendevbrowser_skill_load`.
- CLI-only surface (no tool equivalent): `install`, `update`, `uninstall`, `help`, `version`, `serve`, `daemon`, `native`, `artifacts`, `rpc`.

### Relay channel surface

- `/ops` (default extension channel): high-level command protocol; see `docs/SURFACE_REFERENCE.md` for all `59` command names.
- `/canvas` (design-canvas channel): typed design-canvas protocol; see `docs/SURFACE_REFERENCE.md` for all `35` command names and envelope contracts.
- `/cdp` (legacy): low-level `forwardCDPCommand` relay path with explicit opt-in (`--extension-legacy`).

## Challenge orchestration contract

- Managed and `/ops`-backed manager responses preserve the shipped blocker fields `meta.blocker`, `meta.blockerState`, and `meta.blockerResolution`, and may append additive `meta.challenge` plus `meta.challengeOrchestration`.
- Browser-assisted provider fallback reports explicit transport `disposition`: `completed`, `challenge_preserved`, `deferred`, or `failed`. When bounded challenge orchestration runs during fallback, decision evidence is recorded in `details.challengeOrchestration`.
- Workflow and daemon callers can set `challengeAutomationMode` to `off`, `browser`, or `browser_with_helper`. Effective precedence is `run > session > config`.
- Shipped config defaults now resolve to `providers.challengeOrchestration.mode = browser_with_helper` and `providers.challengeOrchestration.optionalComputerUseBridge.enabled = true`.
- `meta.challengeOrchestration` and fallback `details.challengeOrchestration` can expose `mode`, `source`, `standDownReason`, and `helperEligibility` so stand-down decisions stay explicit.
- `ProviderRegistry` is the only durable anti-bot pressure authority used by policy, runtime routing, and workflow summaries. Provider modules only contribute extraction logic and optional `recoveryHints()`.
- Direct browser, `/ops`, and provider fallback flows share one bounded challenge plane. It can try auth navigation, legitimate session or cookie reuse, non-secret field fill, and bounded browser-native interaction experimentation before yielding.
- The optional helper bridge is browser-scoped, not a desktop agent. `browser` keeps it disabled and `browser_with_helper` only evaluates it after the existing hard gates pass.
- Separate `desktop.*` config controls the shipped public read-only desktop observation plane. It is enabled by default, is never enabled by `challengeAutomationMode`, and does not widen the browser challenge helper into a desktop agent or desktop `/ops` family.
- Provider and workflow auto-resume still happen only after manager-owned verification clears the blocker.
- In scope: preserved sessions, visual observation loops, low-level pointer controls, bounded interaction experimentation, reclaimable human yield packets, and owned-environment fixtures that use vendor test keys only.
- Out of scope: hidden bypass paths, CAPTCHA-solving services, challenge token harvesting, or autonomous unsandboxed solving of third-party anti-bot systems.

---

## Commands

### Install (default)

```bash
# Interactive - prompts for global or local
npx opendevbrowser

# Global installation (user-wide)
npx opendevbrowser --global
npx opendevbrowser -g

# Local installation (current project)
npx opendevbrowser --local
npx opendevbrowser -l

# Skip prompts, use default (global)
npx opendevbrowser --no-prompt
npx opendevbrowser --no-interactive

# Full install (config + extension assets)
npx opendevbrowser --full

# Also create opendevbrowser.jsonc config file
npx opendevbrowser --global --with-config

# Full install (plugin + config + bundled skills)
npx opendevbrowser --global --with-config --skills-global

# Install skills locally (project scope)
npx opendevbrowser --skills-local

# Skip installing skills
npx opendevbrowser --no-skills
```

On successful installs, the CLI reconciles daemon auto-start on supported platforms (macOS/Windows) so the relay is available on
login. Existing installs are rechecked and repaired when the per-user auto-start entry is missing or stale on macOS and Windows,
and when the macOS LaunchAgent is malformed or missing its stable non-root working directory. If the current CLI entrypoint lives under a transient temp-root path (for example a
first-run `/tmp` or `/private/tmp` `npx` workspace), OpenDevBrowser refuses to persist that path as auto-start. Plugin install
still succeeds, but auto-start repair warns and you must rerun `opendevbrowser daemon install` from a stable install location, or
`npx --no-install opendevbrowser daemon install` from a persistent local package install. You can remove auto-start later with
`opendevbrowser daemon uninstall`.

### Update

Clear the OpenCode cache to trigger reinstallation of the latest version.

```bash
npx opendevbrowser --update
npx opendevbrowser -u
```

This removes cached files from `~/.cache/opencode/node_modules/opendevbrowser/`, removes stale `opendevbrowser`
dependency pins from `~/.cache/opencode/package.json`, and deletes the OpenCode cache lockfile when present. OpenCode
will download the latest version on next run.

### Uninstall

Remove the plugin from configuration and clean managed skill packs for the selected install target.

```bash
# Remove from global config
npx opendevbrowser --uninstall --global

# Remove from local config
npx opendevbrowser --uninstall --local

# Interactive - prompts which to remove if both exist
npx opendevbrowser --uninstall
```

### Help / Version

```bash
npx opendevbrowser --help
npx opendevbrowser -h

npx opendevbrowser help

npx opendevbrowser --version
npx opendevbrowser -v
```

`--help` and `help` print the same generated first-contact inventory:
- A `Find It Fast` block that uses the exact lookup terms `screencast / browser replay`, `desktop observation`, and `computer use / browser-scoped computer use`.
- That block maps replay to `screencast-start` / `screencast-stop`, desktop observation to the public `desktop-*` family, and browser-scoped computer use to `--challenge-automation-mode` on `research run`, `shopping run`, `product-video run`, `inspiredesign run`, and `macro-resolve --execute`, with a concrete `research run --topic ... --challenge-automation-mode browser` entry command.
- An `Agent Quick Start` block that tells agents to start with `opendevbrowser_prompting_guide` or `opendevbrowser_skill_load opendevbrowser-best-practices "quick start"` before low-level browser commands.
- A follow-up `validated_lanes` entry that points agents to `opendevbrowser_skill_load opendevbrowser-best-practices "validated capability lanes"` for the current reliable transcript, research, and shopping runbook.
- A direct pointer to `opendevbrowser_skill_list` when an agent needs a different local skill lane.
- A browser-scoped computer-use description that makes the optional helper boundary explicit and does not imply a desktop agent.
- The complete generated CLI command, flag, and `opendevbrowser_*` tool inventories.
- Canonical pointers to `docs/FIRST_RUN_ONBOARDING.md`, `skills/opendevbrowser-best-practices/SKILL.md`, and `docs/SURFACE_REFERENCE.md`.

Quick lookup terms from generated help:
- `screencast / browser replay`: `screencast-start`, `screencast-stop`
- `desktop observation`: `desktop-status`, `desktop-windows`, `desktop-active-window`, `desktop-capture-desktop`, `desktop-capture-window`, `desktop-accessibility-snapshot`
- `computer use / browser-scoped computer use`: `--challenge-automation-mode off|browser|browser_with_helper` on `research run`, `shopping run`, `product-video run`, `inspiredesign run`, and `macro-resolve --execute`; entry command `npx opendevbrowser research run --topic "account recovery flow" --source-selection auto --challenge-automation-mode browser --mode json --output-format json`

These first-contact assets are also mirrored as release and website inputs through `src/cli/onboarding-metadata.json`, `src/public-surface/generated-manifest.ts`, and `src/public-surface/generated-manifest.json`.

Operational help parity check:

```bash
npx opendevbrowser --help
npx opendevbrowser help
```

First-run proof lane:

```bash
node scripts/cli-onboarding-smoke.mjs
```

---

## Automation commands (daemon)

### Serve (daemon)

Start a local daemon to keep sessions alive between commands.

```bash
npx opendevbrowser serve
npx opendevbrowser serve --port 8788 --token my-token

# Stop the daemon
npx opendevbrowser serve --stop
```

The daemon listens on `127.0.0.1` and starts the relay the extension connects to. Metadata lives in
`~/.cache/opendevbrowser/daemon.json` (cache only);
`/status` is the source of truth. The daemon port/token are persisted in `opendevbrowser.jsonc` as `daemonPort`/`daemonToken`.
`serve` now performs a stale-daemon preflight and terminates orphan `opendevbrowser serve` processes before starting (or before
returning "already running"), while preserving the active daemon on the requested port.

If you run onboarding tests alongside an existing daemon, isolate config/cache via `OPENCODE_CONFIG_DIR` and `OPENCODE_CACHE_DIR`
to avoid token/port collisions between sessions.

If `nativeExtensionId` is set in `opendevbrowser.jsonc`, `serve` will auto-install the native messaging host when it is missing.
If it is not set, `serve` attempts to auto-detect the extension ID from Chrome, Brave, or Chromium profiles; if detection fails it continues startup.

Relay HTTP endpoints (`/config`, `/status`, `/pair`) accept extension origins and loopback requests with no `Origin` (including
`Origin: null`) to support MV3 + PNA. Non-extension origins are rejected; preflights include
`Access-Control-Allow-Private-Network: true` when requested.

#### Manual recovery (if the daemon is down or stuck)

```bash
# Start the daemon manually
npx opendevbrowser serve

# Stop/kill an existing daemon before restarting
npx opendevbrowser serve --stop
```

### Daemon auto-start

Install or remove OS-level auto-start for the daemon. This persists an absolute `node + cli + serve` entrypoint (no PATH
reliance) only when the current CLI path is stable. On macOS it also persists a `WorkingDirectory` under
`~/.cache/opendevbrowser` so launchd never starts the daemon from `/`. Temporary `npx` caches and temp onboarding workdirs are rejected instead of
being written to LaunchAgent or Task Scheduler state, and all commands return machine-readable output with `--output-format json`.

```bash
opendevbrowser daemon install
opendevbrowser daemon uninstall
opendevbrowser daemon status

# Persistent local package install alternative
npx --no-install opendevbrowser daemon install
```

Behavior:
- macOS: LaunchAgent at `~/Library/LaunchAgents/com.opendevbrowser.daemon.plist` targeting an absolute `node + cli + serve` entrypoint plus `WorkingDirectory=~/.cache/opendevbrowser`.
- Windows: per-user Task Scheduler logon task targeting an absolute `node + cli + serve` entrypoint; status inspects the persisted scheduled-task action from Task Scheduler XML instead of task presence alone.
- `daemon status --output-format json` keeps top-level `installed` and `running`, adds nested `autostart` on supported platforms, and includes `status` only when the daemon is running.
- `autostart` is the canonical detail object and includes `health`, `needsRepair`, `reason`, `command`, `expectedCommand`, and macOS working-directory fields when applicable.
- `autostart.reason` can be `transient_cli_path` when an existing LaunchAgent or Task Scheduler action points at a temp-root CLI path that should be repaired; macOS can also report `working_directory_mismatch` when an older LaunchAgent would start from `/` or another unsafe directory.
- when the current invocation is transient, a stable persisted auto-start entry can still report `health="healthy"`; `expectedCommand` is omitted instead of advertising the transient current path as the repair target.
- `daemon status` returns exit code `0` when the daemon is reachable even if auto-start is missing, stale, or malformed, and `10` when the daemon is not running.
- Successful plugin installs surface auto-start reconciliation through `autostartAction`; `autostartError` is included only when repair fails.
- If install-time reconciliation is running from a transient temp-root CLI path, it refuses to write auto-start and reports `autostartAction="repair_failed"` with guidance to rerun `opendevbrowser daemon install` from a stable install location.

Exit codes align with the CLI:
- `0`: success
- `1`: usage error
- `2`: execution error (permissions, missing binary, OS service failure, unsupported `daemon install|uninstall`, or unexpected status evaluation failure)
- `10`: disconnected/not running (status only)

#### Auto-start install + manual fallback

```bash
# Install auto-start (recommended)
opendevbrowser daemon install

# Or, from a persistent local package install
npx --no-install opendevbrowser daemon install

# If auto-start fails, start manually
npx opendevbrowser serve

# Stop/kill before restarting
npx opendevbrowser serve --stop
```

If you are running from a first-run temp workspace or transient `npx` cache, rerun `opendevbrowser daemon install` from a stable
install location before expecting login auto-start to persist. On macOS, `daemon status --output-format json` should show matching
`autostart.workingDirectory` and `autostart.expectedWorkingDirectory`.

### Native messaging host

Install the native messaging host for the extension to use as a fallback transport when the relay WebSocket is unavailable.

```bash
# Install native host (requires extension ID)
npx opendevbrowser native install <extension-id>

# Check native host status
npx opendevbrowser native status

# Remove native host
npx opendevbrowser native uninstall
```

Notes:
- Supported on macOS, Linux, and Windows.
- Windows install writes a registry entry under `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.opendevbrowser.native`.
- `native install` requires the extension ID (chrome://extensions → copy ID).
- Set `nativeExtensionId` in `opendevbrowser.jsonc` to allow `serve` to auto-install the native host when missing (preferred).
- `serve` also attempts auto-detection from Chrome, Brave, or Chromium profiles, but explicit config is more reliable.
- `native status` reports installed state + extension ID from the manifest.
- Use `--transport native` with `status` to check native host status without requiring the daemon.

### Workflow wrappers

The workflow wrappers expose the finalized research, shopping, product-video, and inspiredesign surfaces from
`docs/RESEARCH_SHOPPING_PRODUCT_VIDEO_FINAL_SPEC.md`, central next-step advisory builders in `src/providers/workflow-handoff.ts`,
and the shared inspiredesign artifact source at `src/inspiredesign/handoff.ts`.

#### Research (`research run`)

```bash
npx opendevbrowser research run --topic "browser automation" --days 30 --mode compact
npx opendevbrowser research run --topic "Chrome extension debugging workflows" --days 30 --source-selection auto --browser-mode managed --mode json
npx opendevbrowser research run --topic "creator tools" --sources web,shopping --include-engagement --limit-per-source 5 --mode context
```

Flags:
- `--topic` (required)
- `--days`
- `--from`
- `--to`
- `--source-selection` (`auto|web|community|social|shopping|all`)
- `--sources` (comma-separated concrete sources)
- `--browser-mode` (`auto|extension|managed`)
- `--mode` (`compact|json|md|context|path`)
- `--include-engagement`
- `--limit-per-source`
- `--timeout-ms`
- `--output-dir`
- `--ttl-hours`
- `--use-cookies` (`true|false`; bare flag means `true`)
- `--challenge-automation-mode` (`off|browser|browser_with_helper`)
- `--cookie-policy-override` (`off|auto|required`)
- `--cookie-policy` (alias of `--cookie-policy-override`)

Notes:
- Use `--source-selection auto` for generic topical research.
- Use `--browser-mode extension` when X, Threads, Facebook, Reddit, or another signed-in social provider needs an existing relay-backed browser session; use `managed` for reproducible no-auth reruns.
- In the current contract, `auto` and `all` both stay inside the public topical families (`web`, `community`, `social`).
- Add shopping only with `--source-selection shopping` or explicit `--sources ...shopping...` when the task is deliberately commercial.
- Successful research artifact bundles include human-readable `report.md` alongside `summary.md`, `records.json`, `context.json`, and `meta.json`.

#### Shopping (`shopping run`)

```bash
npx opendevbrowser shopping run --query "usb microphone" --mode compact
npx opendevbrowser shopping run --query "wireless ergonomic mouse" --providers shopping/bestbuy,shopping/ebay --budget 150 --browser-mode managed --use-cookies --challenge-automation-mode browser_with_helper --mode json --output-format json
npx opendevbrowser shopping run --query "27 inch 4k monitor" --providers shopping/bestbuy,shopping/ebay --budget 350 --sort lowest_price --browser-mode managed --use-cookies --challenge-automation-mode browser_with_helper --mode json --output-format json
npx opendevbrowser shopping run --query "wireless earbuds" --providers shopping/amazon --region us --browser-mode managed --use-cookies --challenge-automation-mode browser_with_helper --mode json --output-format json
```

Flags:
- `--query` (required)
- `--providers` (comma-separated; defaults to all v1 adapters)
- `--budget`
- `--region`
- `--browser-mode` (`auto|extension|managed`)
- `--sort` (`best_deal|lowest_price|highest_rating|fastest_shipping`)
- `--mode` (`compact|json|md|context|path`)
- `--timeout-ms`
- `--output-dir`
- `--ttl-hours`
- `--use-cookies` (`true|false`; bare flag means `true`)
- `--challenge-automation-mode` (`off|browser|browser_with_helper`)
- `--cookie-policy-override` (`off|auto|required`)
- `--cookie-policy` (alias of `--cookie-policy-override`)

Notes:
- Use explicit providers plus `--browser-mode managed` for the most reproducible live reruns.
- Treat `--region` as advisory unless `meta.selection.region_authoritative=true`.
- When a run returns no final offers, inspect `meta.primaryConstraintSummary` first.
- If `meta.primaryConstraint.guidance` is present, follow `meta.primaryConstraint.guidance.reason` and `meta.primaryConstraint.guidance.recommendedNextCommands[]` before classifying the provider path as broken.
- If `meta.primaryConstraint.guidance` is absent, inspect `meta.offerFilterDiagnostics`; summary-only outcomes are usually offer-filter constraints such as budget or region heuristics, not provider outage proof.

#### Product presentation asset (`product-video run`)

```bash
npx opendevbrowser product-video run --product-url "https://example.com/p/1" --browser-mode managed --use-cookies --challenge-automation-mode browser_with_helper --include-screenshots
npx opendevbrowser product-video run --product-name "Sample Product" --provider-hint shopping/amazon --browser-mode extension --use-cookies --challenge-automation-mode browser_with_helper --output-dir /tmp/product-assets
```

Flags:
- `--product-url` (required unless `--product-name` is provided)
- `--product-name` (required unless `--product-url` is provided)
- `--provider-hint`
- `--include-screenshots` (`true|false`; bare flag means `true`)
- `--include-all-images` (`true|false`; bare flag means `true`)
- `--include-copy` (`true|false`; bare flag means `true`)
- `--timeout-ms`
- `--browser-mode` (`auto|extension|managed`)
- `--output-dir`
- `--ttl-hours`
- `--use-cookies` (`true|false`; bare flag means `true`)
- `--challenge-automation-mode` (`off|browser|browser_with_helper`)
- `--cookie-policy-override` (`off|auto|required`)
- `--cookie-policy` (alias of `--cookie-policy-override`)

#### Inspiredesign (`inspiredesign run`)

```bash
npx opendevbrowser inspiredesign run --brief "Synthesize a premium docs landing page from calm editorial references" --url https://stripe.com --url https://vercel.com
npx opendevbrowser inspiredesign run --brief "Extract a reusable dashboard design contract from live references" --url https://linear.app --browser-mode managed --use-cookies --challenge-automation-mode browser_with_helper --include-prototype-guidance --output-dir /tmp/inspiredesign
```

Flags:
- `--brief` (required)
- `--url` (repeatable inspiration URL input)
- `--capture-mode` (`off|deep`; `off` is ignored when any `--url` is provided)
- `--include-prototype-guidance` (`true|false`; bare flag means `true`)
- `--mode` (`compact|json|md|context|path`)
- `--timeout-ms`
- `--output-dir`
- `--ttl-hours`
- `--browser-mode` (`auto|extension|managed`)
- `--use-cookies` (`true|false`; bare flag means `true`)
- `--challenge-automation-mode` (`off|browser|browser_with_helper`)
- `--cookie-policy-override` (`off|auto|required`)
- `--cookie-policy` (alias of `--cookie-policy-override`)

Notes:
- Any `--url` forces deep capture so inspiredesign can collect DOM/layout evidence. Without URLs, `--capture-mode` defaults to `off`.
- Repeat `--url` for multiple inspiration sources. There is no `--urls` alias.
- `--include-prototype-guidance` appends prototype structure guidance to the generated design contract output.
- Successful runs now emit `advanced-brief.md`, `canvas-plan.request.json`, and `design-agent-handoff.json` alongside the existing design contract and implementation artifacts.
- The follow-through path is explicit: read `advanced-brief.md` first, load `opendevbrowser_skill_load opendevbrowser-best-practices "quick start"` plus `opendevbrowser_skill_load opendevbrowser-design-agent "canvas-contract"`, fill the session ids in `canvas-plan.request.json`, run `opendevbrowser canvas --command canvas.plan.set --params-file ./canvas-plan.request.json`, confirm `planStatus=accepted`, then patch only the governance blocks called out by `design-agent-handoff.json`.
- `--browser-mode` applies to provider-backed reference retrieval. Deep capture still uses the browser manager capture lane.

Wrapper behavior:
- Timebox semantics are strict (`--days` is mutually exclusive with `--from/--to`).
- Render modes for `research`, `shopping`, and `inspiredesign` are shared: `compact|json|md|context|path`.
- `product-video run` always returns a path-based local asset pack.
- `inspiredesign run` returns a reusable design contract plus a Canvas-first handoff bundle; `--include-prototype-guidance` adds prototype structure guidance to the same workflow output.
- Path-bearing workflow outputs persist artifacts under the explicit `--output-dir` when provided and include TTL metadata in manifest files. The CLI rejects blank `--output-dir` values and resolves relative paths from the invocation directory before daemon dispatch. When `--output-dir` is omitted, research, shopping, inspiredesign, and product-video asset packs write to `.opendevbrowser/<namespace>/<runId>` from the current workspace. Namespaces are `research`, `shopping`, `inspiredesign`, and `product-assets`. Direct tool or daemon callers should pass an absolute output directory when they need caller-specific placement.
- Workflow cookie policy defaults to `providers.cookiePolicy=auto` and source defaults to `providers.cookieSource` (`file`, `env`, or `inline`).
- Effective policy precedence is `--cookie-policy-override`/`--cookie-policy` > `--use-cookies` > config defaults.
- `auto` attempts injection when cookies are available and continues when cookies are missing/unusable.
- `required` fails fast with `reasonCode=auth_required` when cookie loading/injection/verification cannot establish a session.
- Workflow challenge automation defaults to `providers.challengeOrchestration.mode`.
- Effective challenge precedence is `challengeAutomationMode` with `run > session > config`.
- `off` keeps detection and reporting active but stands down challenge actions.
- `browser` enables only browser-native lanes and forces the helper bridge to stand down.
- `browser_with_helper` preserves browser-first lane ordering and only evaluates the browser-scoped helper bridge when hard gates pass.
- The helper bridge is browser-scoped and is not a desktop agent.
- Cookie diagnostics are exposed in workflow metrics under `meta.metrics.cookie_diagnostics` and `meta.metrics.cookieDiagnostics`.
- Shopping providers that return zero usable offer records now emit `meta.failures[*].error.reasonCode=env_limited` instead of silently counting as success.

### Artifact lifecycle cleanup

Use the artifact cleanup command to remove expired bundles generated by workflow runs:

```bash
npx opendevbrowser artifacts cleanup --expired-only
npx opendevbrowser artifacts cleanup --expired-only --output-dir /tmp/opendevbrowser
```

Script helper:

```bash
./scripts/artifacts-cleanup.sh
./scripts/artifacts-cleanup.sh /tmp/opendevbrowser
```

Notes:
- `--expired-only` is required.
- Default cleanup root is `${TMPDIR:-/tmp}/opendevbrowser`. To clean workspace-local workflow artifacts, pass `--output-dir ./.opendevbrowser`.
- Output includes `removed` and `skipped` run paths.

### Run (single-shot script)

Run a JSON script without the daemon.

```bash
npx opendevbrowser run --script ./script.json --output-format json

# Or pipe JSON
cat ./script.json | npx opendevbrowser run --output-format stream-json

# Optional launch flags for run
npx opendevbrowser run --script ./script.json --headless --profile default --start-url https://example.com
npx opendevbrowser run --script ./script.json --chrome-path "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --flag "--disable-gpu"
```

Supported `run` launch flags:
- `--headless`
- `--profile`
- `--persist-profile`
- `--chrome-path`
- `--start-url`
- `--flag` (repeatable)

`--chrome-path` accepts Google Chrome, Chromium, or a Playwright-installed Chrome for Testing binary when you need a deterministic automation browser.

Script format:

```json
[
  { "action": "goto", "args": { "url": "https://example.com" } },
  { "action": "snapshot" },
  { "action": "click", "args": { "ref": "r1" } }
]
```

---

## Session commands (daemon required)

### Launch

```bash
npx opendevbrowser launch --profile default --start-url https://example.com

# Extension relay controls
npx opendevbrowser launch --extension-only
npx opendevbrowser launch --no-extension
npx opendevbrowser launch --extension-legacy
npx opendevbrowser launch --wait-for-extension --wait-timeout-ms 30000
```

Flags:
- `--headless`
- `--profile`
- `--start-url`
- `--chrome-path`
- `--persist-profile`
- `--flag` (repeatable)
- `--no-extension`
- `--extension-only`
- `--extension-legacy`
- `--wait-for-extension`
- `--wait-timeout-ms`

Default behavior:
- Extension relay (`extension` mode) is the default when available, using the `/ops` WebSocket.
- If the extension is not connected, launch fails with guidance and exact commands for the explicit alternatives.
- Headless is never the default.
- Extension headless is unsupported. `launch --headless` must be paired with `--no-extension`; extension-intent headless requests fail with `unsupported_mode`.
- When hub mode is enabled, there is no local relay fallback. If the hub is unavailable, commands fail with guidance.
- Extension relay requires Chrome 125+ (flat CDP sessions).
- Managed and `cdpConnect` sessions automatically try to bootstrap readable cookies from the discovered system Chrome-family profile before first navigation. Extension mode reuses the already logged-in tab or profile instead of importing cookies.
- For isolated automation harnesses that rely on browser startup flags such as `--disable-extensions-except`, prefer Chromium or Chrome for Testing. Google Chrome stable may ignore those flags.

Interactive vs non-interactive:
- Interactive CLI (TTY): you will be prompted to connect the extension, then explicitly choose Managed or CDPConnect if you want to proceed.
- Non-interactive (agents/CI): the command fails fast and prints the exact commands to run for Managed or CDPConnect.
- If `status --daemon` shows `ext=on` but `handshake=off`, reopen the extension popup and click Connect again to re-establish a clean daemon-extension handshake before retrying extension-mode work.

### Connection flags & status semantics

| Flag / Status | Meaning | Notes |
|---|---|---|
| `--no-extension` | Force managed mode | Bypasses relay and extension entirely. |
| `--extension-only` | Require extension mode | Fails if extension is not connected/handshaken. |
| `--extension-legacy` | Use legacy extension relay | Routes through relay `/cdp` instead of `/ops`. |
| `--wait-for-extension` | Wait for extension handshake | Only applies to extension mode; waits up to `--wait-timeout-ms`. |
| `--wait-timeout-ms` | Max wait for extension | Defaults to 30s. |
| `extensionConnected` | Extension websocket connected | `false` means popup isn’t connected to relay. |
| `extensionHandshakeComplete` | Extension handshake done | `false` means reconnect/repair from popup. |
| `annotationConnected` | Active `/annotation` client attached | Expected `false` unless annotate relay transport is active. |
| `opsConnected` | Active `/ops` client attached | Presence-only signal; it does not prove the current extension target is owned by `/ops`. |
| `canvasConnected` | Active `/canvas` client attached | Expected `false` unless a design-canvas session is using relay preview/overlay features. |
| `cdpConnected` | Active `/cdp` client attached | Expected `false` until a legacy `/cdp` session connects. |
| `pairingRequired` | Relay token required | When `true`, `/ops`, `/canvas`, `/annotation`, and `/cdp` require a token (auto-fetched). |

### Connect

```bash
npx opendevbrowser connect --ws-endpoint ws://127.0.0.1:9222/devtools/browser/...
npx opendevbrowser connect --host 127.0.0.1 --cdp-port 9222
```

This command starts a `cdpConnect` session (attach to an existing Chrome with remote debugging enabled).
If the `--ws-endpoint` points at the local relay (for example `ws://127.0.0.1:8787` or `ws://127.0.0.1:8787/ops`),
the CLI will normalize to `/ops` and route through the extension relay (`extension` mode).
Use `--extension-legacy` if you need the legacy `/cdp` relay path.
When routing through the relay, the CLI automatically fetches relay config and the pairing token (if required) and authenticates
the `/ops` or `/cdp` connection. Direct relay websocket connections without a token are rejected when pairing is enabled.
Direct `cdpConnect` sessions use the same automatic Chrome-family cookie bootstrap path as managed launches.

### Relay binding queue

Hub binding is exclusive only for binding/legacy paths (for example `/cdp` and commands that require a binding). Additional clients are queued FIFO and wait up to 30s by default.
If you see `RELAY_WAIT_TIMEOUT`, retry after the current binding expires or stop the other bound client.

Relay behavior note: extension uses a single extension websocket, while the relay can serve multiple `/ops` clients. Disconnecting the extension or restarting the relay drops active sessions, including annotation flows. Reconnect via the popup (or restart the daemon) before retrying.

### Concurrency semantics

- Transport-level concurrency: `/ops` supports multi-client access and multiple sessions.
- Runtime scheduling uses `ExecutionKey = (sessionId, targetId)` with target-scoped queues.
- Same target stays FIFO; different targets in one session run in parallel up to `effectiveParallelCap`.
- `session-per-worker` remains the safest baseline for simple operational isolation, but in-session multi-target parallelism is supported on `/ops`, managed, and `cdpConnect`.
- Use explicit `--target-id` routing for concurrent flows; treat `target-use` as ergonomic fallback only.
- Use `/ops` as the default concurrent relay channel. Use `--extension-legacy` (`/cdp`) only for compatibility-specific paths.
- Legacy `/cdp` does not coexist with an active `/ops` lease. If launch fails with `cdp_attach_blocked`, disconnect the `/ops` session and retry `--extension-legacy`.
- Legacy `/cdp` stays sequential (`effectiveParallelCap=1`) by design.
- For managed parallel launches with persisted profiles, use unique profile directories per session (or disable persistence) to avoid ProcessSingleton/SingletonLock collisions.
- Parity divergences are registry-bound in `docs/PARITY_DECLARED_DIVERGENCES.md`.

### Disconnect

```bash
npx opendevbrowser disconnect --session-id <session-id>
npx opendevbrowser disconnect --session-id <session-id> --close-browser
```

### Status

```bash
npx opendevbrowser status               # daemon status (default)
npx opendevbrowser status --daemon      # daemon status (explicit)
npx opendevbrowser status --session-id <session-id>
npx opendevbrowser status --transport native
```

### Status capabilities

```bash
npx opendevbrowser status-capabilities
npx opendevbrowser status-capabilities --session-id <session-id> --target-id <target-id> --challenge-automation-mode browser_with_helper --timeout-ms 30000
```

Notes:
- `status-capabilities` can inspect host capability discovery without a session, or add `--session-id` to include session-scoped browser and policy state.
- `--challenge-automation-mode` lets you preview the effective browser-scoped computer-use mode and source before running a workflow.

### Cookie import

```bash
npx opendevbrowser cookie-import \
  --session-id <session-id> \
  --cookies '[{"name":"session","value":"abc123","url":"https://example.com"}]'

npx opendevbrowser cookie-import \
  --session-id <session-id> \
  --cookies-file ./cookies.json \
  --strict=false \
  --request-id req-cookie-001
```

Notes:
- Provide exactly one cookies source: `--cookies` or `--cookies-file`.
- `--strict` defaults to `true`.
- Managed and `cdpConnect` sessions already attempt Chrome-family cookie bootstrap on session creation; use `cookie-import` when you need to add or override cookies explicitly.
- Supported across `managed`, default extension `/ops`, extension legacy `/cdp`, and direct `cdpConnect` sessions.

### Cookie list

```bash
npx opendevbrowser cookie-list \
  --session-id <session-id>

npx opendevbrowser cookie-list \
  --session-id <session-id> \
  --url https://example.com \
  --url https://shop.example.com \
  --request-id req-cookie-list-001
```

Notes:
- `--url` is optional and repeatable; each value is normalized and deduplicated.
- Supports `managed`, default extension `/ops`, extension legacy `/cdp`, and direct `cdpConnect` sessions.

### Macro resolve

```bash
npx opendevbrowser macro-resolve --expression '@web.search("openai")'
npx opendevbrowser macro-resolve --expression '@social.post("x", "ship it")' --default-provider social/x --include-catalog
npx opendevbrowser macro-resolve --expression '@web.search("opendevbrowser")' --execute --output-format json
npx opendevbrowser macro-resolve --expression '@media.search("youtube transcript parity", "youtube", 5)' --execute --timeout-ms 120000 --output-format json
npx opendevbrowser macro-resolve --expression '@community.search("browser automation failures", 4)' --execute --browser-mode extension --challenge-automation-mode browser_with_helper --output-format json
```

Notes:
- Default mode is resolve-only (returns the resolved action/provenance payload).
- `--execute` runs the resolved provider action and returns additive execution metadata (`meta.tier.selected`, `meta.tier.reasonCode`, `meta.provenance.provider`, `meta.provenance.retrievalPath`, `meta.provenance.retrievedAt`).
- Resolve-only and execute responses now both emit `followthroughSummary`, `suggestedNextAction`, and `suggestedSteps` so the next rerun command stays explicit even when execution blocks.
- `--timeout-ms` sets client-side daemon transport timeout for slow `--execute` runs.
- `--browser-mode` is accepted for `--execute` runs and maps signed-in provider recovery to the same `auto|extension|managed` modes as workflow commands.
- `--challenge-automation-mode` is accepted for `--execute` runs and maps to `challengeAutomationMode` with the same `run > session > config` precedence as workflow commands.
- `opendevbrowser --help` includes this timeout flag in the global flag inventory.

### Blocker contract (v2)

Compatibility rule (v2):
- Blocker fields are additive-only and live under `meta.blocker` (or `execution.meta.blocker` for `macro-resolve --execute`).
- Existing success/error fields and codes remain unchanged.
- Consumers should treat missing blocker fields as backward-compatible `no blocker metadata`.

Canonical placement:
- `goto`: `data.meta.blockerState` + optional `data.meta.blocker`.
- `wait`: `data.meta.blockerState` + optional `data.meta.blocker`.
- `debug-trace-snapshot`: `data.meta.blockerState` + optional `data.meta.blocker` + optional `data.meta.blockerArtifacts`.
- `macro-resolve --execute`: `data.execution.meta.ok` + optional `data.execution.meta.blocker`.
- `status`: `data.meta.blockerState` + optional `data.meta.blockerResolution` (`resolved | unresolved | deferred`).

Canonical examples:

```json
{
  "command": "goto",
  "success": true,
  "data": {
    "finalUrl": "https://example.com",
    "status": 200,
    "timingMs": 412,
    "meta": {
      "blockerState": "clear"
    }
  }
}
```

```json
{
  "command": "goto",
  "success": true,
  "data": {
    "finalUrl": "https://x.com/i/flow/login",
    "status": 200,
    "timingMs": 588,
    "meta": {
      "blockerState": "active",
      "blocker": {
        "schemaVersion": "1.0",
        "type": "auth_required",
        "source": "navigation",
        "confidence": 0.97,
        "retryable": false
      }
    }
  }
}
```

```json
{
  "command": "wait",
  "success": true,
  "data": {
    "timingMs": 221,
    "meta": {
      "blockerState": "clear"
    }
  }
}
```

```json
{
  "command": "status",
  "success": true,
  "data": {
    "mode": "managed",
    "activeTargetId": "target-1",
    "url": "https://x.com/i/flow/login",
    "title": "Log in to X / X",
    "meta": {
      "blockerState": "active",
      "blockerResolution": {
        "status": "unresolved",
        "reason": "verification_timeout",
        "updatedAt": "2026-02-15T14:18:28.000Z"
      }
    }
  }
}
```

```json
{
  "command": "wait",
  "success": true,
  "data": {
    "timingMs": 1470,
    "meta": {
      "blockerState": "active",
      "blocker": {
        "schemaVersion": "1.0",
        "type": "anti_bot_challenge",
        "source": "navigation",
        "confidence": 0.96,
        "retryable": false
      }
    }
  }
}
```

```json
{
  "command": "debug-trace-snapshot",
  "success": true,
  "data": {
    "requestId": "req-debug-001",
    "meta": {
      "blockerState": "clear"
    }
  }
}
```

```json
{
  "command": "debug-trace-snapshot",
  "success": true,
  "data": {
    "requestId": "req-debug-002",
    "meta": {
      "blockerState": "active",
      "blocker": {
        "schemaVersion": "1.0",
        "type": "anti_bot_challenge",
        "source": "network",
        "confidence": 0.96,
        "retryable": false
      },
      "blockerArtifacts": {
        "schemaVersion": "1.0",
        "hosts": ["www.recaptcha.net", "challenges.cloudflare.com"]
      }
    }
  }
}
```

```json
{
  "command": "macro-resolve --execute",
  "success": true,
  "data": {
    "runtime": "macros",
    "execution": {
      "meta": {
        "ok": true,
        "partial": false
      }
    }
  }
}
```

```json
{
  "command": "macro-resolve --execute",
  "success": true,
  "data": {
    "runtime": "macros",
    "execution": {
      "meta": {
        "ok": false,
        "partial": true,
        "blocker": {
          "schemaVersion": "1.0",
          "type": "env_limited",
          "source": "macro_execution",
          "confidence": 0.9,
          "retryable": true
        }
      }
    }
  }
}
```

### Design Canvas

Use `canvas` to call the typed `canvas.*` surface through the daemon. The normal sequence is:
`canvas.session.open` -> inspect the handshake (`planStatus`, `preflightState`, `generationPlanRequirements.allowedValues`, `generationPlanIssues`, `guidance.recommendedNextCommands`) -> `canvas.plan.set` -> if accepted, follow returned guidance into `canvas.document.patch` (including `governance.update` blocks) -> `canvas.preview.render` -> `canvas.feedback.poll` -> `canvas.document.save` or `canvas.document.export`.
If `canvas.plan.set` fails with `generation_plan_invalid`, inspect the returned `details.missingFields` and `details.issues`, or re-read the current state with `canvas.plan.get` / `canvas.capabilities.get`, then resubmit `canvas.plan.set`. `canvas.plan.get` is diagnostic on that failure path, not a required success-path checkpoint.
Additional same-session clients use `canvas.session.attach` with `attachMode=observer` or `attachMode=lease_reclaim`.
Unless `params.repoRoot` is provided explicitly, the CLI injects the caller cwd as the canvas session repo root. Relative `canvas.document.save`, `canvas.document.export`, and `canvas.code.*` paths resolve against that session root even when the daemon is launchd-owned or started from another working directory.

```bash
# Open a canvas session bound to an existing browser session
npx opendevbrowser canvas --command canvas.session.open \
  --params '{"browserSessionId":"<session-id>","documentId":"landing-page","mode":"dual-track"}' \
  --output-format json

# Submit a generation plan (required before patching)
npx opendevbrowser canvas --command canvas.plan.set --params-file ./canvas-plan.json --output-format json

# Apply a patch batch against a specific revision, including governance blocks required before save
npx opendevbrowser canvas --command canvas.document.patch \
  --params '{"canvasSessionId":"<canvas-session-id>","leaseId":"<lease-id>","baseRevision":1,"patches":[{"op":"governance.update","block":"intent","changes":{"summary":"Marketing landing page refresh"}},{"op":"governance.update","block":"designLanguage","changes":{"profile":"clean-room"}},{"op":"page.create","page":{"id":"page_home","rootNodeId":null,"name":"Home","path":"/","description":"Marketing landing page"}}]}' \
  --output-format json

# Save the canonical design document back into the repo
npx opendevbrowser canvas --command canvas.document.save \
  --params '{"canvasSessionId":"<canvas-session-id>","leaseId":"<lease-id>"}' \
  --output-format json
```

`canvas.session.open` returns a handshake with `canvasSessionId`, `leaseId`, governance block states, required generation-plan fields, `generationPlanRequirements.allowedValues`, runtime budgets, warning classes, `generationPlanIssues`, `mutationPolicy.allowedBeforePlan`, and `guidance.recommendedNextCommands`. Treat `planStatus="missing"` with `preflightState="handshake_read"` as "submit a plan next." Treat `planStatus="invalid"` with `preflightState="plan_invalid"` as "fix the reported plan issues before mutation." A successful `canvas.plan.set` response is authoritative enough to proceed: it already returns accepted state plus next-step guidance, so `canvas.plan.get` is only needed when diagnosing invalid-plan responses or re-reading current state after attach. `canvas.document.patch` is blocked until `canvas.plan.set` succeeds. `canvas.document.save` and `canvas.document.export` return `policy_violation` until all `requiredBeforeSave` governance blocks are present. `canvas.document.import` now imports Figma file URLs, node URLs, or raw file-key inputs into the same lease-governed document surface; it resolves auth from `FIGMA_ACCESS_TOKEN` first and `integrations.figma.accessToken` second, caches image and SVG receipts under `.opendevbrowser/canvas/assets/figma/<fileKey>/`, records provenance in `document.meta.imports[]`, and degrades `variables/local` failures with typed feedback (`scope_denied`, `plan_limited`, `account_limited`, or `variables_unavailable`) instead of opaque fatal errors. `canvas.history.undo` and `canvas.history.redo` are now public lease-governed mutations; they are unavailable before the first accepted-plan edit, require the active lease holder, and invalidate deterministically when document revision drift makes the recorded stack stale. In extension mode, `canvas.tab.open` opens an extension-hosted `canvas.html` infinite-canvas editor that persists full page state in `IndexedDB`, converges same-origin tabs through `BroadcastChannel`, forwards editor-originated patch requests through `/canvas`, exposes pages/layers/properties/history controls plus keyboard shortcuts, and keeps freeform region annotation scoped to the extension-hosted stage. `canvas.feedback.poll` remains the snapshot query for cursor-based audits, and when the plan is still missing or invalid it synthesizes the same preflight blocker agents see from mutation commands. `canvas.feedback.subscribe`, `canvas.feedback.next`, and `canvas.feedback.unsubscribe` now expose the public pull-stream contract. In `stream-json` mode, the CLI emits `initialItems`, then loops on `canvas.feedback.next` until `feedback.complete` or CLI timeout, and finally best-effort calls `canvas.feedback.unsubscribe`. `canvas.inventory.list` now returns the merged reusable inventory surface: document-backed promoted items plus the shipped built-in kit catalog entries. `canvas.inventory.insert` materializes either kind of inventory template back onto the stage as a governed mutation. `canvas.starter.list` exposes the eight shipped built-in starters, and `canvas.starter.apply` now seeds a generation plan when needed, merges built-in kit token collections, installs required kit inventory entries into the live document, and inserts a starter shell with semantic fallback when the requested framework or adapter is unavailable. For starter application, prefer `libraryAdapterId` when selecting or reading the resolved built-in kit adapter; the legacy `adapterId` field remains as a backward-compatible alias and is distinct from code-sync `frameworkAdapterId`. The public `/canvas` surface is now `35` commands. The tool wrapper stays thin and uses the same public `opendevbrowser_canvas` commands through repeated calls.
`canvas.code.bind`, `canvas.code.unbind`, `canvas.code.pull`, `canvas.code.push`, `canvas.code.status`, and `canvas.code.resolve` add framework-adapter-backed code sync on top of the same session. Built-in lanes currently ship for `builtin:react-tsx-v2`, `builtin:html-static-v1`, `builtin:custom-elements-v1`, `builtin:vue-sfc-v1`, and `builtin:svelte-sfc-v1`; legacy `tsx-react-v1` bindings and manifests migrate on load to `builtin:react-tsx-v2` instead of failing ambiguously. Bound source manifests are stored under `.opendevbrowser/canvas/code-sync/<documentId>/<bindingId>.json`; preview targets default to projected `canvas_html` and only attempt `bound_app_runtime` reconciliation when the binding opts in and runtime bridge preflight succeeds. `canvas.code.status` returns `frameworkAdapterId`, `frameworkId`, `sourceFamily`, declared/granted capabilities, explicit denial entries, and deterministic `reasonCode` values such as `framework_migrated`, `manifest_migrated`, `plugin_not_found`, and `plugin_load_failed`. Repo-local BYO adapter plugins are discovered from workspace `package.json`, `.opendevbrowser/canvas/adapters.json`, and explicit local config declarations only; declaration-level `capabilityOverrides` narrow plugin capabilities rather than widening them. See `docs/CANVAS_ADAPTER_PLUGIN_CONTRACT.md` for the plugin manifest and trust model, and `node scripts/canvas-competitive-validation.mjs --out <report.json>` for the grouped canvas validator.

### RPC (power-user, internal)

Execute any daemon command directly. This bypasses the stable CLI command surface, is intentionally unsafe/internal, and requires `--unsafe-internal`.

```bash
# Minimal call (empty params object)
npx opendevbrowser rpc --unsafe-internal --name relay.status --output-format json

# With inline JSON params
npx opendevbrowser rpc --unsafe-internal --name nav.goto \
  --params '{"sessionId":"<session-id>","url":"https://example.com","waitUntil":"load","timeoutMs":30000}' \
  --timeout-ms 45000 --output-format json

# With params from file
npx opendevbrowser rpc --unsafe-internal --name session.status --params-file ./rpc-params.json --output-format json
```

Notes:
- Params must be a JSON object.
- Use `--output-format json` for machine-readable responses.
- `rpc` is CLI-only by design and is not part of the stable tool parity surface.
- `rpc` command names/params are internal and may change without compatibility guarantees.
- A bad `rpc` call can close sessions, navigate logged-in tabs, or trigger unintended side effects.
- Prefer stable commands (`goto`, `snapshot`, `click`, `type`, and related tool equivalents) whenever possible.
- Use `rpc` only when necessary, validate params carefully, and test in a disposable session first.

---

## Navigation commands (daemon required)

### Goto

```bash
npx opendevbrowser goto --session-id <session-id> --url https://example.com
npx opendevbrowser goto --session-id <session-id> --url https://example.com --wait-until load --timeout-ms 30000
```

### Wait

```bash
npx opendevbrowser wait --session-id <session-id> --until load
npx opendevbrowser wait --session-id <session-id> --ref r12 --state visible --timeout-ms 15000
```

### Snapshot

```bash
npx opendevbrowser snapshot --session-id <session-id>
npx opendevbrowser snapshot --session-id <session-id> --max-chars 16000 --cursor <cursor>
```

### Review

Use `review` as the explicit `snapshot -> review -> action` step when you want the active target summary plus a fresh actionables capture in one response.

```bash
npx opendevbrowser review --session-id <session-id>
npx opendevbrowser review --session-id <session-id> --target-id <target-id> --max-chars 16000 --cursor <cursor>
```

### Review desktop

Use `review-desktop` when you want the browser-owned review payload plus read-only desktop observation evidence in one correlated response.

```bash
npx opendevbrowser review-desktop --session-id <session-id> --reason "compare browser review with visible desktop state"
npx opendevbrowser review-desktop --session-id <session-id> --target-id <target-id> --reason "audit active target" --max-chars 16000 --cursor <cursor>
```

Notes:
- `review-desktop` keeps authority in the review family and augments it with public desktop observation evidence.
- Use `--reason` when you want explicit audit context recorded alongside the correlated desktop evidence.

---

## Interaction commands (daemon required)

### Click

```bash
npx opendevbrowser click --session-id <session-id> --ref r12 [--timeout-ms <ms>]
```

Notes:
- `--timeout-ms` sets the client-side daemon timeout for the click request.
- Without `--timeout-ms`, `click` uses a 60s client-side daemon timeout so blocking browser dialogs can be inspected and handled without the opener expiring immediately.

### Hover

```bash
npx opendevbrowser hover --session-id <session-id> --ref r12
```

### Press

```bash
npx opendevbrowser press --session-id <session-id> --key Enter
npx opendevbrowser press --session-id <session-id> --key Enter --ref r12
```

### Check / Uncheck

```bash
npx opendevbrowser check --session-id <session-id> --ref r12
npx opendevbrowser uncheck --session-id <session-id> --ref r12
```

### Type

```bash
npx opendevbrowser type --session-id <session-id> --ref r12 --text "hello"
npx opendevbrowser type --session-id <session-id> --ref r12 --text "hello" --clear --submit
```

### Select

```bash
npx opendevbrowser select --session-id <session-id> --ref r12 --values value1,value2
```

### Scroll

```bash
npx opendevbrowser scroll --session-id <session-id> --dy 500
npx opendevbrowser scroll --session-id <session-id> --ref r12 --dy 300
```

### Scroll into view

```bash
npx opendevbrowser scroll-into-view --session-id <session-id> --ref r12
```

### Upload

```bash
npx opendevbrowser upload --session-id <session-id> --ref r12 --files ./avatar.png
npx opendevbrowser upload --session-id <session-id> --target-id <target-id> --ref r12 --files ./front.png,./back.png
```

Notes:
- `--files` accepts a comma-separated list of host file paths.
- Upload resolves the target from the existing ref model and reports `mode` as `direct_input` or `file_chooser`.

---

## Annotation (direct + relay)

Annotations are available through both the CLI command and the `opendevbrowser_annotate` tool. The default transport (`auto`)
uses direct CDP when possible and falls back to relay in extension sessions. `annotate --stored` resolves the shared repo-local
agent inbox first, then the extension-local stored payload fallback. See `docs/ANNOTATE.md` for setup and details.

```bash
npx opendevbrowser annotate --session-id <session-id>

# Force direct annotate on a target
npx opendevbrowser annotate --session-id <session-id> --transport direct --target-id <target-id>

# Force relay annotate on a specific tab
npx opendevbrowser annotate --session-id <session-id> --transport relay --tab-id 123

# With URL + context + debug metadata
npx opendevbrowser annotate --session-id <session-id> --url https://example.com \
  --screenshot-mode visible --context "Review the hero layout" --timeout-ms 90000 --debug

# Return the last stored annotation payload
npx opendevbrowser annotate --session-id <session-id> --stored

# Prefer the extension-local in-memory stored payload with screenshots when still available
npx opendevbrowser annotate --session-id <session-id> --stored --include-screenshots
```

---

## Target commands (daemon required)

### Targets list

```bash
npx opendevbrowser targets-list --session-id <session-id>
npx opendevbrowser targets-list --session-id <session-id> --include-urls
```

### Target use

```bash
npx opendevbrowser target-use --session-id <session-id> --target-id <target-id>
```

### Target new

```bash
npx opendevbrowser target-new --session-id <session-id> --url https://example.com
```

### Target close

```bash
npx opendevbrowser target-close --session-id <session-id> --target-id <target-id>
```

---

## Page commands (daemon required)

### Page open

```bash
npx opendevbrowser page --session-id <session-id> --name main
npx opendevbrowser page --session-id <session-id> --name main --url https://example.com
```

### Pages list

```bash
npx opendevbrowser pages --session-id <session-id>
```

### Page close

```bash
npx opendevbrowser page-close --session-id <session-id> --name main
```

---

## DOM commands (daemon required)

### DOM HTML

```bash
npx opendevbrowser dom-html --session-id <session-id> --ref r12 --max-chars 8000
```

### DOM Text

```bash
npx opendevbrowser dom-text --session-id <session-id> --ref r12 --max-chars 8000
```

### DOM Attribute

```bash
npx opendevbrowser dom-attr --session-id <session-id> --ref r12 --attr aria-label
```

### DOM Value

```bash
npx opendevbrowser dom-value --session-id <session-id> --ref r12
```

### DOM State Checks

```bash
npx opendevbrowser dom-visible --session-id <session-id> --ref r12
npx opendevbrowser dom-enabled --session-id <session-id> --ref r12
npx opendevbrowser dom-checked --session-id <session-id> --ref r12
```

---

## Export commands (daemon required)

### Clone page

```bash
npx opendevbrowser clone-page --session-id <session-id>
```

### Clone component

```bash
npx opendevbrowser clone-component --session-id <session-id> --ref r12
```

---

## Devtools commands (daemon required)

### Performance metrics

```bash
npx opendevbrowser perf --session-id <session-id>
```

### Screenshot

```bash
npx opendevbrowser screenshot --session-id <session-id>
npx opendevbrowser screenshot --session-id <session-id> --path ./capture.png
npx opendevbrowser screenshot --session-id <session-id> --ref r12
npx opendevbrowser screenshot --session-id <session-id> --full-page
npx opendevbrowser screenshot --session-id <session-id> --path ./capture.png --timeout-ms 60000
```

Notes:
- `--ref` and `--full-page` are mutually exclusive.
- `--timeout-ms` sets client-side daemon timeout for screenshot capture.
- Default visible capture may still report the existing viewport-only fallback warning when extension capture has to degrade, but ref and full-page requests do not silently reuse that fallback.

### Screencast start

```bash
npx opendevbrowser screencast-start --session-id <session-id>
npx opendevbrowser screencast-start \
  --session-id <session-id> \
  --target-id <target-id> \
  --output-dir ./artifacts/replay \
  --interval-ms 1000 \
  --max-frames 120
```

Notes:
- `screencast-start` is a manager-owned browser replay lane layered on the existing screenshot primitive.
- The recorder writes `replay.json`, `replay.html`, `frames/`, and `preview.png` into the chosen output directory.
- `--interval-ms` defaults to `1000` and must be at least `250`.
- `--max-frames` defaults to `300`.

### Screencast stop

```bash
npx opendevbrowser screencast-stop --session-id <session-id> --screencast-id <screencast-id>
```

Notes:
- `--session-id` and `--screencast-id` are both required.
- `--screencast-id` must match the id returned by `screencast-start` for that same session.
- Stop returns the final artifact metadata, including replay paths and the terminal `endedReason`.

### Dialog

```bash
npx opendevbrowser dialog --session-id <session-id>
npx opendevbrowser dialog --session-id <session-id> --action dismiss
npx opendevbrowser dialog --session-id <session-id> --action accept --prompt-text "Ship it"
```

Notes:
- `--action` supports `status`, `accept`, and `dismiss`.
- `--prompt-text` is only valid when `--action accept` is used for a prompt dialog.
- `--timeout-ms` sets the client-side daemon timeout for the dialog request.
- Without `--timeout-ms`, `dialog` uses a 30s client-side daemon timeout.

### Console poll

```bash
npx opendevbrowser console-poll --session-id <session-id> --since-seq 0 --max 50
```

### Network poll

```bash
npx opendevbrowser network-poll --session-id <session-id> --since-seq 0 --max 50
```

### Debug trace snapshot

```bash
npx opendevbrowser debug-trace-snapshot --session-id <session-id>
npx opendevbrowser debug-trace-snapshot \
  --session-id <session-id> \
  --since-console-seq 100 \
  --since-network-seq 80 \
  --since-exception-seq 10 \
  --max 200 \
  --request-id req-debug-001
```

### Session inspector

```bash
npx opendevbrowser session-inspector --session-id <session-id>
npx opendevbrowser session-inspector \
  --session-id <session-id> \
  --include-urls \
  --since-console-seq 100 \
  --since-network-seq 80 \
  --since-exception-seq 10 \
  --max 50 \
  --request-id req-session-inspector-001
```

Notes:
- Returns session status, relay health, target summary, proof artifact metadata, `healthState`, and a suggested next action in one payload.
- `--include-urls` keeps target URLs in the target summary. Omit it to use the default runtime behavior.
- `--since-console-seq`, `--since-network-seq`, `--since-exception-seq`, and `--max` mirror the trace cursors used by `debug-trace-snapshot`.

### Session inspector plan

```bash
npx opendevbrowser session-inspector-plan --session-id <session-id>
npx opendevbrowser session-inspector-plan --session-id <session-id> --target-id <target-id> --challenge-automation-mode browser_with_helper --timeout-ms 30000
```

Notes:
- Returns browser-scoped computer-use policy, eligibility, stand-down reasons, yield state, and safe suggested steps without running a provider workflow.
- `--challenge-automation-mode` lets you inspect the effective mode you want to compare against current session or config defaults.

### Session inspector audit

```bash
npx opendevbrowser session-inspector-audit --session-id <session-id> --reason "capture correlated operator audit"
npx opendevbrowser session-inspector-audit --session-id <session-id> --target-id <target-id> --reason "trace challenge state" --include-urls --request-id req-session-audit-001 --challenge-automation-mode browser_with_helper
```

Notes:
- Returns a correlated audit bundle across desktop evidence, browser review, session status, and browser-scoped policy state.
- `--reason`, `--request-id`, trace cursors, and `--include-urls` mirror the session-inspector and review audit lanes in one surface.

---

## Desktop observation commands (daemon required)

These commands expose the sibling `DesktopRuntimeLike` observation plane directly. They are read-only, return audit metadata on both success and failure, and are gated by separate `desktop.*` config plus local OS permissions.

### Desktop status

```bash
npx opendevbrowser desktop-status
```

### Desktop windows

```bash
npx opendevbrowser desktop-windows --reason "inspect visible windows before capture"
```

### Desktop active window

```bash
npx opendevbrowser desktop-active-window --reason "inspect current foreground window"
```

### Desktop capture desktop

```bash
npx opendevbrowser desktop-capture-desktop --reason "capture current desktop surface"
```

### Desktop capture window

```bash
npx opendevbrowser desktop-capture-window --window-id <window-id> --reason "capture a specific window"
```

### Desktop accessibility snapshot

```bash
npx opendevbrowser desktop-accessibility-snapshot --reason "capture accessibility tree"
npx opendevbrowser desktop-accessibility-snapshot --window-id <window-id> --reason "capture one window accessibility tree"
```

Notes:
- On supported macOS hosts, availability, window inventory, and accessibility probes require the local `swift` command. If `desktop-status` returns `desktop_unsupported` on macOS, install Xcode or a Swift toolchain and retry.
- Desktop screenshots use macOS `screencapture`.
- `desktop-status` reports availability, permissions, capabilities, and the configured audit artifacts directory.
- `desktop-windows` and `desktop-active-window` accept optional `--reason` values for audit context.
- `desktop-capture-desktop`, `desktop-capture-window`, and `desktop-accessibility-snapshot` require `--reason`.
- `desktop-capture-window` requires `--window-id`.
- `desktop-accessibility-snapshot` accepts an optional `--window-id`.
- This plane is public and observe-only. It is not a desktop agent and does not create a desktop `/ops` family.

---

## Flags reference

### Global flags

| Flag | Short | Description |
|------|-------|-------------|
| `--global` | `-g` | Install to `~/.config/opencode/opencode.json` |
| `--local` | `-l` | Install to `./opencode.json` |
| `--update` | `-u` | Clear cache to trigger reinstall |
| `--uninstall` | | Remove plugin from config and clean managed skills |
| `--with-config` | | Also create `opendevbrowser.jsonc` |
| `--full` | `-f` | Create config and pre-extract extension assets |
| `--no-prompt` | | Skip prompts, use defaults |
| `--no-interactive` | | Alias of `--no-prompt` |
| `--quiet` | | Suppress output |
| `--output-format` | | `text`, `json`, or `stream-json` |
| `--transport` | | Transport selector for transport-aware commands (`status`: `relay|native`; `annotate`: `auto|direct|relay`) |
| `--daemon` | | Daemon status selector for `status` |
| `--skills-global` | | Install skills to global OpenCode/Codex/ClaudeCode/AmpCLI directories |
| `--skills-local` | | Install skills to project-local OpenCode/Codex/ClaudeCode/AmpCLI directories |
| `--no-skills` | | Skip installing bundled skills |
| `--help` | `-h` | Show usage information |
| `--version` | `-v` | Show version number |

### Serve flags

| Flag | Description |
|------|-------------|
| `--port` | Override daemon port |
| `--token` | Override daemon token |
| `--stop` | Stop the daemon |

### Command-specific flags

**Session + connection**

| Flag | Used by | Description |
|------|---------|-------------|
| `--session-id` | most daemon commands | Active session id from `launch`/`connect` |
| `--close-browser` | `disconnect` | Close managed browser on disconnect |
| `--ws-endpoint` | `connect` | Remote debugging websocket URL |
| `--host` | `connect` | Host for CDP connection (`--cdp-port` required) |
| `--cdp-port` | `connect` | CDP port for host-based connect |
| `--daemon` | `status` | Force daemon status mode (mutually exclusive with `--session-id`) |
| `--no-extension` | `launch` | Force managed mode (ignore extension) |
| `--extension-only` | `launch` | Fail if extension not connected |
| `--extension-legacy` | `launch`, `connect` | Use legacy extension relay (`/cdp`) |
| `--wait-for-extension` | `launch` | Wait for extension handshake |
| `--wait-timeout-ms` | `launch` | Max wait for extension handshake |
| `--cookies` | `cookie-import` | Inline JSON array of cookie objects |
| `--cookies-file` | `cookie-import` | Path to JSON file containing cookie objects |
| `--strict` | `cookie-import` | Reject on invalid cookie entries (`true`/`false`) |
| `--request-id` | `cookie-import`, `cookie-list`, `debug-trace-snapshot`, `session-inspector`, `session-inspector-audit` | Optional request correlation id |
| `--expression` | `macro-resolve` | Macro expression to resolve |
| `--default-provider` | `macro-resolve` | Provider fallback for shorthand macros |
| `--include-catalog` | `macro-resolve` | Include macro catalog in response |
| `--execute` | `macro-resolve` | Execute the resolved provider action and include additive `meta.*` fields |
| `--timeout-ms` | `macro-resolve` | Client-side daemon call timeout in ms |
| `--browser-mode` | `research run`, `shopping run`, `product-video run`, `inspiredesign run`, `macro-resolve --execute` | Provider browser transport mode (`auto|extension|managed`); `extension` reuses relay-backed signed-in browser state, `managed` runs a deterministic managed browser |
| `--use-cookies` | `research run`, `shopping run`, `product-video run`, `inspiredesign run` | Enable/disable provider cookie injection for the run (`true|false`; bare flag means `true`) |
| `--challenge-automation-mode` | `research run`, `shopping run`, `product-video run`, `inspiredesign run`, `macro-resolve --execute`, `status-capabilities`, `session-inspector-plan`, `session-inspector-audit` | Per-run or inspection challenge automation override stored as `challengeAutomationMode` (`off|browser|browser_with_helper`) with `run > session > config` precedence |
| `--cookie-policy-override` | `research run`, `shopping run`, `product-video run`, `inspiredesign run` | Per-run provider cookie policy override (`off|auto|required`) |
| `--cookie-policy` | `research run`, `shopping run`, `product-video run`, `inspiredesign run` | Alias of `--cookie-policy-override` |

**Browser launch (launch/run)**

| Flag | Used by | Description |
|------|---------|-------------|
| `--headless` | `launch`, `run` | Run managed Chrome headless |
| `--profile` | `launch`, `run` | Profile directory name |
| `--persist-profile` | `launch`, `run` | Keep profile directory after run |
| `--chrome-path` | `launch`, `run` | Explicit Chrome executable path |
| `--start-url` | `launch`, `run` | Initial URL for the session |
| `--flag` | `launch`, `run` | Additional Chrome flag (repeatable) |
| `--script` | `run` | JSON script path |

**Navigation + waiting**

| Flag | Used by | Description |
|------|---------|-------------|
| `--url` | `goto`, `page`, `target-new`, `cookie-list` | URL to navigate/open or filter cookie listing |
| `--wait-until` | `goto` | Load state (`load`, `domcontentloaded`, etc.) |
| `--timeout-ms` | `goto`, `wait`, `review`, `review-desktop`, `status-capabilities`, `session-inspector-plan`, `session-inspector-audit` | Timeout in ms |
| `--ref` | `wait` | Element ref to wait for |
| `--state` | `wait` | Element state (e.g. `visible`) |
| `--until` | `wait` | Page load state |
| `--mode` | `snapshot` | Snapshot mode (`outline` or `actionables`) |
| `--target-id` | `review`, `review-desktop`, `status-capabilities`, `session-inspector-plan`, `session-inspector-audit` | Optional target override for review or inspection payloads |
| `--max-chars` | `snapshot`, `review`, `review-desktop`, `session-inspector-audit`, `dom-*` | Max characters returned |
| `--cursor` | `snapshot`, `review`, `review-desktop`, `session-inspector-audit` | Snapshot pagination cursor |

**Annotation**

| Flag | Used by | Description |
|------|---------|-------------|
| `--transport` | `annotate` | `auto` (default), `direct`, or `relay` |
| `--target-id` | `annotate` | Target id for direct annotate |
| `--tab-id` | `annotate` | Chrome tab id for relay annotate |
| `--screenshot-mode` | `annotate` | `visible` (default), `full`, or `none` |
| `--include-screenshots` | `annotate` | When used with `--stored`, prefer the in-memory payload that still includes screenshots if available |
| `--context` | `annotate` | Optional context text pre-filled in the UI |
| `--debug` | `annotate` | Include debug metadata in the payload |
| `--stored` | `annotate` | Return the last stored annotation payload for the session |
| `--timeout-ms` | `annotate` | Annotation timeout in ms |

**Canvas**

| Flag | Used by | Description |
|------|---------|-------------|
| `--command` | `canvas` | `canvas.*` command name (for example `canvas.session.open`) |
| `--params` | `canvas` | Inline JSON object command params |
| `--params-file` | `canvas` | Path to JSON object command params |
| `--timeout-ms` | `canvas` | Client-side daemon call timeout in ms |

**RPC (internal)**

| Flag | Used by | Description |
|------|---------|-------------|
| `--unsafe-internal` | `rpc` | Required opt-in acknowledging unsafe/internal RPC execution (power-user only) |
| `--name` | `rpc` | Daemon command name (for example `relay.status`) |
| `--params` | `rpc` | Inline JSON object command params |
| `--params-file` | `rpc` | Path to JSON object params file |
| `--timeout-ms` | `rpc` | Client-side daemon call timeout in ms |

**Interaction**

| Flag | Used by | Description |
|------|---------|-------------|
| `--ref` | element commands | Element ref from `snapshot` |
| `--timeout-ms` | `click` | Client-side daemon call timeout in ms; defaults to 60s |
| `--text` | `type` | Text to type |
| `--clear` | `type` | Clear input before typing |
| `--submit` | `type` | Submit after typing |
| `--values` | `select` | Comma-separated values |
| `--files` | `upload` | Comma-separated file paths for upload |
| `--dy` | `scroll` | Scroll delta on Y axis |
| `--key` | `press` | Keyboard key name (e.g. `Enter`) |

**Targets + pages**

| Flag | Used by | Description |
|------|---------|-------------|
| `--target-id` | `target-use`, `target-close` | Target id from `targets-list` |
| `--include-urls` | `targets-list`, `session-inspector`, `session-inspector-audit` | Include URLs in target or session-inspector target-list output |
| `--name` | `page`, `page-close` | Named page identifier |

**Devtools**

| Flag | Used by | Description |
|------|---------|-------------|
| `--attr` | `dom-attr` | Attribute name to read |
| `--path` | `screenshot` | Output file path |
| `--ref` | `screenshot` | Capture an element screenshot by ref |
| `--full-page` | `screenshot` | Capture the full scrollable page |
| `--target-id` | `screencast-start` | Optional target override for screencast capture |
| `--output-dir` | `screencast-start` | Directory where screencast replay artifacts are written |
| `--interval-ms` | `screencast-start` | Frame capture interval in ms (minimum `250`) |
| `--max-frames` | `screencast-start` | Maximum frame count before auto-stop |
| `--screencast-id` | `screencast-stop` | Screencast id returned by `screencast-start` for the same session |
| `--action` | `dialog` | Dialog action: `status`, `accept`, or `dismiss` |
| `--prompt-text` | `dialog` | Prompt text to submit when accepting a prompt dialog |
| `--timeout-ms` | `screenshot`, `screencast-start`, `screencast-stop` | Explicit client-side daemon call timeout in ms |
| `--timeout-ms` | `dialog` | Client-side daemon call timeout in ms; defaults to 30s |
| `--since-seq` | `console-poll`, `network-poll` | Start sequence number |
| `--since-console-seq` | `debug-trace-snapshot`, `session-inspector`, `session-inspector-audit` | Resume cursor for console channel |
| `--since-network-seq` | `debug-trace-snapshot`, `session-inspector`, `session-inspector-audit` | Resume cursor for network channel |
| `--since-exception-seq` | `debug-trace-snapshot`, `session-inspector`, `session-inspector-audit` | Resume cursor for exception channel |
| `--max` | `console-poll`, `network-poll`, `debug-trace-snapshot`, `session-inspector`, `session-inspector-audit` | Max events to return per channel |

**Desktop observation**

| Flag | Used by | Description |
|------|---------|-------------|
| `--reason` | `review-desktop`, `session-inspector-audit`, `desktop-windows`, `desktop-active-window`, `desktop-capture-desktop`, `desktop-capture-window`, `desktop-accessibility-snapshot` | Audit reason recorded with review, audit, or desktop observation results |
| `--window-id` | `desktop-capture-window`, `desktop-accessibility-snapshot` | Window id for direct window capture or accessibility requests |
| `--timeout-ms` | all `desktop-*` commands | Client-side daemon call timeout in ms |

---

## CLI smoke test

Run the automated CLI coverage script (managed mode):

```bash
npm run build
node scripts/cli-smoke-test.mjs
```

The script uses temporary config/cache directories and exercises all CLI commands, including the new interaction and DOM state checks.
Validate extension mode separately with `launch` + `disconnect` while the extension is connected.

## Direct live regression harness

Run the direct scenario pack instead of the old broad matrix:

```bash
npm run build
node scripts/live-regression-direct.mjs
```

What it runs:
- `scripts/cli-smoke-test.mjs`
- `scripts/canvas-live-workflow.mjs --surface managed-headless`
- `scripts/canvas-live-workflow.mjs --surface managed-headed`
- `scripts/canvas-live-workflow.mjs --surface extension`
- `scripts/canvas-live-workflow.mjs --surface cdp`
- `scripts/annotate-live-probe.mjs --transport relay`
- `scripts/annotate-live-probe.mjs --transport direct`

Strict release gate mode:

```bash
node scripts/live-regression-direct.mjs --release-gate --out artifacts/release/vX.Y.Z/live-regression-direct.json
```

Behavior:
- Runs each scenario as an explicit child script with its own artifact instead of a nested matrix.
- Prints per-step progress so long runs do not idle silently.
- Fails on any direct scenario failure in `--release-gate` mode.
- Records `infra.daemon_status` as an initial preflight snapshot before child scenarios run. If a later child script repairs native messaging state, rerun `opendevbrowser status --daemon --output-format json` after the pack for final daemon/native truth.
- Uses temporary managed profiles for the managed canvas surfaces and the direct annotate probe so persisted-profile locks do not contaminate release runs.
- Waits for `/ops` ownership to drain before the legacy `/cdp` scenario so extension-backed CDP attach does not race a prior extension canvas run.
- Treats manual annotation timeout boundaries as `skipped` in `--release-gate` mode instead of misreporting them as runtime failures.
- Requires a healthy daemon and a connected extension before running extension or CDP scenarios.

## Direct provider runs

Run provider-by-provider live checks:

```bash
npm run build
node scripts/provider-direct-runs.mjs --out /tmp/odb-provider-direct-runs.json
```

Strict release gate mode:

```bash
npm run build
node scripts/provider-direct-runs.mjs --release-gate --out artifacts/release/vX.Y.Z/provider-direct-runs.json
```

Smoke mode:

```bash
npm run build
node scripts/provider-direct-runs.mjs --smoke --out /tmp/odb-provider-direct-runs-smoke.json
```

What it covers:
- Web/default direct search and fetch probes.
- Community/default direct search probes.
- Social/search and shopping/provider probes through the same direct CLI entrypoints used in real runs.
- Generic timeout outcomes stay visible as `fail`; `env_limited` is reserved for explicit environment/capability boundaries such as auth walls, browser-required shells, or challenge pages.
- Social platform search probes for every registered platform in `src/providers/social/index.ts`.
- Shopping provider runs for every registered shopping provider in `src/providers/shopping/index.ts`.
- Optional social post probes for explicitly requested write-path validation.

Key report fields:
- `data.guidanceReason` and `data.recommendedNextCommand` summarize the first actionable provider follow-up emitted by the workflow or failure envelope.
- Shopping and research workflow payloads keep the canonical structured source at `meta.primaryConstraint.guidance.reason` and `meta.primaryConstraint.guidance.recommendedNextCommands[]`.
- Product-video remains summary-first today: inspect `meta.primaryConstraintSummary` plus failure reason-code distributions when no structured guidance is present.

Key options:
- `--include-auth-gated` includes auth-dependent provider scenarios.
- `--include-high-friction` includes high-friction shopping providers.
- `--include-social-posts` includes social post scenarios.
- `--release-gate` enables auth-gated + high-friction + social-post cases and fails on any non-`pass` status.

Run contract parity and skill-asset gates as part of release checks:

```bash
npm run test -- tests/parity-matrix.test.ts
npm run test -- tests/providers-performance-gate.test.ts
./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh
```

These commands are release guards, not the live release-proof lane. Use the direct-run harness commands above for release evidence.

Release gate source of truth: `docs/RELEASE_RUNBOOK.md` and `docs/RELEASE_0.0.28_EVIDENCE.md`.
Benchmark fixture manifest: `docs/benchmarks/provider-fixtures.md`.

---

## Extension-only manual test (no OpenCode plugin)

Use this to validate the Chrome extension + relay without starting OpenCode.

1. Ensure the daemon is running: `npx opendevbrowser serve` (manual). `opendevbrowser daemon install` configures auto-start on supported platforms from a stable install location; for this manual test, use `npx opendevbrowser serve` as the explicit start command for the current session.
2. Build and load the extension: `npm run extension:build`, then Chrome → `chrome://extensions` → Developer mode → Load unpacked → `extension/`.
3. Open a normal `http(s)` tab (not `chrome://` or extension pages).
4. Open the extension popup, confirm Auto-connect + Auto-pair are ON, click Connect.
5. Verify the popup shows **Connected** and `npx opendevbrowser status --daemon` reports `extensionConnected: true` and `extensionHandshakeComplete: true`.
6. Optional session check: `npx opendevbrowser launch --extension-only --wait-for-extension`, then `npx opendevbrowser disconnect --session-id <id>`.
7. Optional annotation check (OpenCode): call `opendevbrowser_annotate` and confirm screenshots are written to a temp folder.

If it fails, run `npx opendevbrowser serve --stop` then `npx opendevbrowser serve`, and confirm site access includes `http://127.0.0.1/*` and `http://localhost/*` in the extension settings.

## Configuration files

### OpenCode config

The CLI modifies `opencode.json` to register the plugin:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opendevbrowser"]
}
```

**Locations:**
- Global: `~/.config/opencode/opencode.json`
- Local: `./opencode.json`

### Plugin config (optional)

When using `--with-config`, a `opendevbrowser.jsonc` is created with documented defaults:

```jsonc
{
  "headless": false,
  "profile": "default",
  "persistProfile": true,
  "snapshot": { "maxChars": 16000, "maxNodes": 1000 },
  "export": { "maxNodes": 1000, "inlineStyles": true },
  "devtools": { "showFullUrls": false, "showFullConsole": false },
  "security": {
    "allowRawCDP": false,
    "allowNonLocalCdp": false,
    "allowUnsafeExport": false
  },
  "skillPaths": [],
  "skills": {
    "nudge": {
      "enabled": true,
      "keywords": ["quick start", "getting started", "launch", "connect", "setup"],
      "maxAgeMs": 60000
    }
  },
  "continuity": {
    "enabled": true,
    "filePath": "opendevbrowser_continuity.md",
    "nudge": {
      "enabled": true,
      "keywords": ["plan", "multi-step", "long-running", "refactor", "migration", "rollout", "continue"],
      "maxAgeMs": 60000
    }
  },
  "providers": {
    "antiBotPolicy": {
      "enabled": true,
      "cooldownMs": 30000,
      "maxChallengeRetries": 1,
      "allowBrowserEscalation": true
      // "proxyHint": "residential_pool_a",
      // "sessionHint": "warm_profile"
    },
    "transcript": {
      "modeDefault": "auto",
      "strategyOrder": ["youtubei", "native_caption_parse", "ytdlp_audio_asr", "apify"],
      "enableYtdlp": false,
      "enableAsr": false,
      "enableYtdlpAudioAsr": true,
      "enableApify": true,
      "apifyActorId": "streamers/youtube-scraper",
      "enableBrowserFallback": false,
      "ytdlpTimeoutMs": 10000
    }
  },
  "desktop": {
    "permissionLevel": "observe",
    "commandTimeoutMs": 10000,
    "auditArtifactsDir": ".opendevbrowser/desktop-runtime",
    "accessibilityMaxDepth": 2,
    "accessibilityMaxChildren": 25
  },
  "daemonPort": 8788,
  "daemonToken": "auto-generated-on-first-run",
  "flags": [],
  "checkForUpdates": false
}
```

The optional `skills.nudge` section controls the small one-time prompt hint that encourages early `skill(...)` usage on skill-relevant tasks. The optional `continuity` section controls the long-running task nudge and the ledger file path.
Fingerprint runtime defaults are Tier 1/2/3 enabled, with Tier 2 and Tier 3 driven by continuous signals (debug trace remains readout/reporting).
Provider runtime anti-bot/transcript controls default to a public-first YouTube resolver chain:
- Transcript mode semantics: `auto | web | no-auto | yt-dlp | apify`.
- Request filter precedence is `filters.youtube_mode > providers.transcript.modeDefault > auto`.
- No CLI mode flag is introduced in this phase; mode is configured in `providers.transcript.modeDefault` or per-request `youtube_mode` filter.
- Auto mode fallback chain is `youtubei -> native_caption_parse -> ytdlp_audio_asr -> apify`.
- `yt-dlp` audio transcription requires `providers.transcript.enableYtdlpAudioAsr=true`.
- Apify requires `providers.transcript.enableApify=true`, a valid `APIFY_TOKEN`, and legal checklist approval for `apify`.
- Browser-assisted fallback is opt-in only and requires `providers.transcript.enableBrowserFallback=true` plus `providers.antiBotPolicy.allowBrowserEscalation=true`.
- If browser fallback is enabled, run it in an isolated automation profile instead of a daily logged-in Google profile.

Provider workflow and execution outputs now include normalized transcript/anti-bot telemetry:
- Primary provider follow-up summary: `meta.primaryConstraintSummary`.
- Research and shopping workflow follow-up guidance: `meta.primaryConstraint.guidance.reason` and `meta.primaryConstraint.guidance.recommendedNextCommands[]` when provider recovery steps are known.
- Failure reason codes: `meta.metrics.reasonCodeDistribution` for research/shopping, `meta.reasonCodeDistribution` for product-video, and `reasonCode` on provider failures.
- Transcript fallback diagnostics: `meta.metrics.transcript_strategy_failures` (legacy) and `meta.metrics.transcriptStrategyFailures` (camelCase alias).
- Strategy-detail diagnostics: `meta.metrics.transcript_strategy_detail_failures`/`meta.metrics.transcriptStrategyDetailFailures` and `meta.metrics.transcript_strategy_detail_distribution`/`meta.metrics.transcriptStrategyDetailDistribution`.
- Durability/pressure dimensions: `meta.metrics.transcriptDurability` and `meta.metrics.antiBotPressure` (snake_case aliases are also emitted).
- YouTube fetch metadata: `transcript_strategy` (legacy bucket), `transcript_strategy_detail` (exact strategy), `attempt_chain`, and failure `reasonCode` when transcript retrieval is unavailable.

Provider reliability criteria (resolver/browser fallback):
- `npm run test -- tests/providers-performance-gate.test.ts` must pass.
- Latest observation window must satisfy `meta.metrics.transcriptDurability.attempted >= 10` and `meta.metrics.transcriptDurability.success_rate >= 0.85`.
- Latest observation window must satisfy `meta.metrics.antiBotPressure.anti_bot_failure_ratio <= 0.15`.
- Trigger remediation immediately if either condition fails in two consecutive windows.
