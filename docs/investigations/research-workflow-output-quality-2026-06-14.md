# Investigation: Research Workflow Output Quality

## Summary
The critique is confirmed. The sample research workflow collected real destination evidence, but the runtime report is intentionally rendered as a bounded artifact-review document, not as a decision-ready research synthesis.

The root product gap is not missing fetch data. It is the absence of a claim-level synthesis layer that turns accepted records into supported conclusions, confidence, limitations, and recommendations.

## Symptoms
- The sample `report.md` has an executive summary, source counts, accepted records, rejected candidates, and snippets, but it does not answer the research topic with an opinionated synthesis.
- The report's own summary says final usable records are persisted in `records.json`, while diagnostics and constraints are persisted in `meta.json`.
- `summary.md` contains repeated cookie diagnostics for `/Users/bishopdotun/.config/opencode/opendevbrowser.provider-cookies.json`, all reporting `cookies_missing`.
- The bundle generates six files: `report.md`, `summary.md`, `records.json`, `context.json`, `meta.json`, and `bundle-manifest.json`.
- The sample rejected 10 candidates as `search_index_shell`, while five of those same destination URLs later appear as accepted deep dives.

## Background / Prior Research
- External comparison was gathered after a bounded `opendevbrowser research run` query for report-quality patterns timed out after about 124 seconds. That timeout is operational evidence only, not content evidence.
- Web fallback research supports the product-quality target: synthesis should connect sources into themes, relationships, confidence, implications, and recommendations instead of summarizing one source at a time.
- Purdue OWL frames synthesis as making explicit connections between sources rather than listing isolated source summaries: <https://owl.purdue.edu/owl/research_and_citation/conducting_research/research_overview/synthesizing_sources.html>.
- UNC Writing Center's literature review guidance similarly emphasizes grouping and evaluating research around themes, trends, debates, and gaps: <https://writingcenter.unc.edu/tips-and-tools/literature-reviews/>.
- HEDCO Institute's evidence synthesis guidance treats the process as question definition, searching, screening, extraction, appraisal, and reporting: <https://hedcoinstitute.uoregon.edu/resources/how-to-evidence-synthesis>.

## Investigator Findings
<!-- Pair investigator appends structured findings here. -->

### Pair Investigator Findings

Scope: read-only investigation on branch `codex/investigate-research-output-quality`. Source files, tests, `CONTINUITY.md`, and `sub_continuity.md` were not edited.

#### Root causes and evidence

1. `report.md` reads like an evidence log because the renderer builds a bounded artifact-review report, not a decision-ready synthesis.
   - Artifact evidence: the sample `report.md` opens with counts and pointers to `records.json`/`meta.json`, not an answer or claim map: `.opendevbrowser/research/6dc598e9-8e55-44e3-b793-175116a0ed6c/report.md:3-9`.
   - Artifact evidence: the body is fixed sections for search direction, triage, rejected candidates, deep dives, findings, gaps, and source URLs: `.opendevbrowser/research/6dc598e9-8e55-44e3-b793-175116a0ed6c/report.md:19-98`.
   - Source evidence: `buildResearchReport()` hardcodes those same sections and never builds a final answer, recommendation, or claim map: `src/providers/renderer.ts:864-898`.
   - Source evidence: the success handoff explicitly says to inspect artifacts before turning results into publishable claims: `src/providers/workflow-handoff.ts:360-379`; docs call `research run` a low-level primitive and tell users to inspect artifacts before publishing claims: `docs/CLI.md:443-479`.
   - Contract mismatch: the skill template expects `Claim Map`, `Confidence`, `Synthesis Feedback`, and `Final Answer`: `skills/opendevbrowser-research/assets/templates/report.md:7-58`, but runtime `report.md` does not render that template.

2. The `search_index_shell` rejections in the sample are valid per-record rejections, but the report makes the URL overlap look contradictory.
   - Artifact evidence: sample `meta.json` reports `total_records: 15`, `sanitized_records: 10`, `search_index_shell: 10`, and `final_records: 5`: `.opendevbrowser/research/6dc598e9-8e55-44e3-b793-175116a0ed6c/meta.json:16-28`.
   - Artifact evidence: `context.json` lists ten rejected candidates with `reason: search_index_shell`, `replacement_status: rejected_before_synthesis`, and `retrievalPath: web:search:index`: `.opendevbrowser/research/6dc598e9-8e55-44e3-b793-175116a0ed6c/context.json:726-820`.
   - Artifact evidence: the same five destination URLs later appear as `deep_dive_pages`, which represent accepted fetched destination evidence, not accepted search-index rows: `.opendevbrowser/research/6dc598e9-8e55-44e3-b793-175116a0ed6c/context.json:822-852`.
   - Source evidence: web search result rows are stamped with `retrievalPath: web:search:index` for topical search queries: `src/providers/index.ts:2636-2673`.
   - Source evidence: research execution explicitly derives follow-up fetch URLs from search-index records, validates/dedupes candidate URLs, and then executes separate `fetch` steps: `src/providers/research-executor.ts:134-185`, `src/providers/research-executor.ts:196-217`, `src/providers/research-executor.ts:341-350`.
   - Source evidence: follow-up web fetches are capped at five, matching the sample's five accepted deep dives: `src/providers/research-compiler.ts:19-20`, `src/providers/research-compiler.ts:296-333`.
   - Source evidence: sanitization rejects the search/index representation as final evidence, records the rejected candidate, and keeps only non-shell records: `src/providers/workflows.ts:5298-5335`, `src/providers/workflows.ts:5349-5385`.
   - Conclusion: valid rejection, poor presentation. The report should say “search-index candidate record rejected as final evidence; destination URL fetched and accepted separately” when overlap exists.

3. Accepted findings are shallow snippets because richer text exists in records, but the renderer caps inline evidence to 240 characters and does not synthesize what was read.
   - Source evidence: `NormalizedRecord` supports `content` plus structured `attributes`: `src/providers/types.ts:180-190`.
   - Source evidence: web fetch stores extracted page text in `content` and extraction metadata in `attributes.extractionQuality`: `src/providers/web/index.ts:202-258`.
   - Artifact evidence: `records.json` contains full accepted records with long `content` fields, not only snippets: `.opendevbrowser/research/6dc598e9-8e55-44e3-b793-175116a0ed6c/records.json:1-27`.
   - Artifact evidence: accepted records also carry extraction quality metadata such as `hasContent` and `contentChars`: `.opendevbrowser/research/6dc598e9-8e55-44e3-b793-175116a0ed6c/context.json:193-199`.
   - Source evidence: report limits are hardcoded to ten findings, twenty sources, ten failures, and 240-character excerpts: `src/providers/renderer.ts:216-222`.
   - Source evidence: `researchExcerpt()` normalizes text and truncates over-limit content with a pointer to `records.json`: `src/providers/renderer.ts:238-263`.
   - Source evidence: each finding renders `- Evidence: ${researchExcerpt(record.content)}` and no explanatory summary: `src/providers/renderer.ts:603-615`.
   - Conclusion: the shallow output is a renderer limitation, not an evidence collection limitation. The accepted pages were read, but the report exposes raw snippets instead of interpretation.

4. Repeated cookie diagnostics are expected non-fatal CLI behavior under default `auto` policy, but the current reporting is noisy.
   - Config evidence: provider cookies default to file `~/.config/opencode/opendevbrowser.provider-cookies.json`, and `providers.cookiePolicy` defaults to `auto`: `src/config.ts:326-327`, `src/config.ts:419-444`.
   - Runtime evidence: browser fallback also defaults to policy `auto` and the same file source when config does not override it: `src/providers/runtime-factory.ts:64-68`, `src/providers/runtime-factory.ts:907-923`.
   - Runtime evidence: non-extension fallback sessions read the cookie source whenever policy is not `off`; missing cookies set `sessionEvidence: cookies_missing` and copy the read message into diagnostics: `src/providers/runtime-factory.ts:1215-1236`.
   - Source evidence: missing cookie files return `Cookie file not found: <resolvedPath>` rather than throwing: `src/providers/cookie-source.ts:59-74`.
   - Policy evidence: docs state `auto` attempts injection when cookies are available and continues when cookies are missing or unusable: `docs/CLI.md:597-603`.
   - Aggregation evidence: cookie diagnostics are appended from failures, normalized record attributes, and each attempt-chain entry with no dedupe: `src/providers/workflows.ts:999-1040`; fallback observations copy cookie diagnostics into both details and record attributes: `src/providers/browser-fallback.ts:194-229`.
   - Artifact evidence: the sample has ten identical entries in `meta.metrics.cookie_diagnostics`, all with `policy: auto`, `available: false`, `attempted: false`, `sessionEvidence: cookies_missing`, and the same missing file path: `.opendevbrowser/research/6dc598e9-8e55-44e3-b793-175116a0ed6c/meta.json:49-64` and repeated beginning at `.opendevbrowser/research/6dc598e9-8e55-44e3-b793-175116a0ed6c/meta.json:66`.
   - Presentation evidence: `summary.md` repeats the diagnostics because `renderResearch()` appends the full `meta` JSON block after compact lines: `src/providers/renderer.ts:912-920`; the sample summary shows the same cookie message repeated starting at `.opendevbrowser/research/6dc598e9-8e55-44e3-b793-175116a0ed6c/summary.md:59-74`.
   - Decision: expected CLI behavior, not a user misconfiguration, unless the user explicitly configured `required` cookies or expected authenticated evidence from that file. It is still noisy reporting and should be collapsed in user-facing files while raw diagnostics remain available internally.

5. Current artifact roles are clear internally, but too many files are exposed as if they are equally user-facing.
   - `summary.md`: compact ranked lines plus a full embedded metadata JSON block, built by `renderResearch()`: `src/providers/renderer.ts:900-921`.
   - `report.md`: bounded human-readable artifact review report, built by `buildResearchReport()`: `src/providers/renderer.ts:864-898`.
   - `records.json`: final accepted/ranked records only, written as `{ records: args.records }`: `src/providers/renderer.ts:929-935`.
   - `context.json`: handoff payload with topic, timebox, source ledger, highlights, full records, candidate triage, rejected candidates, deep-dive pages, synthesis feedback, and full meta: `src/providers/renderer.ts:818-857`.
   - `meta.json`: workflow metadata and diagnostics assembled after execution, including counts, failures, rejected candidates, cookie diagnostics, challenge diagnostics, and alerts: `src/providers/workflows.ts:5525-5617`.
   - `bundle-manifest.json`: lifecycle manifest with run id, creation time, TTL, expiry, and file list, written by the artifact bundle layer: `src/providers/artifacts.ts:104-152`; sample manifest confirms this shape: `.opendevbrowser/research/6dc598e9-8e55-44e3-b793-175116a0ed6c/bundle-manifest.json:1-14`.
   - `records.json` is useful, not redundant. It is the clean accepted-evidence dataset, while `context.json` is mixed handoff context and `meta.json` is diagnostics. Tests assert `records.json` contains only final accepted records after sanitization: `tests/providers-artifacts-workflows.test.ts:1126-1143`, and the six-file contract is tested at `tests/providers-artifacts-workflows.test.ts:36-42`.

6. A two-user-facing-file model is feasible.
   - Recommended user-facing files:
     1. `report.md`: decision-ready synthesis with answer, claim map, source-backed implications, confidence, limitations, and next steps.
     2. `evidence.md` or `context.md`: comprehensive evidence/context file containing source ledger, candidate triage, rejected candidates, deep dives, diagnostics summary, and links to raw JSON.
   - Keep internal machine files for durability and API compatibility: `records.json` for accepted evidence, `meta.json` for raw diagnostics, and `bundle-manifest.json` for cleanup/lifecycle. `context.json` can either remain an internal oracle/agent handoff file or be replaced by the comprehensive evidence file if the same structured fields are preserved.

#### Eliminated hypotheses

- Not caused by missing fetched content: accepted records include full `content` and extraction metadata in `records.json`/`context.json`; the renderer truncates it later.
- Not invalidly rejecting destination pages: the rejected objects are search-index records, and separate follow-up fetch records for five URLs survived as final evidence.
- Not a hard cookie/auth failure in the sample: `meta.json` has `failed_sources: []` and final records are present: `.opendevbrowser/research/6dc598e9-8e55-44e3-b793-175116a0ed6c/meta.json:27-30`.
- Not an artifact writer problem: `createArtifactBundle()` writes exactly the rendered files plus lifecycle manifest; the missing synthesis originates in the renderer and workflow contract, not persistence: `src/providers/artifacts.ts:133-152`.

#### Recommendations

- Make `report.md` match the skill template and user expectation: add `Evidence Gate Status`, `Claim Map`, `Final Answer`, confidence by claim, limitations, and recommendations.
- Rename or reshape the current evidence-log report into the comprehensive evidence/context file so candidate triage and raw diagnostics remain reviewable without crowding the final report.
- In rejected candidate rendering, group overlapped URLs as “search-index candidate rejected, destination fetch accepted” and link the accepted deep-dive record.
- Deduplicate cookie diagnostics in user-facing markdown by `(provider, source, policy, sourceRef, sessionEvidence, message)` and show a count. Keep raw per-attempt diagnostics in `meta.json`.
- Preserve `records.json`; it is the clean machine-readable accepted evidence set and should remain stable for tools, tests, and oracle synthesis.
- If decision-ready synthesis requires reasoning beyond deterministic extraction, add an explicit synthesis layer or mark the CLI primitive as evidence-only and ensure the skill/agent always creates the final report from the artifacts.

#### Files read that should be added to RepoPrompt selection for oracle synthesis

- Source: `src/providers/renderer.ts`, `src/providers/workflows.ts`, `src/providers/research-executor.ts`, `src/providers/research-compiler.ts`, `src/providers/web/index.ts`, `src/providers/index.ts`, `src/providers/types.ts`, `src/providers/artifacts.ts`, `src/providers/workflow-handoff.ts`, `src/providers/runtime-factory.ts`, `src/providers/runtime-policy.ts`, `src/providers/cookie-source.ts`, `src/providers/browser-fallback.ts`, `src/config.ts`, `src/cli/commands/research.ts`, `src/tools/research_run.ts`.
- Tests/docs/skills: `tests/providers-artifacts-workflows.test.ts`, `tests/config.test.ts`, `docs/CLI.md`, `skills/opendevbrowser-research/SKILL.md`, `skills/opendevbrowser-research/artifacts/research-workflows.md`, `skills/opendevbrowser-research/assets/templates/report.md`.
- Sample artifact evidence: `.opendevbrowser/research/6dc598e9-8e55-44e3-b793-175116a0ed6c/report.md`, `summary.md`, `records.json`, `context.json`, `meta.json`, `bundle-manifest.json`. These ignored bundle files may need to be summarized manually if RepoPrompt selection excludes `.opendevbrowser`.

## Investigation Log

### Phase 1 - Sample Artifact Triage
**Hypothesis:** The sample bundle has enough evidence to diagnose whether the research workflow output is a product-quality report or a machine-readable evidence package.
**Findings:** Confirmed. The sample has a short report plus much larger machine-readable context and metadata. `report.md` is 7,205 bytes, `summary.md` is 33,620 bytes, `records.json` is 94,191 bytes, `context.json` is 137,490 bytes, `meta.json` is 32,944 bytes, and `bundle-manifest.json` is 299 bytes.
**Evidence:** `.opendevbrowser/research/6dc598e9-8e55-44e3-b793-175116a0ed6c/report.md`; `.opendevbrowser/research/6dc598e9-8e55-44e3-b793-175116a0ed6c/summary.md`; `.opendevbrowser/research/6dc598e9-8e55-44e3-b793-175116a0ed6c/records.json`; `.opendevbrowser/research/6dc598e9-8e55-44e3-b793-175116a0ed6c/context.json`; `.opendevbrowser/research/6dc598e9-8e55-44e3-b793-175116a0ed6c/meta.json`.
**Conclusion:** Confirmed. The output shape is artifact-rich, but the top-level report currently under-delivers as a standalone research answer.

### Phase 1.5 - External Comparison
**Hypothesis:** Existing research-writing and evidence-synthesis practices can clarify what "decision-ready" should mean without adding paid APIs or LLM calls.
**Findings:** Confirmed. External guidance consistently treats synthesis as relationship-building and claim support, not source-by-source listing. That maps directly to a report structure with final answer, claim map, theme synthesis, confidence, limitations, and recommendations.
**Evidence:** Purdue OWL synthesis guidance; UNC Writing Center literature review guidance; HEDCO Institute evidence synthesis guidance. The attempted `opendevbrowser research run` comparison command timed out, so its output was not used as content evidence.
**Conclusion:** Confirmed. The target should be an evidence-gated research briefing, not a longer evidence log.

### Phase 2 - RepoPrompt Context Builder
**Hypothesis:** The relevant seams span renderer, workflow execution, candidate triage, cookie diagnostics, artifact persistence, docs, and skill contract.
**Findings:** Confirmed with a tooling caveat. Context Builder identified the correct seams, but its file selection came back empty, so the selection was manually curated from the discovered seams before oracle synthesis.
**Evidence:** Curated selection included `src/providers/renderer.ts`, `src/providers/workflows.ts`, `src/providers/research-executor.ts`, `src/providers/research-compiler.ts`, `src/providers/web/index.ts`, `src/providers/runtime-factory.ts`, `src/providers/cookie-source.ts`, `src/providers/artifacts.ts`, `docs/CLI.md`, `skills/opendevbrowser-research/SKILL.md`, and focused tests.
**Conclusion:** Confirmed. The issue is cross-cutting but localized to the research workflow output contract.

### Phase 3 - Pair Investigator
**Hypothesis:** The initial critique should survive adversarial source and artifact tracing.
**Findings:** Confirmed. The pair investigator verified that report shallowness is caused by renderer and contract choices, search-index rejection is valid per record, cookie diagnostics are expected but noisy, and `records.json` remains valuable as clean accepted evidence.
**Evidence:** `## Investigator Findings`.
**Conclusion:** Confirmed.

### Phase 4 - Oracle Synthesis
**Hypothesis:** Final recommendations should distinguish internal raw artifacts from user-facing product outputs.
**Findings:** Confirmed. Oracle agreed with the core findings and sharpened the missing cause: the workflow ranks records but does not build claim-level synthesis, source agreement, contradiction detection, independent corroboration, or confidence-by-claim.
**Evidence:** Oracle synthesis over the curated selection and pair findings.
**Conclusion:** Confirmed. Product quality should improve through a decision-ready evidence briefing plus a separate evidence/audit trail, while retaining raw JSON files internally.

### Phase 5 - Deterministic Report Design Validation
**Hypothesis:** The first recommendation can be achieved deterministically if the runtime produces an extractive, traceable evidence briefing rather than pretending to perform unrestricted analyst interpretation.
**Findings:** Confirmed with boundaries. The existing data model has enough inputs for deterministic evidence gates, passage extraction, theme grouping, confidence scoring, and conservative templated claims. `NormalizedRecord` already carries `content`, `title`, `url`, `timestamp`, `confidence`, provider/source, and arbitrary attributes (`src/providers/types.ts:180-190`). The web fetch path stores extracted text in `content` and extraction metadata under `attributes.extractionQuality` (`src/providers/web/index.ts:202-258`). The research workflow already computes final records, rejected counts, failures, cookie diagnostics, transcript durability, anti-bot pressure, and alerts in `meta` (`src/providers/workflows.ts:5525-5617`). The renderer already owns the report and artifact file generation seam (`src/providers/renderer.ts:864-935`).
**Evidence:** Current sample accepted records contain 5,101 to 20,344 characters each, plus extraction quality metadata. Current `report.md` uses only a 240-character excerpt per record (`src/providers/renderer.ts:216-263`, `src/providers/renderer.ts:603-615`), so the report-quality gap is not missing source text.
**Conclusion:** Confirmed. The deterministic target should be an agent-ready evidence briefing. It can organize and score evidence, but it must not claim broad semantic conclusions unless those conclusions are traceable to deterministic rules and accepted records.

## Deterministic Report Design

The recommended implementation is a deterministic synthesis compiler layered between `rankResearchRecords()` and `buildResearchReport()`. It should produce structured briefing data first, then render markdown from that structure.

### Inputs

- Accepted records from `ranked`, including `content`, `title`, `url`, provider, source, timestamp, confidence, and attributes.
- Extraction quality from `attributes.extractionQuality`.
- Timebox and source selection from `meta.timebox` and `meta.selection`.
- Candidate triage, rejected candidates, failures, cookie diagnostics, challenge diagnostics, transcript durability, and anti-bot pressure from `meta.metrics`, `meta.failures`, and `meta.rejected_candidates`.

### Deterministic Stages

1. Evidence gate status.
   - Compute `pass`, `partial`, or `fail` from named thresholds: accepted record count, independent domain count, extraction quality, timebox fit, failure severity, rejected-candidate ratio, and unresolved blocker severity.
   - If the gate fails, render limitations and next steps, not a final answer.
   - If the gate is partial, render a tentative answer with explicit gaps.

2. Passage extraction.
   - Normalize accepted record content, remove boilerplate, split into paragraphs and sentences, and keep passages with enough topic-term, title-term, or heading-term overlap.
   - Rank passages by deterministic score: topic overlap, source confidence, extraction quality, recency, heading/title proximity, and source diversity.
   - Store selected passages with record id, URL, source, and character offsets when available.

3. Theme synthesis.
   - Extract candidate keyphrases using deterministic text statistics such as TF-IDF or RAKE-style scoring, plus source-title and heading boosts.
   - Normalize variants with lowercase, stopword removal, stemming, and phrase dedupe.
   - Promote a theme only when it appears in enough independent accepted sources or is especially strong in the topic/title plus accepted passages.
   - Keep unsupported frequent boilerplate terms out through a stoplist and extraction-quality filters.

4. Claim map.
   - Generate claims only from fixed templates. Examples:
     - `Accepted evidence supports {theme} as a recurring point across {source_count} independent sources.`
     - `{theme} appears in one accepted source only, so it is tentative.`
     - `{topic} could not be answered fully because {blocker_or_gap}.`
   - Claim status should be `accepted`, `tentative`, or `excluded`.
   - Every claim must list supporting record ids, source URLs, and selected passages.

5. Source agreement or disagreement.
   - Agreement is deterministic source overlap: multiple independent sources support the same theme or claim template.
   - Disagreement should be reported only when explicit contrast or negation cues appear around the same theme, such as `however`, `but`, `risk`, `avoid`, `not`, `limitation`, `tradeoff`, or a configured antonym pair.
   - If no direct contradiction is detected, say `No direct disagreement detected in accepted sources`, not `sources agree`.

6. Confidence by claim.
   - Compute a transparent score from named factors:
     - source coverage and independent domain count,
     - extraction quality and passage quality,
     - source confidence and recency,
     - agreement or disagreement signals,
     - failure, blocker, and rejected-candidate penalties.
   - Render the score as `high`, `medium`, or `low` with a reason line, not just a number.

7. Final answer.
   - Build the final answer from accepted and tentative claim templates.
   - Keep language conservative: `The accepted evidence supports...`, `The strongest recurring themes are...`, `Evidence is insufficient for...`.
   - Do not introduce facts that are not present in accepted records or deterministic diagnostics.

8. Limitations and recommendations.
   - Generate limitations from diagnostics and coverage metrics: low source diversity, weak extraction quality, blocked sources, many rejected shells, stale records, missing cookies under `required`, challenge pressure, or timeout.
   - Generate next-step recommendations from deterministic remediation templates: broaden sources, narrow query, rerun with authorized extension mode, inspect a specific accepted source, or add another source family.

### Report Sections

The deterministic `report.md` should render:

1. `Evidence Gate Status`: status, criteria, and blocker summary.
2. `Final Answer`: conservative answer, or no-answer explanation when the gate fails.
3. `Claim Map`: claim, status, confidence, supporting records, and notes.
4. `Theme Synthesis`: themes, source coverage, representative passages, and evidence strength.
5. `Source Agreement and Disagreement`: overlap, direct contradictions, and absence of detected disagreement.
6. `Confidence by Claim`: labeled scores with factor explanations.
7. `Limitations`: source, extraction, timebox, blocker, and diagnostic limits.
8. `Recommendations`: deterministic next actions for the agent or user.
9. `Evidence Appendix`: accepted records and rejected-candidate summary, or a pointer to `evidence.md` if the two-human-facing-file model is implemented.

### Boundaries

- This should not be marketed as autonomous expert interpretation. It is an evidence briefing compiled from accepted records.
- It should make the agent's next step easier by surfacing claim candidates, confidence, gaps, and source links.
- The agent can still apply higher-level reasoning after receiving `report.md`, but it no longer has to reverse-engineer the source corpus from `records.json`, `context.json`, and `meta.json`.
- The implementation should use named thresholds and tests, not hidden magic numbers.

## Root Cause
The research workflow currently has collection, triage, ranking, and artifact persistence, but not claim-level synthesis. It can fetch destination pages and store substantial accepted evidence in `records.json`, but `buildResearchReport()` renders fixed artifact-review sections and bounded excerpts, then explicitly points users to `records.json` and `meta.json` for the real payload (`src/providers/renderer.ts:216-263`, `src/providers/renderer.ts:864-935`).

This creates expectation drift. The runtime file is named `report.md` and includes an `Executive Summary`, so users expect a research answer. But docs and handoff guidance describe `research run` as a low-level provider-constrained primitive whose artifacts must be inspected before publishing claims (`docs/CLI.md:443-479`, `src/providers/workflow-handoff.ts:360-379`).

The rejected-candidate concern is real in presentation, not in underlying triage. Search-index records are discovery artifacts with `retrievalPath: web:search:index`, and `sanitizeResearchRecords()` correctly rejects those records as final evidence (`src/providers/workflows.ts:5298-5385`). Separately, `resolveResearchWebFetchCandidates()` derives destination URLs from those search rows and fetches those pages as separate records (`src/providers/research-executor.ts:134-217`). The report fails to explain that distinction, so a valid record-level rejection looks like an invalid URL-level rejection.

The accepted findings are shallow because rendering is shallow. Accepted records contain thousands of characters of extracted page text and extraction metadata, but `researchExcerpt()` truncates inline evidence to 240 characters and `researchFindingsLines()` outputs snippets rather than source explanations, themes, or conclusions (`src/providers/renderer.ts:216-263`, `src/providers/renderer.ts:603-615`).

The cookie diagnostics are not evidence that OpenCode is performing the research instead of the CLI. The CLI dispatches `research.run` to the daemon (`src/cli/commands/research.ts:272-305`), and the provider runtime uses a default cookie source path under the opencode config namespace (`src/config.ts:326-327`, `src/providers/runtime-factory.ts:64-68`, `src/providers/runtime-factory.ts:907-923`). Under `auto`, a missing cookie file is non-fatal: `readCookiesFromSource()` returns a `Cookie file not found` diagnostic instead of throwing (`src/providers/cookie-source.ts:59-74`), and the fallback lane records that diagnostic (`src/providers/runtime-factory.ts:1215-1238`). The sample had accepted records and no failures, so the cookie file message is noisy metadata, not the cause of low-quality output.

The artifact count is internally defensible but poorly productized. `records.json` is the clean accepted-evidence dataset. `context.json` is a richer handoff payload. `meta.json` is raw diagnostics. `bundle-manifest.json` is lifecycle state written by the artifact bundle layer (`src/providers/artifacts.ts:133-152`). `summary.md` is currently the weakest file because it mixes compact ranking lines with a large raw metadata JSON block.

## Recommendations
1. Make `report.md` a decision-ready evidence briefing, not an evidence log. It should include evidence gate status, final answer, claim map, theme synthesis, source agreement or disagreement, confidence by claim, limitations, and recommendations.
2. Keep `records.json`, but demote it from the primary user-facing contract. It is useful for agents, tests, reproducibility, and audits because it contains only accepted records.
3. Move to two human-facing outputs, not two total files:
   - `report.md`: final evidence-gated synthesis.
   - `evidence.md` or `context.md`: human-readable audit trail with source ledger, candidate triage, rejected candidates, deep dives, extraction quality, diagnostics summary, and links to raw JSON.
4. Keep internal raw files for compatibility and lifecycle:
   - `records.json`: accepted evidence records.
   - `meta.json`: raw diagnostics and metrics.
   - `context.json`: structured handoff context, unless fully replaced by a structured evidence file.
   - `bundle-manifest.json`: TTL, cleanup, and file integrity.
5. Stop treating `summary.md` as a primary artifact. Either fold its useful compact ranking into `report.md` or replace it with the new evidence/audit file. Do not embed the full raw `meta` JSON in a user-facing markdown summary.
6. Fix rejected-candidate presentation. When a search-index record is rejected but its destination URL is fetched and accepted, render that as “search-index candidate rejected as final evidence; destination page accepted after follow-up fetch.”
7. Deduplicate cookie diagnostics in markdown by provider, source, policy, sourceRef, sessionEvidence, and message. Show one line with a count, such as “Missing cookie file observed 10 times under auto policy; non-blocking.” Keep raw per-attempt diagnostics in `meta.json`.
8. Be honest about deterministic synthesis limits. Without adding an LLM or paid API, runtime synthesis should be conservative: group evidence, extract repeated themes, cite accepted records, and identify limits. It should not invent broad conclusions unsupported by the accepted text.

## Preventive Measures
1. Add tests that assert `report.md` includes a final answer section, evidence gate status, claim map, confidence/limitations, and recommendations when accepted records exist.
2. Add tests for overlapped search-index rejection plus destination acceptance so future reports explain the distinction clearly.
3. Add tests that user-facing markdown deduplicates cookie diagnostics while `meta.json` preserves raw diagnostics.
4. Add a storage/output contract matrix for research artifacts that separates user-facing files from internal raw files.
5. Update `docs/CLI.md`, `skills/opendevbrowser-research/SKILL.md`, and the research report template together so the runtime contract and skill contract no longer disagree.
6. Keep bundle cleanup and lifecycle concerns tied to `bundle-manifest.json`; do not remove internal raw artifacts only to satisfy the two-output user-facing model.
