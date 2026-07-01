# Investigation: Skill Pack and README Current Capability Audit

## Summary
This report records the 2026-07-01 audit that originally found stale README and bundled skill-pack guidance, then the outcome of the `codex/skill-pack-readme-refresh` implementation pass. It covers alignment across `README.md`, `skills/opendevbrowser-best-practices/SKILL.md`, `skills/opendevbrowser-design-agent/SKILL.md`, and `skills/opendevbrowser-motion-design/SKILL.md`.

## Current Branch Outcome
- `README.md` now uses a compact 4-column Table of Contents that omits `Recent Features` and preserves the top-level section order when read down columns.
- `README.md` no longer has a `## Recent Features` section. Historical release-note content remains owned by `CHANGELOG.md`.
- `README.md` now has one consolidated current `## Features` section covering browser sessions and refs, interaction controls, diagnostics, screencast/browser replay, public read-only desktop observation, browser-scoped computer use, provider workflows, Inspiredesign authority, Design Canvas, Annotation V2, skills, and security guardrails.
- The three scoped skill packs now include the generated-help lookup labels `screencast / browser replay`, `desktop observation`, and `computer use / browser-scoped computer use` where they describe those runtime lanes.
- `skills/opendevbrowser-best-practices/SKILL.md` now tells callers to inspect returned `artifact_path` first for normal omitted workflow outputs, and identifies the persisted bundle shape as `.opendevbrowser/<namespace>/<runId>`.
- `skills/opendevbrowser-best-practices/artifacts/command-channel-reference.md` now uses the exact generated-help labels for browser replay, desktop observation, and browser-scoped computer use.

## Historical Findings From Initial Triage
The following observations describe the pre-edit README and skill-pack state at the start of the audit. They are historical evidence, not the current branch state.

- The pre-edit README had a `## Recent Features` section with older version-specific entries (`v0.0.21`, `v0.0.16`, `v0.0.15`, `v0.0.14`) before the broader `## Features` section. The branch outcome removed that section and leaves release history to `CHANGELOG.md`.
- The pre-edit README Table of Contents was a long single-column list and included `Recent Features`. The branch outcome replaced it with the compact 4-column table described above.
- The pre-edit README `## Features` section used older narrow buckets for browser control, page interaction, DevTools, session and macro utilities, and export/clone. The branch outcome replaced those buckets with current capability groups backed by the generated public surface and deeper docs.
- Initial skill-pack guidance needed exact label parity for the first-contact help lookup terms, workflow artifact follow-through, Canvas code-sync and projection details, Annotation V2 compact handoff, and screencast artifact paths. The branch outcome applied those scoped wording updates in the three targeted skill packs.

## Background / Prior Research
Completed explore findings indicated the README Features section under-represented current first-class capability groups even though the public surface and deeper docs were mostly aligned. Source-of-truth surfaces reconciled during the branch include `src/public-surface/source.ts`, `docs/SURFACE_REFERENCE.md`, `docs/CLI.md`, `docs/ARCHITECTURE.md`, `docs/ANNOTATE.md`, `package.json`, and `CHANGELOG.md`.

Recent commits and docs showed the README and skill-pack updates needed to account for Pinterest pin-media readiness authority, the advisory role of `media-analysis.json`, browser replay and browser-scoped computer use labels, canvas governance and code-sync, workspace orchestration, Annotation V2 compact handoff, workflow `artifact_path` conventions, and status-capabilities visibility.

## Investigator Findings

### README.md
- Historical finding: the pre-edit TOC needed replacement with a compact 4-column Markdown table of durable top-level anchors while removing `Recent Features` from the TOC.
- Branch outcome: the README now has a 4-column TOC with 20 durable top-level anchors, no `Recent Features` link, and column-major ordering that matches document order.
- Historical finding: the pre-edit `Recent Features` release-note block was stale compared with current `package.json` and `CHANGELOG.md` release evidence.
- Branch outcome: the README now removes that section entirely and relies on `CHANGELOG.md` for release history.
- Historical finding: the pre-edit Features section was narrower than the current public capability surface.
- Branch outcome: the README now has a unified current `## Features` section covering the current runtime, workflow, evidence, design, annotation, skill, and security lanes.

### skills/opendevbrowser-best-practices/SKILL.md
- Historical finding: the help-led surface bullets needed the exact labels `screencast / browser replay`, `desktop observation`, and `computer use / browser-scoped computer use`.
- Branch outcome: the labels are present in `## Help-Led Surface Discovery` and remain tied to the correct commands and boundary rules.
- Historical finding: omitted workflow output guidance needed to lead with returned `artifact_path`, then `.opendevbrowser/<namespace>/<runId>` for routine artifact-bearing workflows, while preserving screenshot and screencast evidence lane exceptions.
- Branch outcome: the main validated capability lane and direct-run release note both use `artifact_path` first and `.opendevbrowser/<namespace>/<runId>`.
- Historical finding: Pinterest readiness wording needed to preserve `pin-media-index.json` authority, keep `media-analysis.json` advisory, and keep `motion-evidence.json` as browser replay authority.
- Branch outcome: the skill preserves those authority boundaries.
- Historical finding: Canvas and Annotation sections needed current code-sync adapter ids, binding manifest paths, `canvas_html` default projection, `bound_app_runtime` opt-in status, and Annotation V2 compact screenshot-free shared inbox semantics.
- Branch outcome: the skill includes those current details.

### skills/opendevbrowser-best-practices/artifacts/command-channel-reference.md
- Historical finding: the command-channel artifact described the right lanes but did not use all exact generated-help lookup labels.
- Branch outcome: the artifact now uses `screencast / browser replay`, `desktop observation`, and `computer use / browser-scoped computer use` exactly.

### skills/opendevbrowser-design-agent/SKILL.md
- Historical finding: supporting-surface guidance needed to preserve the exact generated-help labels while keeping design-specific browser replay, read-only desktop, and browser-scoped helper boundaries.
- Branch outcome: the design skill includes those labels and preserves the no-desktop-agent boundary.
- Historical finding: Annotation guidance needed to mention Annotation V2 compact handoff and screenshot-free shared inbox storage.
- Branch outcome: stored retrieval guidance now expects Annotation V2 compact payload semantics.

### skills/opendevbrowser-motion-design/SKILL.md
- Historical finding: motion guidance needed to keep `motion-evidence.json` as browser replay authority and avoid over-claiming `media-analysis.json` as readiness proof.
- Branch outcome: the skill preserves those authority semantics.
- Historical finding: screencast verification guidance needed omitted output and `artifact_path` wording.
- Branch outcome: the verification section now identifies `screencast-start` as the browser replay lane and describes omitted `.opendevbrowser/screencast/<uuid>` output plus returned `artifact_path`.

## Authority Boundary Conclusions
- Browser replay authority is the screencast lane, specifically `screencast-start` and `screencast-stop`; replay artifacts stay out of annotation storage.
- Desktop observation is public and read-only, mapped to `desktop-*` commands, and is not a desktop agent or control lane.
- The optional helper bridge is browser-scoped challenge posture only, not desktop authority.
- Canvas workspace remains a refs-only coordinator over child sessions, while code-sync authority belongs to child sessions, leases, binding manifests, and adapters.
- Annotation V2 is compact handoff and screenshot-free shared inbox storage, not replay or screenshot persistence.

## Investigation Log

### Phase 1 - Initial README and Skill Surface Inventory
**Hypothesis:** Current capability guidance should be reconciled around public help, workflow authority, Inspiredesign, design canvas, browser replay, desktop observation, and browser-scoped computer use, rather than preserving older release-note style README messaging.
**Historical findings:** Initial read confirmed the README already advertised 77 CLI commands, 70 tools, generated help lookup labels, browser replay, public read-only desktop observation, and Pinterest pin-media authority near the top, while the pre-edit README still carried historical release-note and older feature-bucket content.
**Branch outcome:** README first-contact messaging, TOC, and Features now align with the current capability surface.

### Phase 1 - Candidate Skill Path Inventory
**Hypothesis:** The three bundled skill packs were the likely guidance sources that needed comparison against README and docs/source truth.
**Findings:** Candidate skill paths existed and stayed in scope:
- `skills/opendevbrowser-best-practices/SKILL.md`
- `skills/opendevbrowser-design-agent/SKILL.md`
- `skills/opendevbrowser-motion-design/SKILL.md`
**Conclusion:** Confirmed. Motion design skill was present and in scope.

### Phase 1 - Capability Alignment Hypotheses
**Hypothesis:** `skills/opendevbrowser-best-practices/SKILL.md` was the richest current source for operational capability guidance and needed verification against README and public-surface docs.
**Historical findings:** Sections inspected included help-led discovery, validated capability lanes, required operating rules, provider workflows, modes and surface parity, skill runtime audit, Canvas governance, diagnostics, fingerprint hardening, and macro guidance.
**Branch outcome:** Best-practices guidance is aligned for exact labels, omitted output roots, artifact handoff, Pinterest authority, Canvas code-sync, and Annotation V2 compact storage.

**Hypothesis:** `skills/opendevbrowser-design-agent/SKILL.md` already encoded much of the design workflow truth, while README needed to surface more of it in the major Features section.
**Branch outcome:** README and design-agent guidance now both expose the relevant design, Canvas, Annotation, browser replay, desktop observation, and browser-scoped helper boundaries.

**Hypothesis:** `skills/opendevbrowser-motion-design/SKILL.md` needed confirmation for Inspiredesign pin-media, `media-analysis.json`, and `motion-evidence.json` authority semantics.
**Branch outcome:** Motion guidance remains aligned and includes screencast omitted output plus `artifact_path` handoff details.

## Root Cause
The drift source was additive documentation across multiple releases. Current capability claims had been added near the top of README and into skill packs, while older README release-note sections and older feature buckets remained until this branch refreshed them.

## Preventive Measures
- Treat README and skill packs as mirrored first-contact surfaces during release docs sweeps.
- Prefer generated public-surface and source-backed capability inventories over historical release summaries.
- Keep a docs review checklist item for README TOC, Features, bundled skill paths, workflow output roots, `artifact_path`, and exact generated-help authority wording whenever workflow guidance changes.
