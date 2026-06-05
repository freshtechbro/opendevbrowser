# Investigation: inspiredesign harvest readiness and Pinterest evidence quality

Date: 2026-05-22

Branch: `codex/pinterest-fashion-studio-harvest-eval`

## Summary

`inspiredesign harvest` is completing operationally, but the product result is correctly non-ready: Pinterest evidence is diagnostic-only, no references are ranked, and Canvas continuation is blocked. The root issue is not one bug but a contract gap: readiness, visual failure accounting, Pinterest candidate provenance, diagnostic artifact authority, and several Canvas command contracts are split across surfaces in ways that make a failed design harvest look more actionable than it is.

## Symptoms

- The harvest command exited `0` and returned `success:true`, but the product readiness state was `diagnostic_only`.
- Pinterest discovery found pin URLs, but `rankedReferenceCount` was `0` and all candidates were rejected.
- `ranked-references.json` reported `failedCaptureCount: 0` and `missingScreenshotCount: 0` even though `visual-evidence.json` contained required visual evidence failures.
- The generated handoff blocked Canvas continuation, but the diagnostic bundle still contained substantial design artifacts that could mislead downstream agents.
- Explicit URL recovery retried weak candidates and did not improve readiness.
- Canvas preview, plan validation, feedback polling, and HTML export each exposed separate guidance or contract issues.

## Background / Prior Research

- Prior implementation memory confirms Pinterest is intentionally the first provider for this workflow family, with browser-native logged-in navigation, natural Pinterest search, and motion references treated as first-class requirements.
- Evaluation report: `docs/investigations/pinterest-fashion-studio-harvest-canvas-evaluation-2026-05-22.md`.
- Query harvest artifact root: `.opendevbrowser/tool-evaluation/fashion-studio-motion/harvest-query/inspiredesign/c7c0caa4-7f1f-40e9-800f-be4989388025`.
- Explicit URL recovery artifact root: `.opendevbrowser/tool-evaluation/fashion-studio-motion/harvest-url-recovery/inspiredesign/59a7b86b-4cf3-4b37-8023-4555b54207ca`.
- Canvas prototype evidence exists, but it is intentionally brief-led because Pinterest harvest evidence was not ready.

## Investigator Findings

### Scope and evidence base

- Investigation only. No source fixes were implemented.
- Oracle planning context was read from `prompt-exports/oracle-question-2026-05-22-170948-harvest-readiness-44-7180.md`.
- Local artifact spot-checks confirmed both query and explicit URL recovery runs have `ranked-references.json` with `rankedReferenceCount: 0`, `rejectedReferenceCount: 4`, `failedCaptureCount: 0`, and `missingScreenshotCount: 0`, while `visual-evidence.json` has four visual entries with statuses `captured`, `failed`, `captured`, `failed` and failures `Required visual evidence was not captured.`.
- Artifact roots checked:
  - `.opendevbrowser/tool-evaluation/fashion-studio-motion/harvest-query/inspiredesign/c7c0caa4-7f1f-40e9-800f-be4989388025`
  - `.opendevbrowser/tool-evaluation/fashion-studio-motion/harvest-url-recovery/inspiredesign/59a7b86b-4cf3-4b37-8023-4555b54207ca`

### 1. CLI and tool success semantics

**Conclusion:** Confirmed. Top-level CLI `success: true` is command and daemon-call success, not product readiness. Product readiness is nested under `meta.nextStepGuidance.readiness`, with some richer render modes also exposing `nextStepGuidance` at the response level.

Evidence:

- `src/cli/daemon-client.ts:438-445` throws when the daemon response has `payload.ok === false`, then returns `payload.data` when the daemon call succeeds.
- `src/cli/commands/inspiredesign.ts:51-58` reads readiness only from `data.meta.nextStepGuidance.readiness`.
- `src/cli/commands/inspiredesign.ts:61-65` appends `readiness=<value>` to the human message when that nested readiness exists.
- `src/cli/commands/inspiredesign.ts:335-349` sends `inspiredesign.run` to the daemon and stores the payload in `data`.
- `src/cli/commands/inspiredesign.ts:351-355` always returns `{ success: true, message, data }` after `callDaemon()` completes.
- `src/tools/inspiredesign_run.ts:85-111` runs `runInspiredesignWorkflow()` and returns `ok(result)` without promoting readiness.
- `src/tools/response.ts:10-14` defines `ok(data)` as JSON with `{ ok: true, ...data }`, so direct tool `ok: true` is wrapper success.
- `src/providers/workflows.ts:4464-4483` builds `nextStepGuidance`, stores it in `metaWithGuidance.nextStepGuidance`, and passes it into rendering.
- `src/providers/renderer.ts:969-977` includes top-level `nextStepGuidance` in JSON mode, but `src/providers/renderer.ts:1019-1027` path mode returns `mode: "path"`, handoff fields, capture attempt fields, and `meta`, so readiness is primarily under `meta.nextStepGuidance` in the default harvest path response.

Eliminated hypothesis:

- This is not a process failure hidden by the CLI. The daemon client throws on failed daemon responses before the CLI returns `success: true` (`src/cli/daemon-client.ts:438-445`).

Recommended fix locations:

- `src/cli/commands/inspiredesign.ts`: keep `success` as transport success if desired, but add top-level machine-readable `ready` and `readiness` derived from `meta.nextStepGuidance.readiness`.
- `src/tools/inspiredesign_run.ts`: wrap or augment the tool result with the same top-level readiness fields before `ok(result)`.

### 2. Visual evidence failures versus ranked reference counters

**Conclusion:** Confirmed. The mismatch is a scope mismatch. `visual-evidence.json` is built from all references with visual metadata, while `ranked-references.json` quality counters are computed from ranked or design-facing references. When all failed or diagnostic references are rejected before ranking, the visual evidence ledger can show failures while ranked counters remain zero.

Evidence:

- `src/providers/workflows.ts:2254-2263` constructs failed required visual metadata with `status: "failed"`, warning `required_visual_evidence_missing`, and the failure string.
- `src/providers/workflows.ts:2270-2276` returns a required visual failure when visual evidence is missing or non-captured.
- `src/providers/workflows.ts:2429-2453` marks the capture failed when required visual evidence is missing, even if other capture artifacts existed.
- `src/inspiredesign/contract.ts:2097-2104` builds `visualEvidence` and `screenshotIndex` from all `references`, independent of ranking.
- `src/inspiredesign/contract.ts:2106-2115` includes any reference whose normalized capture has `visual` metadata, including failed visual evidence.
- `src/inspiredesign/reference-pattern-board.ts:870-879` builds `failedCaptureCount` and `missingScreenshotCount` only from `rankedReferences`, not from all attempted references.
- `src/inspiredesign/reference-pattern-board.ts:967-990` narrows the design-facing board to design references and hardcodes `failedCaptureCount: 0`.
- `src/providers/workflows.ts:2959-2968` copies `quality.failedCaptureCount` and `quality.missingScreenshotCount` into guidance metrics, so the readiness router receives the narrowed counts.
- `src/providers/workflows.ts:4497-4502` passes `buildInspiredesignRankedArtifactPatternBoard(packet.generationPlan.referencePatternBoard, packet.referencePatternBoard)` into the renderer for the ranked artifact.
- `src/providers/renderer.ts:855-861` writes `ranked-references.json` from the renderer `referencePatternBoard.qualitySummary`, while `src/providers/renderer.ts:938-941` writes `visual-evidence.json` separately from `visualEvidence`.
- `tests/providers-inspiredesign-workflow.test.ts:2236-2320` codifies the Pinterest diagnostic case: accepted pin URLs, `readiness: "diagnostic_only"`, zero ranked references, rejected interface-chrome references, screenshot index entries, blocked Canvas continuation, and URL recovery command shape.
- `tests/providers-inspiredesign-contract.test.ts:1354-1389` asserts chrome-only Pinterest references produce `rankedReferences: []`, brief-only source priority, and `missingScreenshotCount: 0`, proving this behavior is expected by current tests.

Eliminated hypotheses:

- Required visual failures are not dropped from `visual-evidence.json`; they are persisted from reference capture metadata (`src/inspiredesign/contract.ts:2106-2115`).
- The renderer is not the place that loses visual failures; it writes both artifacts from separate inputs (`src/providers/renderer.ts:855-861`, `src/providers/renderer.ts:938-941`).
- The mismatch is not caused by missing screenshot-index rows alone. `screenshot-index.json` intentionally includes only captured visual entries (`src/inspiredesign/contract.ts:2117-2135`).

Recommended fix locations:

- `src/inspiredesign/reference-pattern-board.ts`: compute source-level `failedCaptureCount` and `missingScreenshotCount` across all attempted references, or add separately named source-level counters so `ranked-references.json` cannot imply no visual failures occurred.
- `src/providers/workflows.ts`: pass all-attempt visual failure metrics into `buildInspiredesignGuidanceSource()` so guidance can choose `failed_capture` when required visual evidence failed, even if ranked references are empty.
- `tests/providers-inspiredesign-contract.test.ts` and `tests/providers-inspiredesign-workflow.test.ts`: update or add cases where all references are rejected but visual failures still appear in quality metrics.

### 3. Pinterest discovery, classification, and recovery loop

**Conclusion:** Confirmed. Pinterest canonical URL extraction accepts pin, idea, and board URLs from search records, links, content, or HTML. Search-shell bad states are not fatal if extraction succeeds, so weak pin candidates can enter the capture phase. Later evidence classification rejects interface chrome and shell evidence. Recovery can then reuse the same weak URLs because guidance dedupes current URLs and accepted discovery URLs and generic Pinterest recovery emits explicit `--url` commands when canonical URLs are present.

Evidence:

- `src/guidance/recipes/pinterest.ts:90-128` accepts Pinterest hosts and canonical pin, idea, and board path shapes, then strips query and hash.
- `src/guidance/recipes/pinterest.ts:144-150` extracts Pinterest URLs from candidate URL, links, content, and HTML.
- `src/guidance/recipes/pinterest.ts:155-181` defines the Pinterest site recipe, including bad states for login, challenge, and `search-shell`, with recovery guidance to open concrete pins, boards, or idea pages before capture.
- `src/providers/browser-native-discovery.ts:75-78` excludes `search-shell` from `pre_extraction` bad-state blocking. In authenticated mode this means search-shell is not a blocker before URL extraction.
- `src/providers/browser-native-discovery.ts:315-329` checks hard failures and pre-extraction bad states before extraction, then only checks `findBadState(..., "all")` after extraction returns zero URLs.
- `src/providers/browser-native-discovery.ts:374-386` returns extracted URLs as records with reason `reference_urls_extracted` and no failures.
- `src/providers/workflows.ts:2079-2159` normalizes site-recipe discovery records and stores `acceptedUrls` from accepted candidates.
- `src/inspiredesign/reference-pattern-board.ts:296-319` adds `interface_chrome_shell` when diagnostic page text is interface chrome.
- `src/inspiredesign/reference-pattern-board.ts:328-346` classifies Pinterest-like chrome such as `your profile`, autocomplete instructions, action refs plus markers, and `pin card` plus `your profile`.
- `src/inspiredesign/reference-pattern-board.ts:430-440` allows only a narrow Pinterest visual metadata exception when diagnostics are soft interface chrome, and `src/inspiredesign/reference-pattern-board.ts:599-603` penalizes such entries.
- `src/inspiredesign/reference-pattern-board.ts:842-866` turns non-usable captures into rejected references with `capturedButRejectedReason` and `evidenceGap`.
- `src/inspiredesign/reference-discovery.ts:92-110` merges explicit URLs first, then discovered URLs, deduping and stopping at `maxReferences`.
- `src/guidance/context.ts:100-118` chooses `weak_reference` or other non-ready reason codes from quality metrics.
- `src/guidance/context.ts:129-135` dedupes `source.urls` plus `source.discovery.acceptedUrls` into `referenceUrls` without preserving whether a URL was weak, rejected, user-supplied, or discovered.
- `src/guidance/recipes/generic.ts:66-94` turns Pinterest `referenceUrls` into explicit `--url` flags when any canonical Pinterest URLs exist.
- `src/guidance/recipes/generic.ts:436-480` builds evidence recovery guidance with that command, and `src/guidance/recipes/generic.ts:688-701` routes `weak_reference` through the same builder.
- `tests/providers-inspiredesign-contract.test.ts:1213-1256` proves captured interface chrome is rejected instead of falling back to clean metadata.
- `tests/providers-inspiredesign-contract.test.ts:1259-1301` proves screenshot-backed Pinterest pins can remain usable with clean metadata, but may still score below ready threshold.

Eliminated hypotheses:

- Pinterest pin acceptance is not arbitrary URL leakage. It is constrained by `normalizePinterestReferenceUrl()` host and path rules (`src/guidance/recipes/pinterest.ts:90-128`).
- The failure is not that interface chrome is never classified. It is classified later in the reference-pattern board (`src/inspiredesign/reference-pattern-board.ts:296-346`). The earlier issue is that browser-native discovery treats search-shell pages with extractable links as successful discovery (`src/providers/browser-native-discovery.ts:315-386`).

Recommended fix locations:

- `src/providers/browser-native-discovery.ts`: for Pinterest, gate extracted URLs against source-page quality. If the source record matches `search-shell` and lacks concrete visual-grid or pin content signals, return a bad-state diagnostic instead of `reference_urls_extracted`.
- `src/guidance/context.ts`: preserve URL provenance and outcome, for example user-supplied, discovered, ranked, rejected, weak, failed capture, so recovery can distinguish recapture from replacement.
- `src/guidance/recipes/generic.ts`: avoid auto-populating weak or rejected Pinterest URLs in recovery commands unless the intent is explicit recapture. Prefer query-based authenticated discovery or placeholder replacement URLs for `weak_reference`, `off_brief_reference`, and `zero_ranked_references`.
- `src/providers/workflows.ts`: consider replacing weak candidates after discovery, or requesting additional candidates when extracted search-shell URLs fail quality gates.

### 4. Diagnostic bundle generation and artifact authority

**Conclusion:** Confirmed. Full design artifacts are built before readiness gating. Renderer gating withholds Canvas continuation artifacts, but substantial design artifacts still exist. The current code uses omission and warning prose, not a formal non-authoritative marker.

Evidence:

- `src/inspiredesign/contract.ts:2199-2339` builds the packet before renderer gating, including `generationPlan`, `canvasPlanRequest`, `designContract`, `followthrough`, `implementationPlan`, `designMarkdown`, visual evidence, screenshot index, ranked references, and evidence payload.
- `src/inspiredesign/contract.ts:2037-2059` labels the not-ready deliverable as a diagnostic `canvasPlanRequest` preview in prose.
- `src/providers/workflows.ts:4448-4505` builds the packet, computes `nextStepGuidance`, then calls `renderInspiredesign()`.
- `src/providers/renderer.ts:192-197` allows Canvas continuation only when `nextStepGuidance.readiness === "ready"`.
- `src/providers/renderer.ts:874-884` nulls prototype guidance and rewrites design markdown when Canvas continuation is not ready.
- `src/providers/renderer.ts:907-918` includes `canvasPlanRequest` in context payload only when ready.
- `src/providers/renderer.ts:923-949` always emits `design.md`, `advanced-brief.md`, `design-contract.json`, `design-agent-handoff.json`, `generation-plan.json`, implementation plans, evidence, visual evidence, screenshot index, ranked references, and meta prompt, while `prototype-guidance.md` and `canvas-plan.request.json` are emitted only when eligible.
- `src/providers/renderer.ts:969-977` mirrors the readiness gate in JSON response payloads.
- `tests/providers-inspiredesign-workflow.test.ts:2306-2320` asserts blocked diagnostic handoff and omitted ready-to-fill Canvas plan text for Pinterest diagnostic harvest.

Eliminated hypothesis:

- Canvas continuation artifacts are not fully emitted after a diagnostic result. `canvas-plan.request.json` is gated by readiness (`src/providers/renderer.ts:947-949`). The remaining concern is that other design artifacts are still substantial and lack a formal `diagnosticOnly` or `artifactAuthority` field.

Recommended fix locations:

- `src/providers/renderer.ts`: add explicit response and artifact metadata such as `diagnosticOnly: true` and `artifactAuthority: "diagnostic_only"` when `!canContinueInCanvas`.
- `src/inspiredesign/contract.ts` or `src/providers/renderer.ts`: prefix design-facing markdown and JSON artifacts with a consistent non-authoritative warning when readiness is not ready.
- Tests in `tests/providers-inspiredesign-workflow.test.ts` and `tests/providers-inspiredesign-contract.test.ts`: assert diagnostic authority markers are present for non-ready runs.

### 5. Canvas issue roots

#### Browser-bound preview requirement

**Conclusion:** Confirmed. Browser preview requires a browser-bound session, but generic accepted-plan guidance recommends preview without checking whether `browserSessionId` exists.

Evidence:

- `src/browser/canvas-manager.ts:429-445` allows `canvas.session.open` with nullable `browserSessionId`, including document-only sessions loaded from `repoPath`.
- `src/browser/canvas-manager.ts:1597-1644` implements `canvas.tab.open` through browser manager or extension transport and throws `canvas.tab.open requires a browserSessionId.` when no browser session exists.
- `src/browser/canvas-manager.ts:1823-1833` implements `canvas.preview.render` and throws `canvas.preview.render requires a browserSessionId.` before plan validation or rendering.
- `src/canvas/guidance.ts:62-79` recommends `canvas.preview.render` after accepted plan, patch, or feedback, with no session capability input.
- `src/browser/canvas-manager.ts:2403-2407` calls `buildCanvasCommandGuidance()` with only `planStatus` and `command`, not `browserSessionId` or mode.
- `tests/canvas-manager.test.ts:3093-3096` opens a document-only session from `repoPath`, and `tests/canvas-manager.test.ts:3338-3343` expects `canvas.preview.render requires a browserSessionId.`.

Recommended fix locations:

- `src/canvas/guidance.ts`: make Canvas guidance session-aware or add a document-only guidance variant that recommends `canvas.document.export`, `canvas.session.status`, or opening a browser-bound session instead of preview.
- `src/browser/canvas-manager.ts`: pass `browserSessionId` or session mode into guidance construction and attach structured blocker details to browser-bound preview errors.

#### `motionPosture` enum validation and guidance

**Conclusion:** Strict enum validation is working. The issue is guidance clarity when prose or unsupported enum values are submitted.

Evidence:

- `src/canvas/types.ts:144-150` defines allowed `CANVAS_MOTION_LEVELS` as `none`, `minimal`, `subtle`, `expressive` and reduced-motion policies as `respect-user-preference`, `static-alternative`.
- `src/canvas/document-store.ts:1352-1372` emits invalid enum issues with `expected` allowed values.
- `src/canvas/document-store.ts:1531-1608` requires `motionPosture.level` and `motionPosture.reducedMotion` via `requirePlanEnum()`.
- `src/canvas/repair-examples.ts:69-72` uses a valid example, `level: "subtle"`, and `reducedMotion: "respect-user-preference"`.
- `src/canvas/repair-examples.ts:311-318` chooses issue-derived field examples when available, so invalid enum issues can surface expected values.
- `tests/canvas-manager.test.ts:3138-3175` expects `generation_plan_invalid` guidance with field examples and validation checks for invalid plans.

Recommended fix locations:

- `src/canvas/repair-examples.ts`: ensure `issueFieldExamples()` always includes `expected` and an allowed replacement for nested enum failures such as `motionPosture.level`.
- Do not relax `src/canvas/document-store.ts` enum validation.

#### `iconSystem.decorative` prose validation

**Conclusion:** Confirmed. `decorative` is read as an icon role and validated as an approved icon family. That turns prose in `iconSystem.decorative` into an `icon-policy-violation` even though decorative policy text is not necessarily an icon family.

Evidence:

- `src/canvas/document-store.ts:1785-1792` reads `primary`, `secondary`, `secondaryAlt`, and `decorative` from `iconSystem` as strings.
- `src/canvas/document-store.ts:1926-1928` emits `icon-policy-violation` when `hasIconPolicyViolation(document)` is true.
- `src/canvas/document-store.ts:2065-2069` checks every non-empty icon role value against `APPROVED_LIBRARY_ENTRIES.icons`, including `decorative`.
- `tests/canvas-document-store.test.ts:3137-3185` covers an unsupported `primary: "rogue-icons"` policy violation, but there is no equivalent test proving decorative prose is allowed.

Recommended fix locations:

- `src/canvas/document-store.ts`: either stop treating `decorative` as a family slot or classify only short family-like decorative values as icon-family candidates.
- `tests/canvas-document-store.test.ts`: add a decorative prose case that does not emit `icon-policy-violation`, while keeping unsupported family values failing.

#### `feedback.poll` stale history semantics

**Conclusion:** Confirmed for stale cursor semantics. `feedback.poll` treats an unknown `afterCursor` as index `0` because `findIndex()` returns `-1` and the code adds `1`, so old retained feedback is replayed. This is separate from undo/redo history staleness.

Evidence:

- `src/browser/canvas-manager.ts:2090-2097` computes `startIndex` as `items.findIndex(...) + 1`, then slices from `Math.max(startIndex, 0)`. If the cursor is missing, `-1 + 1` becomes `0`, replaying retained items.
- `src/browser/canvas-manager.ts:2097-2119` returns retention totals and active targets, but no `staleCursor` marker.
- `tests/canvas-manager.test.ts:3234-3261` currently expects `afterCursor: "cursor_404"` to replay retained validation feedback and move to a real cursor.

Eliminated hypothesis:

- This is not the same as undo/redo history invalidation. That path is handled elsewhere and only on history commands, not `feedback.poll`.

Recommended fix locations:

- `src/browser/canvas-manager.ts`: make stale `afterCursor` return an empty batch or explicit recovery shape, and include `retention.staleCursor: true`.
- `tests/canvas-manager.test.ts`: update stale cursor expectations.

#### `html_bundle` `repoPath` behavior

**Conclusion:** Confirmed. `html_bundle` ignores caller-provided `repoPath`; only `design_document` export honors it.

Evidence:

- `src/browser/canvas-manager.ts:1233-1249` handles `design_document` by calling `saveCanvasDocument(repoRoot, document, optionalString(params.repoPath))` and returning `resolvedSavePath`.
- `src/browser/canvas-manager.ts:1264-1274` handles `html_bundle` by hardcoding `${exportBase}-${session.canvasSessionId}.html` and never reading `params.repoPath`.
- `src/canvas/repo-store.ts:22-27` can resolve explicit `repoPath`, but `html_bundle` does not call it with the caller value.
- `tests/canvas-manager.test.ts:440-446` only asserts that an `.html` artifact is produced, not that a requested path is honored.

Recommended fix locations:

- `src/browser/canvas-manager.ts`: either honor `repoPath` for `html_bundle` or reject it with a clear validation error. The current silent ignore is the contract problem.
- `tests/canvas-manager.test.ts`: add explicit coverage for `html_bundle` with `repoPath`.

## Investigation Log

### Phase 1 - Initial Assessment

**Hypothesis:** The command currently treats successful workflow execution as top-level success even when the design harvest fails readiness gates.

**Findings:** The evaluation artifacts show `qualitySummary.rankedReferenceCount: 0`, `rejectedReferenceCount: 4`, `diagnosticOnlyReasons: ["interface_chrome_shell"]`, and `references: []`. Both the query and explicit URL recovery runs report `failedCaptureCount: 0` and `missingScreenshotCount: 0` despite visual evidence JSON containing required visual capture failures.

**Evidence:** Prior report and artifact roots listed above.

**Conclusion:** Confirmed as a primary investigation path. Need code-path evidence for where success, readiness, quality counters, Pinterest candidate extraction, and Canvas guidance are computed.

### Phase 2 - Context Builder and Pair Investigation

**Hypothesis:** The symptoms are caused by multiple surface-contract mismatches rather than a single failed capture call.

**Findings:** RepoPrompt `context_builder` selected the harvest CLI/tool path, workflow orchestration, Pinterest browser-native discovery, reference ranking, renderer artifact emission, guidance routing, and Canvas manager/document-store paths. The pair investigator verified each symptom against source and runtime artifacts, then appended file/line evidence above.

**Evidence:** Oracle context export `prompt-exports/oracle-question-2026-05-22-170948-harvest-readiness-44-7180.md`; final synthesis export `prompt-exports/oracle-chat-2026-05-22-171852-harvest-readiness-44-482f.md`.

**Conclusion:** Confirmed. The smallest defensible root-cause set is the six-part set below.

## Root Cause

1. Operational success is not product readiness.

The CLI and tool wrappers report successful command/workflow execution as `success:true` or `ok:true`. Product readiness is nested under `meta.nextStepGuidance.readiness`, and the CLI uses it mainly to append human-readable message text. This is intentional transport behavior, not a hidden process failure, but agents need top-level machine-readable readiness to avoid treating diagnostic completion as design success.

2. Visual failure accounting is scoped too narrowly.

`visual-evidence.json` is built from all references with visual metadata, including required visual captures that failed. `ranked-references.json` quality counters are computed from ranked or design-facing references, and design-facing failure counters can be reset to zero after all candidates are rejected. That makes `failedCaptureCount: 0` and `missingScreenshotCount: 0` technically true for the ranked set but misleading for the harvest attempt.

3. Pinterest URL extraction accepts shell-derived canonical URLs before source quality is enforced.

Pinterest URL normalization is restrictive, so the issue is not arbitrary URL leakage. The issue is that `search-shell` evidence can still yield canonical pin URLs and enter capture as accepted discovery. Later ranking correctly rejects Pinterest chrome, video shell, or pin shell as `interface_chrome_shell`, but recovery then sees canonical URLs without enough provenance to decide whether to recapture or replace them.

4. Diagnostic artifact authority is incomplete.

Renderer gating blocks Canvas continuation and omits ready-only Canvas plan artifacts, which is correct. However, non-ready runs still emit substantial design artifacts such as `design.md`, `design-contract.json`, `generation-plan.json`, implementation plans, evidence, handoff, and meta prompt. These files have some warning prose, but they lack consistent machine-readable `diagnostic_only` or non-authoritative artifact metadata across the bundle.

5. Canvas guidance is not session-capability aware.

Document-only Canvas sessions can accept plan and patch operations, but browser preview commands require `browserSessionId`. The preview error is correct, but generic guidance can still steer agents toward preview without checking whether the session is browser-bound.

6. Canvas command contracts have small but concrete mismatches.

Strict `motionPosture.level` validation is correct, but repair guidance needs clearer accepted enum examples. `iconSystem.decorative` can be treated as an icon-family slot even when the user supplied prose. `feedback.poll` treats an unknown cursor as the start of retained history, replaying stale warnings. `html_bundle` silently ignores requested `repoPath` while `design_document` honors it.

## Recommendations

1. Expose product readiness on top-level harvest surfaces.

Keep process `success:true` for completed diagnostic runs if that is the desired transport contract, but add top-level fields such as `ready:false`, `readiness:"diagnostic_only"`, and possibly `artifactAuthority:"diagnostic_only"` in `src/cli/commands/inspiredesign.ts` and `src/tools/inspiredesign_run.ts`.

2. Align ranked quality counters with attempted visual evidence.

In `src/inspiredesign/reference-pattern-board.ts` and the workflow guidance-source path, compute or carry source-level visual attempt counters so ranked artifacts cannot imply that no visual captures failed when `visual-evidence.json` records failures. If ranked-only counters remain useful, name them as ranked-only and add all-attempt counters separately.

3. Preserve Pinterest URL provenance and gate shell-derived candidates.

In `src/providers/browser-native-discovery.ts`, treat Pinterest `search-shell` extraction as lower authority unless the source page has concrete visual-grid or pin-content signals. In `src/guidance/context.ts` and `src/guidance/recipes/generic.ts`, preserve whether URLs were user-supplied, discovered, shell-derived, rejected, weak, diagnostic-only, or capture-failed, so recovery can choose replacement discovery versus deliberate recapture.

4. Mark non-ready artifacts as diagnostic-only everywhere.

In `src/providers/renderer.ts` and related packet/artifact construction, keep omitting Canvas plan requests for non-ready runs, but add consistent response and artifact metadata plus prominent markdown warnings that design-facing artifacts are non-authoritative until readiness is `ready`.

5. Make Canvas guidance session-aware.

In `src/canvas/guidance.ts` and `src/browser/canvas-manager.ts`, include session capability in command guidance. Document-only sessions should recommend export, status, or opening a browser-bound session rather than preview render.

6. Tighten Canvas contracts and tests.

Honor or explicitly reject `repoPath` for `html_bundle`; return a clear stale-cursor shape instead of replaying old feedback; keep strict motion enums but surface allowed values in repair guidance; and avoid treating decorative prose as an unsupported icon family. Add regression tests in the Canvas manager and document-store suites for each contract.

## Preventive Measures

- Add harvest response contract tests that assert operational success and product readiness are separate fields.
- Add a regression where all Pinterest references are rejected but required visual captures failed, and assert high-level quality metrics reflect the attempted failures.
- Add Pinterest recovery tests that distinguish recapture of explicit URLs from replacement discovery after weak or diagnostic-only candidates.
- Add artifact authority assertions for every non-ready harvest bundle.
- Add Canvas guidance tests for browser-bound versus document-only sessions, plus explicit tests for stale feedback cursors and `html_bundle` path behavior.
