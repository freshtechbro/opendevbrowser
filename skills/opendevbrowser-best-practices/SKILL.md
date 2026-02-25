---
name: opendevbrowser-best-practices
description: This skill should be used when the user asks to design or run OpenDevBrowser provider workflows, scraping pipelines, QA/debug automation, parity checks across modes, or resilient browser operations with codified scripts and artifacts.
version: 2.3.0
---

# OpenDevBrowser Best Practices

This is the primary battery pack for OpenDevBrowser operations.

Use this skill when you need:
- provider-oriented workflows (`web`, `community`, `social`),
- script-first runbooks,
- parity across `managed`, `extension`, `cdpConnect`,
- diagnostics for QA/debug (`console`, `network`, trace context),
- safe write flows with explicit policy notice.

## Pack Contents

- `artifacts/provider-workflows.md` — canonical provider execution flows.
- `artifacts/parity-gates.md` — mode/surface parity matrix and acceptance gates.
- `artifacts/debug-trace-playbook.md` — diagnostics workflow and trace bundle model.
- `artifacts/fingerprint-tiers.md` — hardening tiers and when to use each.
- `artifacts/macro-workflows.md` — macro design and expansion standards.
- `artifacts/browser-agent-known-issues-matrix.md` — known browser-agent failure modes mapped to required controls.
- `artifacts/command-channel-reference.md` — CLI/tool/`/ops`/`/cdp` surface map plus cross-agent skill-sync targets.
- `assets/templates/mode-flag-matrix.json` — mode + flag verification template.
- `assets/templates/ops-request-envelope.json` — `/ops` request envelope template.
- `assets/templates/cdp-forward-envelope.json` — `/cdp` relay envelope template.
- `assets/templates/robustness-checklist.json` — shared issue-status checklist for workflow robustness audits.
- `assets/templates/surface-audit-checklist.json` — docs/surface audit checklist template.
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
```

5. Run robustness coverage checks across workflow skills:

```bash
./skills/opendevbrowser-best-practices/scripts/run-robustness-audit.sh
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
- Default to read/research workflows. Social posting probes remain disabled unless explicitly requested via matrix opt-in (`--include-social-posts`).
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
./skills/opendevbrowser-best-practices/scripts/odb-workflow.sh surface-audit
./skills/opendevbrowser-best-practices/scripts/odb-workflow.sh ops-channel-check
./skills/opendevbrowser-best-practices/scripts/odb-workflow.sh cdp-channel-check
./skills/opendevbrowser-best-practices/scripts/odb-workflow.sh mode-flag-matrix
./skills/opendevbrowser-best-practices/scripts/odb-workflow.sh robustness-audit
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

Real-world provider+mode scenario harness (soak replacement):

```bash
npm run build
node scripts/provider-live-matrix.mjs --use-global-env --skip-live-regression --out artifacts/provider-live-realworld.json
```

Surface inventory source of truth:
- `docs/SURFACE_REFERENCE.md` (55 CLI commands, 48 tools, 38 `/ops` commands, `/cdp` envelope contracts)
- `artifacts/command-channel-reference.md` (skill-pack operational digest)

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
