---
name: opendevbrowser-product-presentation-asset
description: Collects product metadata, copy, and optional visual assets into a local folder pack for video workflows.
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

## Supporting Surfaces

- Use browser replay (`screencast-start` / `screencast-stop`) when a product flow needs temporal UI proof before you decide which screenshots to keep.
- Use desktop observation only for read-only evidence around external windows or OS-owned dialogs that affected capture.
- Use `--challenge-automation-mode off|browser|browser_with_helper` for bounded browser-scoped computer use on provider or auth walls; it is not a desktop agent.

## Final Assets Produced

Expected output pack always includes:
- `manifest.json` with canonical product metadata
- `product.json` and `pricing.json`
- `copy.md` and `features.md`
- `raw/source-record.json` for auditability

When visual capture succeeds, the pack may also include:
- `images/` for product stills
- `screenshots/` for page context and UI proof

Metadata-first packs with `0` images and `0` screenshots are still valid intermediate outputs when the workflow captured canonical product data, copy, and pricing. Those packs need additional visual sourcing before final video publication.

The `render-video-brief.sh` helper adds:
- `video-brief.md`
- `shot-list.md`
- `ugc-brief.md`
- `claims-evidence-map.md`

## What the User Should Do

1. Pick product URL or product name.
2. Run collection workflow and confirm output pack path.
3. Review generated manifest/copy/features for accuracy and check whether the pack is visual-ready or metadata-first.
4. Run `./skills/opendevbrowser-product-presentation-asset/scripts/render-video-brief.sh` to generate production instructions and visual sourcing notes.
	Canonical helper path: `./skills/opendevbrowser-product-presentation-asset/scripts/render-video-brief.sh`.
5. If no visuals were captured, source or capture visuals before handing the brief to the editor/creator pipeline.

## Parallel Multitab Alignment

- Apply shared concurrency policy from `../opendevbrowser-best-practices/SKILL.md` ("Parallel Operations").
- Validate asset capture flows across `managed`, `extension`, and `cdpConnect` when browser capture is involved.
- Keep one session per worker for concurrent product-page captures; avoid target-switch thrash in one session.

## How to Combine the Assets

1. Use `manifest.json` as source of truth.
2. Build hooks and claims from `copy.md` + `features.md`.
3. Pair each claim with supporting asset (`images` or `screenshots`) when available.
4. If the pack is metadata-first, source visuals before final edit and update `shot-list.md` plus `claims-evidence-map.md` with the new asset paths.
5. Sequence assets using `shot-list.md`.
6. Validate pricing/availability freshness before publishing.
7. Validate every claim appears in `claims-evidence-map.md` before publish.

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
