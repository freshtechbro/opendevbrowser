# Landing Metrics Source Of Truth

Status: active
Last updated: 2026-02-16
Owner: product-marketing + maintainer reviewer

Purpose:
- canonical verification register for landing proof-strip metrics.
- every published metric must have same-day verification evidence.

Freshness rules:
- publish is blocked when newest `as_of_utc` is older than 24 hours.
- `verification_status` must be `verified` for all metrics shown on the landing page.
- stale, blocked, or contradictory entries must not be displayed.

## Metric Register

| label | value | as_of_utc | source_command_or_file | verification_owner | verification_status | verification_evidence_ref |
|------|-------|-----------|-------------------------|--------------------|---------------------|---------------------------|
| CLI command surface | 54 commands | 2026-02-16T21:21:22Z | `docs/SURFACE_REFERENCE.md` | maintainer | verified | `docs/SURFACE_REFERENCE.md:13` |
| Tool surface | 47 tools | 2026-02-16T21:21:22Z | `src/tools/index.ts` + `rg "opendevbrowser_[a-z_]+:" src/tools/index.ts \| wc -l` | maintainer | verified | `src/tools/index.ts:67`, command output `47` at `2026-02-16T21:20:26Z` |
| Branch coverage | 97.01% (5159/5318) | 2026-02-16T21:21:22Z | `coverage/lcov.info` + `awk -F: '/^BRF:/{brf+=$2} /^BRH:/{brh+=$2} END {printf "BRH=%d BRF=%d BRANCH_PCT=%.2f\n", brh, brf, (brh/brf)*100}' coverage/lcov.info` | maintainer | verified | `coverage/lcov.info`, command output `BRH=5159 BRF=5318 BRANCH_PCT=97.01` |
| Branch coverage gate | >=97% | 2026-02-16T21:21:22Z | `vitest.config.ts` | maintainer | verified | `vitest.config.ts:15` |

## Verification Log

| verified_at_utc | verifier | review_owner | notes |
|----------------|----------|--------------|-------|
| 2026-02-16T21:21:22Z | maintainer | maintainer reviewer | Re-verified proof-strip launch metrics from canonical source files and live command outputs; all entries satisfy freshness and evidence requirements. |
