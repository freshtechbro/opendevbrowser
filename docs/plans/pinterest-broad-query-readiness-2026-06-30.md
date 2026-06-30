# Pinterest Inspiredesign Broad-Query Readiness Implementation Plan

## Goal

Deliver a focused implementation path that makes broad Pinterest Inspiredesign query harvests product-ready when they discover and capture concrete canonical pins, while preserving the current strict authority model.

Success means four fresh broad Pinterest query harvests, for landing pages, design components, motion designs, and digital products, each prove these fields from saved artifacts:

- `ready=true`
- `productSuccess=true`
- `artifactAuthority=product_ready`
- `evidenceAuthority=pin_media_ready`
- `nextStepGuidance.readiness=ready`

The implementation must also persist actionable discovery diagnostics, distinguish login or challenge blockers from search-shell blockers, clarify visual, screenshot, and motion evidence after pin-media success, and keep `pin-media-index.json` as Pinterest readiness authority.

## Verified facts from current continuity ledgers

- Diagnostic broad-query bundle: `.opendevbrowser/inspiredesign/5be837d6-7209-40a3-94d9-a62cceba279f`.
  - `ready=false`, `productSuccess=false`, `artifactAuthority=diagnostic_only`, `evidenceAuthority=diagnostic_only`.
  - `ranked-references.json` has zero references.
  - `pin-media-index.json`, `screenshot-index.json`, `motion-evidence.json`, and `media-analysis.json` carry no usable reference evidence.
  - The bundle does not persist enough discovery diagnostics to explain accepted URL count, rejected URL count, source page quality, blocker type, search-shell evidence, or login/challenge status.
- Product-ready canonical-pin recovery bundle: `.opendevbrowser/inspiredesign/90c3386f-65c3-4bd9-acdf-4693d84e47d7`.
  - `ready=true`, `productSuccess=true`, `artifactAuthority=product_ready`, `evidenceAuthority=pin_media_ready`.
  - `nextStepGuidance.readiness=ready`, reason code `design_ready`.
  - `pin-media-index.json` has one first-party image item for `https://www.pinterest.com/pin/1103522714969809752`.
  - Local media path `pin-media-evidence/b718968ff8b0/main.jpg` has `117326` bytes and sha256 `26ef38a19f55e08211ab6a88d159bc38a06e673a1fee9865d8aa3d5a0c517ff0`.
  - First-party provenance is true for canonical reference URL, source URL match, and Pinterest media URL.
  - Non-blocking caveats remain: screenshot lane failed, `screenshot-index.json` is empty, and `motion-evidence.json` is empty.
- Current source behavior:
  - `src/providers/browser-native-discovery.ts` only accepts canonical Pinterest `/pin/<id>/` URLs and treats login/challenge and chrome-only pages as strict blockers.
  - Search shell extraction is allowed only when there is search-result context plus rendered canonical pin link evidence.
  - `src/providers/workflows.ts` carries `browserNativeDiagnostics` in memory, but bundle artifacts do not expose them clearly enough for closeout.
  - Pinterest pin-media authority is already strict in `src/inspiredesign/product-readiness.ts` and `src/inspiredesign/reference-pattern-board.ts`.
  - Visual capture currently runs only for visual-first Pinterest strategy, and motion capture only for motion-first strategy. A successful pin-media capture can therefore produce product-ready authority with empty screenshot and motion lanes.

## Non-goals

- Do not make login, challenge, account, settings, or chrome-only Pinterest pages product-ready.
- Do not treat `media-analysis.json`, screenshot metadata, or browser motion evidence as substitutes for `pin-media-index.json`.
- Do not add hidden feature flags, phased rollouts, fallback product-ready semantics, or broad backward compatibility paths.
- Do not relax canonical Pinterest URL validation.
- Do not claim OCR, exact text extraction, font identification, or browser replay authority from still pin media.

## Scenario inventory

1. Broad Pinterest query returns a login or challenge wall with no accepted canonical pins.
2. Broad Pinterest query returns a search shell with no rendered canonical pin links.
3. Broad Pinterest query returns a search shell with rendered canonical pin links.
4. Broad Pinterest query returns mixed search results, board URLs, idea URLs, account URLs, stale embedded pins, and canonical pins.
5. Query-discovered canonical pin has valid first-party pin-media bytes.
6. Query-discovered canonical pin has invalid, missing, or non-first-party pin-media bytes.
7. Valid pin-media capture succeeds while screenshot capture is skipped, fails, or times out.
8. Valid still-image pin media succeeds while browser motion evidence is not applicable.
9. GIF or video pin media succeeds and media analysis can produce advisory motion facts without replacing `motion-evidence.json` authority.
10. Final handoff, renderer, docs, public surface, and skill guidance must all explain the same readiness authority model.

## Dependency map

- `src/providers/browser-native-discovery.ts` owns browser-native search diagnostics, hard blocker classification, canonical URL acceptance, and recovery action text.
- `src/inspiredesign/pinterest-media-classification.ts` owns Pinterest media kind, source page quality, blocker reason codes, and primary capture strategy.
- `src/providers/workflows.ts` owns query discovery, URL merge, capture ordering, persisted artifact assembly, meta generation, and final workflow response.
- `src/inspiredesign/product-readiness.ts` owns user-facing product success fields and final evidence authority.
- `src/inspiredesign/reference-pattern-board.ts` owns ranked reference authority, captured-via labels, visual strengths, visual risks, and selection reasons.
- Renderer and handoff surfaces own human-facing caveat language and Canvas continuation guidance.
- `src/public-surface/source.ts` is the public-surface source of truth. Generated manifests must be regenerated, not hand-edited.
- `docs/CLI.md`, `docs/SURFACE_REFERENCE.md`, and `skills/opendevbrowser-best-practices/SKILL.md` must stay aligned with runtime behavior.

## File-by-file implementation sequence

1. `src/providers/browser-native-discovery.ts`
   - Add a sanitized, serializable discovery diagnostics contract.
   - Preserve strict blocking for login/challenge and chrome-only pages.
   - Keep search-shell extraction limited to record-local rendered canonical pin evidence.
2. `src/inspiredesign/pinterest-media-classification.ts`
   - Add or tighten reason codes needed by diagnostics and guidance.
   - Clarify still-image, GIF/video, unknown pin, search-shell, login/challenge, and chrome-only semantics.
3. `src/providers/workflows.ts`
   - Persist discovery diagnostics into bundle artifacts and workflow meta.
   - Merge query-discovered canonical pin provenance into per-reference capture context.
   - Add bounded screenshot attempt or explicit screenshot-attempt diagnostics after pin-media success when visual evidence is required.
   - Persist still-image motion clarity after successful image pin media.
4. `src/inspiredesign/reference-pattern-board.ts`
   - Update ranked-reference wording so valid pin-media evidence yields conservative visual strengths and explicit screenshot or motion caveats.
   - Remove misleading text such as no live reference cues when pin-media authority is present.
5. `src/inspiredesign/product-readiness.ts`
   - Preserve current strict authority rules.
   - Add focused tests before changing logic. Only edit if the new diagnostics require derived count or guidance consistency changes.
6. Renderer and handoff surfaces, if needed.
   - Align `advanced-brief.md`, `design-agent-handoff.json`, `generation-plan.json`, and `meta-prompt.md` wording with the authority model.
7. Tests.
   - Add failing tests before production edits for each changed branch.
8. `src/public-surface/source.ts`.
   - Update public examples and readiness notes after runtime behavior is stable.
9. `src/public-surface/generated-manifest.ts` and `src/public-surface/generated-manifest.json`.
   - Regenerate with `node scripts/generate-public-surface-manifest.mjs`.
10. `docs/CLI.md`, `docs/SURFACE_REFERENCE.md`, `skills/opendevbrowser-best-practices/SKILL.md`.
   - Update after source and tests are stable.
11. Review, real workflow proof, full gates, atomic commits, PR, and post-merge verification.

## Task 1 - Persist Pinterest discovery diagnostics

Reasoning: The current diagnostic broad-query bundle proves failure but does not explain why the broad query failed or how to recover. Operators need persisted discovery evidence that is safe, bounded, and actionable.

What to do: Persist a sanitized discovery diagnostics artifact and mirror critical fields into workflow meta.

How:
1. Define a compact diagnostics shape for Inspiredesign discovery output.
2. Include `requested`, `query`, `providers`, `siteRecipeId`, `searchUrl`, `fetchedRecordCount`, `acceptedUrls`, accepted URL count, rejected URL count, failure count, primary reason, source page quality, bad state id, diagnostic blockers, and recovery action.
3. Include rejected URL entries only as normalized URLs, reason code, source, provider, and rank when already available.
4. Include failure entries only as provider, source, reason code, retryable, and sanitized message.
5. Exclude raw HTML, cookies, tokens, private account text, full profile paths, and full page content.
6. Write `discovery-diagnostics.json` for every query harvest bundle.
7. Mirror a small summary into `meta.discovery` and `evidence.json` so product readiness can be audited without opening every artifact.
8. Add `bundle-manifest.json` entry for the new artifact.

Files impacted:
- `src/providers/workflows.ts`
- `src/providers/browser-native-discovery.ts`
- `tests/providers-inspiredesign-workflow.test.ts`
- `tests/providers-workflows-branches.test.ts` if branch deficit needs dense workflow coverage

Acceptance criteria:
- [ ] Broad-query diagnostic bundle persists `discovery-diagnostics.json`.
- [ ] Diagnostic artifact distinguishes zero accepted URLs from product-ready rejection.
- [ ] Diagnostic artifact contains no raw HTML, cookies, tokens, account identifiers, or excessive page text.
- [ ] `bundle-manifest.json` lists `discovery-diagnostics.json`.
- [ ] Existing product-ready canonical-pin bundles also include diagnostics when query discovery was requested.

Atomic commit milestone: `fix: persist pinterest discovery diagnostics`

## Task 2 - Clarify login/challenge vs search-shell guidance

Reasoning: Login or challenge blockers require authenticated extension recovery, while search-shell blockers require concrete rendered pin discovery. The workflow must not blur these paths.

What to do: Make recovery guidance and reason codes precise for each blocked broad-query state.

How:
1. Keep login/challenge and chrome-only extraction as strict blockers in `src/providers/browser-native-discovery.ts`.
2. Keep search-shell extraction soft only when record-local rendered canonical pin link evidence exists.
3. Add diagnostic reason codes that separate `login_or_challenge_blocks_reference_extraction`, `search_shell_without_rendered_pin_links`, `chrome_only_blocks_reference_extraction`, and `noncanonical_pinterest_reference_rejected` if not already represented.
4. In diagnostics, map login/challenge to authenticated extension recovery guidance.
5. Map search shell with no rendered pins to query refinement, scroll or reload, and canonical pin recovery guidance.
6. Ensure generated `nextStepGuidance` and handoff surfaces do not tell users to continue to Canvas when these blockers remain active.

Files impacted:
- `src/providers/browser-native-discovery.ts`
- `src/inspiredesign/pinterest-media-classification.ts`
- `src/providers/workflows.ts`
- `tests/pinterest-guidance-recipe.test.ts`
- `tests/providers-inspiredesign-workflow.test.ts`

Acceptance criteria:
- [ ] Login/challenge broad-query failure has `reason=auth_required` or equivalent authenticated recovery reason.
- [ ] Search-shell broad-query failure has search-shell-specific reason and recovery text.
- [ ] Search shell with rendered canonical pin link still accepts only normalized canonical `/pin/<id>/` URLs.
- [ ] Chrome, account, settings, board-only, and idea-only records cannot be promoted through stale pin links.
- [ ] No diagnostic-only bundle returns `nextStepGuidance.readiness=ready`.

Atomic commit milestone: include with Task 1 unless the diff is large. If separate, use `fix: clarify pinterest discovery recovery guidance`.

## Task 3 - Preserve query-discovered canonical pin provenance

Reasoning: Broad queries should become product-ready through the same strict canonical pin-media authority as explicit pin recovery, not through weak search-page evidence.

What to do: Carry discovery provenance from query extraction into the per-reference capture and final artifact model.

How:
1. When `discoverInspiredesignReferences()` accepts canonical pins, carry sanitized discovery attributes into the workflow reference context.
2. Mark query-discovered canonical pins with `discoveryMode=browser_native_extracted_reference` and `sourcePageQuality` from the source record.
3. Preserve accepted URL normalization so every workflow URL is `https://www.pinterest.com/pin/<id>/` where possible.
4. Do not preserve noncanonical search, board, idea, account, or settings pages as product references.
5. Ensure pin-media capture sees the canonical URL and can produce `pinterestPageQuality=pin_media` after successful capture.
6. Add tests that use mocked discovery plus mocked pin-media capture to prove broad query can flow to product-ready authority.

Files impacted:
- `src/providers/workflows.ts`
- `src/providers/browser-native-discovery.ts`
- `src/inspiredesign/pinterest-media-classification.ts` if provenance needs classification mapping
- `tests/providers-inspiredesign-workflow.test.ts`
- `tests/pinterest-guidance-recipe.test.ts`

Acceptance criteria:
- [ ] Query-discovered canonical pin references can reach `pin-media-index.json` through the normal capture path.
- [ ] Product-ready output still requires valid first-party local media bytes.
- [ ] Invalid pin-media bytes keep `artifactAuthority=diagnostic_only` and `evidenceAuthority=diagnostic_only`.
- [ ] Accepted URL provenance is visible enough in diagnostics to explain how broad query became a canonical pin harvest.

Atomic commit milestone: `fix: carry pinterest query pin provenance`

## Task 4 - Add screenshot fallback or explicit screenshot-attempt metadata after pin-media success

Reasoning: `--visual-evidence required` currently can end with valid pin-media product readiness but an empty screenshot index and generic visual failure. The product-ready result is valid, but the artifact story is confusing.

What to do: After successful pin-media capture for a canonical Pinterest pin and visual evidence is required, attempt bounded screenshot capture when safe, or persist explicit screenshot-attempt diagnostics when capture is skipped or fails.

How:
1. In `src/providers/workflows.ts`, detect successful `pinMedia` evidence before final visual artifact collation.
2. If `workflowInput.visualEvidence === "required"` and no visual artifact exists, attempt one bounded screenshot capture with the remaining reference budget when the page is already in a safe canonical pin context.
3. If screenshot capture succeeds, persist it through the existing visual artifact lane and `screenshot-index.json`.
4. If screenshot capture fails, times out, or is not attempted, persist a structured non-blocking caveat such as `visualEvidenceAfterPinMedia.status=failed|skipped`, reason code, timeout state, and statement that `pin_media_ready` remains the authority.
5. Keep screenshot failure from demoting product readiness when manifest-backed pin-media evidence is valid.
6. Keep login/challenge and search-shell blockers fail-closed before any screenshot attempt.

Files impacted:
- `src/providers/workflows.ts`
- `src/inspiredesign/reference-pattern-board.ts`
- Renderer or handoff surface if the caveat is rendered there
- `tests/providers-inspiredesign-workflow.test.ts`
- `tests/providers-workflows-branches.test.ts`

Acceptance criteria:
- [ ] Valid pin-media plus successful screenshot records both pin-media and screenshot artifacts.
- [ ] Valid pin-media plus screenshot failure remains product-ready and records an explicit non-blocking caveat.
- [ ] Screenshot failure cannot hide or replace `pin-media-index.json` authority.
- [ ] Blocked search/login/challenge pages do not trigger screenshot fallback.
- [ ] Handoff text says screenshot was unavailable or failed, not that there are no reference cues when pin-media bytes exist.

Atomic commit milestone: `fix: clarify pinterest visual evidence after pin media`

## Task 5 - Clarify still-image motion semantics

Reasoning: Still Pinterest images can provide design direction and advisory media-analysis facts, but empty `motion-evidence.json` currently looks ambiguous. Motion evidence authority must remain browser replay authority only.

What to do: Persist and render clear motion applicability metadata for still-image pin media.

How:
1. Detect pin-media kind `image` and write a clear still-image motion status in the workflow evidence or handoff surface.
2. Use wording such as `motionCapture.status=not_applicable` and `reason=still_image_pin_media` when browser motion capture is not expected.
3. For GIF or video pin media, keep media-analysis motion facts advisory and separate from `motion-evidence.json` browser replay authority.
4. Ensure `motion-evidence.json` remains empty or non-authoritative unless browser replay evidence was captured.
5. Update `reference-pattern-board` output so motion posture can suggest implementation motion patterns from the brief and media facts without claiming observed browser choreography.

Files impacted:
- `src/providers/workflows.ts`
- `src/inspiredesign/reference-pattern-board.ts`
- Renderer or handoff surface if needed
- `tests/providers-inspiredesign-workflow.test.ts`
- `tests/media-analysis-dependency-guidance.test.ts` if public wording changes

Acceptance criteria:
- [ ] Still-image pin media product-ready bundles clearly state browser motion was not applicable or not captured.
- [ ] Empty `motion-evidence.json` is not presented as missing product authority for still-image pin media.
- [ ] GIF or video advisory facts from `media-analysis.json` cannot set `evidenceAuthority=motion_ready`.
- [ ] Motion guidance remains useful for implementation, but does not claim measured browser motion unless `motion-evidence.json` exists.

Atomic commit milestone: include with Task 4 if code paths are adjacent. If separate, use `fix: clarify pinterest still-image motion evidence`.

## Task 6 - Preserve product-readiness authority and counts

Reasoning: The current strict product-readiness model is correct. The implementation should make broad queries feed the authority model, not weaken the model.

What to do: Add tests around existing readiness rules and change production logic only if diagnostics or count fields expose a real inconsistency.

How:
1. Add or update tests proving product success requires ready guidance, ranked references, coherent counts, and artifact-backed Pinterest authority.
2. Prove `pin_media_ready` wins final evidence authority only when product success is true and at least one pin-media-ready reference exists.
3. Prove missing screenshot blockers are inactive when valid pin-media authority exists.
4. Prove invalid pin-media or non-first-party media keeps product success false.
5. Avoid editing `src/inspiredesign/product-readiness.ts` unless a failing test proves a real bug.

Files impacted:
- `src/inspiredesign/product-readiness.ts` only if needed
- `src/inspiredesign/reference-pattern-board.ts` if rank or caveat wording changes
- `tests/providers-inspiredesign-workflow.test.ts`
- Existing readiness tests if present

Acceptance criteria:
- [ ] The canonical-pin product-ready bundle shape remains product-ready under tests.
- [ ] Diagnostic-only broad-query failure remains diagnostic-only under tests.
- [ ] No snapshot, screenshot, media-analysis, or motion advisory surface can replace first-party pin-media authority for Pinterest readiness.

Atomic commit milestone: `test: lock pinterest pin media readiness authority` if test-only, or combine with nearest implementation commit if production logic changes.

## Task 7 - Align renderer, handoff, and generated artifact wording

Reasoning: Product-ready bundles should give agents useful instructions without over-claiming screenshot or motion evidence.

What to do: Update human-facing and machine-facing surfaces to communicate product-ready pin-media authority, screenshot caveats, and still-image motion clarity.

How:
1. Inspect current writers for `advanced-brief.md`, `design.md`, `design-contract.json`, `design-agent-handoff.json`, `generation-plan.json`, `implementation-plan.md`, `implementation-plan.json`, `meta-prompt.md`, and `canvas-plan.request.json`.
2. Update only the surfaces that currently produce misleading or incomplete wording.
3. Ensure generated copy says valid local Pinterest media exists when `pin-media-index.json` proves it.
4. Ensure screenshot caveats are separate from product readiness and list exact reason codes.
5. Ensure still-image media cannot be described as observed page motion.
6. Keep `canvas-plan.request.json` free of raw `mediaAnalysis` and large evidence payloads.

Files impacted:
- `src/providers/renderer.ts` if it owns markdown or response rendering
- `src/providers/workflows.ts` if it owns meta or handoff assembly
- `src/inspiredesign/reference-pattern-board.ts`
- `tests/providers-inspiredesign-workflow.test.ts`
- Renderer tests if present

Acceptance criteria:
- [ ] Product-ready handoff references saved pin-media authority and local artifact path.
- [ ] Handoff no longer says no live reference cues when pin-media authority exists.
- [ ] Screenshot and motion caveats are explicit, non-blocking, and reason-coded.
- [ ] Canvas continuation is recommended only when product-ready fields are true.

Atomic commit milestone: include with Task 4 or Task 5 unless the renderer diff is large. If separate, use `fix: align pinterest inspiredesign handoff wording`.

## Task 8 - Update docs, public surface, generated manifests, and skill guidance

Reasoning: Workflow behavior changes must be reflected in source-of-truth docs and agent-facing skill guidance in the same pass.

What to do: Update public and skill guidance after implementation and tests are stable.

How:
1. Edit `src/public-surface/source.ts` first.
2. Regenerate `src/public-surface/generated-manifest.ts` and `src/public-surface/generated-manifest.json` with `node scripts/generate-public-surface-manifest.mjs`.
3. Update `docs/CLI.md` Inspiredesign Pinterest guidance.
4. Update `docs/SURFACE_REFERENCE.md` compact public-surface wording.
5. Update `skills/opendevbrowser-best-practices/SKILL.md` Inspiredesign validated capability lane.
6. Keep wording aligned across all surfaces:
   - Broad query harvests may become product-ready only through query-discovered canonical pins plus first-party pin-media bytes.
   - Login/challenge and search-shell diagnostics are recovery paths, not product-ready evidence.
   - `pin-media-index.json` remains Pinterest product-readiness authority.
   - `media-analysis.json` remains advisory.
   - `motion-evidence.json` remains browser replay authority.
   - Screenshot failure after pin-media success is a non-blocking caveat when pin-media authority is complete.

Files impacted:
- `src/public-surface/source.ts`
- `src/public-surface/generated-manifest.ts`
- `src/public-surface/generated-manifest.json`
- `docs/CLI.md`
- `docs/SURFACE_REFERENCE.md`
- `skills/opendevbrowser-best-practices/SKILL.md`
- `tests/public-surface-manifest.test.ts`
- `tests/media-analysis-dependency-guidance.test.ts`
- `tests/guidance-router.test.ts` if guidance routing snapshots change
- `tests/cli-workflows.test.ts` if CLI examples are asserted

Acceptance criteria:
- [ ] Generated manifests are regenerated and have no unreviewed drift.
- [ ] Public docs and skill guidance do not overstate broad query success.
- [ ] Public docs and skill guidance include recovery guidance for diagnostic-only query failures.
- [ ] Public docs and skill guidance preserve the media-analysis and motion-evidence authority distinction.
- [ ] Docs drift and public-surface tests pass.

Atomic commit milestone: `docs: document pinterest broad-query readiness`.

## Task 9 - Test plan and coverage inventory

Reasoning: The change affects discovery, workflow, readiness, artifact contracts, docs, and live workflow proof. Tests must be added before production changes and branch coverage deficit must be known before full verification.

What to do: Build a focused regression suite before and during implementation.

How:
1. Before adding tests, compute current branch coverage deficit from `coverage/lcov.info` if it exists, or run the smallest accepted coverage command if needed.
2. Add failing tests for diagnostics persistence.
3. Add failing tests for login/challenge versus search-shell guidance.
4. Add failing tests for query-discovered canonical pin product readiness with mocked valid pin-media bytes.
5. Add failing tests for invalid pin-media bytes remaining diagnostic-only.
6. Add tests for screenshot fallback success and screenshot fallback failure caveat.
7. Add tests for still-image motion `not_applicable` or equivalent clarity.
8. Add docs and public-surface tests after wording changes.
9. Recompute branch deficit before the final full `npm run test`.

Primary test targets:
- `tests/pinterest-guidance-recipe.test.ts`
- `tests/providers-inspiredesign-workflow.test.ts`
- `tests/providers-workflows-branches.test.ts`
- `tests/public-surface-manifest.test.ts`
- `tests/media-analysis-dependency-guidance.test.ts`
- `tests/guidance-router.test.ts`
- `tests/cli-workflows.test.ts`

Acceptance criteria:
- [ ] Every new branch has a focused regression.
- [ ] No test weakens existing assertions.
- [ ] No lint, type, coverage, or test suppression is added.
- [ ] Global branch coverage is at least 97 percent before closeout.

Atomic commit milestone: tests should be committed with the implementation they prove unless a pure authority-lock test commit is clearer.

## Task 10 - Real workflow proof requirements

Reasoning: Unit tests cannot prove live Pinterest broad-query readiness. Closeout requires four fresh broad query harvests with artifact inspection.

What to do: Run four fresh broad Pinterest query harvests after implementation, using current daemon and extension readiness.

Preflight:
1. Run `npx opendevbrowser status --daemon --output-format json`.
2. Require `data.fingerprintCurrent === true`.
3. Require `data.relay.extensionConnected === true`.
4. Require `data.relay.extensionHandshakeComplete === true`.
5. If preflight is not current, restart the matching current daemon or isolate the run with unique config/cache roots and ports.
6. Do not conflate daemon fingerprint mismatch with native messaging host drift.

Required harvest categories and commands:

```bash
npx opendevbrowser inspiredesign harvest \
  --brief "Premium AI product landing page with trust and conversion" \
  --query "Pinterest premium AI SaaS product landing page website inspiration" \
  --provider social/pinterest \
  --max-references 5 \
  --visual-evidence required \
  --browser-mode extension \
  --use-cookies \
  --cookie-policy required \
  --challenge-automation-mode browser_with_helper \
  --mode json \
  --output-format json
```

```bash
npx opendevbrowser inspiredesign harvest \
  --brief "High-end design system components for a product dashboard" \
  --query "Pinterest UI design components cards buttons forms dashboard design system" \
  --provider social/pinterest \
  --max-references 5 \
  --visual-evidence required \
  --browser-mode extension \
  --use-cookies \
  --cookie-policy required \
  --challenge-automation-mode browser_with_helper \
  --mode json \
  --output-format json
```

```bash
npx opendevbrowser inspiredesign harvest \
  --brief "Motion design direction for a polished product experience" \
  --query "Pinterest motion design web animation product interface inspiration" \
  --provider social/pinterest \
  --max-references 5 \
  --visual-evidence required \
  --browser-mode extension \
  --use-cookies \
  --cookie-policy required \
  --challenge-automation-mode browser_with_helper \
  --mode json \
  --output-format json
```

```bash
npx opendevbrowser inspiredesign harvest \
  --brief "Premium digital product website and app inspiration" \
  --query "Pinterest digital product website app UI inspiration premium" \
  --provider social/pinterest \
  --max-references 5 \
  --visual-evidence required \
  --browser-mode extension \
  --use-cookies \
  --cookie-policy required \
  --challenge-automation-mode browser_with_helper \
  --mode json \
  --output-format json
```

Artifact inspection requirements for each run:
1. Record the returned `artifact_path`.
2. Inspect `evidence.json`, `ranked-references.json`, `design-agent-handoff.json`, `generation-plan.json`, `pin-media-index.json`, `bundle-manifest.json`, `discovery-diagnostics.json`, `screenshot-index.json`, `motion-evidence.json`, `visual-evidence.json`, and `media-analysis.json` when present.
3. Assert the required fields:
   - `ready=true`
   - `productSuccess=true`
   - `artifactAuthority=product_ready`
   - `evidenceAuthority=pin_media_ready`
   - `nextStepGuidance.readiness=ready`
4. Assert `ranked-references.json` has at least one reference.
5. Assert `pin-media-index.json` has at least one item.
6. For every pin-media item used for authority, assert local file exists, bytes are nonzero, sha256 matches, `mediaUrlFirstParty=true`, `referenceUrlCanonical=true`, `sourceUrlMatchesReference=true`, and `pinterestPageQuality=pin_media`.
7. Assert `discovery-diagnostics.json` explains accepted URLs and any rejected or blocked candidates.
8. Assert screenshot status is either captured with manifest-backed file or explicitly caveated as non-blocking after pin-media success.
9. Assert still-image motion status is clear and does not claim browser motion authority without `motion-evidence.json` replay proof.
10. Save a proof summary under an ignored evidence path such as `.opendevbrowser/inspiredesign-broad-query-readiness/<timestamp>/proof-summary.json`.

Acceptance criteria:
- [ ] All four fresh broad query harvests pass the required readiness assertions.
- [ ] All four proof summaries include artifact paths and sha256 checks for authority media.
- [ ] No run relies on explicit `--url` recovery to satisfy broad-query proof.
- [ ] If a live run fails because Pinterest changes behavior, do not mark complete. Record the diagnostic bundle and fix the implementation or report a real external blocker.

Atomic commit milestone: no commit for ignored evidence. Commit source, tests, and docs before final proof, then append proof notes in PR body.

## Task 11 - Review, fix, workflow, review loop

Reasoning: This change touches high-risk live provider behavior and artifact authority semantics. It needs an adversarial loop scoped to the implemented diff.

What to do: Run a progressive review loop until the scoped diff is commit-ready.

How:
1. After first implementation pass, run focused tests and linters for touched files.
2. Use RepoPrompt review or Oracle review with the current changed files and this plan as context.
3. Fix only scoped review findings.
4. Run the real workflow proof subset needed to validate the fixed area.
5. Repeat review, fix, real workflow proof until no scoped blockers remain.
6. Do one final adversarial review after source, tests, docs, generated manifests, and proof artifacts are complete.
7. Do not expand into unrelated provider, canvas, annotation, or release changes.

Acceptance criteria:
- [ ] At least one adversarial review is completed after implementation.
- [ ] Every review blocker has a fix or an explicit non-blocking rationale.
- [ ] Real workflow proof is rerun after fixes that affect capture, artifacts, or readiness.
- [ ] Final review finds no blockers in the scoped diff.

## Task 12 - Quality gates, atomic commits, PR, and closeout

Reasoning: The final work must be safe to merge and auditable through commits, checks, and PR evidence.

What to do: Run full quality gates, create atomic commits, open PR, monitor checks, review PR, merge only when green, and verify post-merge.

Quality commands:
1. `npm run format --if-present`
2. `npm run lint`
3. `npm run typecheck`
4. `npm run build`
5. `npm run extension:build`
6. `npm run version:check`
7. `npm run test`
8. `node scripts/generate-public-surface-manifest.mjs`
9. Generated manifest diff check with `git diff --exit-code -- src/public-surface/generated-manifest.ts src/public-surface/generated-manifest.json`
10. `node scripts/docs-drift-check.mjs`
11. `git diff --check`
12. Final `git status --short --branch`

Atomic commit sequence:
1. `fix: persist pinterest discovery diagnostics`
   - Discovery diagnostics and recovery guidance.
   - Focused tests for diagnostic artifact and blocker distinction.
2. `fix: carry pinterest query pin authority`
   - Query-discovered canonical pin provenance and product-ready broad-query flow.
   - Focused tests for valid and invalid pin-media authority.
3. `fix: clarify pinterest visual and motion evidence`
   - Screenshot fallback or explicit caveat metadata.
   - Still-image motion clarity and handoff wording.
   - Focused tests for screenshot and motion clarity.
4. `docs: document pinterest broad-query readiness`
   - Public surface source, generated manifests, CLI docs, surface reference, and best-practices skill guidance.
   - Docs and public-surface tests.

Commit rules:
- Each commit must end with `Co-authored-by: Codex <noreply@openai.com>` exactly once.
- Inspect staged diff before every commit.
- Do not stage `CONTINUITY.md`, `sub_continuity.md`, `.opendevbrowser`, `.tmp`, coverage, prompt exports, or unrelated untracked docs.

PR closeout gates:
1. PR description includes summary, tests, real workflow evidence paths, and four broad-query proof summaries.
2. PR checks are all green.
3. Final local status has no tracked changes.
4. Known unrelated untracked docs remain untouched.
5. Final PR-level rereview reports no blockers.
6. Merge only after checks and rereview pass.
7. Post-merge verification confirms merge commit on `main`, required checks pass, and no local tracked diff remains.

Acceptance criteria:
- [ ] Full quality gates pass with zero errors and zero warnings.
- [ ] Global branch coverage is at least 97 percent.
- [ ] Four broad-query live proofs pass and are referenced in PR closeout.
- [ ] Atomic commits are scoped and conventional.
- [ ] PR is reviewed, checks pass, merged, and post-merge verification is recorded.

## Plan version history

- 2026-06-30: Initial plan created from verified `CONTINUITY.md`, `sub_continuity.md`, read-only source probes, and artifact spot checks. Scope is plan-only and does not implement source, test, or docs behavior changes.
