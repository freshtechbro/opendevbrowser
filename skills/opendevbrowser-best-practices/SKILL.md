---
name: opendevbrowser-best-practices
description: This skill should be used when the user asks to design or run OpenDevBrowser provider workflows, scraping pipelines, QA/debug automation, parity checks across modes, or resilient browser operations with codified scripts and artifacts.
version: 2.5.0
---

# OpenDevBrowser Best Practices

This is the primary battery pack for OpenDevBrowser operations.

Use this skill when you need:
- provider-oriented workflows (`web`, `community`, `social`),
- script-first runbooks,
- parity across `managed`, `extension`, `cdpConnect`,
- diagnostics for QA/debug (`console`, `network`, trace context),
- safe write flows with explicit policy notice.

For frontend, design-system, screenshot-to-code, or `/canvas` composition tasks, load `opendevbrowser-design-agent` immediately after this pack so the work is design-contract-first instead of operations-only.

## Pack Contents

- `artifacts/provider-workflows.md` — canonical provider execution flows.
- `artifacts/parity-gates.md` — mode/surface parity matrix and acceptance gates.
- `artifacts/debug-trace-playbook.md` — diagnostics workflow and trace bundle model.
- `artifacts/fingerprint-tiers.md` — hardening tiers and when to use each.
- `artifacts/macro-workflows.md` — macro design and expansion standards.
- `artifacts/browser-agent-known-issues-matrix.md` — known browser-agent failure modes mapped to required controls.
- `artifacts/command-channel-reference.md` — CLI/tool/`/ops`/`/canvas`/`/cdp` surface map plus cross-agent skill-sync targets.
- `artifacts/canvas-governance-playbook.md` — `/canvas` preflight, blocker, and feedback-evaluation guidance.
- `artifacts/skill-runtime-surface-matrix.md` — canonical skill-pack and runtime-family inventory for real-task audits.
- `assets/templates/mode-flag-matrix.json` — mode + flag verification template.
- `assets/templates/ops-request-envelope.json` — `/ops` request envelope template.
- `assets/templates/cdp-forward-envelope.json` — `/cdp` relay envelope template.
- `assets/templates/robustness-checklist.json` — shared issue-status checklist for workflow robustness audits.
- `assets/templates/surface-audit-checklist.json` — docs/surface audit checklist template.
- `assets/templates/skill-runtime-pack-matrix.json` — machine-readable canonical skill/runtime matrix for the audit runner.
- `assets/templates/canvas-handshake-example.json` — canonical `/canvas` handshake example.
- `assets/templates/canvas-generation-plan.v1.json` — required `canvas.plan.set` request skeleton.
- `assets/templates/canvas-feedback-eval.json` — target-attributed feedback evaluation checklist.
- `assets/templates/canvas-blocker-checklist.json` — machine-readable blocker and warning audit map.
- `scripts/odb-workflow.sh` — prints codified command sequences by workflow.
- `scripts/run-robustness-audit.sh` — validates workflow skill coverage against known issue IDs.
- `scripts/validate-skill-assets.sh` — validates required artifacts/templates.

## Fast Start

1. Validate the skill pack:

```bash
./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh
```

2. Pick a workflow:

```bash
./skills/opendevbrowser-best-practices/scripts/odb-workflow.sh provider-crawl
```

3. Execute the printed sequence with session-specific values.

4. Surface full controls directly from CLI help when auditing runtime accessibility:

```bash
npx opendevbrowser --help
npx opendevbrowser help
```

5. Run robustness coverage checks across workflow skills:

```bash
./skills/opendevbrowser-best-practices/scripts/run-robustness-audit.sh
```

6. Pair with the dedicated design pack for frontend work:

```bash
./skills/opendevbrowser-design-agent/scripts/validate-skill-assets.sh
./skills/opendevbrowser-design-agent/scripts/design-workflow.sh contract-first
```

## Agent Sync Targets

Skill-pack installation and discovery are synchronized for:
- `opencode` (`~/.config/opencode/skill`, project `./.opencode/skill`)
- `codex` (`$CODEX_HOME/skills` fallback `~/.codex/skills`, project `./.codex/skills`)
- `claudecode` (`$CLAUDECODE_HOME/skills` or `$CLAUDE_HOME/skills` fallback `~/.claude/skills`, project `./.claude/skills`)
- `ampcli` (`$AMPCLI_HOME/skills` or `$AMP_CLI_HOME/skills` or `$AMP_HOME/skills` fallback `~/.amp/skills`, project `./.amp/skills`)

Legacy compatibility aliases `claude` and `amp` are preserved in installer target metadata.

## Required Operating Rules

- Prefer refs from `opendevbrowser_snapshot` over raw selectors.
- Use one action per decision loop: snapshot -> action -> snapshot.
- Keep a single correlation context (`requestId`, `sessionId`) across a run.
- Run the same workflow shape across all three modes before claiming parity.
- Default to read/research workflows. Social posting probes remain disabled unless explicitly requested via direct-run opt-in (`--include-social-posts`).
- Apply rate-limit/backoff discipline (`Retry-After` aware) whenever 429 pressure appears.
- Re-check extension readiness on resume when a run crosses idle windows.

## Parallel Operations (Reliable As-Is)

- Safe parallelism today is `session-per-worker` (one session per page/tab command stream).
- Keep each session single-writer for target/page actions; run commands serially inside that session.
- Do not run independent concurrent streams that alternate `target-use` within one session.
- Use default extension `/ops` for relay-backed concurrency; use `/cdp` only for legacy compatibility paths.
- For managed parallel runs with persisted profiles, use unique profile paths per session (or disable persistence) to avoid profile lock collisions.
- Treat extension headless attempts (`--extension-only --headless`) as expected `unsupported_mode`; route headless workloads through managed/cdpConnect instead.
- Before extension-mode runs, preflight `npx opendevbrowser status --daemon` and require `extensionConnected=true` plus `extensionHandshakeComplete=true`.

Operational references:
- `artifacts/provider-workflows.md` (see Workflow E)
- `scripts/odb-workflow.sh parallel-multipage-safe`
- `docs/CLI.md` (concurrency semantics)
- `docs/SURFACE_REFERENCE.md` (transport and policy constraints)
- `docs/TROUBLESHOOTING.md` (parallel crosstalk and profile-lock remediation)

## Known-Issue Robustness Baseline

- Source matrix: `artifacts/browser-agent-known-issues-matrix.md`
- Reusable checklist: `assets/templates/robustness-checklist.json`
- Coverage validator: `scripts/run-robustness-audit.sh`

Use issue IDs from the matrix in each workflow skill (`ISSUE-01` ... `ISSUE-12`) so robustness checks stay machine-verifiable and DRY.

## Provider Workflows (Codified)

### Provider Search Workflow

Goal: deterministic query + extraction from one provider.

```text
opendevbrowser_launch noExtension=true
opendevbrowser_goto sessionId="<session-id>" url="<provider-search-url>"
opendevbrowser_wait sessionId="<session-id>" until="networkidle"
opendevbrowser_snapshot sessionId="<session-id>" format="actionables"
# extract targeted results using refs
opendevbrowser_network_poll sessionId="<session-id>" max=50
```

### Provider Crawl Workflow

Goal: multipage fetch + extraction with bounded depth.

```text
opendevbrowser_launch noExtension=true
opendevbrowser_goto sessionId="<session-id>" url="<seed-url>"
opendevbrowser_wait sessionId="<session-id>" until="networkidle"
opendevbrowser_snapshot sessionId="<session-id>" format="actionables"
# capture links/data, enqueue next pages in host logic
opendevbrowser_scroll sessionId="<session-id>" dy=1000
opendevbrowser_wait sessionId="<session-id>" until="networkidle"
```

### QA Debug Workflow

Goal: isolate frontend regressions quickly.

```text
opendevbrowser_snapshot sessionId="<session-id>" format="outline"
opendevbrowser_console_poll sessionId="<session-id>" max=100
opendevbrowser_network_poll sessionId="<session-id>" max=100
opendevbrowser_screenshot sessionId="<session-id>"
```

### Read-Only Social Validation Workflow

Goal: validate authenticated read/search capability without posting.

1. Connect and verify extension readiness (`extensionConnected` + handshake).
2. Navigate/search target social surface.
3. Capture `debug-trace-snapshot` and `network-poll` evidence.
4. Record blocker/auth status only (no write action).

## Workflow Router Script

Use the router script to avoid retyping flows:

```bash
./skills/opendevbrowser-best-practices/scripts/odb-workflow.sh provider-search
./skills/opendevbrowser-best-practices/scripts/odb-workflow.sh provider-crawl
./skills/opendevbrowser-best-practices/scripts/odb-workflow.sh qa-debug
./skills/opendevbrowser-best-practices/scripts/odb-workflow.sh social-readonly-check
./skills/opendevbrowser-best-practices/scripts/odb-workflow.sh parity-check
./skills/opendevbrowser-best-practices/scripts/odb-workflow.sh release-direct-gates
./skills/opendevbrowser-best-practices/scripts/odb-workflow.sh surface-audit
./skills/opendevbrowser-best-practices/scripts/odb-workflow.sh ops-channel-check
./skills/opendevbrowser-best-practices/scripts/odb-workflow.sh cdp-channel-check
./skills/opendevbrowser-best-practices/scripts/odb-workflow.sh mode-flag-matrix
./skills/opendevbrowser-best-practices/scripts/odb-workflow.sh robustness-audit
./skills/opendevbrowser-best-practices/scripts/odb-workflow.sh canvas-preflight
./skills/opendevbrowser-best-practices/scripts/odb-workflow.sh canvas-feedback-eval
./skills/opendevbrowser-best-practices/scripts/odb-workflow.sh skill-runtime-audit
```

## Modes and Surface Parity

Always run acceptance on:
- Modes: `managed`, `extension`, `cdpConnect`
- Surfaces: tool API, CLI, daemon RPC

Reference: `artifacts/parity-gates.md`

Parity gate test:

```bash
npm run test -- tests/parity-matrix.test.ts
```

Treat `tests/parity-matrix.test.ts` as contract coverage only. Live release proof comes from the direct-run harnesses below.
This pack is the canonical owner of direct-run release evidence policy; other docs and skill packs should point here instead of restating the full policy.

Real-world provider+mode scenario harness (soak replacement):

```bash
npm run build
node scripts/provider-direct-runs.mjs --out artifacts/provider-direct-realworld.json
node scripts/live-regression-direct.mjs --out artifacts/live-regression-direct.json
```

Surface inventory source of truth:
- `docs/SURFACE_REFERENCE.md` (60 CLI commands, 53 tools, 48 `/ops` commands, 35 `/canvas` commands, `/cdp` envelope contracts; mirrored by `npx opendevbrowser --help` and `npx opendevbrowser help`)
- `artifacts/command-channel-reference.md` (skill-pack operational digest)
- `artifacts/skill-runtime-surface-matrix.md` and `assets/templates/skill-runtime-pack-matrix.json` (canonical pack/runtime audit inventory)

Direct-run release note:
- `scripts/live-regression-direct.mjs` is the preferred release harness for `/canvas`, annotate, and CLI smoke. It uses temporary managed profiles for managed probes, waits for `/ops` drain before the legacy `/cdp` step, and keeps manual annotation timeouts as explicit `skipped` boundaries in `--release-gate` mode.
- `scripts/provider-direct-runs.mjs --use-global-env --include-high-friction --include-auth-gated` is the preferred provider release harness. Treat `provider-live-matrix` and `live-regression-matrix` as debug-only helpers, not refreshed release evidence.

## Skill Runtime Audit and Realignment

This pack is the canonical owner of repo-local skill runtime audit policy and skill-pack runtime realignment.

Use these assets when the task is to inventory or validate the full OpenDevBrowser skill/runtime surface:
- `artifacts/skill-runtime-surface-matrix.md`
- `assets/templates/skill-runtime-pack-matrix.json`
- `scripts/skill-runtime-audit.mjs`

Audit runtime rule:
- `scripts/skill-runtime-audit.mjs` keeps smoke mode isolated and reproducible with temp harnesses, but full mode must reuse the current configured daemon and environment for `provider-direct` and `live-regression` so extension state, cookies, and auth-backed scenarios are exercised for real when available.

Realignment rule:
- when a pack drifts behind current runtime behavior, update the skill to match the repo reality and strengthen the workflow guidance instead of making the pack merely stop failing validation.

## Canvas Governance Handshake

Use the design-canvas surface when the workflow needs persisted design documents, explicit governance state, preview tabs, or overlay selection.

Recommended command order:
1. `opendevbrowser_canvas` or `opendevbrowser canvas --command canvas.session.open` to get `canvasSessionId`, `leaseId`, `preflightState`, governance block states, and generation-plan requirements.
2. Read the handshake before mutating. The handshake is the source of truth for:
   - `governanceRequirements.requiredBeforeMutation`
   - `governanceRequirements.requiredBeforeSave`
   - `generationPlanRequirements.requiredBeforeMutation`
   - `allowedLibraries`
   - `mutationPolicy.allowedBeforePlan`
   - treat `allowedLibraries.components`, `allowedLibraries.icons`, and `allowedLibraries.styling` as separate policy lanes:
     `components` are reusable UI adapters such as `shadcn`,
     `icons` are approved icon families,
     `styling` is for utility/theme adapters such as `tailwindcss`
3. Submit `canvas.plan.set` with all required non-empty objects:
   - `targetOutcome`
   - `visualDirection`
   - `layoutStrategy`
   - `contentStrategy`
   - `componentStrategy`
   - `motionPosture`
   - `responsivePosture`
   - `accessibilityPosture`
   - `validationTargets`
4. Only after the plan is accepted, call `canvas.document.patch`.
5. Use `canvas.preview.render`, `canvas.tab.open`, `canvas.overlay.mount`, and `canvas.overlay.select` when a browser-backed live view is required.
6. Use `canvas.feedback.poll` for snapshot audits between mutation rounds, and use `canvas.feedback.subscribe` -> `canvas.feedback.next` -> `canvas.feedback.unsubscribe` when a live pull-stream is needed.
7. Use `canvas.document.save` or `canvas.document.export` to persist artifacts.

Code-sync surface:
- `canvas.session.attach` joins an existing canvas session as an `observer` or reclaims the write lease with `attachMode=lease_reclaim`.
- `canvas.code.bind`, `canvas.code.unbind`, `canvas.code.pull`, `canvas.code.push`, `canvas.code.status`, and `canvas.code.resolve` manage TSX-first document bindings when a canvas file is round-tripped to repo code.

Current `/canvas` parity notes:
- All 35 public `canvas.*` commands are agent-callable through `opendevbrowser_canvas` and `opendevbrowser canvas --command ...`.
- `canvas.feedback.subscribe` live streaming is public through the CLI only: use `--output-format stream-json` for the built-in polling bridge.
- Tool-driven agents can achieve the same public streaming behavior by calling `canvas.feedback.subscribe`, then repeating `canvas.feedback.next`, and finally `canvas.feedback.unsubscribe`.
- `canvas.tab.sync` and `canvas.overlay.sync` are internal extension runtime helpers, not public commands.
- `canvas_html` is still the default preview/export contract. `bound_app_runtime` is opt-in and only valid when runtime preflight and app-side instrumentation succeed.
- Component and icon libraries currently render semantically, not package-faithfully. Treat `shadcn`, `tailwindcss`, `tabler`, `microsoft-fluent-ui-system-icons`, `3dicons`, and `@lobehub/fluent-emoji-3d` as metadata and constrained render lanes, not as general library import/export parity.
- Annotation remains a separate surface today, but popup and canvas both ship per-item and combined `Copy` / `Send` actions. `Send` now delivers directly into the active agent chat when scope is safe and degrades to stored-only `annotate --stored` retrieval when scope is missing, ambiguous, or relay enqueue fails.

Tailwind usage rule:
- When `allowedLibraries.styling` includes `tailwindcss`, use it for layout, spacing, responsive, and state styling over canonical tokens/theme variables.
- Do not treat Tailwind as a component inventory source or mix it into `componentStrategy.approvedLibraries`.
- Preview/export should materialize a deterministic utility-class layer and stay self-contained; do not depend on a remote Tailwind CDN for canvas preview correctness.

Failure handling:
- `plan_required`: immediately call `canvas.plan.set`.
- `revision_conflict`: reload with `canvas.document.load` and replay the patch batch against the latest revision.
- `unsupported_target` or `restricted_url`: move the preview to a normal http(s) tab or fall back to managed mode.
- If a freshly rebuilt unpacked extension still shows old `/canvas` or popup behavior, reload the extension in Chrome before trusting the live result; stale MV3 runtime state can preserve old service-worker logic after `npm run extension:build`.

Operational references:
- `artifacts/canvas-governance-playbook.md`
- `assets/templates/canvas-handshake-example.json`
- `assets/templates/canvas-generation-plan.v1.json`
- `assets/templates/canvas-feedback-eval.json`
- `assets/templates/canvas-blocker-checklist.json`

## Diagnostics and Traceability

Current diagnostics tools:
- `opendevbrowser_console_poll`
- `opendevbrowser_network_poll`
- `opendevbrowser_debug_trace_snapshot` (combined page + console + network + exception channels)

Reference: `artifacts/debug-trace-playbook.md`

## Fingerprint Hardening

Apply the minimum tier that meets reliability goals.

- Tier 0: baseline deterministic automation.
- Tier 1: coherence profile (default recommended).
- Tier 2: runtime hardening.
- Tier 3: adaptive managed hardening (optional).

Reference: `artifacts/fingerprint-tiers.md`

## Macro Guidance

Use macros as normalized entrypoints for provider workflows.

- Keep macro definitions declarative and typed.
- Expand macros to canonical provider queries.
- Emit provenance metadata (`macro`, `resolvedQuery`, `provider`).

Reference: `artifacts/macro-workflows.md`
