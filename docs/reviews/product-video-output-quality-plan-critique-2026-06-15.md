# Product-Video Output Quality Plan Critique

## Context/Scope
Reviewed `docs/plans/product-video-output-quality-fix-2026-06-15.md` against the original local planning export. Spot-checked only the artifact assembly, handoff, and helper seams.

## Findings

### Top 3 under-specified seams
1. **Readiness schema contract.** The plan lists additive fields and statuses but not the exact object shape, required keys, stable reason-code namespace, or criteria rows (`docs/plans/product-video-output-quality-fix-2026-06-15.md:30-47`). The local export kept this more concrete with `warnings`, `reasonCodes`, and `criteria` rows. Without this, `product.json`, `manifest.json`, `meta`, and `presentation-readiness.json` can drift when wired at `src/providers/workflows.ts:6621-6663`.
2. **Record selection and evidence identity.** Task 4 is conditional and vague about scoring, tie-breaking, and what `raw/source-record.json` should represent (`docs/plans/product-video-output-quality-fix-2026-06-15.md:169-183`). Source currently selects `details.records[0]` at `src/providers/workflows.ts:6554` and writes that primary record as raw evidence at `src/providers/workflows.ts:6659-6663`. The plan should specify whether the selected presentation record, original primary, or all candidate records become the audit source.
3. **Handoff/helper failure behavior.** Task 5 says to make guidance readiness-aware but does not define behavior for `fail` or `partial` outputs (`docs/plans/product-video-output-quality-fix-2026-06-15.md:185-201`). Current handoff always tells users to run the helper (`src/providers/workflow-handoff.ts:397-411`), and the helper labels generated claims as `Verified Features` and `Copy Input` (`skills/opendevbrowser-product-presentation-asset/scripts/render-video-brief.sh:54-65`). The plan should state whether the helper exits nonzero, emits a gated brief, or writes warning sections.

### Specificity balance
- Over-specified: Task 2 names exact internal files and functions (`docs/plans/product-video-output-quality-fix-2026-06-15.md:136-140`). Keep the public builder, purity constraints, and output contract, but let the implementation agent decide internal file split.
- Dropped useful framing: the final plan lost the local export's concrete readiness object shape, concrete live validation command, and source-field/source-record expectations for candidate rows.

### Contradictions or missing dependencies
- `include_copy=false` allows `copy.md` to be empty or readiness-note-only (`docs/plans/product-video-output-quality-fix-2026-06-15.md:42-47`), but the live checklist requires presentation copy or an explicit gate note (`docs/plans/product-video-output-quality-fix-2026-06-15.md:299-301`). Pick one.
- Task 5 depends only on Task 3, but if Task 4 changes record selection or evidence precedence, docs/helper wording should wait on that final runtime contract.
- Task 3 lists only `src/providers/workflows.ts` as impacted (`docs/plans/product-video-output-quality-fix-2026-06-15.md:150-160`), but typed readiness may also touch provider/tool response types or docs-facing output tests.

### Risk of over-planning
- External research (`docs/plans/product-video-output-quality-fix-2026-06-15.md:79-85`) can be reduced to one rationale sentence because the plan rejects LLM generation and external eval services.
- Tasks 8-10 are mostly project workflow boilerplate (`docs/plans/product-video-output-quality-fix-2026-06-15.md:246-297`). Keep them as acceptance checklists, not implementation tasks.
- Task 6, Task 7, and the live checklist repeat validation content (`docs/plans/product-video-output-quality-fix-2026-06-15.md:203-244`, `299-309`). Collapse into focused gates, full gates, and live acceptance.

### Questions that would change implementation order
1. Should the exact readiness JSON schema and reason-code union be locked in tests before any compiler work?
2. Should record selection move before workflow integration, or remain a compiler input concern?
3. On readiness `fail`, should the helper stop, or generate a warning-only brief?
