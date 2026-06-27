# src/inspiredesign/media-analysis/ - Agent Guidelines

Optional host-tool media fact extraction for Inspiredesign. Extends `src/inspiredesign/AGENTS.md`.

## Overview

Reads trusted persisted media and emits bounded design facts for `media-analysis.json`; it does not decide workflow readiness.

## Structure

```text
src/inspiredesign/media-analysis/
├── analyzer.ts              # Orchestrates probe, frame sampling, and fact synthesis
├── binaries.ts              # FFmpeg/FFprobe path resolution
├── ffmpeg.ts                # Frame extraction and decode helpers
├── ffprobe.ts               # Metadata probing
├── pixel.ts                 # Pixel-level color/contrast sampling
├── typography-structure.ts  # Heuristic visual structure facts
├── design-guidance.ts       # Facts -> design guidance summary
├── persist.ts               # Writes media-analysis artifacts
├── types.ts                 # Capability, fact, and non-goal contracts
└── index.ts                 # Public exports
```

## Binary Resolution

Resolve tools in this order:

1. `OPENDEVBROWSER_FFMPEG_PATH` and `OPENDEVBROWSER_FFPROBE_PATH`
2. `inspiredesign.mediaAnalysis.ffmpegPath` and `inspiredesign.mediaAnalysis.ffprobePath`
3. `PATH`
4. Common absolute install directories only after an implicit `PATH` ENOENT miss

FFmpeg and FFprobe are recommended optional host tools. Do not bundle static binaries, download them by default, or make package install depend on them.
Do not silently recover invalid env or config paths through common-path fallback; those are operator intent and must remain diagnostic.

## Capability Contract

| Capability | Meaning |
|------------|---------|
| `frame_decode` | Frame sampling is available |
| `metadata_probe` | Metadata is available but frames are not |
| `unavailable` | Emit degraded diagnostics only |

Host capability is `full` only when both FFmpeg frame sampling and FFprobe metadata probing are available. Claim levels move from `metadata_only` to `motion_sampled` only when decoded frames support that claim. Never infer sampled motion from metadata alone.

## Rules

- Accept only trusted persisted media from the upstream pin-media lane.
- Keep analysis bounded: short samples, deterministic outputs, and no network fetches here.
- Missing or failing tools must degrade the media-analysis artifact, not product readiness.
- Preserve non-goals in `types.ts`: no OCR, no OpenCV, no Tesseract, no model vision, and no browser canvas pixel extraction.

## Anti-Patterns

| Never | Why |
|-------|-----|
| Use media-analysis facts as pin-media authority | Authority belongs to `pin-media-index.json` |
| Hide binary resolution failures | Preflight/status visibility depends on clear degradation reasons |
| Add unbounded frame extraction | Runtime and artifact size must stay predictable |
