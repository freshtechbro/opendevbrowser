# Non-Extension Session Parity Research

Date: 2026-07-03

Status: research and implementation plan only. No production code changed.

Research journal: `.omo/ulw-research/20260703-183942-non-extension-session-parity/`

## Executive Summary

OpenDevBrowser can already do substantial non-extension work. Managed sessions and direct `cdpConnect` share target switching, cookie import/list, session inspector, console/network/debug trace, screenshot, and screencast machinery. A safe local smoke confirmed a managed headless temporary-profile session can launch `https://example.com`, list targets, capture a screenshot, and disconnect. The first smoke also proved a real friction point: the default persisted automation profile can be locked by another Chrome process, so novice-safe non-extension setup needs explicit profile lifecycle handling and clearer retry guidance.

The extension remains the safest current path for live active-tab reuse in a signed-in daily Chrome profile, especially for user-owned Google OAuth. The current code and docs intentionally fail closed for `--google-auth-intent user-owned` outside extension `/ops`. That should not be weakened. Chrome and Playwright now both reinforce the same direction: default-profile automation and default-profile remote debugging are unsafe or unsupported. Chrome 136+ requires a non-standard `--user-data-dir` for remote debugging, and Playwright warns against automating the regular Chrome user profile.

The recommended path to non-extension parity is not "copy all cookies into headless." It is a profile and provenance architecture:

1. Keep extension `/ops` as the best live active-tab path for a user's already-open daily Chrome session.
2. Add a first-class direct-CDP attach lane for user-started Chrome that uses an explicit non-default `--user-data-dir`.
3. Make managed headed persistent OpenDevBrowser profiles the default non-extension power-user path for login-required workflows.
4. Keep managed headless for public, fixture, CI, and storage-state workflows that do not require human login UI.
5. Treat explicit cookie import as scoped continuity and diagnostics, never as proof of Google login.
6. Improve session inspector/auth provenance so agents can tell whether a workflow is auth-capable before trying the wrong path.

## Method And Evidence

Local code evidence came from repo source, docs, tests, generated CLI help, codegraph exploration, and one safe runtime smoke. External claims use primary or official sources where available and were accessed on 2026-07-03.

Key local evidence artifacts:

- `.omo/ulw-research/20260703-183942-non-extension-session-parity/local-source-search.md`
- `.omo/ulw-research/20260703-183942-non-extension-session-parity/local-help-status-evidence.md`
- `.omo/ulw-research/20260703-183942-non-extension-session-parity/source-excerpts-for-report.md`
- `.omo/ulw-research/20260703-183942-non-extension-session-parity/test-excerpts-for-report.md`
- `.omo/ulw-research/20260703-183942-non-extension-session-parity/managed-headless-smoke/evidence.md`
- `.omo/ulw-research/20260703-183942-non-extension-session-parity/managed-headless-smoke-temp-profile/evidence.md`
- `.omo/ulw-research/20260703-183942-non-extension-session-parity/claim-ledger.md`

Safe runtime probe:

- `npx opendevbrowser launch --no-extension --headless --start-url https://example.com --output-format json` failed because the default persisted automation profile was locked, and the CLI returned retry guidance.
- `npx opendevbrowser launch --no-extension --headless --persist-profile false --start-url https://example.com --output-format json` succeeded in managed mode, imported sanitized best-effort cookies, skipped Google-sensitive cookies, listed the `Example Domain` target, captured a screenshot, and disconnected.

## Current Architecture Baseline

OpenDevBrowser's public contract currently defines three browser session modes:

- Extension relay: default preferred active-tab path, including `/ops`, `/canvas`, legacy `/cdp`, and `/annotation` relay lanes. See `README.md:516-533`, `docs/ARCHITECTURE.md:306-311`, and `docs/SURFACE_REFERENCE.md:548-569`.
- Managed: `--no-extension`, with `--headless` as managed-only. See `README.md:121-124`, `docs/CLI.md:740`, and `docs/ARCHITECTURE.md:349`.
- Direct `cdpConnect`: attach to an existing browser endpoint. See `src/browser/browser-manager.ts:1891-1905` and `README.md:530-533`.

The implementation already shares many browser capabilities across managed and direct CDP:

- `BrowserManager.launch()` creates a persistent Playwright context, registers pages in `TargetManager`, initializes trackers, and bootstraps readable system Chrome cookies unless disabled. See `src/browser/browser-manager.ts:1731-1853`.
- `BrowserManager.connect()` resolves a CDP endpoint and uses the same internal connection path. See `src/browser/browser-manager.ts:1891-1905`.
- Managed/CDP sessions share status, target listing, target use, cookie import/list, debug trace, screenshot, and screencast paths. See `src/browser/browser-manager.ts:2028-2063`, `src/browser/browser-manager.ts:2145-2167`, `src/browser/browser-manager.ts:2268-2283`, and `src/browser/browser-manager.ts:3378-3799`.
- `TargetManager` owns active target and named page state independent of extension mode. See `src/browser/target-manager.ts:18-238`.

The extension adds a higher-level negotiated control plane:

- `/extension` handles daemon-extension handshake, pairing, tab identity, heartbeat, and health. See `extension/src/services/ConnectionManager.ts:299-336` and `extension/src/services/ConnectionManager.ts:577-661`.
- `/ops` is a high-level automation protocol, not just raw CDP. `OpsBrowserManager.connectRelay()` connects to `/ops`, obtains an ops session and lease, and records live-extension auth provenance. See `src/browser/ops-browser-manager.ts:263-319`.
- `/cdp` is the legacy websocket lane. Inside the extension, it is routed through flat-session bookkeeping, not a raw unowned pipe. See `extension/src/services/CDPRouter.ts:170-330` and `extension/src/services/TargetSessionMap.ts:33-110`.
- `/canvas` and `/annotation` are separate relay protocols. See `src/relay/protocol.ts:270` and `src/relay/protocol.ts:468`.
- Relay security is local-only, origin-gated, token-paired, and rate-limited. See `src/relay/relay-server.ts:180-270` and `src/relay/relay-server.ts:1857`.

## Extension-Dependency Inventory

Legend: "required" means the feature is intentionally blocked or materially unavailable without extension today. "preferred" means extension is safest or most reliable. "defaulted" means the public surface defaults to extension but alternate modes exist. "gap" means CDP/managed can likely replace it with implementation work.

| Feature or workflow | Public surface | Current supported modes | Extension status | Why extension is currently used | State/auth/session requirement | Can CDP or managed provide equivalent behavior? | Required implementation seam | Safety risks | Tests needed | Docs or skill updates | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Logged-in session reuse / live active-tab reuse | `launch`, tools, `/ops` | extension yes; managed headed no active user tab; managed headless no; direct CDP partial | preferred | Reuses already-open signed-in tabs without copying storage | Full live browser profile and current tab | Direct CDP can if user launched Chrome with remote debugging and explicit profile | CDP target discovery plus attach wizard | Default-profile remote debugging, wrong-profile attach | CDP attach integration and target selection tests | Add direct-CDP setup guide | P0 |
| User-owned Google OAuth continuity | `--google-auth-intent user-owned` | extension only; managed blocked; headless blocked; direct CDP blocked | required today | Current fail-closed safety model routes user-owned Google to live extension `/ops` | Coherent Google session beyond cookies | Maybe only via explicit user-started non-default CDP profile, not cookie copy | New `googleAuthIntent` policy for explicit non-default CDP profile | Account/session invalidation, DBSC, App-Bound Encryption, popup routing | Policy tests, provenance tests, owned test-account e2e only | Update CLI/help/skills with safe CDP exception if implemented | P0 |
| System Chrome cookie bootstrap | `launch`, `connect`, `diagnostics.authProvenance` | extension skips; managed yes; headless yes; direct CDP yes | not required | Non-extension continuity aid | Readable cookie DB, sanitized metadata | Already exists, but not auth proof | Improve preflight and diagnostics | Cookie leakage, partial login state | Existing tests plus partitioned/CHIPS cases | Stress "not login proof" | P0 |
| Explicit cookie import/list | `cookie-import`, `cookie-list`, provider `--use-cookies` | extension yes; managed yes; headless yes; direct CDP yes | not required | Provider continuity and debugging | Scoped cookie jar and domain policy | Already mostly equivalent | Add provenance/readiness scoring | Secret exposure, overbroad import | CLI validation, sanitized output, CHIPS fields | Add safe examples | P1 |
| Provider `--use-cookies` | `research`, `shopping`, `product-video`, `inspiredesign` | extension yes; managed yes; headless partial; direct CDP partial | preferred for live logged-in sites | Uses available session cookies for high-friction providers | Provider-specific auth, cookie policy | Managed headed persistent profile can replace many cases | Provider-level auth capability contract | Treating cookies as auth proof | Provider runtime policy tests | Update skills to route by auth capability | P0 |
| `research run` | CLI workflow | extension yes; managed yes; headless yes; direct CDP partial | defaulted only for some guidance | Browser fallback and challenge handling | Usually public, sometimes auth | Managed/headless sufficient for public research | Auth capability preflight | Auth-required sources, anti-bot pressure | Mode matrix live scenarios | Recommend managed first for public runs | P1 |
| `shopping run` | CLI workflow | extension yes; managed yes; headless partial; direct CDP partial | preferred only for logged-in retailers | Cookies/challenges can matter | Retail auth, region/session continuity | Managed headed profile can replace most | Per-provider auth and challenge policy | Wrong region/account leakage | Provider fixtures plus live opt-in | Managed profile quickstart | P1 |
| `product-video run` | CLI workflow | extension yes; managed yes; headless partial; direct CDP partial | not hard required | Delegates product resolution to shopping | Product source evidence | Managed/browser fallback can replace most | Inherit shopping auth capability | Marketplace chrome pollution | Product-video workflow regressions | Mention no independent auth model | P2 |
| `inspiredesign run` public URLs | CLI workflow | extension yes; managed yes; headless partial; direct CDP partial | not required | Screenshots/deep capture can use browser | Public visual references | Managed headed/headless usually enough | Better mode recommendations | Blocking pages/challenges | Visual evidence mode tests | Recommend managed for public refs | P1 |
| Pinterest broad-query `inspiredesign harvest` | CLI workflow and skill guidance | extension preferred; managed partial; headless weak; direct CDP gap | preferred today | Logged-in Pinterest search and exact pin opening are brittle without active profile | Pinterest login, canonical pins, first-party media bytes | Managed headed persistent Pinterest profile or explicit CDP profile could replace extension | Pin-media capture through managed/CDP plus profile auth preflight | Diagnostic-only outputs, search shell, account lockouts | Live owned Pinterest test profile, authority checks | Update recovery guidance and no-CANVAS gates | P0 |
| Pinterest explicit pin recovery | `inspiredesign harvest --url` | extension preferred; managed possible; headless weak; direct CDP possible | preferred today | Uses active tab/cookies and byte-backed media capture | First-party pin media evidence | Yes if profile is authenticated and capture runs in same context | CDP/managed pin-media parity test harness | Media URL leakage, product false positive | `pin-media-index.json` product-ready tests | Add extensionless recovery commands | P0 |
| Challenge automation `off` | `--challenge-automation-mode off` | all modes | not required | Disables helper lane | None | Equivalent | No change | False confidence after blocker | Policy tests | No major change | P2 |
| Challenge automation `browser` | `--challenge-automation-mode browser` | extension yes; managed yes; headless partial; direct CDP partial | not required | Browser-scoped challenge observation | Browser page context | CDP/managed can support most browser-scoped actions | Helper surface abstraction | Anti-abuse, automated challenge solving | Challenge policy e2e | Clarify browser-scoped only | P1 |
| Challenge automation `browser_with_helper` | `--challenge-automation-mode browser_with_helper` | extension yes; managed headed yes; headless limited; direct CDP partial | preferred for interactive headed flows | Browser helper can assist visual/browser interactions | Human-visible browser surface | Managed headed yes; headless no for human challenge | Capability detector by mode | Over-automation, sensitive login | Helper eligibility tests | Update help with mode support | P1 |
| OAuth popup/new-tab flows | `targets-list`, `target-use`, inspector guidance | extension strong; managed/CDP partial | preferred | Extension has opener/child session routing and recovery | Multi-target ownership | CDP Target domain can replace with work | Target ownership graph and popup routing service | Wrong target action, account chooser confusion | Popup fixture tests with synthetic OAuth | New popup recovery guide | P0 |
| Target list/use/named pages | CLI/tools | all modes | not required | Extension adds relay child-session bridge | Page/tab registry | Already mostly equivalent | CDP target graph parity | Concurrent target-use crosstalk | Target manager and extension ops parity tests | Existing guidance mostly enough | P1 |
| Snapshot/ref/action loop | tools and CLI | all browser modes | not required | Extension can recover attached live tabs | Page DOM/AX refs | Already equivalent for managed/CDP pages | CDP fallback for detached targets | Stale refs after popups | Managed/CDP action loop tests | Mode parity examples | P1 |
| Screenshots/screencasts/replay | `screenshot`, `screencast-start/stop` | all modes, extension has timeout fallback | not required | Extension legacy CDP fallback for screenshots | Page capture | CDP Page capture can improve all modes | Generalize CDP screenshot/screencast fallback | Capturing sensitive pages | Replay artifact tests by mode | Clarify evidence lanes | P1 |
| Console/network/debug trace/session inspector | CLI/tools | all modes | not required | Extension ops bridges trackers over relay | Trackers plus target status | Already mostly equivalent | Add auth capability fields | URL/account leakage in traces | Redaction/provenance tests | Add auth-capability output docs | P0 |
| Annotation storage/retrieval | `annotate`, `/annotation`, inbox | direct/relay supported; extension needed for extension-local UI | preferred for extension-local capture | In-page extension UI and storage bridge | Page UI plus local inbox | Direct Playwright/CDP annotation exists, but extension UI remains unique | Browser-injected annotation parity or direct overlay | Capturing sensitive screenshots/notes | Direct vs relay annotation tests | Clarify direct annotation path | P2 |
| Design canvas `/canvas` | `canvas` commands | extension canvas runtime yes; managed preview paths partial | required for extension-hosted design tab | Extension owns canvas design-tab runtime and overlay sync | Canvas session/document state | Core canvas document APIs yes; extension-hosted UI no | Non-extension web canvas host or managed design tab | State desync, payload privacy | Canvas runtime parity tests | Document canvas host options | P2 |
| Native messaging and extension pairing | install/extension | extension only | required for extension lane | Pairing and native fallback are extension infrastructure | Localhost relay token | Not relevant to non-extension | Keep separate | Token leakage | Existing relay/native tests | Do not present as non-extension need | P2 |
| Direct `/ops`, `/cdp`, relay status semantics | status, relay internals | extension relay only; direct CDP separate | required for relay | Relay health and client presence | Extension websocket clients | Direct CDP status can expose different health | Separate `cdpAttach` status schema | Misreading `cdpConnected` | Status tests | Clarify fields are lane-specific | P0 |

## CDP And Managed-Mode Parity Analysis

CDP can cover most browser-control primitives that currently feel extension-bound:

- Target discovery and popup ownership: `Target.*` supports discovery, attach, auto-attach, and session routing. This is the primary replacement seam for extension `TargetSessionMap` behavior. Source: Chrome DevTools Protocol Target domain, accessed 2026-07-03, https://chromedevtools.github.io/devtools-protocol/tot/Target/
- Page inspection: `Runtime.evaluate`, `DOM`, `DOMSnapshot`, and `Accessibility` cover in-page JavaScript execution, DOM shape, DOM snapshots, and AX-tree inspection. Sources: https://chromedevtools.github.io/devtools-protocol/tot/Runtime/, https://chromedevtools.github.io/devtools-protocol/tot/DOM/, https://chromedevtools.github.io/devtools-protocol/tot/DOMSnapshot/, https://chromedevtools.github.io/devtools-protocol/tot/Accessibility/
- Actions: `Input.*` covers mouse, keyboard, touch, and drag-style input. Source: https://chromedevtools.github.io/devtools-protocol/tot/Input/
- Evidence: `Page.captureScreenshot` and `Page.startScreencast` cover screenshots and browser replay primitives. Source: https://chromedevtools.github.io/devtools-protocol/tot/Page/
- Cookies/storage: `Network.*` and `Storage.*` cover cookie and storage inspection/manipulation, but only for the attached browser context. Sources: https://chromedevtools.github.io/devtools-protocol/tot/Network/ and https://chromedevtools.github.io/devtools-protocol/tot/Storage/
- Browser-level capability checks: `Browser.getVersion`, permission controls, downloads, and user-agent hints live in Browser/Emulation domains. Sources: https://chromedevtools.github.io/devtools-protocol/tot/Browser/ and https://chromedevtools.github.io/devtools-protocol/tot/Emulation/

The missing piece is not protocol capability. It is safe session ownership:

- Direct CDP cannot attach to arbitrary running Chrome unless Chrome was launched with remote debugging. Chrome treats remote debugging as a configured launch path. Source: Chrome DevTools agent configuration, accessed 2026-07-03, https://developer.chrome.com/docs/devtools/agents/get-started/configuration?hl=en
- Chrome 136+ blocks remote debugging against the default Chrome data directory and requires a non-standard `--user-data-dir`. Source: Chrome remote debugging security change, accessed 2026-07-03, https://developer.chrome.com/blog/remote-debugging-port
- Playwright documents the same practical rule: `launchPersistentContext(userDataDir)` persists session data, but automating the regular default Chrome profile is unsupported and a separate automation profile is recommended. Source: Playwright BrowserType API via Context7, accessed 2026-07-03, https://playwright.dev/docs/api/class-browsertype

Recommended parity levels:

| Mode | UX | Setup burden | Security/privacy risk | Reliability risk | Implementation complexity | Testability | Replaces extension features | Still needs extension or human participation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Extension active-tab reuse | "Use my current tab" | Install extension and pair daemon | Medium, touches daily profile but no cookie copying | High when relay/extension stale, strong when healthy | Existing | Existing relay tests | Best live signed-in active tab, current Google path, canvas UI | Extension install, Chrome extension permissions |
| Direct CDP user-started Chrome | "Start Chrome with this command, then attach" | Medium, one command or launcher app | Medium if non-default profile; high if default profile | Medium, endpoint/profile lifecycle | Medium-high | Good with fixture browser | Active live session without extension, popup/target parity | User must start Chrome correctly, no extension-only UI |
| Managed headed persistent OpenDevBrowser profile | "Open a dedicated ODB browser and log in once" | Low-medium for novice if guided | Low-medium, isolated profile | Medium, profile lock if reused concurrently | Medium | Excellent | Most login-required workflows, Pinterest, shopping | Human login may be needed once, Google-sensitive flows need policy |
| Managed headless profile | "Run isolated headless automation" | Low | Low if isolated | Medium for sites needing human UI | Existing | Excellent | Public research, public refs, screenshots, CI | Human challenge/login, rich browser UI |
| Explicit cookie import/storage state | "Import scoped continuity" | Medium | Medium-high if values mishandled | Low-medium, partial auth likely | Medium | Excellent with fixtures | Some provider continuity | Google auth proof, device-bound/session-bound flows |

## Browser Use Comparison

Browser Use's public architecture is directionally useful because it separates auth/session strategies instead of pretending one mechanism fits all cases:

- Local/open-source Browser Use supports real local Chrome, cloud browsers, and arbitrary CDP endpoints. Source: Browser Use CLI docs, accessed 2026-07-03, https://docs.browser-use.com/open-source/browser-use-cli
- Browser Use local auth docs describe connecting to an existing Chrome session to reuse logged-in state instead of separately handling login, cookies, or 2FA. Source: https://docs.browser-use.com/open-source/customize/browser/authentication
- Browser Use "real browser" docs expose profile selection and system Chrome detection. Source: https://docs.browser-use.com/open-source/customize/browser/real-browser
- Browser Use remote docs expose CDP, cloud browser, profile IDs, proxy country, and timeout concepts. Source: https://docs.browser-use.com/open-source/customize/browser/remote
- Browser Use parameter docs expose `user_data_dir`, `profile_directory`, `storage_state`, `proxy`, `permissions`, `executable_path`, `channel`, `args`, and related controls. Source: https://docs.browser-use.com/open-source/customize/browser/all-parameters
- Browser Use cloud auth docs treat cloud profiles as durable browser state and require sessions to stop before state persists. Source: https://docs.browser-use.com/cloud/guides/authentication
- Browser Use profile sync docs describe syncing local browser cookies into cloud profiles. Source: https://docs.browser-use.com/cloud/guides/profile-sync
- Browser Use source centralizes profile config in `BrowserProfile` and warns that `storage_state` and `user_data_dir` can conflict. Source: https://github.com/browser-use/browser-use/blob/main/browser_use/browser/profile.py
- Browser Use publicly says it moved from Playwright toward raw CDP for speed/capability. Source: https://browser-use.com/posts/playwright-to-cdp

OpenDevBrowser should adopt the same separation:

- Profile path and profile ownership are first-class user choices.
- Storage state and cookie import are scoped continuity, not full profile identity.
- CDP endpoint attach is first-class, but only after safe profile launch.
- Cloud/remote parity can come later, but the local model should be ready for it.

## Google, OAuth, And Credential Safety

Do not add features that silently automate a user's default daily Chrome profile or silently copy Google cookies into managed/headless sessions.

Primary-source constraints:

- Chrome 136+ no longer allows remote debugging flags against the default Chrome data directory; it requires a non-standard `--user-data-dir`. Source: https://developer.chrome.com/blog/remote-debugging-port
- Chrome recommends Chrome for Testing for automation use cases. Source: https://developer.chrome.com/blog/remote-debugging-port
- App-Bound Encryption raises the bar for cookie theft by binding encrypted data to Chrome/app identity on supported systems. Source: https://security.googleblog.com/2024/07/improving-security-of-chrome-cookies-on.html
- DBSC is designed to bind sessions to a device and reduce cookie theft/session hijacking. Sources: https://developer.chrome.com/docs/web-platform/device-bound-session-credentials and https://security.googleblog.com/2026/04/protecting-cookies-with-device-bound.html
- SameSite, Secure, HttpOnly, and CHIPS/partitioned cookies mean cookie transfer can be incomplete or context-dependent. Sources: https://web.dev/articles/samesite-cookies-explained, https://developer.chrome.com/docs/devtools/application/cookies, and https://privacysandbox.google.com/cookies/chips
- Chrome extension pages have special partitioning and third-party cookie behavior compared with ordinary web pages. Source: https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies
- Google OAuth docs recommend platform-matched OAuth client types and OAuth libraries, and Google testing/external app state is designed around allowlisted test users. Sources: https://developers.google.com/identity/protocols/oauth2 and https://developers.google.com/identity/protocols/oauth2/production-readiness/overview

OpenDevBrowser policy should remain:

- User-owned Google auth stays fail-closed outside extension until an explicit non-default-profile CDP path exists with provenance strong enough to distinguish it from cookie copying.
- Personal live Google OAuth should not be used for validation. Use owned test accounts, allowlisted test users, synthetic cookies, sanitized metadata, and local fixtures.
- Cookie import should expose `authStateVerified: false` unless the workflow performs a safe, provider-specific verification that does not leak identity.
- Auth provenance should never print cookie values, OAuth tokens, account identifiers, full profile paths containing personal identifiers, or account screenshots.

## Recommended Architecture

### 1. Session Profile Registry

Add a profile registry that records non-secret profile metadata:

- `profileId`
- `profileKind`: `extension_live`, `managed_persistent`, `managed_temporary`, `cdp_explicit_profile`, `storage_state`, `cookie_import`
- `browserFamily`
- `profileScope`: `daily_default`, `odb_managed`, `user_declared_non_default`, `temporary`
- `remoteDebuggingSafe`: boolean
- `googleSensitiveAllowed`: boolean
- `createdByOpenDevBrowser`: boolean
- sanitized warnings and capability flags

Do not store full personal paths in diagnostics. Store display-safe basename or a hash if needed.

### 2. Direct CDP Attach Wizard

Add a novice-friendly command that prints and optionally launches a safe Chrome command:

```bash
npx opendevbrowser cdp-profile start --profile pinterest-design
npx opendevbrowser connect --profile pinterest-design --output-format json
```

Under the hood, this should launch Chrome with an OpenDevBrowser-owned non-default user data dir and remote debugging enabled, then attach via CDP. Do not target the real default Chrome data dir.

### 3. Managed Headed Persistent Profile As Default Non-Extension Power Path

For login-required but non-Google-sensitive workflows, guide users to a dedicated ODB browser:

```bash
npx opendevbrowser launch --no-extension --profile pinterest-design --start-url https://www.pinterest.com --output-format json
```

The user logs in once in that dedicated profile. Later workflows use `--browser-mode managed --profile pinterest-design --use-cookies` or a profile binding if added to workflow flags.

### 4. Provider-Level Auth Capability Contract

Before a provider workflow starts, compute:

- `authCapability`: `public`, `cookie_continuity`, `profile_continuity`, `live_extension`, `explicit_cdp_profile`, `blocked`
- `authProof`: `none`, `cookies_observable`, `profile_declared`, `live_tab`, `provider_verified`
- `googleSensitiveRisk`: `blocked`, `diagnostic_only`, `allowed_test_profile`, `allowed_live_extension`
- `recommendedMode`
- `doNotProceedIf`

Use this to fail closed before a diagnostic-only Pinterest or Google-sensitive run wastes time.

### 5. Target Ownership Service For CDP

Extract the extension's strongest ideas into a core target ownership service:

- target graph from `Target.*`
- opener and popup ownership
- target aliases and names
- active target recovery
- popup/account chooser detection via sanitized URLs and titles
- no concurrent `target-use` streams in one session

This is the CDP replacement seam for extension child-session routing.

### 6. Evidence Authority Stays Separate

Do not change Inspiredesign's product-readiness semantics:

- Transport success means a workflow ran.
- Product success means product-ready evidence exists.
- Pinterest design readiness still requires `pin-media-index.json` with first-party bytes.
- `media-analysis.json` remains advisory.
- `motion-evidence.json` remains browser replay authority.

## Roadmap

### Phase 0 - Docs And Diagnostics Guardrails

Goal: prevent more agents from assuming extension is the only path or that cookies prove auth.

Tasks:

1. Update `docs/CLI.md`, `docs/SURFACE_REFERENCE.md`, README, and `skills/opendevbrowser-best-practices/SKILL.md` with a "non-extension auth modes" section.
2. Add generated help examples for managed headed persistent profile, managed headless temporary profile, and explicit CDP non-default profile.
3. Add a `status-capabilities` section for safe profile capabilities and CDP endpoint availability.
4. Improve session inspector output with sanitized `authCapability` and `authProof`.

Acceptance:

- Help text explains when to use extension, managed headed profile, managed headless, direct CDP, and cookie import.
- No docs imply cookie import proves login.

### Phase 1 - Profile Registry And Safer Managed Defaults

Goal: make extensionless headed persistent profiles novice-safe.

Tasks:

1. Add profile registry metadata and sanitized provenance.
2. Add unique-profile retry guidance and "create profile" flow.
3. Teach workflows to accept a profile binding for managed mode.
4. Fail early on profile lock with actionable commands.

Acceptance:

- A new managed headed profile can be created, logged into manually, reused, and inspected without extension.
- The default profile lock path is tested and documented.

### Phase 2 - Direct CDP Explicit Profile Lane

Goal: attach to a user-started non-default Chrome profile without extension.

Tasks:

1. Add a `cdp-profile start` or equivalent launcher for non-default user data dirs.
2. Attach via CDP and record safe provenance.
3. Implement CDP target graph ownership using `Target.*`.
4. Add popup recovery guidance and `targets-list --include-urls` tests with synthetic OAuth-like popups.

Acceptance:

- Direct CDP can attach to a non-default OpenDevBrowser profile, navigate, switch popup targets, inspect console/network, screenshot, and disconnect.
- The command refuses or warns against default Chrome profile paths.

### Phase 3 - Provider Auth Policy And Pinterest Parity

Goal: make Pinterest and other session-sensitive workflows product-ready without extension when a safe profile is available.

Tasks:

1. Add provider `authCapability` preflight and workflow routing.
2. Add managed headed Pinterest profile flow.
3. Run `inspiredesign harvest` against owned or test Pinterest profile with managed headed profile.
4. Require `pin-media-index.json` authority exactly as extension mode does.

Acceptance:

- A managed headed profile can produce product-ready Pinterest pin-media harvests for explicit canonical pins in a test/owned account.
- Broad-query diagnostic-only output includes exact recovery commands for managed profile or CDP profile.

### Phase 4 - Generalize Evidence And Replay Fallbacks

Goal: reduce extension-only reliability advantages.

Tasks:

1. Generalize CDP screenshot fallback beyond extension-legacy timeout cases where safe.
2. Add Page.startScreencast-backed replay lane for direct CDP where Playwright screenshot loop is insufficient.
3. Make session inspector report CDP/browser capability differences.

Acceptance:

- Screenshots and replay artifacts are mode-parity tested across managed headed, managed headless, explicit CDP, and extension.

### Phase 5 - Optional Cloud/Remote Browser Layer

Goal: prepare for Browser Use-style cloud or remote browser parity.

Tasks:

1. Define remote browser profile contract without secrets.
2. Support remote CDP endpoints only when explicitly allowed by config and policy.
3. Preserve existing localhost-only default.

Acceptance:

- Remote CDP remains opt-in, audited, and never weakens local security defaults.

## Proposed CLI, Help, Docs, And Skill Updates

Add or update help examples:

```bash
# Public/CI-safe headless run
npx opendevbrowser launch --no-extension --headless --persist-profile false --start-url https://example.com --output-format json

# Dedicated non-extension headed login profile
npx opendevbrowser launch --no-extension --profile pinterest-design --start-url https://www.pinterest.com --output-format json

# Future explicit CDP profile launcher
npx opendevbrowser cdp-profile start --profile pinterest-design
npx opendevbrowser connect --profile pinterest-design --output-format json
```

Update docs and skills to say:

- Extension is best for the already-open daily Chrome tab.
- Managed headed persistent profiles are the preferred non-extension login path.
- Managed headless is preferred for public and CI-safe workflows.
- Direct CDP is preferred for user-started non-default profiles and debugging active sessions without extension.
- Cookie import is scoped continuity only.
- Google-sensitive user-owned auth remains extension-only until explicit safe CDP profile support lands.

Update generated public surfaces:

- `src/public-surface/source.ts`
- `src/public-surface/generated-manifest.ts`
- `src/public-surface/generated-manifest.json`
- `docs/CLI.md`
- `docs/SURFACE_REFERENCE.md`
- `README.md`
- `docs/TROUBLESHOOTING.md`
- `skills/opendevbrowser-best-practices/SKILL.md`

## Test And Verification Plan

Unit and integration tests:

- `BrowserManager.launch()` profile registry and profile lock handling.
- `BrowserManager.connect()` explicit CDP profile provenance.
- `assertGoogleAuthIntentAllowedForMode()` policy matrix.
- Cookie bootstrap for Google-sensitive skip/include, CHIPS/partitioned metadata, SameSite/Secure/HttpOnly.
- Provider `authCapability` policy for public, cookie, managed profile, extension, and direct CDP profiles.
- CDP target graph for popup opener relationships, target-use, target-list, and target close.
- Session inspector sanitized auth provenance with no cookie values or personal paths.
- Inspiredesign product readiness unchanged: `pin-media-index.json` authority required, `media-analysis.json` advisory only.

Real workflow verification:

1. Managed headless public smoke:
   - `npx opendevbrowser launch --no-extension --headless --persist-profile false --start-url https://example.com --output-format json`
   - `targets-list`, `screenshot`, `disconnect`
   - PASS: target is `https://example.com/`, screenshot exists, disconnect succeeds.

2. Managed headed profile smoke:
   - Create unique `--profile odb-parity-smoke`.
   - Navigate to public page.
   - PASS: profile persists across two launches and does not lock when not concurrent.

3. Direct CDP explicit profile smoke:
   - Start Chrome with non-default user data dir and remote debugging.
   - `opendevbrowser connect --ws-endpoint ...`
   - PASS: targets list, target-use, screenshot, debug trace, disconnect.

4. Synthetic OAuth popup fixture:
   - Local page opens a popup and redirects through fake account chooser pages.
   - PASS: target graph preserves opener relation, `targets-list --include-urls` exposes sanitized target choice, `target-use` recovers correct popup.

5. Provider public research:
   - `research run --sources web,community --browser-mode managed`
   - PASS: report artifacts exist and auth capability is public or none.

6. Shopping managed profile:
   - Use public provider fixture and one live public provider if allowed.
   - PASS: no cookie auth proof claim unless provider verification exists.

7. Inspiredesign public URLs:
   - `inspiredesign harvest --provider web/default --browser-mode managed --visual-evidence required`
   - PASS: product success only when ranked references and evidence authority agree.

8. Inspiredesign Pinterest explicit pin with owned/test profile:
   - Managed headed profile with test Pinterest account or approved owned account.
   - PASS: `productSuccess=true`, `artifactAuthority=product_ready`, `evidenceAuthority=pin_media_ready`, non-empty `ranked-references.json`, and manifest-backed `pin-media-index.json`.

9. Diagnostic-only guard:
   - Force Pinterest search-shell/no-media fixture.
   - PASS: workflow exits transport-successfully but remains `diagnostic_only`, with `doNotProceedIf` blocking Canvas continuation.

Do not run live personal Google OAuth tests. Use owned test accounts, allowlisted OAuth test users, local fixtures, and sanitized metadata.

## Open Questions And Risks - Do Not Implement Yet

- Should `--google-auth-intent user-owned` ever be allowed for direct CDP if the profile is a user-declared non-default profile? This needs explicit policy design and probably a new intent value distinct from daily-profile Google auth.
- How should OpenDevBrowser prove a profile is non-default without exposing private path details?
- Should the CLI create a small launcher app/script for macOS that starts Chrome with safe CDP flags, rather than asking novices to copy command lines?
- What provider-specific checks can safely prove auth without exposing account identifiers?
- How should profile locks be coordinated across concurrent agents and daemon sessions?
- Should storage-state export/import be added, and if so how do we prevent it from becoming a secret sprawl vector?
- Can canvas get a non-extension browser-hosted UI, or should extension remain the canvas UI path while core document APIs stay non-extension?
- What is the correct policy for remote CDP beyond localhost? Current defaults should remain localhost-only.
- Browser Use cloud profile sync is useful as inspiration, but OpenDevBrowser should not add cloud profile sync without a separate privacy/security design.

## Source Index

Local source and docs:

- `README.md:50-51`, `README.md:121-124`, `README.md:310-312`, `README.md:516-533`
- `docs/CLI.md:472-475`, `docs/CLI.md:507-510`, `docs/CLI.md:544-547`, `docs/CLI.md:582-619`, `docs/CLI.md:740-746`, `docs/CLI.md:761-771`
- `docs/ARCHITECTURE.md:306-311`, `docs/ARCHITECTURE.md:349`, `docs/ARCHITECTURE.md:360-412`
- `docs/SURFACE_REFERENCE.md:528-600`
- `skills/opendevbrowser-best-practices/SKILL.md:149-220`
- `src/browser/browser-manager.ts:1731-1853`, `src/browser/browser-manager.ts:1891-1923`, `src/browser/browser-manager.ts:2028-3799`, `src/browser/browser-manager.ts:3847-3949`, `src/browser/browser-manager.ts:6368-6487`
- `src/browser/ops-browser-manager.ts:263-319`
- `src/browser/manager-types.ts:198-240`
- `src/browser/system-chrome-cookies.ts:299-371`
- `src/cache/chrome-user-data.ts:1-220`
- `src/core/auth-intent.ts:1-120`
- `src/relay/relay-server.ts:180-270`
- `extension/src/services/ConnectionManager.ts:299-336`, `extension/src/services/ConnectionManager.ts:466-661`
- `extension/src/services/CDPRouter.ts:170-330`
- `extension/src/services/TargetSessionMap.ts:33-110`
- `src/providers/workflows.ts:6312-7425`
- `src/inspiredesign/product-readiness.ts:592-794`
- `src/providers/renderer.ts:344-414`
- `src/guidance/recipes/pinterest.ts:1-80`
- `src/challenges/policy-gate.ts:40-174`
- `tests/cli-launch.test.ts:48-185`
- `tests/cli-session-connect.test.ts:59-139`
- `tests/browser-manager.test.ts:900-979`, `tests/browser-manager.test.ts:1188-1320`, `tests/browser-manager.test.ts:3200-3320`, `tests/browser-manager.test.ts:10470-10603`
- `tests/inspiredesign-product-readiness.test.ts:61-260`
- `tests/providers-inspiredesign-workflow.test.ts:5020-5585`

External primary sources, accessed 2026-07-03:

- Browser Use docs: https://docs.browser-use.com/open-source/browser-use-cli
- Browser Use auth docs: https://docs.browser-use.com/open-source/customize/browser/authentication
- Browser Use real browser docs: https://docs.browser-use.com/open-source/customize/browser/real-browser
- Browser Use remote docs: https://docs.browser-use.com/open-source/customize/browser/remote
- Browser Use browser parameters: https://docs.browser-use.com/open-source/customize/browser/all-parameters
- Browser Use cloud auth: https://docs.browser-use.com/cloud/guides/authentication
- Browser Use profile sync: https://docs.browser-use.com/cloud/guides/profile-sync
- Browser Use source profile model: https://github.com/browser-use/browser-use/blob/main/browser_use/browser/profile.py
- Browser Use Playwright to CDP post: https://browser-use.com/posts/playwright-to-cdp
- Playwright BrowserType API: https://playwright.dev/docs/api/class-browsertype
- Playwright BrowserContext API: https://playwright.dev/docs/api/class-browsercontext
- Playwright auth docs: https://playwright.dev/docs/auth
- Playwright Chrome extensions: https://playwright.dev/docs/chrome-extensions
- Playwright screenshots: https://playwright.dev/docs/screenshots
- Playwright videos: https://playwright.dev/docs/videos
- Playwright tracing API: https://playwright.dev/docs/api/class-tracing
- Puppeteer connect: https://pptr.dev/api/puppeteer.puppeteer.connect
- Puppeteer launch options: https://pptr.dev/api/puppeteer.launchoptions
- Puppeteer BrowserContext: https://pptr.dev/api/puppeteer.browsercontext
- Puppeteer CDPSession: https://pptr.dev/api/puppeteer.cdpsession
- CDP Target: https://chromedevtools.github.io/devtools-protocol/tot/Target/
- CDP Runtime: https://chromedevtools.github.io/devtools-protocol/tot/Runtime/
- CDP DOM: https://chromedevtools.github.io/devtools-protocol/tot/DOM/
- CDP DOMSnapshot: https://chromedevtools.github.io/devtools-protocol/tot/DOMSnapshot/
- CDP Accessibility: https://chromedevtools.github.io/devtools-protocol/tot/Accessibility/
- CDP Input: https://chromedevtools.github.io/devtools-protocol/tot/Input/
- CDP Page: https://chromedevtools.github.io/devtools-protocol/tot/Page/
- CDP Network: https://chromedevtools.github.io/devtools-protocol/tot/Network/
- CDP Storage: https://chromedevtools.github.io/devtools-protocol/tot/Storage/
- CDP Browser: https://chromedevtools.github.io/devtools-protocol/tot/Browser/
- CDP Emulation: https://chromedevtools.github.io/devtools-protocol/tot/Emulation/
- Chrome remote debugging security change: https://developer.chrome.com/blog/remote-debugging-port
- Chrome headless: https://developer.chrome.com/docs/chromium/headless
- Chrome flags and user data dir: https://developer.chrome.com/docs/web-platform/chrome-flags
- ChromeDriver capabilities: https://developer.chrome.com/docs/chromedriver/capabilities
- ChromeDriver remote debugging limitation: https://developer.chrome.com/docs/chromedriver/help/operation-not-supported-when-using-remote-debugging
- Chrome App-Bound Encryption: https://security.googleblog.com/2024/07/improving-security-of-chrome-cookies-on.html
- Chrome security FAQ: https://chromium.googlesource.com/chromium/src/+/HEAD/docs/security/faq.md
- Chrome DBSC: https://developer.chrome.com/docs/web-platform/device-bound-session-credentials
- Google Security Blog DBSC: https://security.googleblog.com/2026/04/protecting-cookies-with-device-bound.html
- SameSite cookies: https://web.dev/articles/samesite-cookies-explained
- Chrome DevTools cookies: https://developer.chrome.com/docs/devtools/application/cookies
- CHIPS: https://privacysandbox.google.com/cookies/chips
- Chrome extension cookies and partitioning: https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies
- Google OAuth 2.0 overview: https://developers.google.com/identity/protocols/oauth2
- Google OAuth production readiness: https://developers.google.com/identity/protocols/oauth2/production-readiness/overview
- Google OAuth consent screen: https://developers.google.com/workspace/guides/configure-oauth-consent
- Google OAuth brand verification: https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification
- Google OAuth loopback migration: https://developers.google.com/identity/protocols/oauth2/resources/loopback-migration
- Google OAuth OOB migration: https://developers.google.com/identity/protocols/oauth2/resources/oob-migration
