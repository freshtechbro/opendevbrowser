# Investigation: Search Engine Research Model

## Summary
Do not replace the default `research run` workflow with browser-only top-5-search-engine research. The approach improves discovery breadth, but without API-backed research it still inherits search-engine policy, anti-bot, robots, login, challenge, consent, region, and rate-limit constraints. If built, it should be an explicit experimental `web` discovery lane, not a reliable default.

## Symptoms
- API-backed research is out of scope.
- The existing generic research workflow is unreliable because live HTML/social/browser-facing providers often return `env_limited` outcomes.
- Proposed alternative: query five major search engines, collect top 10 results from each, visit pages, extract text, dedupe/rank top 5-10 responses, and synthesize a final report.

## Background / Prior Research
- Prior investigation concluded that stable generic research needs API-backed discovery/extraction/synthesis providers. With APIs out of scope, generic browser-only research must be treated as best-effort unless proven otherwise.
- Prior investigation found `auto` currently compiles to `web`, `community`, and `social`, and successful research artifacts only emit after usable evidence survives shell/stale/empty gates.
- Prior external research found modern anti-bot, challenge, robots, login, and rate-limit controls are expected constraints for automated browser research.
- StatCounter global search-engine share for April 2026 lists Google at 90.04%, Bing at 5.13%, Yahoo at 1.49%, Yandex at 1.19%, DuckDuckGo at 0.71%, and Baidu at 0.45%. This supports Google and Bing as mandatory coverage, but it does not prove browser automation permission. Source: https://gs.statcounter.com/search-engine-market-share/all-worldwide/worldwide
- Candidate engines from external investigation: Google and Bing are mandatory for relevance; Brave adds independent-index diversity; Yandex adds a distinct regional/index perspective; Kagi adds high-quality meta-search but is paid/account-bound. Yahoo and DuckDuckGo overlap heavily with Bing, Startpage overlaps with Google/Bing and is CAPTCHA-prone, Baidu is best reserved for China-specific research, and SearXNG is useful as configurable metasearch but not as a stable single default.
- Google explicitly treats automated queries to Search as machine-generated traffic, including search scrapers, and says this violates Google policies and terms. Google help also says unusual automated traffic may trigger reCAPTCHA. Sources: https://developers.google.com/search/docs/essentials/spam-policies and https://support.google.com/websearch/answer/86640
- Google Programmable Search terms restrict automated invalid queries, result caching, result modification, and non-transitory crawling/indexing/storage of results. Source: https://support.google.com/programmable-search/answer/1714300
- Microsoft Services Agreement prohibits circumventing restrictions including impermissible scraping. Source: https://www.microsoft.com/en-US/servicesagreement
- Yahoo Terms prohibit automated collection from its services without prior permission, including robots, spiders, scrapers, data mining tools, and extraction tools. Source: https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html
- DuckDuckGo documents that its results come from multiple sources, which creates overlap with upstream sources and makes it less valuable as a default if Bing is already included. Source: https://duckduckgo.com/duckduckgo-help-pages/results/sources/
- Best-practice architecture from external research: treat SERPs as discovery-only, normalize result records, dedupe canonical URLs, use Reciprocal Rank Fusion or equivalent deterministic fusion, fetch result pages separately, extract clean text, preserve provenance, and synthesize only from evidence chunks with citations. Source: https://cormack.uwaterloo.ca/cormacksigir09-rrf.pdf

## Investigator Findings

### Scope and scenario inventory

This investigation checked codebase architecture only. It did not propose source changes or a bypass path. The proposed browser-only top-5-search-engine model means: search several engines, collect result URLs, fetch destination pages, extract text, dedupe/rank, then synthesize only from destination-page evidence.

Scenarios that must be handled before any implementation is considered:

| Scenario | Required behavior |
|---|---|
| SERP loads and exposes result links | Treat links as discovery candidates only, not final evidence. |
| SERP returns a login wall, consent wall, challenge, bot page, rate limit, or JS shell | Stand down, preserve blocker metadata, classify as constrained or `env_limited`, and do not bypass. |
| Destination page fetch succeeds with usable text | Allow it into sanitization, timebox, enrichment, dedupe, and ranking. |
| Destination page is stale, login-gated, challenge-gated, JS-only, not found, or shell-like | Remove it before rendering. |
| All gathered records are SERP shells or blocked pages | Fail before artifact emission. |
| Some engines fail but destination evidence survives | Produce a report with limitations and per-engine/provider diagnostics. |
| Duplicate URLs appear across engines | Dedupe before destination fetch while preserving engine provenance. |
| Strict release gate sees `env_limited` | Fail the release gate unless the gate explicitly treats the lane as non-release or experimental. |

### Current architecture fit

- The current research compiler is source-family based, not search-engine based. `auto` and `all` both resolve to `web`, `community`, and `social`; the compiler emits one `search:<source>` step per resolved source rather than one step per engine. See `src/providers/research-compiler.ts:16`, `src/providers/research-compiler.ts:214`, and `src/providers/research-compiler.ts:303`.
- Current follow-up fetch capacity is intentionally small. `DEFAULT_RESEARCH_SEARCH_LIMIT` is 10, but `RESEARCH_WEB_SEARCH_FETCH_LIMIT` is 3 and the compiled follow-up limit is `Math.max(1, Math.min(searchLimit, 3))`; follow-up fetches are enabled only when `web` is in the resolved source set. See `src/providers/research-compiler.ts:18`, `src/providers/research-compiler.ts:327`, and `src/providers/research-compiler.ts:329`.
- The executor only converts `web:search:index` and `social:search:index` records into follow-up web fetch candidates, dedupes them, unwraps DuckDuckGo redirects, and rejects DuckDuckGo shell URLs. See `src/providers/research-executor.ts:21`, `src/providers/research-executor.ts:117`, and `src/providers/research-executor.ts:170`.
- Tests lock in the current narrow follow-up behavior: web results fetch only three URLs, social-only selection does not widen into hidden web fetches, and social-derived follow-up is allowed only when `web` is also selected. See `tests/providers-research-executor.test.ts:560`, `tests/providers-research-executor.test.ts:581`, and `tests/providers-research-executor.test.ts:618`.
- The workflow already has the correct no-evidence gate shape. It classifies shell records, sanitizes them away, filters by timebox, enriches, dedupes, ranks, then throws if all records sanitize away, all survivors are out of timebox, or final ranked records are empty. See `src/providers/workflows.ts:2666`, `src/providers/workflows.ts:2717`, `src/providers/workflows.ts:2837`, `src/providers/workflows.ts:2867`, `src/providers/workflows.ts:2883`, and `src/providers/workflows.ts:2887`.
- Search result pages are already treated as suspect evidence. `web:search:index` is a conditional sanitized path, `community:search:index` and `social:search:index` are always sanitized, and DuckDuckGo/search-result shell patterns are explicitly recognized. See `src/providers/workflows.ts:1093`, `src/providers/workflows.ts:1097`, `src/providers/workflows.ts:1105`, and `src/providers/workflows.ts:2694`.

### Provider runtime, browser fallback, and policy fit

- Provider selection is source-based: `ProviderSource` is only `web | community | social | shopping`, while `ProviderSelection` is `auto | ProviderSource | all`. There is no first-class engine selection type. See `src/providers/types.ts:7` and `src/providers/types.ts:8`.
- The runtime can host per-engine adapters because `ProviderAdapter` requires only an `id`, `source`, optional operation functions, and capabilities. `ProviderRuntime.register()` accepts arbitrary adapters, and `options.providerIds` can narrow execution to specific providers. See `src/providers/types.ts:371`, `src/providers/index.ts:1258`, and `src/providers/index.ts:1345`.
- The default runtime currently registers `web/default`, `community/default`, all social providers, and shopping providers. A top-5-engine lane should not be hidden behind `createDefaultRuntime()` unless the public contract is intentionally changed. See `src/providers/index.ts:2932`.
- `web/default` is currently DuckDuckGo-centered for keyword searches. It builds `https://duckduckgo.com/html/?q=...`, caps extracted links to 10, and records `retrievalPath` as `web:search:index` for keyword searches. See `src/providers/index.ts:2493`, `src/providers/index.ts:2507`, and `src/providers/index.ts:2513`.
- `createWebProvider()` already has a clean extension point: `WebProviderOptions.searchIndex` can return normalized web search rows, and the provider normalizes those into `web` records. See `src/providers/web/index.ts:27` and `src/providers/web/index.ts:107`.
- Browser-only transport exists, but as runtime policy and fallback plumbing, not as a research model. `ProviderRunOptions` supports `runtimePolicy`, `preferredFallbackModes`, and `forceBrowserTransport`; workflow browser mode can force browser transport for `extension` or `managed`. See `src/providers/types.ts:393`, `src/providers/runtime-policy.ts:16`, and `src/providers/runtime-policy.ts:30`.
- Forced browser transport still respects the fallback port and errors if no browser transport exists or if fallback does not complete. See `src/providers/index.ts:1048`, `src/providers/index.ts:1054`, and `src/providers/index.ts:1076`.
- Anti-bot and blocker controls are compatible with this model and must remain active. Defaults enable cooldowns and one challenge retry while browser escalation is disabled by default; cooldown reasons include IP block, token/auth, challenge, and rate limit. See `src/providers/shared/anti-bot-policy.ts:51`, `src/providers/shared/anti-bot-policy.ts:55`, and `src/providers/shared/anti-bot-policy.ts:106`.
- Blocker detection already recognizes auth paths, CAPTCHA/challenge language, rate limits, upstream blocks, restricted targets, and environment limits, with action hints for manual challenge, headed mode, extension mode, backoff, and trace capture. See `src/providers/blocker.ts:10`, `src/providers/blocker.ts:23`, `src/providers/blocker.ts:162`, and `src/providers/blocker.ts:203`.
- Constraint modeling is broad enough for session and render requirements, but the current render-required shell inventory is not engine-complete. It includes DuckDuckGo and several shopping/social shells, not Google/Bing/Yahoo/Brave/Yandex/Kagi-specific consent, bot, or region shells. See `src/providers/types.ts:39` and `src/providers/constraint.ts:35`.

### Artifact renderer, CLI/help, and live-gate fit

- The artifact contract is reusable. `renderResearch()` always returns `summary.md`, `report.md`, `records.json`, `context.json`, and `meta.json`; `createArtifactBundle()` adds `bundle-manifest.json` with TTL metadata. See `src/providers/renderer.ts:337` and `src/providers/artifacts.ts:44`.
- `ResearchRecord` already preserves `source`, `provider`, `url`, `title`, `content`, timestamp, confidence, and arbitrary `attributes`, so engine provenance can fit without a schema break if adapters set `provider = web/<engine>` and include `attributes.engine`, `attributes.rank`, and `attributes.discoveryOnly` where applicable. See `src/providers/enrichment.ts:20` and `src/providers/enrichment.ts:120`.
- The current CLI and tool surfaces expose source families only. `research run` accepts `auto|web|community|social|shopping|all` plus comma-separated source families, and `opendevbrowser_research_run` mirrors that schema. See `src/cli/commands/research.ts:13`, `src/cli/commands/research.ts:29`, `src/tools/research_run.ts:9`, and `src/tools/research_run.ts:27`.
- Public help and docs position research as source-family research, not engine research. Help describes `--source-selection` as a source-family selector and onboarding describes `research_reliable` as safest with `--source-selection auto`. See `src/cli/help.ts:211`, `src/cli/help.ts:319`, and `src/cli/onboarding-metadata.json:18`.
- `docs/CLI.md` says the current contract keeps `auto` and `all` inside `web`, `community`, and `social`, and says successful bundles include the same artifact files while shell/stale/empty output fails. See `docs/CLI.md:452`, `docs/CLI.md:457`, and `docs/CLI.md:459`.
- Handoff guidance still recommends rerunning `research run` with `--source-selection auto --sources web,community`; it has no browser-only or engine-aware guidance. See `src/providers/workflow-handoff.ts:39` and `src/providers/workflow-handoff.ts:147`.
- Live gates do not validate top-5-engine coverage. The matrix research probe runs `research run --source-selection auto --limit-per-source 4`, artifact validation only checks a successful research `report.md`, and strict gate mode fails if any `env_limited` steps remain. See `scripts/provider-live-matrix.mjs:77`, `scripts/provider-live-matrix.mjs:520`, `scripts/provider-live-matrix.mjs:550`, and `scripts/provider-live-matrix.mjs:1154`.
- Direct provider gates cover `web/default` search/fetch, community, social, and shopping providers, not named search engines. See `scripts/provider-direct-runs.mjs:53`, `scripts/provider-direct-runs.mjs:1333`, and `docs/CLI.md:1723`.

### Implementation options

#### Option A: Do not implement top-5 search-engine research now. Demote generic research.

- Keep the current provider workflow and strict gates.
- Remove or soften validated/reliable positioning for generic `research run` in help, onboarding, and skill guidance.
- Recommend explicit URL evidence capture or explicit provider scopes for power users.
- Expected impact: minimal code risk and clearest truth-in-product posture.

#### Option B: Implement as an experimental web discovery layer, not a default replacement.

- Add dedicated `web/<engine>` adapters or a focused `web/search-engines` discovery module under `src/providers/web/`.
- Keep engines under `source: "web"`; do not expand `ProviderSource` into individual engines.
- Use `createWebProvider({ searchIndex })` or small adapters to emit `web:search:index` discovery records with destination URLs.
- Add a bounded planner that dedupes SERP candidates before fetch, caps destination fetches, caps per-domain fetches, preserves engine/rank provenance, and stops early once enough usable evidence survives.
- Keep SERP snippets and SERP pages discovery-only. Final synthesis must use destination-page `web:fetch:url` evidence that survives existing sanitization and ranking.
- Add `meta.searchEngines`, `meta.engineCoverage`, `meta.engineFailures`, and optional `serp-candidates.json` only after deciding the artifact contract should widen.
- Gate it as experimental unless live runs prove engine-level coverage with no strict-gate `env_limited` failures.

#### Option C: Add a public engine selector and make it a first-class workflow.

- Add CLI/tool schema for engine IDs or a search-engine preset.
- Update compiler, executor, docs, public surface, handoff, tests, skill guidance, and live gates.
- This is the heaviest option and should only happen after Option B proves reliability.

### Risks and conflicts

- It does not solve the prior root cause. The model improves source breadth, but browser-only SERP acquisition still inherits anti-bot, robots, login, consent, challenge, and rate-limit constraints from the external research already recorded above.
- It multiplies high-friction surfaces. Five engines times 10 results can create up to 50 candidate visits before dedupe, increasing rate-limit and challenge pressure unless strict budgets are applied.
- It conflicts with the current compiler and tests if treated as a drop-in default. The current workflow has one search step per source family and a global three-URL web follow-up cap.
- It can accidentally weaken no-evidence gates if SERP records are treated as evidence. SERPs must remain discovery-only, and report evidence must come from fetched destination pages.
- It needs engine-specific blocker and shell classification. Current shell inventory is DuckDuckGo/social/shopping-heavy and would likely misclassify or underclassify Google/Bing/Yahoo/Brave/Yandex/Kagi consent, region, and challenge pages.
- It needs public-surface truth updates before promotion. CLI/help/onboarding/docs currently call generic source-family research the reliable path, and release gates do not prove named-engine coverage.
- It must not add feature flags or phased hidden behavior. If built, it should be an explicit public or experimental lane with direct tests and documented constraints, not a hidden fallback.

### Final recommendation

Do not replace the existing provider-based `research run` workflow with browser-only top-5-search-engine research as the default.

Recommended path: demote generic research from validated/reliable positioning now, preserve strict no-evidence gates, and only consider a browser-only multi-engine model as an explicit experimental `web` discovery lane. The lane should reuse existing provider adapters, runtime policy, browser fallback, blocker taxonomy, enrichment, dedupe/rank, renderer, and artifact bundle contracts. It should not count SERPs as evidence. It should not bypass search-engine policies, anti-bot controls, login walls, challenges, robots restrictions, or rate limits.

If the team wants to proceed later, start with Option B because it keeps source-family semantics intact, limits public API churn, and gives the release gates a concrete target: per-engine discovery diagnostics plus destination-page evidence that survives current shell, stale, and empty-output gates.

## Investigation Log

### Phase 1 - Initial Triage
**Hypothesis:** Querying multiple major search engines may improve coverage and reduce single-provider bias, but automated SERP collection can still be blocked or disallowed.
**Findings:** Confirmed. Multi-engine discovery improves coverage and index diversity, but does not remove the browser/SERP acquisition reliability problem.
**Evidence:** External policy sources show automated SERP collection is restricted or CAPTCHA-prone across major engines. Code investigation shows current research planning is source-family based and lacks engine-level selection, diagnostics, and bounded fetch planning.
**Conclusion:** The approach is useful only as a constrained experimental discovery layer.

## Root Cause
- The research workflow problem is provider acquisition reliability, not rendering or artifact routing.
- Current `research run` depends on live browser-facing search/social surfaces. A browser-only top-search-engine model improves discovery breadth, but still inherits search-engine policy, anti-bot, robots, login, challenge, consent, region, and rate-limit limits.
- API-backed research is out of scope, so the system cannot promise stable generic research from automated SERP collection.
- Current compiler and executor are source-family based, not engine based. They lack engine selection, per-engine diagnostics, and the larger bounded fetch planner needed for 5 engines times 10 results.
- Strict no-evidence gates are correct. SERP records, snippets, shells, stale pages, and blocked pages must not become successful research evidence.

## Recommendations
1. Do not replace the `research run` default with top-5 browser search-engine research.
2. Demote generic `research run` from validated or reliable positioning in onboarding, docs, help, skill guidance, and handoff text.
3. If implemented, build multi-engine search only as an explicit experimental `web` discovery lane.
4. Keep SERPs discovery-only. Final reports must synthesize only destination-page evidence that survives fetch, extraction, sanitization, timebox, dedupe, and ranking.
5. Add a configurable search-engine registry under `web`, with legal/policy review per engine. Do not hardcode five engines into default behavior.
6. Add a bounded planner:
   - collect up to 10 SERP candidates per allowed engine
   - dedupe canonical URLs before fetch
   - cap total destination fetches
   - cap per-domain fetches
   - preserve engine, rank, query, and retrieval provenance
   - stop early once enough usable evidence survives
7. Reuse existing provider runtime, browser fallback, blocker taxonomy, enrichment, ranking, renderer, and artifact bundle contracts.
8. Stand down on robots restrictions, login walls, challenges, consent gates, rate limits, and anti-bot blocks. Record `env_limited` or the narrower reason code. Do not bypass.
9. Add optional diagnostics artifacts only if the contract is intentionally widened, for example `serp-candidates.json`, `fetch-plan.json`, and `constraints.json`.

## Preventive Measures
- Add tests proving SERP records never count as final evidence.
- Add tests for all no-evidence paths: shell-only, stale-only, blocked-only, empty, login, challenge, rate-limited, robots-blocked, and JS-required.
- Add tests for bounded planning: engine cap, candidate cap, dedupe before fetch, per-domain cap, and provenance preservation.
- Add engine-specific blocker and shell classifiers before enabling any engine lane.
- Add live validation for the experimental lane separately from strict release gates.
- Keep strict release gates failing promoted lanes with `env_limited`; only non-release experimental probes may classify expected constraints without blocking release.
- Update public docs before promotion so users understand that browser research is best-effort and policy-bound.
- Preserve mandatory successful artifact checks: `artifact_path`, `report.md`, `records.json`, `meta.json`, and `bundle-manifest.json`.
