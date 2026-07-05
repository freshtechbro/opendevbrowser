# Non-Extension Session Parity Plan - Second-Pass Review

- **Plan reviewed:** `docs/plans/2026-07-04-001-feat-non-extension-session-parity-plan.md`
- **Date:** 2026-07-04
- **Scope:** Second-pass plan-only additions covering inventory surfaces not fully spelled out by the first implementation plan. No production code modified.

## Additions Reviewed

- Added second-pass requirements for cookie import/list metadata, provider `--use-cookies`, challenge modes, browser primitive parity, relay/native/canvas/annotation boundaries, and installed skill freshness.
- Added an inventory coverage map that ties each investigation surface to implementation units U1 through U10.
- Tightened U8 through U10 so verification covers challenge capability, browser primitives, status/inspector redaction, provider workflows, skill freshness, and Inspiredesign/Pinterest authority.
- Clarified raw CDP endpoint attach as browser-control-only with unknown profile scope, distinct from registry-backed explicit CDP profiles.
- Added profile lease and stale-lock requirements for profile concurrency.
- Added a credential-unavailable fallback for Pinterest live proof: fixture-backed authority tests may complete implementation, but release readiness must carry a live-smoke blocker rather than claim product-ready live proof.

## Review Result

Initial bounded review found five plan-only issues:

- U4 dependency drift between the dependency table and unit body.
- Raw CDP endpoint attach conflicted with the default-profile refusal requirement.
- Profile lock behavior lacked an explicit lease or concurrency primitive.
- U5 and U6 did not clearly sequence explicit CDP provider capability behind U4.
- Pinterest product-ready live smoke was too release-blocking when approved test credentials are unavailable.

All five were patched in the CE plan and mirrored into the ULW plan artifacts. The rereview returned `PASS`.
