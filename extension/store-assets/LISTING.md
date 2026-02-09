# Chrome Web Store Listing

## Title (45 chars max)
OpenDevBrowser Relay

## Summary (132 chars max)
Connect OpenCode AI to your browser for automated testing, web scraping, and development workflows via Chrome DevTools Protocol.

## Description

### Overview
OpenDevBrowser Relay bridges the OpenDevBrowser plugin with your Chrome browser, enabling AI-powered browser automation for local development and testing.

### Key Features
- **Zero Config**: Works out of the box with sensible defaults
- **Local Only**: All communication stays on your machine (localhost)
- **Secure**: Token-based pairing prevents unauthorized access
- **Lightweight**: Permissions scoped to local relay + automation workflows, with background alarms used only for reconnect retries

### How It Works
1. Install the extension
2. Start OpenDevBrowser in OpenCode
3. The extension automatically connects to the local relay
4. AI can now interact with your browser tabs

### Use Cases
- Automated testing of web applications
- Web scraping and data extraction
- Form filling and validation testing
- Screenshot capture and visual regression
- Interactive debugging with AI assistance

### Privacy First
- No data collection or telemetry
- No external server communication
- All automation happens locally
- Open source and auditable

### Privacy Policy URL
https://github.com/freshtechbro/opendevbrowser/blob/main/docs/privacy.md

## Category
Developer Tools

## Language
English (United States)

## Permission Justifications

| Permission | Justification |
|------------|---------------|
| **debugger** | Required to access Chrome DevTools Protocol (CDP) for browser automation. Enables clicking, typing, screenshots, and DOM access. |
| **alarms** | Required to schedule reconnect retries when the relay is temporarily unavailable. |
| **tabs** | Required to list available browser tabs and identify targets for automation. |
| **storage** | Required to persist user preferences (relay port, pairing token) locally in Chrome. |
| **scripting** | Required to inject runtime/annotation scripts into active pages. |
| **activeTab** | Required for user-initiated actions against the currently active tab. |
| **nativeMessaging** | Required for optional local native-host fallback integration. |

## Host Permissions

| Host | Justification |
|------|---------------|
| `http://127.0.0.1/*` | Connect to local relay server running on your machine |
| `http://localhost/*` | Alternative localhost binding for relay connection |
| `<all_urls>` | Required to run automation and annotation flows across user-opened websites during local sessions |

## Screenshots Required

1. **screenshot-popup-disconnected.png** (1280x800)
   - Extension popup showing "Disconnected" state
   - Relay settings visible (port, token fields)

2. **screenshot-popup-connected.png** (1280x800)
   - Extension popup showing "Connected" state
   - Active target information displayed

3. **screenshot-automation-demo.png** (1280x800)
   - Split view: terminal with OpenCode on left, browser on right
   - Shows automation command and resulting browser action

## Promotional Images Required

1. **promo-small-440x280.png**
   - OpenDevBrowser logo centered
   - Tagline: "AI-Powered Browser Automation"
   - Clean, professional design

2. **promo-marquee-1400x560.png** (optional)
   - Feature showcase with icons
   - Logo + tagline + key benefits

## Store Icon
- **icon-store-128.png**: 128x128 PNG with square corners, no padding
- Use existing icon128.png from extension/icons/

## Additional Notes

### Review Expectations
- `debugger` permission triggers manual review (3-7 extra business days)
- Ensure privacy policy URL is accessible before submission
- All permissions are justified with clear use cases

### Compliance Checklist
- [x] Manifest V3 compliant
- [x] No eval() or remote code execution
- [x] No keyword stuffing in listing
- [x] Privacy policy hosted and accessible
- [x] All permissions are minimal and justified
- [x] Host permissions documented with localhost relay endpoints plus `<all_urls>` for automation scope
