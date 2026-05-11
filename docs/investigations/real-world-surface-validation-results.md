# Real-World Surface Validation Results

Status: current fix pass verified
Branch: `codex/real-world-surface-validation`
Started: 2026-05-10

## Verified Surface Inventory

- CLI commands: `77`
- OpenCode tools: `70`
- CLI-tool pairs: `67`
- CLI-only commands: `10`
- Tool-only helpers: `3`
- Provider ids in live scenario source: `22`
- Executable validation scenarios in inventory: `21`

Primary artifacts:

- `.opendevbrowser/real-world-surface-validation/workflow-inventory.json`
- `.opendevbrowser/real-world-surface-validation/workflow-surface-map.md`
- `.opendevbrowser/real-world-surface-validation/validation-primary.json`
- `.opendevbrowser/real-world-surface-validation/validation-primary.md`
- `.opendevbrowser/real-world-surface-validation/validation-secondary.json`
- `.opendevbrowser/real-world-surface-validation/validation-secondary.md`
- `.opendevbrowser/real-world-surface-validation/validation-secondary-after-extension-fix.json`
- `.opendevbrowser/real-world-surface-validation/validation-secondary-after-extension-fix.md`
- `.opendevbrowser/real-world-surface-validation/validation-secondary-community-media-runtime-fix.json`
- `.opendevbrowser/real-world-surface-validation/validation-secondary-community-media-runtime-fix.md`
- `.opendevbrowser/real-world-surface-validation/validation-secondary-final-owned-runtime-fix.json`
- `.opendevbrowser/real-world-surface-validation/validation-secondary-final-owned-runtime-fix.md`
- `.opendevbrowser/real-world-surface-validation/provider-direct-runs.json`
- `.opendevbrowser/real-world-surface-validation/provider-direct-runs-after-lifecycle-fix.json`
- `.opendevbrowser/real-world-surface-validation/tool-validation.json`

## Static Contract Gates

Passed:

- `npm run test -- tests/public-surface-manifest.test.ts tests/cli-help-parity.test.ts tests/parity-matrix.test.ts tests/workflow-inventory.test.ts tests/workflow-validation-matrix.test.ts`
- `npm run build`
- `npm run lint`
- `npm run typecheck`

Focused public-surface tests passed `52` tests across `5` files.

## Primary Matrix Result

Command:

```bash
node scripts/workflow-validation-matrix.mjs --variant primary --out .opendevbrowser/real-world-surface-validation/validation-primary.json --markdown-out .opendevbrowser/real-world-surface-validation/validation-primary.md
```

Summary:

- Executed scenarios: `17`
- Inventoried-only surfaces: `4`
- Pass: `12`
- Expected timeout: `2`
- Env-limited: `3`
- Fail: `0`
- Skipped: `0`

Pass evidence inspected:

- Research workflow produced `.opendevbrowser/research/74afd888-74e6-4a24-b5ec-0deef3814db5/report.md`, `records.json`, `context.json`, `meta.json`, and `bundle-manifest.json`.
- Shopping workflow produced `.opendevbrowser/shopping/c1a4c4ef-33cb-482a-bac6-0d8871c04d15/deals.md`, `offers.json`, `deals-context.json`, `comparison.csv`, `meta.json`, and `bundle-manifest.json`.
- Inspiredesign workflow produced `.opendevbrowser/inspiredesign/e20714bc-5acb-4beb-92e4-6031eca40101/advanced-brief.md`, `design-contract.json`, `canvas-plan.request.json`, `design-agent-handoff.json`, `evidence.json`, and implementation artifacts.
- Canvas live workflows passed in managed headless, managed headed, extension, and CDP surfaces with JSON artifacts in `/tmp/odb-canvas-*.json`.

Expected timeout:

- `feature.annotate.direct`: annotation UI started and waited for manual completion. Artifact: `/tmp/odb-annotate-direct-probe-1778458825314.json`.
- `feature.annotate.relay`: annotation UI started and waited for manual completion. Artifact: `/tmp/odb-annotate-relay-probe-1778458836389.json`.

Env-limited:

- `workflow.product_video.url`: Best Buy requires manual browser follow-up; managed mode did not determine whether login or rendering is required.
- `workflow.product_video.name`: Best Buy requires manual browser follow-up; managed mode did not determine whether login or rendering is required.
- `workflow.macro.community_search`: Reddit search returned `challenge_detected`.

Inventoried only:

- `guarded.connect.remote`
- `guarded.native.bridge`
- `guarded.rpc.surface`
- `non_cli.tool_only`

## Direct Provider Result

Command:

```bash
node scripts/provider-direct-runs.mjs --out .opendevbrowser/real-world-surface-validation/provider-direct-runs.json
```

Summary:

- Pass: `15`
- Env-limited: `8`
- Skipped: `4`
- Fail: `0`

Env-limited:

- `provider.community.search.keyword`: `challenge_detected`
- `provider.social.x.search`: `social_js_required_shell`
- `provider.social.reddit.search`: `social_verification_wall`
- `provider.social.bluesky.search`: `social_js_required_shell`
- `provider.social.facebook.search`: `env_limited`
- `provider.social.instagram.search`: `token_required`
- `provider.shopping.temu.search`: `env_limited`
- `provider.shopping.others.search`: `env_limited`

Superseded policy finding:

- The initial direct-provider run skipped Best Buy, Costco, and Macys through default high-friction/auth-gated policy. That is no longer acceptable coverage for this campaign.
- The direct-provider and provider-live matrices now execute Best Buy, Costco, and Macys by default as signed-in extension diagnostics with required cookies and browser-helper challenge handling.
- Macys now uses the slow shopping-provider timeout lane (`120000ms`) like Best Buy and Costco.

## Secondary Matrix Result

Command:

```bash
node scripts/workflow-validation-matrix.mjs --variant secondary --out .opendevbrowser/real-world-surface-validation/validation-secondary.json --markdown-out .opendevbrowser/real-world-surface-validation/validation-secondary.md
```

Summary:

- Executed scenarios: `17`
- Inventoried-only surfaces: `4`
- Pass: `10`
- Expected timeout: `2`
- Env-limited: `5`
- Fail: `0`
- Skipped: `0`

Additional env-limited outcomes:

- `workflow.research.run`: web-only Chrome extension debugger API query produced only shell records and no usable results.
- `workflow.product_video.url`: Best Buy requires manual browser follow-up.
- `workflow.product_video.name`: Best Buy requires manual browser follow-up.
- `workflow.macro.community_search`: Reddit search returned `challenge_detected`.
- `workflow.macro.media_search`: Reddit media route returned `social_verification_wall`.

Secondary pass artifacts inspected:

- Shopping workflow emitted `.opendevbrowser/shopping/e67b00d8-3fa0-4178-ab0a-d572b8165cb4`.
- Inspiredesign workflow emitted `.opendevbrowser/inspiredesign/0cf563b1-5532-482b-8a31-289ad139eed2`.
- Canvas live workflows again passed in managed headless, managed headed, extension, and CDP surfaces with JSON artifacts in `/tmp/odb-canvas-*.json`.

## Secondary Split Reruns After Relay Fix

Artifacts:

- `.opendevbrowser/real-world-surface-validation/validation-secondary-after-relay-fix.json`
- `.opendevbrowser/real-world-surface-validation/validation-secondary-after-relay-fix.md`
- `.opendevbrowser/real-world-surface-validation/validation-secondary-media-only.json`
- `.opendevbrowser/real-world-surface-validation/validation-secondary-media-only.md`
- `.opendevbrowser/real-world-surface-validation/validation-secondary-annotation-canvas-only.json`
- `.opendevbrowser/real-world-surface-validation/validation-secondary-annotation-canvas-only.md`
- `.opendevbrowser/real-world-surface-validation/validation-secondary-cdp-only.json`
- `.opendevbrowser/real-world-surface-validation/validation-secondary-cdp-only.md`

Findings:

- Full secondary rerun after temp relay port isolation still produced cascade noise: `7` pass, `2` env-limited, and `8` fail. The failures were mostly `Daemon not running. Start with opendevbrowser serve.` after earlier steps, not independent scenario regressions.
- Isolated `workflow.macro.media_search` passed with extension mode, cookies required, and browser helper enabled.
- Isolated annotation and canvas subset produced `2` expected timeouts for annotation manual completion, `3` canvas passes, and `1` CDP fail. The CDP failure detail was `Daemon on 127.0.0.1:8788 pid=96921 is protected by a different opendevbrowser build. Start with opendevbrowser serve.`
- After restarting to current-build daemon pid `99550`, `node dist/cli/index.js status --daemon --output-format json` reported `fingerprintCurrent=true`, extension connected, and handshake complete.
- Targeted `feature.canvas.cdp` rerun passed with artifact `/tmp/odb-canvas-cdp-hero-1778464748631.json`; steps included connect, session open, starter apply, preview overlay, design tab, code sync, export save, close, and disconnect.

Conclusion:

- `feature.canvas.cdp` is reclassified as pass on current-build daemon evidence.
- `workflow.macro.media_search` is reclassified as pass on isolated extension-mode evidence.
- The after-relay-fix full-matrix failures are classified as daemon lifecycle or harness cascade noise, not confirmed product defects in the affected annotation or canvas scenario implementations.
- Remaining unresolved secondary non-pass items to inspect are `workflow.research.run`, `workflow.macro.web_search`, and `workflow.macro.community_search`.

## Secondary Matrix After Signed-In and Daemon Fixes

Additional artifacts:

- `.opendevbrowser/real-world-surface-validation/research-after-fixes-3.json`
- `.opendevbrowser/real-world-surface-validation/macro-web-after-fixes.json`
- `.opendevbrowser/real-world-surface-validation/macro-community-after-fixes-4.json`
- `.opendevbrowser/real-world-surface-validation/macro-media-reddit-after-no-tab-fix.json`
- `.opendevbrowser/real-world-surface-validation/validation-secondary-after-no-tab-fix.json`
- `.opendevbrowser/real-world-surface-validation/validation-secondary-clean-relay-after-no-tab-fix.json`

Findings:

- Isolated `workflow.research.run` now passes with `success=true`, `records=1`, and `sanitized=1`; the earlier secondary failure was caused by browser recovery and overly broad login-shell sanitization.
- Isolated `workflow.macro.web_search` now passes in managed browser mode with `recordCount=4` and `failureCount=0`.
- Isolated `workflow.macro.community_search` now passes with signed-in extension mode, cookie policy `required`, and browser helper enabled. The evidence record uses `browser_fallback_mode=extension` and preserves a rendered Reddit search result instead of failing the whole traversal.
- Isolated `workflow.macro.media_search` now passes with signed-in extension mode, cookie policy `required`, and browser helper enabled. The run returned rendered Reddit records with `browser_fallback_reason_code=auth_required`, `browser_fallback_mode=extension`, and challenge helper stood down because capture cleared without an active challenge.
- The full secondary matrix after the `No tab attached` daemon fix completed with `11` pass, `1` expected timeout, `5` env-limited, and `0` fail. Remaining env-limited rows were either Best Buy managed product-video auth requirements or relay preflight gating from an already dirty CDP client.
- A clean-relay full rerun reproduced a daemon or harness cascade after Best Buy and community rows; subsequent annotate and canvas rows failed with `Daemon not running`. Controlled single-command reproduction did not reproduce product-video killing the daemon while the owning shell remained alive, so the full-matrix cascade remains harness-sensitive and is not yet evidence of an annotate or canvas product defect.

Conclusion:

- `workflow.research.run`, `workflow.macro.web_search`, `workflow.macro.community_search`, and `workflow.macro.media_search` are no longer accepted as provider or environment limits based on the old evidence. Each has current isolated pass evidence using the intended browser/cookie path.
- Superseded by later harness hardening: dirty relay clients and owning-shell daemon lifetime were a matrix lifecycle defect, not provider failure evidence.

## Secondary Matrix After Extension Reconnect Fix

Additional artifacts:

- `.opendevbrowser/real-world-surface-validation/validation-secondary-after-relay-cleanup.json`
- `.opendevbrowser/real-world-surface-validation/validation-secondary-canvas-after-extension-fix.json`
- `.opendevbrowser/real-world-surface-validation/validation-secondary-after-extension-fix.json`

Findings:

- The matrix harness now treats active `/ops` clients as dirty relay state, matching the direct-provider lifecycle fix. It also checks relay dirtiness before every extension-required row rather than only once at the shared-daemon preflight.
- The harness now waits for extension reconnection after it starts or recycles a daemon. Fresh daemon starts no longer immediately classify extension rows as `extension_disconnected`.
- The extension background auto-connect path no longer treats relay-takeover suppression as permanent. When the relay has no active extension client, auto-connect retries the relay instead of staying disconnected until a manual popup click.
- Targeted canvas extension/CDP rerun passed with `2` pass, `0` env-limited, and `0` fail in `.opendevbrowser/real-world-surface-validation/validation-secondary-canvas-after-extension-fix.json`.
- Full secondary rerun passed with `15` pass, `2` expected timeouts, `0` env-limited, and `0` fail in `.opendevbrowser/real-world-surface-validation/validation-secondary-after-extension-fix.json`.

Conclusion:

- The secondary matrix alternate low-level and workflow paths are now clean on current evidence.
- The prior secondary `env_limited` rows for signed-in community/media searches, canvas extension/CDP, and daemon-cascade failures are superseded by the full clean rerun.
- The extension drop issue was a product defect in reconnect suppression after relay takeover, plus a harness defect that did not wait for reconnect after daemon restart.

## Secondary Matrix Owned-Daemon Lifecycle Fix

Additional fix:

- Full secondary matrix runs now recycle any reused configured daemon at the start of the shared scenario block, even if the daemon is current and the relay looks clean. This makes the matrix own daemon lifetime instead of depending on a daemon process started from another shell.
- The initial infra step records whether the previous relay was dirty and whether the daemon was recycled for ownership. Extension-required rows still re-check `/ops`, `/cdp`, canvas, and annotation clients before each row and recycle again if a prior row leaves the relay dirty.
- If the extension was ready before a recycle and does not reconnect after the harness-owned daemon starts, the matrix now classifies that as a harness or extension failure (`extension_disconnected_after_recycle`) instead of downgrading it to a provider or environment limit.

Conclusion:

- Dirty relay clients and shell-owned daemon lifetime are fixed as harness lifecycle issues. They should no longer be used as provider-limit classifications for full secondary matrix rows.

## Secondary Matrix Final Runtime Fix

Additional artifacts:

- `.opendevbrowser/real-world-surface-validation/validation-secondary-community-media-runtime-fix.json`
- `.opendevbrowser/real-world-surface-validation/validation-secondary-community-media-runtime-fix.md`
- `.opendevbrowser/real-world-surface-validation/validation-secondary-final-owned-runtime-fix.json`
- `.opendevbrowser/real-world-surface-validation/validation-secondary-final-owned-runtime-fix.md`

Fixes:

- Community provider extension fallback now attaches with the requested `startUrl`, matching social and shopping fallback behavior. This prevents Reddit community search from attaching to a stale, restricted, or unrelated active tab.
- Explicit community extension fallback now verifies the attached URL and uses the same bounded extension retry loop as social and shopping when `/ops` handshake or relay attachment fails.
- The full secondary matrix now owns the configured daemon lifecycle and can recycle a dirty relay before an extension-required row without turning provider scenarios into false `env_limited` outcomes.

Verification:

- Targeted secondary rerun for `workflow.macro.community_search` and `workflow.macro.media_search` passed with `2` pass, `0` expected timeout, `0` env-limited, and `0` fail.
- Full secondary rerun passed with `15` pass, `2` expected timeouts, `0` env-limited, and `0` fail.
- The only non-pass full-secondary rows are `feature.annotate.direct` and `feature.annotate.relay`, both expected manual annotation timeouts.
- The final daemon cleanup check returned `Daemon not running. Start with opendevbrowser serve.`, so the harness did not leave an active daemon behind.

Conclusion:

- Full secondary matrix contamination from dirty relay clients and shell-owned daemon lifetime is fixed, not merely documented.
- The previous community/media `env_limited` rows are superseded by passing targeted and full-matrix evidence.
- Any future secondary provider `env_limited` classification must come from current provider evidence, not inherited relay clients, stale active tabs, or externally owned daemon lifetime.

## Desktop Observation Result

Temporary daemon:

```bash
node dist/cli/index.js serve --output-format json
```

Validated commands:

- `node dist/cli/index.js desktop-status --timeout-ms 10000 --output-format json`
- `node dist/cli/index.js desktop-windows --reason "real-world validation desktop window inventory" --timeout-ms 10000 --output-format json`
- `node dist/cli/index.js desktop-active-window --reason "real-world validation active window" --timeout-ms 10000 --output-format json`
- `node dist/cli/index.js desktop-capture-desktop --reason "real-world validation desktop screenshot" --timeout-ms 15000 --output-format json`
- `node dist/cli/index.js desktop-capture-window --window-id 50 --reason "real-world validation active window screenshot" --timeout-ms 15000 --output-format json`
- `node dist/cli/index.js desktop-accessibility-snapshot --window-id 50 --reason "real-world validation active window accessibility" --timeout-ms 15000 --output-format json`

Result:

- Status: pass.
- Permission level: `observe`.
- Capabilities: `observe.windows`, `observe.screen`, `observe.window`, `observe.accessibility`.
- Window inventory found browser, Codex, Repo Prompt, Finder, Code, and OpenCode windows.
- Desktop screenshot artifact: `.opendevbrowser/desktop-runtime/61ae866d-6f88-4f6e-9cef-482833737b6c.png`.
- Window screenshot artifact: `.opendevbrowser/desktop-runtime/e0127e89-7eb8-454e-822a-2944db4f89b3.png`.
- Accessibility snapshot returned an `AXWindow` tree for the active Codex window.

Daemon cleanup:

```bash
node dist/cli/index.js serve --stop --output-format json
```

## OpenCode Tool Surface Result

Temporary runner:

```bash
node /tmp/odb-tool-validation.mjs
```

Result:

- Status: pass.
- Registered tools: `70`.
- Tool calls executed: `15`.
- Local-only helpers passed: `opendevbrowser_prompting_guide`, `opendevbrowser_skill_list`, `opendevbrowser_skill_load`.
- Managed browser tool flow passed: `opendevbrowser_launch`, `opendevbrowser_status`, `opendevbrowser_goto`, `opendevbrowser_wait`, `opendevbrowser_snapshot`, `opendevbrowser_screenshot`, `opendevbrowser_dom_get_text`, `opendevbrowser_debug_trace_snapshot`, `opendevbrowser_perf`, `opendevbrowser_disconnect`.
- Desktop tool probe passed: `opendevbrowser_desktop_status`.
- Screenshot artifact: `.opendevbrowser/real-world-surface-validation/tool-example-screenshot.png`.
- JSON evidence: `.opendevbrowser/real-world-surface-validation/tool-validation.json`.

Note:

- The first attempt used a synthetic `page` ref for `opendevbrowser_dom_get_text` and correctly failed with `Unknown ref: page. Take a new snapshot first.` The validation script was corrected to extract a real ref from `opendevbrowser_snapshot`; this was a test harness issue, not a product defect.

Expanded family pass:

- JSON evidence: `.opendevbrowser/real-world-surface-validation/tool-family-expanded-validation.json`.
- Registered tools: `70`.
- Direct tool calls executed: `64`.
- Covered families: local guidance and skills, macro preview, managed browser lifecycle, target/page management, navigation/wait/snapshot, click/type/press/hover/check/uncheck/select/upload, pointer move/down/up/drag, scrolling, DOM text/html, attribute/value/state queries, clone component/page export, cookie import/list, screenshot, screencast start/stop, console/network/debug trace, performance, dialog status, browser review, session inspector/plan/audit, multi-step run, disconnect, and desktop status/windows/active-window.
- The pass used a local `http://127.0.0.1:<port>/tool-family` form page instead of a `data:` URL because `status_capabilities` correctly requires http(s) URLs for cookie diagnostics.
- Expected manual/interactive outcome: `opendevbrowser_annotate` direct annotation was invoked with a short timeout and recorded as expected manual failure, not a product defect.
- Artifacts: `.opendevbrowser/real-world-surface-validation/tool-family-expanded.png`, `.opendevbrowser/real-world-surface-validation/tool-family-screencast/`, and `.opendevbrowser/real-world-surface-validation/tool-family-upload.txt`.

## Product-Video Browser-Assisted Follow-Up

Command:

```bash
node dist/cli/index.js product-video run --product-url "https://www.bestbuy.com/site/logitech-mx-master-3s-wireless-laser-mouse-with-ultrafast-scrolling-8k-dpi-any-surface-tracking-and-quiet-clicks-pale-gray/6502574.p?skuId=6502574" --browser-mode extension --use-cookies --challenge-automation-mode browser_with_helper --include-copy --include-screenshots --timeout-ms 180000 --output-dir .opendevbrowser/real-world-surface-validation/product-video-bestbuy-url-extension --output-format json
```

Result:

- Status: `env_limited`.
- Detail: `Bestbuy requires manual browser follow-up; this run did not determine whether login or page rendering is required.`
- The same classification occurred after enabling extension mode, cookies, browser helper, copy extraction, and screenshots.
- Conclusion: this remains env/provider-limited evidence, not a confirmed product defect.

Current-build rerun:

- Preflight passed on the dirty tree: `npm run build`, `npm run typecheck`, `npm run lint`, and focused tests across CLI args, macro/provider runtime, provider scripts, public surface, and workflow tools.
- Restarted the daemon from `dist/cli/index.js`; `status --daemon` reported `Daemon fingerprint: current` and extension handshake healthy.
- `shopping run --query "logitech mx master 3s" --providers shopping/bestbuy --browser-mode extension --use-cookies --cookie-policy required --challenge-automation-mode browser_with_helper --mode json --output-dir .opendevbrowser/real-world-surface-validation/shopping-bestbuy-extension-current --output-format json` passed with `3` priced Best Buy offers and `browser_fallback_mode=extension`.
- Fresh product-video rerun to `.opendevbrowser/real-world-surface-validation/product-video-bestbuy-url-extension-current-fresh` exited `2` with `Bestbuy requires manual browser follow-up; this run did not determine whether login or page rendering is required.` and did not create an artifact directory.
- A preexisting non-fresh product-video output directory contained a Best Buy error-page bundle; fresh rerun evidence shows the current build does not emit a new misleading artifact for this failure.

Cleanup note:

- Current `node dist/cli/index.js serve --stop --output-format json` correctly rejected a stale foreground daemon with exit code `2` and `Daemon rejected stale stop request`.
- The stale foreground daemon process ignored `SIGTERM` and exited after `SIGINT`.
- This narrows the lifecycle concern to stale foreground signal handling, not the earlier false-success stop behavior. Reproduce with current-build foreground `serve` before filing a product defect.

Additional Best Buy evidence:

- Live Best Buy shopping with signed-in extension mode passed and returned `3` priced offers under `.opendevbrowser/real-world-surface-validation/shopping-bestbuy-extension-current/shopping/e186c366-bfba-464c-987b-c97225ba83ac`.
- Product-video using the current Best Buy product URL from that shopping result passed in extension mode and produced a complete bundle under `.opendevbrowser/real-world-surface-validation/product-video-bestbuy-live-url-extension/product-video/3168e3dd-7044-4a9f-b688-ae953ebca081`.
- Product-video using the same current Best Buy URL in managed headed browser-assisted mode returned `Bestbuy requires login or an existing session` and left the daemon alive during the controlled reproduction.
- Product-video using the stale `/site/...skuId=6502574` Best Buy URL still returns manual follow-up and no longer emits a misleading fresh artifact.

Updated classification:

- Best Buy product-video is not a universal provider or environment limit. The extension signed-in lane can succeed when given a current Best Buy product URL.
- Managed headed product-video remains `auth_required` for Best Buy, which is expected unless a signed-in session is imported or reused.
- The stale `/site/...skuId=6502574` URL is a high-friction Best Buy lane and should be treated as a diagnostic scenario, not release-gate proof of product-video failure.

## Daemon Lifecycle Defect

Confirmed and fixed:

- During signed-in Reddit media validation, the daemon crashed with Playwright Chromium transport error `Error: No tab attached` at `CRSession._onMessage`.
- The daemon already treated related detached Playwright transport errors as recoverable. The fix extends the same guarded recovery path to `No tab attached` transport assertions and adds regression coverage in `tests/daemon-e2e.test.ts`.
- Focused verification passed: `npm run test -- tests/daemon-e2e.test.ts -t "keeps the daemon alive after Playwright"`.

Current lifecycle status:

- Full validation-matrix runs now own the configured daemon for the shared scenario block and recycle between extension-required rows when relay clients remain active.
- Controlled product-video managed headed reproduction with daemon stop debug enabled returned `auth_required` and kept the daemon alive while the owner shell remained active.

## Product Defects

Fixed:

- Daemon crash on Playwright Chromium `No tab attached` transport assertion during provider fallback.
- Direct-provider harness relay lifecycle contamination: signed-in extension preflights now treat active `/ops`, `/cdp`, canvas, and annotation clients as dirty relay state; temporary launch sessions are disconnected before provider execution; stale fingerprint daemons are stopped before replacement; and owned daemons are recycled before transport retries.
- Secondary matrix relay and daemon lifecycle contamination: full shared matrix runs now own the configured daemon lifecycle, extension-required rows start from a clean relay lease, active `/ops` clients are treated as dirty, and daemon restart/recycle paths wait for extension reconnect before classifying the row.
- Community extension fallback contamination: Reddit community searches now attach with the requested start URL, verify the attached URL for explicit extension runs, and retry bounded relay attachment failures before classification.
- Extension auto-connect suppression after relay takeover: suppression now remains in effect only while another extension client is actually connected; if the relay has no extension client, auto-connect reconnects instead of requiring a manual popup click.

Not product defects on current evidence:

- Old unsigned direct provider classifications for X, Reddit, Bluesky, Facebook, Instagram, and shopping are invalid as release-gate evidence because signed-in extension and cookie-required paths were not consistently exercised.
- Best Buy product-video with a current Best Buy URL succeeds in extension signed-in mode. Managed headed mode without a reusable Best Buy session remains `auth_required`.
- Best Buy, Costco, and Macys direct-provider search are not environment-limited on fresh current evidence. Full direct-provider rerun `.opendevbrowser/real-world-surface-validation/provider-direct-runs-after-lifecycle-fix.json` completed with `17` pass, `10` env-limited, `0` fail, and `0` skipped; Best Buy returned `1` offer, Costco returned `8`, and Macys returned `1`.
- The earlier Macys Access Denied / ops-handshake observation is superseded by prior isolated pass evidence and the full post-lifecycle-fix pass. Treat it as relay contamination, not a provider classification change.
- Historical canvas and annotation full-matrix failures after a daemon loss were harness cascade evidence, not independent canvas or annotation defects; the harness now owns daemon lifecycle to prevent that cascade.
- Historical secondary community and media `env_limited` rows were harness and runtime attach contamination. Current targeted and full secondary evidence passes those lanes.

## Follow-Up Queue

- Keep Best Buy stale-URL product-video as a non-release-gate diagnostic lane. Current Best Buy product URLs pass in signed-in extension mode; managed headed mode without a reusable session remains `auth_required`.

## Final Verification

Latest gate pass on the current dirty tree:

- `npm run build`
- `npm run test -- tests/providers-runtime-factory.test.ts tests/workflow-validation-matrix.test.ts`: `116` passed.
- `node scripts/workflow-validation-matrix.mjs --variant secondary --scenario workflow.macro.community_search --scenario workflow.macro.media_search --out .opendevbrowser/real-world-surface-validation/validation-secondary-community-media-runtime-fix.json --markdown-out .opendevbrowser/real-world-surface-validation/validation-secondary-community-media-runtime-fix.md`: `2` pass, `0` env-limited, `0` fail.
- `node scripts/workflow-validation-matrix.mjs --variant secondary --out .opendevbrowser/real-world-surface-validation/validation-secondary-final-owned-runtime-fix.json --markdown-out .opendevbrowser/real-world-surface-validation/validation-secondary-final-owned-runtime-fix.md`: `15` pass, `2` expected timeouts, `0` env-limited, `0` fail.
- `npm run extension:build`
- `npm run typecheck`
- `npm run lint`
- `git diff --check`
- `npm run test`: `4296` passed, `1` skipped; global coverage `98.17%` statements, `97%` branches, `97.87%` functions, `98.24%` lines.

Daemon cleanup check:

- `node dist/cli/index.js status --daemon --output-format json` returned `Daemon not running. Start with opendevbrowser serve.`, so the final verification pass did not leave an active daemon behind.
