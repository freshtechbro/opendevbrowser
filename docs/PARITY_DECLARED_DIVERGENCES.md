# Declared Parity Divergences

Intentional parity mismatches that are allowed by contract.
Any parity mismatch not listed here must fail parity gates.

Status: active  
Last updated: 2026-02-23

| ID | Scope | Declared divergence | Rationale |
|---|---|---|---|
| D001 | `extension` legacy `/cdp` | Legacy `/cdp` remains sequential (`effectiveParallelCap=1`) and can classify contention differently from `/ops` target-scoped scheduling. | `/cdp` is compatibility-only and intentionally excluded from parallel throughput parity guarantees. |
| D002 | All modes | Visual artifact hashes (for example screenshots/render diffs) are excluded from strict normalized parity by default. | Rendering differences across headed/headless/compositor paths are non-functional and must be scenario-opt-in for parity assertions. |
