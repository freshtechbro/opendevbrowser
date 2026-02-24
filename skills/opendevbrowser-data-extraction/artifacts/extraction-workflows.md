# Extraction Workflows

## List/Card workflow

1. Snapshot actionables
2. Map repeating nodes
3. Extract title/price/link fields
4. Normalize and dedupe records
5. Record parse confidence and currency normalization status

## Table workflow

1. Wait for table visibility
2. Extract table HTML
3. Parse rows/cells in host process
4. Validate schema completeness

## Pagination workflow

1. Extract current page
2. Advance page
3. Wait + snapshot
4. Repeat until terminal condition
5. Persist checkpoint state every page

## Anti-bot pressure workflow

1. Detect repeated 403/429/challenge
2. Parse and honor `Retry-After` if present
3. Slow down / cooldown and resume from last checkpoint
4. Stop and report if pressure persists after bounded retries
