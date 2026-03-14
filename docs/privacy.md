# Privacy Policy

**OpenDevBrowser Chrome Extension**

Last updated: March 13, 2026

## Overview

OpenDevBrowser is a browser automation extension that bridges the OpenDevBrowser plugin with Chrome for local development and testing purposes. This privacy policy explains how the extension handles your data.

## Data Collection

**We do not send your browsing data or page content to the developer or any third-party service.**

The extension:
- Does NOT send browsing history to external servers
- Does NOT send personal information to external servers
- Does NOT track user behavior
- Does NOT use analytics or telemetry
- May access page URLs, titles, and page content locally when you use automation or annotation features
- May store relay settings and the last user-triggered annotation payload locally on-device so the popup can reconnect and reopen recent annotation results

## How the Extension Works

The extension operates entirely on your local machine:

1. **Local Relay Connection**: The extension connects to a local relay server running on your machine (default: `127.0.0.1:8787`). This connection never leaves your computer.

2. **Chrome DevTools Protocol (CDP)**: The extension uses the `debugger` permission to interact with browser tabs via CDP. This enables automation features like clicking, typing, and capturing page snapshots.

3. **Tab Access**: The `tabs` permission is used to identify and manage browser tabs during automation sessions.

4. **Local Storage**: The `storage` permission stores your relay configuration (port, pairing token, pairing toggle) and the last annotation payload metadata locally in Chrome. When you explicitly capture or send annotation results, the extension can also persist a local copy of the last annotation payload without screenshots so the popup can reopen it. This data stays on-device.

## Data Flow

```
[OpenDevBrowser Plugin] <--127.0.0.1--> [Extension] <--CDP--> [Browser Tabs]
```

The relay and optional native-host transport stay local to your machine. OpenDevBrowser does not send browsing data, page content, or annotation payloads to the developer or to third-party analytics services. Websites you open in Chrome continue to exchange their own normal network traffic.

## Permissions Justification

| Permission | Purpose |
|------------|---------|
| `debugger` | Required for CDP access to automate browser tabs |
| `tabs` | Required to list and manage tabs during automation |
| `activeTab` | Required for user-initiated active-tab actions |
| `storage` | Required to persist relay configuration and the last local annotation payload metadata |
| `scripting` | Required to inject annotation/runtime scripts into pages during automation |
| `alarms` | Required for background reconnect and retry scheduling |
| `nativeMessaging` | Required for optional local native-host fallback |
| `http://127.0.0.1/*` | Required to reach the local relay/discovery endpoints on your machine |
| `<all_urls>` | Required to run automation/annotation flows across user-opened sites during local sessions |

## What Stays Local

- Relay configuration, pairing state, and health metadata stored in `chrome.storage.local`
- The last annotation payload metadata, plus a local copy of the last annotation payload without screenshots when you explicitly capture or send annotation results
- Full screenshots remain in memory for the active extension session unless you explicitly copy or send them through the local tooling flow

## Third-Party Services

The extension does not transmit browsing data or page content to analytics platforms or third-party APIs operated by OpenDevBrowser. It interacts only with the sites you choose to open in Chrome plus the local relay and optional local native host on your machine.

## Open Source

OpenDevBrowser is open source. You can review the published package contents at:
https://registry.npmjs.org/opendevbrowser

## Changes to This Policy

We may update this privacy policy from time to time. Any changes will be reflected in the "Last updated" date above.

## Contact

For questions about this privacy policy or the extension, please contact the maintainer at:
https://github.com/freshtechbro
