# src/providers/social/ - Agent Guidelines

Social provider adapters and transcript/search quality helpers. Extends `src/providers/AGENTS.md`.

## Overview

Owns platform-specific social search/fetch behavior, shared social provider construction, search-shell detection, and YouTube transcript strategy resolution.

## Structure

```text
src/providers/social/
├── platform.ts          # Shared social provider factory and execution contract
├── search-quality.ts    # Search-shell detection, URL quality, expansion filtering
├── youtube-resolver.ts  # Transcript strategy resolver
├── youtube.ts           # YouTube provider
├── x.ts, reddit.ts, bluesky.ts, facebook.ts, linkedin.ts
├── instagram.ts, tiktok.ts, threads.ts
└── index.ts             # Provider exports
```

## Rules

- Add platform adapters through `createSocialPlatformProvider()` unless the platform genuinely needs a different execution model.
- Keep platform wrappers thin: platform metadata, URL patterns, and policy hooks belong there; shared behavior belongs in `platform.ts` or `search-quality.ts`.
- Preserve search-shell and off-platform detection before promoting results.
- Keep `isAllowedSocialSearchExpansionUrl()` and `prioritizeSocialSearchLinks()` platform-aware so retries do not drift into unrelated sources.
- YouTube transcript resolution follows configured strategy order and must report which path resolved content.
- Browser fallback is a provider recovery path with explicit blocker and provenance metadata, not silent success.

## Anti-Patterns

| Never | Why |
|-------|-----|
| Treat a search shell as usable content | It causes weak or circular evidence |
| Add a platform by copying another provider wholesale | Shared factory behavior will drift |
| Hide transcript strategy failures | Downstream reports need provenance |
| Expand social searches to unrelated domains | Provider source authority is lost |
