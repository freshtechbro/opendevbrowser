# Relay Pairing Enforcement Plan

Plan for enforcing relay pairing by default, with an opt-out path and matching extension UI defaults.

---

## Overview

### Scope
- Default relay pairing token for plugin + extension.
- Opt-out via `relayToken: false` in plugin config.
- Extension toggle to enable/disable pairing and keep token in sync.
- Documentation updates to reflect new defaults.

### Key decisions
- Default relay token is `some-test-token`.
- Pairing is enforced by default; `relayToken: false` disables enforcement.
- Extension stores pairing toggle state and only sends the token when enabled.
- Plugin auto-creates `~/.config/opencode/opendevbrowser.jsonc` with relay defaults.

---

## Task 1 — Update plugin relay config defaults and enforcement

### Reasoning
Enforcing pairing by default requires a stable relay token in config and relay token validation logic that supports opt-out.

### What to do
Set default relay token in plugin config, allow `false` to disable pairing, and ensure relay server treats empty/false tokens as disabled.

### How
1. Update config schema to default `relayToken` to `some-test-token` and allow `false`.
2. Auto-create the config file if missing with relay defaults.
3. Ensure relay server accepts `false` and trims empty tokens to disable pairing.
4. Add or update config tests for defaults and the opt-out case.

### Files impacted
- `src/config.ts`
- `src/relay/relay-server.ts`
- `tests/config.test.ts`

### End goal
Plugin starts with pairing enforced by default, with a documented opt-out path.

### Acceptance criteria
- [ ] `loadGlobalConfig()` returns `relayToken: "some-test-token"` when no file exists.
- [ ] `relayToken: false` disables pairing enforcement.
- [ ] Config file auto-creates with relay defaults when missing.

---

## Task 2 — Add extension pairing toggle and defaults

### Reasoning
The extension must send the default token by default and allow users to disable pairing in the UI.

### What to do
Introduce default relay settings and a pairing toggle that controls whether the handshake includes the pairing token.

### How
1. Add shared relay default constants for the extension.
2. Update connection logic to load `pairingEnabled`, set defaults, and omit the token when disabled.
3. Update popup UI to include the toggle and keep token input in sync.
4. Add extension tests covering default token usage and toggle behavior.

### Files impacted
- `extension/src/relay-settings.ts` (new file)
- `extension/src/services/ConnectionManager.ts`
- `extension/src/popup.tsx`
- `extension/popup.html`
- `tests/extension-chrome-mock.ts`
- `tests/extension-connection-manager.test.ts`

### End goal
Extension connects with the default token when pairing is enabled and omits the token when disabled.

### Acceptance criteria
- [ ] Extension uses `some-test-token` by default when pairing is enabled.
- [ ] Disabling pairing omits the token from the relay handshake.
- [ ] UI toggle controls pairing state and keeps token input consistent.

---

## Task 3 — Update documentation

### Reasoning
Users need clear guidance on the new defaults, pairing opt-out, and extension UI behavior.

### What to do
Update README and planning/testing docs to reflect enforced pairing defaults and the opt-out flow.

### How
1. Update README config examples and extension usage notes.
2. Sync plan docs and implementation blueprint language with the new defaults.
3. Update testing workflow and privacy docs for the new token/toggle behavior.

### Files impacted
- `README.md`
- `docs/PLAN.md`
- `docs/opendevbrowser-plan.md`
- `docs/IMPLEMENTATION_BLUEPRINT.md`
- `docs/TESTING_WORKFLOW_PLAN.md`
- `docs/privacy.md`

### End goal
Docs accurately reflect default relay pairing and how to disable it.

### Acceptance criteria
- [ ] README shows `relayToken: "some-test-token"` and the opt-out path.
- [ ] Plan docs reflect default pairing enforcement and auto-created config file.
- [ ] Testing and privacy docs align with the new relay settings.

---

## File-by-file implementation sequence

1. `src/config.ts` — Task 1
2. `src/relay/relay-server.ts` — Task 1
3. `tests/config.test.ts` — Task 1
4. `extension/src/relay-settings.ts` — Task 2 (new file)
5. `extension/src/services/ConnectionManager.ts` — Task 2
6. `extension/src/popup.tsx` — Task 2
7. `extension/popup.html` — Task 2
8. `tests/extension-chrome-mock.ts` — Task 2
9. `tests/extension-connection-manager.test.ts` — Task 2
10. `README.md` — Task 3
11. `docs/PLAN.md` — Task 3
12. `docs/opendevbrowser-plan.md` — Task 3
13. `docs/IMPLEMENTATION_BLUEPRINT.md` — Task 3
14. `docs/TESTING_WORKFLOW_PLAN.md` — Task 3
15. `docs/privacy.md` — Task 3

---

## Dependencies to add

| Package | Version | Purpose |
|---------|---------|---------|
| None | N/A | No new dependencies |

---

## Version history

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-12-28 | Initial plan for relay pairing enforcement defaults |
