# Documentation and Skill Pack Realignment Plan

Date: 2026-06-05
Branch: `codex/docs-skill-pack-drift-audit`
Investigation: `docs/investigations/documentation-skill-pack-drift-2026-06-05.md`

## Version History

- 1.0: Initial docs and skill-pack realignment plan.
- 1.1: Implementation review expanded the scope to include focused validator and test hardening where changed count mirrors, workflow artifact routing, and daemon preflight wrappers needed executable coverage. Product runtime behavior remains unchanged.

## Goal

Realign OpenDevBrowser documentation and bundled `skills/opendevbrowser-*` packs with current codebase truth without changing product runtime behavior.

Success criteria:

- Active release docs consistently point to `0.0.34`.
- Public surface counts remain `77` CLI commands, `70` tools, `67` CLI-tool pairs, `59` `/ops`, and `35` `/canvas`.
- First-contact labels match `src/cli/help.ts` and `src/cli/onboarding-metadata.json`.
- Extension readiness guidance requires `fingerprintCurrent`, `extensionConnected`, and `extensionHandshakeComplete`.
- `opsConnected`, `canvasConnected`, and `cdpConnected` are treated as diagnostic or lane-specific fields, not normal extension-readiness requirements.
- Canvas examples that require returned IDs or statuses use `--output-format json`.
- All ten bundled skill packs are either updated or explicitly verified unchanged.
- Root `AGENTS.md` is not edited unless the task has explicit maintainer approval for root governance changes.

## Background

### Source Truth

| Domain | Source of truth |
|---|---|
| Version metadata | `package.json`, `package-lock.json`, `extension/package.json`, `extension/manifest.json` |
| Version sync and parity | `scripts/sync-extension-version.mjs`, `scripts/verify-versions.mjs` |
| Active release evidence | `docs/RELEASE_0.0.34_EVIDENCE.md`, `docs/RELEASE_RUNBOOK.md`, `.github/workflows/release-public.yml` |
| Public surface | `src/public-surface/source.ts`, `src/public-surface/generated-manifest.json`, `scripts/generate-public-surface-manifest.mjs` |
| CLI help and first-contact labels | `src/cli/help.ts`, `src/cli/onboarding-metadata.json` |
| `/ops` inventory | `extension/src/ops/ops-runtime.ts`, `scripts/docs-drift-check.mjs` |
| `/canvas` inventory | `src/browser/canvas-manager.ts`, `tests/canvas-command-inventory.test.ts` |
| Daemon and extension readiness | `src/relay/relay-server.ts`, `docs/CLI.md` |
| Workflow artifact root | `src/providers/workflow-output-root.ts`, `docs/CLI.md` |
| InspireDesign readiness and handoff | `src/inspiredesign/product-readiness.ts`, `src/inspiredesign/handoff.ts`, `src/providers/renderer.ts` |
| Skill pack source | `skills/opendevbrowser-*`, `skills/AGENTS.md` |

### Confirmed Current Facts

- Version source files are aligned at `0.0.34`: `package.json`, `package-lock.json`, `extension/package.json`, and `extension/manifest.json`.
- Generated public-surface counts are `77` CLI commands, `70` tools, `67` CLI-tool pairs, `59` `/ops`, and `35` `/canvas`.
- Public-surface source flows from `src/public-surface/source.ts` through `scripts/generate-public-surface-manifest.mjs` into `src/public-surface/generated-manifest.ts` and `src/public-surface/generated-manifest.json`.
- Help and first-contact wording flow through `src/cli/help.ts` and `src/cli/onboarding-metadata.json`, then mirror into `README.md`, `docs/CLI.md`, `docs/SURFACE_REFERENCE.md`, `docs/EXTENSION.md`, and `extension/README.md`.
- Extension readiness checks must use JSON status output when asserting fields.
- Normal extension readiness is `fingerprintCurrent`, `extensionConnected`, and `extensionHandshakeComplete`.
- `opsConnected`, `canvasConnected`, and `cdpConnected` indicate lane-specific clients or active sessions.
- Omitted workflow outputs default to `.opendevbrowser/<workflow>/<runId>`.
- Explicit `artifacts/release/vX.Y.Z/...` paths are local release-proof outputs, not normal tracked documentation paths.

### Known Drift

- `CHANGELOG.md` lacks a `0.0.34` release section.
- `docs/README.md` treats `0.0.33` as current.
- `docs/DEPENDENCIES.md` and `docs/DISTRIBUTION_PLAN.md` still cite `0.0.32`.
- `docs/ARCHITECTURE.md` points current release evidence at `docs/RELEASE_0.0.32_EVIDENCE.md`.
- `docs/RELEASE_RUNBOOK.md` and `docs/EXTENSION_RELEASE_RUNBOOK.md` metadata predates their current `0.0.34` release facts.
- `src/cli/AGENTS.md` says `72 commands` while generated public-surface truth is `77`.
- `src/tools/AGENTS.md` says `65 tools` while generated public-surface truth is `70`.
- `docs/SURFACE_REFERENCE.md` has small wording drift around public read-only desktop observation and `screencast-stop`.
- `skills/opendevbrowser-best-practices` conflates required extension readiness with diagnostic lane fields.
- Several best-practices examples assert JSON fields without consistently using `--output-format json`.
- URL-backed InspireDesign examples using `--capture-mode off` conflict with current deep-capture behavior unless marked as intentional contract-only exceptions.
- Design-agent Canvas examples that require returned IDs or statuses need JSON output.
- Provider and product-video helper scripts need daemon fingerprint preflight before daemon-backed workflow execution.
- Every nested `AGENTS.md` and `README.md` still needs a final sweep so unchanged files are intentionally verified, not assumed.

### Systemic Cause

The drift is not one isolated stale paragraph. Release metadata, public counts, readiness semantics, workflow examples, and artifact conventions are duplicated across docs and skills, while current validators do not yet catch every stale active-release reference, nested governance count, or status-field assertion. Implementation should fix the known text drift and keep deferred validator gaps visible rather than treating each edit as unrelated copy cleanup.

## Approach

1. Treat source files as authoritative and documentation as mirrors.
2. Keep product runtime behavior unchanged. Focused validation script and test changes are allowed when they directly guard corrected documentation or skill-pack drift.
3. Fix active release docs first because release version drift affects several downstream surfaces.
4. Fix nested governance and public-surface wording before skill packs so skill guidance can reference current doc language.
5. Update high-risk skill packs before lower-risk audit packs.
6. Run validators after each dependency boundary rather than waiting for final closeout.
7. Preserve historical release evidence files unless a minimal status clarification is necessary.
8. Include `CHANGELOG.md` in this pass because it is release-facing and stale against `0.0.34`.
9. Split root `AGENTS.md` into an explicit approval decision. Do not edit it by default.
10. Defer preventive validator expansion unless explicitly approved, because it changes scripts and tests rather than only docs and skills.
11. Treat the nested guidance sweep as complete only after inventorying tracked files with `git ls-files '*AGENTS.md' '*README.md'` and recording each edited or verified-unchanged file in closeout.
12. Treat private website sync as a conditional closeout note unless a changed doc is explicitly mirrored by private website inputs.

## Work Items

### WI-00 - Baseline Source Truth

**Goal:** Confirm the implementation agent starts from the same source truth before changing docs or skills.

**Done when:**

- Version source files report `0.0.34`.
- Generated public-surface counts are confirmed as `77`, `70`, and `67`.
- `/ops` count is confirmed as `59`.
- `/canvas` count is confirmed as `35`.
- All ten bundled skill pack names are inventoried.
- Current untracked plan and investigation docs are preserved.

**Key files:**

- `package.json`
- `package-lock.json`
- `extension/package.json`
- `extension/manifest.json`
- `src/public-surface/generated-manifest.json`
- `src/public-surface/source.ts`
- `extension/src/ops/ops-runtime.ts`
- `src/browser/canvas-manager.ts`
- `skills/opendevbrowser-*`

**Dependencies:** None.

**Size:** S

### WI-01 - Align Release and Package Metadata Docs

**Goal:** Make active release-facing docs match `0.0.34` package and extension metadata truth.

**Done when:**

- `CHANGELOG.md` includes a `0.0.34` release section or another explicit current-release marker.
- Compare links no longer treat `0.0.33` as the latest completed release.
- `docs/README.md` lists `docs/RELEASE_0.0.34_EVIDENCE.md` as current.
- `docs/ARCHITECTURE.md` points current release evidence at `docs/RELEASE_0.0.34_EVIDENCE.md`.
- `docs/DEPENDENCIES.md` source metadata audit reflects `0.0.34`.
- `docs/DISTRIBUTION_PLAN.md` current public package baseline reflects `0.0.34`.
- Historical `0.0.32` and `0.0.33` evidence docs remain historical records.

**Key files:**

- `CHANGELOG.md`
- `docs/README.md`
- `docs/ARCHITECTURE.md`
- `docs/DEPENDENCIES.md`
- `docs/DISTRIBUTION_PLAN.md`
- `docs/RELEASE_0.0.34_EVIDENCE.md` as reference only
- `package.json`, `package-lock.json`, `extension/package.json`, `extension/manifest.json` as reference only

**Dependencies:** WI-00.

**Size:** M

### WI-02 - Refresh Release Runbook Metadata

**Goal:** Remove stale date or current-release ambiguity from release runbooks while preserving release operations.

**Done when:**

- `docs/RELEASE_RUNBOOK.md` metadata no longer conflicts with its `0.0.34` release reference.
- `docs/EXTENSION_RELEASE_RUNBOOK.md` metadata no longer conflicts with its `0.0.34` extension reference.
- Existing release workflow steps remain unchanged.
- Historical evidence files are not rewritten.

**Key files:**

- `docs/RELEASE_RUNBOOK.md`
- `docs/EXTENSION_RELEASE_RUNBOOK.md`
- `.github/workflows/release-public.yml` as reference only
- `docs/RELEASE_0.0.34_EVIDENCE.md` as reference only

**Dependencies:** WI-01.

**Size:** S

### WI-03 - Realign Nested Governance Docs

**Goal:** Update stale nested guidance and explicitly decide whether root governance metadata is in scope.

**Done when:**

- `src/cli/AGENTS.md` reflects `77` CLI commands.
- `src/cli/AGENTS.md` release evidence references point at `docs/RELEASE_0.0.34_EVIDENCE.md`.
- `src/tools/AGENTS.md` reflects `70` tools if its tool-count wording is stale.
- All discoverable nested `AGENTS.md` and `README.md` files are swept for stale active release ledgers, command counts, tool counts, and capability wording.
- The sweep inventory comes from tracked files, using `git ls-files '*AGENTS.md' '*README.md'` or an equivalent command.
- Files without concrete drift are recorded as verified unchanged in closeout.
- Root `AGENTS.md` is not edited unless explicit maintainer approval covers root governance edits.
- If root `AGENTS.md` is not edited, its stale generated metadata is recorded as deferred.

**Key files:**

- `src/cli/AGENTS.md`
- `src/tools/AGENTS.md`
- `docs/AGENTS.md`
- `skills/AGENTS.md`
- `src/desktop/AGENTS.md`
- `src/browser/AGENTS.md`
- `src/canvas/AGENTS.md`
- `extension/README.md`
- `src/challenges/README.md`
- `templates/website-deploy/README.md`
- `AGENTS.md` only if approved

**Dependencies:** WI-00, WI-01.

**Size:** M

### WI-04 - Align Public-Surface Wording Mirrors

**Goal:** Make public docs mirror canonical public-surface and generated-help wording without changing command inventory.

**Done when:**

- `docs/SURFACE_REFERENCE.md` desktop command rows use public read-only desktop observation wording.
- `docs/SURFACE_REFERENCE.md` `screencast-stop` wording matches source wording or is intentionally left with a documented reason.
- `README.md`, `docs/CLI.md`, `docs/EXTENSION.md`, and `extension/README.md` keep exact first-contact labels.
- Public docs distinguish browser replay, public read-only desktop observation, and browser-scoped computer use.
- No doc describes the extension or helper as a desktop agent.

**Key files:**

- `docs/SURFACE_REFERENCE.md`
- `README.md`
- `docs/CLI.md`
- `docs/EXTENSION.md`
- `extension/README.md`
- `src/public-surface/source.ts` as reference only
- `src/cli/help.ts` as reference only
- `src/cli/onboarding-metadata.json` as reference only

**Dependencies:** WI-00, WI-03.

**Size:** S

### WI-05 - Fix Best-Practices Readiness Semantics

**Goal:** Make `opendevbrowser-best-practices` readiness guidance match daemon status truth.

**Done when:**

- Extension readiness requires `data.fingerprintCurrent === true`.
- Extension readiness requires `data.relay.extensionConnected === true`.
- Extension readiness requires `data.relay.extensionHandshakeComplete === true`.
- `opsConnected`, `canvasConnected`, and `cdpConnected` are documented as diagnostic or lane-specific presence fields.
- Legacy `/cdp` readiness is described as active-legacy-session-only.
- Mode matrix expectations no longer require `opsConnected=true` for normal extension readiness.
- Examples that assert JSON fields use `--output-format json`.

**Key files:**

- `skills/opendevbrowser-best-practices/SKILL.md`
- `skills/opendevbrowser-best-practices/assets/templates/mode-flag-matrix.json`
- `skills/opendevbrowser-best-practices/artifacts/command-channel-reference.md`
- `skills/opendevbrowser-best-practices/scripts/odb-workflow.sh`
- `src/relay/relay-server.ts` as reference only
- `docs/CLI.md` as reference only

**Dependencies:** WI-00, WI-04.

**Size:** M

### WI-06 - Realign Best-Practices Workflow Examples

**Goal:** Bring best-practices examples in line with current InspireDesign, shopping, Canvas, and artifact-root conventions.

**Done when:**

- URL-backed `inspiredesign run` examples no longer conflict with deep-capture behavior, or they clearly identify an intentional contract-only exception.
- Contract-only exceptions are not allowed by default. If one is retained, the implementation closeout must name the approver or source-of-truth rationale and point to a validator or doc guard that keeps the exception safe.
- Shopping examples are consistent about `--use-cookies` and `--challenge-automation-mode browser_with_helper` when high-friction provider recovery depends on them.
- Explicit `artifacts/release/vX.Y.Z/...` examples are labeled local-only release proof artifacts.
- Omitted workflow output examples point to `.opendevbrowser/<workflow>/<runId>`.
- Hardcoded public-surface counts remain current and validator-covered.

**Key files:**

- `skills/opendevbrowser-best-practices/SKILL.md`
- `skills/opendevbrowser-best-practices/scripts/odb-workflow.sh`
- `skills/opendevbrowser-best-practices/artifacts/command-channel-reference.md`
- `skills/opendevbrowser-best-practices/assets/templates/surface-audit-checklist.json`
- `src/providers/workflow-output-root.ts` as reference only
- `docs/CLI.md` as reference only
- `src/inspiredesign/handoff.ts` as reference only
- `src/providers/renderer.ts` as reference only

**Dependencies:** WI-05.

**Size:** M

### WI-07 - Realign Design-Agent Canvas and Daemon Examples

**Goal:** Ensure `opendevbrowser-design-agent` examples are parse-safe and readiness-aware.

**Done when:**

- Canvas examples that require returned IDs, statuses, or follow-up fields use `--output-format json`.
- Pinterest extension harvest examples include nearby daemon fingerprint preflight requirements.
- Research harvest workflow keeps current readiness semantics and does not treat diagnostic-only artifacts as design-ready.
- The design-agent validator passes without weakening checks.

**Key files:**

- `skills/opendevbrowser-design-agent/SKILL.md`
- `skills/opendevbrowser-design-agent/artifacts/design-workflows.md`
- `skills/opendevbrowser-design-agent/artifacts/isolated-preview-validation.md`
- `skills/opendevbrowser-design-agent/artifacts/research-harvest-workflow.md`
- `skills/opendevbrowser-design-agent/scripts/design-workflow.sh`
- `skills/opendevbrowser-design-agent/scripts/validate-skill-assets.sh` only if expectations must track changed examples
- `src/browser/canvas-manager.ts` as reference only
- `tests/canvas-command-inventory.test.ts` as reference only
- `src/inspiredesign/product-readiness.ts` as reference only

**Dependencies:** WI-05, WI-06.

**Size:** M

### WI-08 - Enforce Daemon Preflight in Provider Workflow Skill Scripts

**Goal:** Make daemon-backed provider helper scripts check the current daemon fingerprint before invoking workflows that depend on current daemon state.

**Done when:**

- Research wrappers check daemon preflight before `research run`.
- Shopping wrappers check daemon preflight before `shopping run`.
- Product presentation wrappers check daemon preflight before `product-video run`.
- Preflight uses JSON status output when checking daemon fields.
- Workflow execution remains otherwise unchanged after a successful preflight.

**Key files:**

- `skills/opendevbrowser-research/SKILL.md`
- `skills/opendevbrowser-research/scripts/write-artifacts.sh`
- `skills/opendevbrowser-shopping/SKILL.md`
- `skills/opendevbrowser-shopping/scripts/run-shopping.sh`
- `skills/opendevbrowser-product-presentation-asset/SKILL.md`
- `skills/opendevbrowser-product-presentation-asset/scripts/write-manifest.sh`
- `docs/CLI.md` as reference only
- `src/providers/workflow-output-root.ts` as reference only

**Dependencies:** WI-05.

**Size:** M

### WI-09 - Audit Lower-Risk Bundled Skill Packs

**Goal:** Ensure every bundled skill pack is explicitly touched or verified unchanged.

**Done when:**

- All ten `skills/opendevbrowser-*` packs have been audited for stale release versions, stale public counts, readiness field misuse, missing JSON output where fields are parsed, artifact-root confusion, and desktop-agent wording drift.
- Lower-risk packs are either updated surgically or recorded as verified unchanged.
- Motion-design still distinguishes motion evidence, still-image pin media, and video posters correctly.
- Continuity-ledger, data-extraction, form-testing, and login-automation are verified against current session, provenance, and direct-run policy wording.
- All ten validators pass.

**Key files:**

- `skills/opendevbrowser-continuity-ledger/SKILL.md`
- `skills/opendevbrowser-data-extraction/SKILL.md`
- `skills/opendevbrowser-form-testing/SKILL.md`
- `skills/opendevbrowser-login-automation/SKILL.md`
- `skills/opendevbrowser-motion-design/SKILL.md`
- `skills/opendevbrowser-research/SKILL.md`
- `skills/opendevbrowser-shopping/SKILL.md`
- `skills/opendevbrowser-product-presentation-asset/SKILL.md`
- `skills/opendevbrowser-best-practices/SKILL.md`
- `skills/opendevbrowser-design-agent/SKILL.md`

**Dependencies:** WI-05, WI-06, WI-07, WI-08.

**Size:** M

### WI-10 - Decide Preventive Validation Scope

**Goal:** Avoid silently expanding a docs and skills realignment into source or test work.

**Done when:**

- One decision is recorded:
  - Recommended path: defer validator expansion to a follow-up because this pass is docs and skill realignment only.
  - Expanded path: proceed only with explicit approval to modify validation scripts and tests.
- If deferred, known validator gaps are listed in closeout.
- If approved, a separate plan is created before editing `scripts/docs-drift-check.mjs` or tests.
- Existing validators and tests remain required for closeout. Deferred validator gaps do not block closeout unless a currently required gate fails.

**Key files if deferred:**

- Implementation closeout notes only.

**Key files if approved later:**

- `scripts/docs-drift-check.mjs`
- `tests/docs-drift-check.test.ts`
- `tests/skill-workflow-packs.test.ts`
- `tests/skill-runtime-audit.test.ts`

**Dependencies:** WI-01 through WI-09.

**Size:** S if deferred, L if approved.

### WI-11 - Final Validation and Closeout

**Goal:** Prove the docs and skill realignment is internally consistent and ready for review.

**Done when:**

- Version, docs drift, skill validators, public-surface tests, and full repo gates pass.
- Any unavailable or intentionally skipped live gates are documented with rationale.
- Closeout lists changed files, verified-unchanged skill packs, deferred root `AGENTS.md` decision if applicable, and deferred preventive validation if applicable.
- Closeout records whether private website sync is out of scope, unnecessary, or required by changed mirrored docs.
- No generated source files are changed unless their source intentionally changed.

**Key files:**

- All files changed by WI-01 through WI-09.
- Validation references under `scripts/` and `tests/`.

**Dependencies:** WI-01 through WI-10.

**Size:** M

## Validation

### Baseline and Release Validation

```bash
npm run version:check
node scripts/docs-drift-check.mjs
```

### Skill Validators

Run touched validators immediately after each touched pack:

```bash
./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh
./skills/opendevbrowser-design-agent/scripts/validate-skill-assets.sh
./skills/opendevbrowser-motion-design/scripts/validate-skill-assets.sh
```

Run all bundled validators before closeout:

```bash
for f in skills/opendevbrowser-*/scripts/validate-skill-assets.sh; do "$f"; done
```

### Public-Surface and Help Parity Tests

```bash
npm run test -- tests/cli-help.test.ts tests/cli-help-parity.test.ts tests/public-surface-manifest.test.ts tests/docs-drift-check.test.ts tests/canvas-command-inventory.test.ts
```

### Skill Workflow Tests

```bash
npm run test -- tests/skill-workflow-packs.test.ts tests/skill-runtime-audit.test.ts
```

### Release-Facing Gates If Release Docs Changed

```bash
node scripts/chrome-store-compliance-check.mjs
npm run test:release-gate
```

### Full Quality Gates Before Commit-Ready Closeout

```bash
npm run lint
npm run typecheck
npm run build
npm run test
```

### Conditional Canvas Validation

```bash
node scripts/canvas-competitive-validation.mjs --out artifacts/canvas-competitive-validation-report.json
```

Run this only if Canvas docs or examples change materially. Treat `artifacts/...` outputs as local-only unless release evidence policy explicitly says otherwise.

## Open Questions

1. Should root `AGENTS.md` generated metadata be updated?
   Recommended: do not edit root `AGENTS.md` in this pass unless task-scoped maintainer approval is explicitly granted. Nested governance docs can be updated without that approval.
2. How far should validator expansion go?
   Recommended: keep only focused validator and test changes required to guard drift found during this implementation review. Broad preventive validator expansion remains follow-up scope.
3. Should historical release evidence files be edited?
   Recommended: no. Preserve historical ledgers unless adding a minimal status clarification is necessary to prevent active-use confusion.
4. Is private website sync required for any mirrored doc changes?
   Recommended: treat it as a closeout check, not a default implementation task, unless changed files are known private website inputs.

## References

- Investigation: `docs/investigations/documentation-skill-pack-drift-2026-06-05.md`
- Release truth: `package.json`, `package-lock.json`, `extension/package.json`, `extension/manifest.json`
- Version scripts: `scripts/sync-extension-version.mjs`, `scripts/verify-versions.mjs`
- Release docs: `CHANGELOG.md`, `docs/README.md`, `docs/ARCHITECTURE.md`, `docs/DEPENDENCIES.md`, `docs/DISTRIBUTION_PLAN.md`, `docs/RELEASE_RUNBOOK.md`, `docs/EXTENSION_RELEASE_RUNBOOK.md`, `docs/RELEASE_0.0.34_EVIDENCE.md`
- Public surface truth: `src/public-surface/source.ts`, `src/public-surface/generated-manifest.json`, `scripts/generate-public-surface-manifest.mjs`, `scripts/docs-drift-check.mjs`
- Help truth: `src/cli/help.ts`, `src/cli/onboarding-metadata.json`
- Readiness truth: `src/relay/relay-server.ts`, `docs/CLI.md`
- Canvas truth: `src/browser/canvas-manager.ts`, `tests/canvas-command-inventory.test.ts`
- Artifact root truth: `src/providers/workflow-output-root.ts`, `docs/CLI.md`
- InspireDesign truth: `src/inspiredesign/product-readiness.ts`, `src/inspiredesign/handoff.ts`, `src/providers/renderer.ts`
- High-risk skills: `skills/opendevbrowser-best-practices`, `skills/opendevbrowser-design-agent`
- Other bundled packs: `skills/opendevbrowser-continuity-ledger`, `skills/opendevbrowser-data-extraction`, `skills/opendevbrowser-form-testing`, `skills/opendevbrowser-login-automation`, `skills/opendevbrowser-motion-design`, `skills/opendevbrowser-research`, `skills/opendevbrowser-shopping`, `skills/opendevbrowser-product-presentation-asset`
