# Browser Agent Known-Issues Matrix

This matrix defines the minimum robustness controls for OpenDevBrowser workflow skills.

## Issue Controls

| ID | Known issue | Typical signals | Required controls | Evidence to capture |
|---|---|---|---|---|
| `ISSUE-01` | DOM churn invalidates refs | action fails after render, detached/stale element behavior, missing ref | enforce `snapshot -> one action -> snapshot`, retry once after fresh snapshot, avoid reusing refs across navigation | before/after snapshots + failing action + retry outcome |
| `ISSUE-02` | Frame/iframe boundaries hide interactive targets | expected refs not found in top document, challenge widget rendered in iframe | detect frame context before action, route frame-specific steps, checkpoint when cross-origin challenge frame blocks continuation | snapshot outline showing frame branch + checkpoint note |
| `ISSUE-03` | Popup/new-tab auth flows break linear scripts | click triggers new tab/popup, current tab loses focus | detect target/page changes, rebind to active auth target, verify post-auth return target | target/page list before and after auth click |
| `ISSUE-04` | Step-up auth and session expiry alter login path | MFA/passkey prompt appears, unexpected redirect to reauth | branch login state machine explicitly, validate >=2 independent auth success signals, validate reauth policy separately | auth signal log with URL, element, network confirmation |
| `ISSUE-05` | Anti-bot challenge loops stall automation | repeated challenge pages/widgets, repeated 403/429 around auth/submit | treat as checkpoint, never bypass, set loop budget, escalate after repeated challenge loops | challenge checkpoint log with timestamps and outcome |
| `ISSUE-06` | Rate-limit pressure and server backoff ignored | 429 responses, throttle banners, `Retry-After` headers | stop aggressive retries, honor `Retry-After`, bounded retry budget with cooldown windows | network poll evidence with status + backoff decision |
| `ISSUE-07` | MV3 extension service worker suspends state | extension relay disconnects after idle, handshake drop | re-check extension readiness before critical steps, include reconnect path and resumed snapshot checkpoint | daemon status (`extensionConnected`, `extensionHandshakeComplete`) before resume |
| `ISSUE-08` | Restricted origins and policy blocks | `chrome://` / extension pages blocked, unsupported origin errors | validate URL/domain eligibility before workflow, fail fast with actionable reason | blocked-origin decision in run log |
| `ISSUE-09` | Pagination drift and duplicate extraction | duplicate records across pages, endless loop/no page delta | canonical dedupe keys, terminal conditions, positive delta gate, checkpoint/resume metadata | pagination state + quality-gate report |
| `ISSUE-10` | Locale/currency parsing inconsistency | mixed currency symbols, malformed numbers | normalize currency/amount explicitly, avoid cross-currency comparison without conversion context | normalized records with currency and parse confidence |
| `ISSUE-11` | Discount anchor is weak or misleading | anchor price missing/untrusted, “sale” not below market | separate anchor discount from market discount, tag anchor confidence, require market-baseline confirmation | market analysis with anchor coverage and warnings |
| `ISSUE-12` | Stale price or unsupported claims in presentation assets | captured price outdated, marketing claims not traceable | enforce freshness checks, claim-to-evidence mapping, block unsupported superlatives | claims-evidence map + pricing timestamp |

## Skill Coverage Targets

- `opendevbrowser-login-automation`: `ISSUE-01`, `ISSUE-02`, `ISSUE-03`, `ISSUE-04`, `ISSUE-05`, `ISSUE-06`, `ISSUE-07`
- `opendevbrowser-form-testing`: `ISSUE-01`, `ISSUE-02`, `ISSUE-05`, `ISSUE-06`, `ISSUE-08`
- `opendevbrowser-data-extraction`: `ISSUE-01`, `ISSUE-06`, `ISSUE-08`, `ISSUE-09`, `ISSUE-10`
- `opendevbrowser-shopping`: `ISSUE-06`, `ISSUE-09`, `ISSUE-10`, `ISSUE-11`, `ISSUE-12`
- `opendevbrowser-product-presentation-asset`: `ISSUE-10`, `ISSUE-11`, `ISSUE-12`
- `opendevbrowser-research`: `ISSUE-06`, `ISSUE-09`, `ISSUE-10`, `ISSUE-12`

## Source Notes

- Playwright best practices (locator and timing stability): https://playwright.dev/docs/best-practices
- Playwright frames guidance: https://playwright.dev/docs/frames
- Playwright pages/popups guidance: https://playwright.dev/docs/pages
- Chrome extension MV3 service worker lifecycle: https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
- HTTP 429 semantics and `Retry-After`: https://www.rfc-editor.org/rfc/rfc6585
- OWASP Authentication Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
- WCAG 2.2 (accessible authentication): https://www.w3.org/TR/WCAG22/
- Cloudflare Turnstile testing keys: https://developers.cloudflare.com/turnstile/tutorials/testing/
- reCAPTCHA testing keys: https://developers.google.com/recaptcha/docs/faq
- hCaptcha docs: https://docs.hcaptcha.com/
- RFC 9309 robots protocol: https://www.rfc-editor.org/rfc/rfc9309
- FTC deceptive pricing guide: https://www.ecfr.gov/current/title-16/chapter-I/subchapter-B/part-233
