# src/devtools/ — Agent Guidelines

DevTools integration: console and network tracking with redaction. Extends `src/AGENTS.md`.

## Overview

Captures browser console logs and network activity with automatic redaction of sensitive data (tokens, JWTs, API keys).

## Structure

```
src/devtools/
├── console-tracker.ts    # Console log capture with redaction
├── network-tracker.ts    # Request/response capture with URL redaction
└── exception-tracker.ts  # Exception/unhandled rejection tracking
```

## ConsoleTracker

Attaches to Playwright `Page`, captures console events:

```typescript
const tracker = new ConsoleTracker(maxEvents = 200, { showFullConsole });
tracker.attach(page);
const { events, nextSeq, truncated } = tracker.poll(sinceSeq = 0, max = 50);
```

**Redaction patterns:**
- JWT tokens (`eyJ...`)
- API key prefixes (`sk_`, `pk_`, `api_`, etc.)
- Token-like strings (16+ chars, mixed case + digits + symbols)
- Sensitive key-value pairs (`token=`, `key=`, `secret=`, etc.)

## NetworkTracker

Captures HTTP requests/responses:

```typescript
const tracker = new NetworkTracker(maxEvents = 300, { showFullUrls });
tracker.attach(page);
const events = tracker.poll(sinceSeq);
```

**Redaction:** URL path segments that look like tokens (20+ chars, high entropy) are replaced with `[REDACTED]`. Query strings and hashes are always stripped.

## Configuration

From `opendevbrowser.jsonc`:

```jsonc
{
  "devtools": {
    "showFullUrls": false,      // Show raw URLs vs redacted
    "showFullConsole": false    // Show raw console vs redacted
  }
}
```

## Privacy & Security

- **Never log raw tokens**: All patterns use regex redaction
- **Configurable**: Users can opt into full logging for debugging
- **Memory bounded**: Fixed-size circular buffers (200 console, 300 network)

## Anti-Patterns

| Never | Why |
|-------|-----|
| Attach tracker without detaching | Memory leak, duplicate handlers |
| Store full console/network logs | Privacy risk, memory bloat |
| Use `showFullConsole: true` in production | Secrets in logs |

## Testing

Test helpers exported via `__test__`:

```typescript
import { __test__ } from "../devtools/console-tracker";
const { redactText, shouldRedactToken } = __test__;
```
