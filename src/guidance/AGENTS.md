# src/guidance/ - Agent Guidelines

Workflow guidance recipes, readiness routing, context builders, and renderers. Extends `src/AGENTS.md`.

## Overview

Turns workflow state into actionable next-step guidance for CLI text, JSON records, provider constraints, and workflow follow-through.

## Structure

```text
src/guidance/
├── context.ts       # Workflow/source state -> GuidanceContext
├── readiness.ts     # Readiness classification helpers
├── renderers.ts     # CLI, JSON, workflow, and provider renderers
├── router.ts        # Recipe selection and guidance routing
├── types.ts         # Guidance contracts
├── index.ts         # Public exports
└── recipes/         # Site/workflow recipes; see nested AGENTS.md
```

## Routing Contract

- Recipes own `matches()` and `build()` behavior; the router owns ordering and dispatch.
- Context builders normalize provider, canvas, daemon, CLI, and Inspiredesign states before recipes run.
- Readiness values must stay aligned with recipe behavior: provider unavailable, diagnostic-only, zero references, zero ranked references, failed capture, off-brief reference, weak reference, and design-ready.
- Renderer choice must preserve the target surface: terse CLI text, structured JSON, workflow compatibility records, or provider constraint messages.

## Cross-Module Contracts

- Pinterest URL canonicalization in `recipes/pinterest.ts` is consumed by Inspiredesign. Do not duplicate that logic in Inspiredesign.
- Inspiredesign handoff file names and do-not-proceed messages must stay aligned with `src/inspiredesign/handoff.ts` and `src/inspiredesign/product-readiness.ts`.
- If recipe output mentions workflow output roots, preserve the repo-local `.opendevbrowser/<namespace>/<runId>` contract and label external roots as explicit exceptions.

## Adding Guidance

1. Add or update a recipe under `recipes/`.
2. Add focused tests for matching, context classification, and rendered text.
3. Update public docs or skill guidance only when user-facing workflow instructions change.

## Anti-Patterns

| Never | Why |
|-------|-----|
| Put browser/provider IO in guidance | Guidance consumes already-collected state |
| Match recipes by brittle prose only | Prefer typed context fields and normalized URLs |
| Emit confident next steps from diagnostic-only evidence | Guidance must preserve readiness truth |
| Hardcode Inspiredesign artifact names without syncing `src/inspiredesign/handoff.ts` | Artifact names are a cross-module contract |

## Layered AGENTS

- `src/guidance/recipes/AGENTS.md` - Recipe authoring and site-specific rules
