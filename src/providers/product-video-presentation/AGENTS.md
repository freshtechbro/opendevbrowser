# src/providers/product-video-presentation/ - Agent Guidelines

Product-video presentation readiness compiler. Extends `src/providers/AGENTS.md`.

## Overview

Builds a product presentation brief with promoted claims, supported specs, visual guidance, and readiness gates for video production.

## Structure

```text
src/providers/product-video-presentation/
├── types.ts      # Presentation, claim, spec, and readiness contracts
├── rules.ts      # Claim/spec promotion and rejection rules
├── gate.ts       # Readiness gate status and reason codes
├── synthesis.ts  # Presentation assembly
├── render.ts     # Markdown rendering
└── index.ts      # Public compiler entry
```

## Rules

- Keep product-video readiness separate from generic provider success; a workflow can collect records and still fail presentation readiness.
- Promote specs only when supported by evidence, not by product-title fallback.
- Preserve reason codes for missing specs, weak claims, title fallback, stale evidence, and rejected candidates.
- Rendering should make the "can produce video" decision obvious before creative guidance.
- Tests should cover each new readiness reason code and promotion rule.

## Anti-Patterns

| Never | Why |
|-------|-----|
| Treat a marketing title as enough product evidence | Video guidance needs supported specs and claims |
| Collapse readiness and rendering into one path | Gates must remain testable |
| Hide rejected candidates | Creative output depends on knowing evidence gaps |
