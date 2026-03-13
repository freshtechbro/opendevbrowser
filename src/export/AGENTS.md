# src/export/ — Agent Guidelines

DOM capture and React component export. Extends `src/AGENTS.md`.

## Overview

Extracts sanitized DOM as HTML with inline styles, and emits React components from captured pages.

## Structure

```
src/export/
├── dom-capture.ts     # Sanitized DOM extraction
├── css-extract.ts     # Computed style extraction with allowlist
└── react-emitter.ts   # React component code generation
```

## DOM Capture

```typescript
const capture = await captureDom(page, selector, {
  sanitize: true,     // Strip scripts, dangerous URLs
  maxNodes: 1000,     // Limit node count
  inlineStyles: true  // Inline computed styles
});
// Returns: { html, styles, warnings, inlineStyles }
```

**Sanitization:**
- Removes: `<script>`, `<iframe>`, `<object>`, event handlers (`onclick`)
- Blocks dangerous URLs: `javascript:`, `data:`, `vbscript:`
- Sanitizes CSS: blocks `url(`, `expression(`, `-moz-binding`
- Cleans SVG: removes `<script>`, `<foreignObject>`

## CSS Extraction

Allowlist-based style extraction:

```typescript
// STYLE_ALLOWLIST defines which CSS properties to capture
// SKIP_STYLE_VALUES filters out default/browser values
```

## React Emitter

Generates React component from captured DOM:

```typescript
const reactExport = emitReactComponent(capture, css, {
  allowUnsafeExport: false  // NEVER enable in production
});
// Returns: { component, css, warnings }
```

**Warning:** `allowUnsafeExport` disables sanitization — only for trusted internal testing.

## Configuration

```jsonc
{
  "export": {
    "maxNodes": 1000,
    "inlineStyles": true
  },
  "security": {
    "allowUnsafeExport": false  // Safety guard
  }
}
```

## Security

- **Sanitize by default**: All exports strip scripts and handlers
- **Dangerous URL blocking**: Prevents XSS vectors
- **Node limits**: Prevents memory exhaustion
- **CSS allowlist**: Only safe, computed styles

## Anti-Patterns

| Never | Why |
|-------|-----|
| `allowUnsafeExport: true` in production | XSS vulnerability |
| Skip sanitization | Script injection risk |
| Export infinite scroll pages | Memory exhaustion |

## Dependencies

- `playwright-core` - Page evaluation
- `../browser/*` - Session management
