---
name: data-extraction
description: Patterns for extracting structured data from web pages including tables, lists, and paginated content with OpenDevBrowser.
version: 1.0.0
---

# Data Extraction Skill

## Table Extraction

1. Navigate to page with data table:
   ```
   opendevbrowser_goto url="https://example.com/data"
   ```

2. Wait for table to load:
   ```
   opendevbrowser_wait state="networkidle"
   ```

3. Get table HTML structure:
   ```
   opendevbrowser_dom_get_html ref="[table-ref]"
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
   opendevbrowser_dom_get_text ref="[list-ref]"
   ```

For card-based layouts:
1. Identify repeating pattern
2. Extract each card's content individually

## Pagination Handling

### Numbered Pagination

1. Extract current page data
2. Find "Next" or page number button:
   ```
   opendevbrowser_snapshot
   ```
3. Click next page:
   ```
   opendevbrowser_click ref="[next-button-ref]"
   ```
4. Wait for new content:
   ```
   opendevbrowser_wait state="networkidle"
   ```
5. Repeat until no more pages

### Infinite Scroll

1. Extract visible data
2. Scroll to load more:
   ```
   opendevbrowser_scroll direction="down" amount=1000
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
2. Use `opendevbrowser_run` to serialize data:
   ```javascript
   return JSON.stringify(collectedData, null, 2);
   ```

## Handling Dynamic Content

For JavaScript-rendered content:

1. Wait for specific element to appear
2. Use network polling to detect data loading:
   ```
   opendevbrowser_network_poll
   ```
3. Take snapshot after XHR/Fetch completes

## Structured Data Detection

Look for embedded structured data:
- JSON-LD scripts: `<script type="application/ld+json">`
- Microdata attributes: `itemscope`, `itemprop`
- RDFa attributes: `typeof`, `property`

Extract via:
```
opendevbrowser_run script="return document.querySelector('script[type=\"application/ld+json\"]')?.textContent"
```

## Rate Limiting Considerations

When extracting large datasets:
- Add delays between page requests
- Monitor for rate limit responses (429 status)
- Respect robots.txt and terms of service
- Consider using persistent profile to maintain session
