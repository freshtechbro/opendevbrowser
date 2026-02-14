# Provider Benchmark Fixtures

This fixture manifest defines the deterministic benchmark data used by the automated provider performance gate.

## Fixture graph

- Seed: `https://perf.local/root`
- Reachable pages:
  - `https://perf.local/root`
  - `https://perf.local/a`
  - `https://perf.local/b`
  - `https://perf.local/c`
- Link graph:
  - `root -> a`
  - `root -> b`
  - `root -> c`
  - `a -> b`
  - `b -> c`

The fixture is embedded in `tests/providers-performance-gate.test.ts` and uses a pure in-memory fetcher (no network I/O).

## Gate protocol

1. Warmup: implicit in the repeated fixture iterations.
2. Measured iterations:
   - search/fetch latency: 20 iterations each
   - crawl throughput/success: 15 iterations
3. Metrics:
   - p50 and p95 latency
   - pages/minute
   - extraction success ratio (`records / expectedPages`)

## Baseline thresholds

- search/fetch p50 latency: `<= 1200ms`
- search/fetch p95 latency: `<= 3500ms`
- crawl throughput median: `>= 25 pages/minute`
- crawl success median: `>= 95%`
- crawl p95 latency: `<= 3500ms`

These thresholds mirror the initial SLO baseline from `docs/AUTOMATION_PLATFORM_IMPLEMENTATION_PLAN.md` and are intentionally conservative for deterministic CI stability.
