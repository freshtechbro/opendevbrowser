# Workflow Execution Inventory

This file is the live execution inventory for the workflow-stability pass requested on 2026-03-31. It tracks the exact executed surfaces, their real-life tasks, and the current evidence-backed status after the April 1 follow-up loop.

## Scope rules

- Included:
  - first-class CLI workflow families,
  - probe-backed workflow variants that execute real `opendevbrowser` CLI sequences,
  - safe read-only macro execution paths.
- Excluded from direct execution:
  - audit aggregators that only summarize other lanes,
  - docs or cleanup commands,
  - skill wrappers that only shell out to the same CLI surfaces,
  - unsafe write-path workflows that need operator confirmation and a real account target.

## Included workflow matrix

| ID | Surface | Entry path | Round 1 real-life task | Round 2 task change | Owner seam | Current observed status | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `run.script` | Single-shot script runner | `opendevbrowser run --script ...` | Capture a quick page outline from the MDN `Document.querySelector()` docs page for a debugging note | Capture a quick page outline from the Vitest docs getting-started page | `src/core/logging.ts`, `src/cli/commands/run.ts`, `src/browser/browser-manager.ts` | `pass_clean_stdout` | `/tmp/odb-run-pass2.out` is a single clean JSON object. The earlier stdout-pollution read was combined stdout/stderr observation, not malformed stdout from the command itself. |
| `annotate.direct` | Direct annotation workflow | `node scripts/annotate-live-probe.mjs --transport direct` | Launch a managed tab and request annotation on a simple public page as if reviewing a landing-page hero | Re-run as the same workflow boundary check | `scripts/annotate-live-probe.mjs` | `expected_timeout` | `/tmp/odb-annotate-direct-pass1.json` remains expected manual-boundary evidence, not a defect. |
| `annotate.relay` | Relay annotation workflow | `node scripts/annotate-live-probe.mjs --transport relay` | Request relay-backed annotation on the connected extension tab | Re-run as the same relay boundary check | `scripts/annotate-live-probe.mjs` | `expected_timeout` | `/tmp/odb-annotate-relay-pass1.json` shows relay preflight passed and the probe timed out as designed. |
| `canvas.managed_headless` | Canvas live workflow | `node scripts/canvas-live-workflow.mjs --surface managed-headless` | Build and patch a hero composition headlessly for a marketing landing page | Repeat on the same surface after fixes | `scripts/canvas-live-workflow.mjs` | `pass` | `/tmp/odb-canvas-managed-headless-pass1.json`. |
| `canvas.managed_headed` | Canvas live workflow | `node scripts/canvas-live-workflow.mjs --surface managed-headed` | Build and patch the same hero composition in a visible managed browser | Repeat on the same surface after fixes | `scripts/canvas-live-workflow.mjs` | `pass` | `/tmp/odb-canvas-managed-headed-pass1.json`. |
| `canvas.extension` | Canvas live workflow | `node scripts/canvas-live-workflow.mjs --surface extension` | Run the live hero-edit workflow through the connected extension surface | Repeat on the same surface after fixes | `scripts/canvas-live-workflow.mjs`, `extension/src/ops/ops-runtime.ts` | `pass_after_extension_reload` | The focused repro `/tmp/odb-root-synthetic-preview-repro.json` passed after the user reloaded the unpacked extension, then the full workflow passed at `/tmp/odb-canvas-extension-pass7.json`. The earlier `restricted_url` result was stale-runtime drift. |
| `canvas.cdp` | Canvas live workflow | `node scripts/canvas-live-workflow.mjs --surface cdp` | Run the live hero-edit workflow through the legacy `/cdp` connection path | Repeat on the same surface after fixes | `scripts/canvas-live-workflow.mjs`, `scripts/live-regression-direct.mjs` | `pass` | The full `/cdp` workflow now passes at `/tmp/odb-canvas-cdp-pass5.json`. The earlier hang did not reproduce after the extension reload and rerun. |
| `macro.web_search` | Macro execute workflow | `opendevbrowser macro-resolve --execute ...` | Search the web for MDN Playwright locator references to answer a browser-automation debugging question | Search for Chrome DevTools Protocol popup handling references instead | `src/macros/execute.ts`, `src/providers/index.ts`, `scripts/provider-direct-runs.mjs` | `pass_with_honest_upstream_shell_boundary` | The internal DuckDuckGo query-page rank leak is fixed in `src/providers/index.ts` and revalidated by `tests/providers-runtime.test.ts`, `tests/macros.test.ts`, and `tests/provider-direct-runs.test.ts`. A direct CLI rerun on 2026-04-01 returned only real Chrome docs ranked `1..4` for `site:developer.chrome.com devtools protocol popup attach`. A subsequent saved rerun at `/tmp/odb-macro-web-search-ddg-pass1.json` failed honestly with `challenge_shell` after DuckDuckGo answered `202` with only self/static links, so the remaining variability is upstream search-engine shell behavior rather than the earlier ranking bug. |
| `macro.web_fetch` | Macro execute workflow | `opendevbrowser macro-resolve --execute ...` | Fetch a public docs page to extract page content for direct inspection | Fetch a different public docs page | `src/macros/execute.ts`, `src/providers/index.ts`, `scripts/provider-direct-runs.mjs` | `pass` | `node dist/cli/index.js macro-resolve --execute --expression '@web.fetch("https://developer.chrome.com/docs/extensions/reference/api/debugger")' --timeout-ms 120000 --challenge-automation-mode browser_with_helper --output-format json` passed cleanly. |
| `macro.community_search` | Macro execute workflow | `opendevbrowser macro-resolve --execute ...` | Search public community discussions for browser automation failures | Search community discussions for popup attach failures instead | `src/macros/execute.ts`, `src/providers/index.ts`, `scripts/provider-direct-runs.mjs` | `pass` | Round 1 returned usable Reddit/community results plus expansions. |
| `macro.media_search` | Macro execute workflow | `opendevbrowser macro-resolve --execute ...` | Search public social/media results for browser automation coverage on YouTube and first-party social platforms | Re-run on X, Reddit, and Bluesky after the social-shell fixes | `src/macros/execute.ts`, `src/providers/index.ts`, `src/providers/social/search-quality.ts`, `scripts/provider-direct-runs.mjs` | `x_reddit_pass_bluesky_honest_env_limited` | `/tmp/odb-x-live-20260401c.json` and `/tmp/odb-reddit-live-20260401d.json` stay on first-party destinations and return usable results, though ranking is still noisy. `/tmp/odb-bluesky-live-20260401j.json` no longer false-greens and now fails honestly as `env_limited` when the active session is logged out or otherwise not reusable. Earlier logged-in extension proof still exists at `/tmp/odb-bluesky-extension-proof-20260401a`. |
| `research.run` | Research workflow | `opendevbrowser research run ...` | Build a 14-day market map of browser automation production blockers across auto-selected sources | Re-run the same workflow after false-green closure | `src/providers/workflows.ts` | `honest_fail_shell_only` | `/tmp/odb-research-pass2.out` now exits with `success:false` and `exitCode:2` instead of returning an empty false green. |
| `shopping.run` | Shopping workflow | `opendevbrowser shopping run ...` | Find the best USB microphone under $150 in the US with extension browser fallback available | Find a 27-inch 4K monitor under $350 using managed browser fallback and explicit providers | `src/providers/shopping-postprocess.ts`, `src/providers/workflows.ts`, `src/providers/runtime-factory.ts` | `offers_returned_with_walmart_manual_followup` | `/tmp/odb-shopping-pass4/shopping/8700108c-04db-44c9-af37-0fcb5ec9a84d` now returns 8 real offers from Best Buy and eBay instead of the earlier capture-timeout empty state. Walmart preserves an honest anti-bot challenge with reused cookies and `primary_constraint.reasonCode="challenge_detected"`, while Amazon remains an honest `env_limited` no-offer branch rather than a stale transport timeout. |
| `product_video.direct` | Product presentation asset workflow | `opendevbrowser product-video run --product-url ...` | Generate an asset pack from a real public Amazon PDP | Generate an asset pack from a different real public product URL | `src/providers/workflows.ts`, `src/providers/shopping-postprocess.ts` | `honest_amazon_manual_followup` | `node dist/cli/index.js product-video run --product-url "https://www.amazon.com/dp/B0CHWRXH8B" --output-dir /tmp/odb-product-video-pass4-direct --timeout-ms 180000 --use-cookies --challenge-automation-mode browser_with_helper --output-format json` now exits with `Amazon requires manual browser follow-up; this run did not determine a reliable PDP price.` The earlier zero-price false success is closed. |
| `product_video.name` | Product presentation asset workflow | `opendevbrowser product-video run --product-name ...` | Resolve a product by name and generate an asset pack through shopping-backed URL resolution | Resolve a different product name with a provider hint | `src/providers/workflows.ts`, `src/providers/product-video-compiler.ts` | `honest_walmart_challenge_boundary` | `node dist/cli/index.js product-video run --product-name "Apple AirPods Pro 2nd Generation" --provider-hint shopping/walmart --output-dir /tmp/odb-product-video-pass4-name-walmart --timeout-ms 180000 --use-cookies --challenge-automation-mode browser_with_helper --output-format json` now exits with `Walmart hit an anti-bot challenge that requires manual completion.` The older noisy-success Walmart artifact is no longer the current truth. |
| `login.fixture` | Composite login automation probe | `node scripts/login-fixture-live-probe.mjs` | Run the repo-local login workflow through invalid-credentials, MFA, and session-persistence branches | Re-run after fixes; the fixture already exercises multiple realistic login branches | `scripts/login-fixture-live-probe.mjs` | `pass` | `/tmp/odb-login-fixture-pass1.json`. This is a probe-backed validation surface rather than a first-class CLI family. |

## Inventoried but not executed directly

| Surface | Reason |
| --- | --- |
| Skill wrapper scripts under `skills/opendevbrowser-*/scripts/` | They repackage the same CLI workflow families and would duplicate the underlying execution evidence. |
| `scripts/provider-direct-runs.mjs` | Validation harness used to support macro and shopping reruns, not a primary workflow family. |
| `scripts/live-regression-direct.mjs` | Aggregates canvas, annotate, and smoke probes; not a primary workflow family. |
| Data-extraction and form-testing skill recipes | Built from primitive CLI commands or `run --script`, not shipped as distinct top-level workflow families. |
| `scripts/skill-runtime-audit.mjs` | Aggregate audit lane, not a user-launched workflow. |
| Social write-path macros such as `@social.post(...)` | Unsafe without explicit operator confirmation and a real target account. |

## Status

The rollout is no longer in the original mixed false-green state.

- Passing or holding at expected manual boundaries:
  - `run.script`
  - `annotate.direct`
  - `annotate.relay`
  - `canvas.managed_headless`
  - `canvas.managed_headed`
  - `canvas.extension`
  - `canvas.cdp`
  - `macro.community_search`
  - `login.fixture`
- Honest non-success outcomes that still need broader workflow follow-up:
  - `macro.media_search` on Bluesky
  - `research.run`
  - `shopping.run`
  - `product_video.direct`
  - `product_video.name`
- Still unresolved functional defects or missing reruns:
  - no remaining `macro.web_fetch` defect is open from the April 1 rerun

- Honest upstream variability that is now classified rather than falsely green:
  - `macro.web_search`
    - the prior internal DDG shell-leak defect is closed, but repeated DuckDuckGo HTML reruns can still return a shell-only `202` page with no usable external results

## Current fix order

1. continue the broader workflow matrix from the now-honest shopping and product-video boundaries
2. decide whether Walmart anti-bot recovery needs any further seam-local auth/session work or remains a documented manual boundary
3. run the remaining repo gates and refresh the docs from the final artifact set, keeping `macro.web_search` recorded as an honest upstream shell boundary unless new internal evidence contradicts that classification
4. create atomic commits once the closure gates agree with the live artifact set
