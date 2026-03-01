# v0.0.16 Release Evidence

Status: active  
Last updated: 2026-03-01

## Baseline

- Branch: `codex/release-v0.0.16-hardening`
- Target channels: GitHub release artifacts, npm publish, Chrome Web Store publish (optional/manual lane)

## Baseline checks

- [x] CLI command inventory baseline captured (`55`).
- [x] Tool inventory baseline captured (`48`).
- [x] Drift baseline validated via `node scripts/docs-drift-check.mjs`.

## Mandatory release gates (to be populated)

### Static gates

- [x] `npm run lint`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm run extension:build`
- [x] `npm run test`
- [x] `npm run test:release-gate` (grouped release-gate units; rerun specific groups with `npm run test:release-gate:g<N>`)

### Live gates

- [x] `node scripts/provider-live-matrix.mjs --release-gate --use-global-env --out artifacts/release/v0.0.16/provider-live-matrix.json`
- [x] `LIVE_MATRIX_USE_GLOBAL=1 LIVE_MATRIX_STOP_DAEMON=0 node scripts/live-regression-matrix.mjs --release-gate`

### Audit/compliance gates

- [x] `node scripts/audit-zombie-files.mjs`
- [x] `node scripts/docs-drift-check.mjs`
- [x] `node scripts/chrome-store-compliance-check.mjs`

### First-time user dry run gate

- [ ] Simulated first-time global install from local artifact (`npm pack` + isolated env) completed.
- [ ] Daemon lifecycle validated (`serve`, `status --daemon`, `serve --stop`).
- [ ] Extension path and handshake validated.
- [ ] Managed, extension relay, and cdpConnect mode checks validated.
- [ ] Representative command/tool workflows validated.

## Artifacts

- [x] `artifacts/release/v0.0.16/provider-live-matrix.json`
- [x] `artifacts/release/v0.0.16/live-regression-matrix-report.json`
- [x] `artifacts/release/v0.0.16/first-run-global-install-*.json`

## Latest gate outputs (2026-03-01)

### Static + grouped regression

- `npm run test:release-gate`: all groups passed
  - group 1: provider-matrix-contracts
  - group 2: live-regression-gate-semantics
  - group 3: cli-help-parity
  - group 4: docs-and-zombie-audits
  - group 5: chrome-store-compliance
- Full chain passed:
  - `npm run version:check`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run build`
  - `npm run extension:build`
  - `npm run test` (`122` files, `1436` tests; coverage: statements `98.9%`, branches `97.0%`, functions `99.0%`, lines `99.3%`)
- Audit scripts passed:
  - zombie audit (`643` scanned, `0` flagged)
  - docs drift check (`55` commands / `48` tools parity)
  - chrome store compliance check (all checks passed)

### Strict live gates (current blocker status)

- Not rerun in this validation pass.
- Reference artifacts remain:
  - `artifacts/release/v0.0.16/provider-live-matrix.json`
  - `artifacts/release/v0.0.16/live-regression-matrix-report.json`
- Re-run strict live gates before final tag cut if runtime environment changed:
  - `node scripts/provider-live-matrix.mjs --release-gate --use-global-env --out artifacts/release/v0.0.16/provider-live-matrix.json`
  - `node scripts/live-regression-matrix.mjs --release-gate`

## Release workflow evidence

- [ ] PR URL
- [ ] Merge commit SHA
- [ ] GitHub release run URL
- [ ] npm publish verification (`npm view opendevbrowser version`)
- [ ] Chrome publish lane status and URL (or explicit deferral)
