`src/challenges/` coordinates preserved auth and anti-bot incidents. It is not a second truth authority.

Authority boundaries:
- `SessionStore` owns blocker truth.
- Browser managers own surfaced `meta.blocker`, `meta.blockerState`, `meta.blockerResolution`, and additive `meta.challenge`.
- `GlobalChallengeCoordinator` owns lifecycle only.
- `runtime-factory` and `browser-fallback` own preserve-or-complete transport.
- `ProviderRuntime` owns suspended-intent replay.
- `ProviderRegistry` owns durable pressure.

The challenge plane may read those seams, choose a bounded lane, execute existing manager controls, verify progress, and emit audit-ready outcomes. It may not redefine blocker, lifecycle, transport, or pressure truth.
