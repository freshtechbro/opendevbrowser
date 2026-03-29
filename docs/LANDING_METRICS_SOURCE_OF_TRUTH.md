# Landing Metrics Source Of Truth

Status: blocked (historical snapshot)
Snapshot date: 2026-02-23
Last audited against repo: 2026-03-23
Owner: product-marketing + maintainer reviewer

Current audit note:
- the register below is preserved as 2026-02-23 evidence and no longer satisfies this file's 24-hour freshness rule.
- current source-verified runtime counts are `61` CLI commands (`src/cli/args.ts`) and `54` tools (`src/tools/index.ts`).
- branch coverage and any landing proof-strip publish values were not re-verified in this pass, so landing publication should remain blocked until same-day evidence is regenerated.

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
| CLI command surface | 55 commands | 2026-02-23T03:16:29Z | `src/cli/args.ts` + command extraction | maintainer | verified | command output `CLI=55` from source extraction on 2026-02-23 |
| Tool surface | 48 tools | 2026-02-23T03:16:29Z | `src/tools/index.ts` + command extraction | maintainer | verified | command output `TOOLS=48` from source extraction on 2026-02-23 |
| Branch coverage | 97.03% (6068/6254) | 2026-02-23T03:16:29Z | `coverage/lcov.info` + `awk -F: '/^BRF:/{brf+=$2} /^BRH:/{brh+=$2} END {printf "BRH=%d BRF=%d BRANCH_PCT=%.2f\n", brh, brf, (brh/brf)*100}' coverage/lcov.info` | maintainer | verified | command output `BRH=6068 BRF=6254 BRANCH_PCT=97.03` |
| Branch coverage gate | >=97% | 2026-02-23T03:16:29Z | `vitest.config.ts` | maintainer | verified | `vitest.config.ts` thresholds block |

## Verification Log

| verified_at_utc | verifier | review_owner | notes |
|----------------|----------|--------------|-------|
| 2026-03-23T05:55:36Z | codex source re-audit | maintainer reviewer | Re-verified the current repo source files, corrected the current audit note to `61` CLI commands and `54` tools, kept status `blocked (historical snapshot)`, and retained the 2026-02-23 table as archival evidence pending a fresh landing-metrics verification pass. |
| 2026-03-12T00:00:00Z | codex historical-status audit | maintainer reviewer | Marked this file blocked/historical and retained the 2026-02-23 table as archival evidence pending a fresh landing-metrics verification pass. |
| 2026-02-23T03:16:29Z | maintainer | maintainer reviewer | Re-verified CLI/tool surface counts from source and recomputed branch coverage from `coverage/lcov.info` after latest copy + docs sync pass. |
| 2026-02-22T19:52:55Z | maintainer | maintainer reviewer | Re-verified command/tool counts directly from source files and recomputed branch coverage from `coverage/lcov.info`. |
| 2026-02-16T21:21:22Z | maintainer | maintainer reviewer | Re-verified proof-strip launch metrics from canonical source files and live command outputs; all entries satisfy freshness and evidence requirements. |
