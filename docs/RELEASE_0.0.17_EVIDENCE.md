# v0.0.17 Release Evidence

Status: active release ledger
Release date: 2026-03-13
Last audited against repo: 2026-03-13

## Scope

Tracks the verified release-prep gates for `v0.0.17`, including docs alignment, package/version sync, packaging outputs, and release/distribution handoff evidence for GitHub release, npm, and Chrome extension distribution.

## Release summary

- Canonical version owners are aligned at `0.0.17` in `package.json`, `extension/package.json`, and `extension/manifest.json`.
- Active release-facing docs, workflows, scripts, and changelog surfaces were refreshed for the `0.0.17` cycle.
- `scripts/sync-extension-version.mjs` now syncs both extension version owners, with regression coverage in `tests/sync-extension-version.test.ts`.
- Mandatory local release gates passed on the current tree.
- Optional live-environment release gates were not rerun in this pass and remain explicitly deferred.

## Repo snapshot

- Branch: `codex/design-canvas`
- HEAD: `6113befe161f3672b44ef8a3388fa5b008843764`
- HEAD date: `2026-03-13`
- HEAD subject: `docs: remove canvas pencil parity audit`
- Working tree at audit time: `23` modified, `5` untracked (`28` total)
- Local tag `v0.0.17`: absent

## Mandatory release gates

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

- [ ] `node scripts/provider-live-matrix.mjs --release-gate --out artifacts/release/v0.0.17/provider-live-matrix.json`
  - Status: deferred in this pass
- [ ] `node scripts/live-regression-matrix.mjs --release-gate`
  - Status: deferred in this pass
- [ ] First-run onboarding dry run from `docs/FIRST_RUN_ONBOARDING.md`
  - Status: deferred in this pass

## Deferred artifacts

- [ ] `artifacts/release/v0.0.17/provider-live-matrix.json`
  - Not generated because the strict live provider gate was deferred
- [ ] `artifacts/release/v0.0.17/live-regression-matrix-report.json`
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
