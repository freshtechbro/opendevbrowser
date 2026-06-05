# Pin Media Public Surface Update Plan

Date: 2026-05-27

## Task 1 - Register pin-media handoff artifacts
Reasoning: downstream agents need the new pin-media proof files in the same handoff map as visual, screenshot, motion, and ranked-reference artifacts.
What to do: add `pin-media-evidence.json` and `pin-media-index.json` to handoff guidance and required artifact navigation.
How:
1. Extend `INSPIREDESIGN_HANDOFF_FILES` with pin-media evidence and index names.
2. Add artifact guide entries that define persisted first-party Pinterest media proof.
3. Include them in reference artifact lists surfaced through `design-agent-handoff.json`.
Files impacted: `src/inspiredesign/handoff.ts`, `src/inspiredesign/contract.ts`.
Acceptance criteria:
- [ ] The handoff guide names both new files.
- [ ] The guide says remote DOM media URLs alone are not proof.
- [ ] Required reference artifact navigation includes the new files.

## Task 2 - Update meta prompt validation gates
Reasoning: the generated prompt is the downstream implementation checklist, so it must teach agents to inspect pin-media evidence before visual claims.
What to do: add pin-media artifact checks without weakening screenshot or motion gates.
How:
1. Add the new JSON files to the validation gate list.
2. Add strict language that pin-media proof is persisted first-party artifact evidence, not remote URL proof.
Files impacted: `src/inspiredesign/meta-prompt.ts`.
Acceptance criteria:
- [ ] Validation gates mention both pin-media files.
- [ ] Validation gates preserve screenshot path and real browser verification requirements.

## Task 3 - Update Pinterest recovery guidance
Reasoning: users recovering Pinterest harvests need to know the preferred recovery lane is authenticated canonical pin media evidence, not search shells or unrelated providers.
What to do: revise Pinterest guidance and tests to mention canonical pin media artifacts while keeping blockers strict.
How:
1. Update artifact inputs, validation checks, recovery steps, and do-not-proceed blockers.
2. Add tests that assert pin-media artifact guidance and strict provider fallback behavior.
Files impacted: `src/guidance/recipes/pinterest.ts`, `tests/pinterest-guidance-recipe.test.ts`.
Acceptance criteria:
- [ ] Guidance points to authenticated canonical pin media evidence.
- [ ] Guidance still blocks search shells, login walls, boards, source pages, and unrelated providers.

## Task 4 - Sync public docs and generated surfaces
Reasoning: first-contact docs, help, and manifest metadata must expose the same readiness contract.
What to do: update docs, help, public-surface source, generated snapshots, and tests.
How:
1. Replace screenshot-only Pinterest readiness wording with snapshot, motion, or pin-media authority wording.
2. Add artifact list mentions for `pin-media-evidence.json` and `pin-media-index.json`.
3. Regenerate public-surface manifests from source.
Files impacted: `docs/CLI.md`, `docs/SURFACE_REFERENCE.md`, `src/cli/help.ts`, `src/public-surface/source.ts`, `src/public-surface/generated-manifest.ts`, `src/public-surface/generated-manifest.json`, `tests/public-surface-manifest.test.ts`.
Acceptance criteria:
- [ ] Public wording names the new artifacts.
- [ ] Canvas continuation still requires readiness, ranked references, and manifest-backed authority.
- [ ] Public-surface tests assert pin-media prerequisites.

## Task 5 - Sync bundled skill artifact guidance
Reasoning: bundled OpenDevBrowser skill guidance is a user-facing artifact review surface.
What to do: update only the skill files and helper script messages that list harvest artifacts.
How:
1. Add pin-media artifacts to the best-practices, design-agent, and motion-design artifact review lists where relevant.
2. Update the workflow helper comment and validator marker to include the new artifact names.
Files impacted: `skills/opendevbrowser-best-practices/SKILL.md`, `skills/opendevbrowser-best-practices/scripts/odb-workflow.sh`, `skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh`, `skills/opendevbrowser-design-agent/artifacts/research-harvest-workflow.md`, `skills/opendevbrowser-motion-design/SKILL.md`.
Acceptance criteria:
- [ ] Skill guidance tells agents to inspect pin-media artifacts after ready harvests.
- [ ] Skill validation still passes.

## Task 6 - Verify focused surfaces
Reasoning: changed docs, generated manifests, and tests must stay synchronized.
What to do: run focused verification for touched tests and docs drift.
How:
1. Run `npm run test -- tests/pinterest-guidance-recipe.test.ts tests/public-surface-manifest.test.ts tests/providers-inspiredesign-contract.test.ts`.
2. Run `node scripts/generate-public-surface-manifest.mjs` before public-surface tests if needed.
3. Run `node scripts/docs-drift-check.mjs`.
4. Run a scoped em dash check over changed source, docs, tests, and skill files.
Files impacted: verification only.
Acceptance criteria:
- [ ] Focused tests pass.
- [ ] Docs drift check passes.
- [ ] Changed files contain no em dash character.
