# Investigation: Skill Pack and README Current Capability Audit

## Summary
Initial triage report for auditing stale README and bundled skill-pack guidance against the current OpenDevBrowser capability surface. The immediate investigation target is alignment across `README.md`, `skills/opendevbrowser-best-practices/SKILL.md`, `skills/opendevbrowser-design-agent/SKILL.md`, and the present motion design skill at `skills/opendevbrowser-motion-design/SKILL.md`.

## Symptoms
- Skill-pack guidance may be stale or internally uneven across best practices, design-agent, and motion-design packs, especially around Inspiredesign readiness, Pinterest pin-media authority, browser replay, desktop observation, browser-scoped computer use, `/canvas`, and workflow artifact follow-through.
- `README.md` still has a `## Recent Features` section with old version-specific entries (`v0.0.21`, `v0.0.16`, `v0.0.15`, `v0.0.14`) before the broader `## Features` section, which may bury current capability messaging and duplicate or conflict with the changelog.
- `README.md` Table of Contents is a long single-column list and still includes `Recent Features`; the current task expects investigation toward a compact 4-column TOC and a current, consolidated Features section.

## Background / Prior Research
Completed explore findings indicate the README Features section under-represents current first-class capability groups even though the public surface and deeper docs are mostly aligned. Current source-of-truth surfaces to reconcile include `src/public-surface/source.ts` workflow commands plus screencast/browser replay and desktop observation wording, `docs/SURFACE_REFERENCE.md` CLI/tool inventory, `docs/CLI.md` capability families, and `docs/ARCHITECTURE.md` surface counts.

Recent commits and docs indicate README and skill-pack updates should account for Pinterest pin-media readiness authority, the advisory role of `media-analysis.json`, browser replay and browser-scoped computer use labels, canvas governance/code-sync/workspace orchestration, Annotation V2 compact handoff, workflow `artifact_path` conventions, and status-capabilities visibility.

Exact candidate paths for follow-up alignment are `README.md`, `skills/opendevbrowser-best-practices/SKILL.md`, `skills/opendevbrowser-design-agent/SKILL.md`, `skills/opendevbrowser-motion-design/SKILL.md`, `docs/CLI.md`, `docs/SURFACE_REFERENCE.md`, `docs/ARCHITECTURE.md`, `docs/ANNOTATE.md`, and `src/public-surface/source.ts`. Do not implement README or skill changes from this report without a separate scoped implementation pass.

## Investigator Findings

### 2026-07-01 Pair Investigator Findings - Current capability alignment

Scope verified read-only except this report and `sub_continuity.md`. RepoPrompt window routing was confirmed for `/Users/bishopdotun/Documents/DevProjects/opendevbrowser` with window 2, and three read-only explore probes covered README stale language, skill-to-doc parity, and motion/design authority boundaries.

#### README.md
- `README.md:25-47` is still a long single-column TOC and `README.md:32` links to `Recent Features`. Exact edit strategy: replace the TOC with a compact 4-column Markdown table of durable top-level anchors and remove `Recent Features` from the TOC.
- `README.md:289-320` is stale release-note content for `v0.0.21`, `v0.0.16`, `v0.0.15`, and `v0.0.14`, while current package and changelog evidence is `package.json:3` at `0.0.37` and `CHANGELOG.md:10` at `0.0.37`. Exact edit strategy: delete the whole `Recent Features` section and leave release history to `CHANGELOG.md`.
- `README.md:322-358` has an older narrow Features section limited to browser control, page interaction, DevTools, session and macro utilities, and export/clone. Current source-backed surfaces include the 77 command and 70 tool inventory at `README.md:15`, generated help lookup labels at `docs/CLI.md:270-283` and `docs/SURFACE_REFERENCE.md:24-26`, workflow and Inspiredesign authority guidance at `docs/CLI.md:585-624`, Canvas/code-sync at `docs/CLI.md:1140-1141`, Annotation V2 at `docs/CLI.md:1291-1295`, browser replay at `docs/CLI.md:1461-1463`, and desktop observation at `docs/SURFACE_REFERENCE.md:108-114`. Exact edit strategy: rewrite `README.md:322-358` into one unified current `## Features` section covering browser sessions and refs, interaction controls, capture/replay/diagnostics, public read-only desktop observation, browser-scoped computer use and challenge boundaries, workflow wrappers, Inspiredesign and Canvas handoff, design canvas and annotation, export/code generation, skills/onboarding, and security guardrails.

#### skills/opendevbrowser-best-practices/SKILL.md
- `skills/opendevbrowser-best-practices/SKILL.md:85-88` uses readable lane names but not the exact generated-help lookup labels. `docs/CLI.md:270-283` and `docs/SURFACE_REFERENCE.md:24-26` require `screencast / browser replay`, `desktop observation`, and `computer use / browser-scoped computer use`. Exact edit strategy: update these bullets to include the exact labels while preserving the existing command lists and boundary rules at `skills/opendevbrowser-best-practices/SKILL.md:90-93`.
- `skills/opendevbrowser-best-practices/SKILL.md:105` correctly tells agents to inspect `artifact_path`, but it is narrower than `docs/CLI.md:622`, `docs/SURFACE_REFERENCE.md:592`, `docs/SURFACE_REFERENCE.md:596`, and `docs/SURFACE_REFERENCE.md:598`. Exact edit strategy: expand this paragraph so artifact-bearing workflow success payloads use `artifact_path`, omitted routine bundles write under `.opendevbrowser/<namespace>/<runId>`, and browser evidence omitted outputs use `.opendevbrowser/screenshot/<uuid>/capture.png` or `.opendevbrowser/screencast/<uuid>` with caller-controlled explicit paths unchanged.
- Pinterest readiness wording is semantically aligned at `skills/opendevbrowser-best-practices/SKILL.md:161-170`: it requires top-level `ready=true`, `productSuccess=true`, `artifactAuthority=product_ready`, `evidenceAuthority=pin_media_ready`, non-empty ranked references, and manifest-backed `pin-media-index.json`, while keeping `media-analysis.json` advisory and `motion-evidence.json` as browser replay authority. Exact edit strategy: no semantic rewrite needed; optionally mirror the docs phrase `pin-media-first` near `skills/opendevbrowser-best-practices/SKILL.md:164` for grep parity with `docs/CLI.md:613` and `docs/SURFACE_REFERENCE.md:582`.
- `skills/opendevbrowser-best-practices/SKILL.md:418-430` is broadly aligned on Canvas workspace and projection, but it omits code-sync adapter ids and manifest path details from `docs/CLI.md:1141` and `docs/SURFACE_REFERENCE.md:437-438`. Exact edit strategy: add two code-sync bullets listing current built-in lanes `builtin:react-tsx-v2`, `builtin:html-static-v1`, `builtin:custom-elements-v1`, `builtin:vue-sfc-v1`, and `builtin:svelte-sfc-v1`; state bound source manifests live under `.opendevbrowser/canvas/code-sync/<documentId>/<bindingId>.json`; and keep `canvas_html` as default projection with `bound_app_runtime` opt-in only after runtime bridge preflight.
- `skills/opendevbrowser-best-practices/SKILL.md:432` under-specifies Annotation V2. `docs/CLI.md:1291-1295`, `docs/SURFACE_REFERENCE.md:478-482`, and `docs/ANNOTATE.md:144-148` require compact screenshot-free shared inbox semantics. Exact edit strategy: extend the annotation bullet to say Annotation remains separate, new captures and stored payloads use Annotation V2 compact handoff by default, include `schemaVersion: 2`, `compact.screenshotMode="none"`, redaction metadata, selector bundles, canvas identity when available, and screenshot-free shared inbox storage; `annotate --stored` resolves shared repo-local inbox first, then extension-local fallback.

#### skills/opendevbrowser-design-agent/SKILL.md
- `skills/opendevbrowser-design-agent/SKILL.md:75-81` has correct supporting-surface boundaries, but does not preserve the exact generated-help labels from `docs/CLI.md:270-283`. Exact edit strategy: add one short Supporting Surfaces bullet naming `screencast / browser replay`, `desktop observation`, and `computer use / browser-scoped computer use`, then keep existing design-specific browser replay, read-only desktop, and browser-scoped helper guidance.
- `skills/opendevbrowser-design-agent/SKILL.md:86` is aligned on Pinterest harvest readiness and correctly rejects `snapshot_ready` and `motion_ready` as substitutes for `pin_media_ready`. Exact edit strategy: no change required.
- `skills/opendevbrowser-design-agent/SKILL.md:209` is aligned on Canvas workspace refs-only orchestration and child-owned documents, leases, code-sync bindings, previews, and feedback. Exact edit strategy: no required change.
- `skills/opendevbrowser-design-agent/SKILL.md:216` records delivered versus stored annotation outcomes but does not mention Annotation V2 compact payload semantics. Exact edit strategy: append one sentence that stored retrieval should expect Annotation V2 compact handoff and screenshot-free shared inbox storage.

#### skills/opendevbrowser-motion-design/SKILL.md
- `skills/opendevbrowser-motion-design/SKILL.md:44` is aligned on Inspiredesign/Pinterest authority: pin media requires `pin_media_ready`, `media-analysis.json` supplies sampled saved-media cues only, and `motion-evidence.json` is browser replay authority. Exact edit strategy: no semantic change required.
- `skills/opendevbrowser-motion-design/SKILL.md:93-104` correctly requires real-browser temporal proof with snapshot, screenshot, debug trace, `screencast-start`, interactions, `screencast-stop`, console/network checks, viewport checks, reduced-motion checks, and Canvas preview evidence. It does not mention omitted screencast output roots or `artifact_path`. Exact edit strategy: add one Verification bullet saying `screencast-start` is the browser replay lane, omitted output writes `.opendevbrowser/screencast/<uuid>`, and JSON includes `artifact_path`, matching `docs/CLI.md:1461-1463` and `docs/SURFACE_REFERENCE.md:104-106`.

#### Authority boundary conclusions
- Browser replay authority is the screencast lane, specifically `screencast-start` and `screencast-stop`; replay artifacts stay out of annotation storage per `docs/ANNOTATE.md:147-148`.
- Desktop observation is public and read-only, mapped to `desktop-*` commands, and is not a desktop agent or control lane per `docs/SURFACE_REFERENCE.md:108-114` and `docs/SURFACE_REFERENCE.md:341-342`.
- The optional helper bridge is browser-scoped challenge posture only, not desktop authority, per `docs/SURFACE_REFERENCE.md:337-342`.
- Canvas workspace remains a refs-only coordinator over child sessions, while code-sync authority belongs to child sessions, leases, binding manifests, and adapters per `docs/SURFACE_REFERENCE.md:416-440`.
- Annotation V2 is compact handoff and screenshot-free shared inbox storage, not replay or screenshot persistence, per `docs/CLI.md:1291-1295` and `docs/ANNOTATE.md:144-148`.

#### Files to select for follow-up chat or implementation planning
- Required full or sliced context: `README.md`, `skills/opendevbrowser-best-practices/SKILL.md`, `skills/opendevbrowser-design-agent/SKILL.md`, `skills/opendevbrowser-motion-design/SKILL.md`, `docs/CLI.md`, `docs/SURFACE_REFERENCE.md`, `docs/ANNOTATE.md`, `src/public-surface/source.ts`, `package.json`, `CHANGELOG.md`, and this investigation report.
- Use slices for large docs if token budget matters: `docs/CLI.md:260-285`, `docs/CLI.md:585-626`, `docs/CLI.md:1084-1145`, `docs/CLI.md:1288-1298`, `docs/CLI.md:1450-1468`; `docs/SURFACE_REFERENCE.md:20-30`, `docs/SURFACE_REFERENCE.md:95-125`, `docs/SURFACE_REFERENCE.md:335-345`, `docs/SURFACE_REFERENCE.md:364-440`, `docs/SURFACE_REFERENCE.md:478-482`, `docs/SURFACE_REFERENCE.md:580-598`; `src/public-surface/source.ts:640-680`, `src/public-surface/source.ts:880-905`.


## Investigation Log

### Phase 1 - Initial README and Skill Surface Inventory
**Hypothesis:** Current capability guidance should be reconciled around public help, workflow authority, Inspiredesign, design canvas, browser replay, desktop observation, and browser-scoped computer use, rather than preserving older release-note style README messaging.
**Findings:** Initial read confirms the README already advertises 77 CLI commands, 70 tools, generated help lookup labels, browser replay, public read-only desktop observation, and Pinterest pin-media authority near the top, but its `Recent Features` section is historical and its `Features` section is older and narrower than the current capability list.
**Evidence:** `README.md:17-20`, `README.md:25-46`, `README.md:60-68`, `README.md:289-320`, `README.md:322-358`.
**Conclusion:** Needs deeper alignment pass before editing.

### Phase 1 - Candidate Skill Path Inventory
**Hypothesis:** The three bundled skill packs are the likely guidance sources that must be compared against README and docs/source truth.
**Findings:** Candidate skill paths exist:
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/skills/opendevbrowser-best-practices/SKILL.md`
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/skills/opendevbrowser-design-agent/SKILL.md`
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/skills/opendevbrowser-motion-design/SKILL.md`
**Evidence:** RepoPrompt path search found all three `SKILL.md` files under `skills/`.
**Conclusion:** Confirmed. Motion design skill is present and in scope.

### Phase 1 - Capability Alignment Hypotheses
**Hypothesis:** `skills/opendevbrowser-best-practices/SKILL.md` is likely the richest current source for operational capability guidance and should be checked against README and public-surface docs.
**Findings:** Sections to inspect include `## Help-Led Surface Discovery`, `## Validated Capability Lanes`, `## Agent Sync Targets`, `## Required Operating Rules`, `## Parallel Operations (Reliable As-Is)`, `## Known-Issue Robustness Baseline`, `## Provider Workflows (Codified)`, `## Workflow Router Script`, `## Modes and Surface Parity`, `## Skill Runtime Audit and Realignment`, `## Canvas Governance Handshake`, `## Diagnostics and Traceability`, `## Fingerprint Hardening`, and `## Macro Guidance`.
**Evidence:** `skills/opendevbrowser-best-practices/SKILL.md:81`, `skills/opendevbrowser-best-practices/SKILL.md:95`, `skills/opendevbrowser-best-practices/SKILL.md:349`, `skills/opendevbrowser-best-practices/SKILL.md:364`, `skills/opendevbrowser-best-practices/SKILL.md:454`.
**Conclusion:** Needs verification against `docs/CLI.md`, `docs/SURFACE_REFERENCE.md`, generated public surface, and README.

**Hypothesis:** `skills/opendevbrowser-design-agent/SKILL.md` may already encode current design workflow truth, but README may not surface enough of it in the major Features section.
**Findings:** Sections to inspect include `## Supporting Surfaces`, `## Core Rules`, `## Design Contract`, `/canvas` required generation plan fields, `## Recommended Workflow Modes`, `research-harvest`, `canvas-contract`, `real-surface-validation`, `performance-audit`, `release-gate`, `## Research-Backed Patterns`, `## Parallel Multitab Alignment`, and `## Robustness Coverage (Known-Issue Matrix)`.
**Evidence:** `skills/opendevbrowser-design-agent/SKILL.md:75`, `skills/opendevbrowser-design-agent/SKILL.md:83`, `skills/opendevbrowser-design-agent/SKILL.md:119`, `skills/opendevbrowser-design-agent/SKILL.md:156`, `skills/opendevbrowser-design-agent/SKILL.md:191`.
**Conclusion:** Needs comparison to current README Feature framing and Canvas/Inspiredesign docs.

**Hypothesis:** `skills/opendevbrowser-motion-design/SKILL.md` should be checked for consistent authority semantics with Inspiredesign pin-media, `media-analysis.json`, and `motion-evidence.json`.
**Findings:** Sections to inspect include `## InspireDesign Harvest Inputs`, `## Motion Contract`, `## Pattern Selection`, `## Platform And Framework Policy`, `## Device Posture`, `## Reduced Motion`, `## Verification`, and `## Anti-patterns`.
**Evidence:** `skills/opendevbrowser-motion-design/SKILL.md:42`, `skills/opendevbrowser-motion-design/SKILL.md:46`, `skills/opendevbrowser-motion-design/SKILL.md:61`, `skills/opendevbrowser-motion-design/SKILL.md:75`, `skills/opendevbrowser-motion-design/SKILL.md:89`.
**Conclusion:** Needs confirmation that motion guidance does not overclaim replay or dependency authority.

### Phase 1 - README Section Headings To Investigate
**Hypothesis:** README cleanup should focus on headings that affect first-contact comprehension and current capability positioning.
**Findings:** Candidate README headings for investigation:
- `# OpenDevBrowser`
- `## Table of Contents`
- `## Use It Your Way`
- `## Why OpenDevBrowser?`
- `## Quick Start`
- `### Help-Led Discovery`
- `## Challenge Handling Boundary`
- `## Recent Features`
- `### v0.0.21`
- `### v0.0.16`
- `### v0.0.15`
- `### v0.0.14`
- `## Features`
- `### Browser Control`
- `### Page Interaction`
- `### DevTools Integration`
- `### Session & Macro Utilities`
- `### Export & Clone`
- `## Tool Reference`
- `## Bundled Skills`
- `## Browser Modes`
- `## Relay Channels`
- `## CLI Commands`
- `## Architecture`
**Evidence:** `README.md:1`, `README.md:25`, `README.md:49`, `README.md:60`, `README.md:188`, `README.md:267`, `README.md:275`, `README.md:289`, `README.md:322`, `README.md:360`, `README.md:486`, `README.md:526`, `README.md:544`, `README.md:727`, `README.md:838`.
**Conclusion:** These are the likely README edit targets after investigation, especially TOC, Recent Features, Features, Tool Reference, Bundled Skills, Browser Modes, Relay Channels, and CLI Commands.

## Root Cause
Preliminary only: the likely drift source is additive documentation over multiple releases. Current capability claims were added near the top of README and into skill packs, while older README release-note sections and older feature buckets stayed in place.

## Recommendations
1. Run the full investigation against current source-of-truth files before editing: `src/public-surface/source.ts`, generated manifest files, `docs/CLI.md`, `docs/SURFACE_REFERENCE.md`, and relevant Inspiredesign/Canvas docs.
2. Compare README `Recent Features`, `Features`, `Tool Reference`, `Bundled Skills`, and `CLI Commands` against the three candidate skill packs and generated public surface.
3. If confirmed, merge `Recent Features` into a current major `Features` section and update the TOC to the requested compact 4-column shape.
4. Keep authority semantics explicit: `pin-media-index.json` for Pinterest pin-media readiness, `media-analysis.json` as advisory, `motion-evidence.json` as browser replay authority, desktop observation as read-only, and browser-scoped helper as not a desktop agent.

## Preventive Measures
- Treat README and skill packs as mirrored first-contact surfaces during release docs sweeps.
- Prefer generated public-surface and source-backed capability inventories over historical release summaries.
- Add a docs review checklist item for README TOC, Features, bundled skill paths, and current authority wording whenever workflow guidance changes.
