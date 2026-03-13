# src/providers/ — Agent Guidelines

Provider system for web, social, shopping, and community data retrieval. Extends `src/AGENTS.md`.

## Overview

Multi-source provider runtime with tiered execution, safety guards, and browser fallback. Supports search, fetch, crawl, and post operations across web, social, community, and shopping sources.

## Structure

```
src/providers/
├── adaptive-concurrency.ts # Global/per-domain concurrency controller
├── artifacts.ts            # Artifact lifecycle + cleanup
├── blocker.ts              # Blocker classification + artifact helpers
├── enrichment.ts           # Enrichment scoring/metadata helpers
├── errors.ts               # Provider error types
├── index.ts                # Provider runtime entrypoint
├── normalize.ts            # Result normalization + execution metadata
├── policy.ts               # Provider selection policy
├── registry.ts             # ProviderRegistry construction
├── renderer.ts             # Provider render modes
├── runtime-factory.ts      # Browser fallback port, config-driven runtime creation
├── tier-router.ts          # Tier selection + fallback routing
├── timebox.ts              # Timebox resolution/filtering
├── types.ts                # Core types - ProviderSource, ProviderOperation, ProviderAdapter
├── workflows.ts            # High-level research/shopping/product-video orchestration
├── community/              # Community/forum providers
│   └── index.ts
├── web/                    # Web crawling and extraction
│   ├── crawl-worker.ts     # Worker-thread crawl jobs
│   ├── crawler.ts          # BFS/DFS crawler
│   ├── extract.ts          # Content extraction
│   └── policy.ts           # Crawling policies
├── social/                 # Social platform providers
│   ├── platform.ts         # Shared platform helpers
│   ├── x.ts, reddit.ts, bluesky.ts, facebook.ts, linkedin.ts, instagram.ts, tiktok.ts, threads.ts, youtube.ts
│   └── youtube-resolver.ts # Transcript strategy resolver (api/ytdlp/asr/browser fallback)
├── shopping/               # Shopping/deal providers
│   └── index.ts
├── safety/                 # Safety guards
│   └── prompt-guard.ts     # Prompt injection detection
└── shared/                 # Shared utilities
    ├── anti-bot-policy.ts, post-policy.ts, request-headers.ts, traversal-url.ts
```

## Key Types

| Type | Purpose |
|------|---------|
| `ProviderSource` | `"web" | "community" | "social" | "shopping"` |
| `ProviderOperation` | `"search" | "fetch" | "crawl" | "post"` |
| `ProviderAdapter` | Interface for provider implementations |
| `ProviderRuntime` | Execution runtime with budgets, tiers, guards |
| `ProviderTier` | `"A" | "B" | "C"` - execution tier |
| `BlockerSignalV1` | Blocker detection with evidence and hints |

## Tier System

| Tier | Use Case |
|------|----------|
| A | Default, unrestricted |
| B | Hybrid mode (managed + extension) |
| C | Restricted-safe, high friction targets |

Tier selection based on: `challengePressure`, `highFrictionTarget`, `riskScore`, `hybridHealthy`, `policyRestrictedSafe`, latency/error budgets.

## Safety Features

- **Prompt Guard**: Injection detection with quarantined segments
- **Anti-Bot Policy**: Cooldown, challenge retries, proxy/session hints
- **Blocker Detection**: Auth required, anti-bot challenge, rate limited, upstream block
- **Adaptive Concurrency**: Global/per-domain limits with auto-tuning
- **Tier Router**: Controlled fallback across A/B/C runtime tiers

## Browser Fallback

When providers fail (e.g., YouTube transcript extraction), `createBrowserFallbackPort()` enables:
1. Launch managed headed Chrome
2. Navigate to URL
3. Extract content
4. Disconnect and cleanup

## Configuration

```typescript
// From OpenDevBrowserConfig.providers
{
  tiers: { default, enableHybrid, enableRestrictedSafe, hybridRiskThreshold },
  adaptiveConcurrency: { enabled, maxGlobal, maxPerDomain },
  antiBotPolicy: { enabled, cooldownMs, maxChallengeRetries, proxyHint },
  transcript: { strategyOrder, enableYtdlp, enableAsr, enableBrowserFallback }
}
```

`social/youtube-resolver.ts` follows `providers.transcript.strategyOrder` and normalizes transcript resolution metadata.
`runtime-factory.ts` also exposes `createBrowserFallbackPort()` for managed-browser recovery paths used by workflows and transcript resolution.

## Anti-Patterns

| Never | Why |
|-------|-----|
| Skip prompt guard | Injection risk |
| Ignore blocker signals | Will fail on auth/challenge |
| Hardcode tier selection | Use tier metadata |
| Bypass browser fallback | Lose recovery path |

## Dependencies

- `../browser/manager-types` - BrowserManagerLike for fallback
- `../config` - Provider configuration
