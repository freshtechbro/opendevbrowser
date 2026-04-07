# Asset Pack Assembly

## Inputs

- product URL or product name
- provider hint (optional)
- output directory (optional)

## Build sequence

1. Collect base product pack (`collect-product.sh`)
2. Inspect the capture summary and classify the pack as visual-ready or metadata-first
3. Validate manifest schema fields
4. Generate video brief (`render-video-brief.sh`)
5. Review claim-to-evidence mapping (`claims-evidence-map.md`)
6. If visuals are missing, source or capture them before final publication
7. Review shot sequence and CTA consistency

## Release checks

- pricing timestamp is recent
- screenshot/image files are readable when present
- metadata-first packs are marked for additional visual sourcing before publish
- copy claims map to feature evidence
- every promoted claim is backed by a concrete asset path
