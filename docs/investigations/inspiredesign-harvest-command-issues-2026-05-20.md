# Inspiredesign Harvest Command Issues Investigation

Date: 2026-05-20

## Summary

Investigating problems observed while testing `inspiredesign harvest` with Pinterest for a fashion design studio landing-page prototype.

## Symptoms

- Query harvest returned `success:true` but `nextStepGuidance.readiness=diagnostic_only`.
- Query harvest used `social/pinterest`, discovered five Pinterest pin URLs, captured two viewport screenshots, failed three required visual captures, and produced zero ranked references.
- Explicit URL recovery using the two captured Pinterest pin URLs also returned `success:true`, captured two screenshots, and still produced zero ranked references.
- `--provider social/pinterest` with only `--url` and no `--query` failed with `--provider requires --query`.
- `ranked-references.json` reported `diagnosticOnlyReasons: ["interface_chrome_shell"]` and no ready references.
- Relative screenshot and screencast output paths from later prototype validation resolved under `~/.cache/opendevbrowser`, not the repo working directory.
- Generated guidance says to recover Pinterest evidence in an authenticated browser session, but the recovery command repeated the same blocked shape.

## Background / Prior Research

- Prior memory says Pinterest harvest is intentionally implemented as `inspiredesign harvest`, not a separate workflow.
- Prior memory says Pinterest should use browser-native logged-in navigation, extension mode, cookies, and the Pinterest search bar.
- Prior memory says motion references are a first-class requirement for this workflow family.

## Hypotheses

- H1: CLI validation has an avoidable command-shape mismatch for URL-only recovery with provider context.
- H2: Pinterest evidence classification is too strict or too coarse, causing captured pin screenshots to be rejected as `interface_chrome_shell`.
- H3: The workflow conflates command success with readiness, making non-actionable harvests look successful unless callers inspect `nextStepGuidance`.
- H4: Recovery guidance reruns the same query harvest without changing enough state to recover from diagnostic-only Pinterest results.
- H5: Relative output path resolution is inconsistent with user expectations for workspace-local artifacts.

## Investigator Findings

### Root causes

1. `--provider social/pinterest --url ...` without `--query` fails before the workflow can use the explicit URLs. The CLI rejects any provider when `parsed.query` is absent, then separately allows harvest with query or URL, so provider-aware URL recovery is blocked by ordering and policy, not by URL support itself. Evidence: `src/cli/commands/inspiredesign.ts:265-270`. The daemon workflow repeats the same restriction, so direct RPC would still reject the shape even if the CLI were relaxed. Evidence: `src/providers/workflows.ts:1706-1717`. Existing tests lock in this behavior for providers without query. Evidence: `tests/cli-workflows.test.ts:580-587`.

2. The validation rule conflicts with Pinterest recovery guidance. The Pinterest recipe explicitly lists an `explicit-url` recovery step for blocked search. Evidence: `src/guidance/recipes/pinterest.ts:164-167`. Generic recovery examples also tell users to use explicit reference URLs when provider discovery is blocked. Evidence: `src/guidance/recipes/generic.ts:410-423`. But the primary recovery command builder always emits `--query ... --provider ...`, never URL-first recovery. Evidence: `src/guidance/recipes/generic.ts:62-73`.

3. Captured Pinterest PNGs can still rank zero references by design when the textual evidence is interface chrome. The run artifacts show captured screenshots for two query-harvest pins and all two explicit-URL pins, yet both ranked outputs report `rankedReferenceCount: 0` and `diagnosticOnlyReasons: ["interface_chrome_shell"]`. Evidence: `.opendevbrowser/inspiredesign/9716bed8-cb7a-4970-bb4d-e54f713263cb/visual-evidence.json:131-149`, `.opendevbrowser/inspiredesign/9716bed8-cb7a-4970-bb4d-e54f713263cb/ranked-references.json:2-14`, `.opendevbrowser/inspiredesign/095ae735-864c-45c2-8096-f50a57e78bf6/visual-evidence.json:90-143`, `.opendevbrowser/inspiredesign/095ae735-864c-45c2-8096-f50a57e78bf6/ranked-references.json:2-14`.

4. The classifier rejects interface chrome before ranking unless the Pinterest-specific exception applies. `diagnosticPageReasons()` emits `interface_chrome_shell` from chrome markers, `hasPinterestVisualMetadataEvidence()` only allows captured Pinterest visuals when clean metadata exists and diagnostics are only soft Pinterest chrome, and `hasInspiredesignUsableReferenceEvidence()` returns false for blocking diagnostic reasons. Evidence: `src/inspiredesign/reference-pattern-board.ts:274-321`, `src/inspiredesign/reference-pattern-board.ts:424-447`, `src/inspiredesign/reference-pattern-board.ts:464-477`. Tests confirm both sides: chrome-only Pinterest screenshots are rejected, while clean screenshot-backed Pinterest metadata can remain usable. Evidence: `tests/providers-inspiredesign-contract.test.ts:1209-1254`, `tests/providers-inspiredesign-contract.test.ts:1256-1294`, `tests/providers-inspiredesign-contract.test.ts:1360-1378`.

5. `diagnostic_only` readiness is an intentional gate, not a capture failure by itself. The guidance source forwards ranked counts and diagnostic-only reasons into the readiness context. Evidence: `src/providers/workflows.ts:2897-2934`, `src/guidance/context.ts:119-126`, `src/guidance/context.ts:149-177`. Readiness becomes `diagnostic_only` when diagnostic reasons exist and ranked count is zero. Evidence: `src/guidance/readiness.ts:12-16`, `src/guidance/readiness.ts:48-57`. Workflow tests reproduce Pinterest accepted URLs plus zero ranked references and require `readiness: "diagnostic_only"`. Evidence: `tests/providers-inspiredesign-workflow.test.ts:2160-2186`.

6. `success:true` is a wrapper-level command contract, not design readiness. After `callDaemon("inspiredesign.run", ...)` returns, the CLI always wraps the daemon response as `{ success: true, message, data }`. Evidence: `src/cli/commands/inspiredesign.ts:276-293`. Actual readiness is nested in `data.meta.nextStepGuidance`, which the workflow constructs after ranking and guidance routing. Evidence: `src/providers/workflows.ts:4401-4420`. Current docs already describe readiness as the gate between artifact completion and design readiness. Evidence: `docs/CLI.md:574-577`, `docs/SURFACE_REFERENCE.md:555-556`.

7. Repeated failed recovery shape is caused by generic command generation, not by the Pinterest recipe registry. Pinterest is correctly registered as a site recipe for provider IDs and URLs. Evidence: `src/guidance/recipes/site-registry.ts:14-37`. The high-priority Pinterest guidance recipe routes non-ready Pinterest contexts to browser-native recovery. Evidence: `src/guidance/recipes/generic.ts:558-572`. But it still calls the generic recovery builder, whose only command is `inspiredesignHarvestCommand(context)`, so the emitted command repeats query/provider search rather than explicit URLs. Evidence: `src/guidance/recipes/generic.ts:398-409`, `src/guidance/recipes/generic.ts:62-73`.

8. Relative screenshot and replay output behavior is separate from harvest output. Harvest workflow output resolves relative `--output-dir` at the CLI using `path.resolve(value)`, with `.opendevbrowser` as the default. Evidence: `src/cli/commands/workflow-output.ts:1-13`, `src/providers/workflow-output-root.ts:3-17`. Browser screenshots pass `--path` through unchanged to the daemon and browser manager. Evidence: `src/cli/commands/devtools/screenshot.ts:36-49`, `src/browser/browser-manager.ts:2012-2057`, `src/browser/ops-browser-manager.ts:911-913`. Screencast output resolves relative `--output-dir` against the browser manager `worktree`, not the caller cwd. Evidence: `src/cli/commands/devtools/screencast-start.ts:39-52`, `src/browser/browser-manager.ts:445-463`, `src/browser/browser-manager.ts:2071-2079`, `src/browser/screencast-recorder.ts:104-116`.

### Eliminated hypotheses

- Pinterest discovery is not accidentally using a standard social provider. `social/pinterest` resolves to the Pinterest site recipe and runs browser-native search through `runBrowserNativeDiscovery()`. Evidence: `src/providers/workflows.ts:1989-2027`, `src/guidance/recipes/pinterest.ts:143-174`.
- Zero ranked references do not mean screenshots were absent. The saved artifacts contain screenshot entries while ranked outputs still show `interface_chrome_shell`. Evidence: `.opendevbrowser/inspiredesign/9716bed8-cb7a-4970-bb4d-e54f713263cb/screenshot-index.json:1-22`, `.opendevbrowser/inspiredesign/095ae735-864c-45c2-8096-f50a57e78bf6/evidence.json:292-344`.
- `success:true` is not currently a command-level crash bug. It is misleading only if callers treat wrapper success as readiness. Evidence: `src/cli/commands/inspiredesign.ts:289-293`, `docs/CLI.md:574-577`.
- Relative output path surprises are not harvest-specific. Harvest workflow paths and screenshot/screencast browser paths use different resolution layers. Evidence: `src/cli/commands/workflow-output.ts:5-13`, `src/browser/screencast-recorder.ts:104-116`.

### Recommended fixes

1. Relax provider-without-query validation only for explicit URL recovery when all requested providers resolve to site recipes compatible with the supplied URLs. Update both `src/cli/commands/inspiredesign.ts:265-270` and `src/providers/workflows.ts:1706-1717`. Add tests replacing or narrowing `tests/cli-workflows.test.ts:580-587`.

2. Make Pinterest recovery command generation URL-aware. In `src/guidance/recipes/generic.ts:62-73` and `src/guidance/recipes/generic.ts:398-423`, prefer repeated `--url` commands when context has Pinterest URLs, accepted URL diagnostics, or explicit URL recovery guidance. Only include `--provider social/pinterest` after validation supports provider-scoped URL recovery.

3. Keep strict `interface_chrome_shell` blocking, but improve diagnostics. `ranked-references.json` or guidance should explain that screenshots were captured but rejected because only interface chrome survived classification. Relevant source: `src/inspiredesign/reference-pattern-board.ts:274-321`, `src/inspiredesign/reference-pattern-board.ts:464-477`, `src/inspiredesign/contract.ts:2096-2134`.

4. Surface readiness beside wrapper success for CLI users. Keep `success:true` as transport completion if needed, but add top-level `readiness` or improve `message` in `src/cli/commands/inspiredesign.ts:289-293` using `data.meta.nextStepGuidance.readiness` from `src/providers/workflows.ts:4401-4420`.

5. Normalize or document browser output paths separately from workflow paths. For best CLI UX, resolve screenshot `--path` and screencast `--output-dir` in `src/cli/commands/devtools/screenshot.ts:36-49` and `src/cli/commands/devtools/screencast-start.ts:39-52` before daemon dispatch. If preserving current behavior, document that screencast relative output binds to browser manager `worktree`, unlike workflow `--output-dir`.

## Root Cause Analysis

The core problem is not one failure. It is a contract mismatch between three layers:

- The harvest command supports URL-only runs, but provider-scoped URL recovery is rejected by both CLI and workflow validation.
- Pinterest recovery guidance tells users to recover in a browser-native authenticated session and mentions explicit URLs, but the generated primary command repeats query/provider discovery.
- The workflow correctly refuses Canvas/design continuation when ranking sees only diagnostic Pinterest chrome, but the top-level command still reports wrapper success.

That means the tool is safe, but not clear enough. It avoids turning bad Pinterest captures into design input, yet its command examples and success envelope make the recovery path harder to follow.

## Final Recommended Fix Order

1. Fix validation for site-recipe URL recovery in `src/cli/commands/inspiredesign.ts` and `src/providers/workflows.ts`.
2. Make Pinterest recovery command generation URL-aware in `src/guidance/recipes/generic.ts`.
3. Add top-level readiness or message wording in `src/cli/commands/inspiredesign.ts` so `success:true` cannot be mistaken for design readiness.
4. Improve ranked-reference diagnostics so captured-but-rejected screenshots explain the exact evidence gap.
5. Normalize or document screenshot and screencast relative output path behavior separately from workflow artifact output.

## Evidence Appendix

Primary local run artifacts:

- `.opendevbrowser/tool-evaluation/fashion-studio-motion/harvest-result.json`
- `.opendevbrowser/tool-evaluation/fashion-studio-motion/harvest-recovery-result.json`
- `.opendevbrowser/inspiredesign/9716bed8-cb7a-4970-bb4d-e54f713263cb`
- `.opendevbrowser/inspiredesign/095ae735-864c-45c2-8096-f50a57e78bf6`

RepoPrompt investigation artifacts:

- `prompt-exports/oracle-question-2026-05-20-232424-harvest-issues-b2c9f-dd92.md`
- Pair investigator session: `24E46849-D017-4F78-B674-0976DD465DBA`
