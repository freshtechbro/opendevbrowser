# Workflow Live Validation 2026-03-31

Updated 2026-04-01 with follow-up evidence from the active workflow-stability loop.

Code-backed inventory of current user-style workflow families in `opendevbrowser`, the real-life tasks used to exercise them, and the execution routes used for live validation.

## Inclusion rule

Include only surfaces that satisfy at least one of these:

- shipped as a user-facing CLI workflow command,
- executed through the CLI as a real user workflow with a dedicated repo probe,
- solves a concrete user task rather than only aggregating audit results.

Exclude audit-only aggregators, docs checks, and pack validators even when they invoke workflow probes internally.

## Included workflow families

| Workflow family | User entry | Code evidence | Primary validation route | Round 1 task | Round 2 task |
| --- | --- | --- | --- | --- | --- |
| Research workflow | `research run` | `src/cli/commands/research.ts`, `src/cli/daemon-commands.ts`, `src/providers/workflows.ts` | direct CLI | Investigate recent browser automation production blockers across default sources | Re-run after false-green closure to confirm the workflow now fails honestly when only shells survive |
| Shopping workflow | `shopping run` | `src/cli/commands/shopping.ts`, `src/cli/daemon-commands.ts`, `src/providers/workflows.ts` | direct CLI | Find the best USB microphone options under a realistic budget | Compare portable-monitor offers with explicit providers and managed browser fallback |
| Product-video asset workflow | `product-video run` | `src/cli/commands/product-video.ts`, `src/cli/daemon-commands.ts`, `src/providers/workflows.ts` | direct CLI plus fixture probe for targeted reruns | Build a product asset pack from a live product URL | Build a product asset pack from product name plus provider hint |
| Macro provider execution workflow | `macro-resolve --execute` | `src/cli/commands/macro-resolve.ts`, `src/cli/daemon-commands.ts`, `src/macros/execute.ts`, `src/providers/index.ts` | direct CLI and provider-direct harness | Run web, community, and social provider actions for a real browser-automation research task | Re-run first-party social variants after the shell-quality fixes |
| Single-shot script workflow | `run --script` | `src/cli/index.ts`, `src/cli/commands/run.ts` | direct CLI | Run a one-off extraction script that opens a page, snapshots it, and captures structured text | Run a second script against a different page and interaction sequence |
| Annotation workflow | `annotate` | `src/cli/commands/annotate.ts`, `docs/CLI.md`, `scripts/annotate-live-probe.mjs` | CLI-driven probe | Request a direct annotation session on a live page | Request a relay annotation session and verify boundary behavior |
| Canvas live-edit workflow | `canvas` | `src/cli/commands/canvas.ts`, `docs/CLI.md`, `scripts/canvas-live-workflow.mjs` | CLI-driven probe | Execute the managed-headless hero edit workflow | Execute a second surface variant with different transport and preview constraints |

## Included through probes

These stay in scope because the probes execute the public CLI under the hood and encode real user-style flows:

- `scripts/login-fixture-live-probe.mjs`
- `scripts/annotate-live-probe.mjs`
- `scripts/canvas-live-workflow.mjs`
- `scripts/product-video-fixture-live-probe.mjs`

## Excluded from the live workflow matrix

| Surface | Why excluded | Code evidence |
| --- | --- | --- |
| Data-extraction and form-testing skill recipes | Built from primitive CLI commands or `run --script`, not shipped as distinct workflow commands | `skills/opendevbrowser-data-extraction`, `skills/opendevbrowser-form-testing`, `docs/CLI.md` |
| `provider-direct-runs.mjs` | Validation harness, not an end-user workflow family | `scripts/provider-direct-runs.mjs` |
| `provider-live-matrix.mjs` | Historical/debug matrix aggregator, not the primary truth surface | `scripts/provider-live-matrix.mjs` |
| `live-regression-direct.mjs` | Aggregate release-gate runner for multiple features, not one workflow family | `scripts/live-regression-direct.mjs` |
| `skill-runtime-audit.mjs` | Audit aggregator across packs and lanes | `scripts/skill-runtime-audit.mjs` |
| `docs-drift-check.mjs`, `cli-smoke-test.mjs`, pack validators | Governance and smoke checks, not user workflows | `scripts/docs-drift-check.mjs`, `scripts/cli-smoke-test.mjs`, `skills/**/scripts/validate-skill-assets.sh` |

## Status ledger

| Workflow family | Current status | Owner seam | Evidence / notes |
| --- | --- | --- | --- |
| Research workflow | `honest_fail_shell_only` | `src/providers/workflows.ts` | `/tmp/odb-research-pass2.out` now exits with `success:false` and `exitCode:2` instead of returning an empty false green. |
| Shopping workflow | `offers_returned_with_walmart_manual_followup` | `src/providers/shopping-postprocess.ts`, `src/providers/workflows.ts`, `src/providers/runtime-factory.ts` | `/tmp/odb-shopping-pass4/shopping/8700108c-04db-44c9-af37-0fcb5ec9a84d` now returns 8 real offers from Best Buy and eBay, while Walmart preserves an honest anti-bot challenge with reused cookies and `primary_constraint.reasonCode="challenge_detected"`. Amazon is no longer blocked by the earlier capture timeout, but it still lands as an honest `env_limited` no-offer branch for this task. |
| Product-video asset workflow | `honest_manual_boundary_followup_required` | `src/providers/workflows.ts`, `src/providers/product-video-compiler.ts`, `src/providers/shopping-postprocess.ts` | The direct Amazon URL rerun now exits honestly with `Amazon requires manual browser follow-up; this run did not determine a reliable PDP price.` instead of producing a zero-price false success. The Walmart name-plus-hint rerun now exits honestly with `Walmart hit an anti-bot challenge that requires manual completion.`; the older noisy-success Walmart artifact is no longer current truth. |
| Macro provider execution workflow | `community_social_fetch_pass_web_search_fixed_honest_upstream_shell_boundary` | `src/macros/execute.ts`, `src/providers/index.ts`, `src/providers/social/search-quality.ts`, `scripts/provider-direct-runs.mjs` | `community.search` remains passed. Social follow-up is truthful: `/tmp/odb-x-live-20260401c.json` and `/tmp/odb-reddit-live-20260401d.json` stay on first-party destinations and return usable results, while `/tmp/odb-bluesky-live-20260401j.json` now fails honestly as `env_limited` when the active session is not reusable. `web.fetch` is green against `https://developer.chrome.com/docs/extensions/reference/api/debugger`. The internal `web.search` DuckDuckGo rank leak was closed in `src/providers/index.ts` and revalidated by `tests/providers-runtime.test.ts`, `tests/macros.test.ts`, and `tests/provider-direct-runs.test.ts`; a direct CLI rerun on 2026-04-01 returned only real Chrome docs ranked `1..4` for the popup-attach query. A later saved rerun at `/tmp/odb-macro-web-search-ddg-pass1.json` failed honestly with `challenge_shell` after DuckDuckGo responded `202` with only self/static links, so the remaining variability is now classified as an upstream shell boundary rather than a live repo-code bug. |
| Single-shot script workflow | `pass_clean_stdout` | `src/cli/commands/run.ts`, `src/browser/browser-manager.ts` | `/tmp/odb-run-pass2.out` is a single valid JSON object with no malformed stdout. |
| Annotation workflow | `expected_timeout` | `scripts/annotate-live-probe.mjs` | Direct and relay probes both reached their expected manual-timeout boundary and are not currently blocking the rollout. |
| Canvas live-edit workflow | `pass_all_surfaces` | `extension/src/ops/ops-runtime.ts`, `extension/dist/ops/ops-runtime.js`, `scripts/canvas-live-workflow.mjs`, `scripts/live-regression-direct.mjs` | Managed headless and headed remained passed. After the user reloaded the unpacked Chrome extension, the focused repro at `/tmp/odb-root-synthetic-preview-repro.json` passed, followed by `/tmp/odb-canvas-extension-pass7.json` and `/tmp/odb-canvas-cdp-pass5.json`. The earlier `restricted_url` result was stale-runtime drift in the active Chrome extension, not a surviving repo-code defect. |
| Login fixture probe | `pass` | `scripts/login-fixture-live-probe.mjs` | `/tmp/odb-login-fixture-pass1.json` passed all scenario steps. This remains probe-backed evidence, not a separate top-level workflow family. |

## Baseline artifacts

- `run.script`
  - `/tmp/odb-run-pass1.json`
  - `/tmp/odb-run-pass1.out`
- `research.run`
  - `/tmp/odb-research-pass1`
- `shopping.run`
  - `/tmp/odb-shopping-pass1`
- `product_video.direct`
  - `/tmp/odb-product-video-pass1-direct/product-assets/74a73853-d0f6-4173-8971-fced25ed599c`
- `annotate.direct`
  - `/tmp/odb-annotate-direct-pass1.json`
- `annotate.relay`
  - `/tmp/odb-annotate-relay-pass1.json`
- `canvas.managed_headless`
  - `/tmp/odb-canvas-managed-headless-pass1.json`
- `canvas.managed_headed`
  - `/tmp/odb-canvas-managed-headed-pass1.json`
- `canvas.extension`
  - `/tmp/odb-canvas-extension-pass1.json`
- `login.fixture`
  - `/tmp/odb-login-fixture-pass1.json`

## April 1 follow-up artifacts

- `run.script`
  - `/tmp/odb-run-pass2.out`
- `research.run`
  - `/tmp/odb-research-pass2.out`
- `shopping.run`
  - `/tmp/odb-shopping-pass2.out`
- `shopping.run`
  - `/tmp/odb-shopping-pass3`
- `shopping.run`
  - `/tmp/odb-shopping-pass4/shopping/8700108c-04db-44c9-af37-0fcb5ec9a84d`
- `macro.media_search`
  - `/tmp/odb-x-live-20260401c.json`
  - `/tmp/odb-reddit-live-20260401d.json`
  - `/tmp/odb-bluesky-live-20260401j.json`
  - `/tmp/odb-bluesky-extension-proof-20260401a`
- `macro.web_search`
  - direct CLI rerun for `site:developer.chrome.com devtools protocol popup attach`
  - `/tmp/odb-macro-web-search-ddg-pass1.json`
- `macro.web_fetch`
  - direct CLI rerun for `https://developer.chrome.com/docs/extensions/reference/api/debugger`
- `canvas.extension.direct_repro`
  - `/tmp/odb-root-synthetic-preview-repro.json`
- `canvas.extension`
  - `/tmp/odb-canvas-extension-pass7.json`
- `canvas.cdp`
  - `/tmp/odb-canvas-cdp-pass5.json`
- `product_video.direct`
  - `/tmp/odb-product-video-pass2-direct/product-assets/4e12a82f-cc5a-44ff-a966-c16f3423312c`
- `product_video.name`
  - `/tmp/odb-product-video-pass2-name-walmart/product-assets/a4c06d38-2873-42db-9e92-0ddd5378eabd`
- `product_video.direct`
  - direct CLI rerun for `https://www.amazon.com/dp/B0CHWRXH8B` exited with the manual-follow-up error and produced no asset pack
- `product_video.name`
  - direct CLI rerun for `Apple AirPods Pro 2nd Generation` with `shopping/walmart` hint exited with the manual challenge error and produced no asset pack

## Current fix order

1. continue the broader workflow matrix from the now-honest shopping and product-video boundaries
2. decide whether Walmart anti-bot recovery needs any further seam-local auth/session work or remains a documented manual boundary
3. refresh the broader workflow matrix and closure gates, keeping `macro.web_search` classified as an honest upstream shell boundary unless new internal evidence contradicts that conclusion
