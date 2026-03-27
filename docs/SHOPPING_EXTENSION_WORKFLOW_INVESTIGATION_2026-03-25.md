# Investigation: Shopping Workflow Extension-Mode Issues

## Summary
The observed shopping-workflow problems are not one bug. The run exposed four separate seams: extension session/lease drift, extension attach preflight fallback that can inherit the wrong tab, shopping offer extraction and ranking that tolerate low-quality records, and region handling that is forwarded by the CLI but ignored by default shopping adapters.

## Symptoms
- Extension-mode shopping runs encountered setup and transport friction before provider execution stabilized.
- A launched extension session could later fail with `Unknown sessionId`.
- Shopping results for `MacBook Pro M4 32GB RAM` mixed unrelated chip/RAM variants, region-noisy records, and zero-price offers.
- Provider flows sometimes required manual follow-up or challenge recovery before any usable result set appeared.

## Investigation Log

### Phase 1 - CLI and Workflow Plumbing
**Hypothesis:** The CLI may be dropping shopping inputs such as `region`, causing downstream drift.
**Findings:** The CLI parses and forwards `region`, `budget`, `sort`, and related options correctly.
**Evidence:**
- `src/cli/commands/shopping.ts:217-246` builds the daemon payload with `region`, `budget`, `sort`, `mode`, and other workflow options.
- `tests/cli-workflows.test.ts:99-118` asserts that `runShoppingCommand()` forwards `region: "us"` to `callDaemon("shopping.run", ...)`.
**Conclusion:** Eliminated. The CLI plumbing is not the source of the region-loss issue.

### Phase 2 - Region Handling in Default Shopping Adapters
**Hypothesis:** `--region` is accepted by the workflow but not enforced by default shopping providers.
**Findings:** Confirmed. `runShoppingWorkflow()` forwards `filters.region`, but `createDefaultSearch()` and `createDefaultFetch()` ignore it entirely.
**Evidence:**
- `src/providers/workflows.ts:1629-1642` passes `filters: { budget, region }` into `runtime.search(...)`.
- `src/providers/shopping/index.ts:1242-1260` builds `lookupUrl` from `profile.searchPath(query)` and never reads `input.filters.region`.
- `src/providers/shopping/index.ts:1358-1385` fetches product pages in `createDefaultFetch()` without consulting region or locale context.
- `src/providers/shopping/index.ts:173-278` hardcodes provider domains such as `amazon.com`, `walmart.com`, `bestbuy.com`, and `ebay.com` with no region mapping layer.
- `src/providers/shopping/index.ts:717-739` defaults `$` prices to `USD` in `parsePrice()`, so cross-region dollar-market results can be mislabeled.
**Conclusion:** Confirmed. Region handling is mostly a hint today, not an enforced shopping constraint.

### Phase 3 - Offer Extraction and Ranking Quality
**Hypothesis:** Weak extraction and ranking rules allow low-quality or mismatched offers to surface as plausible deals.
**Findings:** Confirmed. The current pipeline admits generic anchor-derived candidates, assigns confidence mostly by DOM order, and gives zero-price offers a non-trivial `best_deal` baseline unless a budget filter is present.
**Evidence:**
- `src/providers/shopping/index.ts:1029-1060` extracts generic candidates from broad anchor/context windows rather than stable card boundaries.
- `src/providers/shopping/index.ts:985-994` scores candidates on length, price, brand, rating, and reviews, but does not score query/spec relevance.
- `src/providers/shopping/index.ts:996-1004` stops deduping once `deduped.size >= limit`, so early DOM order still affects which candidates survive.
- `src/providers/shopping/index.ts:1287-1299` sets candidate confidence as `0.88 - index * 0.04`, which is position-based rather than extraction-quality-based.
- `src/providers/workflows.ts:989-996` gives `priceScore = 0.5` when total price is `0`, which lets unpriced offers retain meaningful `best_deal` weight.
- `src/providers/workflows.ts:1649-1664` filters out zero-price offers only when `budget` is provided.
- `src/providers/workflows.ts:1048-1095` creates offers from nested attributes plus fallback content parsing, with unknown shipping defaulting to `0` cost and notes `"unknown"`.
- `src/providers/workflows.ts:1111-1128` dedupes offers by `canonicalUrl(url) + title.toLowerCase()`, which is too literal for spec variants and duplicate PDPs.
- `tests/providers-workflows-branches.test.ts:1540-1596` verifies current `fastest_shipping` and tie-break behavior, but does not enforce spec relevance or zero-price exclusion outside budget mode.
- `tests/providers-workflows-branches.test.ts:1699-1767` explicitly verifies that missing-price offers are dropped only when `budget` is supplied.
**Conclusion:** Confirmed. The workflow currently behaves more like a candidate collector than a trustworthy exact-spec best-deal ranker.

### Phase 4 - Extension Session and Lease Drift
**Hypothesis:** Extension-mode session failures come from a contract mismatch between daemon/browser-manager sessions and `/ops` lease ownership.
**Findings:** Confirmed. The daemon can create extension sessions without a registered session lease because `connectRelay()` advertises `leaseId?: string` but `connectWithEndpoint()` never returns one. At the same time, the `/ops` runtime requires exact `opsSessionId`, `ownerClientId`, and `leaseId`.
**Evidence:**
- `src/browser/browser-manager.ts:554-559` exposes `connectRelay(...): Promise<{ ..., leaseId?: string }>` at the public API.
- `src/browser/browser-manager.ts:3872-4008` returns `{ sessionId, mode, activeTargetId, warnings, wsEndpoint }` from `connectWithEndpoint()` with no `leaseId`.
- `src/cli/daemon-commands.ts:801-804` and `src/cli/daemon-commands.ts:894-897` only call `registerSessionLease(...)` when `extractLeaseId(result)` succeeds.
- `src/cli/daemon-commands.ts:979-982` shows `extractLeaseId()` merely reads `result.leaseId` if present.
- `src/cli/daemon-state.ts:147-187` stores session leases without TTL reaping or live validation against browser-manager session existence.
- `src/browser/browser-manager.ts:2962-2967` throws raw `Unknown sessionId: ${sessionId}` when `this.sessions` no longer contains the session.
- `extension/src/ops/ops-runtime.ts:534-561` creates `/ops` sessions with a concrete `leaseId` and returns it to the client.
- `extension/src/ops/ops-runtime.ts:1869-1896` rejects requests unless `opsSessionId`, `ownerClientId`, and `leaseId` all match the stored session.
**Conclusion:** Confirmed. There are at least two related session issues:
- Contract mismatch: extension relay sessions on the daemon side are not consistently lease-backed.
- Stale-state cleanup gap: dead browser-manager sessions can leave surrounding state looking valid until a later command hits `Unknown sessionId`.

### Phase 5 - Extension Attach Preflight and Restricted-Tab Fallback
**Hypothesis:** Some extension-mode shopping runs inherit the wrong browser context because restricted tabs fall back to whichever attachable tab is available.
**Findings:** Confirmed. Both the connection manager and the `/ops` runtime intentionally fall back from restricted active tabs to other attachable tabs instead of requiring a provider-intent tab.
**Evidence:**
- `extension/src/services/ConnectionManager.ts:374-381` falls back to the first HTTP tab or a blank bootstrap tab when the active tab is unusable.
- `extension/src/services/ConnectionManager.ts:430-500` retries on missing/restricted/invalid active tabs before throwing `tab_url_restricted`.
- `extension/src/ops/ops-runtime.ts:500-561` attaches to the active tab for `session.launch`, rejecting restricted tabs only after resolving the current tab context.
- `tests/extension-ops-runtime.test.ts:1225-1329` explicitly verifies that `session.launch` falls back from a restricted `chrome://newtab/` active tab to the first attachable HTTP tab instead of returning `restricted_url`.
- `src/cli/commands/native.ts:391-398` surfaces native-host extension-ID mismatch as a disconnected state, matching the mismatch seen during the live run.
**Conclusion:** Confirmed. Wrong-tab attachment is a separate reliability problem that can amplify locale, cookie, and storefront drift even when session IDs remain valid.

## Root Cause
There is no single root cause. The live shopping run exposed four distinct defects:

1. **Region enforcement gap**
   - The CLI and workflow forward `region`, but default shopping providers ignore it.
   - Evidence: `src/providers/workflows.ts:1629-1642`, `src/providers/shopping/index.ts:1242-1451`.

2. **Offer-quality gap**
   - Generic candidate extraction, position-based confidence, zero-price scoring, and weak dedupe let low-confidence records survive ranking.
   - Evidence: `src/providers/shopping/index.ts:985-1135`, `src/providers/workflows.ts:989-1128`.

3. **Extension session contract drift**
   - Daemon/browser-manager extension sessions can exist without a lease, while `/ops` requires lease-backed ownership.
   - Evidence: `src/browser/browser-manager.ts:554-559`, `src/browser/browser-manager.ts:3872-4008`, `src/cli/daemon-commands.ts:801-804`, `src/cli/daemon-commands.ts:894-897`, `extension/src/ops/ops-runtime.ts:1869-1896`.

4. **Attach-context drift**
   - Restricted active tabs can silently rebind shopping work onto an arbitrary attachable HTTP tab or bootstrap tab.
   - Evidence: `extension/src/services/ConnectionManager.ts:374-381`, `extension/src/services/ConnectionManager.ts:430-500`, `tests/extension-ops-runtime.test.ts:1225-1329`.

## Eliminated Hypotheses
- **CLI dropped `region` before the workflow layer**
  - Ruled out by `src/cli/commands/shopping.ts:217-246` and `tests/cli-workflows.test.ts:99-118`.
- **The shopping issues were entirely caused by one session bug**
  - Ruled out by the code split between session/lease drift (`src/browser/browser-manager.ts`, `src/cli/daemon-state.ts`, `extension/src/ops/ops-runtime.ts`) and fully separate ranking/region behavior in `src/providers/shopping/index.ts` and `src/providers/workflows.ts`.

## Recommendations
1. **Fix stale-session cleanup and typed relaunch errors first**
   - Catch raw `Unknown sessionId` and `/ops` `invalid_session`/`not_owner` failures in daemon session command paths.
   - Release daemon session leases immediately when those failures occur.
   - Target files: `src/cli/daemon-commands.ts`, `src/cli/daemon-state.ts`, `src/browser/browser-manager.ts`.

2. **Make zero-price offers ineligible for ranked deal output**
   - Change `computeDealScore()` so `total <= 0` yields no price credit.
   - Exclude zero-price offers from ranked output even when no budget is supplied.
   - Target file: `src/providers/workflows.ts`.

3. **Stop shopping/browser-fallback flows from inheriting arbitrary fallback tabs**
   - For shopping assist flows, open or navigate a provider-intent tab rather than attaching to the first attachable HTTP tab.
   - Target files: `extension/src/services/ConnectionManager.ts`, shopping/browser-fallback entry points in `src/providers/browser-fallback.ts` and related workflow callers.

4. **Either enforce `region` or emit an explicit `region_unenforced` warning**
   - Minimum honest fix: emit workflow metadata when `region` is ignored by the adapter.
   - Better fix: plumb `region` into provider URL/domain selection and add post-normalization domain/currency mismatch filtering.
   - Target files: `src/providers/shopping/index.ts`, `src/providers/workflows.ts`.

5. **Align extension lease semantics**
   - Either return a real `leaseId` from browser-manager extension relay sessions or stop implying lease-backed behavior in that path.
   - Target files: `src/browser/browser-manager.ts`, `src/cli/daemon-commands.ts`.

## Preventive Measures
- Add regression tests proving that zero-price offers are excluded from ranked shopping output even without a budget.
- Add adapter tests proving `region` changes request shape or, if unsupported, emits explicit workflow warnings.
- Add daemon tests that stale extension sessions auto-clear leases and return typed relaunch-required errors instead of raw `Unknown sessionId`.
- Add extension-mode tests that shopping/browser-assistance flows attach to a provider-specific tab, not the first arbitrary HTTP tab.

## Validation Closure - 2026-03-26
- Static gates are green after the runtime-factory closure and dead-branch cleanup: `npm run lint`, `npm run typecheck`, `npm run build`, `npm run extension:build`, `git diff --check`, and `npm run test` all passed, with global branch coverage at `97.01%`.
- Explicit extension proof: `node dist/cli/index.js shopping run --query 'macbook pro m4 32gb ram' --providers walmart --browser-mode extension --mode json --timeout-ms 120000 --output-dir /tmp/odb-live-shopping-extension-20260326 --output-format json` completed successfully. Artifact `/tmp/odb-live-shopping-extension-20260326/shopping/4d37ac29-52fe-4b95-b83a-01ba54e76959/meta.json` records `requested_browser_mode: "extension"` and `browser_fallback_modes_observed: ["extension"]`, with no `managed_headed` marker.
- Explicit managed proof: `node dist/cli/index.js shopping run --query 'macbook pro m4 32gb ram' --providers walmart --browser-mode managed --mode json --timeout-ms 120000 --output-dir /tmp/odb-live-shopping-managed-20260326 --output-format json` completed successfully with 8 Walmart offers. Artifact `/tmp/odb-live-shopping-managed-20260326/shopping/e8f66791-dc7b-4318-bfb7-18910821fc4e/meta.json` records `browser_fallback_modes_observed: ["managed_headed"]`.
- Auto-mode success proof: `node dist/cli/index.js shopping run --query 'macbook pro m4 32gb ram' --providers ebay --browser-mode auto --mode json --timeout-ms 120000 --output-dir /tmp/odb-live-shopping-auto-ebay-20260326 --output-format json` completed successfully with 7 eBay offers and no browser fallback mode observed.
- Auto-mode bounded degradation proof: `node dist/cli/index.js shopping run --query 'macbook pro m4 32gb ram' --providers walmart --browser-mode auto --mode json --timeout-ms 120000 --output-dir /tmp/odb-live-shopping-auto-20260326 --output-format json` preserved a live Walmart anti-bot challenge session and returned explicit manual-yield metadata instead of crashing or silently switching to managed mode.
- Workflow-policy verification after the live proofs confirmed that this remaining Walmart `auto` outcome is not a missing retry seam. `src/providers/workflows.ts` leaves `preferredFallbackModes` undefined for `browserMode="auto"` and performs one `runtime.search()` per provider, while `src/providers/browser-fallback.ts` shapes `challenge_preserved` as an intentional preserved-session/manual-yield result.
- Regression codification now locks that contract without changing production behavior. `tests/providers-workflows-branches.test.ts` asserts that `browserMode="auto"` makes one provider call, applies no forced browser override, and preserves extension challenge metadata unchanged. `tests/providers-artifacts-workflows.test.ts` asserts the reported workflow meta keeps `browser_fallback_modes_observed: ["extension"]` with no managed rerun evidence. Targeted verification passed: `npm run test -- tests/providers-workflows-branches.test.ts tests/providers-artifacts-workflows.test.ts --coverage.enabled=false`.
- Decision: no further runtime change is justified for this seam. Automatic managed downshift after an extension-side preserved challenge would be a new product policy that redefines `browserMode="auto"`, not a fix for the already-closed extension attach bug.
