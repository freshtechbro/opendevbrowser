# Canvas, Annotation, and Inspired Design Plan Review

## Context and scope

Reviewed plan: `docs/plans/canvas-annotation-inspiredesign-optimization-2026-06-29.md`.

Compared against:
- `.omo/ulw-research/20260629-154309-canvas-annotation-audit/SYNTHESIS.md`
- `.omo/ulw-research/20260629-154309-canvas-annotation-audit/REPORT.md`
- `docs/analysis/canvas-annotation-inspiredesign-architecture-synthesis-2026-06-29.md`

Scope was plan quality only. No source files were reviewed or edited.

## Verdict

BLOCKED. The plan is close, but two report requirements are not planned with enough specificity to satisfy the requested verification bar.

## Blockers

### 1. Selector bundle coverage is incomplete

The audit requires selector bundles with backend node id, frame id, test id, ARIA, CSS, shadow-chain, XPath, and text fallbacks. See `REPORT.md:30`.

The plan currently says to add ordered locator bundle output with confidence, scope, frame facts when available, and recovery hints. See `docs/plans/canvas-annotation-inspiredesign-optimization-2026-06-29.md:108-112`. That does not explicitly cover backend node id, test id, ARIA, CSS, shadow-chain, XPath, or text fallback locators.

Why this blocks approval: the user asked to verify every report finding is planned. This specific locator inventory is a report finding, and a generic locator bundle can be implemented without satisfying it.

Required fix: update Task 2 so the `How`, acceptance criteria, QA evidence, and fixture tests explicitly cover the required locator families, including transport differences for CDP and extension-only capture.

### 2. Performance, memory, and relay stability proof is missing

The audit proof matrix requires performance, memory, and relay stability proof before implementation is complete. See `REPORT.md:37`.

The plan includes four-child and eight-child lifecycle workflows plus preview budget reports at `docs/plans/canvas-annotation-inspiredesign-optimization-2026-06-29.md:181-184`, and required workflow evidence at `docs/plans/canvas-annotation-inspiredesign-optimization-2026-06-29.md:381-390`. It does not explicitly require performance, memory, or relay-stability evidence.

Why this blocks approval: an implementation could pass functional lifecycle tests while still regressing multi-canvas resource use, preview fanout, relay delivery stability, or MV3 restart behavior under load.

Required fix: add explicit performance, memory, and relay stability acceptance and evidence to Tasks 3, 4, and 7. The evidence should include concrete thresholds or bounded budgets, sampled memory or process telemetry, relay restart or reconnect proof, and failure artifacts under the canvas workspace or final QA evidence directory.

## Passing checks

- Every task has Reasoning, What to do, How, Files impacted, End goal, Acceptance criteria, QA and evidence, and Atomic commit.
- The plan rejects diagnostic-only Inspired Design acceptance and preserves `media-analysis.json` as advisory only.
- The plan avoids the one-session multi-document canvas shortcut by planning a refs-only workspace over child sessions.
- The plan prohibits screenshot base64 reaching shared inbox or system injection.
- Review loops and real workflows are specific enough apart from the missing stability evidence above.
- No em dash characters were found in the four reviewed files.

## Recommendation

Fix the two blockers above, then rereview only the updated plan sections. If those updates are made without introducing new scope drift, the plan should be eligible for unconditional approval.
