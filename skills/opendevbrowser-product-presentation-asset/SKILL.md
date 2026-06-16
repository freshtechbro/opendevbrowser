---
name: opendevbrowser-product-presentation-asset
description: Collects product metadata, copy, and optional visual assets into a local folder pack for video workflows.
version: 2.0.0
---

# Product Presentation Asset Skill

Use this skill to build product-video input packs and readiness-gated assembly instructions for UGC-style content production.

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
- `manifest.json` with canonical product metadata and `manifest.readiness.presentation` plus `manifest.readiness.productVideo`
- `presentation-readiness.json` with readiness status, warnings, reason codes, selected-record identity, candidate summaries, promoted claims, rejected candidate summaries, evidence references, and compact counts
- `product.json` and `pricing.json`; `product.json.presentationReadiness` and `product.json.productVideoReadiness` mirror the production gates
- `copy.md` and `features.md`, which are production input only when readiness allows it
- `raw/source-record.json` for auditability and raw evidence preservation

Workflow JSON output also exposes `product.presentationReadiness`, `product.productVideoReadiness`, `meta.presentationReadiness`, and `meta.productVideoReadiness` so callers can gate automation without opening files first.

When visual capture succeeds, the pack may also include:
- `images/` for product stills
- `screenshots/` for page context and UI proof

Metadata-first packs with `0` images and `0` screenshots are valid intermediate outputs only when readiness is reviewed. They usually produce `partial` readiness and need additional visual sourcing before final video publication.

The `render-video-brief.sh` helper adds:
- `video-brief.md`
- `shot-list.md`
- `ugc-brief.md`
- `claims-evidence-map.md`

Helper behavior:
- `pass`: generates normal production brief files, still requiring human evidence and visual review.
- `partial`: generates gated brief files with warnings and reason codes. Treat copy and features as constrained draft input.
- `fail`: exits nonzero after writing warning-only diagnostics. Do not label copy, features, or product claims as verified production input.

## What the User Should Do

1. Pick product URL or product name.
2. Before daemon-backed `product-video run` workflows, run `opendevbrowser status --daemon --output-format json` and continue only when `data.fingerprintCurrent === true`.
3. Run collection workflow and confirm output pack path.
4. Review `presentation-readiness.json`, `manifest.readiness.presentation`, `manifest.readiness.productVideo`, `product.json.presentationReadiness`, `product.json.productVideoReadiness`, and returned `meta.presentationReadiness` when available.
5. Confirm raw evidence remains preserved in `raw/source-record.json`, but do not treat raw marketplace text as verified production copy.
6. Run `./skills/opendevbrowser-product-presentation-asset/scripts/render-video-brief.sh` only after readiness review.
	Canonical helper path: `./skills/opendevbrowser-product-presentation-asset/scripts/render-video-brief.sh`.
7. If readiness is `partial`, resolve warnings and reason codes before final publication.
8. If readiness is `fail`, stop production use and recollect or repair evidence before briefing creators.
9. If no visuals were captured, source or capture visuals before handing the brief to the editor or creator pipeline.

## Parallel Multitab Alignment

- Apply shared concurrency policy from `../opendevbrowser-best-practices/SKILL.md` ("Parallel Operations").
- Validate asset capture flows across `managed`, `extension`, and `cdpConnect` when browser capture is involved.
- Keep one session per worker for concurrent product-page captures; avoid target-switch thrash in one session.

## How to Combine the Assets

1. Use `manifest.json` plus `presentation-readiness.json` as the readiness source of truth.
2. Use `copy.md` and `features.md` as production inputs only when readiness is `pass` and claims map to evidence.
3. For `partial`, keep the brief gated and carry reason codes into `video-brief.md`, `shot-list.md`, and `claims-evidence-map.md`.
4. For `fail`, use helper output as diagnostics only and do not brief production.
5. Pair each claim with supporting asset (`images` or `screenshots`) when available.
6. If the pack is metadata-first, source visuals before final edit and update `shot-list.md` plus `claims-evidence-map.md` with the new asset paths.
7. Sequence assets using `shot-list.md`.
8. Validate pricing and availability freshness before publishing.
9. Validate every claim appears in `claims-evidence-map.md` before publish.

## Production Rules

- `success:true`, `ok:true`, or an artifact path means the workflow wrote files. It does not by itself mean production-ready.
- `presentation-readiness.json.summary.status`, `manifest.readiness.presentation.status`, and `manifest.readiness.productVideo.status` are the production gates.
- Raw evidence is preserved for audit and debugging. It must not be copied into creator scripts unless promoted through readiness-backed claims.
- Marketplace chrome, seller language, shipping, returns, condition, and unsupported superlatives are rejected unless they are explicitly promoted as evidence-backed product claims.
- Keep partial and fail reason codes visible in every handoff so downstream editors know what still needs review.

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
