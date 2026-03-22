# Skill Runtime Surface Matrix

Canonical inventory of repo-local OpenDevBrowser skill packs and the runtime surfaces they must prove with real workflow execution.

## Canonical skill packs

| Pack | Type | Validator | Runtime surfaces | Real workflow proof lane | External boundary |
|---|---|---|---|---|---|
| `opendevbrowser-best-practices` | `governance` | `./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh` | surface docs, workflow router, release evidence policy, CLI or tool or `/ops` or `/canvas` inventory | `node scripts/docs-drift-check.mjs`, `./skills/opendevbrowser-best-practices/scripts/run-robustness-audit.sh`, `node scripts/cli-smoke-test.mjs`, `node scripts/provider-direct-runs.mjs`, `node scripts/live-regression-direct.mjs`, `node scripts/canvas-competitive-validation.mjs` | extension unavailable at start, auth walls, anti-bot pressure, rate limits, upstream outage |
| `opendevbrowser-continuity-ledger` | `doc_only` | none required | continuity ownership, ledger template, reply protocol | discovery/load parity only; no live browser probe | not applicable |
| `opendevbrowser-data-extraction` | `workflow` | `./skills/opendevbrowser-data-extraction/scripts/validate-skill-assets.sh` | snapshot, DOM text/html extraction, pagination, quality gates, structured extraction | `node scripts/cli-smoke-test.mjs` plus `node scripts/product-video-fixture-live-probe.mjs` for structured extraction on a repo-local product page | extension unavailable at start if extension mode is audited separately |
| `opendevbrowser-design-agent` | `browser_surface` | `./skills/opendevbrowser-design-agent/scripts/validate-skill-assets.sh` | `/canvas`, annotate send/stored semantics, design contract workflow, real-surface validation | `node scripts/live-regression-direct.mjs`, `node scripts/canvas-competitive-validation.mjs` | extension unavailable at start, optional Figma live smoke |
| `opendevbrowser-form-testing` | `workflow` | `./skills/opendevbrowser-form-testing/scripts/validate-skill-assets.sh` | snapshot -> type/click -> validation loop, multi-step forms, challenge checkpoints, network correlation | `node scripts/cli-smoke-test.mjs` plus `node scripts/login-fixture-live-probe.mjs` for invalid-submit, MFA, and persistence branches | extension unavailable at start if extension mode is audited separately |
| `opendevbrowser-login-automation` | `workflow` | `./skills/opendevbrowser-login-automation/scripts/validate-skill-assets.sh` | login branching, invalid credential handling, MFA step-up, session validation | `node scripts/login-fixture-live-probe.mjs` | none; proof lane is repo-local |
| `opendevbrowser-product-presentation-asset` | `workflow` | `./skills/opendevbrowser-product-presentation-asset/scripts/validate-skill-assets.sh` | `product-video run`, asset-pack assembly, screenshots, evidence mapping | `node scripts/product-video-fixture-live-probe.mjs` | none; proof lane is repo-local |
| `opendevbrowser-research` | `workflow` | `./skills/opendevbrowser-research/scripts/validate-skill-assets.sh` | `research run`, timebox resolution, multi-source artifact generation | `opendevbrowser research run --topic "<topic>" --source-selection auto --mode json` via `scripts/skill-runtime-audit.mjs` | auth walls, rate limits, upstream source failure |
| `opendevbrowser-shopping` | `workflow` | `./skills/opendevbrowser-shopping/scripts/validate-skill-assets.sh` | `shopping run`, offer normalization, market analysis, direct provider workflows | `node scripts/provider-direct-runs.mjs` | auth walls, anti-bot challenges, rate limits, upstream outage |

## Shared runtime families

| Runtime family | Representative CLI surface | Representative tool surface | Real task | Proof lane |
|---|---|---|---|---|
| Session lifecycle and daemon control | `serve`, `status`, `launch`, `disconnect` | `opendevbrowser_launch`, `opendevbrowser_status`, `opendevbrowser_disconnect` | start a session, inspect state, then close it cleanly | `node scripts/cli-smoke-test.mjs`, `node scripts/live-regression-direct.mjs` |
| Navigation and interaction | `goto`, `wait`, `click`, `hover`, `press`, `type`, `select`, `scroll`, `scroll-into-view` | matching `opendevbrowser_*` interaction tools | move through an interactive page and complete an action loop | `node scripts/cli-smoke-test.mjs`, `node scripts/login-fixture-live-probe.mjs` |
| Pointer controls | `pointer-move`, `pointer-down`, `pointer-up`, `pointer-drag` | `opendevbrowser_pointer_move`, `opendevbrowser_pointer_down`, `opendevbrowser_pointer_up`, `opendevbrowser_pointer_drag` | low-level pointer movement for challenge-aware or canvas-aligned surfaces | `node scripts/login-fixture-live-probe.mjs` plus pointer-aware source inventory |
| DOM and extraction | `dom-html`, `dom-text`, `dom-attr`, `dom-value`, `dom-visible`, `dom-enabled`, `dom-checked` | matching `opendevbrowser_dom_*` tools | extract structured fields and validate state transitions | `node scripts/cli-smoke-test.mjs`, `node scripts/product-video-fixture-live-probe.mjs` |
| Targets and pages | `targets-list`, `target-use`, `target-new`, `target-close`, `page`, `pages`, `page-close` | matching `opendevbrowser_target_*` tools | switch tabs/pages during a real flow | `node scripts/cli-smoke-test.mjs` |
| Diagnostics and export | `perf`, `screenshot`, `console-poll`, `network-poll`, `clone-page`, `clone-component`, `debug-trace-snapshot` | matching diagnostics/export tools | capture browser evidence after a real workflow step | `node scripts/cli-smoke-test.mjs`, `node scripts/live-regression-direct.mjs` |
| Workflow wrappers | `research run`, `shopping run`, `product-video run` | `opendevbrowser_research_run`, `opendevbrowser_shopping_run`, `opendevbrowser_product_video_run` | run end-to-end research, shopping, and product asset workflows | `scripts/skill-runtime-audit.mjs`, `scripts/provider-direct-runs.mjs`, `scripts/product-video-fixture-live-probe.mjs` |
| Canvas and design relay | `canvas` CLI and `/canvas` commands | `opendevbrowser_canvas` | open a canvas session, mutate safely, render preview, and validate feedback | `node scripts/live-regression-direct.mjs`, `node scripts/canvas-competitive-validation.mjs` |
| Extension `/ops` relay | `/ops` session, target, nav, interact, pointer, DOM, overlay, preview bridge envelopes | extension-backed tool parity via daemon | attach the extension, verify `/ops` readiness, and run real command loops | `node scripts/live-regression-direct.mjs`, `node scripts/docs-drift-check.mjs` |
| Skill discovery and loading | bundled `skills/` directories and loader search paths | `opendevbrowser_skill_list`, `opendevbrowser_skill_load` | enumerate and load the canonical packs | `node scripts/skill-runtime-audit.mjs` |

## Acceptance rules

- A pack is `fail` when discovery/load parity fails, the validator fails, the required live probe is missing, or the real workflow probe reports a repo-owned defect.
- A pack is `env_limited` only when the probe exists, ran, and hit a real external blocker.
- A shared runtime family is considered covered only when at least one live proof lane exercised that family during the same audit pass.
