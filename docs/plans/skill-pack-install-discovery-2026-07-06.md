# OpenDevBrowser Skill Pack Install Discovery Fix Plan

## Version History

- 2026-07-06 v1: Initial plan for stale markerless OpenDevBrowser skill packs in partially managed Codex-visible roots.

## Context

Codex currently sees duplicate OpenDevBrowser skill entries when both `~/.agents/skills` and `~/.codex/skills` contain canonical `opendevbrowser-*` packs. The reproduced failure is a partially managed Agents root: the root marker owns only design and motion packs, while the remaining canonical pack directories are stale and markerless. Full sync promotes the root marker to all canonical packs, but the existing refresh guard preserves those stale directories.

## Dependency Mapping

- The regression test must fail before production code changes.
- The installer fix depends on the existing `syncBundledSkillsForTargets()` ownership model and must not widen uninstall deletion safety.
- Real discovery evidence depends on the installer fix and a fresh Codex prompt-input inventory.
- Skill workflow/readiness validation depends on current installed copies and repo-local skill guidance.

## Task 1 - Pin Stale Agents Root Regression

Reasoning: The observed Codex duplicate surface comes from stale markerless canonical packs surviving in a partially managed Agents root.
What to do: Add focused coverage for full canonical sync adopting those stale markerless packs.
How:
1. Seed a temp global Agents target with a partial root marker.
2. Add stale markerless directories for the other canonical `opendevbrowser-*` packs.
3. Assert full sync refreshes/adopts all canonical packs, writes sentinels, and records `managesAllCanonicalPacks: true`.
Files impacted: `tests/cli-skills-installer.test.ts`.
Acceptance criteria:
- [ ] Focused test fails before the production fix for the intended `preserved` assertion.
- [ ] Focused test passes after the production fix.

## Task 2 - Fix Canonical Full-Sync Adoption

Reasoning: Full canonical sync already represents OpenDevBrowser ownership intent for canonical bundled packs, so stale markerless canonical copies in the target root should be adopted rather than preserved.
What to do: Update the installer refresh guard to allow full canonical sync to refresh canonical packs while preserving custom or non-canonical user packs.
How:
1. Keep `syncSkillDirectory()` unchanged.
2. Compute whether the current sync request is full canonical for the target.
3. Allow refresh for `preexistingSentinel`, previous marker ownership, or full canonical sync ownership.
4. Leave removal logic sentinel/fingerprint based so uninstall does not delete user-owned stale copies unless they have been adopted.
Files impacted: `src/cli/installers/skills.ts`.
Acceptance criteria:
- [ ] Partial-marker stale canonical packs are refreshed and receive sentinels.
- [ ] Custom `opendevbrowser-*` and non-canonical system packs remain preserved by existing tests.
- [ ] Existing uninstall safety tests still pass.

## Task 3 - Prove Codex Discovery Surface

Reasoning: Filesystem install success is insufficient; the user-facing failure is missing or duplicate skills in Codex picker surfaces.
What to do: Run fixed install/update flows and fresh Codex inventory probes.
How:
1. Use isolated homes for happy-path and stale/duplicate edge probes.
2. Parse `codex debug prompt-input` output for the ten expected skill names.
3. Confirm each expected skill appears exactly once and points at a current installed copy.
Files impacted: `.omo/ulw-loop/skill-pack-install-discovery-2026-07-06/evidence/*`.
Acceptance criteria:
- [ ] C001 evidence shows all ten expected skills exactly once.
- [ ] C002 evidence shows stale markerless copies replaced and duplicate count zero.

## Task 4 - Validate Skill Workflow Readiness

Reasoning: Prior audits showed validators can pass while helper snippets or readiness claims drift from runtime behavior.
What to do: Run validators and bounded smoke/readiness audits for every bundled OpenDevBrowser skill.
How:
1. Run each pack validator.
2. Run the skill runtime audit where feasible.
3. Cross-check readiness authority references for workflow packs against current CLI/docs/source.
4. Update guidance only if stale assertions are found in the scoped surfaces.
Files impacted: `skills/opendevbrowser-*`, `docs/CLI.md`, `docs/SURFACE_REFERENCE.md`, `README.md`, relevant `AGENTS.md` files if behavior guidance changes.
Acceptance criteria:
- [ ] C003 evidence contains a per-skill pass table and stale-assertion notes.
- [ ] Any behavior or install guidance change is reflected in required docs and scoped AGENTS files.

## Task 5 - Review, Commit, PR, and Close ULW

Reasoning: The install path affects multiple agent surfaces and must land through reviewed, atomic changes.
What to do: Run the review loop, quality gates, commit, open a PR, monitor checks, and checkpoint ULW.
How:
1. Run focused tests, targeted lint/typecheck/build, and relevant skill checks.
2. Run RepoPrompt and CE review loops against the branch diff.
3. Fix review findings and rerun affected verification.
4. Commit atomic changes with Conventional Commit footer.
5. Push, open PR, monitor checks, and record ULW evidence/checkpoint.
Files impacted: Git metadata, PR, `.omo/ulw-loop/.../ledger.jsonl`.
Acceptance criteria:
- [ ] All required checks pass with zero errors and zero warnings.
- [ ] PR is open and checks are passing or any external blocker is durably recorded.
- [ ] ULW criteria and final quality gate are recorded through the ULW CLI.
