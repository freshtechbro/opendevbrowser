# src/guidance/recipes/ - Agent Guidelines

Site and workflow recipe implementations. Extends `src/guidance/AGENTS.md`.

## Overview

Recipes match a normalized guidance context and build a concrete next-step plan for a site, provider, or workflow state.

## Structure

```text
src/guidance/recipes/
├── generic.ts                 # Generic fallback-free workflow guidance
├── pinterest.ts               # Pinterest URL, search, and native-discovery guidance
├── site-recipe-types.ts       # Recipe interfaces and shared contracts
├── site-recipe-validation.ts  # Recipe validation helpers
└── site-registry.ts           # Recipe registration and priority ordering
```

## Recipe Pattern

- Keep each recipe pure: `matches(context)` decides applicability, `build(context)` returns guidance.
- Register recipes in `site-registry.ts`; priority numbers should make the most specific recipe win before generic guidance.
- Use normalized URL helpers for host/path checks. Pinterest matching must preserve canonical pin URL behavior and reject search-shell or login-challenge pages when evidence is weak.
- Browser-native discovery belongs behind explicit recipe capabilities such as `buildSearchUrl` and `extractReferenceUrls`.

## Pinterest Rules

- Canonicalize Pinterest references in one place and reuse that helper from callers.
- Distinguish pin pages, grid/search shells, chrome-only pages, login challenges, and unrelated pages.
- Do not recommend unrelated web-provider fallbacks for Pinterest-specific evidence gaps.
- Keep pin-media authority language aligned with Inspiredesign: `pin-media-index.json` and `motion-evidence.json` are authority; `media-analysis.json` is guidance.

## Anti-Patterns

| Never | Why |
|-------|-----|
| Add a recipe without tests for match priority | Router ordering is behavior |
| Parse site URLs with ad hoc string checks | Use URL normalization helpers |
| Let generic guidance override a more specific site recipe | Users lose actionable recovery steps |
