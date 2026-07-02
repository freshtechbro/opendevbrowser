# Skill Sync Agents Targets Plan

## Task 1 - Lock Current Failure
Reasoning: The install bug must be captured as a regression, not just described in the investigation report.
What to do: Add tests that prove package postinstall and normal skill sync ignore `.agents/skills` today.
How:
1. Extend postinstall sync assertions to require `$HOME/.agents/skills`.
2. Extend global and local installer assertions to require `.agents/skills` target markers and sentinels.
3. Extend SkillLoader coverage to require project and global `.agents/skills` discovery.
Files impacted: `tests/postinstall-skill-sync.test.ts`, `tests/cli-skills-installer.test.ts`, `tests/skill-loader.test.ts`.
Acceptance criteria:
- [x] Focused tests fail before production source changes for the missing `.agents/skills` target.

## Task 2 - Add Agents Skill Targets
Reasoning: npm package postinstall calls the existing global sync path, so the root fix is target resolution, not a second postinstall-only copy path.
What to do: Add `agents` as a managed target family for global and project-local sync.
How:
1. Add `agents` to `SkillTargetAgent`.
2. Include `$HOME/.agents/skills` in global target resolution.
3. Include `./.agents/skills` in project-local target resolution.
4. Preserve existing dedupe behavior so overlapping configured homes do not duplicate installs.
Files impacted: `src/cli/utils/skills.ts`.
Acceptance criteria:
- [x] `syncBundledSkills("global")` writes canonical packs, target marker, and sentinels into `$HOME/.agents/skills`.
- [x] `syncBundledSkills("local")` writes canonical packs, target marker, and sentinels into `./.agents/skills`.

## Task 3 - Add Runtime Discovery
Reasoning: Updating installed packs is incomplete if the runtime cannot find the same target family.
What to do: Make SkillLoader discover project and global `.agents/skills`.
How:
1. Add `project-agents` and `global-agents` source families.
2. Add project `.agents/skills` and global `$HOME/.agents/skills` to the deterministic search order.
3. Keep custom paths and bundled fallback after managed agent ecosystems.
Files impacted: `src/skills/types.ts`, `src/skills/skill-loader.ts`.
Acceptance criteria:
- [x] `.agents/skills` entries appear in discovery reports with source-family labels.
- [x] First-match and shadowed-alternative behavior remains deterministic.

## Task 4 - Align Guidance
Reasoning: Novice install/update reliability depends on shipped docs and installed skill guidance listing the actual targets and prefix-drift checks.
What to do: Update user-facing install and skill-sync guidance.
How:
1. Update install target lists and discovery order.
2. Add prefix-drift guidance where package install/update behavior is described.
3. Preserve Inspiredesign product-ready guardrails that reject diagnostic-only continuation.
Files impacted: `README.md`, `docs/CLI.md`, `docs/FIRST_RUN_ONBOARDING.md`, `docs/ARCHITECTURE.md`, `skills/opendevbrowser-best-practices/SKILL.md`, `skills/opendevbrowser-best-practices/artifacts/command-channel-reference.md`, `skills/AGENTS.md`.
Acceptance criteria:
- [x] Docs and skill pack name all five managed target families.
- [x] Guidance tells users to verify `command -v`, `which -a`, and `npm prefix -g` when installs appear stale.

## Task 5 - Prove Install Shape
Reasoning: Source tests are not enough for an npm lifecycle issue.
What to do: Re-run the packed-install smoke in an isolated HOME/prefix after the fix.
How:
1. Pack the current repo.
2. Install from the tarball into an isolated prefix and HOME.
3. Seed an old `.agents/skills/opendevbrowser-best-practices` before install.
4. Verify `.agents/skills` is refreshed with markers and sentinels.
Files impacted: ignored evidence under `.tmp/ulw-evidence/skill-sync-install-green/`.
Acceptance criteria:
- [x] GREEN smoke log shows `.agents/skills/.opendevbrowser-managed-skills.json`.
- [x] GREEN smoke log shows `.agents/skills/opendevbrowser-best-practices/.opendevbrowser-managed-skill.json`.
- [x] Seeded stale skill content no longer remains.
