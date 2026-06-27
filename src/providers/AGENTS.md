# src/providers/ - Agent Guidelines

Provider system for web, social, shopping, community retrieval, artifact-bearing workflows, and deterministic workflow reports. Extends `src/AGENTS.md`.

## Overview

Multi-source provider runtime with tiered execution, safety guards, browser fallback, deterministic product reports, and artifact bundle writing. Supports search, fetch, crawl, and post operations across web, social, community, and shopping sources.

## Structure

```
src/providers/
├── adaptive-concurrency.ts # Global/per-domain concurrency controller
├── artifacts.ts            # Artifact lifecycle + cleanup
├── blocker.ts              # Blocker classification + artifact helpers
├── browser-native-discovery.ts # Browser-discovered reference extraction
├── browser-output-artifacts.ts # Browser fallback output artifact helpers
├── workflow-output-root.ts  # Project/worktree-local workflow artifact root policy
├── workflow-contracts.ts    # Workflow kind, plan, checkpoint, trace, and resume contracts
├── workflow-handoff.ts      # Workflow follow-through guidance
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
├── research-report/         # Deterministic research report compiler and renderer
├── shopping-report/         # Deterministic shopping buying-brief compiler and renderer
├── product-video-presentation/ # Product-video presentation readiness compiler
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

## Workflow Artifacts

- Omitted outputs for artifact-bearing workflows resolve through the project/worktree-local `.opendevbrowser` contract.
- Workflow bundles use `.opendevbrowser/<workflow-namespace>/<run-id>/` with `bundle-manifest.json`.
- Canvas, screenshot, screencast, annotation, desktop audit, and release proof lanes are related output lanes but not provider workflow bundles.
- Low-level bundle creation must receive an explicit output root; do not reintroduce temp-root fallback behavior.
- Inspiredesign workflows may schedule trusted persisted Pinterest media for deterministic `media-analysis.json` and pass optional host FFmpeg/FFprobe binary options resolved env, then config, then `PATH` into that seam. FFmpeg/FFprobe are not bundled static binaries or default downloads. `status-capabilities.host.mediaAnalysis` is diagnostic/preflight visibility only; missing binaries degrade `media-analysis.json` only. Readiness must remain driven by `pin-media-index.json`, `motion-evidence.json`, ranked references, and product-readiness gates; `media-analysis.json` is design guidance, not authority.

## Workflow Contracts

- `workflow-contracts.ts` owns workflow kind, plan, checkpoint, resume-envelope, and trace types across `research`, `shopping`, `product_video`, and `inspiredesign`.
- Keep resume envelopes typed through `isWorkflowResumeEnvelope()` and `buildWorkflowResumeEnvelope()`; do not pass anonymous records across workflow boundaries.
- Workflow stages are `compile`, `execute`, `postprocess`, and `resume`; adding a stage requires docs, tests, and renderer/handoff updates.

## Workflow Handoff

- `workflow-handoff.ts` owns success handoff builders for research, shopping, product video, macro resolve, and Inspiredesign.
- Handoffs must carry enough rerun/follow-through context for the user without overstating readiness.
- Keep generated command examples aligned with `src/public-surface/source.ts`, `docs/CLI.md`, and `docs/SURFACE_REFERENCE.md`.

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

## Layered AGENTS

- `src/providers/social/AGENTS.md` - Social providers and transcript/search quality rules
- `src/providers/research-report/AGENTS.md` - Deterministic research briefing compiler
- `src/providers/shopping-report/AGENTS.md` - Deterministic shopping buying-brief compiler
- `src/providers/product-video-presentation/AGENTS.md` - Product-video readiness compiler
