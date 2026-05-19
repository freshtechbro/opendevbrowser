# Comprehensive Documentation Update Implementation Plan

> **For agentic workers:** Recommended execution path is `rp-orchestrate` plus `superpowers:subagent-driven-development` for broad multi-file execution, or `superpowers:executing-plans` for inline execution. Follow the work items task by task and preserve unrelated changes.

**Goal:** Align OpenDevBrowser documentation with the actual, verifiable current codebase state across public docs, root and nested `AGENTS.md`, release/distribution docs, runtime architecture docs, dependency/config docs, and stale-risk historical docs.

**Implementation trace:** This plan was used to guide the 2026-05-19 documentation update work on branch `codex/comprehensive-documentation-update`. It is retained as planning evidence, not as a release evidence ledger. The unchecked boxes below are the original planning-phase acceptance criteria and should not be read as a live PR status tracker.

**Architecture:** Treat code, generated manifests, package metadata, and validation scripts as the source of truth. Update documentation in dependency order: source evidence first, generated/public surfaces next, runtime-specific docs next, then stale-risk and release-facing docs, with docs-drift and help parity gates closing the loop.

**Tech Stack:** Node.js, TypeScript, Vitest, tsup, ESLint flat config, Chrome extension MV3, RepoPrompt, OpenDevBrowser CLI generated public-surface manifest.

---

## Scope

Update planning covers:

- Root `AGENTS.md` and nested `AGENTS.md` files, with special focus on `docs/AGENTS.md` and `src/annotate/AGENTS.md`.
- `eslint.config.js`, `package.json`, `package-lock.json`, root `README.md`, and `docs/README.md`.
- `docs/SURFACE_REFERENCE.md`, `docs/TROUBLESHOOTING.md`, `docs/WORKFLOW_SURFACE_MAP.md`, `docs/privacy.md`, `docs/PARITY_DECLARED_DIVERGENCES.md`, `docs/OPEN_SOURCE_ROADMAP.md`, and `docs/LANDING_METRICS_SOURCE_OF_TRUTH.md`.
- First-run onboarding, extension release runbook, distribution plan, design canvas technical spec, dependency docs, architecture docs, and annotation docs.
- Validation and docs-drift coverage needed to keep the update verifiable.

## Historical Non-Goals

- This plan began as a plan-only artifact; the later implementation pass has now applied the documentation edits in the same branch.
- Do not change runtime behavior unless documentation cannot be made truthful without source changes.
- Do not rewrite historical release evidence except to mark status or currentness clearly.
- Do not edit generated public-surface files by hand.

## Background

### Governance and Documentation Policy

- Root `AGENTS.md:252-264` defines docs as a source-of-truth surface, treats generated CLI help as documentation, and says help or inventory changes must update `src/cli/help.ts`, `docs/CLI.md`, `docs/SURFACE_REFERENCE.md`, and root `AGENTS.md` together.
- Root `AGENTS.md:266-298` lists 26 layered `AGENTS.md` files and says root governance-rule edits require explicit task-scoped maintainer approval.
- `docs/AGENTS.md:11-18` says implementation code wins over docs and names canonical sources: `src/cli/args.ts`, `src/public-surface/source.ts`, generated manifests, `src/cli/help.ts`, `src/cli/onboarding-metadata.json`, `src/tools/index.ts`, relay/ops sources, and canvas sources.
- `docs/AGENTS.md:26-80` is the existing sync matrix for command/tool/channel, canvas, extension, annotation, release-gate, and mirrored website inputs.
- `docs/AGENTS.md:84-94` forbids stale numeric claims, unsupported commands, over-claiming `bound_app_runtime`, manual edits to generated private frontend docs, and collapsing extension relay, browser replay, desktop observation, and browser-scoped helper lanes.

### Public Surface, Onboarding, and Workflow Truth

- `src/public-surface/source.ts:1-33` owns public-surface schema and canonical flag metadata. `src/public-surface/source.ts:1008-1091` builds command, tool, pair, and count manifests.
- `scripts/generate-public-surface-manifest.mjs:8-12` declares source and generated output paths. `scripts/generate-public-surface-manifest.mjs:83-95` writes generated, do-not-edit headers.
- `src/cli/args.ts:1-8` consumes generated command and flag inventory. `src/cli/help.ts:1-13` consumes onboarding metadata and generated public-surface data.
- `src/cli/onboarding-metadata.json:2-27` is the canonical source for first-run help topic, quick-start commands, validated lanes, and reference paths.
- `scripts/shared/workflow-inventory.mjs:8-34` builds workflow inventory from generated public surface data. `scripts/workflow-inventory-report.mjs:49-140` renders workflow inventory JSON and Markdown.
- `scripts/docs-drift-check.mjs:77-100` renders and normalizes a fresh workflow map. `scripts/docs-drift-check.mjs:283-287` requires `docs/WORKFLOW_SURFACE_MAP.md` to match generated output aside from the date stamp.

### Runtime Architecture, Canvas, and Annotation Truth

- `docs/ARCHITECTURE.md:10-42` describes runtime entry points, current surface counts, public-surface ownership, and shared core managers.
- `src/core/bootstrap.ts:52-103` constructs runtime managers and wires relay annotation storage into `AgentInbox`. `src/core/types.ts:28-78` defines exported core shape.
- `src/relay/relay-server.ts:38-96` owns relay status fields and `/extension`, `/cdp`, `/annotation`, `/ops`, and `/canvas` websocket servers.
- `src/relay/protocol.ts:54-66` mirrors relay HTTP status fields. `src/relay/protocol.ts:238-339` defines canvas protocol envelopes.
- `extension/src/background.ts:1-45` composes extension connection, ops, canvas runtime, and annotation payload helpers. `extension/src/background.ts:122-129` routes relay annotation, ops, and canvas messages.
- `docs/DESIGN_CANVAS_TECHNICAL_SPEC.md:9-18` maps canvas layers to code owners. `docs/DESIGN_CANVAS_TECHNICAL_SPEC.md:48-59` lists canvas command families. `docs/DESIGN_CANVAS_TECHNICAL_SPEC.md:85-89` says `canvas_html` is the default projection boundary and `bound_app_runtime` is opt-in only.
- `src/browser/canvas-manager.ts:131-166` is the public canvas command list. `extension/src/canvas/canvas-runtime.ts:211-257` handles canvas hello/request and capability advertisement.
- `src/annotate/AGENTS.md:7-18` defines annotate subsystem scope. `src/annotate/AGENTS.md:22-50` documents `AgentInbox`, `DirectAnnotator`, and `AgentInboxStore`. `src/annotate/AGENTS.md:64-72` lists annotation doc sync points.
- `src/browser/annotation-manager.ts:53-116` chooses stored, relay, direct, and auto annotation transports and checks shared `AgentInbox` first.

### Release, Distribution, Dependency, and Config Truth

- `docs/EXTENSION_RELEASE_RUNBOOK.md:7-21` defines GitHub release artifact and optional Chrome Web Store lanes. `docs/EXTENSION_RELEASE_RUNBOOK.md:29-84` lists extension release preflight and execution steps.
- `docs/DISTRIBUTION_PLAN.md:8-30` defines npm, GitHub extension artifact, and private website channels. `docs/DISTRIBUTION_PLAN.md:36-64` lists local release validation commands.
- `package.json:1-18` owns package name, version, bin, package files, and included extension assets. `package.json:48-67` owns build, lint, test, release, extension, and version scripts. `package.json:65-91` owns dependency versions.
- `extension/manifest.json:1-16`, `extension/package.json:1-9`, and `package.json:54-62` are version and extension build/package metadata seams.
- `docs/DEPENDENCIES.md:7-36` mirrors runtime and dev dependency inventory. `docs/DEPENDENCIES.md:58-64` names live config files including `eslint.config.js`, `tsconfig.json`, and no public Vite config.
- `eslint.config.js:1-13` is the ESLint flat config over `src/**/*.ts` and `tests/**/*.ts` using `@typescript-eslint/parser` with no custom rules.
- `.github/workflows/pr-checks.yml:31-72` is part of the documentation validation surface because it runs docs drift, CLI help parity, and related docs/skills gates in CI.

### Known Stale-Risk Hotspots

- `docs/OPEN_SOURCE_ROADMAP.md:3-15` marks itself historical. `docs/OPEN_SOURCE_ROADMAP.md:24-35` contains milestone windows that are in the past relative to 2026-05-19.
- `docs/README.md:35-47` references `docs/RELEASE_0.0.30_EVIDENCE.md` as current while `package.json:3` is `0.0.31` and `docs/RELEASE_0.0.31_EVIDENCE.md` exists.
- `docs/AGENTS.md:68` also names `docs/RELEASE_0.0.30_EVIDENCE.md` as current release evidence.
- `docs/privacy.md:5` says last updated April 11, 2026 while it contains later runtime claims about desktop observation, browser replay, annotations, and challenge automation.
- `docs/PARITY_DECLARED_DIVERGENCES.md:7` was last updated 2026-02-23 and only lists two divergences.
- `docs/LANDING_METRICS_SOURCE_OF_TRUTH.md:3-12` says the page is blocked/historical and stale. `docs/LANDING_METRICS_SOURCE_OF_TRUTH.md:25-30` still lists 55 commands and 48 tools while current docs and generated surface report 77 commands and 70 tools.

### Prior Art

- Commit `5cd3a3e` documented InspireDesign visual harvest and updated runtime docs, public surface, skills, and templates together. `docs/plans/inspiredesign-visual-harvest-implementation-plan.md:101-136` is a reusable validation shape for public-surface plus docs updates.
- Commit `8335b44` hardened daemon fingerprint mismatch recovery and propagated docs across `AGENTS.md`, README, CLI, troubleshooting, scripts, and tests. `docs/investigations/protected-daemon-build-mismatch-2026-05-18.md:31-64` is a model for source-backed investigation plus standard preflight guidance.
- Commit `043ea9b` unified workflow output roots. `docs/plans/unify-workflow-output-roots.md:3-58` shows a reusable sequence: regression coverage, central source of truth, plumbing, docs, and gates.
- `docs/RELEASE_0.0.31_EVIDENCE.md:34-53` and `docs/RELEASE_0.0.31_EVIDENCE.md:69-88` show the current release-quality validation pattern.

## Approach

1. Build the documentation update from source evidence, not from existing prose.
2. Update generated and source-backed surfaces first because they drive counts, names, flags, and first-contact wording.
3. Update runtime-specific docs after verifying actual code seams for architecture, relay, extension, canvas, and annotation.
4. Update release, dependency, and stale-risk docs only after package, extension, and validation evidence are checked.
5. Add or adjust drift checks only where stale-risk cannot be reliably caught by existing gates.
6. Run focused docs/help/surface gates before full quality gates.

## Dependency Map

- Work Items 1 and 2 establish the evidence baseline and must happen first.
- Work Items 3 through 6 cover governance, public surface, onboarding, README, and docs index.
- Work Items 7 through 10 cover runtime-specific architecture, relay, extension, canvas, and annotation docs.
- Work Items 11, 12, and 14 cover troubleshooting, privacy, parity, roadmap, landing metrics, dependencies, package metadata, lockfile, and ESLint.
- Work Item 13 covers release and distribution docs after Work Item 14 verifies package and extension metadata.
- Work Item 15 reviews drift-check coverage after the doc areas are known.
- Work Item 16 finalizes execution order and validation handoff.

## Work Items

### Item 1 - Convert Plan Into Execution Contract

**Goal:** Keep this file as the durable contract for the later documentation update.

**Done when:** The plan has scope, non-goals, background, approach, dependency map, work items, validation, open questions, references, and version history.

**Key files:**
- `docs/plans/comprehensive-documentation-update-2026-05-19.md`

**Dependencies:** None.

**Size:** S.

**Acceptance criteria:**
- [ ] Background evidence remains cited with file:line references.
- [ ] Every later work item has Goal, Done when, Key files, Dependencies, Size, and Acceptance criteria.
- [ ] The plan states that actual documentation edits belong to a later implementation workflow.
- [ ] Version history is present.

### Item 2 - Establish Source Evidence Baseline

**Goal:** Create the implementation baseline that future doc edits must verify against.

**Done when:** The implementer has a matrix in the implementation handoff, PR description, or a checked-in plan update mapping each doc surface to canonical code, generated files, package metadata, and tests.

**Key files:**
- `src/public-surface/source.ts`
- `scripts/generate-public-surface-manifest.mjs`
- `src/public-surface/generated-manifest.ts`
- `src/public-surface/generated-manifest.json`
- `src/cli/args.ts`
- `src/cli/help.ts`
- `src/cli/onboarding-metadata.json`
- `scripts/shared/workflow-inventory.mjs`
- `scripts/workflow-inventory-report.mjs`
- `scripts/docs-drift-check.mjs`
- `package.json`
- `package-lock.json`
- `extension/manifest.json`
- `extension/package.json`
- `eslint.config.js`

**Dependencies:** Item 1.

**Size:** S.

**Acceptance criteria:**
- [ ] Counts come from generated public-surface data and drift scripts, not manual counting.
- [ ] Workflow and onboarding claims point to onboarding metadata and workflow inventory scripts.
- [ ] Version, dependency, and extension claims point to package and manifest metadata.
- [ ] Docs drift checks are listed as validation owners.
- [ ] No new source file is created for the evidence matrix unless the implementation task explicitly asks for a durable evidence artifact.

### Item 3 - Audit Root and Nested `AGENTS.md`

**Goal:** Plan and execute a source-backed audit of repo governance docs.

**Done when:** Root and nested `AGENTS.md` files reflect current paths, source-of-truth ownership, sync rules, and stale release evidence status.

**Key files:**
- `AGENTS.md`
- `docs/AGENTS.md`
- `src/annotate/AGENTS.md`
- `src/AGENTS.md`
- `src/browser/AGENTS.md`
- `src/canvas/AGENTS.md`
- `src/cli/AGENTS.md`
- `src/core/AGENTS.md`
- `src/relay/AGENTS.md`
- `src/tools/AGENTS.md`
- `extension/AGENTS.md`
- `extension/src/canvas/AGENTS.md`
- `extension/src/ops/AGENTS.md`
- `extension/src/services/AGENTS.md`
- `scripts/AGENTS.md`
- `tests/AGENTS.md`
- `skills/AGENTS.md`

**Dependencies:** Item 2.

**Size:** M.

**Acceptance criteria:**
- [ ] Root `AGENTS.md` governance-rule edits are not made without explicit maintainer approval.
- [ ] `docs/AGENTS.md` sync matrix is kept as the primary docs policy surface.
- [ ] `src/annotate/AGENTS.md` is checked against `src/browser/annotation-manager.ts`, `src/core/bootstrap.ts`, and `src/relay/protocol.ts`.
- [ ] Stale release evidence pointers such as `0.0.30` currentness are corrected or marked historical where appropriate.
- [ ] No nested `AGENTS.md` claims unsupported files, commands, or release states.

### Item 4 - Sync Public Surface Reference and CLI Docs

**Goal:** Bring public CLI, tool, flag, `/ops`, and `/canvas` documentation into parity with generated source truth.

**Done when:** Public docs and help-visible docs match generated public-surface metadata and tests.

**Key files:**
- `docs/SURFACE_REFERENCE.md`
- `docs/CLI.md`
- `README.md`
- `docs/ARCHITECTURE.md`
- `src/public-surface/source.ts`
- `src/public-surface/generated-manifest.ts`
- `src/public-surface/generated-manifest.json`
- `src/cli/args.ts`
- `src/cli/help.ts`
- `tests/cli-help.test.ts`
- `tests/cli-help-parity.test.ts`
- `tests/public-surface-manifest.test.ts`

**Dependencies:** Items 2 and 3.

**Size:** L.

**Acceptance criteria:**
- [ ] Plan-date command count `77`, tool count `70`, `/ops` count, and `/canvas` count are re-verified from source scripts before prose updates and updated if current source differs.
- [ ] `docs/SURFACE_REFERENCE.md`, `docs/CLI.md`, root `README.md`, and `docs/ARCHITECTURE.md` use the same inventory story.
- [ ] Exact generated-help lookup labels remain explicit: `screencast / browser replay`, `desktop observation`, and `computer use / browser-scoped computer use`.
- [ ] `npx opendevbrowser --help` and `npx opendevbrowser help` are checked after updates.
- [ ] Public-surface and CLI-help parity tests pass.

### Item 5 - Sync First-Run Onboarding and Workflow Map

**Goal:** Align first-contact docs and workflow inventory with metadata and generated workflow scripts.

**Done when:** First-run onboarding, docs index, CLI help pointers, and workflow map are source-backed and drift-check clean.

**Key files:**
- `docs/FIRST_RUN_ONBOARDING.md`
- `docs/WORKFLOW_SURFACE_MAP.md`
- `docs/README.md`
- `docs/CLI.md`
- `README.md`
- `src/cli/onboarding-metadata.json`
- `scripts/shared/workflow-inventory.mjs`
- `scripts/workflow-inventory-report.mjs`
- `scripts/docs-drift-check.mjs`

**Dependencies:** Item 4.

**Size:** M.

**Acceptance criteria:**
- [ ] `docs/FIRST_RUN_ONBOARDING.md` uses the current quick-start commands from `src/cli/onboarding-metadata.json`.
- [ ] `docs/WORKFLOW_SURFACE_MAP.md` is regenerated or compared with `node scripts/workflow-inventory-report.mjs --markdown-out docs/WORKFLOW_SURFACE_MAP.md`.
- [ ] Date-only workflow-map differences are handled by the existing docs-drift normalization.
- [ ] Onboarding docs separate generated help, checklist, and `opendevbrowser-best-practices` ownership.
- [ ] `node scripts/cli-onboarding-smoke.mjs` remains documented where required.

### Item 6 - Sync README and Docs Index

**Goal:** Make root README and docs index accurate as first-contact surfaces.

**Done when:** README surfaces match public-surface counts, current release evidence, and first-contact ownership boundaries.

**Key files:**
- `README.md`
- `docs/README.md`
- `docs/SURFACE_REFERENCE.md`
- `docs/CLI.md`
- `docs/RELEASE_0.0.31_EVIDENCE.md`
- `docs/RELEASE_0.0.30_EVIDENCE.md`

**Dependencies:** Items 4 and 5.

**Size:** M.

**Acceptance criteria:**
- [ ] Root README counts match generated public-surface counts.
- [ ] README preserves separate browser replay, desktop observation, and browser-scoped computer-use boundaries.
- [ ] `docs/README.md` no longer treats `docs/RELEASE_0.0.30_EVIDENCE.md` as current when package metadata is at `0.0.31`.
- [ ] Historical evidence docs are linked as historical, not removed unless explicitly requested.
- [ ] Mirrored website input guidance remains accurate.

### Item 7 - Sync Architecture and Core Runtime Docs

**Goal:** Align architecture docs with current runtime wiring and public boundary claims.

**Done when:** Architecture docs accurately describe entry points, shared managers, relay lanes, canvas/annotation wiring, and desktop observation boundaries.

**Key files:**
- `docs/ARCHITECTURE.md`
- `src/core/bootstrap.ts`
- `src/core/types.ts`
- `src/relay/relay-server.ts`
- `src/relay/protocol.ts`
- `extension/src/background.ts`
- `src/browser/annotation-manager.ts`
- `src/browser/canvas-manager.ts`

**Dependencies:** Items 2 and 4.

**Size:** L.

**Acceptance criteria:**
- [ ] Runtime entry points and surface counts are verified before edits.
- [ ] `AgentInbox`, `AnnotationManager`, `CanvasManager`, `RelayServer`, and desktop observation boundaries are described from code seams.
- [ ] Shipped read-only desktop observation is distinct from roadmap-only desktop-agent claims.
- [ ] Relay status fields match protocol and server truth.
- [ ] No architecture doc implies unsupported desktop agent behavior.

### Item 8 - Sync Relay, Extension, and Channel Docs

**Goal:** Align extension relay, `/ops`, `/annotation`, `/canvas`, and release-facing extension docs with code and manifest truth.

**Done when:** Extension and channel docs match relay protocol, extension background wiring, and manifest permissions.

**Key files:**
- `docs/EXTENSION.md`
- `docs/TROUBLESHOOTING.md`
- `docs/EXTENSION_RELEASE_RUNBOOK.md`
- `docs/SURFACE_REFERENCE.md`
- `docs/privacy.md`
- `src/relay/protocol.ts`
- `src/relay/relay-server.ts`
- `extension/src/background.ts`
- `extension/manifest.json`
- `extension/store-assets/LISTING.md`
- `scripts/chrome-store-compliance-check.mjs`

**Dependencies:** Item 7.

**Size:** M.

**Acceptance criteria:**
- [ ] Relay status fields and websocket lane names are verified.
- [ ] Annotation send bridge and canvas target registration claims are checked against extension code.
- [ ] Extension relay remains separate from desktop observation and desktop-agent wording.
- [ ] Privacy and Chrome Web Store permission wording pass compliance checks.
- [ ] Store listing is updated only if extension release/store wording changed.

### Item 9 - Sync Design Canvas Technical Docs

**Goal:** Align canvas docs with public canvas commands and extension runtime capability behavior.

**Done when:** Canvas technical docs and public docs match current canvas manager and extension runtime boundaries.

**Key files:**
- `docs/DESIGN_CANVAS_TECHNICAL_SPEC.md`
- `docs/CANVAS_BIDIRECTIONAL_CODE_SYNC_TECHNICAL_SPEC.md`
- `docs/CANVAS_ADAPTER_PLUGIN_CONTRACT.md`
- `docs/CLI.md`
- `docs/SURFACE_REFERENCE.md`
- `docs/ARCHITECTURE.md`
- `docs/EXTENSION.md`
- `docs/TROUBLESHOOTING.md`
- `src/browser/canvas-manager.ts`
- `extension/src/canvas/canvas-runtime.ts`

**Dependencies:** Items 4, 7, and 8.

**Size:** L.

**Acceptance criteria:**
- [ ] `PUBLIC_CANVAS_COMMANDS` is verified before updating command lists.
- [ ] `canvas_html` stays documented as the default projection boundary.
- [ ] `bound_app_runtime` is described only as opt-in where runtime instrumentation exists.
- [ ] `generationPlanIssues`, `plan_invalid`, and `generation_plan_invalid` are synchronized across docs.
- [ ] Canvas history events are described as internal events where appropriate, not extra public commands.

### Item 10 - Sync Annotation Docs and `src/annotate/AGENTS.md`

**Goal:** Align annotation delivery, stored payload, and AgentInbox docs with runtime behavior.

**Done when:** Annotation docs and annotate-specific agent guidance match implementation and privacy boundaries.

**Key files:**
- `docs/ANNOTATE.md`
- `docs/CLI.md`
- `docs/SURFACE_REFERENCE.md`
- `docs/ARCHITECTURE.md`
- `docs/EXTENSION.md`
- `docs/TROUBLESHOOTING.md`
- `docs/privacy.md`
- `src/annotate/AGENTS.md`
- `src/browser/annotation-manager.ts`
- `src/core/bootstrap.ts`
- `src/relay/protocol.ts`
- `extension/src/background.ts`

**Dependencies:** Items 7 and 8.

**Size:** M.

**Acceptance criteria:**
- [ ] Docs describe `annotation:sendPayload` to `store_agent_payload` to `AgentInbox`.
- [ ] Stored-only fallback wording is present where safe chat scoping or relay delivery is unavailable.
- [ ] `src/annotate/AGENTS.md` sync points match current implementation.
- [ ] Privacy storage claims match annotation payload and screenshot handling behavior.
- [ ] Docs avoid implying annotation is a desktop capability.

### Item 11 - Sync Troubleshooting and Workflow Recovery Docs

**Goal:** Update troubleshooting guidance around current recovery paths and workflow keys.

**Done when:** Troubleshooting docs match current daemon, workflow, cookie, AgentInbox, canvas, and desktop observation behavior.

**Key files:**
- `docs/TROUBLESHOOTING.md`
- `docs/WORKFLOW_SURFACE_MAP.md`
- `docs/CLI.md`
- `docs/ARCHITECTURE.md`
- `scripts/docs-drift-check.mjs`
- `scripts/shared/workflow-inventory.mjs`
- `scripts/live-regression-direct.mjs`

**Dependencies:** Items 5, 8, and 10.

**Size:** M.

**Acceptance criteria:**
- [ ] Troubleshooting covers daemon fingerprint preflight, cookie bootstrap, AgentInbox fallback, canvas history wording, and desktop observation Swift prerequisite.
- [ ] Workflow key docs use camelCase keys such as `meta.primaryConstraintSummary`, `meta.metrics.reasonCodeDistribution`, and `meta.reasonCodeDistribution`.
- [ ] Removed snake_case aliases are not documented as current.
- [ ] Unsupported commands or flags are not added.

### Item 12 - Sync Privacy, Parity, Roadmap, and Landing Metrics

**Goal:** Resolve stale-risk docs with explicit current, blocked, or historical status.

**Done when:** Dated docs state their current status honestly and only include claims backed by current source or same-day evidence.

**Key files:**
- `docs/privacy.md`
- `docs/PARITY_DECLARED_DIVERGENCES.md`
- `docs/OPEN_SOURCE_ROADMAP.md`
- `docs/LANDING_METRICS_SOURCE_OF_TRUTH.md`
- `docs/ARCHITECTURE.md`
- `docs/SURFACE_REFERENCE.md`
- `scripts/docs-drift-check.mjs`
- `scripts/chrome-store-compliance-check.mjs`

**Dependencies:** Items 4, 7, 8, and 10.

**Size:** L.

**Acceptance criteria:**
- [ ] Privacy last-updated date and claims are updated only after extension and runtime boundaries are verified.
- [ ] Parity divergences are checked against current parity gates and documented as current or historical.
- [ ] Roadmap remains historical unless a new roadmap is backed by current decisions.
- [ ] Landing metrics stay blocked/historical if private frontend evidence is unavailable.
- [ ] Landing metrics are refreshed only with same-day evidence from current generated counts and the accessible frontend source of truth.
- [ ] No stale metric table is presented as current.

### Item 13 - Sync Release Evidence, Runbooks, and Distribution Plan

**Goal:** Align release-facing docs with package, extension, and current release evidence truth.

**Done when:** Release docs identify current evidence, historical evidence, package version, extension version, and validation lanes accurately.

**Default boundary:** Update references to current evidence and mark historical evidence status where needed. Do not append new validation results to release evidence ledgers unless the implementation task explicitly includes release evidence updates.

**Key files:**
- `docs/RELEASE_RUNBOOK.md`
- `docs/EXTENSION_RELEASE_RUNBOOK.md`
- `docs/DISTRIBUTION_PLAN.md`
- `docs/RELEASE_0.0.30_EVIDENCE.md`
- `docs/RELEASE_0.0.31_EVIDENCE.md`
- `docs/README.md`
- `README.md`
- `package.json`
- `package-lock.json`
- `extension/manifest.json`
- `extension/package.json`

**Dependencies:** Items 6, 8, and 14.

**Size:** L.

**Acceptance criteria:**
- [ ] Current release evidence points to `0.0.31` where package metadata confirms that version.
- [ ] Historical ledgers are marked historical when no longer current.
- [ ] Release runbooks include registry consumer smoke and GitHub release artifact evidence where currently required.
- [ ] Extension release docs align with manifest version, extension package version, store asset boundaries, and zip packaging steps.
- [ ] Docs do not expand scope into release publication unless explicitly requested.
- [ ] Store listing wording has one owner for the implementation pass: Item 8 owns extension behavior and privacy wording, while Item 13 owns release/store publishing sequence wording.

### Item 14 - Sync Package, Lockfile, ESLint, and Dependency Docs

**Goal:** Align dependency and config docs with package and lockfile truth.

**Done when:** Dependency docs accurately represent runtime/dev dependencies, lockfile state, package scripts, and lint/config boundaries.

**Key files:**
- `package.json`
- `package-lock.json`
- `eslint.config.js`
- `docs/DEPENDENCIES.md`
- `docs/DISTRIBUTION_PLAN.md`
- `docs/RELEASE_RUNBOOK.md`
- `docs/README.md`
- `.github/workflows/pr-checks.yml`

**Dependencies:** Item 2.

**Size:** M.

**Acceptance criteria:**
- [ ] Runtime and dev dependency lists match `package.json` and lockfile top-level metadata.
- [ ] Package version is verified from `package.json` and lockfile metadata.
- [ ] `eslint.config.js` is described as flat config over `src/**/*.ts` and `tests/**/*.ts` with `@typescript-eslint/parser` and no custom rules, unless code changes.
- [ ] Docs state no public Vite config exists only after verifying repo truth.
- [ ] Package scripts documented in release/distribution docs match `package.json`.

### Item 15 - Update Docs Drift and Test Coverage Only Where Needed

**Goal:** Ensure critical doc claims stay protected after the comprehensive update.

**Done when:** Existing docs-drift coverage is reviewed and any missing high-risk checks are added in a later implementation pass only if necessary.

**Key files:**
- `scripts/docs-drift-check.mjs`
- `tests/docs-drift-check.test.ts`
- `tests/cli-help.test.ts`
- `tests/cli-help-parity.test.ts`
- `tests/public-surface-manifest.test.ts`
- `docs/CLI.md`
- `docs/SURFACE_REFERENCE.md`
- `docs/WORKFLOW_SURFACE_MAP.md`
- `docs/privacy.md`
- `docs/DEPENDENCIES.md`
- `docs/README.md`

**Dependencies:** Items 4 through 14.

**Size:** M.

**Acceptance criteria:**
- [ ] Existing docs-drift coverage is inventoried by topic before adding checks.
- [ ] New checks are limited to claims likely to drift again, such as current release evidence, landing metrics currentness, parity/divergence status, or dependency/config metadata.
- [ ] Tests lock any new drift-check IDs.
- [ ] Validation sequence runs docs drift before full release gates.

### Item 16 - Finalize Implementation Order and Evidence Capture

**Goal:** Give later workers a safe execution order and final validation recipe.

**Done when:** Implementation can proceed without guessing order, test scope, or evidence expectations.

**Key files:** All files listed in Items 3 through 15.

**Dependencies:** Items 1 through 15.

**Size:** S.

**Acceptance criteria:**
- [ ] Implementation starts with source inventories and generated outputs.
- [ ] First-contact docs are updated before docs index and release-facing docs that reference them.
- [ ] Runtime architecture docs are updated before privacy and troubleshooting docs.
- [ ] Release/distribution/dependency docs are updated after package and extension metadata checks.
- [ ] Validation evidence is captured in the final handoff, and release evidence docs are updated only if task scope includes that.

## Recommended Implementation Sequence

1. Check `git status` and preserve unrelated work.
2. Read current source evidence: public surface, onboarding metadata, workflow inventory, package metadata, extension metadata, lint config, runtime seams, and docs-drift script.
3. Regenerate public surface manifest only if `src/public-surface/source.ts` changed.
4. Regenerate or compare `docs/WORKFLOW_SURFACE_MAP.md`.
5. Update `docs/SURFACE_REFERENCE.md`, `docs/CLI.md`, root `README.md`, and `docs/ARCHITECTURE.md`.
6. Update `docs/FIRST_RUN_ONBOARDING.md` and `docs/README.md`.
7. Update architecture, extension, relay, canvas, and annotation docs.
8. Update root and nested `AGENTS.md` files, respecting explicit maintainer approval for root governance-rule changes.
9. Update troubleshooting and privacy docs.
10. Update parity, roadmap, and landing metrics docs with explicit current, blocked, or historical status.
11. Verify package, lockfile, extension metadata, ESLint, dependency docs, and CI doc gates.
12. Update release, distribution, and current-evidence references after the metadata verification in step 11.
13. Add docs-drift tests only for high-risk claims not already guarded.
14. Run validation in the order below.
15. Record final validation results in the handoff. Update release evidence docs only if the implementation task explicitly includes release evidence updates.

## Validation Sequence

### Focused Source and Generated-Surface Validation

```bash
node scripts/generate-public-surface-manifest.mjs
npm run test -- tests/public-surface-manifest.test.ts
npm run test -- tests/cli-help.test.ts tests/cli-help-parity.test.ts
node scripts/workflow-inventory-report.mjs --markdown-out docs/WORKFLOW_SURFACE_MAP.md
node scripts/docs-drift-check.mjs
```

### Documentation and Package Metadata Validation

```bash
npm run version:check
node scripts/chrome-store-compliance-check.mjs
node scripts/audit-zombie-files.mjs
./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh
npx opendevbrowser --help
npx opendevbrowser help
```

### Full Repo Quality Gate After Documentation Edits

```bash
npm run lint
npm run typecheck
npm run test:release-gate
npm run test
npm run build
npm run extension:build
npm run extension:pack
npm pack --pack-destination /tmp
git diff --check
```

### Validation Acceptance Criteria

- [ ] Docs drift check passes.
- [ ] CLI help parity tests pass.
- [ ] Public surface manifest test passes.
- [ ] Workflow surface map is generated or proven unchanged.
- [ ] Version check passes for root package, lockfile, extension package, and manifest.
- [ ] Chrome store compliance passes when extension docs, privacy docs, store assets, or manifest claims are touched.
- [ ] Skill asset validation passes when first-contact, docs, or skill-linked surfaces are touched.
- [ ] Full quality gate passes before release-facing docs are marked current.

## Open Questions

- None at plan time. If implementation uncovers a governance-rule change in root `AGENTS.md`, stop and request explicit task-scoped maintainer approval before editing that governance rule.
- If private frontend evidence is unavailable, keep landing metrics and private website dependent claims blocked or historical instead of inventing metrics.

## References

- `AGENTS.md`
- `docs/AGENTS.md`
- `scripts/docs-drift-check.mjs`
- `src/public-surface/source.ts`
- `src/cli/help.ts`
- `src/cli/onboarding-metadata.json`
- `scripts/shared/workflow-inventory.mjs`
- `scripts/workflow-inventory-report.mjs`
- `docs/SURFACE_REFERENCE.md`
- `docs/WORKFLOW_SURFACE_MAP.md`
- `docs/LANDING_METRICS_SOURCE_OF_TRUTH.md`
- `docs/OPEN_SOURCE_ROADMAP.md`
- `docs/PARITY_DECLARED_DIVERGENCES.md`
- `docs/privacy.md`
- `docs/ARCHITECTURE.md`
- `docs/DESIGN_CANVAS_TECHNICAL_SPEC.md`
- `docs/EXTENSION_RELEASE_RUNBOOK.md`
- `docs/DISTRIBUTION_PLAN.md`
- `docs/DEPENDENCIES.md`
- `docs/RELEASE_0.0.30_EVIDENCE.md`
- `docs/RELEASE_0.0.31_EVIDENCE.md`
- `src/annotate/AGENTS.md`
- `.github/workflows/pr-checks.yml`
- `docs/plans/inspiredesign-visual-harvest-implementation-plan.md`
- `docs/plans/unify-workflow-output-roots.md`
- `docs/investigations/protected-daemon-build-mismatch-2026-05-18.md`

## Version History

| Version | Date | Change |
|---|---|---|
| 0.1 | 2026-05-19 | Seeded evidence scaffold from RepoPrompt seam mapping. |
| 1.0 | 2026-05-19 | Converted scaffold into executable documentation update plan with dependencies, work items, and validation gates. |
