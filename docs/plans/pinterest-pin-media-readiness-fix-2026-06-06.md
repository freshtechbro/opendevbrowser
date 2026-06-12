# Pinterest Pin-Media Readiness Fix: Validation-First Plan

## Goal

Fix the Pinterest inspiredesign harvest false negative where an explicit canonical Pinterest `/pin/{id}/` captures first-party `i.pinimg.com` media, but final output remains `diagnostic_only` because `interface_chrome_shell` is treated as a fatal pin-media warning.

Success means a canonical pin with trusted persisted first-party bytes can become `pin_media_ready`, emit `pin-media-evidence/<ref>/main.jpg`, and produce a non-empty `pin-media-index.json`, while search shells, boards, related pins, promoted or ad content, login or challenge states without proof, screenshot-only chrome warnings, forged metadata, missing trusted bytes, invalid provenance, and remote-media-only evidence remain blocked.

## Background

- Live local-current evidence showed the emitted media URL is real and downloadable: `https://i.pinimg.com/1200x/1b/61/96/1b619604ca58ad863bc92a4c1911b916.jpg`.
- Manual proof saved a valid JPEG at `artifacts/pinterest-photography-studio-harvest/manual-pin-media-download/pin-944207878113675397-1200x.jpg` with dimensions `800x1080`, `49127` bytes, and SHA-256 `b2a498dc6e73a6d32039669559bb1e5cf96c7461345887b50e88c7ecbab3667e`.
- The observed explicit-pin bundle is `artifacts/pinterest-photography-studio-harvest/local-current-rebuilt-explicit/inspiredesign/7907b224-c064-48f7-ad9b-621e665528eb`.
- That bundle captured canonical pin media metadata for pin `944207878113675397`, but emitted `readiness=diagnostic_only`, empty `pin-media-index.json`, and rejection reasons `blocking_warning` plus `missing_trusted_byte_inspection`.
- `BrowserManager.capturePinterestPinMedia` already performs the media download path. It selects DOM candidates, fetches first-party media, writes bytes to the requested path, and returns final media URL and byte metadata. See `src/browser/browser-manager.ts:2542`.
- The evidence model treats `interface_chrome` as a blocking pin-media warning. See `src/inspiredesign/pinterest-pin-media-evidence.ts:159` and `src/inspiredesign/pinterest-pin-media-evidence.ts:621`.
- Trusted bytes are only recognized when `persistInspiredesignPinterestPinMediaEvidence` receives `options.buffer`; otherwise captured evidence gets `missing_trusted_byte_inspection` unless it is already-finalized signed evidence. See `src/inspiredesign/pinterest-pin-media-evidence.ts:686` and `src/inspiredesign/pinterest-pin-media-evidence.ts:749`.
- Workflow finalization reads the trusted temp file, inspects bytes, persists evidence with final artifact path plus buffer, verifies bytes, and emits a file only when authority is `design_evidence` with no rejection reasons. See `src/providers/workflows.ts:3570`.
- `pin-media-index.json` is intentionally authority-only: index entries are emitted only for `design_evidence` with manifest-backed path, hash, bytes, dimensions, content type, source URL, media URL, page quality, and first-party provenance. See `src/inspiredesign/pinterest-pin-media-evidence.ts:819`.
- Product readiness correctly requires the index entry, first-party provenance, valid path/reference binding, valid hash, byte and dimension thresholds, supported content type, no failure, no rejection reasons, and no blocking pin-media warnings. See `src/inspiredesign/product-readiness.ts:407` and `src/inspiredesign/product-readiness.ts:449`.
- Ranking already suppresses surrounding Pinterest chrome or login text when first-party pin-media proof exists, but only after persisted pin media has become `design_evidence`. See `src/inspiredesign/reference-pattern-board.ts:695` and `src/inspiredesign/reference-pattern-board.ts:729`.
- Pinterest guidance intentionally blocks search-shell discovery and remote-media-only evidence. See `src/guidance/recipes/pinterest.ts:32` and `src/guidance/recipes/pinterest.ts:50`.
- Existing workflow tests cover manifest-backed pin-media happy path and the `login_or_challenge_state` warning exception. See `tests/providers-inspiredesign-workflow.test.ts:1036` and `tests/providers-inspiredesign-workflow.test.ts:1079`.
- Existing visual-harvest tests currently assert `interface_chrome_shell` remains diagnostic despite trusted-looking pin media. See `tests/inspiredesign-visual-harvest.test.ts:562`.
- Search-shell discovery must remain blocked. Existing coverage is in `tests/pinterest-guidance-recipe.test.ts:515` and `tests/pinterest-guidance-recipe.test.ts:553`.

## Approach

Use a validation-first fix. First inspect the observed bundle and add failing tests that prove the exact false negative. Then change the smallest authority seam so `interface_chrome_shell` is non-fatal only for strict byte-backed canonical pin media. Finally, run targeted tests, full quality gates, and a real explicit canonical pin workflow using the local checkout binary.

The fix must not add a downloader. The existing downloader boundary remains `BrowserManager.capturePinterestPinMedia`. The workflow remains a trusted-temp finalizer. The evidence model remains the authority classifier. Product readiness remains index-driven.

## Validation Update - 2026-06-06

Live validation after the authority fix showed three distinct Pinterest harvest outcomes:

- Query discovery remained blocked at `search-shell`: `artifacts/pinterest-photography-studio-harvest/live-validation-query-2026-06-06/inspiredesign/75c08096-8c15-4c92-b952-fb754fa558cf`.
- Two-URL explicit deep validation remained `diagnostic_only`: `artifacts/pinterest-photography-studio-harvest/live-validation-explicit-2026-06-06/inspiredesign/ffbf0458-572f-48de-a81a-b2a19a3d0c53`.
- A single canonical pin validation succeeded: `artifacts/pinterest-photography-studio-harvest/live-validation-single-pin-2026-06-06/inspiredesign/80cd6bd2-cfa9-422d-85ef-0e333a348a1f`.

The successful single-pin run produced `productSuccess=true`, `artifactAuthority=product_ready`, `evidenceAuthority=pin_media_ready`, and a manifest-backed artifact at `pin-media-evidence/aab0a8e0483b/main.jpg`. The saved media was a JPEG with `49127` bytes, dimensions `800x1080`, and SHA-256 `b2a498dc6e73a6d32039669559bb1e5cf96c7461345887b50e88c7ecbab3667e`.

Based on that evidence, Pinterest harvest now forces `captureMode=off` for Pinterest-only discovery and compatible Pinterest URL recovery, even when callers request `--capture-mode deep`. Deep capture remains enabled for `inspiredesign run` explicit URLs and non-Pinterest harvest URL recovery. The intended operational path for design-ready Pinterest evidence is to extract canonical `/pin/{id}/` URLs first, then run canonical pin media harvests against those pins instead of relying on search-shell pages or deep DOM diagnostics.

Video handling is now part of the permanent fix. Current video pins should use actual first-party `video/mp4` bytes as `kind: "video"` whenever a canonical pin exposes video media. Video posters remain a still-image fallback when no actual video source is available, screencast evidence remains the motion-ready lane, and GIFs continue to flow through the image pin-media path as `image/gif`.

## Fresh Rerun Update - 2026-06-06

Fresh byte checks match the JSON indexes for all observed media kinds:

- Image ready bundle: `artifacts/pinterest-photography-studio-harvest/live-media-rerun-2026-06-06/image/inspiredesign/e2688db1-f046-4252-b637-88cbf3d3e101`; media `pin-media-evidence/450106e6361f/main.jpg`; JPEG `800x1080`; `49127` bytes; SHA-256 `b2a498dc6e73a6d32039669559bb1e5cf96c7461345887b50e88c7ecbab3667e`.
- GIF ready bundle: `artifacts/pinterest-photography-studio-harvest/live-media-rerun-2026-06-06/gif-open-pin-retry/inspiredesign/b6690bfe-712d-475f-998d-31d2cfa59813`; media `pin-media-evidence/c71710e16c25/main.gif`; GIF89a `700x472`; `4021227` bytes; SHA-256 `e1f93f122c2514126507992d9712e58370c3988ea75689ce32e09ac97e391cdd`.
- Video ready bundle: `artifacts/pinterest-photography-studio-harvest/live-media-rerun-2026-06-06/video-open-pin-retry/inspiredesign/d4c43f03-279d-427d-a912-317a36b7578c`; media `pin-media-evidence/d0b406f8dcdb/video.mp4`; H.264/AAC MP4 `1280x960`; `16.6s`; `5320411` bytes; SHA-256 `944ed11297917499b5a5253719683710774f2b33b260bd06be87cde8d81bc95f`.

Direct image harvest succeeded. Direct GIF and video harvests may remain diagnostic until the exact canonical pin is opened in the extension and the probe session is disconnected. The product flow should therefore open the canonical pin in extension mode before byte-backed pin-media extraction, then continue with the existing isolated canonical harvest and readiness gates.

## Authority Invariants

- Canonical Pinterest pin matching must use the existing authority normalization behavior, not ad hoc string equality. Locale hosts such as `uk.pinterest.com`, `www.pinterest.com`, trailing slashes, and tracking query params should normalize to the same canonical pin ID when the code already supports that. Non-HTTPS or unsupported hosts must remain diagnostic.
- Trusted byte proof must come from the current persistence call receiving a real `Buffer`, or from the existing non-enumerable in-memory trusted round-trip marker created by the evidence model. Serialized JSON, user-supplied objects, and copied `authority: "design_evidence"` fields must not spoof trust.
- Artifact paths must stay bound to the sanitized reference ID and expected kind-specific filename contract under `pin-media-evidence/<referenceId>/`. Image and GIF pins use `main.*`, actual video pins use `video.mp4`, and video posters use `poster.*` only as fallback still media.
- `pin-media-index.json` remains the product-readiness authority. Raw `pin-media-evidence.json` metadata and remote media URLs do not count unless final artifact bytes are persisted and indexed.
- The exact `login_or_challenge_state` warning remains the existing non-blocking exception for trusted pin media. Broader login, challenge, captcha, blocked overlay, promoted, ad, search-shell, chrome-only, and noise warnings remain fatal.
- Screenshot and visual evidence warning gates are not part of this exception. The exception applies only to strict pin-media authority.

## Guardrail Inventory

These cases must remain blocked throughout implementation:

- Search-shell discovery pages, including search shells that contain media-grid or `i.pinimg.com` text.
- Boards, profiles, source pages, idea pages without concrete media extraction, related pins, promoted pins, ad content, and noisy media candidates.
- Login walls, challenges, captcha states, and blocked overlays without trusted first-party pin-media proof.
- Remote-media-only evidence without persisted bytes.
- Missing, mismatched, symlinked, unavailable, oversized, unsupported, or untrusted temp files.
- Forged, copied, mutated, or JSON-round-tripped `design_evidence` metadata without the trusted marker or current byte inspection.
- Invalid source/reference provenance, invalid first-party media URLs, unsupported content types, tiny dimensions, bad hashes, and artifact paths not bound to the reference ID.

## Dependency Map

- Tasks 1 through 8 validate the finding and lock guardrails before implementation.
- Task 9 is the primary source change.
- Tasks 10 and 11 are conditional source changes if ranking or readiness still re-block the same trusted evidence after Task 9.
- If Task 1 proves `missing_trusted_byte_inspection` comes from temp-path trust or finalization failure rather than warning classification, fix the finalization path before Task 9.
- Tasks 12 through 15 validate the result with targeted tests, real workflow artifacts, full quality gates, and conditional documentation closeout.

## Task 1 - Inspect the Observed False-Negative Bundle

Reasoning: The implementation should be based on the real failure shape, not an assumed simplified fixture.

What to do: Inspect the explicit-pin artifact bundle and record the exact demotion path.

How:
1. Open `artifacts/pinterest-photography-studio-harvest/local-current-rebuilt-explicit/inspiredesign/7907b224-c064-48f7-ad9b-621e665528eb`.
2. Inspect `pin-media-evidence.json`, `pin-media-index.json`, `evidence.json`, `ranked-references.json`, and the workflow response metadata.
3. Confirm whether `pinMedia` has `tempPath`, final artifact `path`, `sha256`, `bytes`, `width`, `height`, `contentType`, `mediaUrl`, `sourceUrl`, `pinterestPageQuality`, and `firstPartyProvenance`.
4. Confirm whether rejection reasons include `blocking_warning`.
5. Confirm whether rejection reasons include `missing_trusted_byte_inspection`.
6. Determine whether `missing_trusted_byte_inspection` came from failed temp-path finalization, missing runtime bytes, warning-only demotion before final artifact emission, or later re-persistence of already-finalized diagnostic metadata.
7. Record whether any media artifact exists under `pin-media-evidence/<ref>/main.*`.
8. If trusted temp finalization failed, pause the warning-classification fix and plan the finalization fix first.

Files impacted: `docs/plans/pinterest-pin-media-readiness-fix-2026-06-06.md`.

Acceptance criteria:
- [ ] The plan records the exact failure path for the observed bundle.
- [ ] The plan confirms that image downloading is not the root problem.
- [ ] The plan identifies whether `missing_trusted_byte_inspection` is a primary failure or a secondary serialization symptom.

## Task 2 - Add Evidence-Model Regression for Trusted Interface Chrome Pin Media

Reasoning: The core false negative is an authority classification problem before index entry creation.

What to do: Add a failing test proving strict byte-backed canonical pin media with only `interface_chrome_shell` can become `design_evidence`.

How:
1. Open `tests/inspiredesign-pinterest-pin-media-evidence.test.ts`.
2. Add the test near the existing warning demotion tests at `tests/inspiredesign-pinterest-pin-media-evidence.test.ts:361`.
3. Use the existing byte-backed helper shape, for example `persistValidEvidence({ warnings: ["interface_chrome_shell"] })`.
4. Assert `authority` is `design_evidence`.
5. Assert `rejectionReasons` does not contain `blocking_warning`.
6. Assert `rejectionReasons` does not contain `missing_trusted_byte_inspection`.
7. Assert `buildInspiredesignPinterestPinMediaIndexEntry(persisted)` returns an entry.
8. Assert the entry still includes the warning for auditability.

Files impacted: `tests/inspiredesign-pinterest-pin-media-evidence.test.ts`.

Acceptance criteria:
- [ ] Test fails before implementation.
- [ ] Test proves the exception is scoped to byte-backed canonical evidence.
- [ ] Warnings remain serialized even when non-fatal.

## Task 3 - Add Evidence-Model Guardrails for Still-Fatal Warnings

Reasoning: The fix must not turn noisy Pinterest UI, ad content, or challenge states into design evidence.

What to do: Add or strengthen tests proving all other blocking warnings remain fatal.

How:
1. In `tests/inspiredesign-pinterest-pin-media-evidence.test.ts`, add a parameterized warning test.
2. Include `search_shell`, `chrome_only`, `promoted`, `ad`, `pin_media_noise:ad`, `pin_media_noise:ad_shopping`, `captcha`, and a broader challenge or blocked-overlay warning.
3. For each warning, call the byte-backed valid fixture with that warning.
4. Assert `authority` is `diagnostic`.
5. Assert `rejectionReasons` contains `blocking_warning`.
6. Assert `buildInspiredesignPinterestPinMediaIndexEntry(...)` returns `undefined`.

Files impacted: `tests/inspiredesign-pinterest-pin-media-evidence.test.ts`.

Acceptance criteria:
- [ ] `interface_chrome_shell` is the only changed warning behavior.
- [ ] Search shell, chrome-only, promoted, ad, captcha, and broader challenge or blocked-overlay blockers remain fatal.
- [ ] The existing exact `login_or_challenge_state` exception for trusted pin media remains unchanged.
- [ ] Remote URL or trusted-looking metadata without valid bytes remains non-authoritative.

## Task 4 - Update Reference-Board Regression for Trusted Interface Chrome Pin Media

Reasoning: The user-visible symptom is that the reference never ranks, even when a canonical pin has usable media.

What to do: Change the current reference-board test that expects `interface_chrome_shell` to reject trusted-looking pin media.

How:
1. Open `tests/inspiredesign-visual-harvest.test.ts`.
2. Locate the test at `tests/inspiredesign-visual-harvest.test.ts:562`.
3. Rename it to describe the new expected behavior: trusted canonical pin media can rank despite an interface chrome shell warning.
4. Keep a canonical Pinterest `/pin/{id}/` URL.
5. Keep a trusted helper-created `pinMedia` object with `warnings: ["interface_chrome_shell"]`.
6. Assert `hasInspiredesignUsableReferenceEvidence(reference)` is `true`.
7. Assert `board.references[0].evidenceAuthority` is `pin_media_ready`.
8. Assert `capturedVia` contains `pin_media_ready`.
9. Assert `board.rejectedReferences` is empty.

Files impacted: `tests/inspiredesign-visual-harvest.test.ts`.

Acceptance criteria:
- [ ] Test fails before implementation.
- [ ] Ranking accepts explicit canonical byte-backed pin media.
- [ ] The test does not alter search-shell discovery behavior.

## Task 5 - Add Reference-Board Guardrail for Untrusted Chrome Shell Media

Reasoning: Surrounding Pinterest chrome text must remain a blocker when there is no trusted first-party pin-media proof.

What to do: Add a reference-board test proving `interface_chrome_shell` remains diagnostic without trusted byte-backed evidence.

How:
1. In `tests/inspiredesign-visual-harvest.test.ts`, add a guardrail test after the updated interface-chrome case.
2. Use a canonical pin URL.
3. Include title or excerpt text with markers such as `Search results for`, `Pin card`, `Your profile`, and `Related searches`.
4. Use a JSON-round-tripped copy of otherwise valid pin-media evidence, or a pin-media object missing the trusted marker/byte proof.
5. Assert `hasInspiredesignUsableReferenceEvidence(reference)` is `false`.
6. Assert `board.references` is empty.
7. Assert rejection diagnostics include `interface_chrome_shell` or trusted-byte rejection reasons.

Files impacted: `tests/inspiredesign-visual-harvest.test.ts`.

Acceptance criteria:
- [ ] Forged or serialized pin media remains diagnostic.
- [ ] Chrome shell text remains blocking without trusted authority.
- [ ] Existing forged evidence protections remain meaningful.

## Task 6 - Add Workflow Regression for Interface Chrome Pin Media

Reasoning: The real failure is workflow readiness, not just unit classification.

What to do: Add a workflow test where primary pin-media capture returns valid bytes and `interface_chrome_shell`.

How:
1. Open `tests/providers-inspiredesign-workflow.test.ts`.
2. Add the test near the login warning exception at `tests/providers-inspiredesign-workflow.test.ts:1079`.
3. Use `runInspiredesignWorkflow` with provider `social/pinterest`, a canonical URL such as `https://www.pinterest.com/pin/27654985208435505/`, `visualEvidence: "required"`, and `captureMode: "deep"`.
4. Stub `capturePinMediaEvidence` to write `validPinMediaBytes()` to `options.pinMediaEvidencePath`.
5. Return `status: "captured"`, canonical `sourceUrl`, `pinterestPageQuality: "pin_media"`, first-party `mediaUrl`, valid dimensions, valid content type, `tempPath: options.pinMediaEvidencePath`, `warnings: ["interface_chrome_shell"]`, and no rejection reasons.
6. Stub visual capture as skipped or unavailable.
7. Assert final output has `productSuccess: true`, `artifactAuthority: "product_ready"`, and `evidenceAuthority: "pin_media_ready"`.
8. Assert `pin-media-evidence.json` has `authority: "design_evidence"`.
9. Assert rejection reasons exclude `blocking_warning` and `missing_trusted_byte_inspection`.
10. Assert `pin-media-index.json` contains one entry.
11. Assert emitted artifact bytes equal `validPinMediaBytes()`.

Files impacted: `tests/providers-inspiredesign-workflow.test.ts`.

Acceptance criteria:
- [ ] Test fails before implementation.
- [ ] Test validates final readiness and not only persistence.
- [ ] Test proves workflow finalization passes trusted bytes through `buffer`.

## Task 7 - Add Workflow Guardrail for Remote-URL-Only Pin Media

Reasoning: A first-party remote media URL alone must never become product-ready.

What to do: Add or confirm workflow coverage where pin-media metadata has a first-party URL but lacks trusted temp bytes.

How:
1. In `tests/providers-inspiredesign-workflow.test.ts`, add a test or extend existing rejected pin-media coverage.
2. Return captured pin-media metadata with first-party `mediaUrl`, but omit a valid `tempPath` or do not write the planned temp file.
3. Assert output remains `diagnostic_only`.
4. Assert `pin-media-index.json` is empty.
5. Assert no `pin-media-evidence/<ref>/main.jpg` artifact is emitted.
6. Assert rejection reasons include temp-path or trusted-byte failure.

Files impacted: `tests/providers-inspiredesign-workflow.test.ts`.

Acceptance criteria:
- [ ] Remote URL alone remains non-authoritative.
- [ ] Missing trusted bytes remains fatal.
- [ ] No duplicate fetch path is introduced.

## Task 8 - Preserve Browser-Native Search-Shell Discovery Guardrails

Reasoning: The false negative is for explicit canonical pin media, not Pinterest search result shells.

What to do: Keep search-shell discovery tests passing and add one focused assertion only if coverage is insufficient.

How:
1. Open `tests/pinterest-guidance-recipe.test.ts`.
2. Keep the search-shell tests at `tests/pinterest-guidance-recipe.test.ts:515` and `tests/pinterest-guidance-recipe.test.ts:553`.
3. Confirm search-shell discovery returns no records and diagnostics include `badStateId: "search-shell"` plus `sourcePageQuality: "search_shell"`.
4. If adding a new test, include text that mentions `i.pinimg.com` inside a search-shell page and assert it still does not produce accepted records.

Files impacted: `tests/pinterest-guidance-recipe.test.ts` only if coverage is unclear.

Acceptance criteria:
- [ ] Search-shell discovery remains blocked.
- [ ] Search-shell media-grid or URL text does not create pin-media authority.
- [ ] Explicit canonical pin handling remains separate from discovery shell extraction.

## Task 9 - Implement the Minimal Authority-Seam Change

Reasoning: The source bug is the warning classification path, not downloader, discovery, or rendering.

What to do: Change pin-media warning classification so `interface_chrome_shell` is non-fatal only for strict canonical byte-backed pin-media evidence.

How:
1. Open `src/inspiredesign/pinterest-pin-media-evidence.ts`.
2. Keep the general blocking marker set strict.
3. Introduce the smallest function boundary that can apply the Authority Invariants above during classification.
4. Ensure the exception is evaluated after trusted byte inspection and structural/provenance fields are available, but before `blocking_warning` is finalized from `interface_chrome_shell`.
5. Ignore only the `interface_chrome_shell` warning when all Authority Invariants pass.
6. Do not make `search_shell`, `chrome_only`, `promoted`, `ad`, `captcha`, `challenge`, `blocked`, `controls_only`, or `pin_media_noise:*` non-fatal.
7. Keep `warnings` serialized in evidence and index entries for auditability.

Files impacted: `src/inspiredesign/pinterest-pin-media-evidence.ts`.

Acceptance criteria:
- [ ] Only trusted canonical pin media can bypass `interface_chrome_shell`.
- [ ] Search-shell and anti-noise warnings remain blocking.
- [ ] Warnings stay visible in serialized output.
- [ ] No downloader or fetch path is added.

## Task 10 - Reconcile Reference-Pattern Warning Checks If Needed

Reasoning: `reference-pattern-board.ts` can re-check pin-media blocking warnings after evidence classification.

What to do: Ensure ranking uses the same authority-scoped warning decision.

How:
1. Run the reference-board tests after Task 9.
2. If `hasPinMediaReadyPinterestEvidence` still fails only because it calls `hasPinterestPinMediaBlockingWarning`, add an exported authority-scoped helper from `pinterest-pin-media-evidence.ts`.
3. Prefer a name that expresses scope, for example `hasPinterestPinMediaAuthorityBlockingWarning`.
4. Ensure the helper supports the shape used by persisted evidence without accepting serialized forged evidence.
5. Use that helper only for persisted pin-media authority checks in `reference-pattern-board.ts`.
6. Keep screenshot warning checks strict.
7. Keep generic diagnostic warning checks strict.

Files impacted: `src/inspiredesign/pinterest-pin-media-evidence.ts`, `src/inspiredesign/reference-pattern-board.ts` only if tests require it.

Acceptance criteria:
- [ ] Reference board ranks trusted canonical pin media as `pin_media_ready`.
- [ ] Screenshot-only chrome warnings remain blocked.
- [ ] Search-shell diagnostics remain blocked.

## Task 11 - Reconcile Product-Readiness Warning Checks If Needed

Reasoning: `product-readiness.ts` can re-check pin-media warnings on `pin-media-index.json` entries.

What to do: Ensure product readiness uses the same authority-scoped warning decision without weakening index requirements.

How:
1. Run workflow and product-readiness tests after Task 9.
2. If final output remains `diagnostic_only` only because `hasBlockingPinMediaArtifactWarning` sees `interface_chrome_shell`, update product readiness to use the authority-scoped helper.
3. Ensure the helper supports the `pin-media-index.json` entry shape without accepting raw unindexed metadata.
4. Keep validation index-driven.
5. Keep all path, hash, bytes, dimensions, content type, source URL, media URL, and provenance checks unchanged.
6. Do not accept remote-media-only evidence.

Files impacted: `src/inspiredesign/product-readiness.ts` only if tests require it; `src/inspiredesign/pinterest-pin-media-evidence.ts` if exporting a helper.

Acceptance criteria:
- [ ] `pin_media_ready` counts only index-backed authoritative artifacts.
- [ ] `interface_chrome_shell` does not block trusted canonical pin media.
- [ ] All other warning blockers remain fatal.

## Task 12 - Run Targeted Tests

Reasoning: The behavior spans evidence classification, ranking, workflow finalization, discovery, and browser capture.

What to do: Run focused tests before full quality gates.

How:
1. Run `npm run test -- tests/inspiredesign-pinterest-pin-media-evidence.test.ts`.
2. Run `npm run test -- tests/inspiredesign-visual-harvest.test.ts`.
3. Run `npm run test -- tests/providers-inspiredesign-workflow.test.ts`.
4. Run `npm run test -- tests/pinterest-guidance-recipe.test.ts`.
5. Run `npm run test -- tests/browser-manager.test.ts`.

Files impacted: none.

Acceptance criteria:
- [ ] All targeted tests pass.
- [ ] Search-shell tests remain green.
- [ ] BrowserManager tests prove no downloader regression.
- [ ] No suppressions are added.

## Task 13 - Run Real Explicit Canonical Pin Workflow Validation

Reasoning: Mocked tests must be backed by a real explicit-pin harvest.

What to do: Validate with the local checkout binary and an explicit canonical Pinterest pin URL.

How:
1. Build the checkout with `npm run build`.
2. Ensure the running daemon is from the checkout, not `npx` or the global install.
3. Verify daemon status with `node ./dist/cli/index.js status --daemon --output-format json` and require `fingerprintCurrent:true`.
4. Use extension mode and a user-authorized Pinterest session if cookies are required.
5. Run inspiredesign harvest with an explicit canonical URL such as `https://www.pinterest.com/pin/944207878113675397/`.
6. Inspect the generated artifact bundle.
7. Verify `productSuccess=true`.
8. Verify `artifactAuthority=product_ready`.
9. Verify `evidenceAuthority=pin_media_ready`.
10. Verify `pin-media-index.json` has at least one entry satisfying the existing pin-media index contract.
11. Verify `pin-media-evidence/<ref>/main.jpg` exists.
12. Verify emitted file bytes match the indexed hash and metadata.
13. Verify `sourceUrl` canonicalizes to the requested pin URL.
14. Verify no search-shell discovery URL was promoted.

Files impacted: runtime artifacts only.

Acceptance criteria:
- [ ] A real explicit canonical pin becomes product-ready.
- [ ] The result is index-backed and byte-backed.
- [ ] Search-shell regression is absent.
- [ ] The command uses `node ./dist/cli/index.js`, not `npx`.

## Task 14 - Run Full Quality Gates

Reasoning: Readiness logic is cross-cutting and must pass the repository gate.

What to do: Run the repository's actual quality commands.

How:
1. Run formatter or format-check command if configured.
2. Run `npm run lint`.
3. Run the type checker command if separate from build.
4. Run `npm run test`.
5. Confirm coverage remains above the repository threshold.
6. Run `npm run build`.
7. Fix failures without suppressions.

Files impacted: none unless fixes are required.

Acceptance criteria:
- [ ] Formatter or format check passes, or the absence of a configured formatter is recorded.
- [ ] Linter passes with zero warnings.
- [ ] Type checker passes.
- [ ] Tests pass.
- [ ] Coverage passes.
- [ ] Build passes.

## Task 15 - Update Documentation and Closeout Notes

Reasoning: This issue is subtle and future agents need the exact authority rule.

What to do: Update implementation-adjacent documentation only if the behavior or guidance text changes.

How:
1. If public behavior changes are visible, update `docs/CLI.md`, `docs/SURFACE_REFERENCE.md`, and `src/public-surface/source.ts` together.
2. Keep the wording clear that remote media URLs alone are not product-ready.
3. Add a `Validation Results` section to this plan after implementation.
4. Record targeted test commands and outcomes.
5. Record the real workflow artifact path.
6. Record the root cause of `missing_trusted_byte_inspection`.
7. Record that no duplicate downloader was added.
8. Record that search-shell discovery remains blocked.

Files impacted: `docs/plans/pinterest-pin-media-readiness-fix-2026-06-06.md`; conditionally `docs/CLI.md`, `docs/SURFACE_REFERENCE.md`, `src/public-surface/source.ts`, generated public-surface outputs, and related tests.

Acceptance criteria:
- [ ] The plan contains final validation evidence.
- [ ] Docs remain aligned if public behavior wording changes.
- [ ] The final note identifies the minimal source seam changed.
- [ ] The final note confirms anti-noise gates are preserved.

## Explicit Non-Goals

- Do not add a duplicate image downloader.
- Do not make Pinterest search-shell discovery acceptable.
- Do not accept boards, profiles, source pages, related pins, promoted media, ads, or noisy candidates.
- Do not accept remote-media-only evidence.
- Do not accept forged or JSON-round-tripped design evidence without trusted bytes.
- Do not weaken screenshot chrome warning gates.
- Do not proceed to static HTML design prototypes until Pinterest references are genuinely `pin_media_ready`, `snapshot_ready`, or `motion_ready`.

## Open Questions

- The implementation must validate whether `missing_trusted_byte_inspection` in the observed bundle came from temp-path finalization failure or from reserializing diagnostic metadata after byte inspection had already occurred. This does not block the plan, but it determines whether Task 9 alone is enough or whether a finalization/serialization fix is also required.

## Version History

- 2026-06-06: Initial validation-first plan created on branch `codex/pinterest-pin-media-readiness-fix`.
