---
name: data-extraction
description: This skill should be used when the user asks to "extract data from a page", "scrape tables", "collect paginated results", "parse list/card content", or "export structured web data" with OpenDevBrowser.
version: 1.1.0
---

# Data Extraction Skill

Use this guide to collect structured data from dynamic pages with predictable output quality.

## Extraction Planning

Define the schema before interacting:

1. Define output fields and required keys.
2. Identify page regions that contain those fields.
3. Capture a fresh snapshot and map refs to schema fields.

```text
opendevbrowser_snapshot sessionId="<session-id>" format="actionables"
```

## Table Extraction

For semantic HTML tables:

1. Wait for table visibility.
2. Snapshot and identify table/container refs.
3. Extract targeted table HTML.
4. Parse rows/cells in the host script.

```text
opendevbrowser_wait sessionId="<session-id>" until="networkidle"
opendevbrowser_dom_get_html sessionId="<session-id>" ref="<table-ref>"
```

For virtualized or grid UIs, extract per-row/card refs and normalize in post-processing.

## List and Card Extraction

For repeated list/card content:

1. Snapshot and identify repeating item refs.
2. Extract only needed nodes per item (`title`, `price`, `meta`, `url`).
3. Normalize records to a stable schema.

```text
opendevbrowser_dom_get_text sessionId="<session-id>" ref="<item-title-ref>"
opendevbrowser_get_attr sessionId="<session-id>" ref="<item-link-ref>" name="href"
```

## Pagination Patterns

### Numbered or Next/Previous Pagination

1. Extract current page records.
2. Click next/page ref.
3. Wait for load.
4. Re-snapshot and continue until terminal state.

```text
opendevbrowser_click sessionId="<session-id>" ref="<next-ref>"
opendevbrowser_wait sessionId="<session-id>" until="networkidle"
opendevbrowser_snapshot sessionId="<session-id>" format="actionables"
```

### Infinite Scroll

1. Extract visible records.
2. Scroll incrementally.
3. Wait for newly loaded items.
4. Stop when no new unique records appear.

```text
opendevbrowser_scroll sessionId="<session-id>" dy=1000
opendevbrowser_wait sessionId="<session-id>" until="networkidle"
```

### Load More Button

1. Extract visible records.
2. Click load-more ref.
3. Wait and re-snapshot.
4. Repeat until button disappears or no new data arrives.

## Structured Data Shortcuts

When available, prefer embedded structured data:

- JSON-LD scripts
- Microdata attributes (`itemscope`, `itemprop`)

```text
opendevbrowser_dom_get_text sessionId="<session-id>" ref="<json-ld-script-ref>"
```

Parse JSON-LD in the host script and merge with extracted UI records if needed.

## Quality Controls

Apply quality checks during extraction:

- Deduplicate by stable key (URL, ID, composite key).
- Track page number and source URL per record.
- Record null/missing fields explicitly.
- Validate record counts per page before continuing.

Use `opendevbrowser_network_poll` when extraction depends on API completion.

```text
opendevbrowser_network_poll sessionId="<session-id>" max=50
```

## Export Pattern

Perform export in the host environment (outside tool calls):

- Normalize to JSON for structured pipelines.
- Convert to CSV only after schema normalization.
- Keep raw extraction artifacts when auditability is required.

## Compliance and Rate Limits

Follow site constraints:

- Respect robots, terms, and legal boundaries.
- Add pacing between page transitions when needed.
- Stop on repeated 429/403 responses and apply cooldown/retry policy.
