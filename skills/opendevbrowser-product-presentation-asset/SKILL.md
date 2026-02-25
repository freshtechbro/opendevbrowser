---
name: opendevbrowser-product-presentation-asset
description: Collects product screenshots, images, copy, and metadata into a local folder pack for video workflows.
version: 2.0.0
---

# Product Presentation Asset Skill

Use this skill to build complete product-video input packs and assembly instructions for UGC-style content production.

## Pack Contents

- `artifacts/asset-pack-assembly.md`
- `artifacts/ugc-creative-guide.md`
- `assets/templates/manifest.schema.json`
- `assets/templates/copy.md`
- `assets/templates/features.md`
- `assets/templates/video-assembly.md`
- `assets/templates/user-actions.md`
- `assets/templates/ugc-concepts.md`
- `assets/templates/shot-list.md`
- `assets/templates/claims-evidence-map.md`
- `scripts/collect-product.sh`
- `scripts/capture-screenshots.sh`
- `scripts/download-images.sh`
- `scripts/write-manifest.sh`
- `scripts/render-video-brief.sh`
- `scripts/validate-skill-assets.sh`
- Shared robustness matrix: `../opendevbrowser-best-practices/artifacts/browser-agent-known-issues-matrix.md`

## Fast Start

```bash
./skills/opendevbrowser-product-presentation-asset/scripts/validate-skill-assets.sh
./skills/opendevbrowser-product-presentation-asset/scripts/collect-product.sh "https://example.com/product/123"
./skills/opendevbrowser-product-presentation-asset/scripts/render-video-brief.sh /path/to/manifest.json /tmp/product-video-brief
```

## Final Assets Produced

Expected output pack includes:
- `manifest.json` with canonical product metadata
- `product.json` and `pricing.json`
- `images/` for product stills
- `screenshots/` for page context and UI proof
- `copy.md` and `features.md`
- `raw/source-record.json` for auditability

The `render-video-brief.sh` helper adds:
- `video-brief.md`
- `shot-list.md`
- `ugc-brief.md`
- `claims-evidence-map.md`

## What the User Should Do

1. Pick product URL or product name.
2. Run collection workflow and confirm output pack path.
3. Review generated manifest/copy/features for accuracy.
4. Run `render-video-brief.sh` to generate production instructions.
5. Hand the brief and assets to editor/creator pipeline.

## Parallel Multitab Alignment

- Apply shared concurrency policy from `../opendevbrowser-best-practices/SKILL.md` ("Parallel Operations").
- Validate asset capture flows across `managed`, `extension`, and `cdpConnect` when browser capture is involved.
- Keep one session per worker for concurrent product-page captures; avoid target-switch thrash in one session.

## How to Combine the Assets

1. Use `manifest.json` as source of truth.
2. Build hooks and claims from `copy.md` + `features.md`.
3. Pair each claim with supporting asset (`images` or `screenshots`).
4. Sequence assets using `shot-list.md`.
5. Validate pricing/availability freshness before publishing.
6. Validate every claim appears in `claims-evidence-map.md` before publish.

## Robustness Coverage (Known-Issue Matrix)

Matrix source: `../opendevbrowser-best-practices/artifacts/browser-agent-known-issues-matrix.md`

- `ISSUE-10`: normalized price/currency fields for claims
- `ISSUE-11`: anchor discount context for pricing claims
- `ISSUE-12`: stale price and unsupported-claim prevention via evidence mapping

## UGC Key Concepts

- Hook in first 2 seconds with user problem + payoff.
- Show real product usage context before polished close-ups.
- Keep claims concrete and verifiable from captured assets.
- Use one CTA and one primary value proposition per short clip.
- Preserve authenticity: avoid over-produced voice/style mismatches.

## References

- FTC pricing guidance (deceptive pricing): https://www.ecfr.gov/current/title-16/chapter-I/subchapter-B/part-233
- Schema.org Offer metadata: https://schema.org/Offer
- NIST unit pricing/value comparison guide: https://www.nist.gov/publications/unit-pricing-guide
