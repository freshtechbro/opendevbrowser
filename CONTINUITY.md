# Continuity Ledger

Goal (incl. success criteria):
- Enforce extension pairing via relay token, defaulting to a shared token in plugin + extension; allow users to disable pairing by setting `relayToken` to `false` in config; ensure the extension UI supports toggling/enforcing the token and stays in sync.
- Success: plugin config defaults include `relayToken: "some-test-token"` and pairing enforcement logic; extension uses the same default token and exposes a toggle to enable/disable pairing, with matching behavior on both sides.

Constraints/Assumptions:
- Follow root and nearest `AGENTS.md` rules, TypeScript/ESLint constraints, and ASCII-only edits unless file already uses Unicode.
- Use Zod for config validation; avoid logging secrets; relay token must not be exposed in logs.
- Config file lives at `~/.config/opencode/opendevbrowser.jsonc`; user wants defaults preconfigured and relay token can be disabled by setting `false`.

Key decisions:
- Auto-create `~/.config/opencode/opendevbrowser.jsonc` with default relay settings when missing; keep in-code defaults in sync.
- Default relay pairing token set to `some-test-token`; `relayToken: false` disables pairing enforcement in the plugin.
- Extension adds `pairingEnabled` toggle and defaults to the same token when pairing is enabled.

State:
  - Done:
    - Read current `CONTINUITY.md`, root `AGENTS.md`, and MCAF reference docs.
    - Updated plugin config defaults to include relay token, allow `false`, and auto-create config file when missing.
    - Updated extension settings/UI and connection logic for pairing toggle and default token; adjusted extension tests/mocks.
    - Updated README and plan docs; added a formal relay pairing enforcement plan doc.
    - Ran `npm run test` (pass; coverage thresholds met).
    - Ran `npm run extension:build` (pass).
    - Ran `npm run lint` (pass).
    - Verified config auto-creation and defaults via local script (config file exists; relay token enabled and matches default).
  - Now:
    - Ready for extension UI pairing toggle verification in Chrome.
  - Next:
    - Manually validate extension pairing UI and token toggle in Chrome. (Expected files: extension popup UI)
    - Review docs for consistency after verification and adjust if real-world behavior differs. (Expected files: `README.md`, `docs/`)
    - Capture any release notes or change summary if preparing a publish. (Expected files: `docs/`, `README.md`)

Open questions (UNCONFIRMED if needed):
  - None.

Working set (files/ids/commands):
- `CONTINUITY.md`
- `src/config.ts`
- `src/relay/relay-server.ts`
- `extension/src/relay-settings.ts`
- `extension/src/services/ConnectionManager.ts`
- `extension/src/popup.tsx`
- `extension/popup.html`
- `tests/config.test.ts`
- `tests/extension-chrome-mock.ts`
- `tests/extension-connection-manager.test.ts`
- `README.md`
- `docs/PLAN.md`
- `docs/opendevbrowser-plan.md`
- `docs/IMPLEMENTATION_BLUEPRINT.md`
- `docs/TESTING_WORKFLOW_PLAN.md`
- `docs/privacy.md`
- `docs/RELAY_PAIRING_ENFORCEMENT_PLAN.md`
