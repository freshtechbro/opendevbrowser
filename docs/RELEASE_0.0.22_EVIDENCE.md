# v0.0.22 Release Evidence

Status: active release ledger
Target release date: 2026-04-20  
Last updated: 2026-04-20

## Scope

Tracks the `0.0.22` release cycle after the published `v0.0.21` release, including the post-merge follow-up that closes the remaining bundled skill lifecycle ownership gaps in installer sync and uninstall flows.

## Baseline comparison

- Reference release: GitHub `v0.0.21`
  - URL: `https://github.com/freshtechbro/opendevbrowser/releases/tag/v0.0.21`
  - Published: `2026-04-19`
  - Target: `main`
  - GitHub assets:
    - `opendevbrowser-extension.zip`
    - `opendevbrowser-extension.zip.sha256`
- Current `0.0.22` delta is based on merged PR `#31` plus release-prep version and evidence updates on top of `main`.

## Release summary

- Preserves sentinel-discovered canonical bundled skill packs during subset-marker sync and uninstall cleanup.
- Stops rediscovering edited retired packs as managed lifecycle artifacts once cleanup no longer owns them.
- Keeps the install and postinstall contract unchanged: every install redistributes bundled skills into supported global agent skill directories.

## Historical repo note

- Release-prep branch: `main`
- Release tag target: `v0.0.22`
- npm `latest`: `0.0.22` after local publish verification
- GitHub release: `v0.0.22` is live with packaged extension assets
- Release-time version authority was `package.json` at `0.0.22`; the current repo version has since advanced to `0.0.24`.
- `docs/RELEASE_0.0.21_EVIDENCE.md` remains historical release evidence

## Mandatory release gates

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
- [x] `npm pack`
- [x] After npm publish, `node scripts/registry-consumer-smoke.mjs --version 0.0.22 --output artifacts/release/v0.0.22/registry-consumer-smoke.json`

## Optional release-environment gates

- [x] `node scripts/provider-direct-runs.mjs --release-gate --out artifacts/release/v0.0.22/provider-direct-runs.json`
- [x] `node scripts/live-regression-direct.mjs --release-gate --out artifacts/release/v0.0.22/live-regression-direct.json`
- [x] First-run onboarding dry run from `docs/FIRST_RUN_ONBOARDING.md`

## Repo sanity checks

- [x] `git diff --check`
- [ ] `git status --short`

## Artifacts

- [x] `opendevbrowser-extension.zip`
- [x] `opendevbrowser-0.0.22.tgz`

## Local verification snapshot

- Local release-gate sweep reran after the onboarding-proof doc updates on `2026-04-20` and passed:
  - `git diff --check`
  - `npm run version:check`
  - `node scripts/audit-zombie-files.mjs`
  - `node scripts/docs-drift-check.mjs`
  - `node scripts/chrome-store-compliance-check.mjs`
  - `./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh`
  - `npx opendevbrowser --help`
  - `npx opendevbrowser help`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:release-gate`
  - `npm run test`
  - `npm run build`
  - `npm run extension:build`
  - `npm run extension:pack`
  - `npm pack`
- Test summary from that sweep:
  - `259` test files passed, `1` skipped
  - `3771` tests passed, `1` skipped
  - Coverage: `98.10%` statements, `97.01%` branches, `97.75%` functions, `98.16%` lines
- Provider direct release gate:
  - Artifact: `artifacts/release/v0.0.22/provider-direct-runs.json`
  - Counts: `19 pass`, `11 env_limited`, `0 fail`, `0 skipped`
  - Notes: the script returned non-zero because env-limited lanes remain honest blockers for auth, challenge, or provider-policy constrained sources; there were no true failures.
- Live regression direct release gate:
  - Artifact: `artifacts/release/v0.0.22/live-regression-direct.json`
  - Counts: `6 pass`, `0 env_limited`, `0 fail`, `2 skipped`
  - Skipped lanes:
    - `feature.annotate.relay` -> `manual_probe_boundary_observed:relay_annotation_timeout`
    - `feature.annotate.direct` -> `manual_probe_boundary_observed:direct_annotation_timeout`
- Onboarding dry run from the packaged tarball:
  - Isolated env homes were set before `npm install`: `HOME`, `OPENCODE_CONFIG_DIR`, `OPENCODE_CACHE_DIR`, `CODEX_HOME`, `CLAUDECODE_HOME`, `AMP_CLI_HOME`
  - `npm install opendevbrowser-0.0.22.tgz` redistributed all 9 canonical bundled skill packs into isolated OpenCode, Codex, ClaudeCode, and Amp global skill directories during package postinstall
  - Each global skill directory contained `.opendevbrowser-managed-skills.json` plus one `.opendevbrowser-managed-skill.json` sentinel per bundled pack
  - `npx --no-install opendevbrowser --global --full --no-prompt` exited `0`, reported `Skills global sync: 36 unchanged across 4 targets`, and extracted extension assets to the isolated home config path
  - Autostart repair correctly warned that the temp onboarding CLI path is transient
- External publish-state verification:
  - `npm publish --access public` succeeded and ended with `+ opendevbrowser@0.0.22`
  - `npm view opendevbrowser version dist-tags --json` now reports:
    - `version: 0.0.22`
    - `dist-tags.latest: 0.0.22`
  - Registry consumer smoke:
    - Command: `node scripts/registry-consumer-smoke.mjs --version 0.0.22 --output artifacts/release/v0.0.22/registry-consumer-smoke.json`
    - Artifact: `artifacts/release/v0.0.22/registry-consumer-smoke.json`
    - Result: `success: true`
    - Checks:
      - `helpAliasMatches: true`
      - `findItFastPresent: true`
      - `extensionDirExists: true`
      - `skillsDirExists: true`
      - `versionMatches: true`
  - Release automation constraints remain unchanged:
    - `gh secret list --repo freshtechbro/opendevbrowser` still shows `PRIVATE_REPO_DISPATCH_TOKEN` only
    - `npm whoami` remains `bishopdotun`

## External release workflow evidence

- [x] GitHub release workflow run URL
- [x] GitHub release URL
- [x] npm publish verification (`npm view opendevbrowser version`)
- [x] Chrome Web Store upload status
- [ ] Chrome Web Store submit-for-review status

## Notes

- Public repo secrets currently visible through `gh secret list --repo freshtechbro/opendevbrowser`: `PRIVATE_REPO_DISPATCH_TOKEN` only.
- Because the public repo still lacks repo-level `NPM_TOKEN` and `CWS_*` secrets, npm publish must run locally and the Chrome Web Store lane must use local credentials or a browser-manual dashboard flow from this operator machine.
- Keep this ledger active until npm, GitHub release artifacts, and the Chrome lane are either completed or blocked with evidence.
- Protected `main` prevented a direct post-publish evidence push. The publish-verification update was merged through PR `#32`: `https://github.com/freshtechbro/opendevbrowser/pull/32`
- Merge commit for that follow-up evidence PR on `main`: `a204f24323c23f0b6f0eff06b3f71ceb58e12477`
- GitHub release workflow dispatch used the release-only lane to avoid a duplicate npm publish:
  - Run URL: `https://github.com/freshtechbro/opendevbrowser/actions/runs/24665306661`
  - Inputs: `release_ref=main`, `release_tag=v0.0.22`, `publish_npm=false`, `publish_github_release=true`
  - Result: success
- GitHub release URL: `https://github.com/freshtechbro/opendevbrowser/releases/tag/v0.0.22`
- GitHub release assets present:
  - `opendevbrowser-extension.zip`
  - `opendevbrowser-extension.zip.sha256`
- Chrome Web Store manual browser lane:
  - Item: `OpenDevBrowser Relay`
  - Upload artifact: local `opendevbrowser-extension.zip`
  - Accepted state after upload: `Draft 0.0.22`
  - Current published store version still visible in dashboard: `0.0.20`
  - Status page state: `This draft is unpublished`
  - Final `Submit for review` action is still pending explicit operator confirmation
