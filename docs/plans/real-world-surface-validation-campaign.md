# Real-World Surface Validation Campaign

Status: current fix pass verified
Branch: `codex/real-world-surface-validation`
Created: 2026-05-10

Latest secondary evidence:

- Targeted community/media secondary rerun: `.opendevbrowser/real-world-surface-validation/validation-secondary-community-media-runtime-fix.json`, `2` pass, `0` env-limited, `0` fail.
- Full secondary rerun: `.opendevbrowser/real-world-surface-validation/validation-secondary-final-owned-runtime-fix.json`, `15` pass, `2` expected manual annotation timeouts, `0` env-limited, `0` fail.
- Final release-gate secondary artifact: `.opendevbrowser/real-world-surface-validation/validation-secondary-final-owned-runtime-fix.json` with paired markdown `.opendevbrowser/real-world-surface-validation/validation-secondary-final-owned-runtime-fix.md`.
- The secondary matrix harness now owns daemon lifetime and recycles scenario-local dirty relay clients without treating ops-only control-plane clients as dirty. Community extension fallback now attaches with `startUrl`, verifies explicit extension URLs, and retries bounded relay attachment failures.

## Scope

Validate the implemented OpenDevBrowser public surface with real-world tasks before fixing confirmed defects.

Verified inventory from `src/public-surface/generated-manifest.json`:

- CLI commands: `77`
- OpenCode tools: `70`
- CLI-tool pairs: `67`
- CLI-only commands: `install`, `update`, `uninstall`, `help`, `version`, `serve`, `daemon`, `native`, `artifacts`, `rpc`
- Tool-only helpers: `opendevbrowser_prompting_guide`, `opendevbrowser_skill_list`, `opendevbrowser_skill_load`

## Classification Rules

Every non-pass result must include an artifact path, scenario id, owner file, and classification.

- `product_defect`: reproducible failure in OpenDevBrowser-owned code, docs, manifests, CLI, tool, daemon, or runtime behavior.
- `env_limited`: local environment lacks daemon, extension readiness, desktop permissions, native host, browser, or platform capability.
- `provider_limited`: external provider blocks, returns shell content, requires auth, changes markup, or withholds data.
- `challenge_required`: human verification, auth checkpoint, CAPTCHA-like flow, or protected challenge blocks automation.
- `expected_timeout`: manual or long-poll boundary times out in a scenario that explicitly allows timeout.
- `guarded`: intentionally unsafe or externally provisioned surface such as `rpc`, `native`, or remote CDP attach.
- `non_cli_tool_only`: tool intentionally has no CLI equivalent.
- `pass`: scenario completed within expected contract.

## Task 1 - Verify Public Surface Source Of Truth

Reasoning: The campaign must start from generated metadata, not stale estimates.
What to do: Confirm command, tool, pair, CLI-only, and tool-only counts.
How:
1. Read `src/public-surface/generated-manifest.json`.
2. Compare counts with `docs/SURFACE_REFERENCE.md` and `docs/CLI.md`.
3. Run manifest and help parity tests.
4. Record any stale count references as documentation defects.
Files impacted: `src/public-surface/generated-manifest.json`, `docs/SURFACE_REFERENCE.md`, `docs/CLI.md`, `tests/public-surface-manifest.test.ts`, `tests/cli-help-parity.test.ts`.
End goal: Establish the authoritative validation universe.
Acceptance criteria:
- [x] CLI command count is verified.
- [x] Tool count is verified.
- [x] CLI-tool pair count is verified.
- [x] CLI-only commands are listed.
- [x] Tool-only helpers are listed.
- [x] Static parity tests pass.

## Task 2 - Generate Campaign Inventory Artifacts

Reasoning: The campaign needs a reusable matrix so validation is tracked by scenario, mode, and owner file.
What to do: Generate machine-readable and Markdown workflow inventory artifacts.
How:
1. Run `node scripts/workflow-inventory-report.mjs --out .opendevbrowser/real-world-surface-validation/workflow-inventory.json --markdown-out .opendevbrowser/real-world-surface-validation/workflow-surface-map.md`.
2. Confirm every CLI command maps to a family.
3. Confirm every tool maps to a family.
4. Confirm every scenario has real-life tasks, owner files, execution policy, and allowed statuses.
Files impacted: `scripts/shared/workflow-inventory.mjs`, `scripts/workflow-inventory-report.mjs`, `.opendevbrowser/real-world-surface-validation/workflow-inventory.json`, `.opendevbrowser/real-world-surface-validation/workflow-surface-map.md`.
End goal: Produce the baseline validation map.
Acceptance criteria:
- [x] Inventory generation succeeds.
- [x] No CLI family metadata is missing.
- [x] No tool family metadata is missing.
- [x] Guarded and non-CLI surfaces are inventoried instead of falsely executed.

## Task 3 - Run Static Contract Gates

Reasoning: Live failures are easier to classify when public metadata, docs, and help contracts are already coherent.
What to do: Run static gates before live validation.
How:
1. Run `npm run build`.
2. Run `npm run lint`.
3. Run `npm run typecheck`.
4. Run `npm run test -- tests/public-surface-manifest.test.ts tests/cli-help-parity.test.ts tests/parity-matrix.test.ts tests/workflow-inventory.test.ts tests/workflow-validation-matrix.test.ts`.
Files impacted: `package.json`, `src/public-surface/source.ts`, `src/cli/help.ts`, `src/tools/index.ts`, selected tests.
End goal: Prove the current public surface is internally consistent.
Acceptance criteria:
- [x] Build passes.
- [x] Lint passes.
- [x] Typecheck passes.
- [x] Selected contract tests pass.

## Task 4 - Validate CLI Command Families With Real Tasks

Reasoning: Public CLI coverage must exercise realistic workflows, not only command startup.
What to do: Validate command families against the generated inventory.
How:
1. Run onboarding validation with `node scripts/cli-onboarding-smoke.mjs`.
2. Run managed low-level browser tasks that cover session lifecycle, navigation, refs, interactions, DOM reads, screenshots, screencasts, exports, and teardown.
3. Run workflow commands for research, shopping, product-video, inspiredesign, artifacts, and macro resolution.
4. Run desktop observation commands and classify permission or platform limits with evidence.
Files impacted: `scripts/cli-onboarding-smoke.mjs`, `scripts/cli-smoke-test.mjs`, `src/cli/**`, `.opendevbrowser/real-world-surface-validation/**`.
End goal: Validate practical CLI behavior across the full command family map.
Acceptance criteria:
- [x] Session lifecycle commands are exercised in the primary matrix.
- [x] Navigation and snapshot commands are exercised in the primary matrix.
- [x] Interaction and pointer commands are exercised in the primary matrix.
- [x] DOM and export commands are exercised in the primary matrix.
- [x] Diagnostics and replay commands are exercised in the primary matrix.
- [x] Workflow commands are exercised in the primary matrix.
- [x] Desktop commands pass or are classified with evidence.

## Task 5 - Validate OpenCode Tools With Real Tasks

Reasoning: Tools are a first-class public integration surface and must match CLI behavior where paired.
What to do: Validate tool registry presence, local-only helpers, and representative real tasks.
How:
1. Verify all `67` CLI-tool pairs exist in `createTools()`.
2. Verify `rpc` remains CLI-only and unsafe-gated.
3. Verify local-only helpers run without daemon bootstrap.
4. Execute tool-based browser tasks equivalent to CLI scenarios for launch, goto, snapshot, click/type, screenshot, screencast, desktop observation, workflows, and canvas.
Files impacted: `src/tools/index.ts`, `src/tools/**`, `tests/parity-matrix.test.ts`, `.opendevbrowser/real-world-surface-validation/**`.
End goal: Prove tool behavior is complete and intentionally divergent surfaces are documented.
Acceptance criteria:
- [x] All CLI-tool pairs exist.
- [x] Tool-only helpers pass locally.
- [x] `opendevbrowser_rpc` does not exist.
- [x] Representative paired tool tasks match CLI expectations.

## Task 6 - Validate Runtime Modes

Reasoning: Managed, extension, headless, headed, and CDP-connect modes have different promises and failure boundaries.
What to do: Run the same scenario shape across supported modes where applicable.
How:
1. Validate managed headless with `launch --no-extension --headless`.
2. Validate managed headed with `launch --no-extension`.
3. Validate extension mode with `launch --extension-only --wait-for-extension`.
4. Validate extension legacy CDP when extension readiness is available.
5. Validate CDP connect only when an external localhost debugging endpoint is intentionally provisioned.
6. Record extension-headless as expected unsupported behavior.
Files impacted: `src/cli/commands/session/launch.ts`, `src/cli/commands/session/connect.ts`, `src/tools/launch.ts`, `src/tools/connect.ts`, `docs/PARITY_DECLARED_DIVERGENCES.md`.
End goal: Confirm each mode works or fails with the correct classification.
Acceptance criteria:
- [x] Managed headless passes.
- [x] Managed headed passes.
- [x] Extension mode passes or is `env_limited`.
- [x] CDP connect passes or is guarded/env-limited.
- [x] Extension-headless returns the expected unsupported-mode boundary.

## Task 7 - Validate Interaction Planes

Reasoning: Browser use, browser helper, browser computer helper, desktop observation, canvas, annotation, `/ops`, `/canvas`, and `/cdp` must be tested as distinct planes.
What to do: Execute plane-specific real-world scenarios.
How:
1. Run `node scripts/live-regression-direct.mjs` for live plane coverage.
2. Validate canvas managed headless, managed headed, extension, and CDP scenarios where available.
3. Validate direct and relay annotation scenarios.
4. Validate browser-scoped computer-use helper paths through `--challenge-automation-mode browser` and `browser_with_helper`.
5. Validate desktop observation separately as read-only evidence, not as a desktop agent.
Files impacted: `scripts/live-regression-direct.mjs`, `src/canvas/**`, `src/annotate/**`, `src/desktop/**`, `src/providers/**`, `.opendevbrowser/real-world-surface-validation/**`.
End goal: Produce real evidence for every interaction plane.
Acceptance criteria:
- [x] Canvas planes pass or classify correctly in the primary matrix.
- [x] Annotation planes pass, timeout as expected, or classify correctly in the primary matrix.
- [x] Desktop observation passes or identifies missing permissions/platform support.
- [x] Browser helper and browser computer helper outcomes are evidence-backed for primary workflow and macro scenarios.

## Task 8 - Validate Provider Workflows

Reasoning: Workflows are the most realistic surface because they depend on current web behavior and provider constraints.
What to do: Run workflow matrix and direct provider harnesses.
How:
1. Run `node scripts/workflow-validation-matrix.mjs --variant primary --out .opendevbrowser/real-world-surface-validation/validation-primary.json --markdown-out .opendevbrowser/real-world-surface-validation/validation-primary.md`.
2. Run `node scripts/workflow-validation-matrix.mjs --variant secondary --out .opendevbrowser/real-world-surface-validation/validation-secondary.json --markdown-out .opendevbrowser/real-world-surface-validation/validation-secondary.md`.
3. Run `node scripts/provider-direct-runs.mjs --out .opendevbrowser/real-world-surface-validation/provider-direct-runs.json`.
4. Inspect report artifacts, not only exit codes.
Files impacted: `scripts/workflow-validation-matrix.mjs`, `scripts/provider-direct-runs.mjs`, `scripts/provider-live-scenarios.mjs`, `src/providers/**`, `.opendevbrowser/real-world-surface-validation/**`.
End goal: Validate research, shopping, product-video, inspiredesign, and macro workflows with live evidence.
Acceptance criteria:
- [x] Research workflows pass or classify provider limits in the primary matrix.
- [x] Shopping workflows pass or classify provider limits in the primary matrix.
- [x] Product-video workflows pass or classify provider/browser limits in the primary matrix.
- [x] Inspiredesign workflows pass or classify env/provider limits in the primary matrix.
- [x] Macro workflows pass or classify provider/challenge limits in the primary matrix.
- [x] Secondary matrix alternate low-level and workflow paths pass without dirty relay or shell-owned daemon contamination.

## Task 9 - Build The Defect Ledger

Reasoning: Fixes should be sequenced by evidence and owner file, not by run order.
What to do: Create a human-readable validation results ledger after the first full campaign pass.
How:
1. Group all non-pass results by owner file and public surface family.
2. Assign exactly one final classification to each result.
3. Identify product defects with reproduction commands and artifact paths.
4. Identify non-product outcomes with evidence and recommended follow-up.
Files impacted: new `docs/investigations/real-world-surface-validation-results.md`, `.opendevbrowser/real-world-surface-validation/**`.
End goal: Produce an actionable defect backlog.
Acceptance criteria:
- [x] Every non-pass result has an artifact path or an explicit no-artifact failure note.
- [x] Every non-pass result has a scenario id.
- [x] Every non-pass result has owner files.
- [x] Product defects have reproduction commands, if any are found.
- [x] Non-product outcomes have evidence for the primary matrix and direct provider run.

## Task 10 - Fix Confirmed Product Defects

Reasoning: Defects should be fixed only after their classification is proven by real-world evidence.
What to do: Fix confirmed product defects in dependency order.
How:
1. Fix manifest/help/registry defects first.
2. Fix argument parsing defects second.
3. Fix daemon/session lifecycle defects third.
4. Fix manager/tool parity defects fourth.
5. Fix workflow/provider product defects fifth.
6. Add regression tests for every fix.
7. Re-run the affected scenario before broad gates.
Files impacted: determined by defect ledger owner files.
End goal: Eliminate reproducible product defects without weakening intended guardrails.
Acceptance criteria:
- [x] Each fix maps to a confirmed `product_defect`.
- [x] Each fix includes regression tests.
- [x] No env-limited or provider-limited outcome is hidden by classification weakening.
- [x] Docs are updated when behavior or public surface changes.

## Task 11 - Close With Full Gates

Reasoning: The campaign is complete only when fixes, docs, tests, and real-world evidence agree.
What to do: Run final quality and live validation gates.
How:
1. Run `git diff --check`.
2. Run `npm run build`.
3. Run `npm run lint`.
4. Run `npm run typecheck`.
5. Run `npm run test`.
6. Re-run the workflow and live regression release-gate harnesses when relevant product defects were fixed.
Files impacted: all changed source, tests, docs, and evidence artifacts.
End goal: Produce a branch ready for review or PR.
Acceptance criteria:
- [x] Whitespace check passes.
- [x] Build passes.
- [x] Lint passes.
- [x] Typecheck passes.
- [x] Full tests pass.
- [x] Remaining non-pass real-world outcomes are explicitly non-product and documented.
