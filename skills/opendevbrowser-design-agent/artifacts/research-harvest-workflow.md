# Research Harvest Workflow

Use this workflow before design direction is locked, when the brief references competitors, or when a redesign needs stronger visual and interaction references than the local repo already provides.

## Goal

Turn live product references into a deterministic pattern board instead of vague inspiration.

## Inputs

- A focused brief or design question
- `3` to `5` reference products or pages
- The target surface in this repo
- Constraints that must not be violated:
  - existing design system rules
  - supported libraries and runtime budgets
  - accessibility and responsive requirements

## Evidence Loop

1. Pick reference pages that match the product shape:
   - dashboard
   - marketing landing page
   - onboarding flow
   - editor
   - auth/settings surface
2. Capture the surface with OpenDevBrowser:
   - `launch`
   - `goto`
   - `snapshot`
   - `screenshot`
   - `debug-trace-snapshot` when motion, loading, or layout churn matters
3. Record each page in `assets/templates/reference-pattern-board.v1.json`.
4. For each reference, extract:
   - layout recipe
   - content hierarchy
   - component families
   - motion posture
   - loading and empty-state strategy
   - token and theming clues
   - patterns to borrow
   - patterns to reject
5. Synthesize only the patterns that fit the repo's current surface, libraries, and runtime budgets.
6. Translate the synthesis into the design contract before touching `/canvas` or code.

## What To Borrow From External Patterns

These cues should stay explicit in the pattern board:

- From Dimillian:
  - start from the closest shipped screen family
  - decide shell, route, overlay, async, and token ownership before implementation
  - validate patterns in isolation before full integration
- From Vercel v0:
  - specify structure, state, and constraints directly
  - describe concrete interaction states instead of aesthetic buzzwords
- From Lovable:
  - use real content and realistic journeys
  - iterate one improvement axis at a time
- From public frontend-designer agents:
  - inspect current stack and assets first
  - combine aesthetics, accessibility, and implementation practicality in one review loop

## OpenDevBrowser Command Pattern

```bash
npx opendevbrowser launch --no-extension --start-url https://example.com
npx opendevbrowser goto --session-id <session-id> --url <reference-url>
npx opendevbrowser snapshot --session-id <session-id>
npx opendevbrowser screenshot --session-id <session-id>
npx opendevbrowser debug-trace-snapshot --session-id <session-id>
```

Repeat this for each selected reference. Keep the resulting notes in one pattern board so the design contract has a visible source of truth.

## Exit Criteria

- The pattern board lists at least `3` live references.
- Borrowed and rejected patterns are both explicit.
- The chosen design direction is justified by evidence, not taste alone.
- The resulting design contract names component families, state ownership, and validation targets before implementation starts.
