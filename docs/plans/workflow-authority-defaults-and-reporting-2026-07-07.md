---
title: Workflow Authority Defaults and Reporting
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
created: 2026-07-07
product_contract_source: ce-plan-bootstrap
origin_document: docs/investigations/pinterest-diagnostic-only-login-recovery-2026-07-07.md
---

# Workflow Authority Defaults and Reporting

## Product Contract

### Problem Frame

OpenDevBrowser workflows can return transport success while their real authority gates fail or produce diagnostic-only output. The current investigation proves this for Pinterest harvest and identifies related default and reporting gaps in research, shopping, product-video, Inspiredesign, and macro execution.

### Requirements

- R1: Pinterest harvest must prefer the useful authenticated path by default only when a current handshaken extension is available and the caller did not explicitly choose another transport, profile, cookie policy, or challenge mode.
- R2: Managed Pinterest profile recovery must preserve the named profile through final pin-media byte capture.
- R3: Pinterest login or challenge diagnostics must block product authority. Capture can report the diagnostic, but product readiness must fail closed.
- R4: Non-Pinterest manifest-backed screenshot evidence must be able to promote to `snapshot_ready` only when source provenance is trusted and matches the ranked reference.
- R5: Research defaults must be public-first and scoped so unrelated degraded providers cannot demote selected-source runs.
- R6: Shopping, product-video, and macro execution must report readiness or execution authority separately from top-level transport success.
- R7: Public docs, generated public surface files, skills, and tests must describe the real authority gates and reliable default paths.
- R8: Fixes must preserve existing authority boundaries: `pin-media-index.json` is Pinterest authority, `media-analysis.json` is advisory, and transport success is not product success.

### Non-Goals

- Do not make `media-analysis.json` authoritative.
- Do not broaden social provider defaults outside the Pinterest harvest resolver.
- Do not weaken readiness gates, suppress tests, or accept fallback semantics that hide failed authority gates.
- Do not edit root `AGENTS.md` unless behavior governance changes and maintainer approval is explicit.
- Do not decide the separate `interface_chrome_shell` product policy here. Preserve the current strict byte-backed exception unless review finds a narrow bug.

### Acceptance Examples

- AE1: Default `inspiredesign harvest --provider social/pinterest` uses extension, required cookies, and browser helper only when extension readiness is current and no explicit caller preference exists.
- AE2: Explicit `--browser-mode managed --profile pinterest-design --use-cookies --cookie-policy required` reaches final pin-media capture with `profile: "pinterest-design"` and `persistProfile: true`.
- AE3: A Pinterest pin-media artifact with `warnings: ["login_or_challenge_state"]` remains diagnostic-only even if bytes, hash, dimensions, and source URL are otherwise valid.
- AE4: A non-Pinterest harvest with a trusted temp screenshot and matching reference URL reports `artifactAuthority="product_ready"` and `evidenceAuthority="snapshot_ready"`.
- AE5: Research `auto` uses `web,community`; explicit `all` or `social` still includes social.
- AE6: Shopping JSON includes `buyingReadiness.status`; product-video includes presentation/product-video readiness; macro execution reports `ok`, `partial`, `failures`, and `blocker` semantics.

Product Contract preservation: Product Contract created from the July 7 investigation report and user brief. No prior requirements-only unified plan was rewritten.

## Implementation Units

## Task 1 - Preserve Managed Profile In Final Pin-Media Capture
Reasoning: Workflow inputs already accept and forward `profile`, but the concrete final Pinterest pin-media capture launch drops it and uses a temporary managed profile.
What to do: Thread `profile` through primary pin-media capture options and launch explicit managed profile captures with persistent profile state.
How:
1. Add `profile?: string` to `InspiredesignPrimaryPinMediaCaptureOptions` and the internal primary capture launch option shape in `src/inspiredesign/capture.ts`.
2. When `browserMode === "managed"` and `profile` is present, call `manager.launch` with `profile`, `persistProfile: true`, `noExtension: true`, and managed headless behavior.
3. Preserve extension warmup and default canonical pin behavior for undefined or `auto` browser mode.
4. Add a failing-first regression near existing managed canonical pin capture tests, then implement the smallest production change.
Files impacted: `src/inspiredesign/capture.ts`, `tests/providers-inspiredesign-capture.test.ts`.
End goal: Managed profile recovery is a real authority path instead of only a declared workflow option.
Acceptance criteria:
- [ ] Managed canonical pin capture with `profile: "pinterest-design"` launches with that profile and `persistProfile: true`.
- [ ] Explicit managed mode still avoids extension warmup.
- [ ] Undefined and `auto` canonical pin capture still default to extension.
- [ ] `npm run test -- tests/providers-inspiredesign-capture.test.ts` passes.

## Task 2 - Tighten Pinterest Login Warning Authority
Reasoning: `login_or_challenge_state` currently remains non-blocking in pin-media authority paths, which can let a login-tainted Pinterest artifact become product-ready.
What to do: Make `login_or_challenge_state` authority-blocking while leaving capture diagnostics intact.
How:
1. Remove the login warning from non-blocking authority behavior in `src/inspiredesign/pinterest-pin-media-evidence.ts`.
2. Update `src/inspiredesign/reference-pattern-board.ts` so login or challenge diagnostic reasons block `pin_media_ready`.
3. Prefer no change in `src/inspiredesign/product-readiness.ts`; use delegated helper behavior unless tests reveal a remaining bypass.
4. Update existing tests that currently codify login-warning authority, and add workflow-level diagnostic-only coverage.
Files impacted: `src/inspiredesign/pinterest-pin-media-evidence.ts`, `src/inspiredesign/reference-pattern-board.ts`, `tests/inspiredesign-product-readiness.test.ts`, `tests/inspiredesign-pinterest-pin-media-evidence.test.ts`, `tests/providers-inspiredesign-workflow.test.ts`.
End goal: Pinterest login/challenge state cannot satisfy product authority even when transport and byte capture succeed.
Acceptance criteria:
- [ ] Pin media with `login_or_challenge_state` is rejected as authoritative.
- [ ] Workflow fixture with valid bytes plus login warning remains `diagnostic_only`.
- [ ] Capture-layer warning emission tests still pass.
- [ ] Strict `interface_chrome_shell` behavior is unchanged.
- [ ] `npm run test -- tests/inspiredesign-product-readiness.test.ts tests/inspiredesign-pinterest-pin-media-evidence.test.ts tests/providers-inspiredesign-workflow.test.ts` passes.

## Task 3 - Promote Trusted Non-Pinterest Screenshot Authority
Reasoning: Non-Pinterest harvests can persist manifest-backed screenshots yet fail `snapshot_ready` because captured visual metadata omits trusted source URL provenance.
What to do: Inject `sourceUrl: reference.url` only for trusted non-Pinterest finalization of captured temp screenshots.
How:
1. In `finalizeInspiredesignReferenceVisual` in `src/providers/workflows.ts`, add a narrow provenance fill before `persistInspiredesignVisualEvidence`.
2. Apply it only when the reference is non-Pinterest, the visual came from a trusted temp file, and `visual.sourceUrl` is absent.
3. Do not overwrite mismatched explicit `sourceUrl`.
4. Keep product-readiness checks strict and add workflow regression coverage.
Files impacted: `src/providers/workflows.ts`, `tests/providers-inspiredesign-workflow.test.ts`, optionally `tests/inspiredesign-product-readiness.test.ts`.
End goal: Valid non-Pinterest visual evidence can become `snapshot_ready` without weakening generic visual authority rules.
Acceptance criteria:
- [ ] Non-Pinterest harvest fixture reports `productSuccess=true`, `artifactAuthority="product_ready"`, and `evidenceAuthority="snapshot_ready"`.
- [ ] Counts include `snapshotReadyReferenceCount=1` and `authoritativeReferenceCount=1`.
- [ ] Missing or mismatched source provenance outside the trusted seam remains diagnostic.
- [ ] Pinterest provenance remains strict.
- [ ] `npm run test -- tests/providers-inspiredesign-workflow.test.ts tests/inspiredesign-product-readiness.test.ts` passes.

## Task 4 - Add Pinterest Extension-Auth Default Resolver
Reasoning: Live validation shows explicit extension-auth Pinterest harvest can produce product-ready pin media, while default Pinterest harvest does not enter that path.
What to do: Apply extension-auth defaults for `social/pinterest` harvest only when runtime extension readiness is current and the caller did not specify browser/profile/cookie/challenge options.
How:
1. Add a pure resolver in `src/providers/workflows.ts` that identifies Pinterest harvest and explicit caller choices.
2. Expose or reuse a narrow runtime readiness method that reports extension current, connected, and handshaken status without account identity.
3. Before Inspiredesign discovery, apply `browserMode: "extension"`, `useCookies: true`, `cookiePolicyOverride: "required"`, and `challengeAutomationMode: "browser_with_helper"` when the resolver allows it.
4. Do not change `DEFAULT_PROVIDER_FALLBACK_MODES.social`.
5. Record default metadata so output can distinguish implicit defaults from explicit user settings.
Files impacted: `src/providers/workflows.ts`, `src/providers/runtime-factory.ts` or the daemon runtime construction seam, `src/cli/daemon-commands.ts` if readiness injection belongs there, `src/tools/inspiredesign_run.ts` if tool runtime exposes readiness, `tests/providers-inspiredesign-workflow.test.ts`, `tests/cli-workflows.test.ts` if payload expectations change.
End goal: Pinterest harvest defaults are useful for logged-in extension users while preserving explicit recovery choices and fail-closed authority.
Acceptance criteria:
- [ ] Default Pinterest harvest with current extension readiness applies extension, required cookies, and helper.
- [ ] Explicit managed mode, explicit profile, explicit cookie policy, or explicit challenge mode is preserved.
- [ ] Non-Pinterest harvest behavior is unchanged.
- [ ] Missing extension readiness produces recovery guidance rather than fake authority.
- [ ] Focused Inspiredesign workflow and CLI tests pass.

## Task 5 - Scope Research Defaults And Alerts
Reasoning: Ordinary research defaults include social sources and unscoped workflow alerts can let stale social degradation demote public web-only results.
What to do: Make `auto` public-first and scope workflow alerts to effective selected providers.
How:
1. Change `RESEARCH_AUTO_SOURCES` in `src/providers/research-compiler.ts` to `["web", "community"]`.
2. Preserve explicit `all`, explicit `social`, and explicit `--sources social`.
3. In `src/providers/workflows.ts`, pass effective provider IDs into `buildWorkflowAlerts` for research.
4. Ensure fallback global alerts are filtered by provider ID when runtime snapshots are absent.
5. Keep `research-report/gate.ts` strict.
Files impacted: `src/providers/research-compiler.ts`, `src/providers/workflows.ts`, `tests/providers-research-executor.test.ts`, any focused research workflow tests discovered during implementation.
End goal: Default research can produce public-first useful output without hidden social contamination, while explicit social research remains available.
Acceptance criteria:
- [ ] `sourceSelection: "auto"` resolves to `web,community`.
- [ ] `sourceSelection: "all"` still includes social.
- [ ] Explicit social remains supported.
- [ ] Web-only or web/community runs do not inherit unrelated social alerts.
- [ ] `npm run test -- tests/providers-research-executor.test.ts` and related research workflow tests pass.

## Task 6 - Surface Shopping Buying Readiness
Reasoning: Shopping already computes `pass`, `partial`, and `fail`, but JSON and completion surfaces do not expose the buying authority clearly enough.
What to do: Expose `buyingReadiness` consistently without changing transport success semantics.
How:
1. In `src/providers/renderer.ts`, include `buyingReadiness` in shopping JSON, context, and meta outputs.
2. In `src/providers/workflows.ts`, preserve readiness in final response metadata after manifest assembly.
3. In `src/cli/commands/shopping.ts`, add a concise completion suffix naming `buyingReadiness.status`.
4. If criteria wording is misleading, change wording to "current evidence set" rather than changing gate logic.
Files impacted: `src/providers/renderer.ts`, `src/providers/workflows.ts`, `src/cli/commands/shopping.ts`, shopping renderer/workflow tests, `tests/cli-workflows.test.ts`.
End goal: Users see whether a shopping output is a confident buying brief, constrained partial shortlist, or failed authority gate.
Acceptance criteria:
- [ ] JSON includes first-class `buyingReadiness.status`.
- [ ] Other render modes expose equivalent readiness.
- [ ] CLI output separates transport success from buying readiness.
- [ ] Existing shopping gate strictness is preserved.

## Task 7 - Surface Product-Video Readiness And Provider Recovery
Reasoning: Product-video readiness artifacts exist, but provider interstitial and country-selector guidance is not threaded into handoff steps.
What to do: Thread primary provider issue guidance into product-video handoff and completion output.
How:
1. Extend product-video handoff input in `src/providers/workflow-handoff.ts` with primary constraint summary and provider guidance.
2. Pass `primaryIssue.summary` and `primaryIssue.guidance` from `src/providers/workflows.ts`.
3. In `src/cli/commands/product-video.ts`, include presentation and product-video readiness statuses in completion text.
4. Keep gate behavior unchanged and production-ready only when readiness surfaces pass.
Files impacted: `src/providers/workflow-handoff.ts`, `src/providers/workflows.ts`, `src/cli/commands/product-video.ts`, product-video workflow tests, `tests/cli-workflows.test.ts`.
End goal: Product-video users get precise next steps for partial/fail outputs instead of treating transport success as production-ready video authority.
Acceptance criteria:
- [ ] Partial or fail output names readiness status and reason codes.
- [ ] Best Buy or country-selection interstitial guidance appears in suggested steps when detected.
- [ ] Pass/fail readiness semantics remain unchanged.
- [ ] Focused product-video workflow and CLI tests pass.

## Task 8 - Report Macro Execution Completeness
Reasoning: Macro blocker authority is separate from provider execution success, but current messaging does not consistently tell users to inspect `ok`, `partial`, and `failures`.
What to do: Keep blocker-only authority and report execution completeness explicitly.
How:
1. Extend macro handoff input in `src/providers/workflow-handoff.ts` with `ok`, `partial`, and failure count.
2. Pass execution status from `src/cli/daemon-commands.ts` and `src/tools/macro_resolve.ts`.
3. Update `src/cli/commands/macro-resolve.ts` fallback messaging for `ok=false` with no blocker.
4. Add tests for blocked, unblocked incomplete, and successful execution messages.
Files impacted: `src/providers/workflow-handoff.ts`, `src/cli/daemon-commands.ts`, `src/tools/macro_resolve.ts`, `src/cli/commands/macro-resolve.ts`, `tests/cli-macro-resolve.test.ts`.
End goal: Macro output distinguishes transport success, blocker authority, and provider execution success.
Acceptance criteria:
- [ ] `ok=false` with no blocker reports unblocked but incomplete execution.
- [ ] Blocker messages still prioritize blocker recovery.
- [ ] `ok=true` success remains concise and compatible.
- [ ] `npm run test -- tests/cli-macro-resolve.test.ts` passes.

## Task 9 - Sync Docs, Skills, Generated Surface, And Guidance
Reasoning: Defaults and authority semantics are public behavior. Docs, skills, generated manifests, and agent guidance must not drift.
What to do: Update public guidance after behavior tests pass.
How:
1. Update `src/public-surface/source.ts` for Pinterest defaults, research source defaults, shopping readiness, product-video readiness, macro execution fields, and transport-vs-authority wording.
2. Regenerate public manifests with `node scripts/generate-public-surface-manifest.mjs`.
3. Update `docs/CLI.md` and `docs/SURFACE_REFERENCE.md`.
4. Update relevant skills: `skills/opendevbrowser-best-practices/SKILL.md`, `skills/opendevbrowser-research/SKILL.md`, `skills/opendevbrowser-shopping/SKILL.md`, and `skills/opendevbrowser-product-presentation-asset/SKILL.md`.
5. Update relevant nested `AGENTS.md` files only if behavior guidance changes and the edit is not root governance.
Files impacted: `src/public-surface/source.ts`, `src/public-surface/generated-manifest.ts`, `src/public-surface/generated-manifest.json`, `docs/CLI.md`, `docs/SURFACE_REFERENCE.md`, relevant `skills/*/SKILL.md`, possibly nested `AGENTS.md` files.
End goal: Public and agent-facing guidance teaches working defaults and authority stop conditions.
Acceptance criteria:
- [ ] Docs and skills separate transport success from authority success.
- [ ] Generated manifests match `src/public-surface/source.ts`.
- [ ] No root `AGENTS.md` edit is made without explicit approval.
- [ ] Docs drift checks or relevant generated-surface tests pass.

## Task 10 - Verify Authority Gates And Land Safely
Reasoning: Tests prove branches, but the minimum closeout criterion is useful authority-gate output from real workflow surfaces.
What to do: Run focused tests, full quality gates, live authority smoke workflows, review loops, atomic commits, PR checks, and merge only when gates are real.
How:
1. Run focused suites for each changed area.
2. Run full gates: `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`, `npm run extension:build`, and `npm run version:check` if available.
3. Run live smokes with isolated output dirs and save evidence paths.
4. Use RepoPrompt and code review loops for adversarial review. Apply findings, rerun affected tests and smokes, then repeat until clear.
5. Commit atomically with Conventional Commit style and required `Co-authored-by: Codex <noreply@openai.com>` footer.
6. Push, open PR, monitor checks, fix failures, rerun workflows, and merge only after checks and authority smokes pass.
Files impacted: Git metadata, PR metadata, and evidence artifacts under ignored output roots. No tracked source files beyond prior tasks unless review fixes require them.
End goal: The branch is landable and merged with real authority proof, not just passing transport or unit tests.
Acceptance criteria:
- [ ] Focused and full quality commands pass with zero errors and zero warnings.
- [ ] Live Pinterest extension default smoke records useful `pin_media_ready` only when authority artifacts exist.
- [ ] Research smoke shows public-first source selection and no unrelated social alert demotion.
- [ ] Shopping smoke records visible buying readiness.
- [ ] Product-video smoke records readiness status and provider recovery guidance.
- [ ] Inspiredesign non-Pinterest smoke records `snapshot_ready` when artifact authority is valid.
- [ ] Macro smoke records execution completeness fields.
- [ ] Review loop reports no blocking findings.
- [ ] PR checks pass and merge completes.

## File-By-File Implementation Sequence

1. `src/inspiredesign/capture.ts` and `tests/providers-inspiredesign-capture.test.ts` for managed profile capture.
2. `src/inspiredesign/pinterest-pin-media-evidence.ts`, `src/inspiredesign/reference-pattern-board.ts`, and Pinterest authority tests.
3. `src/providers/workflows.ts` and Inspiredesign workflow tests for non-Pinterest screenshot provenance.
4. `src/providers/workflows.ts` plus runtime readiness seam for Pinterest extension-auth defaults and workflow tests.
5. `src/providers/research-compiler.ts`, `src/providers/workflows.ts`, and research tests.
6. `src/providers/renderer.ts`, `src/providers/workflows.ts`, `src/cli/commands/shopping.ts`, and shopping tests.
7. `src/providers/workflow-handoff.ts`, `src/providers/workflows.ts`, `src/cli/commands/product-video.ts`, and product-video tests.
8. `src/providers/workflow-handoff.ts`, `src/cli/daemon-commands.ts`, `src/tools/macro_resolve.ts`, `src/cli/commands/macro-resolve.ts`, and macro tests.
9. Public docs, skills, generated manifests, and nested guidance docs.
10. Review fixes, quality gates, live smokes, commits, PR, checks, and merge.

## Dependency Mapping

| Task | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |
| Task 1 | none | Pinterest managed-profile live smoke | Tasks 2, 3, 5 |
| Task 2 | none | Pinterest docs and authority claims | Tasks 1, 3, 5 |
| Task 3 | none | Inspiredesign snapshot-ready live smoke | Tasks 1, 2, 5 |
| Task 4 | runtime readiness seam | Pinterest docs and default live smoke | Tasks 6, 7, 8 |
| Task 5 | none | Research docs and live smoke | Tasks 1, 2, 3 |
| Task 6 | none | Shopping docs and live smoke | Tasks 7, 8 |
| Task 7 | existing provider guidance | Product-video docs and live smoke | Tasks 6, 8 |
| Task 8 | none | Macro docs and live smoke | Tasks 6, 7 |
| Task 9 | Tasks 1-8 behavior settled | Final gates and PR | none |
| Task 10 | Tasks 1-9 | Merge | none |

Critical path: Task 4 runtime readiness, Task 9 docs/generated sync, Task 10 live smokes and PR checks.

## Test Command Inventory

Focused commands:

```bash
npm run test -- tests/providers-inspiredesign-capture.test.ts
npm run test -- tests/inspiredesign-pinterest-pin-media-evidence.test.ts
npm run test -- tests/inspiredesign-product-readiness.test.ts
npm run test -- tests/providers-inspiredesign-workflow.test.ts
npm run test -- tests/providers-research-executor.test.ts
npm run test -- tests/cli-workflows.test.ts
npm run test -- tests/cli-macro-resolve.test.ts
```

Full gates:

```bash
npm run lint
npm run typecheck
npm run build
npm run extension:build
npm run version:check
npm run test
```

Generated sync:

```bash
node scripts/generate-public-surface-manifest.mjs
```

## Live Authority Smoke Gates

- Pinterest default extension-auth: run default `inspiredesign harvest --provider social/pinterest` with daemon extension current and inspect `productSuccess`, `artifactAuthority`, `evidenceAuthority`, `ranked-references.json`, and `pin-media-index.json`.
- Pinterest managed profile recovery: run managed profile harvest and verify final capture uses the named persistent profile; output remains diagnostic-only if login/challenge is observed.
- Research public-first: run omitted-source research and verify sources are `web,community` and no unrelated social alert demotion occurs.
- Shopping readiness: run representative shopping JSON workflow and verify visible `buyingReadiness.status` and constrained partial wording when partial.
- Product-video readiness: run official product URL and interstitial-prone marketplace URL, verifying readiness surfaces and provider recovery guidance.
- Inspiredesign non-Pinterest snapshot: run harvest with required visual evidence and verify `snapshot_ready` only when manifest-backed source provenance is valid.
- Macro execution completeness: run or fixture an unblocked incomplete macro and verify `ok=false`, `partial`, and `failures` are visible.

## Version History

- 2026-07-07 v1: Created implementation-ready plan from the Pinterest diagnostic and broader workflow-default investigation.
