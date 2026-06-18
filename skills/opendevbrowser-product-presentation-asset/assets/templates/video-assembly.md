# Video Assembly Instructions

## Assets

- Manifest: `manifest.json`
- Readiness: `presentation-readiness.json`
- Product metadata: `product.json`
- Pricing: `pricing.json`
- Copy and features: `copy.md`, `features.md`
- Raw audit evidence: `raw/source-record.json`
- Visuals: `images/*`, `screenshots/*` when capture succeeds
- Claim evidence map: `claims-evidence-map.md`

## Readiness Gate

- `manifest.readiness.presentation` and `manifest.readiness.productVideo` are the first production gate.
- `product.json.presentationReadiness` and `product.json.productVideoReadiness` mirror the product-facing gates.
- JSON workflow output exposes the same gates through `meta.presentationReadiness` and `meta.productVideoReadiness`.
- Raw evidence remains audit input. It is not production copy or feature proof by itself.

## Assembly Steps

1. Inspect `presentation-readiness.json` before using `copy.md` or `features.md`.
2. For `pass`, build a script from the top 3 evidence-backed benefits.
3. For `partial`, keep the brief gated and include warnings plus reason codes in handoff notes.
4. For `fail`, stop production use and use the files only to diagnose missing or rejected evidence.
5. Match each line to one visual asset when visuals exist.
6. Create sequence: hook -> proof -> CTA.
7. Verify all price or discount statements against `pricing.json`.
8. Mark `claims-evidence-map.md` rows as verified only after evidence review.
9. If the pack is metadata-first, source visuals and update the shot list before final edit.
