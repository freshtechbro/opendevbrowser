# Investigation: March 21 Live Provider and Product-Video Seams

## Summary
`provider.community.search.url` is not behaving like a stable provider-runtime empty-result bug. The strongest live evidence shows an intermittent CLI stdout truncation seam: the same macro command alternates between valid JSON and a 64,906-byte unterminated JSON string, and the direct-provider harness turns that parse miss into `no_records_no_failures`.

The Best Buy `product-video run` behavior is different. The run is succeeding under the current contract because product details are present, but media is absent: the raw source record contains no usable image fields and no image-like links, and the workflow treats image download plus screenshot capture as best-effort.

## Symptoms
- `scripts/provider-direct-runs.mjs` reported `provider.community.search.url -> fail (no_records_no_failures)` in both `/tmp/odb-provider-direct-runs-20260321-live.json` and `/tmp/odb-provider-direct-runs-rerun-20260321.json`.
- The same standalone macro command succeeded outside the harness:
  - `node dist/cli/index.js macro-resolve --execute --expression '@community.search("https://www.reddit.com/r/programming", 2)' --timeout-ms 120000 --output-format json`
- `product-video run` on the Best Buy PDP wrote assets under `/tmp/odb-product-video-20260321-live/product-assets/9dac63fe-6126-449f-8294-7ab96bef16f8`, but `manifest.json` recorded `assets.images=[]` and `assets.screenshots=[]`.

## Investigation Log

### Phase 1 - Harness vs standalone community macro
**Hypothesis:** the Reddit community URL probe is a real provider/runtime regression.

**Findings:** the harness still records the step as a failure, but the standalone command succeeds with real records. The harness artifact row has no parsed execution metadata.

**Evidence:**
- `/tmp/odb-provider-direct-runs-rerun-20260321.json`
  - `steps[].id=="provider.community.search.url"` => `status="fail"`, `detail="no_records_no_failures"`, `data.records=0`, `data.failures=0`, `data.providerOrder=[]`
- Standalone CLI success:
  - `node dist/cli/index.js macro-resolve --execute --expression '@community.search("https://www.reddit.com/r/programming", 2)' --timeout-ms 120000 --output-format json`
  - returned `execution.records.length=2`, `execution.failures.length=0`, `meta.providerOrder=["community/default"]`
- Harness extraction logic:
  - `scripts/provider-direct-runs.mjs:104-114` reads `result.json?.data?.execution`
  - `scripts/provider-direct-runs.mjs:289-321` classifies missing parsed execution as zero records / zero failures
  - `scripts/live-direct-utils.mjs:216-252` turns that into `fail/no_records_no_failures`

**Conclusion:** eliminated the theory that this seam is proven by the harness artifact alone. The harness artifact shows a parse/classification symptom, not definitive provider failure.

### Phase 2 - Reproducing the CLI parsing seam directly
**Hypothesis:** the harness is misparsing or losing some successful CLI responses.

**Findings:** `runCli()` reproduces two distinct outcomes for the exact same command. Good runs produce valid JSON and 2 records. Bad runs exit `0` but return invalid, truncated JSON. The bad payload size is consistently 64,906 bytes and ends mid-string.

**Evidence:**
- `scripts/live-direct-utils.mjs:39-75` uses `parseJsonFromStdout()`
- `scripts/live-direct-utils.mjs:85-117` builds `result.json` from parsed stdout
- Repeated `runCli()` probes of the same command produced:
  - good runs: `stdoutLength=9707` or `24779`, `helperParsed=true`, `records=2`
  - bad runs: `stdoutLength=64906`, `helperParsed=false`, `directParsed=false`
- Saved bad payload:
  - `/tmp/community-search-invalid-1774098608815.txt`
  - `JSON.parse` error: `Unterminated string in JSON at position 64906`
  - EOF snippet: `called Ziina. The only difference is that the final report is “digitally signed” by Accorp: Beyond that, there are lite`
- CLI output path:
  - `src/cli/output.ts:8-31` emits JSON with `console.log(JSON.stringify(payload))`
- Existing flush helper:
  - `scripts/flush-exit.mjs:13-30`
- Existing precedent:
  - `scripts/provider-live-matrix.mjs:10`
  - `scripts/provider-live-matrix.mjs:1668-1672`

**Conclusion:** confirmed a second, stronger root cause for the community seam. Large successful CLI JSON payloads can be truncated on stdout before the process fully drains, and the direct-provider harness then masks that as `no_records_no_failures`.

### Phase 3 - Best Buy product-video media path
**Hypothesis:** `product-video run` is failing to download media that the provider already extracted.

**Findings:** the raw Best Buy source record does not contain usable media candidates for the current workflow. The workflow only harvests `image_urls` plus image-looking `links`, and it only produces screenshots when direct capture succeeds or at least one image file already exists.

**Evidence:**
- Live artifact:
  - `/tmp/odb-product-video-20260321-live/product-assets/9dac63fe-6126-449f-8294-7ab96bef16f8/manifest.json`
  - `assets.images=[]`
  - `assets.screenshots=[]`
- Live raw record:
  - `/tmp/odb-product-video-20260321-live/product-assets/9dac63fe-6126-449f-8294-7ab96bef16f8/raw/source-record.json`
  - `provider="shopping/bestbuy"`
  - `attributes.links.length=30`
  - `attributes.image_urls=0`
  - `attributes.imageUrls=0`
  - `attributes.images=0`
  - `attributes.media=0`
  - `imageLikeLinks=0`
- Workflow extraction and media rules:
  - `src/providers/workflows.ts:929-939` only accepts `record.attributes.image_urls` plus image-looking `record.attributes.links`
  - `src/providers/workflows.ts:948-963` returns `null` on any image fetch failure
  - `src/providers/workflows.ts:1543-1545` only fails when product details are missing
  - `src/providers/workflows.ts:1568-1601` makes images and screenshots best-effort
- Screenshot callback contract:
  - `src/cli/daemon-commands.ts:655-679` returns `null` on any capture/navigation failure
- Extractor limitations:
  - `src/providers/web/extract.ts:27`
  - `src/providers/web/extract.ts:96-106`
  - the structured extractor collects `href=` links, not `<img src>`, `srcset`, or client-side image state
- Tests locking current behavior:
  - `tests/providers-workflows-branches.test.ts:2661-2705` expects `images=[]` and `screenshots=[]` to be safe
  - `tests/providers-workflows-branches.test.ts:2617-2658` shows screenshots only populate when direct capture returns a buffer
  - `tests/providers-workflows-branches.test.ts:2601-2613` shows screenshot fallback depends on an existing image file

**Conclusion:** eliminated the theory that this is primarily an image-download regression. The live Best Buy record does not supply usable media candidates under current extraction rules, and the workflow contract explicitly allows metadata-only success.

## Root Cause

### `provider.community.search.url`
Primary cause: intermittent CLI stdout truncation on large successful JSON payloads.

Secondary cause: harness masking. When `result.json` is null, `collectMacroExecution()` falls back to empty arrays and `classifyRecords()` reports `no_records_no_failures`.

This seam is therefore best classified as a CLI-output reliability bug plus harness error classification drift, not as a proven `community/default` provider failure.

### Best Buy `product-video run`
Primary cause: media discovery gap. The current extraction path only uses structured `image_urls` and image-looking anchor links, and the live Best Buy record had neither.

Secondary cause: permissive workflow contract. `runProductVideoWorkflow()` succeeds once it has product details, even if both media lanes end empty.

## Eliminated Hypotheses
- `community/default` is deterministically returning zero records for the Reddit URL.
  - Eliminated by repeated standalone successes with 2 records and `providerOrder=["community/default"]`.
- The direct-provider harness failure is only a live-site transient.
  - Incomplete. Live variance exists, but the stronger confirmed failure is stdout truncation plus parse loss.
- `product-video` is primarily broken because image downloads are failing after extraction.
  - Eliminated by the raw record showing zero usable media candidates before download.

## Recommendations
1. Treat the community seam as a CLI-output reliability defect first. The most targeted fix lane is to flush stdout/stderr before process exit on JSON-heavy CLI surfaces and direct-run scripts.
2. Teach `scripts/provider-direct-runs.mjs` to classify `result.status===0 && result.json===null` as a dedicated harness failure reason instead of `no_records_no_failures`.
3. Decide whether `product-video` should keep metadata-only success or escalate zero-media output to warning/failure for asset-oriented runs.
4. If stronger Best Buy coverage is needed, expand extraction beyond `href=` links to image surfaces such as `<img src>`, `srcset`, and embedded product state.

## Preventive Measures
- Add a regression test that writes a >64 KB JSON payload through the CLI/output path and asserts full parseable stdout under a pipe.
- Add a direct-provider harness regression test for `status=0` plus `json=null`.
- Add a workflow-level diagnostic field for `product-video` that distinguishes:
  - no media candidates found
  - image fetches failed
  - screenshot capture returned null
