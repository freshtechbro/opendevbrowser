# Provider Workflows

## Purpose

Codify minimal, repeatable workflows for provider-native automation.

## Inputs

- `sessionMode`: `managed|extension|cdpConnect`
- `provider`: `web|community|social`
- `requestId`: unique per workflow run
- `policyMode`: `read` (default) or `write` (explicit/manual opt-in only)

## Workflow A: Provider Search

1. Launch/connect mode.
2. Navigate to provider query URL.
3. Wait for load (`networkidle` preferred).
4. Snapshot actionables.
5. Extract result units with refs.
6. Poll network for request health.
7. Emit normalized records.

Expected output:
- `items[]` with `title/url/snippet/source/ts/requestId`

## Workflow B: Provider Fetch

1. Launch/connect mode.
2. Goto target URL/entity endpoint.
3. Wait and snapshot.
4. Extract typed fields.
5. Poll console/network for anomalies.

Expected output:
- one normalized entity record + diagnostics metadata

## Workflow C: Multipage Crawl

1. Seed queue with initial URL list.
2. Process one URL at a time:
- goto
- wait
- snapshot
- extract
- collect outgoing links
3. Canonicalize/dedupe links.
4. Enqueue until `maxDepth|maxPages` reached.
5. Persist records with page provenance.

Expected output:
- `records[]`
- `visited[]`
- `frontierStats`

## Workflow D: Social Read-Only Validation (Default)

1. Display read-only policy notice.
2. Navigate to social target and execute search/read probes only.
3. Capture `debug-trace-snapshot` + `network-poll`.
4. Record auth/blocker diagnostics and provider health.

Expected output:
- `readResult` + `authBlockerDiagnostics`
- `meta.primaryConstraintSummary` for the canonical follow-up summary
- `meta.primaryConstraint.guidance.reason` and `meta.primaryConstraint.guidance.recommendedNextCommands[]` when the workflow knows the next provider recovery step

## Workflow E: Parallel Multipage (Reliable As-Is)

1. Build a bounded frontier/queue in host logic.
2. Allocate one session per worker (`session-1`, `session-2`, ...).
3. In each worker session, process URLs serially:
- goto
- wait
- snapshot
- extract
- emit records with `sessionId` + page provenance
4. Never interleave competing `target-use` streams inside a single session.
5. For managed persistent profiles, assign a unique profile path per worker session.
6. Merge worker outputs deterministically (stable sort + dedupe key).

Expected output:
- `records[]` merged across workers
- `workerStats[]` with `{ sessionId, processed, failures }`
- `frontierStats` and checkpoint state

## Agent Pattern F: Pinterest Multi-Pin Design Harvest

This is guidance for agents using `inspiredesign harvest`; it is not a new product workflow, CLI command, or daemon method.

1. Run query discovery with `--query ... --provider social/pinterest`.
2. Read `meta.discovery.acceptedUrls` from the JSON output or artifact metadata.
3. Keep only canonical `https://www.pinterest.com/pin/<id>/` URLs.
4. Run the canonical harvest command once per selected pin with `--provider social/pinterest --url "https://www.pinterest.com/pin/<id>/"`.
5. In extension mode, the canonical harvest opens the exact pin in the extension before extracting pin-media bytes, which stabilizes live GIF and video pins.
6. Trust only outputs with `nextStepGuidance.readiness=ready`, non-empty `ranked-references.json`, and manifest-backed authority from `pin-media-index.json`, `screenshot-index.json`, or `motion-evidence.json`.
7. Use `media-analysis.json` as the deterministic design-fact surface for trusted saved pin media only; it can guide palette, tone, layout, OCR-free typography structure, text-region layout, and sampled motion decisions, but it never replaces `pin-media-index.json` readiness authority.
8. Do not claim readable text extraction, exact copy, font families, OCR, model vision, Tesseract, OpenCV, Sharp, browser canvas analysis, new dependencies, or raw `mediaAnalysis` in `canvas-plan.request.json`.

Expected output:
- one artifact bundle per selected canonical pin
- selected design directions backed by persisted first-party pin media, screenshot, or motion authority
- `media-analysis.json` may explain media-derived design facts, while `pin-media-index.json` remains the only pin-media readiness authority

## Release evidence lane

- Use `node scripts/provider-direct-runs.mjs --release-gate --out artifacts/release/vX.Y.Z/provider-direct-runs.json` for provider live release proof.
- Use `node scripts/live-regression-direct.mjs --release-gate --out artifacts/release/vX.Y.Z/live-regression-direct.json` for cross-surface live release proof.
- Treat `artifacts/release/vX.Y.Z/...` paths as local-only release proof outputs unless release policy explicitly requests publication.
- Treat parity matrix tests as contract coverage, not live release proof.
- Read `data.guidanceReason` and `data.recommendedNextCommand` in the provider-direct report before escalating a provider failure to manual follow-up.

## Failure Policy

- stale refs: re-snapshot and retry once
- repeated 403/429: stop and cooldown
- inconsistent mode behavior: flag parity failure
- workflow/provider follow-up: inspect `meta.primaryConstraintSummary` first, then `meta.primaryConstraint.guidance.reason`, then `meta.primaryConstraint.guidance.recommendedNextCommands[]`
