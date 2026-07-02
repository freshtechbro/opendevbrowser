# Investigation: npm install skill-sync and product-ready guidance

## Summary
Npm package postinstall was running, but its managed skill target list omitted `~/.agents/skills`, and the runtime SkillLoader also omitted global and project `.agents/skills` discovery. The fix is to make Agents a first-class managed target family for install/update/postinstall and discovery, while keeping markerless lifecycle cleanup sentinel-scoped.

## Symptoms
- Fresh or updated npm installs run package postinstall but do not reliably update all skill-pack locations that users and agents actually load.
- Existing `~/.agents/skills/opendevbrowser-*` directories can lack `.opendevbrowser-managed-skill.json`, so future lifecycle refreshes do not own them.
- Active binary prefix can differ from `npm prefix -g`, so a novice can update a stale prefix and keep running an older Homebrew-prefix binary.
- Stale skill guidance can make agents continue from diagnostic-only Inspiredesign output instead of requiring product-ready authority.

## Background / Prior Research
- Current user-provided trace says `scripts/postinstall-sync-skills.mjs` calls `runPackagePostinstall()`, which calls `runPostinstallSkillSync()`, which calls `syncBundledSkills("global")`.
- Current user-provided trace says global managed targets omit `~/.agents/skills`.
- Current user-provided machine state says `/opt/homebrew/bin/opendevbrowser` is active at `0.0.38`, while `npm prefix -g` points to `~/.npm-global` with a stale broken symlink.
- Memory from earlier install/update work says prefix-aware updates on this Mac require comparing `command -v`, `which -a`, and `npm prefix -g` before selecting an install command.
- Memory from earlier Inspiredesign work says transport success must be separated from `productSuccess`, `artifactAuthority`, `evidenceAuthority`, and `nextStepGuidance.readiness`.

## Investigator Findings

### 2026-07-02 line-backed findings

#### Root cause
- Package postinstall is not the missing link. `runPackagePostinstall()` calls `runPostinstallSkillSync()` first, then autostart reconciliation (`src/cli/installers/package-postinstall.ts:303-321`), and postinstall skill sync defaults to `mode = "global"` before calling `syncBundledSkills(mode)` (`src/cli/installers/postinstall-skill-sync.ts:58-72`).
- The real gap is target and discovery coverage. Global sync targets are only OpenCode, Codex, ClaudeCode, and AmpCLI (`src/cli/utils/skills.ts:58-66`), and local sync targets are only `.opencode`, `.codex`, `.claude`, and `.amp` (`src/cli/utils/skills.ts:69-78`). Runtime discovery mirrors that family list and has no `.agents/skills` entry (`src/skills/skill-loader.ts:119-160`).
- Therefore adding global `~/.agents/skills` and project `./.agents/skills` is the correct fix only if it is done in both installer target resolution and `SkillLoader` discovery. Adding it to postinstall docs or installer targets alone would leave stale copies discoverable elsewhere.

#### Ownership policy
- The current ownership model is mostly correct: target markers and pack sentinels are explicit (`src/cli/installers/skills.ts:14-17`), marker parsing filters managed pack names (`src/cli/installers/skills.ts:117-135`), and sentinels are trusted only when `managedBy`, `packName`, and `fingerprint` match (`src/cli/installers/skills.ts:158-176`).
- Existing tests already protect user-owned bare canonical directories during markerless lifecycle recovery: a bare `opendevbrowser-best-practices` is not treated as managed (`tests/cli-skills-installer.test.ts:278-294`), bare user drift is not refreshed (`tests/cli-skills-installer.test.ts:296-326`), and bare user-owned packs are not removed (`tests/cli-skills-installer.test.ts:329-348`).
- Normal full sync intentionally owns the canonical bundled `opendevbrowser-*` pack names in managed target roots, including pre-existing stale bare copies in `~/.agents/skills`, so novice npm installs repair stale OpenDevBrowser packs hands-off. Markerless lifecycle recovery and uninstall remain sentinel-scoped, so unrelated directories and noncanonical user skills remain untouched unless they carry valid OpenDevBrowser ownership proof.

#### Eliminated hypotheses
- Eliminated: npm postinstall simply does not run skill sync. Evidence above shows the lifecycle shim reaches `runPostinstallSkillSync()` and global sync.
- Eliminated: Inspiredesign needs product-readiness runtime changes for this issue. Product success already requires ranked references, coherent counts, all ranked references authoritative, product-ready evidence authority, and Pinterest pin-media authority when required (`src/inspiredesign/product-readiness.ts:1161-1172`). Renderer output blocks Canvas continuation unless product success is true, marks diagnostic markdown, omits `canvasPlanRequest`, and exposes `artifactAuthority`, `evidenceAuthority`, and `productSuccess` in every mode (`src/providers/renderer.ts:1134-1390`). The stale guidance/install-sync path is the likely cause of agents continuing from diagnostic-only outputs.

#### Required tests
- Update `tests/cli-skills-installer.test.ts` for new global and local `.agents/skills` targets, managed marker/sentinel refresh, and stale bare canonical adoption during full sync.
- Update `tests/postinstall-skill-sync.test.ts`: it currently expects `4 * bundledSkillDirectories.length` installs and checks only the four existing global target dirs (`tests/postinstall-skill-sync.test.ts:160-181`).
- Update `tests/skill-loader.test.ts` for discovery order, first-match behavior, and shadowed alternatives with project `.agents/skills` and global `~/.agents/skills`.
- Update `tests/cli-update-skill-modes.test.ts` and lifecycle tests if default update behavior changes for managed `.agents` targets. Keep default update marker/sentinel-scoped unless explicit `--skills-global` or a managed target proves ownership.
- Run focused verification: `npm run test -- tests/cli-skills-installer.test.ts tests/postinstall-skill-sync.test.ts tests/skill-loader.test.ts tests/cli-update-skill-modes.test.ts`, then `npm run typecheck`, `npm run build`, and targeted ESLint for touched files.

#### Docs and public-surface recommendations
- Update docs that currently list only the four old target families: `docs/CLI.md:75-104`, `README.md:489-500`, and `skills/opendevbrowser-best-practices/SKILL.md:177-188`.
- Also update `docs/FIRST_RUN_ONBOARDING.md`, `docs/ARCHITECTURE.md`, and `skills/opendevbrowser-best-practices/artifacts/command-channel-reference.md` where install/update or discovery targets are described.
- If generated help or command descriptions mention exact skill target families, update `src/public-surface/source.ts`, regenerate `src/public-surface/generated-manifest.ts` and `src/public-surface/generated-manifest.json`, then update `docs/SURFACE_REFERENCE.md` as needed. Do not hand-edit generated manifests.
- Preserve the existing Inspiredesign guidance wording that requires `ready=true`, `productSuccess=true`, `artifactAuthority=product_ready`, non-diagnostic `evidenceAuthority`, and Pinterest `pin-media-index.json` authority. The issue is stale installed copies, not stale repo guidance.

#### Concrete recommendation
1. Add `agents` targets to global sync as `~/.agents/skills` and local sync as `./.agents/skills`, then add matching `SkillLoader` discovery entries with explicit precedence.
2. Preserve marker/sentinel ownership for lifecycle recovery and uninstall. Full sync should refresh canonical bundled pack names in managed roots so stale installed OpenDevBrowser packs are repaired by npm install/update.
3. Update focused tests and docs in the same change. Regenerate public-surface manifests only if public help/source wording changes.
4. Do not change Inspiredesign runtime for this gap unless a new failing runtime test shows diagnostic-only output can still produce product-ready continuation artifacts.

## Investigation Log

### Phase 5 - Verification and review
**Hypothesis:** The `.agents/skills` target and discovery fix works in source tests and in packed npm install shape.
**Findings:** Confirmed. Focused tests, full suite, lint, typecheck, build, docs drift, skill asset validation, whitespace checks, em dash scan, and packed-install smoke all passed.
**Evidence:** Focused installer tests passed with 123 tests after the final test hardening. Full `npm run test` passed with 297 files, 5652 tests, one skipped live Figma smoke, and global branch coverage at 97%. Packed install smoke `.tmp/ulw-evidence/skill-sync-install-green/green.log` shows `agentsMarkerExists=true`, `agentsBestPracticesSentinelExists=true`, `agentsBestPracticesVersionLine="version: 2.6.0"`, and `GREEN packed install smoke passed`. The only packed-install warning was non-fatal `EBADENGINE` from `ini@7.0.0` because local Node was `v22.22.0`.
**Conclusion:** Confirmed.

**Hypothesis:** The final diff has no remaining review blockers.
**Findings:** Confirmed. RepoPrompt diff review and agent-mode review both reported no blockers. Residual risk is intentional: full sync refreshes canonical `opendevbrowser-*` pack directories in managed roots, including markerless stale copies, to repair stale OpenDevBrowser guidance hands-off.
**Evidence:** RepoPrompt review chat `untitled-chat-EBA2F9`; RepoPrompt agent session `29F0A199-1FFD-49BA-80A0-0B8FF3FA3217`.
**Conclusion:** Confirmed.

### Phase 0 - Initial hypotheses
**Hypothesis:** Package postinstall is functioning but targets too few global skill roots.
**Findings:** Confirmed. Package postinstall reaches `syncBundledSkills("global")`, but the global target list omitted `~/.agents/skills`.
**Evidence:** `src/cli/installers/package-postinstall.ts`, `src/cli/installers/postinstall-skill-sync.ts`, `src/cli/utils/skills.ts`, `.tmp/ulw-evidence/skill-sync-install-red/red.log`.
**Conclusion:** Confirmed.

**Hypothesis:** Existing unowned OpenDevBrowser skill copies should be migrated only when they are canonical bundled packs, not arbitrary user-owned directories.
**Findings:** Confirmed for full sync. Canonical bundled pack names are refreshed in managed target roots, while markerless recovery and uninstall remain sentinel-scoped.
**Evidence:** `tests/cli-skills-installer.test.ts` now covers stale bare Agents pack adoption and markerless lifecycle preservation.
**Conclusion:** Confirmed.

**Hypothesis:** Prefix drift requires explicit diagnostics or help wording because postinstall cannot update a binary the user is not actually invoking.
**Findings:** Confirmed as a guidance issue. The machine-local active binary can be under `/opt/homebrew` while `npm prefix -g` points elsewhere.
**Evidence:** User-provided machine state plus updated `README.md`, `docs/CLI.md`, and `skills/opendevbrowser-best-practices/SKILL.md` guidance.
**Conclusion:** Confirmed.

**Hypothesis:** Inspiredesign runtime readiness is already mostly correct, but stale installed guidance and next-step instructions can cause agents to treat diagnostic-only outputs as usable.
**Findings:** Confirmed. Runtime product-readiness gates are already strict; the fix is to make installed guidance update reliably and preserve the product-ready authority checks.
**Evidence:** `src/inspiredesign/product-readiness.ts`, `src/providers/renderer.ts`, and unchanged best-practices guidance requiring `ready=true`, `productSuccess=true`, `artifactAuthority=product_ready`, non-diagnostic `evidenceAuthority`, and Pinterest `pin-media-index.json` authority.
**Conclusion:** Confirmed.

## Root Cause
The npm lifecycle shim correctly invokes package postinstall and global skill sync, but the target source of truth omitted the Agents skill roots that this machine and related agent workflows actually use. Runtime discovery mirrored that omission. As a result, npm install/update could refresh Codex/OpenCode/ClaudeCode/AmpCLI skill copies while leaving `~/.agents/skills/opendevbrowser-*` stale and unmanaged. A separate usability issue made this harder for novices: the active `opendevbrowser` binary can come from a different prefix than `npm prefix -g`, so a plain global npm install can update a non-active package tree.

## Recommendations
1. Treat `agents` as a managed target family in `getGlobalSkillTargets()` and `getLocalSkillTargets()`.
2. Add `project-agents` and `global-agents` SkillLoader source families so runtime discovery matches installer behavior.
3. Keep full install/postinstall capable of refreshing canonical bundled pack names in Agents roots, including stale bare OpenDevBrowser packs.
4. Keep markerless recovery and uninstall limited to target markers and valid per-pack sentinels.
5. Keep docs and shipped skill guidance explicit about all five target families and prefix-drift checks.
6. Leave Inspiredesign runtime readiness unchanged unless a separate runtime failure proves diagnostic-only output can still emit product-ready continuation artifacts.

## Preventive Measures
- Regression tests now require package postinstall to install into five global targets, including `$HOME/.agents/skills`.
- Installer tests now require global and local Agents target markers, per-pack sentinels, and stale bare Agents pack adoption during full sync.
- SkillLoader tests now require project and global `.agents/skills` discovery with `project-agents` and `global-agents` provenance.
- Docs and bundled skill guidance now list OpenCode, Codex, ClaudeCode, AmpCLI, and Agents targets together to prevent future four-family drift.
