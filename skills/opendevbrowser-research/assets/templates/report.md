# Research Report

## Evidence Gate Status

State pass, partial, or fail. Include the named thresholds, timebox, source coverage, rejected-candidate pressure, and blocker summary. Do not publish shell-only, stale-only, login-only, not-found-only, or zero-source-evidence claims.

## Final Answer

Provide conservative answer lines generated only from accepted and tentative claim templates. If the gate fails, explain why evidence is insufficient instead of producing a final claim.

## Claim Map

List each deterministic claim with status, confidence label, supporting record IDs, source URLs, and notes. Claim status is accepted, tentative, or excluded.

## Theme Synthesis

Summarize promoted themes, accepted-record coverage, independent-domain coverage, and representative passages.

## Source Agreement or Disagreement

Report deterministic source overlap and explicit disagreement cues only. If no direct contradiction is detected, say so instead of claiming universal agreement.

## Confidence by Claim

Explain confidence labels with named factors: source coverage, domain independence, content quality, source confidence, timebox fit, disagreement cues, provider failures, and rejection pressure.

## Limitations

Record source diversity, extraction quality, stale or out-of-timebox records, shell rejections, cookie diagnostics, challenge pages, provider failures, transcript durability, and unsupported claims.

## Recommendations

Provide deterministic next actions such as rerun with a narrower recent timebox, add source families, use authorized extension mode only when needed, inspect named accepted sources, or stop when evidence is insufficient.

## Evidence Appendix

Include artifact files, accepted evidence passages, rejected-candidate summary, search-index destination overlap notes, cookie/provider diagnostics, and raw artifact pointers:

- `summary.md`
- `report.md`
- `records.json`
- `context.json`
- `meta.json`
- `bundle-manifest.json`

Use `context.json` for the full audit markers and raw provenance trail when helper scripts or agents need them:

- Source selection
- Search Direction
- Candidate Triage
- Rejected Candidates
- Deep Dives
- Synthesis Feedback
- search_engine_passes
- SERPs are discovery-only and cannot be final evidence.
