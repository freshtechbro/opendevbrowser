# Investigation: Free SERP API Research Options

## Summary
Free or no-cost SERP/search APIs do not change the prior recommendation from `search-engine-research-model-2026-05-09.md`: OpenDevBrowser should not promise reliable generic research through a hidden free discovery layer.

No genuinely free, unlimited, no-setup, production-grade generic SERP API was identified. The market options fall into four practical buckets:

1. Limited free quotas or trial credits that require accounts and API keys.
2. Paid production SERP APIs with small free developer allowance.
3. Self-hosted metasearch or open-corpus infrastructure that shifts cost to the operator.
4. Open vertical APIs that work well for scoped research but are not generic web SERP replacements.

Google Search API is not a free production default. The official Google Custom Search JSON API page says the API is closed to new customers, existing customers have until January 1, 2027 to transition, and existing customers get 100 free queries per day before paid usage.

Recommended direction: keep generic browser search demoted, do not add hidden shared free provider keys, and pursue an explicit configured `web` discovery lane only when the user or workspace provides provider credentials or an operator-owned self-hosted/open provider. For no-setup research, prefer scoped open vertical APIs plus destination-page evidence capture, not generic SERP promises.

## Symptoms
- API-backed research was previously treated as out of scope, but the new question asks whether free APIs change that decision.
- Browser-only multi-search-engine research improves breadth but remains policy-bound and env-limited.
- The product goal is a dynamic first layer that does not require users to interface with API setup.

## Background / Prior Research
- `search-engine-research-model-2026-05-09.md` concluded browser-only top-5 search should not become the reliable default. It can be an experimental discovery lane only, with SERPs treated as discovery-only.
- `research-workflow-provider-reliability-2026-05-08.md` concluded stable generic research requires API-backed discovery/extraction/synthesis providers, but removal or demotion is appropriate if APIs are out of scope.
- Existing research artifacts must remain honest: successful bundles need `report.md`, `records.json`, `meta.json`, and `bundle-manifest.json`, while shell-only or zero-evidence runs should fail before artifact emission.
- Current official checks used in this investigation:
  - Google Custom Search JSON API: https://developers.google.com/custom-search/v1/overview
  - Brave Search API: https://brave.com/search/api/
  - SerpApi pricing: https://serpapi.com/pricing
  - Tavily pricing: https://www.tavily.com/pricing
  - Microsoft Bing Search API retirement: https://learn.microsoft.com/en-us/lifecycle/announcements/bing-search-api-retirement
  - SearXNG Search API: https://docs.searxng.org/dev/search_api.html
  - OpenAlex authentication and pricing: https://developers.openalex.org/guides/authentication
  - Common Crawl: https://commoncrawl.org/

## Investigator Findings

### Verified conclusion
Free or free-first SERP APIs do not beat the browser-only top-5-engine model as a reliable default for OpenDevBrowser. They are useful as explicit discovery inputs, but not as a hidden production layer. The safest path is an opt-in, configured provider lane under `source: "web"`, plus scoped open vertical APIs where the topic fits. SERP rows and API snippets must remain discovery-only until destination pages survive the existing evidence gates.

### Current provider/runtime fit
- `resolveResearchSources()` keeps `auto` and `all` limited to source families: `web`, `community`, and `social`. It does not expose engine IDs or SERP API selectors.
- `createWebProvider({ searchIndex })` is the minimal extension point for API-backed discovery because it can emit normalized `web` records without changing public source-family contracts.
- `resolveResearchWebFetchCandidates()` already promotes `web:search:index` and `social:search:index` records to destination `web:fetch:url` calls, capped at 3 follow-up fetches.
- `runResearchWorkflow()` already removes shell/search/login/not-found records and throws before artifact emission when only shell, stale, or zero usable records remain. This gate should not change.
- `ProvidersConfig` centralizes crawler, anti-bot, challenge, transcript, and cookie policy, but has no general SERP/API credential surface. A future API lane must add centralized provider config rather than hardcoding keys or endpoints.

### Direct answers

| Question | Answer |
|---|---|
| Are any generic SERP APIs completely free for production use? | No. None found that are unlimited, production-grade, no-account, no-key, no-billing, and suitable as a hidden default. |
| Is Google Search API free? | No for new product use. Google Custom Search JSON API is closed to new customers. Existing customers get 100 free queries/day until discontinuation on January 1, 2027, then paid overage while available. |
| Can OpenDevBrowser dynamically load free APIs without user setup? | Not for generic SERP. Most require keys, accounts, billing, trial acceptance, or operator infrastructure. Hidden shared keys would create quota, abuse, billing, and terms risk. |
| Is API-backed discovery better than browser-only search engines? | Yes only when explicitly configured. It is easier to parse and diagnose, but it still has quotas, auth, provider terms, and snippet-only evidence risks. |
| What should be free-first? | Open vertical APIs and self-hosted/open-corpus sources for scoped topics, plus destination-page fetch and citation gates. |

### Current external API findings

| Provider/category | Current no-cost reality | Setup required | Fit for OpenDevBrowser |
|---|---|---|---|
| Google Custom Search JSON API | Not available for new customers, existing customers only until January 1, 2027. Existing usage has 100 queries/day free, then $5 per 1,000 up to 10k/day. Source: [Google docs](https://developers.google.com/custom-search/v1/overview). | Programmable Search Engine ID, API key, Google Cloud billing for paid use. | Do not implement as default. Legacy BYO-key adapter only if explicitly requested. |
| Brave Search API | Has a free plan path, but requires an API key and even the free plan requires a credit card for anti-fraud. Source: [Brave docs](https://brave.com/search/api/). | Brave account, subscription token, card identity check. | Good BYO-key `web/brave` discovery candidate, not zero-setup. |
| SerpApi | Ongoing free plan exists, currently shown as 250 searches/month, with paid tiers after that. Source: [SerpApi pricing](https://serpapi.com/pricing). | Account and API key. | Useful testing adapter, not production-free at generic research volume. |
| Serper.dev | Offers 2,500 free queries to start, then paid credit packs. Source: [Serper site](https://serper.dev/). | Account and API key. | Trial/onboarding BYO-key adapter only. |
| Zenserp | Free plan is 50 requests/month. Source: [Zenserp pricing](https://zenserp.com/pricing-plans/). | Account and API key. | Too small for default research. BYO-key only. |
| DataForSEO | Pay-as-you-go SERP API with $1 trial credit and $50 minimum payment for paid balance. Source: [DataForSEO pricing](https://dataforseo.com/apis/serp-api/pricing). | Account, API key, paid balance for production. | Paid BYO-key option, strong diagnostics needed. |
| Tavily | Pricing is credit-based with API keys and monthly credits, including no-cost student support. Source: [Tavily pricing](https://www.tavily.com/pricing). | Account and API key. | Good opt-in AI-search provider, not hidden generic evidence. |
| Exa | Search is priced at $7 per 1k requests, with grants/free credits for startup and education cases. Source: [Exa pricing](https://exa.ai/pricing?tab=api). | Account and API key. | Good opt-in neural/code/doc discovery. Not free default. |
| Perplexity Search/Sonar | Search API is priced at $5 per 1k requests; Sonar adds token and request fees. Source: [Perplexity pricing](https://docs.perplexity.ai/docs/getting-started/pricing). | Account, API key, billing. | Optional cited synthesis/search provider, not evidence replacement. |
| Bing Search APIs | Retired August 11, 2025 and unavailable for new signup. Source: [Microsoft lifecycle](https://learn.microsoft.com/en-us/lifecycle/announcements/bing-search-api-retirement). | Migration to Azure grounding products. | Do not build new Bing Web Search adapter. |
| SearXNG or YaCy | Free software, not free upstream capacity. | Operator-hosted instance and policy ownership. | Explicit self-hosted discovery lane only. |
| Common Crawl | Free open corpus, but not live SERP and requires index/storage/query infrastructure. Source: [Common Crawl](https://commoncrawl.org/). | Operator data/index pipeline. | Open-corpus provider, not live web default. |
| Open vertical APIs | Some are genuinely no-cost with etiquette limits. OpenAlex currently grants free daily API usage via a free key, including example budgets for search and list/filter. Source: [OpenAlex docs](https://developers.openalex.org/guides/authentication). YouTube Data API has 10,000 quota units/day, but search costs 100 units/request. Source: [YouTube docs](https://developers.google.com/youtube/v3/getting-started). | Varies: no key, free key, or OAuth/API key. | Best free-first path for scoped topics, not generic web search. |

### Free API combinations worth considering

| Combination | Components | Strength | Failure mode |
|---|---|---|---|
| Open public research mode | SearXNG self-hosted, Common Crawl, Wikipedia/Wikidata, OpenAlex, Crossref, arXiv, Hacker News, Stack Exchange, GitHub, direct fetch, browser fallback, Readability extraction | Best no-user-setup path if OpenDevBrowser or workspace operates the infrastructure | Not equivalent to Google-like fresh web SERP, and SearXNG can still be upstream-limited |
| Scholarly-first mode | OpenAlex, Crossref, arXiv, PubMed, Semantic Scholar, DOI landing pages, open-access links | Strong citations and legal posture for academic topics | Not useful for general consumer/web topics |
| Developer/community mode | Hacker News Firebase and Algolia, GitHub Search, Stack Exchange, selected forums, optional Reddit only with official API and policy review | Good for tools, developer trends, technical issues | Community bias, auth/rate limits, and Reddit product/legal risk |
| Self-hosted privacy mode | SearXNG, YaCy, Common Crawl index, local curated source indexes, OpenDevBrowser browser fetch | No commercial search keys and better privacy control | Requires operator setup, storage, abuse protection, and ongoing maintenance |
| BYO-key SERP mode | Brave, SerpApi, Serper, Zenserp, DataForSEO, SearchApi.io, Tavily, Exa | Best structured discovery when user has quota and accepted terms | Not zero-setup and not free at production scale |

### Comparison against browser-only top-5-engine model
- Browser-only engines are broader and zero external API setup, but remain anti-bot, UI, rate-limit, locale, challenge, and terms sensitive.
- Free/API-first discovery is more structured and easier to diagnose, but most generic SERP APIs require credentials, quotas, billing, trials, or operator setup.
- Neither path should be treated as final evidence. Both should feed destination fetches, then rely on existing sanitization, timebox, ranking, and no-artifact failure gates.
- API-first becomes better than browser-only only when the user or workspace explicitly configures a provider with acceptable quota and terms.

### Architecture fit

The minimal product path is to keep `ProviderSource` unchanged and implement configured discovery adapters under `source: "web"`:

1. Add a centralized provider config surface for endpoint, key environment variable, quota hints, result caps, timeout, and allowed provider IDs.
2. Register adapters through `createWebProvider({ searchIndex })` so each provider emits normalized `web:search:index` records.
3. Mark all API SERP/snippet rows as `discoveryOnly` in attributes or metadata.
4. Let the existing executor fetch destination pages through `web:fetch:url`, but increase caps only after a bounded planner exists.
5. Preserve `runResearchWorkflow()` evidence gates so shell-only, stale-only, blocked-only, and zero-evidence runs fail before artifact emission.
6. Emit provider diagnostics in `meta.json`: provider ID, query, rank, quota state, rate-limit state, auth state, destination fetch status, and reasons for excluded records.

The current codebase is close to this shape because `createWebProvider({ searchIndex })` already accepts injected search rows, and `renderResearch()` already produces the correct artifact contract. The missing pieces are central credentials/config, provider diagnostics, a bounded fetch planner, and public-surface truth updates.

### Recommended implementation path
1. Do not add a hidden free SERP default.
2. Keep `auto` source-family behavior unchanged unless configured providers are documented and visible in metadata.
3. Add an explicit future `web` discovery provider surface, for example `web/brave`, `web/serpapi`, `web/serper`, `web/tavily`, `web/exa`, `web/searxng`, using `createWebProvider({ searchIndex })`.
4. Add centralized provider config for API key env var names, endpoint, quota hints, retry/timeouts, result caps, and a `discoveryOnly` marker.
5. Expand open vertical providers separately for topics where they are authoritative, such as scholarly, biomedical, code, developer Q&A, news/events, video, and encyclopedia sources.
6. Preserve artifacts exactly: no `summary.md`, `report.md`, `records.json`, `context.json`, `meta.json`, or manifest unless usable evidence survives.
7. Record provider ID, query, rank, quota/rate-limit diagnostics, destination-fetch status, and discovery-only status in artifact metadata.

### Risks
- Shared bundled keys would create quota exhaustion, abuse, billing, and terms risks.
- Calling trial credits or tiny monthly quotas "free production" would mislead users.
- API snippets can look like evidence while still being search shells.
- Public self-hosted SearXNG instances can fail, throttle, block, or violate upstream expectations if treated as unlimited infrastructure.
- Open vertical APIs improve scoped research but can bias coverage if marketed as generic web search.
- Adding provider selectors to CLI/tool schemas too early may bloat the public surface; config-first under `web` is the smallest reversible step.

## Investigation Log

### Phase 1 - Initial Triage
**Hypothesis:** Free search APIs may exist, but likely impose limited credits, user keys, low quotas, or terms that prevent production use as a hidden default.
**Findings:** Confirmed. The best genuinely no-cost options are open vertical APIs and self-hosted/open-corpus infrastructure, not generic production SERP APIs.
**Evidence:** RepoPrompt context builder, three external explore agents, pair investigator, official provider docs, and OpenDevBrowser runtime context.
**Conclusion:** Free SERP APIs do not make generic research stable by default.

### Phase 2 - RepoPrompt and pair investigation
**Hypothesis:** The existing provider runtime may already have a safe seam for API-backed discovery.
**Findings:** Confirmed. `createWebProvider({ searchIndex })` is the narrowest extension seam. Current source selection, CLI/tool schemas, and config do not expose generic SERP provider configuration.
**Evidence:** Selected context from `src/providers/web/index.ts`, `src/providers/research-compiler.ts`, `src/providers/research-executor.ts`, `src/config.ts`, `src/providers/workflows.ts`, `src/providers/renderer.ts`, and related tests.
**Conclusion:** If API search is implemented, it should be an explicit configured `web` discovery lane and should not weaken artifact gates.

## Root Cause
- The product goal asks for no-setup generic research, but generic SERP APIs are not freely available at production scale without accounts, keys, quotas, billing, or operator infrastructure.
- Browser-only search-engine research avoids API setup but inherits UI drift, anti-bot, policy, region, CAPTCHA, consent, and rate-limit failures.
- Current OpenDevBrowser research is source-family based, not engine/API based, and it has no centralized general search API credential/config surface.
- Strict no-evidence gates are correct. Search result rows, API snippets, shells, login pages, challenges, stale pages, and not-found pages must not become successful research evidence.

## Recommendations
1. Do not remove research entirely solely because generic SERP APIs are not free. Instead, demote generic research reliability claims and narrow the promise.
2. Do not ship hidden shared commercial API keys. They will centralize quota exhaustion, abuse, billing, privacy, and terms risk.
3. Keep browser-only top-5 search as experimental discovery only, not default reliable research.
4. Build a future explicit `web` discovery lane only for configured providers:
   - BYO-key commercial providers: Brave, SerpApi, Serper, Zenserp, DataForSEO, SearchApi.io, Tavily, Exa.
   - Operator-owned providers: self-hosted SearXNG, YaCy, Common Crawl derived index.
   - Open vertical providers: OpenAlex, Crossref, arXiv, PubMed, Semantic Scholar, Wikipedia, Wikidata, Hacker News, Stack Exchange, GitHub, GDELT, YouTube where terms and quotas allow.
5. Prefer open vertical APIs as the no-setup default for scoped research because they are more honest, citable, and policy-aligned than generic SERP scraping.
6. Keep all SERP and search API records discovery-only until destination content is fetched, extracted, and accepted by the existing gates.
7. Update docs/help/skill language before any promotion so `research run` is described as evidence-gated, provider-constrained, and best-effort unless configured providers are available.
8. If user-facing API support is later implemented, keep it config-first and provider-ID based before widening CLI/tool schema.

## Preventive Measures
1. Add tests that SERP/API snippet records never count as final evidence.
2. Add no-evidence regression tests for quota-only, auth-only, trial-expired, rate-limited, shell-only, stale-only, challenge-only, and blocked-only runs.
3. Add provider diagnostics tests for quota state, credential missing, provider disabled, provider configured, and destination-fetch success/failure.
4. Add bounded planning tests before increasing follow-up fetch caps: global candidate cap, per-provider cap, per-domain cap, dedupe before fetch, and early stop when enough evidence survives.
5. Add docs that distinguish:
   - Free quota
   - Trial credit
   - Free software with operator cost
   - Open data/API with etiquette limits
   - Paid production SERP
6. Keep `summary.md`, `report.md`, `records.json`, `context.json`, `meta.json`, and `bundle-manifest.json` emission behind successful evidence gates.
7. Re-check provider pricing and terms immediately before implementation because search API pricing changes frequently.

## Final Decision
The best path is not a free generic SERP layer. It is a hybrid, evidence-gated research system:

1. Default no-setup research should use open vertical APIs and destination-page evidence where they fit.
2. Generic web discovery should be explicit and configured, not hidden.
3. Commercial SERP and AI-search APIs should be BYO-key or workspace-configured.
4. Browser-only search should remain experimental discovery and must never bypass search-engine policies or blockers.
5. Research should stay only if product language is narrowed from "reliable generic topical research" to "evidence-gated research with configured discovery sources and honest provider diagnostics."
