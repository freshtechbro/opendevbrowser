# Inspiredesign Pinterest Capture Fix Plan

## Version History
- 2026-07-02: Initial plan after real workflow reproduction and RepoPrompt investigation.
- 2026-07-02: Updated after focused tests, skill sync validation, real workflow proof, and installed daemon restoration.

## Task 1 - Relax Pin Navigation Setup Without Weakening Authority
Reasoning: The real failure occurs before candidate extraction because primary pin-media setup waits for Pinterest full page `load` inside a small setup budget.
What to do: Navigate canonical Pinterest pin-media capture sessions to `domcontentloaded`, then keep the bounded network-idle wait advisory and non-authoritative.
How:
1. Add a named wait-state constant in `src/inspiredesign/capture.ts`.
2. Use it only for Pinterest pin media warmup and primary pin-media setup.
3. Preserve existing strict pin-media validation, page quality, and first-party byte gates.
Files impacted: `src/inspiredesign/capture.ts`.
Acceptance criteria:
- [x] A test fails before the change because pin-media setup uses `load`.
- [x] The same test passes after setup uses `domcontentloaded`.
- [x] Existing visual/deep capture behavior is unchanged.

## Task 2 - Add Focused Regression Coverage
Reasoning: The fix must target the observed setup seam and avoid weakening diagnostic-only cases.
What to do: Add or update focused tests around canonical Pinterest pin-media capture setup.
How:
1. Assert extension warmup and primary pin-media capture navigate with `domcontentloaded`.
2. Add a case where `load` would hang but `domcontentloaded` allows pin-media capture to proceed.
3. Keep existing positive and diagnostic-only pin-media assertions intact.
Files impacted: `tests/providers-inspiredesign-capture.test.ts`.
Acceptance criteria:
- [x] Focused capture test command passes.
- [x] Tests preserve strict diagnostic behavior for failed or non-authoritative pin media.

## Task 3 - Align Guidance And Installed Skill Pack
Reasoning: Repo guidance is current, but the installed user skill copy is stale and can cause agents to miss Pinterest-specific recovery and authority checks.
What to do: Add one missing daemon preflight reminder to the surface reference and sync the current repo skill pack into the user skill location with a backup.
How:
1. Update `docs/SURFACE_REFERENCE.md` Inspiredesign harvest notes to mention daemon fingerprint preflight before daemon-backed harvests.
2. Back up `/Users/bishopdotun/.agents/skills/opendevbrowser-best-practices`.
3. Sync `skills/opendevbrowser-best-practices/` to `/Users/bishopdotun/.agents/skills/opendevbrowser-best-practices/`.
4. Validate both repo and installed skill assets.
Files impacted: `docs/SURFACE_REFERENCE.md`, `/Users/bishopdotun/.agents/skills/opendevbrowser-best-practices/**` (machine-local), `.tmp/ulw-evidence/**` (backup/evidence).
Acceptance criteria:
- [x] Installed skill reports version `2.6.0`.
- [x] Installed and repo skill asset validators pass.
- [x] Guidance evidence captures daemon preflight, explicit URL recovery, product authority, and pin-media-index checks.

## Task 4 - Verify Real Workflow
Reasoning: Tests are supporting evidence only; the user asked for the real Inspiredesign workflow.
What to do: Build if needed and rerun the explicit Pinterest harvest command against the current daemon.
How:
1. Run focused tests, lint/typecheck for touched files, and build if source changes require dist.
2. Run `npx opendevbrowser status --daemon --output-format json`.
3. Rerun the explicit Pinterest harvest with the same two pins and captured evidence paths.
4. Inspect `pin-media-index.json`, `pin-media-evidence.json`, `ranked-references.json`, and top-level readiness fields.
Files impacted: `.tmp/ulw-evidence/**` generated evidence only.
Acceptance criteria:
- [x] Verification captures real workflow output and parsed authority fields.
- [x] The final run is product-ready; one explicit pin still rejected diagnostically, while the second pin produced manifest-backed first-party pin-media authority.
