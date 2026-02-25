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

## Failure Policy

- stale refs: re-snapshot and retry once
- repeated 403/429: stop and cooldown
- inconsistent mode behavior: flag parity failure
