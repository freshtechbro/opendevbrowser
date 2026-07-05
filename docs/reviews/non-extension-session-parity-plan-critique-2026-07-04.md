# Non-Extension Session Parity Plan - Critique

- **Plan reviewed:** `docs/plans/2026-07-04-001-feat-non-extension-session-parity-plan.md`
- **Date:** 2026-07-04
- **Scope:** Under-specified seams, contradictions / missing dependencies, over-planning risk, order-changing questions. No production code modified.

## 1. Top under-specified seams

1. **Profile registry storage, concurrency, and daemon lifecycle (U2).** The plan says "atomic config/cache writes" under the ODB cache root but never specifies format, the lock primitive behind U3's "concurrent same-profile launch returns actionable lock guidance," or how registry records coexist with the daemon fingerprint preflight (`AGENTS.md` requires `fingerprintCurrent === true` before daemon-backed commands). If the registry is daemon-owned, a fingerprint mismatch invalidates it; if process-owned, the U10 "persists across launches" smoke is fragile. File: `src/browser/session-profile-registry.ts` (new), `src/cache/paths.ts`.

2. **CDP target ownership graph: event source and reconciliation with `TargetManager` (U7).** "Auxiliary CDP Target-domain graph" with "Keep `TargetManager` as the canonical page registry" leaves two registries. The plan does not name the CDP events that populate it (`Target.targetCreated`/`targetDestroyed`? `Page.frameNavigated`?), the divergence/reconciliation boundary, or the degradation trigger beyond "when CDP graph data is unavailable." Files: `src/browser/cdp-target-ownership.ts` (new), `src/browser/target-manager.ts`.

3. **Auth proof vs. auth capability for Pinterest pre-flight (KTD5, U5, U6).** "Separate capability from proof" is asserted, but U6 forbids "raw cookie observability as proof" while the only proof signal named (`pin-media-index.json`) is a post-harvest outcome authority, not a pre-flight auth proof. The gap between "is this profile logged in" (pre-flight) and "did the harvest produce authoritative media" (post-flight) is unbridged. If no pre-flight proof exists, U5's `authProof` field is always `unverified` for Pinterest, making capability routing advisory rather than decisive. Files: `src/providers/runtime-policy.ts`, `src/inspiredesign/product-readiness.ts`.

4. **`cdp-profile` ownership detection for cleanup (U4).** "Cleaned up only when OpenDevBrowser owns it" but the ownership marker is unspecified (registry record? launch token? process-tree check?). The plan also does not define behavior when a user manually launches Chrome against the same ODB user-data-dir and then connects. Files: `src/cli/commands/session/cdp-profile.ts` (new), `src/browser/session-profile-registry.ts`.

5. **Default-Chrome-profile refusal mechanism (R4, U4).** "Refuses the user's default daily Chrome profile" without specifying path comparison, marker files, or a registry allowlist. Path comparison is fragile under symlinks and macOS container paths. This is a safety-critical check and should not be left to implementation discretion.

## 2. Contradictions or missing dependencies

1. **U3 and U4 are declared parallel (both depend only on U1, U2) but share write sets.** Both modify `src/browser/browser-manager.ts`, `src/cli/daemon-commands.ts`, `src/cli/commands/session/launch.ts`, and `src/public-surface/source.ts`. The dependency table implies parallelism the file overlap does not support. Either add U4 to U3 (or U3 to U4), merge them into one PR, or carve write ownership explicitly.

2. **U8 is over-coupled to U7.** U8 (status/inspector parity) depends on U5, U6, and U7. The bulk of U8 (profile capability, auth proof, Google-sensitive risk fields) does not need U7's popup/opener metadata. U7 is the most speculative new subsystem and its slip blocks all of U8/U9/U10. Split U8 into "profile/status parity" (deps U5) and "target-ownership status" (deps U7).

3. **U5 scope conflates managed and CDP capability.** U5 depends on U3 and U4, but provider capability routing for managed profiles (the highest-value subset) only needs U3. Splitting U5 into managed-capability (deps U3) and cdp-capability (deps U4) would unblock U6's Pinterest-in-managed-mode work before U4 lands.

No factual contradictions found: file references in "Existing Implementation To Preserve" verified against the tree (`auth-intent.ts`, `auth-provenance.ts`, `runtime-policy.ts`, `product-readiness.ts`, `ops-browser-manager.ts`, `session-inspector.ts` all exist; `session-profile-registry.ts`, `cdp-target-ownership.ts`, `cdp-profile.ts` confirmed absent). The `user_owned_google -> ["extension"]` fallback and the two-value `GoogleAuthIntent` are accurate.

## 3. Risk of over-planning

The 10-unit chain with a near-linear critical path (U1 to U2 to {U3,U4} to U5 to U6 to U8 to U9 to U10, plus U7 off U3/U4) is a big-bang plan for work that is naturally incremental. The highest-value, lowest-risk slice is U1 + U2 + U3: characterization tests, the registry, and managed-headed-as-default. That alone delivers the novice-visible win (Pinterest login without the extension) and is independently shippable.

U4 (CDP profile launcher), U5/U6 (provider capability contract), and U7 (CDP target ownership) are each independently shippable as follow-up PRs. Forcing them into one dependency chain stretches the critical path and delays the release of the managed-profile parity that is the plan's actual product goal. Recommend phasing: Phase 1 = U1+U2+U3; Phase 2 = U5(managed)+U6; Phase 3 = U4+U5(cdp)+U7+U8. U9 and U10 run against whichever phases landed.

## 4. Questions whose answers would change implementation order

1. **Is the profile registry daemon-owned or process-owned?** Daemon-owned ties U2 to the fingerprint lifecycle and may block on daemon work; process-owned weakens the cross-launch persistence smoke. Answer changes U2's storage design and whether U2 is a U1-blocker or a U1-parallel task.

2. **What is the Pinterest pre-flight auth proof (distinct from post-flight `pin-media-index.json`)?** If none exists, U5's `authProof` is always `unverified` for Pinterest, U6 can only allow attempts (not unblock readiness), and the "product-ready in managed mode" claim (R10, AE5) reduces to "the readiness gate still decides." That downgrades U6 from a parity enabler to a non-blocking refinement and lets it slip behind U4.

3. **Can U3 and U4 merge into one PR?** Their shared write sets make true parallelism unlikely. If they merge, the dependency table simplifies and U5's managed-capability subset unblocks sooner. If they stay split, add an explicit U4-to-U3 edge or assign disjoint file ownership.

4. **Is U7 a release blocker or a follow-up?** It is the most speculative new subsystem and blocks U8/U10. If descoped, U8 (minus target-ownership status) and U9 land on the managed-profile path without waiting on a new CDP graph.

5. **Does default-profile refusal (R4) use path comparison, marker files, or a registry allowlist?** Path comparison is the weakest and would make R4 safety theater. A registry allowlist (only ODB-started profiles are attachable) is stronger and shifts U4's safety boundary from detection to provenance, which in turn changes whether U2 must land before U4 is safe to ship.
