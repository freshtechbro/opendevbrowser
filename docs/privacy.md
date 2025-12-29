# Privacy Policy

**OpenDevBrowser Chrome Extension**

Last updated: December 28, 2025

## Overview

OpenDevBrowser is a browser automation extension that bridges the OpenDevBrowser plugin with Chrome for local development and testing purposes. This privacy policy explains how the extension handles your data.

## Data Collection

**We do not collect, store, or transmit any personal data.**

The extension:
- Does NOT collect browsing history
- Does NOT collect personal information
- Does NOT track user behavior
- Does NOT use analytics or telemetry
- Does NOT communicate with external servers

## How the Extension Works

The extension operates entirely on your local machine:

1. **Local Relay Connection**: The extension connects to a local relay server running on your machine (default: `localhost:8787`). This connection never leaves your computer.

2. **Chrome DevTools Protocol (CDP)**: The extension uses the `debugger` permission to interact with browser tabs via CDP. This enables automation features like clicking, typing, and capturing page snapshots.

3. **Tab Access**: The `tabs` permission is used to identify and manage browser tabs during automation sessions.

4. **Local Storage**: The `storage` permission stores your relay configuration (port, pairing token, pairing toggle) locally in Chrome. This data never leaves your browser.

## Data Flow

```
[OpenDevBrowser Plugin] <--localhost--> [Extension] <--CDP--> [Browser Tabs]
```

All communication occurs locally on your machine. No data is sent to external servers.

## Permissions Justification

| Permission | Purpose |
|------------|---------|
| `debugger` | Required for CDP access to automate browser tabs |
| `tabs` | Required to list and manage tabs during automation |
| `storage` | Required to persist relay configuration locally |

## Third-Party Services

The extension does not integrate with any third-party services, analytics platforms, or external APIs.

## Open Source

OpenDevBrowser is open source. You can review the complete source code at:
https://github.com/anthropics/opendevbrowser

## Changes to This Policy

We may update this privacy policy from time to time. Any changes will be reflected in the "Last updated" date above.

## Contact

For questions about this privacy policy or the extension, please open an issue on our GitHub repository.
