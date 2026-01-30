Goal (incl. success criteria):
- Own all changes end-to-end: verify relay/extension/daemon changes, docs correctness, and quality gates (build/lint/tests/CLI/extension), with any fixes applied and documented.

Constraints/Assumptions:
- Use RepoPrompt MCP for repo context before starting work.
- Maintain `CONTINUITY.md` per AGENTS (update on goal/state changes).
- Avoid destructive git commands; do not revert unrelated changes.
- Tests must pass; coverage target >97% desired.

Key decisions:
- For `/pair`, `/config`, `/status`: allow loopback no-Origin requests and tolerate `Origin: null` with CORS header; still reject non-extension origins.
- Extension now retries /config + /pair with exponential backoff; uses stored relay port fallback instead of clearing state.
- Add daemon autostart CLI (`daemon install|uninstall|status`) with OS-specific installers.

State:
  - Done:
    - Installed daemon autostart (darwin) and rebuilt/packed extension bundle.
    - Updated README + tool/CLI parity spec to reflect loopback no-Origin + PNA behavior for `/config`/`/pair`.
    - Removed temporary relay/daemon debug logs; tightened CLI/test thresholds to 97%.
    - Rebuilt extension and re-packed zip after latest changes.
    - Build/lint/tests passed; CLI smoke test passed on rerun.
    - Implemented relay hardening (auth headers, origin policy, token validation, HTTP rate limiting).
    - Implemented extension reliability fixes (popup error handling, target cleanup, connect dedupe, handshake validation).
    - Updated relay tests for new auth/origin behavior; adjusted tools test timeout.
    - Implemented Task 7 (CLI/daemon timeouts + numeric validation + conflict detection).
    - Implemented Task 8 (coverage uplift to meet threshold).
    - Implemented Task 9 (resolveConfig honors overrides with validation).
    - Updated CLI docs to note numeric validation + conflicting flags.
    - Added branch-coverage tests for relay, browser manager, dom capture; branch coverage now >97%.
    - Tightened daemon command numeric validation (invalid numbers now error).
    - Added per-call daemon timeout support; session.disconnect uses 20s timeout to avoid CLI smoke timeout.
    - Implemented daemon autostart support (new CLI command + installers; tests added).
    - Extension auto-retry/backoff for /config + /pair; uses stored relay port; avoids token re-fetch when stored.
    - Added alarms permission + alarm mock/tests; updated extension messaging to “Start the daemon”.
    - Updated CLI/TOOL parity docs + daemon autostart spec to mark implemented.
    - Relaxed relay HTTP auth to allow loopback no-Origin requests; updated relay tests accordingly.
    - Added CORS handling for `Origin: null` on relay HTTP endpoints; updated tests; rebuilt CLI.
    - Added PNA preflight support (`Access-Control-Allow-Private-Network: true`) on relay HTTP preflights and actual responses; updated tests; rebuilt CLI.
    - Fixed `serve` command to retain daemon handle so the daemon stays alive; rebuilt CLI.
    - Daemon started on 127.0.0.1:8788 with relay on 127.0.0.1:8787; ports confirmed listening.
  - Now:
    - Documentation updates in progress (CLI PNA/origin note, manual extension test steps, daemon start/stop instructions).
  - Next:
    - Re-run any doc-only validations if needed and finalize summary.

Open questions (UNCONFIRMED if needed):
- Any remaining gaps vs autostart/spec/expansion plan docs? (UNCONFIRMED - needs review)

Working set (files/ids/commands):
- `src/cli/daemon-autostart.ts`
- `src/cli/commands/daemon.ts`
- `src/cli/args.ts`
- `src/cli/index.ts`
- `extension/src/background.ts`
- `extension/src/popup.tsx`
- `extension/src/services/ConnectionManager.ts`
- `extension/manifest.json`
- `tests/daemon-autostart.test.ts`
- `tests/daemon-command.test.ts`
- `tests/extension-background.test.ts`
- `tests/extension-chrome-mock.ts`
- `docs/CLI.md`
- `docs/OPENCODE_DAEMON_AUTOSTART_PLAN.md`
- `docs/OPENCODE_DAEMON_AUTOSTART_SPEC.md`
- `docs/TOOL_CLI_PARITY_SPEC.md`
- `docs/TOOLS_CLI_EXPANSION_PLAN.md`
- Commands: `npm run build`, `npm run lint`, `npm run test`, `node scripts/cli-smoke-test.mjs`
