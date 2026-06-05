# Pinterest Fashion Studio Harvest And Canvas Evaluation

Date: 2026-05-22

Branch: `codex/pinterest-fashion-studio-harvest-eval`

## Goal

Evaluate the real OpenDevBrowser workflow for harvesting Pinterest design inspiration for a fashion design studio, then using the Canvas workflow to create a prototype landing page with a broad motion-design posture.

## Commands Run

```bash
npx opendevbrowser status --daemon --output-format json
npx opendevbrowser inspiredesign harvest --brief "<fashion studio brief>" --query "Pinterest fashion design studio landing page atelier editorial runway garment texture motion design parallax" --provider social/pinterest --max-references 5 --visual-evidence required --browser-mode extension --use-cookies --cookie-policy required --challenge-automation-mode browser_with_helper --mode json --timeout-ms 180000 --output-dir /Users/bishopdotun/Documents/DevProjects/opendevbrowser/.opendevbrowser/tool-evaluation/fashion-studio-motion/harvest-query --output-format json
npx opendevbrowser inspiredesign harvest --brief "<fashion studio brief>" --provider social/pinterest --url "https://www.pinterest.com/pin/169518373469331741/" --url "https://www.pinterest.com/pin/7810999349554389/" --url "https://www.pinterest.com/pin/6403624465992545/" --url "https://www.pinterest.com/pin/987625393259031928/" --max-references 5 --visual-evidence required --browser-mode extension --use-cookies --cookie-policy required --challenge-automation-mode browser_with_helper --mode json --timeout-ms 180000 --output-dir /Users/bishopdotun/Documents/DevProjects/opendevbrowser/.opendevbrowser/tool-evaluation/fashion-studio-motion/harvest-url-recovery --output-format json
npx opendevbrowser launch --extension-only --wait-for-extension --wait-timeout-ms 10000 --start-url https://example.com --output-format json
npx opendevbrowser canvas --command canvas.session.open --params '{"browserSessionId":"61358a40-0dbc-4015-ba75-4f23364528d6","documentId":"fashion-studio-motion-prototype-browser","label":"Fashion Studio Motion Prototype Browser","mode":"dual-track","repoRoot":"/Users/bishopdotun/Documents/DevProjects/opendevbrowser"}' --timeout-ms 120000 --output-format json
npx opendevbrowser canvas --command canvas.plan.set --params-file .opendevbrowser/tool-evaluation/fashion-studio-motion/canvas-plan.browser.set.json --timeout-ms 120000 --output-format json
npx opendevbrowser canvas --command canvas.document.patch --params-file .opendevbrowser/tool-evaluation/fashion-studio-motion/canvas-document.browser-root.patch.json --timeout-ms 120000 --output-format json
npx opendevbrowser canvas --command canvas.document.patch --params-file .opendevbrowser/tool-evaluation/fashion-studio-motion/canvas-fix.patch.json --timeout-ms 120000 --output-format json
npx opendevbrowser canvas --command canvas.preview.render --params '{"canvasSessionId":"canvas_499af791-0397-407e-9f98-35f94990c056","leaseId":"lease_157b9d14-c3d5-457b-b9ce-bfb2766800d6","targetId":"tab-1245691960","prototypeId":"proto_home_default"}' --timeout-ms 120000 --output-format json
npx opendevbrowser screenshot --session-id 61358a40-0dbc-4015-ba75-4f23364528d6 --target-id tab-1245691960 --path /Users/bishopdotun/Documents/DevProjects/opendevbrowser/.opendevbrowser/tool-evaluation/fashion-studio-motion/canvas-preview-fixed.png --output-format json
npx opendevbrowser debug-trace-snapshot --session-id 61358a40-0dbc-4015-ba75-4f23364528d6 --target-id tab-1245691960 --max 40 --request-id fashion-studio-canvas-preview-fixed --output-format json
npx opendevbrowser canvas --command canvas.document.save --params '{"canvasSessionId":"canvas_499af791-0397-407e-9f98-35f94990c056","leaseId":"lease_157b9d14-c3d5-457b-b9ce-bfb2766800d6","repoPath":".opendevbrowser/tool-evaluation/fashion-studio-motion/fashion-studio-motion-prototype.canvas.json"}' --timeout-ms 120000 --output-format json
npx opendevbrowser canvas --command canvas.document.export --params '{"canvasSessionId":"canvas_499af791-0397-407e-9f98-35f94990c056","leaseId":"lease_157b9d14-c3d5-457b-b9ce-bfb2766800d6","exportTarget":"html_bundle","repoPath":".opendevbrowser/tool-evaluation/fashion-studio-motion/fashion-studio-motion-prototype.html"}' --timeout-ms 120000 --output-format json
```

## Environment Preflight

- Daemon was current: `fingerprintCurrent:true`.
- Extension relay was connected and handshaken: `extensionConnected:true`, `extensionHandshakeComplete:true`.
- Native host mismatch was present: installed host targets `hakmaakmlplipjedehpdjmndndjolhne`, while discovered extension id is `jmhlfninmadkljgnahjnaleonjdncaml`.
- The mismatch did not block extension-mode harvest or Canvas preview in this run, but it is still environment drift worth reporting separately from harvest readiness.

## Harvest Results

### Query Harvest

Artifact root:

```text
.opendevbrowser/tool-evaluation/fashion-studio-motion/harvest-query/inspiredesign/c7c0caa4-7f1f-40e9-800f-be4989388025
```

Observed result:

- Runtime took roughly 2 minutes 15 seconds and emitted no incremental progress.
- Top-level result was `success:true`.
- Message ended with `readiness=diagnostic_only`.
- `nextStepGuidance.reasonCode` was `pinterest_browser_native_recovery`.
- Four Pinterest pin URLs were discovered.
- Two visual screenshots were captured.
- Two required visual captures failed.
- `rankedReferences` was empty.
- `design-agent-handoff.json` set `continueInCanvas` to `Unavailable until nextStepGuidance.readiness is ready.`

The output is safer than older behavior because it does not present Canvas as the next action, but it still produces a large design bundle whose actual creative evidence is unusable.

### Explicit URL Recovery

Artifact root:

```text
.opendevbrowser/tool-evaluation/fashion-studio-motion/harvest-url-recovery/inspiredesign/59a7b86b-4cf3-4b37-8023-4555b54207ca
```

Observed result:

- The generated URL recovery command is now executable with `--provider social/pinterest` and repeated `--url` flags.
- The recovery run produced the same useful and non-useful split as the query run: two screenshots captured, two required visuals missing, zero ranked references.
- It also returned `readiness=diagnostic_only`.
- `ranked-references.json` rejected all four references. Two were rejected as diagnostic-only `interface_chrome_shell`; two were captured but rejected because they did not satisfy design-ready ranking gates.

This means URL-aware recovery fixed the command-shape problem but did not fix the evidence-quality problem.

## Canvas Prototype Results

Canvas artifacts:

```text
.opendevbrowser/tool-evaluation/fashion-studio-motion/canvas-plan.set.json
.opendevbrowser/tool-evaluation/fashion-studio-motion/canvas-plan.browser.set.json
.opendevbrowser/tool-evaluation/fashion-studio-motion/canvas-document.patch.json
.opendevbrowser/tool-evaluation/fashion-studio-motion/canvas-document.browser-root.patch.json
.opendevbrowser/tool-evaluation/fashion-studio-motion/canvas-fix.patch.json
.opendevbrowser/tool-evaluation/fashion-studio-motion/canvas-preview-fixed.png
.opendevbrowser/tool-evaluation/fashion-studio-motion/fashion-studio-motion-prototype.canvas.json
.opendevbrowser/canvas/exports-canvas_499af791-0397-407e-9f98-35f94990c056.html
```

Observed result:

- Canvas session open worked without a browser, but `canvas.preview.render` later failed because preview needs a browser-bound session.
- A browser-bound Canvas session worked after launching extension mode against `https://example.com`.
- First `canvas.plan.set` failed because `motionPosture.level` rejected `expressive-but-contained`; accepted vocabulary required `subtle`.
- `canvas.document.patch` created a fashion-studio prototype with hero, chapter sequence, textile visual placeholder, final CTA, governance, and motion metadata.
- First patch produced `icon-policy-violation` because prose in `iconSystem.decorative` was interpreted as an icon family.
- Fix patch cleared Canvas warnings and real browser preview rendered with `renderStatus:"rendered"` and no render warnings.
- Debug trace had no exceptions and `blockerState:"clear"`.
- Feedback retained old warnings and errors even after the fix when polled with a cursor, so consumers must inspect document revision and latest render items instead of treating the returned list as current-only.
- The exported HTML ignored the requested `repoPath` and wrote to `.opendevbrowser/canvas/exports-canvas_499af791-0397-407e-9f98-35f94990c056.html`.

The prototype exists and renders, but it is brief-led rather than evidence-led because the Pinterest harvest never produced ranked usable references.

## Issues Identified

1. Harvest runtime still feels too slow for interactive design discovery.

The query and URL-recovery runs each took roughly multiple minutes and emitted no progress. This is a poor agent workflow because the command looks stalled until completion.

2. Harvest completion still creates too much non-actionable output.

The workflow writes full design and implementation artifacts even when `readiness=diagnostic_only` and `rankedReferences` is empty. The output is safer now because Canvas continuation is disabled, but the bundle still looks substantial enough to mislead downstream agents.

3. Pinterest search can find pin URLs but not design-ready references.

The browser-native recipe extracted Pinterest URLs, but only half captured screenshots, and none ranked as usable creative evidence. This suggests the missing layer is not just URL discovery. It needs a stronger visual pin or board selection loop that rejects bad pins before deep capture.

4. Recovery command shape improved, but recovery quality did not.

The generated explicit URL recovery command now runs. It does not materially improve readiness because it retries the same weak candidates.

5. Canvas handoff is correctly blocked by harvest readiness, but Canvas can still create a prototype directly.

This is correct from a safety standpoint. The direct prototype path worked only by making a deliberate brief-led Canvas plan and recording that rejected Pinterest evidence must not drive the design.

6. Canvas preview requires a browser-bound session, but the guidance does not make that obvious enough.

`canvas.session.open` without `browserSessionId` can accept plan and patch operations, but preview render fails later. Agents should be guided to open Canvas with a browser session when preview evidence is part of the workflow.

7. Canvas generation plan validation is strict but under-documented for motion values.

`motionPosture.level` rejected `expressive-but-contained`; `subtle` was accepted. Guidance should list accepted levels or provide field-specific examples for motion-heavy plans.

8. Canvas governance fields can accidentally become schema-significant.

Putting prose in `iconSystem.decorative` triggered an icon family validation error. Prose belongs in `notes.*` or another non-role field.

9. Canvas feedback polling returned stale revision feedback.

After revision 4 cleared warnings, `feedback.poll` still returned revision 2 and revision 3 warnings alongside current render info. That is useful history, but not a clean latest-state summary.

10. Canvas export ignored the requested HTML repo path.

The HTML export wrote to the default `.opendevbrowser/canvas/exports-<session>.html` path rather than the supplied `repoPath`. If intentional, docs should say `repoPath` is ignored for `html_bundle`; if not, the command should honor it.

## Recommended Fix Direction

1. Add progress reporting or phase summaries to `inspiredesign harvest`.

At minimum, print or emit phases for Pinterest navigation, URL extraction, capture attempts, ranking, and artifact writing.

2. Split diagnostic bundles from design-ready bundles.

When readiness is `diagnostic_only`, write a smaller diagnostic bundle by default, or clearly mark generated design files as blocked and non-authoritative.

3. Improve Pinterest candidate selection before deep capture.

The recipe should verify that collected pins or boards expose actual visual and brief-relevant metadata before committing them to deep capture.

4. Make recovery choose new candidates, not only retry rejected candidates.

Explicit URL recovery should be paired with a browser-native step that collects replacement pins or boards after inspecting why prior candidates failed.

5. Make Canvas preview prerequisites explicit in guidance.

When `browserSessionId` is absent, Canvas guidance should say preview render requires a browser-bound session and include a valid launch plus `canvas.session.open` example.

6. Add Canvas field examples for motion-heavy plans.

Expose accepted `motionPosture.level` values and keep advanced motion patterns in advisory fields.

7. Clarify Canvas feedback semantics.

Return a latest-only view or document that `feedback.poll` returns retained session history unless filters are used.

8. Clarify or fix `canvas.document.export` path behavior for `html_bundle`.

The command should either honor `repoPath` for HTML exports or report the default path decision clearly.

## Final Assessment

The current workflow can render a prototype through Canvas, but the Pinterest harvest portion still fails the intended product goal. It harvests URLs and screenshots, yet does not reliably produce usable design inspiration. The best next engineering target is not Canvas generation. It is the Pinterest browser-native harvest loop: progress visibility, candidate quality gating, and recovery that finds better references instead of retrying already rejected ones.
