# Skill-First Research Model Plan Critique

## Context/Scope
Reviewed `docs/plans/skill-first-research-model-2026-05-09.md` and spot-checked only the named seams in current source/tests. This critique intentionally favors deletion or clarification over adding detail.

## 1. Top 3 under-specified seams

1. **Public label vs metadata key ownership.** The plan says to replace `research_reliable` with `research_evidence_gated` and to "rename the research quick-start key or display label" (`docs/plans/skill-first-research-model-2026-05-09.md:21`, `:168-174`). Current ownership is split: `src/cli/help.ts:298-300` owns the displayed label/details, while `src/cli/onboarding-metadata.json:19-21` owns command strings. Clarify whether this is label-only or a metadata/API key rename. Prefer label-only unless tests prove a public key needs to change.

2. **`--source-selection` vs `--sources` semantics.** The plan preserves `auto|web|community|social|shopping|all` (`docs/plans/skill-first-research-model-2026-05-09.md:16`) but examples alternate between `--sources web,community` and `--source-selection web` (`:22`, `:140`, `:171`, `:235-236`). Current CLI accepts both as separate fields (`src/cli/commands/research.ts:16-17`, `:114-138`), and handoff currently emits both (`src/providers/workflow-handoff.ts:42`). Decide the canonical public example before editing help/docs/tests.

3. **Validator negative checks are underspecified.** Task 3 asks marker checks and a failure when `auto` is described as the recommended default (`docs/plans/skill-first-research-model-2026-05-09.md:104-106`, `:121-124`). The current validator is simple substring/marker based (`skills/opendevbrowser-research/scripts/validate-skill-assets.sh:18-31`, `:67-75`). Define the exact forbidden strings and exact required phrase, or this becomes brittle wording policing.

## 2. Contradictions or missing dependencies

- Task 7 is said to run after Task 5 (`docs/plans/skill-first-research-model-2026-05-09.md:382`), but it mainly depends on the source flag decision, not help-label work. If the flag decision is made in Tasks 1 or 4, handoff can move earlier.
- Mirrored website sync is mentioned late (`docs/plans/skill-first-research-model-2026-05-09.md:273`, `:416`), while `docs/AGENTS.md:75-82` requires private sync and validation when docs, skills, help, onboarding metadata, or generated public-surface files change. Either make this a follow-up note or name the evidence artifact. Do not leave it as a vague acceptance item.
- No package dependency appears missing for validation: `npm run typecheck` exists in `package.json:40`.

## 3. Risk of over-planning

- Cut or shrink Task 2 (`docs/plans/skill-first-research-model-2026-05-09.md:69-76`). It risks turning a wording demotion into a full research methodology redesign. Keep only fields needed to expose evidence gaps, source ledger, and limitations.
- Move Task 9 (`docs/plans/skill-first-research-model-2026-05-09.md:294-331`) into guardrails or validation. It has no intended edits and inflates the implementation plan.
- Replace the 27-step file sequence (`docs/plans/skill-first-research-model-2026-05-09.md:336-364`) with four phases: skill assets, public surfaces, handoff/tests, docs/sync. The current list duplicates task bodies.
- Keep README checks in Task 8 as grep-only unless matching wording exists (`docs/plans/skill-first-research-model-2026-05-09.md:272`). Avoid broad docs churn.

## 4. Questions that would change implementation order

1. Is `research_evidence_gated` a durable public lookup label or just display copy?
2. Which public flag pattern is canonical: `--source-selection web`, `--sources web,community`, or both together?
3. Is private website sync in scope for this branch, or should it be documented as a follow-up?
4. Are skill templates only examples, or are they emitted into runtime artifacts? If emitted, Task 2 must precede validator/test updates.
