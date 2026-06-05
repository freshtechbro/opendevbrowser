# Investigation: Pinterest harvest snapshot-first consolidated root cause

Date: 2026-05-22

Branch: `codex/pinterest-fashion-studio-harvest-eval`

## Summary

The additional hypothesis is confirmed with an important terminology caveat: for Pinterest, the product should be visual-screenshot-first for image pins and screencast-first for video pins, while the current code's `snapshot` is a text/actionable browser snapshot inside the deep-capture lane. Deep capture is currently forced for URL-backed Pinterest harvests, is fragile for Pinterest, and should become optional diagnostics rather than the primary readiness path.

## Symptoms

- `inspiredesign harvest` exits successfully and writes artifacts, but Pinterest harvest readiness remains `diagnostic_only`.
- Pinterest discovery finds pin URLs, but no design-ready references are ranked.
- Browser capture produces Pinterest UI shell, pin chrome, video controls, small centered media, or timed-out deep capture evidence.
- Visual evidence failures are recorded in `visual-evidence.json`, but ranked-reference quality counters understate those failures.
- Recovery retries weak URLs instead of using rejection reasons to find better visual candidates.
- Canvas continuation is correctly blocked by readiness, while direct Canvas prototyping remains brief-led rather than Pinterest-reference-led.

## User Hypothesis To Verify

For Pinterest design inspiration, the workflow may be overcomplicated. The desired product flow is:

1. Validate command input.
2. Run Pinterest discovery to find pin URLs.
3. Visit exact pin URLs.
4. Capture visual screenshots for images and screencasts for videos.
5. Let the agent reason through the visual evidence to extract inspiration.

The claim to verify is that deep capture is ineffective or overkill for Pinterest because the needed evidence is visual. Deep capture should not block ranking when usable snapshot or screencast evidence exists.

## Background / Prior Research

- Evaluation report: `docs/investigations/pinterest-fashion-studio-harvest-canvas-evaluation-2026-05-22.md`.
- Readiness/evidence-quality report: `docs/investigations/inspiredesign-harvest-readiness-and-pinterest-evidence-quality-2026-05-22.md`.
- Query harvest artifact root: `.opendevbrowser/tool-evaluation/fashion-studio-motion/harvest-query/inspiredesign/c7c0caa4-7f1f-40e9-800f-be4989388025`.
- Explicit URL recovery artifact root: `.opendevbrowser/tool-evaluation/fashion-studio-motion/harvest-url-recovery/inspiredesign/59a7b86b-4cf3-4b37-8023-4555b54207ca`.
- Existing conclusion from prior investigation: the primary product failure occurs between Pinterest URL discovery and ranked design reference generation.

## Investigator Findings

### Scope and limitations

- Investigation only. No source fixes were implemented.
- RepoPrompt `context_builder` ran and produced the source-context export `prompt-exports/oracle-question-2026-05-22-174323-pinterest-capture-sc-66ef.md`.
- Pair investigation and the follow-up Oracle synthesis could not run because the environment hit its usage limit. The findings below were verified directly against source files and local artifacts.

### 1. URL-backed harvest forces deep capture

**Conclusion:** Confirmed. Any URL-backed `inspiredesign` run resolves to deep capture, including URLs discovered from a Pinterest query.

Evidence:

- `src/inspiredesign/capture-mode.ts:7-12` returns `"deep"` whenever the URL list contains any non-empty URL, otherwise it uses the requested mode or `"off"`.
- `src/cli/commands/inspiredesign.ts:326-340` requires `harvest` to have `--query` or `--url`, defaults harvest `visualEvidence` to `"required"`, resolves capture mode from explicit URLs, and passes that mode to the daemon.
- `src/providers/workflows.ts:4371-4388` runs discovery, merges accepted discovery URLs into `workflowInput.urls`, then resolves capture mode again from explicit plus discovered URLs. This means a query-only Pinterest harvest can still become deep-capture-backed after discovery finds pins.
- `docs/CLI.md:552-553` documents `--capture-mode off|deep` and says `off` is ignored when any `--url` is provided.
- `docs/CLI.md:569` explicitly states that any `--url` forces deep capture to collect DOM/layout evidence.

**Conclusion detail:** The current architecture is deep-capture-first for Pinterest once pin URLs are available. This is not just a CLI default; it is reasserted after discovery.

### 2. Current `snapshot` is not visual screenshot evidence

**Conclusion:** Confirmed. The user's desired snapshot-first flow means visual PNG screenshots. The current `snapshot` capture is an actionables/text snapshot used inside deep capture.

Evidence:

- `src/inspiredesign/capture.ts:260-299` calls `manager.snapshot(sessionId, "actionables", ...)`, stores text content, ref count, and warnings, and fails when text is empty.
- `src/inspiredesign/capture.ts:389-431` captures the actual visual evidence by calling `manager.screenshot(...)` and records PNG metadata separately.
- `src/inspiredesign/visual-evidence.ts:16-39` models visual evidence as status, kind, path, hash, byte count, viewport, warnings, and failure metadata.
- `src/inspiredesign/visual-evidence.ts:80-83` writes PNG paths under `visual-evidence/<referenceId>/<kind>.png`.
- `src/inspiredesign/contract.ts:2095-2126` writes `visual-evidence.json` for all visual metadata and `screenshot-index.json` only for captured screenshots with path, hash, and bytes.

**Conclusion detail:** Future design should avoid the overloaded word `snapshot`. Product language should say `visual screenshot` for image pins and `screencast` or `replay` for video pins.

### 3. Visual screenshots are currently inside deep capture, not a separate Pinterest lane

**Conclusion:** Confirmed. `--visual-evidence required` does not create a standalone screenshot-first flow. It asks the deep capture reference function to take a screenshot after text snapshot, clone, and DOM attempts.

Evidence:

- `src/inspiredesign/capture.ts:471-487` runs deep capture in this order: text/actionable snapshot, clone, DOM, then visual screenshot.
- `src/inspiredesign/capture.ts:477-484` returns early if snapshot or clone transport times out, which can skip downstream DOM and visual screenshot capture.
- `src/providers/workflows.ts:2403-2460` calls `captureReference(...)` with `visualEvidence` and `visualEvidencePath`; visual evidence is therefore requested through the capture lane.
- `src/providers/workflows.ts:2255-2277` adds `required_visual_evidence_missing` when required visual evidence is missing or not captured.
- Runtime artifact check of the query harvest shows two captured viewport PNG entries and two failed visual entries in `visual-evidence.json`; `screenshot-index.json` only contains the two captured PNGs.

**Conclusion detail:** Required visual evidence is present as a policy, but it is subordinated to the deep-capture sequence. That makes Pinterest screenshot capture vulnerable to earlier deep-capture transport timeouts. Ordinary empty snapshot or clone failures do not necessarily skip all later lanes, but transport timeouts can.

### 4. Deep capture uses a fresh headless no-extension lane

**Conclusion:** Confirmed. The capture lane does not reuse the logged-in extension browser session that Pinterest discovery depends on.

Evidence:

- `src/inspiredesign/capture.ts:490-520` launches a fresh browser session with `headless: true`, `persistProfile: false`, and `noExtension: true`.
- `src/inspiredesign/capture.ts:95-99` defines the message `Deep capture only honors configured provider cookie sources; active session cookies are not reused.`
- `src/inspiredesign/capture.ts:219-249` imports cookies only from configured cookie source data.
- `src/cli/daemon-commands.ts:890-920` wires `inspiredesign.run` to `captureInspiredesignReferenceFromManager(...)` and passes configured provider cookie source into that deep capture helper.
- `docs/CLI.md:584` documents that `--browser-mode` applies to provider-backed retrieval, while deep capture still uses the browser manager capture lane.

**Conclusion detail:** This is a mismatch for Pinterest. Discovery is browser-native and extension/cookie sensitive, but capture is performed in a separate headless no-extension lane. That explains why Pinterest can be found successfully but later captured as shell, login-like, small media, or timeout-prone evidence.

### 5. Ranking is not truly screenshot-first today

**Conclusion:** Confirmed. Ranking does not reason over screenshot pixels as first-class evidence. It mostly uses clean text, clone, DOM, and a narrow Pinterest visual-metadata exception.

Evidence:

- `src/inspiredesign/reference-pattern-board.ts:369-379` builds reference signals from title, excerpt, capture title, text snapshot content, clone preview, CSS preview, and DOM HTML.
- `src/inspiredesign/reference-pattern-board.ts:442-446` treats usable capture evidence as clean text snapshot, usable clone evidence, or clean DOM HTML.
- `src/inspiredesign/reference-pattern-board.ts:434-440` allows Pinterest visual metadata only when the URL is a Pinterest visual reference, capture status is captured, visual status is captured, clean metadata exists, and diagnostics are only soft interface-chrome reasons.
- `src/inspiredesign/reference-pattern-board.ts:467-470` checks Pinterest visual metadata before blocking on diagnostic reasons.
- `src/inspiredesign/reference-pattern-board.ts:580-599` scores fetch, captured evidence, visual status, text snapshot, clone, DOM, and public landing signals. Visual screenshot status only contributes when usable capture evidence or Pinterest visual metadata exists.
- `src/inspiredesign/reference-pattern-board.ts:611-627` can mention a screenshot artifact as a strength, but that happens after a reference is already being synthesized.

**Conclusion detail:** A screenshot-only Pinterest reference can be persisted and indexed, but current ranking is not pixel-aware enough to treat the screenshot itself as the primary design evidence. Snapshot-first product behavior requires a ranking contract change, not just disabling deep capture.

### 6. Screencast exists, but harvest does not use it

**Conclusion:** Confirmed. Screencast is available as a public browser replay lane, but the selected harvest code does not integrate it for video pins.

Evidence:

- `src/cli/commands/devtools/screencast-start.ts:36-50` starts a page screencast through `page.screencast.start`.
- `src/cli/commands/devtools/screencast-stop.ts:24-35` stops a page screencast through `page.screencast.stop`.
- `src/cli/daemon-commands.ts:611-624` routes `page.screencast.start` to `core.manager.startScreencast(...)`.
- `docs/CLI.md:1368-1398` documents screencast start and stop, including replay files, frames, `preview.png`, output directory behavior, frame interval, and max frames.
- `rg -n "screencast|startScreencast|stopScreencast" src/inspiredesign src/providers src/cli/commands/inspiredesign.ts tests/providers-inspiredesign*` found no harvest integration, only the unrelated browser-output artifact namespace.

**Conclusion detail:** Video pins currently fall through the same deep capture path. Generic browser screencast primitives exist, but harvest lacks media classification, capture orchestration, a persistence contract, and ranking integration for video pins.

### 7. Prior readiness and Canvas findings still stand

**Conclusion:** Confirmed. The snapshot-first investigation does not replace the prior readiness findings; it explains why the Pinterest evidence-quality layer fails.

Evidence:

- `docs/investigations/inspiredesign-harvest-readiness-and-pinterest-evidence-quality-2026-05-22.md` documents that top-level `success:true` is operational success, readiness is nested, visual counters are scoped too narrowly, recovery lacks URL provenance, diagnostic artifacts need authority markers, and Canvas guidance has separate contract issues.
- `src/providers/workflows.ts:4448-4507` builds the packet, guidance, and renderer inputs after capture and visual collation.
- `src/providers/renderer.ts:195-285` blocks Canvas continuation when readiness is not ready.
- `src/providers/renderer.ts:825-940` still emits substantial design artifacts, visual evidence, screenshot index, ranked references, and handoff.

**Conclusion detail:** Canvas blocking is correct. The failed harvest is not recovered by a brief-led Canvas prototype because the original product goal was Pinterest-reference-led design inspiration.

### 8. Pair verification after usage restoration

**Conclusion:** Confirmed. After reading the Oracle planning export and rechecking the current source, the consolidated root cause and recommendations are accurate. I found no overstated factual claim that needs reversal. The main caveat is terminology: the product direction should say visual screenshot-first for image pins, not current `snapshot()`-first, because current `snapshot()` is text/actionable evidence.

Evidence by claim:

- URLs still force `deep` capture. `src/inspiredesign/capture-mode.ts:7-12` returns `"deep"` for any non-empty URL list. `src/cli/commands/inspiredesign.ts:324-340` requires harvest input, resolves capture mode from explicit URLs, defaults harvest visual evidence to `"required"`, and passes the mode to the daemon. `src/providers/workflows.ts:4373-4388` runs discovery, merges `discovery.acceptedUrls`, and resolves capture mode again from explicit plus discovered URLs, so discovered Pinterest pin URLs also force deep capture. `docs/CLI.md:552-569` documents that `--capture-mode off|deep` ignores `off` when any `--url` exists and that any `--url` forces deep capture for DOM/layout evidence.
- Current `snapshot` is actionables/text, while visual PNG screenshot is separate. `src/inspiredesign/capture.ts:255-283` calls `manager.snapshot(sessionId, "actionables", ...)` and stores sanitized text, ref count, and warnings. `src/inspiredesign/capture.ts:389-425` separately calls `manager.screenshot(...)` to write the PNG visual evidence. `src/inspiredesign/visual-evidence.ts:16-39` models visual evidence as metadata with status, kind, path/hash/bytes, viewport, warnings, and failure fields. `src/inspiredesign/contract.ts:2095-2126` writes `visual-evidence.json` from all visual metadata and `screenshot-index.json` only for captured screenshots with path, hash, and bytes.
- Visual screenshot capture is nested inside the deep capture lane and can be skipped by earlier transport timeout. `src/inspiredesign/capture.ts:471-487` runs snapshot, clone, DOM, then visual screenshot, and returns early if snapshot or clone reports a transport timeout. `src/providers/workflows.ts:2403-2460` passes `visualEvidence` and `visualEvidencePath` through `captureReference(...)`, so visual evidence is requested through the capture lane rather than a separate Pinterest lane. `src/providers/workflows.ts:2255-2277` adds `required_visual_evidence_missing` only after capture lacks required visual metadata.
- Deep capture uses a fresh headless no-extension browser session and configured cookie source rather than active extension session reuse. `src/inspiredesign/capture.ts:95-99` defines the active-session limitation message. `src/inspiredesign/capture.ts:219-245` imports cookies from `readCookiesFromSource(source)`. `src/inspiredesign/capture.ts:506-515` launches with `headless: true`, `persistProfile: false`, and `noExtension: true`. `src/cli/daemon-commands.ts:891-920` wires `inspiredesign.run` to `captureInspiredesignReferenceFromManager(...)` and passes `core.config.providers?.cookieSource`. `docs/CLI.md:584` says `--browser-mode` applies to provider-backed retrieval while deep capture still uses the browser manager capture lane.
- Ranking is not screenshot-pixel-first today. `src/inspiredesign/reference-pattern-board.ts:369-379` builds signals from title, excerpt, capture title, text snapshot, clone preview, CSS preview, and DOM HTML. `src/inspiredesign/reference-pattern-board.ts:434-446` allows only a narrow Pinterest visual metadata exception and otherwise treats usable capture evidence as text snapshot, clone, or DOM. `src/inspiredesign/reference-pattern-board.ts:467-478` checks that exception before regular diagnostic blocking and capture evidence checks. `src/inspiredesign/reference-pattern-board.ts:583-599` scores visual status only when usable capture evidence or Pinterest visual metadata exists. `src/inspiredesign/reference-pattern-board.ts:611-627` mentions a screenshot artifact only as a downstream strength after a reference is already being synthesized.
- Screencast APIs exist but are not integrated into inspiredesign harvest. `src/cli/commands/devtools/screencast-start.ts:36-50` calls daemon method `page.screencast.start`, and `src/cli/commands/devtools/screencast-stop.ts:24-35` calls `page.screencast.stop`. `src/cli/daemon-commands.ts:611-624` routes start to `core.manager.startScreencast(...)`. `docs/CLI.md:1368-1398` documents replay artifacts, frames, `preview.png`, output directory behavior, frame interval, max frames, and stop metadata. RepoPrompt content search for `screencast|startScreencast|stopScreencast` under `src/inspiredesign`, `src/providers`, `src/cli/commands/inspiredesign.ts`, and relevant inspiredesign tests found no harvest integration; the only scoped match was the unrelated namespace constant `src/providers/browser-output-artifacts.ts:7`.
- The consolidated root cause and recommendations do not overstate current capabilities. The current code can persist PNG screenshot metadata and can expose public screencast commands, but it does not yet have a Pinterest media classifier, active extension-session reuse for capture, screencast-backed video harvest, or pixel-aware visual ranking. A finalized PNG proves visual evidence exists, not that it is design-ready. `src/providers/renderer.ts:195-289` correctly blocks Canvas continuation when readiness is not `ready`, while `src/providers/renderer.ts:825-944` still emits substantial diagnostic artifacts, so the recommendation to add clearer artifact authority markers remains appropriate.

Missing caveats and recommended fix locations:

- Do not describe the desired Pinterest flow as current `snapshot()` reuse. The intended image-pin lane should be a visual PNG or targeted-media screenshot lane.
- Do not assume screenshot metadata alone proves design-ready evidence. A later implementation needs visual analysis metadata or an agent vision pass before ranking screenshots as first-class design references.
- Primary implementation seams are `src/providers/workflows.ts` for post-discovery media classification and lane selection, `src/inspiredesign/capture.ts` for independent visual capture before optional deep diagnostics, `src/inspiredesign/reference-pattern-board.ts` for visual-aware ranking, `src/inspiredesign/contract.ts` and `src/inspiredesign/visual-evidence.ts` for screenshot or motion evidence payloads, and `src/providers/renderer.ts` plus guidance recipes for readiness and artifact authority.
- Tests should be added around `tests/providers-inspiredesign-workflow.test.ts`, `tests/providers-inspiredesign-capture.test.ts`, `tests/providers-inspiredesign-contract.test.ts`, and CLI/tool workflow tests to prove image pins can become ready from visual evidence, video pins use screencast evidence, and deep capture timeout cannot skip required visual evidence.

## Investigation Log

### Phase 1 - Initial Assessment

**Hypothesis:** Pinterest harvest should be visual-first. Deep capture should be optional, secondary, or non-blocking for Pinterest pins because ranking should use snapshots or screencasts as the authoritative evidence.

**Findings:** Prior artifacts already show deep capture timeouts and Pinterest shell evidence. The new investigation must verify how capture mode is selected, whether visual snapshots can satisfy ranking without DOM/clone evidence, and whether video pins have screencast support in the harvest path.

**Evidence:** User process trace and prior report artifacts listed above.

**Conclusion:** Plausible and worth verifying against capture-mode, workflow, visual-evidence, and ranking code.

### Phase 2 - Capture Scope Verification

**Hypothesis:** Deep capture is overused for Pinterest and blocks or pollutes the visual evidence path.

**Findings:** Confirmed. URLs force deep capture, discovered Pinterest URLs re-force deep capture, visual screenshots are captured only inside the deep capture lane, deep capture runs a fresh headless no-extension browser, and ranking is not screenshot-pixel-first today.

**Evidence:** Source findings in `## Investigator Findings`.

**Conclusion:** The user's product direction is correct, with one correction: the desired flow is not current `snapshot()` first. It is visual screenshot first for static image pins and screencast first for video pins.

## Consolidated Root Cause

1. The command reports operational success, but product success is evidence-gated and remains `diagnostic_only` when no usable references are ranked.

2. Pinterest URL discovery partially works, but the next stage forces discovered pin URLs through a deep-capture lane optimized for DOM/layout extraction rather than visual inspiration.

3. Deep capture is a poor primary readiness path for Pinterest because it launches a fresh headless no-extension browser, relies on configured cookie sources instead of the active extension session, and runs text snapshot, clone, and DOM capture before visual screenshot. It may still be useful as optional diagnostic or enrichment evidence.

4. Required visual evidence is captured as metadata and PNG artifacts, but it is not the primary ranking authority. Current ranking still depends on clean text, clone, DOM, or narrow Pinterest visual metadata, so screenshots alone do not reliably become design-ready references. A separate visual analysis or pixel/frame-aware evidence layer is needed before screenshots or screencasts can be authoritative.

5. Video pins have no harvest-integrated screencast path even though browser screencast APIs exist.

6. Quality accounting, recovery, and artifact authority issues compound the capture problem: failed visual attempts are undercounted in ranked summaries, weak URLs can be retried without provenance, and diagnostic bundles can look more actionable than they are.

## Recommended Product Gate

For Pinterest harvest, product success should require:

- `success: true` for operational completion.
- `harvestReadiness: "ready"`.
- `productSuccess: true`.
- `rankedReferenceCount > 0`.
- `references.length > 0`.
- At least one ranked reference with captured visual screenshot or screencast evidence.
- No active `doNotProceedIf` blockers.
- No ranked reference whose only evidence is Pinterest chrome, search shell, login/challenge UI, video controls, or small centered media without transferable design content.

If the user asked for Pinterest design references and ranked references are empty, the product failed regardless of exit code. The run should be reported as diagnostic or recovery-needed.

## Recommendations

1. Re-scope Pinterest harvest to visual-first capture.

Use visual screenshot-first capture for image pins and screencast-first capture for video pins. Keep deep capture as optional diagnostics or secondary enrichment, not as the primary readiness path for Pinterest.

2. Add an explicit Pinterest media evidence lane.

After discovery, classify candidates as image pin, video pin, board, idea page, source page, shell, login/challenge, or invalid. Capture the appropriate visual artifact before attempting DOM/clone capture.

3. Make ranking visual-evidence-aware.

Add a ranking path that treats screenshot and screencast artifacts as first-class evidence. This may require visual analysis metadata generated by the agent or a separate vision pass; the current screenshot metadata alone only proves a PNG exists.

4. Do not let deep capture block visual evidence.

If deep capture remains enabled, run visual screenshot or screencast before DOM/clone attempts, or run it independently so text snapshot or clone timeouts cannot skip required visual evidence.

5. Preserve browser session continuity for Pinterest capture.

Prefer the same browser-native extension session used for discovery when capturing Pinterest visuals. If a separate session is required, expose that as a known diagnostic limitation.

6. Integrate screencast for video pins.

Reuse the existing screencast API to capture replay artifacts for video pins, then persist replay metadata alongside `visual-evidence.json` and `screenshot-index.json` or a new `motion-evidence.json`.

7. Keep prior readiness fixes.

Expose top-level `ready`, `harvestReadiness`, and `productSuccess`; fix all-attempt visual counters; preserve URL outcome/provenance for recovery; and mark non-ready artifacts as diagnostic-only.

## Preventive Measures

- Add tests proving Pinterest URLs do not automatically require DOM/clone deep capture when visual-first capture is selected.
- Add tests where an image pin succeeds from screenshot evidence without DOM/clone evidence, after visual analysis marks it design-ready.
- Add tests where a video pin uses screencast evidence rather than static controls-only screenshots.
- Add tests proving deep capture timeout cannot skip required visual evidence in Pinterest harvest.
- Add tests proving empty ranked references produce `productSuccess:false` even when the command exits successfully.
- Add recovery tests that replace weak shell/video-control candidates instead of retrying them blindly.
