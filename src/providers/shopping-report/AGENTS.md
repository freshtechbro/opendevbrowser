# src/providers/shopping-report/ - Agent Guidelines

Deterministic shopping buying-brief compiler. Extends `src/providers/AGENTS.md`.

## Overview

Turns normalized shopping records into `deals.md` with market baseline, offer assessment, duplicate grouping, and readiness status.

## Structure

```text
src/providers/shopping-report/
├── types.ts      # Buying brief, offer, baseline, and gate contracts
├── rules.ts      # Offer scoring, freshness, relevance, duplicate rules
├── gate.ts       # Readiness gate and reason codes
├── synthesis.ts  # Brief assembly
├── render.ts     # Markdown rendering
└── index.ts      # Public compiler entry
```

## Rules

- Compute market baselines from normalized totals only; keep unknown shipping/tax/availability explicit.
- Group duplicate or near-duplicate offers before ranking recommendations.
- Distinguish best, viable, caution, and rejected offers with reason codes.
- Preserve region and freshness evidence instead of assuming a generic market.
- Rendering must surface unknowns rather than turning them into confident buying advice.

## Anti-Patterns

| Never | Why |
|-------|-----|
| Recommend an offer with unknown critical availability | The brief must stay decision-ready |
| Drop suspicious or duplicate titles silently | The user needs to know why candidates were rejected |
| Mix extraction logic into the compiler | Provider adapters own collection and normalization |
