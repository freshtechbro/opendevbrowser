# Chrome Web Store Listing

## Official URLs

- Homepage URL: `https://opendevbrowser.dev`
- Privacy policy URL: `https://github.com/freshtechbro/opendevbrowser/blob/main/docs/privacy.md`
- Support / source URL: `https://github.com/freshtechbro/opendevbrowser`

## Primary Store Fields

### Title

- Limit: `45` chars
- Count: `20`
- Value: `OpenDevBrowser Relay`

### Summary

- Limit: `132` chars
- Count: `108`
- Value: `Attach OpenDevBrowser to logged-in Chrome tabs so agents can inspect, automate, annotate, and debug locally.`

### Single Purpose Description

- Count: `105`
- Value: `Connect OpenDevBrowser to existing Chrome tabs so it can inspect and automate them through a local relay.`

### Detailed Description

OpenDevBrowser Relay connects OpenDevBrowser to the Chrome tabs you already have open. It lets the runtime attach to a real headed browser session, reuse logged-in state, inspect the page, drive actions, capture annotations, and participate in local browser replay capture without launching a separate browser.
Generated help in the public package also surfaces adjacent runtime lanes for browser replay, public read-only desktop observation, and browser-scoped challenge handling. This extension participates in the relay-backed browser lane only; it is not a desktop agent.

What it delivers today:
- Reuses existing Chrome tabs through a local relay on `127.0.0.1`
- Attaches Chrome DevTools Protocol with `debugger` for inspect and action loops
- Injects page-side helpers with `scripting` for annotation, DOM capture, and in-tab automation
- Participates in user-triggered local browser replay capture through the existing screenshot lane
- Stores relay settings plus the last local annotation payload metadata so the popup can reconnect and reopen recent results
- Shows relay, handshake, annotate, injected, `CDP`, pairing, and native fallback health directly in the popup

Important behavior notes:
- The relay and optional native host stay on-device
- OpenDevBrowser does not send browsing data, page content, or annotation payloads to the developer or third-party analytics services
- Browser replay manifests, preview images, and sampled frames stay on-device in the chosen output directory
- Public desktop observation is a separate read-only core runtime lane and is not provided by this extension
- Bounded challenge automation remains browser-scoped and does not turn the extension into a desktop-control surface
- The extension can act on user-opened sites because it needs `<all_urls>` for automation, annotation, DOM capture, and screenshot fallback
- Restricted pages such as `chrome://`, `chrome-extension://`, and Chrome Web Store pages are not supported targets

## Category

- `Developer Tools`

## Language

- `English (United States)`

## Upload Justifications

### Single Purpose Justification

The extension has one purpose: bridge OpenDevBrowser to the Chrome tabs the user already has open so the runtime can inspect, automate, and annotate those tabs through the local relay.

### Permission Justification

The permission set is limited to three needs: attach to Chrome tabs, inject page helpers for automation/annotation, and reach the local relay or optional local native host that keeps the workflow on-device.

### `debugger` Justification

`debugger` is required to attach Chrome DevTools Protocol to the selected tab and forward inspect, snapshot, click, type, and screenshot commands from OpenDevBrowser.

### `webNavigation` Justification

`webNavigation` is required to observe popup and tab-opening navigation targets so the extension can preserve opener ownership when Chrome omits `tabs.onCreated.openerTabId` during local automation flows.

### `alarms` Justification

`alarms` is required for background reconnect and retry scheduling when the local relay is temporarily unavailable.

### `tabs` Justification

`tabs` is required to read, activate, update, create, and close Chrome tabs so OpenDevBrowser can attach to the right user-opened page and keep that target in sync.

### `storage` Justification

`storage` is required to keep relay settings, pairing state, relay identity metadata, and the last local annotation payload metadata on-device in `chrome.storage.local`.

### `scripting` Justification

`scripting` is required to inject annotation and runtime helpers into the active page for DOM capture, overlay rendering, and in-tab automation tasks.

### `activeTab` Justification

`activeTab` is required for user-triggered actions from the popup or command shortcut against the current tab, including attach fallback and visible-tab capture flows.

### `nativeMessaging` Justification

`nativeMessaging` is required only for the optional local native-host fallback path when the relay is unavailable.

### Host Permission Justification

`http://127.0.0.1/*` is required for local relay discovery, pairing, and extension transport on the user’s machine. `<all_urls>` is required so the extension can inject helpers, inspect DOM state, capture annotations, and automate whichever user-opened site is the active target.

## Recommended Privacy Questionnaire Answers

Use these answers as the starting point for the current Chrome Web Store dashboard wording.

### Data Handling Summary

- The extension may access page URLs, titles, page content, and screenshots locally when the user runs automation or annotation flows.
- The extension may participate in user-triggered browser replay capture locally; replay manifests, preview images, and sampled frames stay on-device in the chosen output directory.
- The extension does not capture desktop data; any separate desktop observation flow is read-only and handled by the local core runtime rather than the extension.
- The extension stores relay settings, pairing state, relay identity metadata, and the last local annotation payload metadata on-device.
- The extension does not sell browsing data.
- The extension does not send browsing data, page content, or annotation payloads to the developer or third-party analytics services.

### Recommended Responses

- Does the extension sell user data? `No`
- Does the extension use user data for unrelated purposes such as ads or profiling? `No`
- Does the developer receive browsing data, page content, or annotation payloads from the extension? `No`
- Does the extension access website content or user-opened pages to provide its feature? `Yes, locally on-device as part of automation and annotation`
- Is the retained extension state stored locally? `Yes`
- Is remote transmission to OpenDevBrowser-operated servers required for the extension feature to work? `No`

### Data Types To Disclose If The Form Asks For Accessed Data

- Website content
- Page URLs and titles
- User-triggered screenshots / visible-tab captures
- Local replay artifacts
- Extension settings and pairing state
- Local annotation payload metadata

## Reviewer Test Instructions

### Prerequisites

- Chrome `125+`
- Node.js `18+`
- A normal `http` or `https` tab open in Chrome

### Steps

1. Clone the repo and run `npm install`.
2. Build the package and extension:
   - `npm run build`
   - `npm run extension:build`
3. In Chrome, open `chrome://extensions`, enable Developer Mode, and load the unpacked `extension/` directory from this repo.
4. Start the local relay:
   - `npx opendevbrowser serve`
5. Open a normal `http` or `https` tab.
6. Open the extension popup and keep the default settings:
   - Relay port `8787`
   - Auto-connect `on`
   - Auto-pair `on`
   - Require pairing token `on`
   - Native fallback `off`
7. Click `Connect`.
8. Expected result:
   - Status pill changes to `Connected`
   - Status note shows `Connected to 127.0.0.1:8787`
   - Diagnostics populate for relay / handshake / `CDP`
   - The annotation panel remains visible
9. To verify the disconnected state, stop the relay or click `Disconnect`, then reopen the popup.

### Reviewer Notes

- The extension cannot attach to `chrome://`, `chrome-extension://`, or Chrome Web Store pages.
- The extension’s relay/native-host paths are local-only.
- Desktop observation is a separate read-only runtime lane and should not be interpreted as an extension-owned desktop-control feature.
- `<all_urls>` is needed because the feature works on whichever user-opened site is the current automation target.

## Asset Checklist

### Screenshots

1. `screenshot-popup-connected.png`
   - Full current popup
   - `Connected` status pill
   - Settings, diagnostics, annotation panel, and `Disconnect` CTA visible

2. `screenshot-popup-disconnected.png`
   - Full current popup
   - `Disconnected` status pill
   - Default relay settings visible
   - Diagnostics and annotation panel still visible

3. `screenshot-automation-demo.png`
   - OpenDevBrowser driving a real Chrome tab through the local relay
   - OpenCode / terminal action on one side and the browser outcome on the other

### Promo Images

1. `promo-small-440x280.png`
2. `promo-marquee-1400x560.png`

### Store Icon

- `icon-store-128.png` should match `extension/icons/icon128.png`
