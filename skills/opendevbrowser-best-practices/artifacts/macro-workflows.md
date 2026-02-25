# Macro Workflows

## Purpose

Define concise macro entrypoints that expand into repeatable provider workflows.

## Macro Contract

Each macro should declare:

- `macro`: stable name
- `provider`: `web|community|social`
- `mode`: `managed|extension|cdpConnect`
- `policyMode`: `read|write`
- `requestId`: required correlation id

## Recommended Macros

### `provider.search`

- Expands to launch/connect + goto + wait + snapshot + extract + network poll.
- Output: normalized result set with provenance fields.

### `provider.crawl`

- Expands to bounded multipage loop (queue + dedupe + depth/page limits).
- Output: `records[]`, `visited[]`, and crawl stats.

### `qa.debug`

- Expands to snapshot + console poll + network poll + screenshot.
- Output: trace bundle for triage.

### `safe.post`

- Expands to notice + preview + explicit confirmation + single write action.
- Output: write result and audit metadata.

## Expansion Rules

- Keep expansions deterministic and minimal.
- Emit provenance metadata (`macro`, `resolvedQuery`, `provider`, `mode`).
- Never hide write actions behind implicit macro behavior.
