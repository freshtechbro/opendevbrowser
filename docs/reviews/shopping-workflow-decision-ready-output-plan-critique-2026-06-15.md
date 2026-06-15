# Shopping Workflow Decision-Ready Output Plan Critique

## 1. Top 3 under-specified seams

1. **Renderer mode compatibility.** The plan says to make `deals.md` the buying brief while preserving `compact`, `json`, `context`, and `path` response semantics (`docs/plans/shopping-workflow-decision-ready-output-2026-06-15.md:116`, `:255-263`). Current `renderShopping()` builds `markdown`, `context.highlights`, and `compact.summary` from the same compact `lines` source (`src/providers/renderer.ts:797-815`, `:825-872`). The plan should specify whether `compact` remains a ranked-list summary, becomes a report recommendation summary, or derives from the new briefing.
2. **Report input and meta contract.** Task 3 asks the report to read diagnostics, alerts, filter counts, selected providers, requested region, and region authority from `meta` (`docs/plans/shopping-workflow-decision-ready-output-2026-06-15.md:141-144`), but `runShoppingWorkflow()` assembles this as an untyped `Record<string, unknown>` (`src/providers/workflows.ts:5775-5817`). The gate needs a declared minimal input schema and missing-field behavior before implementation.
3. **Evidence provenance for freshness and market savings.** Task 7 requires missing or inferred freshness detection (`docs/plans/shopping-workflow-decision-ready-output-2026-06-15.md:213-225`), but `extractShoppingOffer()` replaces missing `retrieved_at` with `now.toISOString()` (`src/providers/shopping-postprocess.ts:377-379`). Task 8 asks for anchor/list price savings (`docs/plans/shopping-workflow-decision-ready-output-2026-06-15.md:234-235`), but `ShoppingOffer` has no first-class anchor price (`src/providers/renderer.ts:111-132`). The plan should require the adapter to read original nested attributes or preserve provenance before applying freshness and savings rules.

## 2. Specificity balance

- Over-specified: Task 2 mandates exact files `rules.ts`, `gate.ts`, `synthesis.ts`, and `render.ts` (`docs/plans/...:123-127`). The implementation agent should own that split once complexity is visible. Keep the pure compiler boundary and exported functions as the requirement.
- Over-specified: Task 6 prescribes a token-based relevance algorithm and one exact ergonomic-mouse fixture (`docs/plans/...:195`, `:204`). Better to specify deterministic relevance outcomes and false-positive classes, not the algorithm.
- Dropped framing: the export warned to use `src/providers/research-report/*` as an architecture precedent, not as the shopping implementation (`prompt-exports/oracle-plan-2026-06-15-122318-shopping-plan-e1bbd6-e0b7.md:22-23`). The final plan leans toward copying the package shape.

## 3. Contradictions or missing dependencies

- Task 11 quality regressions depend on Task 9 (`docs/plans/...:293-294`), but many should be failing tests before Tasks 5 through 8, not after the renderer is wired.
- Task 15 says to check daemon status (`docs/plans/...:365`) but does not require the project preflight condition `data.fingerprintCurrent === true` from AGENTS.md. That changes live-validation order.
- "None blocking" open questions (`docs/plans/...:409-410`) conflicts with unresolved renderer mode and `deals-context.json` shape decisions.

## 4. Risk of over-planning

- Background lines 24-49 are useful evidence, but too much belongs in the investigation. Keep only the runtime path, renderer seam, postprocess caveats, and research prior-art pointers.
- Tasks 4 through 8 overlap heavily. They could be one "rules, gate, and synthesis" lane with subtests.
- Task 15 duplicates the global acceptance criteria. Keep the command plus three live acceptance checks.

## 5. Questions whose answers would change implementation order

1. Must `compact.summary` preserve the legacy ranked list, or may it summarize the buying brief?
2. Should `deals-context.json` stay raw-only, or include deterministic report summary fields?
3. Is market baseline required in the first implementation pass, or is "baseline unavailable" acceptable until evidence criteria are fully typed?
4. Is there any known downstream consumer that requires legacy `deals.md` body text rather than only the file name?
