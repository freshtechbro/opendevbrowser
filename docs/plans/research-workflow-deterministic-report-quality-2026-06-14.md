# Research Workflow Deterministic Report Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` for multi-agent execution, or `superpowers:executing-plans` for inline execution. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make research workflow `report.md` a deterministic, decision-ready evidence briefing that an agent can use directly, while preserving current collection, ranking, artifact, and CLI/tool contracts.

**Architecture:** Add a pure deterministic briefing compiler at the renderer seam. It consumes already accepted records and existing metadata, produces traceable claims and confidence, then renders conservative markdown without a paid API, hidden LLM step, or provider-collection rewrite.

**Tech Stack:** TypeScript, Vitest, OpenDevBrowser provider workflows, project-local `.opendevbrowser` artifacts, existing research CLI/tool contracts.

---

## Decisions
- Preserve collection behavior. Do not change `research-compiler.ts`, `research-executor.ts`, provider search/fetch behavior, sanitization, ranking, or timebox filtering except where tests expose a direct report-output defect.
- Preserve CLI and OpenCode tool behavior. Do not change `src/cli/commands/research.ts` or `src/tools/research_run.ts` unless docs and tests prove a contract mismatch.
- Preserve the existing artifact file list: `summary.md`, `report.md`, `records.json`, `context.json`, `meta.json`, and `bundle-manifest.json`.
- Defer a new `evidence.md` file and defer `context.json.briefing`. Improve `report.md` first, keep raw JSON artifacts unchanged, and avoid machine-readable artifact-shape churn in this implementation.
- Use deterministic extraction and templating only. The runtime may group themes, select passages, score confidence, detect explicit disagreement cues, and generate conservative fixed-template claims. It must not claim unrestricted expert interpretation.
- Every claim in `report.md` must trace to accepted record IDs, source URLs, selected passages, named thresholds, or deterministic diagnostics.

## Background
- The investigation confirms the root gap is missing claim-level synthesis, not missing fetched evidence. Existing records carry `content`, `title`, `url`, provider/source, timestamp, confidence, and attributes through `NormalizedRecord` at `src/providers/types.ts:180`.
- Web fetch stores extracted text and extraction quality metadata, so the report can use richer page content than the current 240-character excerpt path.
- `runResearchWorkflow()` already merges search and follow-up records, sanitizes shell records, filters by timebox, enriches, dedupes, ranks, assembles diagnostics, then calls `renderResearch()` at `src/providers/workflows.ts:5628`.
- Timebox behavior already exists and should be surfaced, not rewritten. CLI accepts `--days`, `--from`, and `--to`; provider workflow filtering runs through `filterByTimebox()` at `src/providers/workflows.ts:5546`.
- The primary implementation seam is `src/providers/renderer.ts`. Current limits and artifact names are defined near `src/providers/renderer.ts:216`; `buildResearchReport()` starts at `src/providers/renderer.ts:864`; `renderResearch()` writes the artifact files starting at `src/providers/renderer.ts:900`.
- `researchContextPayload()` at `src/providers/renderer.ts:818` is already a structured handoff payload and can receive the compiled briefing if that avoids divergent report/context logic.
- `researchFindingsLines()` at `src/providers/renderer.ts:603` currently renders each finding as metadata plus a truncated evidence excerpt, which is why output reads like an evidence log.
- Existing artifact tests lock the raw artifact contract. `RESEARCH_ARTIFACT_FILES` includes `summary.md`, `report.md`, `records.json`, `context.json`, `meta.json`, and `bundle-manifest.json` in `tests/providers-artifacts-workflows.test.ts:36`.
- Search-index rejections are valid per record, but confusing in presentation. Search-index records are sanitized out in `src/providers/workflows.ts:5298`, while destination follow-up fetch URLs are derived separately in `src/providers/research-executor.ts:118`.
- The research skill template already expects `Evidence Gate Status`, `Claim Map`, confidence, provider constraints, synthesis feedback, and final answer in `skills/opendevbrowser-research/assets/templates/report.md:5`.
- Cookie diagnostics under default `auto` policy can be non-fatal and repeated. Deduplicate user-facing markdown while preserving raw diagnostics in `meta.json`.

## Deterministic Contracts
- Metadata view model: build one defensive adapter from `meta` to `ResearchBriefingMetaView` with `timebox`, `sourceSelection`, `totalRecords`, `withinTimebox`, `finalRecords`, `failedSources`, `rejectedCandidateCount`, `sanitizedReasonDistribution`, `cookieDiagnostics`, `challengeDiagnostics`, `antiBotPressure`, `transcriptDurability`, and `alerts`. Missing numbers default to `0`, missing arrays default to `[]`, missing objects default to `{}`, and malformed entries are ignored with a limitation line.
- Evidence gate constants: `MIN_PARTIAL_ACCEPTED_RECORDS = 1`, `MIN_PASS_ACCEPTED_RECORDS = 3`, `MIN_PASS_INDEPENDENT_DOMAINS = 2`, `MIN_USABLE_CONTENT_CHARS = 500`, `MAX_PASS_REJECTION_PRESSURE = 0.6`, and `MAX_PARTIAL_REJECTION_PRESSURE = 0.85`. These values are initial defaults and must be named constants with tests.
- Evidence gate rules: `fail` when accepted records are below partial threshold or all accepted content is below usable content threshold; `partial` when records exist but pass thresholds are not met or blocking diagnostics exist; `pass` when pass thresholds are met and no blocking diagnostics are present.
- Confidence score rules: start at `0`; add `2` for at least two supporting records, `2` for at least two independent domains, `1` for average extraction content at or above `MIN_USABLE_CONTENT_CHARS`, `1` for average source confidence at or above `0.7`, and `1` when supporting records are inside the resolved timebox. Subtract `1` for explicit disagreement cues, `1` for provider failures, and `1` when rejection pressure exceeds `MAX_PASS_REJECTION_PRESSURE`. Label `high` at `6+`, `medium` at `3-5`, and `low` below `3`.
- Search-index overlap rules: canonicalize candidate and accepted URLs with the existing `canonicalizeUrl` helper, unwrap DuckDuckGo `uddg` redirects the same way follow-up fetch candidate resolution does, and only report destination acceptance when a rejected `search_index_shell` canonical URL exactly matches an accepted destination record canonical URL.
- Audit placement: keep accepted source URLs, selected passages, rejected-candidate summary, diagnostics summary, and artifact paths in a final `Evidence Appendix` section inside `report.md`. Do not add `evidence.md` or new `context.json` fields in this implementation.

## File Structure
- Create `src/providers/research-report/index.ts` as the public module export used by `renderer.ts`.
- Create `src/providers/research-report/types.ts` for report-specific types and the `ResearchBriefingMetaView`.
- Create `src/providers/research-report/rules.ts` for named thresholds, stopwords, disagreement cues, text normalization, metadata adapters, URL canonicalization helpers, and diagnostic dedupe. Split this file before it crosses project complexity limits.
- Create `src/providers/research-report/synthesis.ts` for evidence gate, passage selection, theme synthesis, claim-map generation, disagreement detection, confidence scoring, final answer lines, limitations, and recommendations.
- Create `src/providers/research-report/render.ts` for markdown section rendering in the required order plus the final `Evidence Appendix`.
- Modify `src/providers/renderer.ts` only enough to call the new compiler/renderer and preserve existing artifact file assembly.
- Add `tests/providers-research-report.test.ts` for direct deterministic compiler and renderer tests.
- Extend `tests/providers-artifacts-workflows.test.ts` and `tests/providers-workflows-branches.test.ts` only for workflow-level artifact, sanitization, timebox, provider-limited, and follow-up fetch coverage.

## Implementation Tasks

## Task 1 - Lock The Current And Target Contracts
Reasoning: The change must improve output quality without drifting collection, artifact, or CLI behavior.
What to do: Add failing tests that describe the new report contract before source changes.
How:
1. Read the current successful research artifact tests around `RESEARCH_ARTIFACT_FILES` and `report.md` assertions.
2. Add direct tests in new `tests/providers-research-report.test.ts` for required heading order: `Evidence Gate Status`, `Final Answer`, `Claim Map`, `Theme Synthesis`, `Source Agreement or Disagreement`, `Confidence by Claim`, `Limitations`, and `Recommendations`.
3. Add fixture records with distinct domains, content-rich bodies, timestamps inside a recent timebox, source confidence, `attributes.retrievalPath`, and `attributes.extractionQuality`.
4. Add workflow-level expectations that the research artifact file list remains unchanged.
5. Run the new focused tests and verify they fail only because the new module/report behavior does not exist yet.
Files impacted:
- `tests/providers-research-report.test.ts` (new)
- `tests/providers-artifacts-workflows.test.ts`
- `tests/providers-workflows-branches.test.ts`
Acceptance criteria:
- [ ] Failing tests prove `report.md` must include the required sections in order.
- [ ] Tests assert raw artifact file names stay unchanged.
- [ ] Tests use deterministic fixture content, not generic placeholder text.
- [ ] Focused test failure is specific to the missing deterministic report behavior.

## Task 2 - Add The Pure Research Briefing Module
Reasoning: `renderer.ts` is already large and artifact-oriented. A focused pure module keeps synthesis testable and avoids growing a boundary function.
What to do: Implement the new `src/providers/research-report/` module with types, named thresholds, text utilities, evidence readers, synthesis logic, and markdown rendering.
How:
1. Define report types in `types.ts`: gate status `pass|partial|fail`, claim status `accepted|tentative|excluded`, confidence label `high|medium|low`, passage, theme, claim, evidence gate, limitation, recommendation, full briefing, and `ResearchBriefingMetaView`.
2. Define thresholds and cues in `rules.ts` using the values listed in `Deterministic Contracts`.
3. Build `rules.ts` helpers for normalized text, tokenization, stopword filtering, sentence splitting, stable sort keys, metadata view parsing, diagnostic dedupe, and canonical URL matching.
4. Build `synthesis.ts` to select representative passages, group themes by source/domain support, generate fixed-template claims, detect explicit disagreement cues, score confidence, produce conservative final answer lines, and generate limitations/recommendations.
5. Build `render.ts` so markdown is generated from the structured briefing, not directly from raw records.
6. Export `buildResearchBriefing()` and `renderResearchBriefingMarkdown()` from `index.ts`.
Files impacted:
- `src/providers/research-report/index.ts` (new)
- `src/providers/research-report/types.ts` (new)
- `src/providers/research-report/rules.ts` (new)
- `src/providers/research-report/synthesis.ts` (new)
- `src/providers/research-report/render.ts` (new)
Acceptance criteria:
- [ ] Module functions are pure and deterministic: no filesystem, network, time, randomness, provider calls, or LLM calls.
- [ ] Numeric thresholds are named constants.
- [ ] Every claim includes supporting accepted record IDs and URLs.
- [ ] Disagreement is reported only from explicit cue detection, otherwise the report says no direct disagreement was detected.
- [ ] No file exceeds project complexity limits; split further before any file becomes too large.

## Task 3 - Implement Evidence Gate, Diagnostics, And Timebox Briefing
Reasoning: The first thing an agent needs is whether the evidence is usable, constrained, or insufficient.
What to do: Make the briefing compiler produce evidence gate status, diagnostic summaries, timebox status, limitations, and deterministic next actions.
How:
1. Compute `pass`, `partial`, or `fail` using the exact thresholds and rules in `Deterministic Contracts`.
2. Include a gate criteria table or bullet list in `report.md` with the named threshold values used.
3. Deduplicate cookie diagnostics for markdown by provider, source, policy, sourceRef, sessionEvidence, and message. Include a count and non-blocking or blocking classification.
4. Keep raw per-attempt diagnostics in `meta.json`; do not mutate metadata.
5. Generate limitations from source diversity, extraction quality, stale or out-of-timebox records, rejected shells, provider failures, cookie requirements, challenge pressure, and timeout or transcript durability signals.
6. Generate recommendations from the limitations using deterministic templates, such as rerun with a narrower recent timebox, add a source family, use authorized extension mode, or inspect a named accepted source.
Files impacted:
- `src/providers/research-report/rules.ts`
- `src/providers/research-report/synthesis.ts`
- `src/providers/research-report/render.ts`
- `tests/providers-research-report.test.ts`
- `tests/providers-workflows-branches.test.ts`
Acceptance criteria:
- [ ] Tests cover pass, partial, and fail gate branches.
- [ ] Tests prove duplicate cookie diagnostics collapse in `report.md` while `meta.json` still contains raw diagnostics.
- [ ] Tests prove recent/timebox state is surfaced in the report and old records do not support claims.
- [ ] Gate failure renders no unsupported final answer; it renders limitations and next steps.

## Task 4 - Implement Claim, Theme, Confidence, And Final Answer Synthesis
Reasoning: The current report has accepted records but little synthesis. The implementation should produce agent-ready structure without inventing facts.
What to do: Build deterministic passage selection, theme grouping, templated claims, confidence labels, agreement or disagreement, and final answer lines.
How:
1. Extract passages from accepted record content, not just titles or snippets. Score by topic overlap, title overlap, source confidence, extraction quality, recency/timebox fit, and source diversity.
2. Build theme candidates from deterministic phrase extraction after stopword filtering. Promote themes only when they appear in accepted passages or strong topic/title overlap.
3. Generate claims from fixed templates, for example: `Accepted evidence supports {theme} as a recurring point across {source_count} independent sources.`
4. Mark single-source claims as tentative and unsupported/no-evidence claims as excluded.
5. Score claim confidence from source coverage, independent domains, extraction quality, source confidence, disagreement cues, failures, and rejection pressure.
6. Render `Final Answer` from accepted and tentative claims using conservative language such as `The accepted evidence supports...` and `Evidence is insufficient for...`.
Files impacted:
- `src/providers/research-report/rules.ts`
- `src/providers/research-report/synthesis.ts`
- `src/providers/research-report/render.ts`
- `tests/providers-research-report.test.ts`
Acceptance criteria:
- [ ] Tests prove `Theme Synthesis` uses accepted record content.
- [ ] Tests prove claim map rows include status, confidence, record IDs, source URLs, and support notes.
- [ ] Tests prove confidence labels change when source diversity or diagnostics change.
- [ ] Tests prove direct disagreement cue detection renders a disagreement note.
- [ ] Tests prove absence of disagreement does not overstate source agreement.

## Task 5 - Integrate With `renderResearch()` Without Artifact Drift
Reasoning: The renderer is the correct seam, but artifact paths and response modes must stay stable.
What to do: Wire the deterministic report into `src/providers/renderer.ts` and preserve existing artifact assembly.
How:
1. Import `buildResearchBriefing()` and `renderResearchBriefingMarkdown()` from the new module.
2. In `buildResearchReport()` or directly inside `renderResearch()`, build the briefing from `topic`, accepted `records`, and `meta`.
3. Replace the old evidence-log report body with the deterministic report markdown.
4. Keep `summary.md`, `records.json`, `meta.json`, and `bundle-manifest.json` behavior unchanged.
5. Do not add `briefing` to `context.json` in this implementation. Keep machine-readable artifact shapes stable.
6. Remove old report-only helpers only when no longer referenced by `summary.md`, `context.json`, or other workflows.
Files impacted:
- `src/providers/renderer.ts`
- `src/providers/research-report/index.ts`
- `src/providers/research-report/render.ts`
- `tests/providers-artifacts-workflows.test.ts`
Acceptance criteria:
- [ ] Generated `report.md` uses the required section order.
- [ ] Existing response modes `compact`, `json`, `md`, `context`, and `path` still work.
- [ ] Existing artifact file list stays unchanged.
- [ ] No search, fetch, timebox, ranking, CLI, or OpenCode tool behavior changes.

## Task 6 - Fix Rejected Candidate And Search-Index Presentation
Reasoning: The sample showed valid search-index rejection that looked contradictory because accepted destination fetches were not linked back.
What to do: Render search-index candidate rejection and destination acceptance as a clear, non-contradictory triage outcome.
How:
1. Detect rejected candidates with `reason: search_index_shell` and a URL that canonicalizes exactly to an accepted destination record after existing URL canonicalization and DuckDuckGo redirect unwrapping.
2. Render this as `Search-index candidate rejected as final evidence; destination page accepted after follow-up fetch`.
3. Include accepted record ID and URL when available.
4. Preserve shell rejection and follow-up fetch logic. Do not weaken sanitization.
5. Add workflow-level tests around existing follow-up fetch scenarios.
Files impacted:
- `src/providers/research-report/rules.ts`
- `src/providers/research-report/render.ts`
- `tests/providers-artifacts-workflows.test.ts`
Acceptance criteria:
- [ ] Tests prove overlapping rejected search-index URLs and accepted destination URLs are explained.
- [ ] Tests prove shell-only records remain rejected and do not support final claims.
- [ ] Report wording distinguishes record-level rejection from URL-level destination acceptance.

## Task 7 - Update Docs And Research Skill Surfaces
Reasoning: The runtime report, CLI docs, and skill template currently disagree. A behavior change without doc sync will recreate user confusion.
What to do: Update docs and skill surfaces after source behavior is implemented and tested.
How:
1. Update `docs/CLI.md` research notes to describe `report.md` as a deterministic evidence briefing and raw JSON files as the audit trail.
2. Keep the documented artifact file list unchanged.
3. Update `skills/opendevbrowser-research/SKILL.md` so the skill still requires source planning and evidence review, but no longer says runtime report is only a low-level evidence log.
4. Update `skills/opendevbrowser-research/assets/templates/report.md` to match the generated section order and wording.
5. Update `skills/opendevbrowser-research/artifacts/research-workflows.md` to make `report.md` the primary briefing and `records.json`, `context.json`, and `meta.json` the audit sources.
6. Regenerate public surface manifests only if generated docs or public-surface source changed.
Files impacted:
- `docs/CLI.md`
- `skills/opendevbrowser-research/SKILL.md`
- `skills/opendevbrowser-research/assets/templates/report.md`
- `skills/opendevbrowser-research/artifacts/research-workflows.md`
- `src/public-surface/generated-manifest.ts` and `src/public-surface/generated-manifest.json` only if required by docs tooling
Acceptance criteria:
- [ ] Docs no longer describe `report.md` as just a bounded inline subset.
- [ ] Skill template and runtime report sections align.
- [ ] Docs still instruct users to inspect raw artifacts for audit and publication-sensitive claims.
- [ ] `node scripts/docs-drift-check.mjs` passes.

## Task 8 - Validate With Real Workflow Runs And Review Loop
Reasoning: Passing unit tests is not enough. The output must be clean, recent, non-generic, and useful to an agent.
What to do: Run focused tests, branch-deficit checks, real workflow validation, adversarial review, and full gates before any PR.
How:
1. Run focused tests first:
   ```bash
   npm run test -- tests/providers-research-report.test.ts
   npm run test -- tests/providers-artifacts-workflows.test.ts tests/providers-workflows-branches.test.ts
   ```
2. Recompute branch coverage deficit before broad coverage:
   ```bash
   npm run test -- tests/providers-research-report.test.ts tests/providers-artifacts-workflows.test.ts tests/providers-workflows-branches.test.ts
   node -e "const fs=require('fs'); const text=fs.readFileSync('coverage/lcov.info','utf8'); const br=(text.match(/^BRF:/gm)||[]).length; const hit=(text.match(/^BRH:/gm)||[]).length; console.log({branches:br, coveredBranches:hit, deficit:br-hit});"
   ```
3. Run full gates only after branch deficit is understood and new branches are covered:
   ```bash
   npm run lint
   npm run typecheck
   npm run build
   npm run extension:build
   npm run test
   ```
4. Before daemon-backed real workflow validation, run:
   ```bash
   node dist/cli/index.js status --daemon --output-format json
   ```
   Continue only when `data.fingerprintCurrent === true`.
5. Run an actual recent research workflow:
   ```bash
   node dist/cli/index.js research run \
     --topic "deterministic research report quality in browser automation tools" \
     --days 14 \
     --sources web \
     --browser-mode managed \
     --mode path \
     --output-format json
   ```
6. Open the generated `.opendevbrowser/research/<run-id>/report.md` and verify it is non-generic, cites accepted sources, includes the required sections, and reflects the recent timebox.
7. Run a scoped adversarial review with RepoPrompt `/Review` or a design/pair review agent. Scope the review to `src/providers/research-report/`, `src/providers/renderer.ts`, touched tests, docs, and the generated real-run report.
8. Fix review findings, rerun focused tests, rerun the real workflow if report rendering changed, then rerun full gates.
Files impacted:
- Source, tests, docs from prior tasks
- Generated validation artifact under `.opendevbrowser/research/<run-id>/`
- Local ignored coverage and build output
Acceptance criteria:
- [ ] Real workflow `report.md` is clean, structured, recent, non-generic, and traceable to accepted records.
- [ ] Report does not end as diagnostics-only when accepted records exist.
- [ ] Branch coverage deficit is checked before full coverage.
- [ ] Lint, typecheck, build, extension build, and full test coverage pass.
- [ ] Scoped review loop is completed and all real findings are fixed.

## Multi-Agent Execution Plan
- Agent A, report compiler: owns `src/providers/research-report/` and direct compiler tests.
- Agent B, renderer/workflow integration: owns `src/providers/renderer.ts` and workflow artifact tests.
- Agent C, docs and skill sync: owns `docs/CLI.md` and `skills/opendevbrowser-research/**`.
- Agent D, adversarial reviewer: reviews only the changed files plus generated validation `report.md`.
- The orchestrator owns task sequencing, branch coverage deficit checks, real workflow validation, final staged diff review, and commits.
- Agents must not edit `CONTINUITY.md` or `sub_continuity.md`; sub-agents should append findings to `sub_continuity.md` only if the execution workflow requires it.
- If the implementation stays small after Task 1, the orchestrator may keep source work inline and use Agent D only for adversarial review. The multi-agent split is recommended for speed, not permission to create process churn.

## Atomic Commit Plan
Commit only after the relevant focused tests pass and staged diffs are reviewed.

1. `feat: add deterministic research report briefing`
   - Include the pure report module, renderer integration, and direct source tests needed for the compiler behavior.
   - Commit message must include `Co-authored-by: Codex <noreply@openai.com>`.

2. `test: cover research report workflow contracts`
   - Include workflow artifact tests for report section order, timebox surfacing, search-index overlap explanation, cookie diagnostic dedupe, and artifact file-list preservation.
   - Commit message must include `Co-authored-by: Codex <noreply@openai.com>`.

3. `docs: align research report contract`
   - Include CLI docs, research skill, report template, and research workflow artifact guidance.
   - Commit message must include `Co-authored-by: Codex <noreply@openai.com>`.

4. Optional `chore: record research report validation`
   - Use only if validation notes or plan updates are committed after implementation.
   - Include real workflow artifact path, branch coverage evidence, and review-loop outcome in the relevant docs or PR body.
   - Commit message must include `Co-authored-by: Codex <noreply@openai.com>`.

## Open Questions
- None blocking for implementation. The new `evidence.md` artifact remains deferred unless a later product decision explicitly changes the artifact contract.

## References
- Investigation: `docs/investigations/research-workflow-output-quality-2026-06-14.md`
- Runtime report renderer: `src/providers/renderer.ts`
- Research workflow orchestration: `src/providers/workflows.ts`
- Research execution and follow-up fetch: `src/providers/research-executor.ts`
- Research compiler and timebox plan: `src/providers/research-compiler.ts`
- Provider record type: `src/providers/types.ts`
- Research CLI command: `src/cli/commands/research.ts`
- Research OpenCode tool: `src/tools/research_run.ts`
- Artifact workflow tests: `tests/providers-artifacts-workflows.test.ts`
- Branch workflow tests: `tests/providers-workflows-branches.test.ts`
- CLI docs: `docs/CLI.md`
- Research skill: `skills/opendevbrowser-research/SKILL.md`
- Report template: `skills/opendevbrowser-research/assets/templates/report.md`
