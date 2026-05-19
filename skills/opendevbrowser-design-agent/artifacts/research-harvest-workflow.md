# Research Harvest Workflow

Use this workflow before design direction is locked, when the brief references competitors, or when a redesign needs stronger visual and interaction references than the local repo already provides.

## Goal

Turn live product references into a deterministic ranked pattern board and motion-aware design brief instead of vague inspiration.

## Inputs

- A focused brief or design question
- `3` to `5` reference products or pages, or a bounded public discovery query
- The target surface in this repo
- Constraints that must not be violated:
  - existing design system rules
  - supported libraries and runtime budgets
  - accessibility and responsive requirements
  - provider policy boundaries for blocked, auth-required, challenge, or rate-limited references

## Primary Harvest Loop

Prefer the dedicated InspireDesign harvest entrypoint for visual-first research:

```bash
npx opendevbrowser inspiredesign harvest \
  --brief "Synthesize a premium docs workspace" \
  --query "best docs product landing pages" \
  --provider web/default \
  --max-references 5 \
  --visual-evidence required \
  --browser-mode managed \
  --mode json
```

Use explicit references when the team already knows the right examples:

```bash
npx opendevbrowser inspiredesign harvest \
  --brief "Extract reusable dashboard patterns" \
  --url https://example.com/reference-a \
  --url https://example.com/reference-b \
  --visual-evidence required \
  --mode json
```

Harvest defaults:

- `mode=path`
- `visualEvidence=required`
- `maxReferences=5`
- explicit `--url` references rank before query-discovered candidates during collection
- the daemon method remains `inspiredesign.run`

## Required Artifact Review

After a successful harvest, inspect these files before `/canvas` or code changes:

1. `advanced-brief.md` for the reference-first creative brief.
2. `ranked-references.json` for rank, score, confidence, visual strengths, visual risks, rejected references, and selection reasons.
3. `visual-evidence.json` and `screenshot-index.json` for artifact-relative PNG paths, hashes, byte counts, viewport metadata when available, provenance, and warnings.
4. PNG files under `visual-evidence/<referenceId>/viewport.png` for actual visual review.
5. `meta-prompt.md` for borrow guidance, reject guidance, motion posture, accessibility constraints, no-copy warning, and validation gates.
6. `canvas-plan.request.json` and `design-agent-handoff.json` only after the visual synthesis is accepted.

JSON files are metadata-only. They must not contain base64 screenshots, absolute temp paths, full DOM, or full snapshot text.

## Manual Evidence Fallback

Use the lower-level browser loop only when harvest cannot run or when a single reference needs debugging:

```bash
npx opendevbrowser launch --no-extension --start-url https://example.com
npx opendevbrowser goto --session-id <session-id> --url <reference-url>
npx opendevbrowser snapshot --session-id <session-id>
npx opendevbrowser screenshot --session-id <session-id> --path ./artifacts/reference.png
npx opendevbrowser debug-trace-snapshot --session-id <session-id>
```

Record manual evidence in `assets/templates/reference-pattern-board.v1.json` using the same ranking and screenshot metadata fields as harvest.

## What To Extract

For each accepted reference, extract:

- layout recipe
- content hierarchy
- component families
- motion posture
- loading and empty-state strategy
- token and theming clues
- visual strengths to borrow
- visual risks and patterns to reject
- screenshot path, hash, viewport, and warning metadata when available

Synthesize only the patterns that fit the repo's current surface, libraries, runtime budgets, and accessibility policy.

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

## Motion Follow-through

Load `opendevbrowser-motion-design` before translating harvest motion posture into timing tokens, scroll choreography, gesture motion, reduced-motion behavior, or temporal proof. Harvest motion cues are design intent only; they do not authorize new runtime dependencies or shader, WebGL, Spline, or 3D lanes.

## Exit Criteria

- The pattern board lists at least `3` live references unless provider policy or discovery diagnostics explain the smaller set.
- Borrowed and rejected patterns are both explicit.
- Rank 1 justifies the dominant direction.
- Screenshot metadata points to existing PNG artifacts or explains skipped or failed visual evidence.
- The chosen design direction is justified by evidence, not taste alone.
- The resulting design contract names component families, state ownership, motion posture, and validation targets before implementation starts.
