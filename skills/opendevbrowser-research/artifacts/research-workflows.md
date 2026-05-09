# Research Workflows

Use these workflows to plan evidence first, run provider-constrained collection second, and publish only claims that pass review.

## Evidence-gated baseline workflow

1. Define topic, scope, and strict time window.
2. Choose explicit source families before invoking the CLI primitive. Prefer `--sources web,community` for broad public research when both destination pages and community corroboration are useful.
3. Record why each source family is in scope and which families are intentionally excluded.
4. Run `opendevbrowser research run` as a low-level best-effort primitive.
5. Persist `summary.md`, `report.md`, `records.json`, `context.json`, `meta.json`, and `bundle-manifest.json`.
6. Review `records.json`, `context.json`, and `meta.json` before using `report.md`.
7. Publish supported claims, mark weak claims as tentative, and exclude unsupported claims.

## Claim-to-source review workflow

1. Extract the claims that the final answer would make.
2. Map each claim to accepted destination evidence in `records.json`.
3. Check source date, fetch date, provider, extraction quality, and source independence.
4. Require corroboration for critical claims when the topic allows it.
5. Record evidence gaps, stale pages, login walls, challenge pages, rate limits, and extraction limits.
6. Do not use shell-only, stale-only, login-only, not-found-only, or zero-source-evidence runs as final support.

## Search Engine Discovery Lane

This optional lane is skill-guided, provider-constrained, and discovery-only. It is for richer candidate discovery, not for runtime source-family expansion.

1. Choose up to five engines based on topic and availability: Google, Bing, Brave, DuckDuckGo or Yahoo, Yandex, Baidu, and Kagi only with user account access.
2. Record search_engine_passes with engine, query, region, language, rationale, cookie or auth needs, and blockers.
3. Collect up to 10 SERP candidate URLs per engine with engine, query, rank, URL, title if available, and retrieval notes.
4. Dedupe canonical URLs across engines.
5. Select the strongest 5 to 10 destination pages for extraction.
6. Fetch selected destination pages with OpenDevBrowser browsing primitives when useful, including DOM interaction, screenshots, cookies, and authenticated browsing only for legitimate user-authorized access.
7. Stand down on robots restrictions, login walls, consent gates, CAPTCHAs, rate limits, anti-bot controls, and access controls. Record the limitation instead.
8. Keep SERPs discovery-only. SERP snippets, search result pages, shells, and blocked pages cannot be final evidence.
9. Cite destination-page evidence or other fetched evidence that passed review.

## Backoff and blocker workflow

1. Detect repeated 429 responses, provider throttling, challenge pages, login walls, consent gates, or extraction failures.
2. Honor retry windows and bounded retries.
3. Resume from persisted artifacts only when the next run can add evidence without bypassing controls.
4. Report partial coverage, provider constraints, and skipped lanes when limits persist.

## Compact handoff workflow

1. Produce a compact summary with accepted claims only.
2. Include evidence gaps, provider constraints, and limitations.
3. Attach artifact paths for replay and review.
4. Name unsupported claims that were excluded or left tentative.
