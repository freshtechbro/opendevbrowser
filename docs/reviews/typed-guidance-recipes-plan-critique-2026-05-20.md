# Typed Guidance Recipes Plan Critique

## 1. Top 3 under-specified seams

1. **GuidanceContext source of truth and insertion point.** The plan says to normalize evidence in Task 3 and build Inspired Design guidance after discovery, capture, and ranking in Task 5, but it does not specify whether readiness is derived from `workflowInput`, `discovery`, `visualCollation.references`, `packet.rankedReferences`, `meta.primaryConstraint`, or a new aggregate object. The current flow discovers refs, fetches, captures, builds the packet, builds meta, then renders artifacts in one path (`src/providers/workflows.ts:3971-4060`). This matters because the hard-coded Canvas handoff lives in `src/inspiredesign/handoff.ts:58-75`, while CLI text independently reads legacy fields in `src/cli/utils/workflow-message.ts:117-176`. The plan needs one exact data boundary and compatibility owner.

2. **Browser-native recipe execution boundary.** Task 4 says Pinterest recipes are guidance-only in the first slice and must not register Pinterest as a social provider (`docs/plans/typed-guidance-recipes-inspiredesign-pinterest-2026-05-20.md:250-266`). But Task 10 expects live Pinterest URL harvests to become ready when capture succeeds (`docs/plans/typed-guidance-recipes-inspiredesign-pinterest-2026-05-20.md:506-510`). Current discovery only calls `runtime.search` with provider IDs (`src/providers/workflows.ts:1878-1905`), and the social provider registry has no Pinterest platform (`src/providers/social/index.ts:28-58`). The plan should state whether `--provider social/pinterest` remains a blocked guidance case or whether a new browser-native discovery runner is part of scope.

3. **Canvas repair guidance before a session exists.** Task 7 asks for schema-derived examples for missing `canvasSessionId`, `leaseId`, `documentId`, and invalid `generationPlan` (`docs/plans/typed-guidance-recipes-inspiredesign-pinterest-2026-05-20.md:355-377`). Current missing-session errors are thrown before a `CanvasSession` exists (`src/browser/canvas-manager.ts:2619-2625`) via generic `requireString` (`src/browser/canvas-manager.ts:4198-4201`). Existing Canvas guidance only returns `{ recommendedNextCommands, reason }` (`src/canvas/guidance.ts:1-4`) and invalid plans attach issue details later (`src/browser/canvas-manager.ts:545-556`, `src/browser/canvas-manager.ts:2670-2685`). The plan should define the error-envelope layer that converts pre-session throws into typed repair examples.

## 2. Specificity balance comparing plan vs export

- The plan is more implementation-ready than the Oracle export: it replaces the export's broad path guesses like `src/workflows/providers/*`, `src/workflows/inspired-design/*`, and `src/daemon/*` (`prompt-exports/oracle-plan-2026-05-20-080724-new-chat-c30750-95cc.md:321-383`) with repo-accurate files such as `src/providers/workflows.ts`, `src/inspiredesign/handoff.ts`, `src/canvas/guidance.ts`, and generated public-surface files (`docs/plans/typed-guidance-recipes-inspiredesign-pinterest-2026-05-20.md:20-33`, `272-486`).
- The export is stronger on unresolved product questions. It explicitly keeps weak-reference thresholds, Pinterest auth preference, public versus authenticated recipe variants, Canvas example generation strategy, and tracked skill directories open (`prompt-exports/oracle-plan-2026-05-20-080724-new-chat-c30750-95cc.md:627-633`). The plan compresses these into “None blocking” plus a threshold note (`docs/plans/typed-guidance-recipes-inspiredesign-pinterest-2026-05-20.md:593-595`), which is too confident.
- Net: keep the plan's repo-specific seams and validation list, but reintroduce the export's decision questions before implementation starts.

## 3. Contradictions or missing dependencies

- **Task order conflict:** Task 5 must classify weak web/default harvests as non-ready (`docs/plans/typed-guidance-recipes-inspiredesign-pinterest-2026-05-20.md:302-306`), but Task 6 later adds the final rank-quality signals and feeds them into `GuidanceContext` (`docs/plans/typed-guidance-recipes-inspiredesign-pinterest-2026-05-20.md:313-333`). Either move the minimal quality signal work before Task 5 or split Task 6 into a pre-gate slice and a hardening slice.
- **Compatibility cleanup conflict:** Task 10 searches for `recommendedNextCommands` and `suggestedNextAction` as stale guidance strings (`docs/plans/typed-guidance-recipes-inspiredesign-pinterest-2026-05-20.md:521-525`), but rollout explicitly preserves those compatibility fields (`docs/plans/typed-guidance-recipes-inspiredesign-pinterest-2026-05-20.md:579-580`). Search for hard-coded prose instead, not compatibility field names.
- **Docs and skills generation dependency:** The plan says docs and skills should draw from the recipe source (`docs/plans/typed-guidance-recipes-inspiredesign-pinterest-2026-05-20.md:438-462`, `579-584`) but does not define an extraction API, codegen script, or validation fixture for generated snippets.

## 4. Risk of over-planning or sections to cut

- Cut or defer most of Task 8. Migrating research, shopping, product-video, macro, daemon, provider constraints, and CLI messaging together is too large for the first proof (`docs/plans/typed-guidance-recipes-inspiredesign-pinterest-2026-05-20.md:399-432`). Keep one non-Inspired Design representative path as the cross-workflow proof.
- Defer recipe-driven docs or skill snippet generation unless an existing generation path can be reused. Manual docs and skill updates plus drift tests are enough for the first slice.
- Narrow Task 10 cleanup to source-owned duplicate prose. Removing or redirecting every match for compatibility fields risks breaking current consumers.
- Keep live workflow verification, but do not use live Pinterest success as a required gate for unit-level architecture. Treat it as proof evidence after deterministic fixtures pass.

## 5. Questions whose answers would change implementation order

1. Should Pinterest recipes only render repair guidance, or should they power a new browser-native discovery runner for `--provider social/pinterest`?
2. What exact threshold separates `ready`, `needs_recovery`, and `diagnostic_only` for ranked references?
3. Are Canvas repair examples generated from runtime schema metadata, or checked-in examples validated by tests?
4. Which compatibility fields are externally supported and must remain stable in the first release?
5. Is the first deliverable Inspired Design plus Canvas only, or must research, shopping, product-video, macro, daemon, CLI, docs, and skills all migrate in one implementation wave?
