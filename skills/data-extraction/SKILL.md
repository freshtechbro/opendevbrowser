---
name: data-extraction
description: Patterns for extracting structured data from web pages including tables, lists, and paginated content with OpenDevBrowser.
version: 1.0.0
---

# Data Extraction Skill

## Table Extraction

1. Navigate to page with data table:
   ```
   opendevbrowser_goto sessionId="<session-id>" url="https://example.com/data"
   ```

2. Wait for table to load:
   ```
   opendevbrowser_wait sessionId="<session-id>" until="networkidle"
   ```

3. Get table HTML structure:
   ```
   opendevbrowser_dom_get_html sessionId="<session-id>" ref="[table-ref]"
   ```

4. Parse the HTML to extract rows and cells.

### Common Table Patterns

Standard HTML tables:
```html
<table>
  <thead><tr><th>Header</th></tr></thead>
  <tbody><tr><td>Data</td></tr></tbody>
</table>
```

CSS-based grids:
```html
<div class="grid">
  <div class="row">
    <div class="cell">Data</div>
  </div>
</div>
```

## List Extraction

For unordered/ordered lists:
1. Identify list container ref
2. Extract text content:
   ```
   opendevbrowser_dom_get_text sessionId="<session-id>" ref="[list-ref]"
   ```

For card-based layouts:
1. Identify repeating pattern
2. Extract each card's content individually

## Pagination Handling

### Numbered Pagination

1. Extract current page data
2. Find "Next" or page number button:
   ```
   opendevbrowser_snapshot sessionId="<session-id>"
   ```
3. Click next page:
   ```
   opendevbrowser_click sessionId="<session-id>" ref="[next-button-ref]"
   ```
4. Wait for new content:
   ```
   opendevbrowser_wait sessionId="<session-id>" until="networkidle"
   ```
5. Repeat until no more pages

### Infinite Scroll

1. Extract visible data
2. Scroll to load more:
   ```
   opendevbrowser_scroll sessionId="<session-id>" dy=1000
   ```
3. Wait for new content
4. Repeat until no new items appear

### Load More Button

1. Extract visible data
2. Click "Load More":
   ```
   opendevbrowser_click ref="[load-more-ref]"
   ```
3. Wait for new content
4. Repeat until button disappears

## Data Export Workflow

1. Collect all extracted data in structured format
2. Serialize/export in your host script (outside OpenDevBrowser tools), for example as JSON/CSV in your test runner.

## Handling Dynamic Content

For JavaScript-rendered content:

1. Wait for specific element to appear
2. Use network polling to detect data loading:
   ```
   opendevbrowser_network_poll sessionId="<session-id>"
   ```
3. Take snapshot after XHR/Fetch completes

## Structured Data Detection

Look for embedded structured data:
- JSON-LD scripts: `<script type="application/ld+json">`
- Microdata attributes: `itemscope`, `itemprop`
- RDFa attributes: `typeof`, `property`

Extract via:
```
opendevbrowser_snapshot sessionId="<session-id>"
opendevbrowser_dom_get_text sessionId="<session-id>" ref="[json-ld-script-ref]"
```

## Rate Limiting Considerations

When extracting large datasets:
- Add delays between page requests
- Monitor for rate limit responses (429 status)
- Respect robots.txt and terms of service
- Consider using persistent profile to maintain session
