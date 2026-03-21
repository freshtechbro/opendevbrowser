# v0.0.17 Release Evidence

Status: historical release ledger
Release date: 2026-03-13
Last audited against repo: 2026-03-20

## Scope

Tracks the verified release-prep gates for `v0.0.17`, including docs alignment, package/version sync, packaging outputs, and release/distribution handoff evidence for GitHub release, npm, and Chrome extension distribution.

## Release summary

- Canonical version owners are aligned at `0.0.17` in `package.json`, `extension/package.json`, and `extension/manifest.json`.
- Active release-facing docs, workflows, scripts, and changelog surfaces were refreshed for the `0.0.17` cycle.
- `scripts/sync-extension-version.mjs` now syncs both extension version owners, with regression coverage in `tests/sync-extension-version.test.ts`.
- Mandatory local release gates passed on the current tree.
- Optional live-environment release gates were not rerun in this pass and remain explicitly deferred.

## Current repo note

- The release-prep evidence below remains the authoritative `2026-03-13` snapshot for `v0.0.17`.
- Current repo state was rechecked on `2026-03-20` to prevent stale “current” wording from leaking into this historical ledger.
- Current branch: `codex/canvas-upgrade`
- Current HEAD: `12a0dfb7a5a953c5165df6c209416aaf839f017c`
- Current dirty-path count from `git status --short`: `262`
- Current local tag `v0.0.17`: present
- Historical grouped gate names below are preserved exactly as the `2026-03-13` snapshot labels; they are not the active release-proof terminology.
- Do not reinterpret the release-prep gate results below as current working-tree truth.

## Post-release current-turn revalidation (2026-03-20)

- Strict direct live regression reran green on the current dirty tree:
  - Command: `node scripts/live-regression-direct.mjs --release-gate --out /tmp/odb-live-regression-direct-20260320f.json`
  - Result: `pass=6`, `expected_timeout=0`, `env_limited=0`, `fail=0`, `skipped=2`
  - Notes:
    - Fresh rerun was executed against the launchd-owned rebuilt daemon on pid `73886` after the canvas repo-root propagation fix. The four canvas rows that had failed in `/tmp/odb-live-regression-direct-20260320e.json` now pass again.
    - Current-tree repo-root proof is explicit in the code and focused regression tests:
      - `src/cli/commands/canvas.ts` injects caller `repoRoot`
      - `src/browser/canvas-manager.ts` persists session `repoRoot`
      - `src/browser/canvas-code-sync-manager.ts` resolves relative code-sync paths against that session root
      - `tests/cli-canvas.test.ts`, `tests/canvas-manager.test.ts`, and `tests/canvas-code-sync-manager.test.ts` cover the regression
    - `feature.canvas.cdp` passed while relay preflight still reported `opsConnected=true`, which confirms legacy `/cdp` exclusivity is target-level rather than a global `/ops` drain requirement.
    - `feature.canvas.managed_headless`, `feature.canvas.managed_headed`, `feature.canvas.extension`, `feature.canvas.cdp`, and `feature.cli.smoke` all passed.
    - `feature.annotate.relay` and `feature.annotate.direct` remained explicit manual-boundary skips: `manual_probe_boundary_observed:relay_annotation_timeout` and `manual_probe_boundary_observed:direct_annotation_timeout`. In strict mode these remain non-pass `skipped` boundaries, but they do not fail the current helper unless they escalate to `fail`, `env_limited`, or `expected_timeout`.
    - The `infra.daemon_status` step is a preflight snapshot, not an end-of-run summary. In `/tmp/odb-live-regression-direct-20260320f.json` it still captured the old native mismatch before the later `feature.cli.smoke` child invoked `serve` and normalized native host state; the fresh post-run `node dist/cli/index.js status --daemon --output-format json` read on the same daemon pid reported `mismatch=false`.
    - Same-day follow-up on rebuilt daemon pid `35147` after the direct runtime asset-path fix refreshed both focused annotate probes:
      - `node scripts/annotate-live-probe.mjs --transport direct --release-gate --out /tmp/odb-annotate-direct-probe-20260320e.json`
      - `node scripts/annotate-live-probe.mjs --transport relay --release-gate --out /tmp/odb-annotate-relay-probe-20260320e.json`
      - Both transports now still classify as manual-boundary skips, but the live annotate step message is the stronger explicit ready-state wording: `Annotation UI started and is waiting for manual completion.`
- Canonical canvas validation reran green on the current dirty tree:
  - Command: `node scripts/canvas-competitive-validation.mjs --out /tmp/odb-canvas-competitive-validation-20260320a.json`
  - Result: `pass=10`, `fail=0`, `skipped=0`, `skipped_no_figma_token=1`
  - Notes:
    - `configured_plugin_fixtures` is now a real pass via the checked-in repo declaration `.opendevbrowser/canvas/adapters.json` -> `./tests/fixtures/canvas/adapter-plugins/validation-fixture`.
    - `figma_live_smoke` remains the only optional skip because no live Figma token is configured in this pass.
- Direct provider aggregate was refreshed on the current dirty tree with the current non-strict policy:
  - Command: `node scripts/provider-direct-runs.mjs --use-global-env --include-high-friction --include-auth-gated --out /tmp/odb-provider-direct-runs-20260320e.json`
  - Result: `pass=23`, `expected_timeout=0`, `env_limited=4`, `fail=0`, `skipped=0`
  - Current artifact preserves nested shopping `providerShell` diagnostics and no longer demotes generic timeout outcomes to `env_limited`.
- Current direct-provider truth from `/tmp/odb-provider-direct-runs-20260320e.json`:
  - `social/x`: pass
  - `social/facebook`: pass
  - `social/linkedin`: `env_limited`, `linkedin_auth_wall_only`
  - `shopping/walmart`: `pass`, `7` offers
  - `shopping/bestbuy`: `pass`, `3` offers
  - `shopping/ebay`: `pass`, `8` offers
  - `shopping/target`: `env_limited`, `providerShell=target_shell_page`
  - `shopping/costco`: `pass`, `4` offers
  - `shopping/temu`: `env_limited`, `providerShell=temu_challenge_shell`
  - `shopping/others`: `env_limited`
- Full repo gates were rerun on the current dirty tree after the same-day evidence refresh:
  - Commands:
    - `npm run lint`
    - `npm run typecheck`
    - `npm run build`
    - `npm run extension:build`
    - `npm run test`
    - `node scripts/docs-drift-check.mjs`
    - `./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh`
    - `git diff --check`
  - Result:
    - lint/typecheck/build/extension build passed
    - `npm run test` => `177` passed, `1` skipped, `2340` tests passed, `1` skipped
    - coverage remained above release thresholds: statements `98.23%`, branches `97.00%`, functions `97.93%`, lines `98.33%`
    - docs drift and skill asset validation both passed cleanly
- These notes document current-tree evidence only. They do not rewrite the historical `2026-03-13` release-prep snapshot below.

## Release-prep snapshot (2026-03-13)

- Branch: `codex/design-canvas`
- HEAD: `6113befe161f3672b44ef8a3388fa5b008843764`
- HEAD date: `2026-03-13`
- HEAD subject: `docs: remove canvas pencil parity audit`
- Working tree at audit time: `23` modified, `5` untracked (`28` total)
- Local tag `v0.0.17`: absent

## Mandatory release gates

The grouped labels in this section are retained as the original `2026-03-13` snapshot names.

### Docs and audit gates

- [x] `node scripts/docs-drift-check.mjs`
  - Result: `ok: true`, `version: 0.0.17`, `commandCount: 56`, `toolCount: 49`
- [x] `./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh`
  - Result: `Skill assets validated: 20 files referenced/present, 9 JSON templates parsed.`
- [x] `node scripts/audit-zombie-files.mjs`
  - Result: `ok: true`, `scanned: 630`, `flagged: []`
- [x] `node scripts/chrome-store-compliance-check.mjs`
  - Result: `ok: true`, `manifestVersion: 3`, `extensionVersion: 0.0.17`, `failed: []`

### Build and test gates

- [x] `npm run extension:sync`
  - Result: `Extension version metadata already at 0.0.17`
- [x] `npm run version:check`
  - Result: `Version check passed: 0.0.17`
- [x] `npm run lint`
  - Result: passed with no ESLint errors
- [x] `npm run typecheck`
  - Result: passed with no TypeScript errors
- [x] `npm run build`
  - Result: passed; ESM build completed successfully
- [x] `npm run extension:build`
  - Result: passed; annotate stylesheet and extension icons synced
- [x] `npm run test:release-gate`
  - Result: all 5 groups passed
  - Details:
    - `provider-matrix-contracts`: PASS
    - `live-regression-gate-semantics`: PASS
    - `cli-help-parity`: PASS
    - `docs-and-zombie-audits`: PASS
    - `chrome-store-compliance`: PASS
- [x] `npm run test`
  - Result: `141` test files passed, `1661` tests passed
  - Coverage:
    - statements: `98.62%`
    - branches: `97.07%`
    - functions: `98.26%`
    - lines: `98.86%`

### Packaging gates

- [x] `npm run extension:pack`
  - Result: `opendevbrowser-extension.zip` regenerated successfully
- [x] `npm pack`
  - Result: `opendevbrowser-0.0.17.tgz` generated successfully
  - npm pack details:
    - package size: `1.0 MB`
    - unpacked size: `5.2 MB`
    - total files: `649`
    - shasum: `aa875df4f1d675a8b43832bb3d4af346a6e5afc0`

## Repo sanity checks

- [x] `git diff --check`
  - Result: no whitespace or merge-marker issues reported
- [x] `git status --short`
  - Result: worktree contains the expected release patch files plus:
    - new release docs/tests (`docs/CUTOVER_CHECKLIST.md`, `docs/RELEASE_0.0.17_EVIDENCE.md`, `tests/sync-extension-version.test.ts`)
    - unrelated untracked `docs/CANVAS_COMPETITIVE_IMPLEMENTATION_SPEC.md` left untouched
- [x] `cmp -s <(npx opendevbrowser --help) <(npx opendevbrowser help)`
  - Result: exit code `0` (help parity preserved)

## Artifacts

- [x] `opendevbrowser-extension.zip`
  - Size: `116K`
  - SHA-256: `aa32845d0412317ea06d9325e943eeb01064af98d26d39578aa39f9d11dcb855`
- [x] `opendevbrowser-extension.zip.sha256`
  - Contents: `aa32845d0412317ea06d9325e943eeb01064af98d26d39578aa39f9d11dcb855  opendevbrowser-extension.zip`
- [x] `opendevbrowser-0.0.17.tgz`
  - Size: `981K`
  - SHA-1 (`npm pack` / `shasum`): `aa875df4f1d675a8b43832bb3d4af346a6e5afc0`

## Optional release-environment gates

- [ ] `node scripts/provider-direct-runs.mjs --release-gate --out artifacts/release/v0.0.17/provider-direct-runs.json`
  - Status: deferred in this pass
- [ ] `node scripts/live-regression-direct.mjs --release-gate --out artifacts/release/v0.0.17/live-regression-direct.json`
  - Status: deferred in this pass
- [ ] First-run onboarding dry run from `docs/FIRST_RUN_ONBOARDING.md`
  - Status: deferred in this pass

## Deferred artifacts

- [ ] `artifacts/release/v0.0.17/provider-direct-runs.json`
  - Not generated because the strict live provider gate was deferred
- [ ] `artifacts/release/v0.0.17/live-regression-direct.json`
  - Not generated because the strict live regression gate was deferred

## External release workflow evidence

- [ ] Release workflow run URL
  - Pending external GitHub Actions execution
- [ ] GitHub release URL
  - Pending tagged release publication
- [ ] npm publish verification
  - Pending external publish
- [ ] Chrome Web Store publish status
  - Pending store submission or explicit deferral at release time

## Notes

- This ledger captures local release-prep and packaging evidence only.
- Historical `docs/RELEASE_0.0.16_EVIDENCE.md` remains preserved as the prior release ledger.
- The extension zip was repacked during final verification; the SHA-256 above is the final artifact hash and supersedes earlier transient hashes from pre-final packaging.
