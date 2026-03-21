# Design Release Gate

Use this before calling a design task shipped.

## Blocking Checks

- The design contract is complete and still matches the implemented screen.
- A reference pattern board exists when external inspiration shaped the work.
- Default, empty, loading, success, and error states were checked when relevant.
- Responsive behavior was validated intentionally.
- Accessibility posture was reviewed against the contract.
- Real-browser evidence exists for the primary surface.
- Cross-surface parity was checked when the acceptance criteria require it.
- `/canvas` work obeyed the session handshake and saved only after required governance blocks were satisfied.
- Docs, AGENTS guidance, and skill references were updated in the same pass when the design surface changed.

## Required Artifacts

Record the gate in `assets/templates/design-release-gate.v1.json` and keep it aligned with:

- `assets/templates/design-review-checklist.json`
- `assets/templates/real-surface-design-matrix.json`
- `assets/templates/reference-pattern-board.v1.json` when research harvest was used

## Minimum Shipping Loop

1. Re-read the design contract.
2. Compare the shipped UI against the contract and the pattern board.
3. Run the real-surface matrix on the required modes.
4. Record evidence and blockers in the release-gate JSON.
5. Fix gaps.
6. Repeat until every required check is `pass` or explicitly `not_applicable` with evidence.

## Do Not Ship If

- the direction drifted away from the contract
- the visual language mixes unrelated patterns
- feedback/loading states still cause layout reflow or state confusion
- the design relies on unsupported libraries or hidden runtime assumptions
- the final answer claims parity or design quality that the browser evidence does not prove
