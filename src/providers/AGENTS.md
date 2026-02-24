# src/providers/ — Agent Guidelines

Provider system for web, social, shopping, and community data retrieval. Extends `src/AGENTS.md`.

## Overview

Multi-source provider runtime with tiered execution, safety guards, and browser fallback. Supports search, fetch, crawl, and post operations across web, social, community, and shopping sources.

## Structure

```
src/providers/
├── types.ts              # Core types (418 lines) - ProviderSource, ProviderOperation, ProviderAdapter
├── runtime-factory.ts    # Browser fallback port, config-driven runtime creation
├── workflows.ts          # High-level workflow orchestration
├── artifacts.ts          # Artifact generation
├── errors.ts             # Provider error types
├── web/                  # Web crawling and extraction
│   ├── crawler.ts        # BFS/DFS crawler with worker threads
│   ├── extract.ts        # Content extraction
│   └── policy.ts         # Crawling policies
├── social/               # Social platform providers
│   ├── x.ts, reddit.ts, bluesky.ts, facebook.ts, linkedin.ts, instagram.ts, tiktok.ts, threads.ts, youtube.ts
│   └── youtube-resolver.ts # Transcript strategy resolver (api/ytdlp/asr/browser fallback)
├── shopping/             # Shopping/deal providers
├── safety/               # Safety guards
│   └── prompt-guard.ts   # Prompt injection detection
└── shared/               # Shared utilities
    ├── anti-bot-policy.ts, traversal-url.ts, post-policy.ts
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
