# src/inspiredesign/ - Agent Guidelines

Inspiredesign contracts, reference evidence, media facts, readiness, and handoff artifacts. Extends `src/AGENTS.md`.

## Overview

Owns the design-inspiration workflow contract after providers collect references and before canvas/design-agent handoff consumes the packet.

## Structure

```text
src/inspiredesign/
├── contract.ts                    # Design packet schema, governance sections, handoff contract
├── handoff.ts                     # Artifact guide and design-agent handoff metadata
├── product-readiness.ts           # Product-readiness and evidence-authority gates
├── reference-pattern-board.ts     # Reference scoring, vectors, and board synthesis
├── reference-discovery.ts         # Candidate reference extraction and promotion helpers
├── capture.ts                     # Screenshot, motion, and pin-media capture orchestration
├── pinterest-pin-media-evidence.ts # First-party Pinterest media evidence normalization
├── motion-evidence.ts             # Screencast motion evidence shaping
├── visual-evidence.ts             # Screenshot evidence shaping
├── visual-policy.ts               # Capture policy from provider/blocker state
├── capture-mode.ts                # Capture-mode resolution by provider and URL type
├── pinterest-media-classification.ts # Pinterest media/page classification
├── brief-expansion.ts             # Brief normalization and expansion
├── meta-prompt.ts                 # Design prompt assembly
└── media-analysis/                # Optional host-tool media facts; see nested AGENTS.md
```

## Authority Model

| Surface | Role | Rule |
|---------|------|------|
| `pin-media-index.json` | Pinterest media authority | First-party media and provenance gate |
| `motion-evidence.json` | Motion authority | Screencast-backed motion evidence |
| `media-analysis.json` | Design facts | Advisory only, never product-readiness authority |
| `design.md`, `advanced-brief.md`, and handoff docs | Human handoff | Must reflect authority status truthfully |

Evidence readiness must name the exact authority that satisfied the gate. Canonical Pinterest pin references, including broad-query discoveries, require `pin_media_ready` backed by first-party byte evidence in `pin-media-index.json`; screenshot and screencast evidence cannot substitute for Pinterest pin-media authority. Missing screenshot or motion capture is non-blocking only after `pin_media_ready` is satisfied by byte-backed first-party media.

## Rules

- Keep provider-independent design contracts in this module; browser/session IO belongs in `src/browser/` and workflow orchestration belongs in `src/providers/workflows.ts`.
- Do not add a capture path without adding a readiness gate and artifact-authority handling in `product-readiness.ts`.
- Keep Pinterest URL normalization aligned with `src/guidance/recipes/pinterest.ts`; this module may consume that normalization but should not fork URL rules.
- Preserve first-party Pinterest validation before promoting pin media; off-platform or untrusted media stays diagnostic.
- Handoff artifact names and expected contents are contract surface. Update `handoff.ts`, guidance recipes, docs, and tests together when they change.
- Canvas patches must not smuggle unsupported governance sections; keep the handoff-to-canvas mapping explicit.

## Media Analysis

Optional FFmpeg/FFprobe analysis lives under `media-analysis/`. Missing binaries degrade only `media-analysis.json`; they must not fail pin-media readiness or replace `pin-media-index.json` and `motion-evidence.json`.

## Anti-Patterns

| Never | Why |
|-------|-----|
| Treat `media-analysis.json` as product-ready proof | It is downstream design guidance only |
| Promote a reference without recording why weaker evidence was accepted | Readiness reports must explain authority |
| Patch handoff artifact names as literals in multiple places | Keep contract constants and guidance recipes in sync |
| Add model-vision, OCR, or canvas-pixel extraction here | Current media-analysis contract intentionally excludes those paths |

## Layered AGENTS

- `src/inspiredesign/media-analysis/AGENTS.md` - Optional media-analysis host-tool contract
