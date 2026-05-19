# Declared Parity Divergences

Intentional parity mismatches that are allowed by contract.
Any parity mismatch not listed here must fail parity gates.

Current audit note:
- `tests/parity-matrix.test.ts` loads this registry and rejects unknown declared divergence IDs.
- `docs/ARCHITECTURE.md`, `docs/CLI.md`, and `docs/SURFACE_REFERENCE.md` still document legacy `/cdp` as sequential with `effectiveParallelCap=1` and require declared exceptions for intentional mismatches.
- No additional declared divergence was found in the 2026-05-19 source audit; keep this list short and explicit.

Status: active  
Last updated: 2026-05-19

| ID | Scope | Declared divergence | Rationale |
|---|---|---|---|
| D001 | `extension` legacy `/cdp` | Legacy `/cdp` remains sequential (`effectiveParallelCap=1`) and can classify contention differently from `/ops` target-scoped scheduling. | `/cdp` is compatibility-only and intentionally excluded from parallel throughput parity guarantees. |
| D002 | All modes | Visual artifact hashes (for example screenshots/render diffs) are excluded from strict normalized parity by default. | Rendering differences across headed/headless/compositor paths are non-functional and must be scenario-opt-in for parity assertions. |
