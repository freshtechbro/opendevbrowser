# Provider Workflows

## Purpose

Codify minimal, repeatable workflows for provider-native automation.

## Inputs

- `sessionMode`: `managed|extension|cdpConnect`
- `provider`: `web|community|social`
- `requestId`: unique per workflow run
- `policyMode`: `read|write`

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

## Workflow D: Safe Post (Write Enabled)

1. Display policy notice.
2. Render payload preview.
3. Confirm action explicitly.
4. Execute one write action.
5. Poll network for status confirmation.
6. Record audit entry (`requestId`, payload hash, status).

Expected output:
- `writeResult` + `auditRecord`

## Failure Policy

- stale refs: re-snapshot and retry once
- repeated 403/429: stop and cooldown
- inconsistent mode behavior: flag parity failure
