# Skill-First Research Model Plan

Status: planned
Last updated: 2026-05-09

This plan moves OpenDevBrowser research from a public "reliable generic auto workflow" posture to a skill-first, evidence-gated posture. It improves the existing research skill, demotes overconfident public wording, and preserves the runtime evidence primitives that make successful research auditable.

---

## Overview

### Scope
- Make `opendevbrowser-research` the recommended entrypoint for research tasks.
- Add a skill-guided search-engine discovery protocol that can make outputs richer without turning browser SERP scraping into a default runtime feature.
- Keep `research run` as a public low-level workflow and tool primitive.
- Update public help, onboarding, docs, best-practices guidance, and handoff text so they no longer describe generic `--source-selection auto` research as reliable or safest.
- Preserve the source-family contract: `auto`, `web`, `community`, `social`, `shopping`, and `all`.
- Preserve successful research artifacts: `summary.md`, `report.md`, `records.json`, `context.json`, `meta.json`, and `bundle-manifest.json`.
- Preserve no-evidence failure semantics: shell-only, stale-only, login-only, not-found-only, and zero-source-evidence runs must fail before successful artifact emission.

### Key decisions
- Replace the displayed public `research_reliable` wording with `research_evidence_gated`. Do not rename persisted metadata keys unless tests prove the key is itself a public contract.
- Use `--sources web,community` as the canonical public example for explicit source-family research. Use `--source-selection` only when explaining selector semantics, not as the preferred public example.
- Put the search-engine approach in the skill as a manual or agent-guided protocol: choose engines, record the rationale, collect top candidates, dedupe, fetch destination pages, and synthesize only from destination evidence.
- Treat SERPs as discovery-only. SERP snippets, result pages, shells, and blocked pages cannot be final evidence.
- Do not add source-family schema expansion, runtime search-engine selectors, hidden shared API keys, feature flags, anti-bot bypass, login bypass, challenge bypass, or fallback paths that weaken evidence gates.
- Treat `research run` as provider-constrained and best-effort. The skill owns planning, evidence review, confidence, limitations, and final synthesis.
- Do not edit runtime schemas or evidence primitives unless a direct test failure requires a narrow wording-only adjustment.

---

## Task 1 - Reposition the research skill as the primary evidence-gated workflow

### Reasoning
The current skill still reads like a deterministic CLI wrapper around `research run`. That conflicts with the investigations showing live provider constraints and no viable free, no-setup generic SERP default.

### What to do
Rewrite the research skill so it guides deliberate, evidence-gated research before and after any CLI run.

### How
1. Update `skills/opendevbrowser-research/SKILL.md` front matter to describe skill-guided, evidence-gated research.
2. Make the first-use guidance say agents should load the skill before research tasks.
3. Replace deterministic public multi-source wording with provider-constrained evidence gathering.
4. State that `research run` is a low-level best-effort primitive, not the primary research model.
5. Replace any `auto` recommendation with a warning that `auto` is a selector, not a reliability guarantee.
6. Add an Evidence Gate section requiring artifact review before claims are published.
7. List the preserved artifact files exactly.

### Files impacted
- `skills/opendevbrowser-research/SKILL.md`

### End goal
The research skill is the canonical first stop for research and no longer markets generic `auto` as reliable.

### Acceptance criteria
- [ ] The skill does not say `auto` is the recommended default for topical research.
- [ ] The skill says `research run` is low-level, best-effort, and provider-constrained.
- [ ] The skill lists `summary.md`, `report.md`, `records.json`, `context.json`, `meta.json`, and `bundle-manifest.json`.
- [ ] The skill states that shell-only, stale-only, login-only, not-found-only, and zero-evidence runs cannot support final claims.

---

## Task 2 - Expand research workflow guidance and templates

### Reasoning
The current workflow guide and templates are too thin for a research handoff. They do not force claim-to-source review, provider limitations, or unsupported-claim handling.

### What to do
Update the research skill artifacts and templates to guide evidence review, confidence, limitations, and final synthesis.

### How
1. Rewrite `artifacts/research-workflows.md` around an evidence-first workflow.
2. Add steps for choosing explicit source families before invoking the CLI primitive.
3. Add steps for reviewing `records.json`, `context.json`, and `meta.json` before using `report.md`.
4. Add guidance to mark unsupported claims as tentative or exclude them.
5. Add guidance to record provider blockers, rate limits, login walls, challenge pages, stale pages, and extraction limits.
6. Update `assets/templates/compact.md` with evidence gaps and provider constraints.
7. Update `assets/templates/report.md` with concise sections for claim map, evidence, confidence, limitations, and final answer.
8. Update `assets/templates/context.json` with valid JSON fields for evidence gate status, artifact files, source ledger, unsupported claims, and staleness checks.

### Files impacted
- `skills/opendevbrowser-research/artifacts/research-workflows.md`
- `skills/opendevbrowser-research/assets/templates/compact.md`
- `skills/opendevbrowser-research/assets/templates/report.md`
- `skills/opendevbrowser-research/assets/templates/context.json`

### End goal
The skill package teaches users to inspect evidence instead of trusting workflow success alone.

### Acceptance criteria
- [ ] Workflow docs mention explicit source-family selection.
- [ ] Templates include evidence gaps and provider constraints.
- [ ] `context.json` remains valid JSON.
- [ ] Templates do not introduce runtime search-engine selectors, API keys, or source-family schema expansion.

---

## Task 3 - Add a skill-guided search-engine discovery lane

### Reasoning
The search-engine investigation found that multi-engine discovery can improve breadth, but only if it is skill-guided, policy-aware, and evidence-gated. This belongs in the research skill because the agent must choose engines, handle blockers, inspect pages, and explain limitations instead of relying on a hidden runtime default.

### What to do
Add a search-engine discovery protocol to the research skill and templates while keeping runtime schemas unchanged.

### How
1. Add a "Search Engine Discovery Lane" section to `skills/opendevbrowser-research/SKILL.md`.
2. Define the lane as optional and skill-guided, not a reliable default and not a `research run` replacement.
3. Instruct the agent to choose up to five engines based on topic and availability. Candidate set: Google, Bing, Brave, DuckDuckGo or Yahoo for overlap checks, Yandex for regional/index diversity, Baidu for China-specific topics, and Kagi only when the user has account access.
4. Require the agent to record engine choice rationale, query variants, region/language assumptions, auth/cookie needs, and blockers.
5. Specify the candidate workflow: collect up to 10 result URLs per selected engine, preserve engine and rank provenance, dedupe canonical URLs, then select the strongest 5 to 10 destination pages for extraction.
6. Require destination-page extraction through OpenDevBrowser browsing primitives when useful, including DOM interaction, screenshots, cookies, and authenticated browsing when the user has legitimate access.
7. Forbid bypassing robots restrictions, login walls, consent gates, CAPTCHAs, rate limits, anti-bot controls, or access controls. Stand down and record limitations instead.
8. Update `artifacts/research-workflows.md` with this lane as a rich-output protocol.
9. Update templates to include `search_engine_passes`, `serp_candidates`, `selected_destination_pages`, `engine_failures`, `provenance`, and `limitations`.
10. Keep SERPs discovery-only. Final claims must cite destination pages or other fetched evidence that survived review.

### Files impacted
- `skills/opendevbrowser-research/SKILL.md`
- `skills/opendevbrowser-research/artifacts/research-workflows.md`
- `skills/opendevbrowser-research/assets/templates/compact.md`
- `skills/opendevbrowser-research/assets/templates/report.md`
- `skills/opendevbrowser-research/assets/templates/context.json`

### End goal
The skill can produce richer research output using multiple search engines while remaining honest, manual/agent-guided, and evidence-gated.

### Acceptance criteria
- [ ] The search-engine lane is documented as optional, skill-guided, and provider-constrained.
- [ ] The lane says SERPs are discovery-only and cannot be final evidence.
- [ ] The lane records engine, query, rank, URL, blocker, and destination-page provenance.
- [ ] The lane supports cookies and authenticated browsing only for legitimate user-authorized access.
- [ ] The lane does not add runtime flags, tool schemas, hidden APIs, or bypass behavior.

---

## Task 4 - Harden research skill validation around evidence-gated assets

### Reasoning
The current validator checks asset presence and minimal markers. It should also prevent future drift back to overconfident generic research wording.

### What to do
Update the research skill validator to enforce the new evidence-gated posture and preserved artifact contract.

### How
1. Add required marker checks for `evidence-gated`, `provider-constrained`, `discovery-only`, `search_engine_passes`, and every preserved artifact filename.
2. Add forbidden marker checks for `research_reliable`, `auto is the recommended default`, and `generic topical research is currently safest`.
3. Keep the negative checks narrow to these exact phrases so the validator enforces posture without becoming a broad style linter.
4. Keep shared CLI resolver validation unchanged.
5. Keep wrapper script validation unchanged unless usage text needs wording alignment.
6. If wrapper usage changes, update only text assertions and keep command behavior unchanged.

### Files impacted
- `skills/opendevbrowser-research/scripts/validate-skill-assets.sh`
- `skills/opendevbrowser-research/scripts/run-research.sh` if usage text needs alignment
- `skills/opendevbrowser-research/scripts/render-output.sh` if usage text needs alignment
- `skills/opendevbrowser-research/scripts/write-artifacts.sh` if usage text needs alignment

### End goal
Skill validation fails if the research pack drifts back to reliable-generic-auto wording or drops core artifacts.

### Acceptance criteria
- [ ] `./skills/opendevbrowser-research/scripts/validate-skill-assets.sh` passes.
- [ ] The validator fails if the preserved artifact list is removed.
- [ ] The validator fails if `auto` is described as the recommended default.
- [ ] The validator fails if the search-engine lane stops treating SERPs as discovery-only.
- [ ] Wrapper behavior remains unchanged.

---

## Task 5 - Demote generic research in best-practices validated lanes

### Reasoning
The best-practices skill currently presents generic topical research with `--source-selection auto` as part of reliable capability lanes.

### What to do
Rewrite best-practices research guidance as evidence-gated and skill-first.

### How
1. Rename "Current reliable lanes" wording where it includes generic research.
2. Replace "Generic topical research without shopping contamination" with an evidence-gated research primitive.
3. Add an instruction to load `opendevbrowser-research` before research tasks.
4. Replace `--source-selection auto` examples with explicit source-family examples such as `--sources web,community`.
5. Add a rule that successful workflow output still requires artifact inspection.
6. Update the `validated-capabilities` output in `skills/opendevbrowser-best-practices/scripts/odb-workflow.sh`.

### Files impacted
- `skills/opendevbrowser-best-practices/SKILL.md`
- `skills/opendevbrowser-best-practices/scripts/odb-workflow.sh`

### End goal
Best-practices no longer presents generic `auto` research as a validated reliable lane.

### Acceptance criteria
- [ ] Best-practices guidance tells users to load `opendevbrowser-research` for research.
- [ ] `validated-capabilities` output does not include `--source-selection auto` for generic research.
- [ ] Research is described as evidence-gated and provider-constrained.
- [ ] Shopping, inspiredesign, and unrelated workflow guidance remain unchanged except for wording consistency.

---

## Task 6 - Update first-contact help and onboarding wording

### Reasoning
First-contact help and onboarding metadata currently include `research_reliable` and examples that imply generic auto research is stable.

### What to do
Replace reliable research onboarding with evidence-gated research onboarding.

### How
1. In `src/cli/onboarding-metadata.json`, replace reliable research wording in `sectionSummary`.
2. Rename the displayed research label to an evidence-gated equivalent while preserving metadata keys unless a test requires a key rename.
3. Change research examples to avoid `--source-selection auto`.
4. Change `computerUseEntry` to use the canonical explicit source-family pattern, such as `--sources web`.
5. In `src/cli/help.ts`, replace `research_reliable` with `research_evidence_gated`.
6. Update help text to require skill loading and artifact inspection before final claims.
7. Update help tests that assert onboarding labels and command values.

### Files impacted
- `src/cli/onboarding-metadata.json`
- `src/cli/help.ts`
- `tests/cli-help.test.ts`
- `tests/cli-help-parity.test.ts`

### End goal
Generated help presents research as evidence-gated, not reliable generic auto research.

### Acceptance criteria
- [ ] `getHelpText()` contains `research_evidence_gated`.
- [ ] `getHelpText()` does not contain `research_reliable`.
- [ ] First-contact help does not claim generic `auto` research is safest.
- [ ] Computer-use wording remains browser-scoped and does not imply a desktop agent.

---

## Task 7 - Update public-surface source and regenerate snapshots

### Reasoning
Public examples and notes are source-owned in `src/public-surface/source.ts`, while generated manifest snapshots are checked in and tested.

### What to do
Demote public research wording in the public-surface source and regenerate snapshots.

### How
1. Update the research CLI example to avoid `--source-selection auto`.
2. Replace the note that says generic topical research is safest with `auto`.
3. Keep command usage, flags, and schemas unchanged.
4. Do not add flags, selectors, engines, providers, or schema variants.
5. Run the public-surface manifest generator.
6. Include generated TypeScript and JSON snapshots with the source change.

### Files impacted
- `src/public-surface/source.ts`
- `src/public-surface/generated-manifest.ts`
- `src/public-surface/generated-manifest.json`
- `tests/public-surface-manifest.test.ts`

### End goal
Public-surface snapshots match the new evidence-gated public wording.

### Acceptance criteria
- [ ] `node scripts/generate-public-surface-manifest.mjs` updates generated snapshots.
- [ ] `tests/public-surface-manifest.test.ts` passes.
- [ ] Research command flags remain source-family based.
- [ ] Generated manifests are not edited by hand.

---

## Task 8 - Update research success handoff guidance

### Reasoning
Research success handoff currently recommends rerunning with `--source-selection auto --sources web,community`, which sends mixed guidance.

### What to do
Make handoff guidance explicit-source and evidence-review first.

### How
1. Change `buildResearchRerunCommand()` to remove `--source-selection auto`.
2. Keep explicit sources, such as `--sources web,community`.
3. Update success handoff text to tell users to inspect ranked records and artifact metadata.
4. Preserve browser mode passthrough behavior.
5. Update handoff tests to assert the new command and artifact-review wording.

### Files impacted
- `src/providers/workflow-handoff.ts`
- `tests/workflow-handoff.test.ts`

### End goal
Successful research output points users toward explicit source review rather than generic auto reruns.

### Acceptance criteria
- [ ] Handoff command does not contain `--source-selection auto`.
- [ ] Handoff command keeps explicit sources.
- [ ] Browser mode preservation tests still pass.
- [ ] Handoff text points users at artifact inspection.

---

## Task 9 - Synchronize public docs

### Reasoning
Docs repeat the reliable lane and auto guidance. They must match source-owned public surfaces and the skill-first model.

### What to do
Update public docs to demote generic research while preserving workflow inventory and artifact accuracy.

### How
1. Update `docs/CLI.md` overview and generated-help sections to remove reliable research wording.
2. Update `docs/CLI.md` research section to describe `research run` as best-effort and evidence-gated.
3. Preserve artifact file lists and no-evidence gate wording in `docs/CLI.md`.
4. Update `docs/FIRST_RUN_ONBOARDING.md` to rename reliable workflow lane wording.
5. Remove `--source-selection auto` as the research proof command.
6. Update `docs/SURFACE_REFERENCE.md` only where research wording appears outside inventory tables.
7. Update `docs/WORKFLOW_SURFACE_MAP.md` only where scenario wording calls research reliable instead of evidence-gated.
8. Search `docs/README.md` and root `README.md` for matching public wording and update only if present.
9. Record mirrored website sync as required after docs, skills, onboarding metadata, or generated public-surface snapshots change.

### Files impacted
- `docs/CLI.md`
- `docs/FIRST_RUN_ONBOARDING.md`
- `docs/SURFACE_REFERENCE.md`
- `docs/WORKFLOW_SURFACE_MAP.md`
- `docs/README.md` if matching wording exists
- `README.md` if matching wording exists

### End goal
Public docs match the skill-first, evidence-gated posture without hiding that research remains a public workflow and tool surface.

### Acceptance criteria
- [ ] Docs do not call generic `auto` research reliable or safest.
- [ ] Docs still list research as a public workflow and tool surface.
- [ ] Docs preserve artifact and no-evidence gate wording.
- [ ] Docs mention the research skill as the recommended entrypoint.

---

## Runtime Guardrails

### Reasoning
The investigations found that artifact generation and no-evidence gates are correct. The implementation should not weaken them while changing public posture.

Guarded files with no intended edits:
- `src/providers/research-compiler.ts`
- `src/providers/research-executor.ts`
- `src/cli/commands/research.ts`
- `src/tools/research_run.ts`
- `src/providers/renderer.ts`
- `src/providers/artifacts.ts`
- `src/providers/workflows.ts`

Guardrail acceptance criteria:
- [ ] No source-family schema expansion is introduced.
- [ ] No runtime CLI or tool search-engine selector is introduced.
- [ ] No hidden API key path is introduced.
- [ ] No feature flag is introduced.
- [ ] No anti-bot bypass is introduced.
- [ ] No successful artifact emission is added for zero-evidence research.

---

## File-by-file implementation sequence

1. Skill assets: complete Tasks 1 through 3 in `skills/opendevbrowser-research/**`.
2. Research skill validation: complete Task 4 after the skill wording, templates, and search-engine lane are final.
3. Best-practices public guidance: complete Task 5 in `skills/opendevbrowser-best-practices/**`.
4. First-contact public surfaces: complete Tasks 6 and 7 in `src/cli/**`, `src/public-surface/**`, and their tests.
5. Handoff and targeted tests: complete Task 8 in `src/providers/workflow-handoff.ts` and `tests/workflow-handoff.test.ts`.
6. Docs and sync notes: complete Task 9 after source-owned wording is final.

---

## Dependencies To Add

| Package | Version | Purpose |
|---------|---------|---------|
| None | N/A | This implementation should use existing docs, scripts, tests, and runtime primitives. |

---

## Task Dependencies

- Task 2 depends on Task 1 because templates should use the final skill vocabulary.
- Task 3 depends on Tasks 1 and 2 because the search-engine lane must use the final evidence vocabulary and template fields.
- Task 4 depends on Tasks 1 through 3 because validator markers must match the final skill text, templates, and search-engine lane.
- Task 6 depends on the `research_evidence_gated` label decision in this plan.
- Task 7 depends on the public wording decisions from Tasks 5 and 6.
- Task 8 can run after the canonical `--sources web,community` example decision is applied in Tasks 5 through 7.
- Task 9 should run after Tasks 5 through 8 so docs mirror the final source-owned wording.
- Runtime Guardrails apply throughout all tasks.

---

## Validation

Run targeted validation:

```bash
node scripts/generate-public-surface-manifest.mjs
node scripts/docs-drift-check.mjs
./skills/opendevbrowser-research/scripts/validate-skill-assets.sh
./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh
npm run test -- tests/cli-help.test.ts tests/cli-help-parity.test.ts tests/public-surface-manifest.test.ts tests/workflow-handoff.test.ts tests/skill-workflow-packs.test.ts
```

Run full quality gates:

```bash
npm run lint
npm run typecheck
npm run build
npm run test
```

Manual validation checklist:
- [ ] Search changed files for `research_reliable`; no public label remains.
- [ ] Search changed public wording for claims that generic topical research is safest with `--source-selection auto`; no public claim remains.
- [ ] Confirm `auto` remains documented only as a source-family selector, not as a reliability recommendation.
- [ ] Confirm the search-engine lane lives only in the skill and templates, not in runtime CLI/tool schemas.
- [ ] Confirm SERP candidates remain discovery-only and final claims require destination-page evidence.
- [ ] Confirm artifact primitives remain listed exactly.
- [ ] Confirm no-evidence gates remain documented.
- [ ] Confirm generated public-surface snapshots were produced by the generator.
- [ ] Confirm mirrored website sync is completed if the mirrored site workspace is available. If it is not available, document the required sync evidence in the PR notes rather than blocking local validation.

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 0.1 | 2026-05-09 | Initial scaffold captured goal, background, open question, and references. |
| 1.0 | 2026-05-09 | Expanded into executable implementation plan with key decisions, ordered tasks, dependencies, validation, and guardrails. |
| 1.1 | 2026-05-09 | Folded bounded design critique into label ownership, canonical source examples, validator markers, runtime guardrails, and sync handling. |
| 1.2 | 2026-05-09 | Added the search-engine discovery lane as an optional skill-guided protocol for richer research output without runtime schema changes. |
