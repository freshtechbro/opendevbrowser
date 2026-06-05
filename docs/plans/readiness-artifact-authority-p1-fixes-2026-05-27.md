# Readiness Artifact Authority P1 Fixes - 2026-05-27

## Task 1 - Prove renderer visual authority from artifacts
Reasoning: Canvas continuation must not fail valid non-Pinterest references that are artifact-backed but still carry generic fetch or ranked-reference markers.
What to do: add a renderer regression before changing implementation.
How:
1. Build a non-Pinterest ranked reference with `capturedVia: ["fetch"]` and `evidenceAuthority: "ranked_reference"`.
2. Provide matching screenshot or motion authority artifacts.
3. Assert renderer output stays product-ready and does not emit the missing visual blocker.
Files impacted: `tests/providers-inspiredesign-contract.test.ts`.
End goal: renderer gate behavior is locked to artifact-backed authority.
Acceptance criteria:
- [ ] Focused renderer regression fails before implementation.
- [ ] Regression passes after implementation.

## Task 2 - Recompute missing visual count from authority helpers
Reasoning: Marker-only evidence should never satisfy or block product readiness by itself.
What to do: update `missingRequiredVisualReferenceCount()` to use artifact-backed authority checks.
How:
1. Reuse existing authoritative ranked-reference helpers and authority indexes.
2. Count references missing screenshot, motion, or pin-media artifact authority.
3. Preserve Pinterest strict pin-media requirements and existing diagnostic behavior.
Files impacted: `src/providers/renderer.ts`.
End goal: missing visual blocker reflects real artifact-backed authority.
Acceptance criteria:
- [ ] No marker-only evidence path remains in missing visual count logic.
- [ ] Existing renderer contract tests pass.

## Task 3 - Require all explicit readiness counters
Reasoning: explicit product-ready metadata with only the old four counters must not bypass the new pin-media count contract.
What to do: add a product-readiness regression and tighten explicit count parsing.
How:
1. Add a test where explicit product-ready readiness omits `pinMediaReadyReferenceCount`.
2. Update count parsing so all five counters are required for explicit readiness validation.
3. Ensure incomplete explicit metadata demotes to diagnostic-only or is treated as invalid.
Files impacted: `src/inspiredesign/product-readiness.ts`, `tests/inspiredesign-product-readiness.test.ts`.
End goal: product readiness cannot be product-ready with incomplete explicit counters.
Acceptance criteria:
- [ ] Focused product-readiness regression fails before implementation.
- [ ] Regression passes after implementation.

## Task 4 - Verify focused gates
Reasoning: the fix touches runtime gates and shared readiness logic, so focused tests plus type and lint checks must run cleanly.
What to do: run requested verification exactly.
How:
1. Run `npm run test -- tests/providers-inspiredesign-contract.test.ts tests/inspiredesign-product-readiness.test.ts`.
2. Run `npm run typecheck`.
3. Run `npm run lint -- src/providers/renderer.ts src/inspiredesign/product-readiness.ts tests/providers-inspiredesign-contract.test.ts tests/inspiredesign-product-readiness.test.ts`.
Files impacted: none unless checks reveal defects.
End goal: focused checks pass with zero errors and zero warnings.
Acceptance criteria:
- [ ] Requested test command passes.
- [ ] Typecheck passes.
- [ ] Scoped lint passes.
