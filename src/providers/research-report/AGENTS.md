# src/providers/research-report/ - Agent Guidelines

Deterministic research briefing compiler. Extends `src/providers/AGENTS.md`.

## Overview

Turns normalized provider records into a decision-ready `report.md` with accepted claims, evidence gates, limitations, and recommendations.

## Structure

```text
src/providers/research-report/
├── types.ts            # Briefing, claim, gate, and source contracts
├── rules.ts            # Claim acceptance, rejection, and scoring rules
├── gate.ts             # Evidence gate status and reason codes
├── synthesis.ts        # Briefing assembly
├── render.ts           # Markdown rendering
├── guidance.ts         # Limitations and recommendations
├── claims.ts           # Claim extraction and support mapping
├── passages.ts         # Passage selection
├── themes.ts           # Theme extraction
├── semantic-themes.ts  # Semantic theme helpers
└── index.ts            # Public compiler entry
```

## Pipeline

1. Normalize input records before this compiler boundary.
2. Extract and score claims, passages, and themes.
3. Evaluate evidence gates using explicit reason codes.
4. Synthesize the briefing.
5. Render Markdown without inventing support beyond accepted evidence.

## Rules

- Keep threshold constants named and local to rule/gate modules.
- Use reason codes for partial or failed readiness; do not bury limitations in prose only.
- Separate accepted, rejected, and unsupported claims so `report.md` can explain confidence.
- Rendering should be deterministic from the compiled briefing object.

## Anti-Patterns

| Never | Why |
|-------|-----|
| Treat source count as evidence quality by itself | Independent domains and accepted records both matter |
| Render recommendations from rejected claims | This creates unsupported advice |
| Add report sections without extending `types.ts` and tests | The compiler contract becomes implicit |
