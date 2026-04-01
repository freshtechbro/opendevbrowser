# Workflow Surface Map

Status: active  
Last updated: 2026-04-01

Execution-oriented inventory of the current runnable workflow families in `opendevbrowser`.

## Inclusion rules

- Include first-class user-goal workflow families shipped through the public CLI.
- Keep probe-backed validation variants separate from the primary family inventory.
- Exclude audit aggregators and helper runners that only summarize or fan out into other workflows.
- Keep write-path social posting out of the automatic execution matrix unless an explicit test account and approval exist.

## Included workflow families

| ID | Workflow family | Primary CLI entry | Execution route | Round 1 real-life task | Round 2 real-life task | Primary owners |
| --- | --- | --- | --- | --- | --- | --- |
| `workflow.run` | Generic automation script runner | `run --script` | direct CLI | Validate a small extraction script against the MDN `Document.querySelector()` docs page | Validate a second script against the Vitest getting-started guide | `src/cli/commands/run.ts`, `src/core/script-runner.ts`, `src/browser/browser-manager.ts` |
| `workflow.research` | Research workflow | `research run` | direct CLI | Research browser automation production blockers from the last 14 days | Research a second topic with explicit source selection and date range | `src/cli/commands/research.ts`, `src/cli/daemon-commands.ts`, `src/providers/workflows.ts` |
| `workflow.shopping` | Shopping workflow | `shopping run` | direct CLI | Find the best USB microphone under a live budget constraint in the US market | Compare a second product class with explicit provider selection and ranking pressure | `src/cli/commands/shopping.ts`, `src/cli/daemon-commands.ts`, `src/providers/shopping/index.ts`, `src/providers/shopping-postprocess.ts`, `src/providers/workflows.ts` |
| `workflow.product_video` | Product presentation asset workflow | `product-video run` | direct CLI | Build a product asset pack from a live product URL | Build a product asset pack from product-name resolution with a provider hint | `src/cli/commands/product-video.ts`, `src/cli/daemon-commands.ts`, `src/providers/workflows.ts` |
| `workflow.macro.web_search` | Macro provider execution: web search | `macro-resolve --execute` | direct CLI | Find current Playwright locator guidance on MDN | Run a second web search query with a different intent | `src/cli/commands/macro-resolve.ts`, `src/cli/daemon-commands.ts`, `src/macros/execute.ts`, `src/providers/index.ts` |
| `workflow.macro.web_fetch` | Macro provider execution: web fetch | `macro-resolve --execute` | direct CLI | Fetch and summarize a public docs page | Fetch a different public page to prove page-fetch stability across targets | `src/cli/commands/macro-resolve.ts`, `src/cli/daemon-commands.ts`, `src/macros/execute.ts`, `src/providers/index.ts` |
| `workflow.macro.community_search` | Macro provider execution: community search | `macro-resolve --execute` | direct CLI | Find community threads about browser automation failures | Resolve a second community discovery task via URL or topic form | `src/cli/commands/macro-resolve.ts`, `src/cli/daemon-commands.ts`, `src/macros/execute.ts`, `src/providers/index.ts` |
| `workflow.macro.media_search` | Macro provider execution: media/social search | `macro-resolve --execute` | direct CLI | Find media or social discussion about browser automation on a first-party platform | Repeat on a second platform/topic pair | `src/cli/commands/macro-resolve.ts`, `src/cli/daemon-commands.ts`, `src/macros/execute.ts`, `src/providers/index.ts`, `src/providers/social/search-quality.ts` |
| `workflow.annotate` | Annotation workflow | `annotate` | direct CLI, usually validated through shipped probes | Request an annotation session on a live page | Repeat through the alternate transport after the first pass is stable | `src/cli/commands/annotate.ts`, `src/tools/annotate.ts`, `src/browser/annotation-manager.ts` |
| `workflow.canvas` | Design-canvas workflow | `canvas` | direct CLI, usually validated through shipped probes | Execute the hero-edit workflow in one supported surface | Repeat in a second surface with different transport constraints | `src/cli/commands/canvas.ts`, `src/browser/canvas-manager.ts`, `src/canvas/**`, `extension/src/canvas/**` |

## Probe-backed validation variants

These are real validation surfaces, but they sit under the first-class families above rather than creating new public workflow families.

| Variant | Backing family | Validation route | Notes |
| --- | --- | --- | --- |
| `annotate.direct` | `workflow.annotate` | `node scripts/annotate-live-probe.mjs --transport direct` | Direct transport boundary check for the public `annotate` command |
| `annotate.relay` | `workflow.annotate` | `node scripts/annotate-live-probe.mjs --transport relay` | Relay transport boundary check for the public `annotate` command |
| `canvas.managed_headless` | `workflow.canvas` | `node scripts/canvas-live-workflow.mjs --surface managed-headless` | Managed headless surface proof for the public `canvas` command |
| `canvas.managed_headed` | `workflow.canvas` | `node scripts/canvas-live-workflow.mjs --surface managed-headed` | Managed headed surface proof for the public `canvas` command |
| `canvas.extension` | `workflow.canvas` | `node scripts/canvas-live-workflow.mjs --surface extension` | Extension relay proof for the public `canvas` command |
| `canvas.cdp` | `workflow.canvas` | `node scripts/canvas-live-workflow.mjs --surface cdp` | Legacy `/cdp` route proof for the public `canvas` command |
| `login.fixture` | `workflow.run` | `node scripts/login-fixture-live-probe.mjs` | Repo-local composite workflow built from the public primitive CLI commands |

## Explicitly excluded from the user workflow matrix

| Surface | Why excluded from direct workflow inventory |
| --- | --- |
| `scripts/provider-direct-runs.mjs` | Validation harness that executes macro and shopping probes; not a user-facing workflow family on its own |
| `scripts/live-regression-direct.mjs` | Aggregates other scripted workflow probes; not a standalone user workflow |
| `scripts/skill-runtime-audit.mjs` | Audit aggregator and verdict reducer, not a user-launched workflow |
| Data-extraction and form-testing skill recipes | Built from primitive CLI commands or `run --script`, not shipped as distinct top-level workflow families |
| `scripts/product-video-fixture-live-probe.mjs` | Deterministic diagnosis harness for `product-video`, not a distinct user workflow family |
| Social posting macros | Live write-path side effects require explicit approval and a dedicated test account |

## Execution policy

- Use direct CLI commands for the first-class wrappers and macro workflows.
- Use shipped probes where they encode a transport or surface variant of a first-class workflow.
- Treat `env_limited` or explicit manual-boundary outcomes as acceptable only when the owning workflow now reports them honestly instead of returning a false green.
- Current April 1 follow-up truth:
  - X and Reddit social search stay on first-party destinations and return usable results, though ranking is still noisy.
  - Bluesky no longer false-greens; it now fails honestly as `env_limited` when the active session is logged out or otherwise not reusable.
  - Canvas now passes in `managed-headless`, `managed-headed`, `extension`, and `/cdp`; the earlier extension `restricted_url` failure was stale-runtime drift that cleared after the unpacked Chrome extension reload.
- After any code fix, rerun the smallest owning workflow first, then rerun the broader matrix.
