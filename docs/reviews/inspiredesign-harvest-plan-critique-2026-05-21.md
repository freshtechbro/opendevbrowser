# Inspiredesign Harvest Plan Critique

## Context / Scope

Reviewed only `docs/plans/inspiredesign-harvest-recovery-and-browser-output-artifacts-2026-05-21.md` (`Plan`) and `prompt-exports/oracle-plan-2026-05-21-073822-harvest-plan-8ff2c1-a09b.md` (`Export`). Source was not edited.

## Findings

1. **Screencast artifact namespace is still a decision seam.** The plan chooses `.opendevbrowser/screencast/<uuid>` in recommended decisions and acceptance criteria (`Plan:30-31`, `Plan:152-156`, `Plan:398-400`, `Plan:507-528`). The export explicitly flags the label as ambiguous, then its generated plan chooses `browser-replay` (`Export:71-74`, `Export:236-251`, `Export:285-310`). Implementation should not start until this label is finalized, because it changes helper constants, tests, docs, real-world validation, and migration notes.

2. **Browser screenshot response shape is under-specified across surfaces.** Task 2 says to return `path` and `artifact_path` and update typing “where declared” (`Plan:105-118`, `Plan:122-127`), while the export names tool, CLI, daemon, and manager surfaces as part of the contract (`Export:31-36`, `Export:56`, `Export:263-281`). The plan should state whether omitted screenshots stop returning base64, keep base64 additively, or expose both only on some surfaces. That answer changes tests and docs before manager edits.

3. **Captured-but-rejected diagnostics need a concrete serialization target.** Task 9 names a possible field and says “ranked-references.json or equivalent” (`Plan:302-327`), but the export frames the relevant seam as `reference-pattern-board.ts`, `contract.ts`, and guidance readiness serialization (`Export:13`, `Export:28-29`, `Export:113-115`). The plan should pick the exact artifact or payload field before implementation, otherwise tests may encode the wrong public contract.

## Specificity Balance Compared With Export

The plan is stronger than the export on executable task formatting, targeted test inventory, and full gates. It is weaker on unresolved design choices the export marked as ambiguities, especially the screencast namespace and cross-surface browser output contract. It also says to regenerate the public surface “using the repo’s existing generation command or script if present” (`Plan:374-376`) without naming the command, while the export required exact generated-surface handling (`Export:65-67`).

## Contradictions / Missing Dependencies

- Namespace contradiction: `screencast` in the plan vs `browser-replay` in the export’s generated plan.
- The plan requires unavailable or external sub-skills by name (`Plan:3`), which may block agentic execution unless replaced with repo-available guidance.
- Public-surface regeneration is a missing dependency. The plan should first locate or define the manifest generation command before Task 11.

## Over-planning Risk

The plan combines two mostly independent lanes: `inspiredesign harvest` recovery and browser output artifacts. That may be too broad for one implementation pass. A safer order is two atomic workstreams with separate test gates: first provider URL validation plus guidance readiness, then browser artifact roots plus public-surface docs.

## Questions That Could Change Implementation Order

1. Should omitted screencasts use `screencast` or `browser-replay` as the final namespace?
2. Should omitted screenshots preserve base64 in any API/tool response, or fully switch to persisted file output?
3. What is the canonical command for regenerating `src/public-surface/generated-manifest.json`?
4. Is readiness only CLI message text, or an additive structured field in the public response?
5. Which exact artifact owns captured-but-rejected diagnostics: `ranked-references.json`, `nextStepGuidance`, or a separate rejected-reference payload?
