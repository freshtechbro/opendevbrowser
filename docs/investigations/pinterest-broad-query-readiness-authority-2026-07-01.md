# Pinterest Broad-Query Readiness Authority Investigation - 2026-07-01

## Scope

Read-only investigation of Pinterest Inspiredesign broad-query readiness, product-ready pin-media recovery, and screenshot or motion evidence semantics. Source and tests were not edited. This report uses direct artifact inspection plus current source and dirty diff inspection.

## Key artifact paths

- Failed proof summary: `.opendevbrowser/inspiredesign-broad-query-readiness/20260630T234453Z/proof-summary.json`
- Original diagnostic query bundle from continuity: `.opendevbrowser/inspiredesign/5be837d6-7209-40a3-94d9-a62cceba279f`
- Product-ready comparison bundle from continuity: `.opendevbrowser/inspiredesign/90c3386f-65c3-4bd9-acdf-4693d84e47d7`
- Later successful broad-query proof bundle for comparison: `.opendevbrowser/inspiredesign/24ae8c66-c6cb-4c6a-8006-e01fe253fc06`

## Proven artifact facts

### Proof summary

`.opendevbrowser/inspiredesign-broad-query-readiness/20260630T234453Z/proof-summary.json`:

- `createdAt`: `2026-07-01T00:11:05Z`
- `verdict`: `FAIL`
- `preflight.fingerprintCurrent`: `true`
- `preflight.extensionConnected`: `true`
- `preflight.extensionHandshakeComplete`: `true`
- `postHarvestStatus.fingerprintCurrent`: `true`
- `postHarvestStatus.opsConnected`: `true`
- Transport and command success were not product success. Each harvest command exited `0`, but product checks failed for three categories.

Per-run values:

| Category | ready | productSuccess | artifactAuthority | evidenceAuthority | nextStepGuidance.readiness | ranked refs | pin media | failure |
|---|---:|---:|---|---|---|---:|---:|---|
| landing-pages | false | false | `diagnostic_only` | `diagnostic_only` | `blocked` | 0 | 0 | `Open a concrete canonical pin before capture.` |
| design-components | false | false | `diagnostic_only` | `diagnostic_only` | `blocked` | 0 | 0 | `Ops socket closed before handshake` |
| motion-designs | false | false | `diagnostic_only` | `diagnostic_only` | `blocked` | 0 | 0 | `Open a concrete canonical pin before capture.` |
| digital-products | true | true | `product_ready` | `pin_media_ready` | `ready` | 5 | 5 | none |

For landing-pages and motion-designs, proof diagnostics included:

- `discovery-diagnostics.sourcePageQuality`: `login_challenge`
- `discovery-diagnostics.badStateId`: `search-shell`
- `discovery-diagnostics.diagnosticBlockers`: `["login_or_challenge_blocks_reference_extraction"]`
- `discovery-diagnostics.acceptedUrlCount`: `0`
- `discovery-diagnostics.failureCount`: `1`

For design-components:

- `discovery-diagnostics.failure`: `Ops socket closed before handshake`
- `discovery-diagnostics.reason`: `no_reference_urls_extracted`
- `discovery-diagnostics.acceptedUrlCount`: `0`
- `discovery-diagnostics.failureCount`: `1`

For digital-products:

- `ready`: `true`
- `productSuccess`: `true`
- `artifactAuthority`: `product_ready`
- `evidenceAuthority`: `pin_media_ready`
- `nextStepGuidance.readiness`: `ready`
- `ranked-references.references.length`: `5`
- `pin-media-index.pinMediaIndex.length`: `5`
- `discovery-diagnostics.sourcePageQuality`: `search_shell`
- `discovery-diagnostics.diagnosticBlockers`: `["search_shell_without_media_signals"]`
- `discovery-diagnostics.acceptedUrls`: five canonical Pinterest `/pin/<id>/` URLs
- `screenshot-index.screenshots.length`: `0`
- `motion-evidence.motionEvidence.length`: `0`

### Original diagnostic query bundle

`.opendevbrowser/inspiredesign/5be837d6-7209-40a3-94d9-a62cceba279f`:

- `evidence.json.ready`: `false`
- `evidence.json.productSuccess`: `false`
- `evidence.json.artifactAuthority`: `diagnostic_only`
- `evidence.json.evidenceAuthority`: `diagnostic_only`
- `evidence.json.referenceCount`: `0`
- `evidence.json.references.length`: `0`
- `evidence.json.pinMediaIndex.length`: `0`
- `evidence.json.visualEvidence.length`: `0`
- `evidence.json.motionEvidence.length`: `0`
- `ranked-references.json.references.length`: `0`
- `pin-media-index.json.pinMediaIndex.length`: `0`
- `visual-evidence.json.visualEvidence.length`: `0`
- `screenshot-index.json.screenshots.length`: `0`
- `motion-evidence.json.motionEvidence.length`: `0`
- `media-analysis.json.references.length`: `0`
- `discovery-diagnostics.json`: missing
- `bundle-manifest.json.files.length`: `17`
- `design-agent-handoff.json.nextStepGuidance.readiness`: `blocked`
- `canvas-plan.request.json`: missing

Interpretation: this bundle proves the downstream product gate result, not the full discovery cause. The later proof summary provides the preserved discovery diagnosis: query discovery found no accepted canonical pin URLs after login or search-shell blocking.

### Product-ready recovery bundle

`.opendevbrowser/inspiredesign/90c3386f-65c3-4bd9-acdf-4693d84e47d7`:

- `evidence.json.ready`: `true`
- `evidence.json.productSuccess`: `true`
- `evidence.json.artifactAuthority`: `product_ready`
- `evidence.json.evidenceAuthority`: `pin_media_ready`
- `evidence.json.referenceCount`: `1`
- `ranked-references.json.references.length`: `1`
- First ranked reference:
  - `id`: `b718968ff8b0`
  - `url`: `https://www.pinterest.com/pin/1103522714969809752`
  - `score`: `80`
  - `confidence`: `0.8`
  - `evidenceAuthority`: `pin_media_ready`
  - `mediaArtifactPath`: `pin-media-evidence/b718968ff8b0/main.jpg`
  - `capturedVia`: `["fetch", "pin_media", "pin_media_ready"]`
- `pin-media-index.json.pinMediaIndex.length`: `1`
- First pin-media index entry:
  - `referenceId`: `b718968ff8b0`
  - `sourceUrl`: `https://uk.pinterest.com/pin/1103522714969809752/`
  - `mediaUrl`: `https://i.pinimg.com/736x/9c/ee/94/9cee94899dad9034e31a2d3ac7bfa40b.jpg`
  - `path`: `pin-media-evidence/b718968ff8b0/main.jpg`
  - `sha256`: `26ef38a19f55e08211ab6a88d159bc38a06e673a1fee9865d8aa3d5a0c517ff0`
  - `bytes`: `117326`
  - `width`: `736`
  - `height`: `1060`
  - `contentType`: `image/jpeg`
  - `authority`: `design_evidence`
  - `pinterestPageQuality`: `pin_media`
  - `firstPartyProvenance.referenceUrlCanonical`: `true`
  - `firstPartyProvenance.sourceUrlMatchesReference`: `true`
  - `firstPartyProvenance.mediaUrlFirstParty`: `true`
- `visual-evidence.json.visualEvidence.length`: `1`
- `visual-evidence.json.visualEvidence[0].visual.status`: `failed`
- `visual-evidence.json.visualEvidence[0].visual.failure`: `Required visual evidence was not captured.`
- `visual-evidence.json.visualEvidence[0].visual.warnings`: `["required_visual_evidence_missing"]`
- `screenshot-index.json.screenshots.length`: `0`
- `motion-evidence.json.motionEvidence.length`: `0`
- `media-analysis.json.references.length`: `1`
- `bundle-manifest.json.files.length`: `19`
- `bundle-manifest.json.files` includes `pin-media-evidence/b718968ff8b0/main.jpg`
- `design-agent-handoff.json.nextStepGuidance.readiness`: `ready`
- `canvas-plan.request.json`: present

Interpretation: this bundle is product-ready because pin-media authority is complete and byte-backed. Screenshot capture failed, and motion evidence is empty, but the product gate was carried by first-party Pinterest pin media.

### Later successful broad-query comparison

`.opendevbrowser/inspiredesign/24ae8c66-c6cb-4c6a-8006-e01fe253fc06`:

- `ready`: `true`
- `productSuccess`: `true`
- `artifactAuthority`: `product_ready`
- `evidenceAuthority`: `pin_media_ready`
- `rankedReferenceCount`: `5`
- `pinMediaReadyReferenceCount`: `5`
- `visualEvidenceAfterPinMedia.status`: `failed`
- `visualEvidenceAfterPinMedia.authority`: `pin_media_ready`
- `visualEvidenceAfterPinMedia.message`: `Pinterest pin-media bytes remain the readiness authority; screenshot evidence is an additional non-blocking visual lane.`
- `motionCapture.status`: `not_applicable`
- `motionCapture.reason`: `still_image_pin_media`
- `motionCapture.authority`: `motion_evidence_browser_replay_only`

Interpretation: the newer diagnostic clarity fields are working in at least one successful proof bundle and should be asserted in fresh four-query QA.

## Proven source facts

- `src/inspiredesign/AGENTS.md` states that `pin-media-index.json` is Pinterest media authority, `motion-evidence.json` is motion authority, and `media-analysis.json` is advisory only.
- `src/inspiredesign/product-readiness.ts` defines `artifactAuthority` as `product_ready | diagnostic_only` and `evidenceAuthority` as `snapshot_ready | motion_ready | pin_media_ready | ranked_reference | diagnostic_only`.
- `INSPIREDESIGN_FINAL_EVIDENCE_AUTHORITY_PRECEDENCE` prefers `pin_media_ready`, then `motion_ready`, then `snapshot_ready`.
- `resolveInspiredesignFinalEvidenceAuthority()` returns `pin_media_ready` when `productSuccess` is true and `pinMediaReadyReferenceCount > 0`.
- `buildInspiredesignProductReadinessFields()` requires ready guidance, at least one ranked reference, no active do-not-proceed blocker, coherent counts, all ranked references authoritative, product-ready evidence, and required Pinterest pin-media authority.
- `isInspiredesignAuthoritativeRankedReference()` only treats Pinterest references as authoritative when the claimed authority has matching artifacts. For `pin_media_ready`, that means a matching `pin-media-index.json` entry.
- `finalizeInspiredesignReferencePinMedia()` only emits a bundle file when persisted pin media has `authority === "design_evidence"` and no rejection reasons.
- `src/providers/renderer.ts` recomputes artifact-backed counts and requires Pinterest pin references to have `pin_media_ready` plus a matching pin-media index entry before Canvas continuation.
- `buildVisualEvidenceAfterPinMediaNotice()` explicitly says pin-media bytes remain readiness authority and screenshot evidence is non-blocking.
- `buildStillImageMotionCaptureNotice()` marks still image pin media as `not_applicable` for browser motion and names `motion-evidence.json` as the only browser replay authority.
- Current dirty diff in `src/providers/browser-native-discovery.ts` adds a bounded Pinterest search retry with `PINTEREST_BROWSER_NATIVE_SEARCH_ATTEMPT_LIMIT = 2` for search-shell or login-challenge pages when search result context exists. It also keeps hard failure reason codes strict and adds richer accepted-reference diagnostics.

## Root causes

1. The first broad-query harvest was diagnostic-only because discovery produced zero accepted canonical pin URLs. With no ranked references and no pin-media index entries, product readiness correctly stayed `ready=false`, `productSuccess=false`, `artifactAuthority=diagnostic_only`, and `evidenceAuthority=diagnostic_only`.
2. The later proof shows the discovery reason: Pinterest search pages were classified as login or search shell states, or the ops handshake failed. Those are transport or environment recovery problems, not product-ready evidence.
3. The recovery bundle is product-ready because it starts from a concrete canonical pin and persists first-party Pinterest media bytes with matching provenance, hash, dimensions, content type, and local artifact path.
4. Missing screenshot evidence in the recovery bundle is a non-blocking visual lane failure after pin-media authority. It is a diagnostic clarity issue, not a product-readiness blocker, as long as `pin-media-index.json` authority is complete.
5. Empty motion evidence is expected for still image pin media. Browser motion authority must come from `motion-evidence.json`; saved still images and `media-analysis.json` do not imply motion.

## Issue inventory

### Product blockers

- Broad-query discovery can stop on Pinterest login or search-shell states before rendered canonical pin links are available.
- Ops handshake failure can make a run diagnostic-only even when the CLI command exits `0`.
- Original diagnostic bundle did not persist `discovery-diagnostics.json`, so the bundle alone cannot explain why no references were accepted.

### Contract or diagnostic clarity issues

- Product-ready recovery can have `visual-evidence.json` with a failed required screenshot and `screenshot-index.json` empty. This is acceptable only if the bundle also clearly states that pin-media authority remains ready and screenshot evidence is non-blocking.
- Product-ready recovery can have `motion-evidence.json` empty. This is acceptable for still image pin media, but the bundle should emit `motionCapture.status=not_applicable`, `reason=still_image_pin_media`, and `authority=motion_evidence_browser_replay_only`.
- `media-analysis.json` may contain useful image facts but must remain advisory and must not satisfy product readiness.

### Not blockers when pin-media authority is complete

- `screenshot-index.json.screenshots.length === 0`
- `visual-evidence.json` containing `required_visual_evidence_missing`
- `motion-evidence.json.motionEvidence.length === 0` for still image pin media
- `media-analysis.json.references.length > 0` without motion replay evidence

## Hypotheses to verify

- The bounded retry in the dirty `browser-native-discovery.ts` diff should convert transient Pinterest search-shell or login-challenge pages into accepted canonical pin URLs when the search results render on the second attempt.
- The dirty ops browser manager changes are intended to reduce `Ops socket closed before handshake` discovery failures.
- The explicit recovery bundle predates or missed the newer clarity notices, while the later digital-products bundle proves those notices can be generated. Fresh QA should confirm every successful broad-query bundle contains the clarity fields.

## Recommended exact fixes for the implementation agent

1. Keep the two-attempt Pinterest discovery retry, but only for `search_shell` or `login_challenge` classifications with search result context. Do not retry or soften hard blockers such as auth, challenge, policy, rate limit, token, settings/account chrome, boards, ideas, stale pins, or noncanonical URLs.
2. Persist `discovery-diagnostics.json` for every Inspiredesign Pinterest run, including diagnostic-only bundles. It must include `acceptedUrls`, `acceptedUrlCount`, `rejectedUrlCount`, `failureCount`, `sourcePageQuality`, `badStateId` when known, `diagnosticBlockers`, and accepted reference diagnostics when present.
3. Keep command transport success separate from product success. A CLI exit code `0` may still return `productSuccess=false`; proof scripts should fail the proof unless all product fields are ready.
4. Ensure product-ready Pinterest bundles always include `visualEvidenceAfterPinMedia` when pin-media authority exists. The notice should keep `authority=pin_media_ready` and describe screenshots as non-blocking after pin-media capture.
5. Ensure still image pin-media bundles always include `motionCapture.status=not_applicable`, `motionCapture.reason=still_image_pin_media`, and `motionCapture.authority=motion_evidence_browser_replay_only` when no browser replay motion exists.
6. Keep `media-analysis.json` advisory. It may cite hashes and image facts from pin-media, but it must never set or replace `artifactAuthority`, `evidenceAuthority`, or `productSuccess`.
7. Add or keep tests proving failed screenshot lanes do not downgrade product-ready pin-media bundles, while missing or invalid pin-media still makes Pinterest diagnostic-only.
8. Add or keep tests proving GIF or video media-analysis sampling without `motion-evidence.json` cannot claim `motion_ready`.
9. Harden ops handshake recovery enough that a single closed socket does not silently produce diagnostic-only evidence without clear failure diagnostics.

## Fresh four-query QA assertions

For landing pages, design components, motion designs, and digital products, assert all of the following in each fresh bundle:

- `ready === true`
- `productSuccess === true`
- `artifactAuthority === "product_ready"`
- `evidenceAuthority === "pin_media_ready"`
- `nextStepGuidance.readiness === "ready"`
- `ranked-references.json.references.length >= 1`
- Every Pinterest ranked reference URL is canonical `/pin/<id>/`.
- Every Pinterest ranked reference has `evidenceAuthority === "pin_media_ready"` or `capturedVia` includes `pin_media_ready`.
- `pin-media-index.json.pinMediaIndex.length >= 1`
- Every pin-media index entry has `authority === "design_evidence"`, nonzero `bytes`, valid `sha256`, valid dimensions, a local file in `bundle-manifest.json.files`, and first-party provenance flags all `true`.
- `pinMediaReadyReferenceCount` equals the Pinterest ranked reference count.
- `discovery-diagnostics.json` exists and records accepted canonical pin URLs, retry or blocker context, and zero hard blockers for the accepted references.
- Missing screenshots do not downgrade product readiness when pin-media authority is complete.
- Still image pin media with no replay produces `motionCapture.status === "not_applicable"` and does not produce `motion_ready`.
- `motion_ready` appears only when `motion-evidence.json` contains browser replay authority.
- `media-analysis.json` is present only as advisory facts and does not confer readiness.
- `canvas-plan.request.json` exists only for product-ready bundles.

## Verdict

The first broad-query harvest was diagnostic-only because discovery never produced accepted canonical pin references, not because the renderer incorrectly rejected ready evidence. The product-ready recovery bundle is valid because `pin-media-index.json` carries byte-backed first-party Pinterest authority. Missing screenshot and motion evidence are acceptable only as clearly labeled non-blocking or not-applicable lanes after pin-media readiness; fresh QA should assert that clarity explicitly.
