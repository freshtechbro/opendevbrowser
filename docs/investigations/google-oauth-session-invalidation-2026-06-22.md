# Investigation: Google OAuth Perceived Logout And Session Incoherence

## Summary
Evidence does not support a local OpenDevBrowser path that deletes Google cookies or explicitly logs the user out. The strongest source-backed model is session incoherence: managed and `cdpConnect` modes can transplant observable cookies from a heuristically selected Chrome-family profile into a different browser context, while Google OAuth can depend on coherent live profile state, account state, supported-browser checks, device/session protections where deployed, and popup target state. Extension `/ops` against the already signed-in Chrome profile is the safest existing mode for user-owned Google OAuth.

## Symptoms
- User is logged into Google in their normal browser state, but OpenDevBrowser workflows that need Google sign-on report or behave as if Google is logged out.
- Third-party OAuth flows such as LinkedIn, Facebook, or Instagram sign-in through Google do not complete because Google account access is missing or invalidated.
- The user reports the effect as being logged out of all Google accounts during OpenDevBrowser use. This investigation treats that as perceived logout or auth invalidation unless a live Google security/session audit proves broader account-session revocation.

## Background / Prior Research
- Official Google and Chrome sources point in the same direction: copied/replayed browser secrets are becoming less reliable. Chrome 136 no longer honors `--remote-debugging-port` or `--remote-debugging-pipe` against the default Chrome data directory unless a non-standard `--user-data-dir` is supplied, specifically to reduce cookie-theft abuse. Device Bound Session Credentials can bind sessions to supported devices, Chrome/platforms, and participating sites so copied cookies alone can be insufficient for protected sessions.
- Google OAuth policy prohibits embedded user-agents under developer control for authorization requests because those contexts can observe or alter credentials and session state. Google Account Help separately names software-automation-controlled browsers, embedded browsers, unsupported browsers, and unsupported extensions as causes of blocked sign-in.
- Community prior art across Playwright, Puppeteer, Selenium, StackOverflow, Reddit, and framework forums repeatedly reports Google sign-in failures such as "This browser or app may not be secure", phone verification, CAPTCHA, forced reauth, and failures that differ between normal Chrome and automated/headless/CDP sessions. These are corroborating signals, not primary authority.
- Legitimate mitigations found in prior art are consistent: avoid automating live Google login UI; use app-owned test auth seams or OAuth test accounts for repeatable tests; use a dedicated persistent automation profile if managed mode is unavoidable; use the real user-owned browser profile with explicit user consent for user-owned OAuth; handle OAuth popups/new targets explicitly.
- Repo archaeology shows OpenDevBrowser's current behavior evolved in layers: provider cookie policy landed first for deterministic signed-in workflows, automatic Chrome-family cookie bootstrap for managed and `cdpConnect` landed later, and docs/skills then clarified that extension mode reuses the live logged-in profile instead of importing cookies.
- A provider-cookie-disabled OpenDevBrowser research run on 2026-06-22 used `--cookie-policy-override off` and produced a partial evidence gate under `.opendevbrowser/research/cffec21a-bb83-4bfa-a657-414540b0ff21`. It corroborated DBSC and Playwright auth-state guidance but was not strong enough to use as standalone authority. Runtime validation later confirmed that provider-cookie policy does not disable automatic managed-mode system Chrome cookie bootstrap.

External references gathered:
- Google OAuth policy: https://developers.google.com/identity/protocols/oauth2/policies
- Google OAuth embedded webview policy: https://developers.googleblog.com/upcoming-security-changes-to-googles-oauth-20-authorization-endpoint-in-embedded-webviews/
- Google Account supported-browser sign-in help: https://support.google.com/accounts/answer/7675428
- Chrome remote-debugging default-profile restriction: https://developer.chrome.com/blog/remote-debugging-port
- Chrome Device Bound Session Credentials: https://developer.chrome.com/docs/web-platform/device-bound-session-credentials
- Google DBSC/session-cookie protection announcement: https://blog.google/security/protecting-cookies-with-device-bound-session-credentials/
- Chrome App-Bound Encryption for cookies on Windows: https://security.googleblog.com/2024/07/improving-security-of-chrome-cookies-on.html
- Playwright auth state guidance: https://playwright.dev/docs/auth
- Playwright popup handling: https://playwright.dev/docs/pages
- Playwright Google unsafe-browser issue: https://github.com/microsoft/playwright/issues/3060
- Puppeteer Google unsafe-browser issue: https://github.com/puppeteer/puppeteer/issues/6832
- StackOverflow Playwright unsafe-browser example: https://stackoverflow.com/questions/76603386/playwright-chrome-this-browser-or-app-may-not-be-secure

Repo archaeology highlights:
- `e1d565f`: provider cookie policy/source configuration was introduced around `src/config.ts`.
- `b2934aa`: system Chrome-family cookie bootstrap was introduced around `src/browser/system-chrome-cookies.ts`, `src/cache/chrome-user-data.ts`, and `src/browser/browser-manager.ts`.
- `8a651c9`, `50242b0`, `fc2f0b3`: bounded challenge/auth recovery controls were added around `src/config.ts` and `src/challenges/policy-gate.ts`.
- `3fb6197`, `383ecfe`: target/session inspection and explicit target routing guidance were tightened.
- `8e0d555`: signed-in provider runtime paths were hardened around `src/providers/runtime-factory.ts` and related workflow surfaces.

## Investigator Findings

### 1. Managed launch creates an isolated persistent context, then imports system cookies before OpenDevBrowser start-url navigation
- `src/browser/browser-manager.ts:1640-1667` resolves the OpenDevBrowser profile and launches a Playwright persistent context at either `cachePaths.profileDir` when `persistProfile` is true or a fresh `temp-profiles/<uuid>` directory when false.
- `src/browser/browser-manager.ts:1677-1687` registers existing or newly-created pages and records the initial active target before navigation.
- `src/browser/browser-manager.ts:1719-1722` calls `bootstrapSystemChromeCookies(managed, executablePath)` before `goto(startUrl, ...)`.
- `tests/browser-manager.test.ts:848-891` verifies `loadSystemChromeCookies()` and `context.addCookies()` run before OpenDevBrowser calls `page.goto()` for the managed `startUrl`.
- `src/browser/browser-manager.ts:3602-3627` and `src/browser/browser-manager.ts:3716-3717` apply both explicit `cookieImport` and automatic bootstrap with `context.addCookies()` only. There is no pre-import clear.

Implication: managed mode can have cookies present before OpenDevBrowser navigates to the requested `startUrl`, but the browser profile is still an OpenDevBrowser-controlled profile, not the user's live Chrome profile. It receives a generic cookie transplant without matching the complete Google browser state.

### 2. CDP connect also overlays system Chrome-family cookies into the attached context
- `src/browser/browser-manager.ts:1788-1795` resolves a CDP endpoint, calls `connectWithEndpoint(..., "cdpConnect")`, then navigates `startUrl` after connection.
- `src/browser/browser-manager.ts:6109-6229` connects over CDP, reuses the first exposed context or creates one, builds a managed session, and calls `bootstrapSystemChromeCookies(managed)` before storing the session.
- `tests/browser-manager.test.ts:1252-1302` verifies system Chrome cookie import for `cdpConnect` sessions.
- `src/browser/browser-manager.ts:3686-3699` skips bootstrap only when `managed.mode === "extension"`, so `cdpConnect` is included.

Implication: CDP attach can be risky when the attached Chrome was launched with a different `--user-data-dir` or profile than the discovered system profile. The code overlays cookies from the auto-selected Chrome-family source into whatever context CDP exposes, which can create profile/session incoherence.

### 3. Source profile selection is heuristic and can pick an unintended, stale, or different profile
- `src/cache/chrome-user-data.ts:20-74` searches platform-specific Chrome, Chromium, and Brave user-data roots in fixed order.
- `src/cache/chrome-user-data.ts:113-136` prefers `Local State.profile.last_used`, then `Default`, then the first available profile directory.
- `src/cache/chrome-user-data.ts:139-153` returns the first root with an eligible profile.
- `tests/chrome-user-data.test.ts:137-254` covers the last-used, `Default`, and first-profile fallback behavior.

Implication: if the intended Google session is in a different Chrome-family browser or profile than this heuristic selects, bootstrap may import stale, unrelated, or partial cookies. There is no user-facing account/profile confirmation in this path.

### 4. System cookie bootstrap copies/imports cookies only, not full Google session state
- `src/browser/system-chrome-cookies.ts:22-35` limits fallback staging to `Local State`, `Preferences`, `Secure Preferences`, `Network`, `Cookies`, and `Cookies-journal`.
- `src/browser/system-chrome-cookies.ts:229-288` on macOS can read the SQLite cookie database directly and decrypt readable values.
- `src/browser/system-chrome-cookies.ts:320-369` otherwise stages a temporary copied profile, launches headless Chrome against the copy, reads `context.cookies()`, then deletes only the temporary staging root.
- `src/browser/browser-manager.ts:4552-4645` validates only generic cookie shape, URL/domain/path, expiry, and `SameSite=None` secure semantics. It does not verify Google account coherence or device-bound/session-bound material.

Implication: code evidence supports the current hypothesis. OpenDevBrowser imports readable cookies, but it does not copy local/session storage, IndexedDB, service workers, extension state, profile preference state beyond what is needed for cookie reading, or Google-specific device/session binding material. Based on the external DBSC and Windows App-Bound Encryption background already in this report, cookies alone may be insufficient where those protections apply or may trigger reauthentication through other Google risk checks.

### 5. Provider cookie injection can layer another cookie source on top of system bootstrap in non-extension modes
- `src/config.ts:424-446` defaults `providers.cookiePolicy` to `auto` and `providers.cookieSource` to the configured provider-cookie file when no explicit source is supplied.
- `src/providers/cookie-source.ts:28-75` reads provider cookies from inline JSON, an environment variable, or a JSON file. It does not scrape the live browser profile.
- `src/providers/runtime-policy.ts:17-34` defaults `shopping` to `extension` then `managed_headed`, while `web`, `community`, and `social` default to `managed_headed`.
- `src/providers/runtime-factory.ts:1149-1167` uses `connectRelay()` for extension fallback, but `src/providers/runtime-factory.ts:1216-1235` reads/imports provider cookies only when `preferredMode !== "extension"`.
- `src/providers/runtime-factory.ts:1239-1254` treats `required` cookies as successful only when load/import/list verification produces observable cookies for the request URL.

Implication: in managed provider fallbacks, automatic system bootstrap can happen at launch, then provider cookies can be added later. Verification only proves cookies are observable for the request URL, not that Google accepts the account session. For third-party OAuth, this layering can mix provider, Google, and site cookies from different sources.

### 6. Extension and `/ops` paths reuse live Chrome profile state and have better popup tracking
- `docs/FIRST_RUN_ONBOARDING.md:228-233` states extension mode reuses attached live tab/profile state and runs no system bootstrap.
- `docs/ARCHITECTURE.md:402-408` documents the same split: managed and `cdpConnect` import cookies, extension sessions reuse the already logged-in browser tab.
- `src/browser/ops-browser-manager.ts:256-299` routes `/ops` relay connect through `session.connect` and records the active target and lease.
- `extension/src/ops/ops-runtime.ts:1157-1217` creates a real active tab for `startUrl` or attaches to the requested/active tab, then `extension/src/ops/ops-runtime.ts:1218-1266` attaches the debugger and creates the session.
- `src/browser/ops-browser-manager.ts:485-513` and `extension/src/ops/ops-runtime.ts:2579-2698` expose explicit cookie add/list commands over `Network.setCookies` and `Network.getCookies`, but this is an explicit override lane, not automatic bootstrap.

Implication: extension `/ops` session paths are the safest existing path for user-owned OAuth because they rely on the user's real Chrome profile rather than imported cookies. They still must avoid adding conflicting cookies through explicit import unless the operator intends that.

### 7. OAuth popup handling is asymmetric across modes
- Playwright `TargetManager` registers pages it knows about and sets active targets only when the first page is registered, an OpenDevBrowser-created target is used, or `syncPages()` is later called. See `src/browser/target-manager.ts:24-40`, `src/browser/target-manager.ts:86-103`, and `src/browser/target-manager.ts:202-237`.
- `src/browser/browser-manager.ts:2034-2056` syncs pages only during `listTargets()`, and `src/browser/browser-manager.ts:2157-2166` requires explicit `useTarget()` to switch active target.
- `src/browser/browser-manager.ts:5993-6000` attaches console/exception/network trackers only to the active target.
- The extension `/ops` path explicitly tracks popups: `extension/src/ops/ops-runtime.ts:548-563` records `webNavigation.onCreatedNavigationTarget`, `extension/src/ops/ops-runtime.ts:565-649` associates new tabs to opener sessions, and `extension/src/ops/ops-runtime.ts:728-743` attaches or bridges popup targets. `extension/src/ops/ops-runtime.ts:3571-3595` promotes a usable popup target when the opener/root is still active.
- `tests/extension-ops-runtime.test.ts:4381-4465` and `tests/extension-ops-runtime.test.ts:4717-4777` cover popup ownership recovery through router metadata and created-navigation metadata.

Implication: managed/CDP Playwright flows can miss or stay on the opener unless callers explicitly list and switch targets after an OAuth popup appears. In that state, Google may be logged in inside a popup while OpenDevBrowser continues reading the opener or another target that still looks logged out.

### 8. No explicit destructive logout path found in the inspected code
- Search across `src`, `extension/src`, and `tests` found no matches for explicit cookie or storage destructive APIs such as `clearCookies`, `deleteCookies`, `deleteCookie`, `Storage.clear*`, `Network.clear*`, `cookies.remove`, or `browsingData`.
- Runtime removals found in the relevant paths are scoped to OpenDevBrowser temporary profile/staging directories: launch failure cleanup at `src/browser/browser-manager.ts:1764-1767`, disconnect cleanup for non-persistent profiles at `src/browser/browser-manager.ts:1895-1897`, and bootstrap staging cleanup at `src/browser/system-chrome-cookies.ts:367-369`.

Implication: the evidence rules out an obvious code path that intentionally logs Google out or clears Google cookies from the user's system profile. The more plausible root cause remains session incoherence from cookie transplants, unintended profile selection, additive cookie layering, Google security checks, and target/popup handling gaps.

### Minimal recommended seams
- Add a user-visible preflight for managed and `cdpConnect` that reports the selected browser/profile source without exposing cookie values, and add an explicit per-run bootstrap disable control first.
- Make provider cookie diagnostics distinguish `systemBootstrap`, `providerCookieImport`, and `liveExtensionProfile` so OAuth failures are not collapsed into a generic `auth_required` bucket.
- Prefer extension `/ops` for user-owned Google OAuth and document managed/CDP as best-effort cookie continuity, not account-session equivalence.
- For managed/CDP OAuth flows, start with a guided `listTargets` plus `useTarget` recovery step after third-party OAuth launches a new window. Defer broad popup watcher work until a focused reproducer proves it is needed.
- Keep recommendations limited to legitimate profile/session coherence, test-account OAuth seams, and explicit user consent. Do not add stealth, CAPTCHA bypass, user-agent spoofing, or Google-protection bypass behavior.

## Investigation Log

### Phase 1 - Initial Assessment
**Hypothesis:** The issue is not a single code path that strips Google cookies; it may be an interaction between copied cookies, isolated profiles, Google account-protection checks, and OAuth target handling.
**Findings:** Prior shallow trace identified managed-mode cookie transplant, extension-mode live profile reuse, additive cookie import, and popup/new-tab risk as the main candidate mechanisms. This deeper investigation will verify and expand those findings.
**Evidence:** See `## Investigator Findings` for concrete code paths and `## Background / Prior Research` for external sources.
**Conclusion:** Confirmed as the primary direction; no single cookie-stripper was found.

### Phase 1.5 - External Research
**Hypothesis:** Google and browser platform changes make copied cookies increasingly unreliable for OAuth and first-party Google services.
**Findings:** Official Chrome and Google sources support that direction through remote-debugging profile hardening, App-Bound Encryption, DBSC/session binding, OAuth secure-browser policy, and supported-browser checks. Community reports match the symptom pattern, but official docs are the authoritative basis for recommendations.
**Evidence:** External links are listed in `## Background / Prior Research`. The provider-cookie-disabled OpenDevBrowser research artifact is `.opendevbrowser/research/cffec21a-bb83-4bfa-a657-414540b0ff21`.
**Conclusion:** Confirmed. Cookie replay is not a reliable Google OAuth strategy.

### Phase 2 - Context Builder
**Hypothesis:** The affected paths would span browser lifecycle, cookie bootstrap, provider cookie import, profile discovery, extension `/ops`, and target routing.
**Findings:** Context Builder seeded RepoPrompt selection with the expected browser, cookie, provider, docs, and target-routing files and produced chat `google-oauth-77B386`.
**Evidence:** Selection included `src/browser/browser-manager.ts`, `src/browser/system-chrome-cookies.ts`, `src/cache/chrome-user-data.ts`, provider runtime files, docs, and extension `/ops` slices.
**Conclusion:** Confirmed.

### Phase 3 - Pair Investigator
**Hypothesis:** The exact trigger is not local deletion, but a combination of automatic cookie bootstrap, additive cookie import, profile mismatch, and popup target handling.
**Findings:** Pair investigator verified managed and CDP cookie bootstrap, extension skip, provider cookie layering, profile heuristic selection, cookie-only bootstrap scope, popup target asymmetry, and the absence of explicit destructive logout APIs.
**Evidence:** See `## Investigator Findings`.
**Conclusion:** Confirmed.

### Phase 4 - Oracle Synthesis
**Hypothesis:** The report should distinguish local cookie deletion from Google-side auth invalidation and should rank minimal resolution options.
**Findings:** Oracle synthesis agreed that local deletion is unsupported by evidence; the source-backed local issue is managed/CDP session incoherence, with possible Google-side risk or reauth behavior and extension `/ops` as the recommended user-owned OAuth mode.
**Evidence:** RepoPrompt chat `google-oauth-77B386`, after selection was updated with pair findings and `/ops` target-routing slices.
**Conclusion:** Confirmed.

## Root Cause
There is no evidence that OpenDevBrowser is intentionally stripping the user's Google cookies or clearing the user's browser storage. The inspected code does not expose a destructive logout path in the relevant source or extension runtime, and cleanup paths are limited to OpenDevBrowser temporary profiles or temporary bootstrap staging directories.

The likely local root cause is profile and session incoherence caused by cookie transplant:
- Managed launch creates an OpenDevBrowser-controlled persistent context, then imports system Chrome-family cookies before OpenDevBrowser navigates to `startUrl`. See `src/browser/browser-manager.ts:1640-1722`.
- CDP connect also calls the same bootstrap path for non-extension modes. See `src/browser/browser-manager.ts:6109-6229` and `src/browser/browser-manager.ts:3683-3718`.
- The source profile is selected heuristically from Chrome, Chromium, then Brave, using `last_used`, `Default`, then first eligible profile. See `src/cache/chrome-user-data.ts:19-153`.
- Bootstrap reads or stages cookie-related files only, not the complete live profile/account state. See `src/browser/system-chrome-cookies.ts:26-35` and `src/browser/system-chrome-cookies.ts:299-369`.
- Explicit `cookieImport()` and automatic bootstrap both add cookies using `context.addCookies()` without clearing or account-level validation. See `src/browser/browser-manager.ts:3602-3627` and `src/browser/browser-manager.ts:3716-3717`.
- Provider workflows can add another cookie source in non-extension mode and verify only that cookies are observable for the request URL. See `src/providers/runtime-factory.ts:1216-1254`.

That state can look partially signed in because cookies are present, while Google can still reject the session because the browser profile, protected-session material where applicable, account consistency state, local storage, service workers, extension state, or popup target does not match the real signed-in Chrome session. If the user is truly logged out across Google surfaces, that may indicate Google-side risk response or reauthentication, but repo evidence does not prove Google-wide server-side revocation.

There is also a secondary UI/control-plane issue. Google OAuth commonly opens an account chooser or consent page in a new target. Managed and CDP flows require explicit target listing/switching after new pages appear, while extension `/ops` has stronger popup ownership and promotion logic. A missed popup can make OpenDevBrowser keep inspecting the opener, which appears logged out even if the Google popup has live auth.

## Recommendations
1. Treat extension `/ops` mode as the default for user-owned Google OAuth and first-party Google account access. It reuses the user's live Chrome profile, skips system cookie bootstrap, and has better popup target tracking.
2. Do not use managed or CDP cookie bootstrap as proof of Google login. Treat it as best-effort continuity for low-risk sites only.
3. Add narrow provenance diagnostics for Google-sensitive runs: requested mode, actual mode, extension handshake/readiness, selected source browser/profile if bootstrap ran, bootstrap enabled, provider-cookie source type, explicit cookie import presence, cookie policy, and active target URL. Do not expose cookie values.
4. Do not silently fall back from extension to managed when a workflow explicitly requires Google OAuth or first-party Google account access. Fail closed with an actionable message.
5. Start with OAuth popup guidance rather than a broad watcher: after a Google OAuth action, list targets, identify `accounts.google.com` or consent/account chooser targets, and require explicit `target-use` or safe promotion. Defer a general bounded watcher until a focused reproducer proves it is needed.
6. Add an explicit per-run control to disable system cookie bootstrap first. Defer full browser/profile selection UI until diagnostics show unintended-profile selection is a frequent real cause.
7. For repeat automation, use app-level test auth seams, OAuth test accounts, or a dedicated persistent automation profile with a manual first login. Do not use personal Google accounts in repeat automation loops.
8. Keep explicit `cookie-import` away from live Google OAuth unless the operator intentionally chooses it and accepts that it can mix state.

## Preventive Measures
- Never treat `cookieList().count > 0` as authenticated Google state. It proves only cookie observability.
- Keep `systemBootstrap`, `providerCookieImport`, `explicitCookieImport`, and `liveExtensionProfile` separate in diagnostics and user-facing errors.
- Document managed and `cdpConnect` as best-effort cookie continuity, not equivalent to a logged-in Google browser profile.
- Add tests around Google-sensitive no-downgrade behavior and diagnostic provenance so those workflows do not silently downgrade to managed cookie transplant.
- Avoid copying full Chrome profiles, stealth patches, user-agent spoofing, CAPTCHA bypass, or attempts to bypass Google's account protection. These are brittle, unsafe, and outside the legitimate reliability model.
- Preserve the security boundary: for user-owned auth, prefer live user consent through extension `/ops`; for automation, prefer dedicated test accounts or application-owned test seams.

## Audit Incorporation And Runtime Validation
- The follow-up audit artifacts `.omo/ulw-loop/evidence/google-oauth-report-audit-recommendations.md` and `.omo/ulw-loop/evidence/google-oauth-report-audit-code-matrix.md` were reviewed and incorporated. Their overall verdict was WARN: the core thesis was valid, but several statements needed narrower wording.
- The audit correction for the previous research-run label was accepted. `--cookie-policy-override off` disables provider cookie import, not automatic managed-mode system Chrome cookie bootstrap.
- Safe OpenDevBrowser runtime validation on 2026-06-22 confirmed daemon health with `opendevbrowser status --daemon --output-format json`, including `fingerprintCurrent: true`, extension connected, and extension handshake complete.
- Safe OpenDevBrowser runtime validation launched a managed session to `https://example.com` using `opendevbrowser launch --no-extension --headless --start-url https://example.com --output-format json`. The launch returned mode `managed` and warning `System Chrome cookie bootstrap skipped 8 invalid cookies.`, confirming managed launch can run system Chrome cookie bootstrap independent of provider-cookie import.
- The managed validation session was inspected only at safe public URL scope with `opendevbrowser status --session-id ... --output-format json` and `opendevbrowser targets-list --include-urls ... --output-format json`, then closed with `opendevbrowser disconnect --close-browser`. No private Google content or cookie values were printed.
- Targeted tests passed with `npm run test -- tests/browser-manager.test.ts -t "system Chrome cookie|cdpConnect|cookie"`. These tests validate managed bootstrap ordering, CDP bootstrap, and cookie import/list behavior.
- Live personal Google OAuth reproduction was not performed because it would risk exposing private account state or triggering account-security behavior. That remains a separate, explicitly approved validation step if needed.
