# Investigation: Documentation and Skill Pack Drift

Date: 2026-06-05
Branch: `codex/docs-skill-pack-drift-audit`

## Summary
Investigation in progress. The goal is to inventory drift across the documentation set, nested governance files, package metadata, README files, and bundled OpenDevBrowser skill packs before implementation begins.

## Symptoms
- Recent OpenDevBrowser capabilities landed across browser replay, desktop observation, canvas/code sync, provider workflows, InspireDesign/Pinterest authority, public surfaces, release gates, and skills.
- Documentation and bundled skills likely describe older workflows, commands, artifact locations, readiness semantics, or validation gates.
- User named a broad update scope including core docs, package metadata, all nested `AGENTS.md` and `README.md` files, and all bundled `skills/opendevbrowser-*` packs.

## Background / Prior Research
- Prior repo memory says broad docs planning must start from governance files, source command metadata, public-surface sources, generated manifests, onboarding metadata, workflow maps, and drift scripts rather than prose-only edits.
- Prior repo memory identifies `docs/AGENTS.md` as the central docs-governance contract and names implementation files that should be treated as documentation source of truth.
- Prior repo memory warns that local-only artifacts such as prompt exports, continuity ledgers, coverage, and workflow output bundles must not be treated as documentation truth.
- Prior repo memory says exact skill labels matter. Use `opendevbrowser-design-agent` and the `skills/opendevbrowser-*` pack names, not shortened aliases, when editing or auditing bundled skills.
- External web research was not needed for this investigation phase; the drift question is repo-local and should be grounded in current workspace truth.

## Investigator Findings
<!-- Pair investigator appends structured findings here with file:line refs, evidence, and conclusions. -->

### Documentation Drift Inventory

#### Update or clarify
- `CHANGELOG.md:21`, `CHANGELOG.md:265-266` still treats `0.0.33` as the latest released section and compares `[Unreleased]` from `v0.0.33...HEAD`. Current package and release truth is `0.0.34` in `package.json:3`, `package-lock.json:3`, `package-lock.json:9`, `extension/package.json:3`, `extension/manifest.json:4`, and `docs/RELEASE_0.0.34_EVIDENCE.md:11-15`. Action: add the `0.0.34` release section or explicitly mark the `0.0.34` release evidence as the current release source, then update compare links.
- `docs/README.md:37-38` calls `docs/RELEASE_0.0.33_EVIDENCE.md` the current release ledger for package `0.0.33`. Action: promote `docs/RELEASE_0.0.34_EVIDENCE.md` to current and move `0.0.33` to historical.
- `docs/ARCHITECTURE.md:466` still names `docs/RELEASE_0.0.32_EVIDENCE.md` as the current version-scoped release ledger, while `docs/RELEASE_RUNBOOK.md:9` and `docs/RELEASE_0.0.34_EVIDENCE.md:34-37` identify `0.0.34`. Action: update the active ledger reference.
- `docs/DEPENDENCIES.md:11-14` records all package and extension version owners as `0.0.32`; current source files are `0.0.34` at `package.json:3`, `package-lock.json:3`, `package-lock.json:9`, `extension/package.json:3`, and `extension/manifest.json:4`. Action: refresh the dependency/version audit.
- `docs/DISTRIBUTION_PLAN.md:21-23` and `docs/DISTRIBUTION_PLAN.md:177` still state the current package baseline is `0.0.32`; `docs/RELEASE_0.0.34_EVIDENCE.md:34-37` records the current aligned version as `0.0.34`. Action: update the active baseline and checklist item.
- `docs/RELEASE_RUNBOOK.md:3` and `docs/EXTENSION_RELEASE_RUNBOOK.md:3` say `Last updated: 2026-05-19`, but both files contain `2026-05-22` and `0.0.34` release-prep truth at `docs/RELEASE_RUNBOOK.md:9` and `docs/EXTENSION_RELEASE_RUNBOOK.md:9`. Action: refresh the last-updated metadata or clarify it is not authoritative.
- `src/cli/AGENTS.md:7` says the CLI has `72 commands`; current public counts are `77` commands and `70` tools in `src/public-surface/generated-manifest.json:2956-2959`, `README.md:15`, and `docs/CLI.md:155-159`. Action: update the CLI count.
- `src/cli/AGENTS.md:140` points final release signoff at `docs/RELEASE_0.0.27_EVIDENCE.md`; current docs guidance points at `docs/RELEASE_0.0.34_EVIDENCE.md` in `docs/AGENTS.md:63-68` and `docs/RELEASE_RUNBOOK.md:9`. Action: update the active ledger reference.
- `AGENTS.md:3` carries generated header metadata from `2026-04-14`, commit `d7d579f`, branch `codex/provider-guidance-live`, while the current audit branch is `codex/docs-skill-pack-drift-audit` at `8def091`. Action: either refresh or remove live-looking generated metadata. Risk: root `AGENTS.md:266-268` requires explicit task-scoped maintainer approval for governance edits.
- `docs/SURFACE_REFERENCE.md:109-114` describes desktop CLI commands without the `public read-only` wording used in source at `src/public-surface/source.ts:638-675` and tool prose at `docs/SURFACE_REFERENCE.md:196-201`. Action: align the CLI command rows with the public read-only desktop observation wording.
- `docs/SURFACE_REFERENCE.md:102` says `screencast-stop` will "Finalize and retrieve" browser replay, while source says "Stop a browser replay screencast capture" at `src/public-surface/source.ts:630-633` and `src/public-surface/source.ts:954-955`. Action: optional wording cleanup if source-exact inventory is desired.

#### Explicitly leave unchanged unless behavior changes
- `README.md` already has the current public-surface counts and first-contact labels at `README.md:15-17`, plus browser-scoped helper and desktop observation boundaries at `README.md:269-279`.
- `docs/CLI.md` already documents generated help ownership, counts, `/ops`, `/canvas`, first-contact labels, and helper boundaries at `docs/CLI.md:8-12`, `docs/CLI.md:155-167`, `docs/CLI.md:179-180`, and `docs/CLI.md:273-285`.
- `docs/SURFACE_REFERENCE.md` count inventory is current at `docs/SURFACE_REFERENCE.md:235` and `docs/SURFACE_REFERENCE.md:351`, and InspireDesign readiness semantics are current at `docs/SURFACE_REFERENCE.md:557-564`.
- `docs/AGENTS.md` is already current for source-of-truth mapping, first-contact wording, release-gate sync points, and active `0.0.34` ledger at `docs/AGENTS.md:11-20` and `docs/AGENTS.md:63-68`.
- Historical release ledgers such as `docs/RELEASE_0.0.32_EVIDENCE.md` and `docs/RELEASE_0.0.33_EVIDENCE.md` should remain historical records unless adding explicit status clarifications.
- Canvas/code-sync docs are aligned with source seams: `docs/DESIGN_CANVAS_TECHNICAL_SPEC.md:43-55`, `docs/DESIGN_CANVAS_TECHNICAL_SPEC.md:166-169`, `docs/CANVAS_BIDIRECTIONAL_CODE_SYNC_TECHNICAL_SPEC.md:24-29`, `docs/CANVAS_BIDIRECTIONAL_CODE_SYNC_TECHNICAL_SPEC.md:34-45`, `docs/CANVAS_ADAPTER_PLUGIN_CONTRACT.md:97-104`, and `docs/CANVAS_ADAPTER_PLUGIN_CONTRACT.md:144-158` match `src/browser/canvas-manager.ts:135-170`, `src/browser/canvas-manager.ts:1909-1964`, and `src/canvas/code-sync/types.ts:1-14`.

### Skill Pack Drift Inventory

#### `skills/opendevbrowser-best-practices`
- Extension readiness is overstated. `skills/opendevbrowser-best-practices/assets/templates/mode-flag-matrix.json:30-33` requires `opsConnected: true`, and `skills/opendevbrowser-best-practices/scripts/odb-workflow.sh:240-244` says to verify `opsConnected=true`. Current truth says `opsConnected` is presence-only at `docs/CLI.md:718-723`, `docs/TROUBLESHOOTING.md:22-34`, and `src/relay/relay-server.ts:1503-1511`. Action: require `data.fingerprintCurrent === true`, `data.relay.extensionConnected === true`, and `data.relay.extensionHandshakeComplete === true`; move `opsConnected`, `canvasConnected`, and `cdpConnected` to diagnostic presence fields.
- Legacy `/cdp` readiness is too easy to misread. `skills/opendevbrowser-best-practices/assets/templates/mode-flag-matrix.json:45-48` expects `cdpConnected: true`, and `skills/opendevbrowser-best-practices/scripts/odb-workflow.sh:252-256` says to verify it while legacy is active. Current truth says `cdpConnected` is expected `false` until a legacy `/cdp` session connects at `docs/CLI.md:723` and `docs/TROUBLESHOOTING.md:27-34`. Action: qualify this as active-legacy-session-only.
- Status probes omit JSON where JSON fields are asserted. `skills/opendevbrowser-best-practices/assets/templates/mode-flag-matrix.json:25` and `skills/opendevbrowser-best-practices/assets/templates/mode-flag-matrix.json:39` use `npx opendevbrowser status --daemon`; JSON checks require `--output-format json`, as shown at `docs/CLI.md:355` and `docs/TROUBLESHOOTING.md:41-44`. Action: add `--output-format json` to those probes.
- Command-channel readiness terms need splitting. `skills/opendevbrowser-best-practices/artifacts/command-channel-reference.md:239-244` lists `extensionConnected`, `extensionHandshakeComplete`, `opsConnected`, `canvasConnected`, and `cdpConnected` together as required readiness/status checks. Action: split required extension readiness from lane-specific diagnostic fields.
- The workflow router conflicts with its own InspireDesign prose. `skills/opendevbrowser-best-practices/SKILL.md:153` says supplied `--url` values now force deep capture, but `skills/opendevbrowser-best-practices/scripts/odb-workflow.sh:87` and `skills/opendevbrowser-best-practices/scripts/odb-workflow.sh:219` print `inspiredesign run ... --url ... --capture-mode off`. Action: remove `--capture-mode off` from URL-backed examples or explain why that path is a contract-only exception.
- Shopping examples are inconsistent on cookies/helper posture. The skill quick start uses `--use-cookies --challenge-automation-mode browser_with_helper` at `skills/opendevbrowser-best-practices/SKILL.md:132-134`, but router `validated-capabilities` examples at `skills/opendevbrowser-best-practices/scripts/odb-workflow.sh:215-225` omit both. Action: align the examples or state when managed mode cookie injection uses configured/imported cookies rather than live extension session reuse.
- Artifact output guidance can imply root `artifacts/` is a normal tracked place. Runtime audit examples use `artifacts/skill-runtime-audit/...` in `skills/opendevbrowser-best-practices/scripts/odb-workflow.sh:200-201`, while workflow defaults write omitted outputs under `.opendevbrowser` per `src/providers/workflow-output-root.ts:3-19` and `docs/CLI.md:595`. Release proof examples use `artifacts/release/vX.Y.Z` at `skills/opendevbrowser-best-practices/scripts/odb-workflow.sh:171-173`, which matches `docs/CLI.md:1749` and `docs/CLI.md:1775`, but should be marked local-only and tied to the active release evidence ledger.
- Hardcoded counts are correct today but fragile. `skills/opendevbrowser-best-practices/SKILL.md:318`, `skills/opendevbrowser-best-practices/artifacts/command-channel-reference.md:9-12`, and `skills/opendevbrowser-best-practices/assets/templates/surface-audit-checklist.json:3-8` match current source counts, but must be regenerated or validator-guarded whenever counts change.

#### `skills/opendevbrowser-design-agent`
- Pinterest harvest workflow uses current readiness artifacts at `skills/opendevbrowser-design-agent/artifacts/research-harvest-workflow.md:84-91` and matches current InspireDesign docs.
- Canvas command examples at `skills/opendevbrowser-design-agent/artifacts/design-workflows.md:92-103` and `skills/opendevbrowser-design-agent/artifacts/isolated-preview-validation.md:61-65` omit `--output-format json` even though follow-up steps require returned IDs and statuses. Action: add `--output-format json` to parse-dependent Canvas examples.
- Pinterest extension harvest examples should repeat the daemon preflight next to the command. Example: `skills/opendevbrowser-design-agent/scripts/design-workflow.sh:70` runs an extension Pinterest harvest; current extension readiness preflight is `npx opendevbrowser status --daemon --output-format json` plus `fingerprintCurrent`, `extensionConnected`, and `extensionHandshakeComplete` per `docs/CLI.md:718-723` and `skills/opendevbrowser-best-practices/SKILL.md:195`.

#### Other bundled packs
- Standalone asset validators passed for all ten packs during this investigation: every `skills/opendevbrowser-*/scripts/validate-skill-assets.sh` exited `0`.
- `opendevbrowser-research`, `opendevbrowser-shopping`, and `opendevbrowser-product-presentation-asset` helper scripts invoke daemon-backed workflows at `skills/opendevbrowser-research/scripts/write-artifacts.sh:16`, `skills/opendevbrowser-shopping/scripts/run-shopping.sh:18`, and `skills/opendevbrowser-product-presentation-asset/scripts/write-manifest.sh:17`. Action: add preflight comments or helper guidance before provider or product-video workflow commands.
- `opendevbrowser-motion-design` is aligned on pin-media and motion authority: `skills/opendevbrowser-motion-design/SKILL.md:44` tells agents to inspect `motion-evidence.json`, `pin-media-evidence.json`, `pin-media-index.json`, and to treat video posters as still-image cues only.
- No major CLI/source drift was found in `opendevbrowser-continuity-ledger`, `opendevbrowser-data-extraction`, `opendevbrowser-form-testing`, or `opendevbrowser-login-automation` beyond the shared recommendation to keep daemon preflight and artifact-root guidance consistent.

### Source-of-Truth Map

- Package and extension versions: `package.json:3`, `package-lock.json:3`, `package-lock.json:9`, `extension/package.json:3`, `extension/manifest.json:4`; validate with `npm run version:check` or `node scripts/verify-versions.mjs`.
- Active release evidence: `docs/RELEASE_0.0.34_EVIDENCE.md:1-15`, `docs/RELEASE_0.0.34_EVIDENCE.md:34-37`, and `docs/RELEASE_0.0.34_EVIDENCE.md:72-80`.
- Public CLI/tool manifest: `src/public-surface/source.ts:709-711`, `src/public-surface/generated-manifest.json:2956-2959`, `src/cli/help.ts:545-551`, and `tests/public-surface-manifest.test.ts:16-19`.
- `/ops` count extraction: `scripts/docs-drift-check.mjs:16-37` parses `case "..."` labels from `extension/src/ops/ops-runtime.ts` and compares docs at `scripts/docs-drift-check.mjs:721-745`.
- `/canvas` commands: `src/browser/canvas-manager.ts:135-170`; count guarded by `tests/canvas-command-inventory.test.ts:44-50`.
- First-contact wording: `src/cli/help.ts` owns the generated `Find It Fast` block; docs mirror it at `docs/CLI.md:273-285`, `README.md:269-279`, and `docs/SURFACE_REFERENCE.md:25-26`.
- Browser-scoped helper and desktop observation boundary: `docs/CLI.md:718-723`, `docs/SURFACE_REFERENCE.md:341-342`, `src/challenges/README.md:10-14`, `src/desktop/AGENTS.md:3-50`.
- InspireDesign product readiness: `src/inspiredesign/product-readiness.ts:20-21`, `src/inspiredesign/product-readiness.ts:1005-1008`, `src/providers/renderer.ts:221-229`, `src/providers/renderer.ts:1248-1250`, and tests at `tests/public-surface-manifest.test.ts:81-99`.
- Pin-media handoff artifacts: `src/inspiredesign/handoff.ts:15`, `src/inspiredesign/handoff.ts:78`, `src/inspiredesign/handoff.ts:160-164`, and `docs/CLI.md:569-586`.
- Workflow artifact root: `src/providers/workflow-output-root.ts:3-19` and `docs/CLI.md:595`.
- Canvas/code-sync: `src/browser/canvas-manager.ts:135-170`, `src/browser/canvas-manager.ts:1909-1964`, `src/canvas/code-sync/types.ts:1-14`, `docs/DESIGN_CANVAS_TECHNICAL_SPEC.md:166-169`, and `docs/CANVAS_BIDIRECTIONAL_CODE_SYNC_TECHNICAL_SPEC.md:34-57`.

### Validation Plan

Commands already run during this investigation:
```bash
node scripts/docs-drift-check.mjs
./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh
./skills/opendevbrowser-design-agent/scripts/validate-skill-assets.sh
./skills/opendevbrowser-motion-design/scripts/validate-skill-assets.sh
for f in skills/opendevbrowser-*/scripts/validate-skill-assets.sh; do "$f"; done
```
All exited `0`. `node scripts/docs-drift-check.mjs` reported source counts `77` CLI commands, `70` tools, `59` `/ops` command names, and `35` `/canvas` command names.

Follow-up implementation validation should run:
```bash
npm run version:check
node scripts/docs-drift-check.mjs
node scripts/chrome-store-compliance-check.mjs
./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh
./skills/opendevbrowser-design-agent/scripts/validate-skill-assets.sh
./skills/opendevbrowser-motion-design/scripts/validate-skill-assets.sh
for f in skills/opendevbrowser-*/scripts/validate-skill-assets.sh; do "$f"; done
npm run test -- tests/cli-help-parity.test.ts tests/public-surface-manifest.test.ts tests/docs-drift-check.test.ts tests/skill-workflow-packs.test.ts tests/skill-runtime-audit.test.ts tests/canvas-command-inventory.test.ts
npm run test -- tests/inspiredesign-product-readiness.test.ts tests/inspiredesign-pinterest-pin-media-evidence.test.ts
node scripts/canvas-competitive-validation.mjs --out artifacts/canvas-competitive-validation-report.json
npm run test:release-gate
```
If any source, docs, or skills that mirror website inputs change, follow `docs/AGENTS.md:75-82` for private website sync validation.

### Recommended Implementation Order

1. Package/release metadata docs: update `CHANGELOG.md`, `docs/README.md`, `docs/ARCHITECTURE.md`, `docs/DEPENDENCIES.md`, `docs/DISTRIBUTION_PLAN.md`, and run `npm run version:check` plus `node scripts/docs-drift-check.mjs`.
2. Nested governance drift: update `src/cli/AGENTS.md`; update root `AGENTS.md` generated header only if maintainer approval covers root governance-file edits.
3. Public surface wording: adjust the small `docs/SURFACE_REFERENCE.md` desktop CLI wording and optional screencast-stop wording, then run public-surface and help tests.
4. Best-practices readiness semantics: fix `mode-flag-matrix.json`, `command-channel-reference.md`, and `odb-workflow.sh` readiness/status guidance.
5. Skill workflow examples: align InspireDesign `--capture-mode off`, shopping cookie/helper examples, Canvas `--output-format json` examples, and daemon preflight comments in workflow scripts.
6. Validation pass: run the full command set in the Validation Plan and record outcomes in the active implementation plan or release evidence doc if behavior changes.

### Open Risks or Unknowns

- Root `AGENTS.md` governance edits need explicit task-scoped maintainer approval if the update is considered governance, even for metadata at `AGENTS.md:3`.
- `CHANGELOG.md` was outside the user’s candidate list but is release-facing and clearly stale against `0.0.34`; confirm whether the follow-up implementation should include it.
- `docs-drift-check` passes today despite stale version references in `docs/DEPENDENCIES.md`, `docs/DISTRIBUTION_PLAN.md`, `docs/README.md`, `docs/ARCHITECTURE.md`, and nested `AGENTS.md`; coverage should be expanded if those drifts must be prevented.
- Artifact examples under root `artifacts/` remain valid for explicit release proof paths, but they are local-only and easy to confuse with commit-ready docs. Add explicit local-only wording rather than moving release evidence paths blindly.
- Some skill examples intentionally use tool-call syntax such as `opendevbrowser_snapshot sessionId="<session-id>" format="actionables"`; current tool schemas still support those names, so do not rewrite them solely for style.

## Investigation Log

### Phase 0 - Workspace Verification
**Hypothesis:** RepoPrompt must be bound to the OpenDevBrowser workspace before broad context gathering.
**Findings:** Bound RepoPrompt to `/Users/bishopdotun/Documents/DevProjects/opendevbrowser` and created branch `codex/docs-skill-pack-drift-audit`.
**Evidence:** `git status` reported branch `codex/docs-skill-pack-drift-audit` with no changes before this report was added.
**Conclusion:** Confirmed.

### Phase 1 - Initial Triage
**Hypothesis:** The update scope spans docs, package metadata, nested governance files, README files, skill packs, validation scripts, generated public surfaces, and source command or workflow definitions.
**Findings:** Confirmed by RepoPrompt context-builder selection and initial synthesis. Highest-risk drift themes are package/release metadata, validation-gate documentation, duplicated CLI/tool counts, first-contact capability wording, InspireDesign/Pinterest readiness semantics, skill-pack quick starts, and canvas/code-sync docs.
**Evidence:** Context-builder selected docs, source-of-truth public surface files, package metadata, generated manifests, validation scripts, nested governance files, README files, and all bundled `skills/opendevbrowser-*` packs.
**Conclusion:** Confirmed.

### Phase 2 - Broad Context Gathering
**Hypothesis:** The broad documentation update needs code-led context, not prose-only review.
**Findings:** RepoPrompt selected 64 initial files, then the selection was expanded with generated manifests, release docs, drift scripts, nested governance docs, extension metadata, Canvas source seams, InspireDesign readiness seams, and skill validators.
**Evidence:** Current selection includes `src/public-surface/source.ts`, `src/public-surface/generated-manifest.ts`, `src/cli/help.ts`, `src/cli/onboarding-metadata.json`, `scripts/docs-drift-check.mjs`, `scripts/skill-runtime-audit.mjs`, `docs/CLI.md`, `docs/SURFACE_REFERENCE.md`, `docs/DEPENDENCIES.md`, `docs/DISTRIBUTION_PLAN.md`, `docs/EXTENSION_RELEASE_RUNBOOK.md`, package metadata, nested `AGENTS.md` files, and all bundled skill packs.
**Conclusion:** Confirmed.

## Root Cause
Documentation and bundled skill packs drifted because release metadata, public-surface counts, readiness semantics, workflow examples, and artifact conventions are duplicated across many files without complete validator coverage. Source-of-truth files advanced to `0.0.34`, current public counts, updated extension readiness semantics, and newer provider or Canvas workflows, but older prose and skill examples were not consistently refreshed.

A secondary cause is that existing validation catches some generated-surface drift, but not stale version references, outdated release-ledger references, nested governance metadata, or skill workflow guidance that asserts JSON fields without using JSON output.

## Recommendations

### Workstream 1 - Release and package metadata docs

- Update `CHANGELOG.md`, `docs/README.md`, `docs/ARCHITECTURE.md`, `docs/DEPENDENCIES.md`, and `docs/DISTRIBUTION_PLAN.md`.
- Align active release references to `0.0.34`.
- Keep historical `0.0.32` and `0.0.33` evidence ledgers unchanged unless adding status clarification.
- Run `npm run version:check` and `node scripts/docs-drift-check.mjs`.
- Ambiguity: `CHANGELOG.md` was outside the user’s original candidate list but is release-facing and clearly stale. Include it in the implementation unless scope is narrowed.

### Workstream 2 - Governance and nested agent guidance

- Update `src/cli/AGENTS.md` command count from `72` to current public counts.
- Update its active release evidence reference to `docs/RELEASE_0.0.34_EVIDENCE.md`.
- Refresh or remove root `AGENTS.md` generated metadata only if explicitly approved.
- Approval required: root `AGENTS.md` governance edits need task-scoped maintainer approval.

### Workstream 3 - Public-surface wording cleanup

- Align `docs/SURFACE_REFERENCE.md` desktop command wording with the public read-only desktop observation language.
- Optionally align `screencast-stop` wording with source text.
- Run public-surface and help parity tests listed in the validation plan.

### Workstream 4 - Best-practices skill readiness semantics

- In `opendevbrowser-best-practices`, split required extension readiness from diagnostic lane fields.
- Require `fingerprintCurrent === true`, `extensionConnected === true`, and `extensionHandshakeComplete === true`.
- Treat `opsConnected`, `canvasConnected`, and `cdpConnected` as diagnostic or lane-specific presence fields.
- Add `--output-format json` wherever JSON fields are asserted.
- Clarify legacy `/cdp` readiness as active-legacy-session-only.

### Workstream 5 - Skill workflow examples

- Remove or justify `--capture-mode off` from URL-backed InspireDesign examples.
- Align shopping examples on cookies and browser helper posture.
- Add `--output-format json` to Canvas examples that require returned IDs or statuses.
- Add daemon preflight comments before provider and product-video workflow scripts.
- Mark root `artifacts/` release proof examples as local-only.

### Workstream 6 - Validation pass

- Run the full follow-up validation set from this report, including version checks, docs drift checks, skill asset validation, targeted tests, Canvas competitive validation, and release-gate tests.

## Preventive Measures
- Expand `docs-drift-check` to catch stale version and active release-ledger references in docs and nested governance files.
- Add validator coverage for skill readiness semantics, especially JSON field assertions that lack `--output-format json`.
- Guard hardcoded public counts in skill packs with regeneration or tests.
- Add checks that artifact examples distinguish local-only release proof paths from normal committed documentation paths.
- Keep source-of-truth ownership explicit: package versions from package and extension metadata, public counts from generated manifest and source, readiness semantics from CLI and relay source, and workflow artifact roots from provider output-root source.
- UNCONFIRMED: complete coverage of every nested `README.md` and `AGENTS.md` file should be verified again during implementation review, because the current report has strong examples but not a dedicated line-by-line finding for every nested file.
