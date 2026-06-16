# User Action Checklist

- [ ] Collected assets from target product
- [ ] Reviewed `manifest.readiness.presentation` and `manifest.readiness.productVideo`
- [ ] Reviewed `presentation-readiness.json` reason codes, warnings, promoted claims, and rejected candidates
- [ ] Confirmed `product.json.presentationReadiness` and JSON output `meta.presentationReadiness` match the expected gate when those surfaces are available
- [ ] Preserved raw audit evidence in `raw/source-record.json` without treating it as verified production copy
- [ ] Generated video brief files only after readiness review
- [ ] For `partial`, kept the brief gated with warnings and reason codes
- [ ] For `fail`, stopped production use and used helper output only as a warning diagnostic
- [ ] Confirmed pricing recency and currency
- [ ] Approved shot order and CTA
