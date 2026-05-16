# v0.0.30 Release Evidence

Status: active release ledger
Target release date: 2026-05-16
Target tag: `v0.0.30`

## Scope

Tracks the `0.0.30` release cycle for uniform workflow output roots across CLI, daemon RPC, OpenCode direct tools, and provider workflow fallbacks.

## Reference State

- Previous npm `latest`: `0.0.29`
- Previous GitHub release: `v0.0.29`
- Release branch: `codex/unify-workflow-output-roots`
- Target tag: `v0.0.30`
- GitHub release workflow: `.github/workflows/release-public.yml`
- Repository secret preflight: `NPM_TOKEN` is configured.

## Release Delta

- Omitted generated workflow output roots now resolve to `<cli cwd>/.opendevbrowser/<workflow>/<uuid>` for CLI invocations.
- OpenCode direct tools and raw daemon RPCs now resolve omitted workflow output roots from the project workspace root instead of transient process temp directories.
- Explicit `outputDir` values remain preserved across CLI, direct tools, daemon RPC, and provider workflow calls.
- Low-level non-workflow artifact fallback and screencast replay defaults remain unchanged.

## Version Alignment

- `package.json`: `0.0.30`
- `package-lock.json`: `0.0.30`
- `extension/package.json`: `0.0.30`
- `extension/manifest.json`: `0.0.30`

## Mandatory Local Release Gates

- [x] `npm run extension:sync`
- [x] `npm run version:check`
- [x] `npm run test:release-gate`
- [x] `node scripts/audit-zombie-files.mjs`
- [x] `node scripts/docs-drift-check.mjs`
- [x] `node scripts/chrome-store-compliance-check.mjs`
- [x] `./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh`
- [x] `npx opendevbrowser --help`
- [x] `npx opendevbrowser help`
- [x] `npm run lint`
- [x] `npm run typecheck`
- [x] `npm run test`
- [x] `npm run build`
- [x] `npm run extension:build`
- [x] `npm run extension:pack`
- [x] `npm pack --pack-destination /tmp`

## Optional Strict Live Gates

- [ ] Deferred unless explicitly required for this release:
  - `node scripts/provider-direct-runs.mjs --release-gate --out artifacts/release/v0.0.30/provider-direct-runs.json`
  - `node scripts/live-regression-direct.mjs --release-gate --out artifacts/release/v0.0.30/live-regression-direct.json`

## Implementation Proof

- [x] Progressive RepoPrompt review loop completed.
  - First review found P2 test coverage gaps for direct and daemon roots; fixed.
  - Second review found an unrelated screencast assertion hunk; removed.
  - Third review had no actionable P0/P1/P2 findings.
- [x] Focused workflow test suite passed after review.
  - Command: `npm run test -- tests/tools-workflows.test.ts tests/daemon-commands.integration.test.ts tests/cli-workflows.test.ts tests/providers-artifacts-workflows.test.ts tests/providers-inspiredesign-workflow.test.ts`
  - Result: 5 files passed, 196 tests passed.
- [x] Pre-release full test gate passed before version bump.
  - Command: `npm run test`
  - Result: 271 files passed, 1 skipped; 4414 tests passed, 1 skipped; all-files coverage 98.22% statements, 97% branches, 97.95% functions, 98.28% lines.
- [x] Live workflow output validation passed before version bump.
  - CLI managed runs for research, shopping, inspiredesign, and product-video wrote under `.opendevbrowser/<workflow>/<uuid>`.
  - Direct OpenCode-style tool runs from `/var/folders/.../odb-direct-tool-cwd-*` wrote under the repo `.opendevbrowser`, not the temp cwd.
  - Raw daemon RPC runs wrote under the repo `.opendevbrowser/<workflow>/<uuid>`.
  - Explicit output roots were preserved across CLI, daemon RPC, and direct tool runs.

## Local Release Gate Results

- `npm run extension:sync`: synced `extension/manifest.json` and `extension/package.json` to `0.0.30`.
- `npm run version:check`: passed, version `0.0.30`.
- `node scripts/audit-zombie-files.mjs`: passed, scanned 1028 files, flagged none.
- `node scripts/docs-drift-check.mjs`: initially failed because `README.md` still referenced `opendevbrowser-0.0.29.tgz`; after updating that stale reference, rerun passed.
- `node scripts/chrome-store-compliance-check.mjs`: passed, manifest version `0.0.30`.
- `./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh`: passed, 22 referenced files present, 10 JSON templates parsed.
- `npm run test:release-gate`: passed all five groups.
  - Group 1 `provider-direct-contracts`: 2 files passed, 99 tests passed.
  - Group 2 `live-direct-regression-contracts`: 3 files passed, 37 tests passed.
  - Group 3 `cli-help-parity`: 1 file passed, 15 tests passed.
  - Group 4 `docs-and-zombie-audits`: 2 files passed, 5 tests passed.
  - Group 5 `chrome-store-compliance`: 1 file passed, 1 test passed.
- `npx opendevbrowser --help`: passed, wrote 798 lines to `/tmp/odb-help-0.0.30.txt`.
- `npx opendevbrowser help`: passed, wrote 798 lines to `/tmp/odb-help-command-0.0.30.txt`.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `npm run extension:build`: passed.
- `npm run test`: passed, 271 files passed, 1 skipped; 4414 tests passed, 1 skipped; all-files coverage 98.22% statements, 97% branches, 97.95% functions, 98.29% lines.
- `npm run extension:pack`: passed, produced `opendevbrowser-extension.zip`.
- `shasum -a 256 opendevbrowser-extension.zip`: `d794bd052e3e01ab6bb84d99f983e36faa989afd7e1e42128634111043773a75`.
- `npm pack --pack-destination /tmp`: passed, produced `/tmp/opendevbrowser-0.0.30.tgz`; package size 2.3 MB, unpacked size 11.6 MB, total files 1218, shasum `af40f0b5b41da820db34af604bfbf49bf150892e`.

## External Release Workflow Evidence

- [ ] Release workflow run URL
- [ ] npm publish verification
- [ ] Registry consumer smoke
- [ ] GitHub release URL
- [ ] GitHub release asset verification

## Notes

- Strict live gates are separate from release quality gates. They remain deferred for this release unless explicitly enabled.
- If GitHub Actions npm publication fails despite `NPM_TOKEN` being configured, local authenticated npm publish is available as fallback and must be recorded here.
