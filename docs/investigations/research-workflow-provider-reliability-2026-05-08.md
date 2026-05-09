# Investigation: Research Workflow Provider Reliability

## Summary
The research workflow should be removed or reduced to a clearly scoped browser-evidence diagnostic workflow. The current failures are mostly strict no-evidence gates plus brittle provider acquisition: `auto` depends on live HTML/social/search scraping paths that often classify as `env_limited`. The only stable generic-research path identified was API-backed discovery/extraction/synthesis, and that is now out of scope.

## Symptoms
- `research run` often fails instead of producing a successful report.
- Many live providers return env-gated classifications such as shell/login/not-found/anti-bot/render-required outcomes.
- The user wants a recommendation on whether to fix the research workflow or remove it entirely.

## Background / Prior Research
- Prior artifact work fixed missing `report.md` and ensured shell-only, stale-only, or no-source-evidence research runs fail before artifact emission.
- Prior decisions treat provider/env-limited failures as distinct from artifact-routing failures.
- Google Custom Search JSON API is an official programmatic search path with JSON results, API-key auth, monitoring, and documented quota/pricing, but the current official docs mark it legacy-only and not a good new default. This is still evidence that direct SERP scraping should not be the primary stable path for Google-style search. Source: https://developers.google.com/custom-search/v1/overview
- Tavily Search is positioned as an LLM-oriented search API that returns ranked sources, snippets/content, domain filters, recency filters, and optional answers. Source: https://docs.tavily.com/api-reference/endpoint/search
- Exa provides search plus content extraction and a `/research` capability for structured JSON results with citations. Source: https://docs.exa.ai/
- Brave Search API exposes a web search endpoint backed by Brave's independent index. Source: https://brave.com/search/api/
- Perplexity Search API provides real-time ranked results with domain/language/region filtering and content extraction controls; Sonar/Agent APIs cover grounded summaries. Source: https://docs.perplexity.ai/docs/search/quickstart
- Firecrawl Search combines SERP retrieval with optional page scraping into markdown/HTML/screenshots in one API call, with explicit cost and data-retention knobs. Source: https://docs.firecrawl.dev/features/search
- Cloudflare documents that bot systems use heuristics, JavaScript detections, ML, browser signals, request features, and bot scores to detect automation. Source: https://developers.cloudflare.com/bots/concepts/bot-detection-engines/
- Cloudflare Challenge documentation explicitly says headless browsers and automation frameworks such as Playwright/Selenium can be blocked by challenges. Source: https://developers.cloudflare.com/cloudflare-challenges/reference/supported-browsers/
- External reliability research confirms that browser/scraping providers are naturally env-gated by modern web defenses, not only by local workflow bugs. Cloudflare, Google reCAPTCHA, Turnstile, robots.txt, HTTP auth/permission status codes, and rate-limit guidance all describe mechanisms that can legitimately prevent automated evidence collection. Sources: https://developers.cloudflare.com/bots/concepts/bot-detection-engines/, https://developers.cloudflare.com/turnstile/, https://docs.cloud.google.com/recaptcha/docs/overview, https://www.rfc-editor.org/rfc/rfc9309, https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/401, https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/429
- API-backed provider candidates should be evaluated as distinct roles rather than one generic fallback: Brave or Exa for discovery, Firecrawl or Tavily for extraction, and Perplexity Sonar, Exa Answer, or Brave Answers for cited synthesis. Browser paths should remain validation, enrichment, or authenticated-session paths.

## Investigator Findings

### 2026-05-08 code reconnaissance

#### Trace: CLI to artifacts

- CLI parsing is thin and forwards `research run` to the daemon as `research.run`. `src/cli/commands/research.ts:272-306` requires `run`, validates `--topic`, defaults `mode` to `compact`, and calls `callDaemon("research.run", payload)`.
- Daemon routing preserves the research payload and constructs the provider runtime bundle. `src/cli/daemon-commands.ts:48-75` resolves the bundled runtime from the existing runtime, config, browser manager, and browser fallback port. `src/cli/daemon-commands.ts:805-825` forwards `topic`, timebox fields, source selectors, browser/cookie/challenge overrides, and artifact controls to `runResearchWorkflow`.
- Source selection is compiled before execution. `src/providers/research-compiler.ts:17-18` defines `auto` and `all` as `web`, `community`, and `social`. `src/providers/research-compiler.ts:214-235` gives explicit `sources` precedence over `sourceSelection`, defaults missing selection to `auto`, and resolves a concrete source array. `src/providers/research-compiler.ts:291-321` creates one search step per resolved source.
- Execution runs compiled search steps, then only does web follow-up fetches when web is part of the resolved source set. `src/providers/research-executor.ts:206-332` executes search steps, derives web fetch candidates, and returns search/follow-up runs plus checkpoint and trace. `tests/providers-research-executor.test.ts:580-649` verifies non-web selections do not widen into hidden web fetches.
- Artifact emission happens only after usable evidence survives. `src/providers/workflows.ts:2842-2868` merges search and follow-up records, removes degraded auto-excluded providers, sanitizes shell records, applies the timebox, enriches, dedupes, and ranks. `src/providers/workflows.ts:2878-2891` throws on all-shell, out-of-timebox-only, or empty ranked results. `src/providers/workflows.ts:2933-2965` renders research files and writes the artifact bundle only after those gates pass.

#### Hypothesis verification

1. **Confirmed:** frequent post-fix failures are expected strict zero-evidence gates, not an artifact routing regression. The hard gates at `src/providers/workflows.ts:2878-2891` run before `renderResearch` and `createArtifactBundle` at `src/providers/workflows.ts:2933-2943`. Tests assert no artifacts are created for shell-only or zero-evidence failures: `tests/providers-workflows-branches.test.ts:4254-4305`. Successful runs still emit `artifact_path` and `report.md`: `tests/providers-artifacts-workflows.test.ts:263-289`, `tests/providers-artifacts-workflows.test.ts:333-342`, and live-matrix validation requires a successful research run to include a real `report.md` at `scripts/provider-live-matrix.mjs:510-550`.
2. **Confirmed:** default `auto` depends on brittle HTML/social/browser-facing providers. `auto` compiles to `web`, `community`, and `social` only, not shopping: `src/providers/research-compiler.ts:17-18`. The default web search path uses DuckDuckGo HTML at `src/providers/index.ts:2471-2538`. The default community search path uses Reddit web search at `src/providers/index.ts:2557-2622`. Social search paths are first-party social web routes with optional browser recovery, not official social APIs: `src/providers/index.ts:2650-2889` and `src/providers/social/platform.ts:332-574`.
3. **Confirmed, with a current gap:** the stable path should be API-backed search/content providers first, then browser fallback for enrichment and hard targets. Current config has cookies, challenge orchestration, transcript controls, and Apify for YouTube transcripts, but no general API-backed web search/content credential surface. Provider config surfaces are in `src/config.ts:191-220` and `src/config.ts:360-462`; YouTube Apify token resolution is env-only at `src/providers/social/youtube-resolver.ts:1087-1090`; default runtime registration remains `web/default`, `community/default`, social providers, and storefront shopping providers at `src/providers/index.ts:2932-2945`. No Tavily, Exa, Brave, Google CSE, Perplexity, Firecrawl, Reddit API, X API, or commerce API adapters were found in provider/config searches.
4. **Confirmed:** removal is only justified if API-backed provider strategy is out of scope. The workflow compiler, executor, evidence gates, renderer, and artifact contract are coherent and tested. The weak link is acquisition reliability, not the workflow abstraction. Removing research would discard tested artifact and evidence semantics while leaving the provider-reliability problem unsolved for adjacent workflows.

#### env_limited taxonomy and usable evidence

- Canonical provider reason codes include `env_limited`, `token_required`, `challenge_detected`, `rate_limited`, `caption_missing`, `transcript_unavailable`, `policy_blocked`, and related codes at `src/providers/types.ts:23-36` and `src/providers/errors.ts:18-31`. Reason normalization maps auth/status/message patterns to these reason codes at `src/providers/errors.ts:51-70`.
- Render-required shells are classified as `env_limited` with `constraint.kind: "render_required"`. See provider shell mappings and classification in `src/providers/constraint.ts:46-57` and `src/providers/constraint.ts:109-121`.
- Research has an additional sanitizer for non-evidence records. `src/providers/workflows.ts:2600-2728` classifies `login_shell`, `js_required_shell`, `not_found_shell`, `search_index_shell`, and `search_results_shell`. If every record is sanitized, the workflow throws before artifacts at `src/providers/workflows.ts:2878-2882`.
- Live matrix classification treats zero records plus approved env-limited reason codes as `env_limited`, while strict release gates fail any env-limited outcome. `scripts/shared/workflow-lane-constants.mjs:25-41` defines the env-limited code set, `scripts/shared/workflow-lane-verdicts.mjs:58-124` classifies lane records, and `scripts/provider-live-matrix.mjs:1154-1162` makes strict gates require zero fail and zero env-limited steps.
- Usable research evidence is therefore any record that survives shell sanitization, timebox filtering, enrichment, dedupe, and ranking. Provider limitations may still appear in metadata when at least one usable record survives, as covered by `tests/providers-artifacts-workflows.test.ts:430-539`.

#### Eliminated hypotheses

- **Artifact routing regression eliminated.** Successful workflow artifact validation covers `artifact_path`, namespace, `bundle-manifest.json`, and `report.md` in `tests/provider-live-matrix-script.test.ts:486-565`; successful workflow tests verify the same files in `tests/providers-artifacts-workflows.test.ts:263-342`.
- **Silent empty-report success eliminated.** Full workflow code throws before rendering when no usable evidence survives. Renderer-level support for empty reports exists for primitive rendering tests, but the full research workflow blocks successful empty reports at `src/providers/workflows.ts:2878-2891`.
- **Shopping contamination as default eliminated.** `auto` and `all` both resolve to `web`, `community`, and `social`; shopping only enters through `--source-selection shopping` or explicit `--sources` containing `shopping`. See `src/providers/research-compiler.ts:17-18` and `src/providers/research-compiler.ts:214-235`.
- **Browser as a hidden source eliminated.** `ProviderSource` is only `web | community | social | shopping` in `src/providers/types.ts:5-6`. Browser fallback is recovery/enrichment infrastructure, not a source family.

#### Recommendations

1. Remove the generic `research run` workflow from the public product surface if API-backed providers remain out of scope.
2. Preserve the renderer/artifact lessons for other workflows: successful evidence bundles should still include `report.md`, `records.json`, `meta.json`, and `bundle-manifest.json`.
3. If any research-like capability remains, rename and scope it as browser evidence collection or source validation, not generic research. It should accept explicit URLs/sources and report browser evidence, screenshots, shell classifications, and constraints.
4. Keep strict no-evidence gates. Do not make an empty or shell-only bundle look successful.
5. Update CLI/help/docs/tests/live-matrix so no surface claims stable generic research through `auto`.

## Investigation Log

### Phase 1 - Initial Triage
**Hypothesis:** The workflow failure may be correct behavior from strict evidence gates, while provider acquisition is unreliable because live providers are anti-bot/env-gated.
**Findings:** External research and RepoPrompt code investigation both support the provider-acquisition hypothesis.
**Evidence:** API provider docs expose stable quota/auth/rate-limit contracts; anti-bot docs explain why live scraping can legitimately fail; code evidence shows `auto` currently depends on web/community/social HTML or browser-facing providers.
**Conclusion:** Root cause is acquisition strategy, not research artifact routing.

## Root Cause
- The research workflow is structurally sound and intentionally strict: it fails before artifact emission when only shell records, stale records, or zero usable ranked records remain.
- The default source selection is brittle for reliable research because `auto` resolves to `web`, `community`, and `social`, and those providers currently depend on live HTML, Reddit web search, first-party social search routes, or browser fallback instead of stable API-backed search/content contracts.
- `env_limited` is currently doing useful work as a broad environmental/provider-acquisition classification, but it is too coarse for product decisions. Missing credentials, quota/rate limits, challenges, login gates, render-required shells, no results, and stale/no-evidence outcomes need clearer user-facing diagnosis.
- A local reproduction attempt on this checkout did not reach providers because the daemon on `127.0.0.1:8788` was protected by a different OpenDevBrowser build. That is a daemon/build alignment issue and should not be conflated with provider `env_limited` failures.

## Recommendations
1. Remove `research run` as a generic research workflow if API-backed providers remain out of scope. The remaining live HTML/social/browser path cannot reliably satisfy the product promise.
2. Do not weaken the strict no-evidence gates to keep the workflow alive. A shell-only or empty report would be misleading and worse than removal.
3. Replace the public promise with narrower workflows that match what OpenDevBrowser can reliably own without research APIs: explicit URL evidence capture, browser validation, challenge diagnosis, authenticated-session inspection, and report generation from provided sources.
4. Preserve the useful artifact contract in those narrower workflows: successful evidence bundles should contain `report.md`, `records.json`, `meta.json`, and `bundle-manifest.json`.
5. Update CLI/help/docs/tests/live-matrix so the product no longer recommends `research run --source-selection auto` as stable generic research.
6. Keep daemon/build mismatch classification separate from provider env limits so future removals or replacements are not misdiagnosed.

Removal criteria:
- Met. API-backed external research is out of scope, and stable generic credential-free research from live browser/scrape providers is not a realistic product promise.
- Recommended product decision: remove the generic research workflow or rename/rebuild it as explicit browser evidence collection from user-provided URLs/sources.

## Preventive Measures
- Add tests for each new provider failure bucket: missing key, invalid key, quota exceeded, rate limited, provider error, no results, extraction failed, challenge/login gate, shell-only, stale-only, and daemon/build mismatch.
- Add a live validation lane for the replacement browser-evidence workflow, with non-strict env-limited classification and strict release gates for artifact integrity.
- Keep successful artifact assertions mandatory: `artifact_path`, `bundle-manifest.json`, `report.md`, `records.json`, and metadata diagnostics.
- Remove or rewrite documentation that claims `research run --source-selection auto` can provide stable generic research.
- Track explicit source URLs, capture method, browser mode, constraints, screenshots, and citation provenance in replacement workflow metadata.
