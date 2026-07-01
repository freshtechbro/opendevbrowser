---
name: opendevbrowser-design-agent
description: This skill should be used when the user asks to design, redesign, audit, or implement frontend/UI work with OpenDevBrowser, screenshots, or the /canvas surface. It turns briefs and existing interfaces into contract-first, real-browser-validated design execution.
version: 1.1.0
---

# Design Agent Skill

Use this skill for frontend work that must be visually strong, contract-first, and verified in a real browser instead of judged only from code.

## Pack Contents

- `artifacts/design-workflows.md`
- `artifacts/design-contract-playbook.md`
- `artifacts/design-agent-work-products.md`
- `artifacts/frontend-evaluation-rubric.md`
- `artifacts/external-pattern-synthesis.md`
- `artifacts/component-pattern-index.md`
- `artifacts/existing-surface-adaptation.md`
- `artifacts/app-shell-and-state-wiring.md`
- `artifacts/state-ownership-matrix.md`
- `artifacts/async-search-state-ownership.md`
- `artifacts/loading-and-feedback-surfaces.md`
- `artifacts/theming-and-token-ownership.md`
- `artifacts/isolated-preview-validation.md`
- `artifacts/performance-audit-playbook.md`
- `artifacts/scroll-reveal-surface-planning.md`
- `artifacts/research-harvest-workflow.md`
- `artifacts/design-release-gate.md`
- `artifacts/opendevbrowser-ui-example-map.md`
- `artifacts/implementation-anti-patterns.md`
- `assets/templates/design-brief.v1.md`
- `assets/templates/design-audit-report.v1.md`
- `assets/templates/design-contract.v1.json`
- `assets/templates/canvas-generation-plan.design.v1.json`
- `assets/templates/canvas-patch.request.v1.json`
- `assets/templates/inspiredesign-advanced-brief.v1.json`
- `assets/templates/design-review-checklist.json`
- `assets/templates/real-surface-design-matrix.json`
- `assets/templates/reference-pattern-board.v1.json`
- `assets/templates/design-release-gate.v1.json`
- `scripts/design-workflow.sh`
- `scripts/extract-canvas-plan.sh`
- `scripts/validate-skill-assets.sh`
- Motion authority: `../opendevbrowser-motion-design/SKILL.md`
- Shared robustness matrix: `../opendevbrowser-best-practices/artifacts/browser-agent-known-issues-matrix.md`
- Shared canvas workflow baseline: `../opendevbrowser-best-practices/SKILL.md`

## Quick Start

1. Validate pack integrity.

```bash
./skills/opendevbrowser-design-agent/scripts/validate-skill-assets.sh
```

2. Print a workflow.

```bash
./skills/opendevbrowser-design-agent/scripts/design-workflow.sh contract-first
./skills/opendevbrowser-design-agent/scripts/design-workflow.sh canvas-contract
./skills/opendevbrowser-design-agent/scripts/design-workflow.sh real-surface-validation
./skills/opendevbrowser-design-agent/scripts/design-workflow.sh research-harvest
./skills/opendevbrowser-design-agent/scripts/design-workflow.sh release-gate
./skills/opendevbrowser-design-agent/scripts/design-workflow.sh performance-audit
```

3. Convert a full design contract into a `/canvas`-ready generation plan.

```bash
./skills/opendevbrowser-design-agent/scripts/extract-canvas-plan.sh \
  skills/opendevbrowser-design-agent/assets/templates/design-contract.v1.json
```

## Supporting Surfaces

- Keep generated-help labels exact when referencing cross-pack capabilities: `screencast / browser replay`, `desktop observation`, and `computer use / browser-scoped computer use`.
- Use browser replay (`screencast-start` / `screencast-stop`) during real-surface validation when motion, sequencing, or transition timing matters.
- Load `opendevbrowser-motion-design` when motion-heavy work needs terminology, pattern catalog decisions, platform/framework policy, device posture, reduced-motion rules, performance budgets, or temporal proof.
- Treat shader, WebGL, Spline-style, and custom 3D motion references as advisory cues unless current runtime evidence proves support.
- Desktop observation stays read-only and is only for external window or OS-level evidence around the workflow; it is not a design-surface control lane.
- Browser-scoped computer use remains a challenge posture knob via `--challenge-automation-mode`, not a desktop-agent capability.

## Core Rules

- Start with a design contract, not ad-hoc implementation.
- Build a reference pattern board before locking a new direction when external inspiration matters; treat `nextStepGuidance.readiness` as recovery or continuation guidance only, and treat a harvest as design-ready only when top-level `ready=true`, `productSuccess=true`, `artifactAuthority=product_ready`, non-diagnostic `evidenceAuthority`, and manifest-backed reference evidence agree. For canonical Pinterest pin-media harvests, require `evidenceAuthority=pin_media_ready` and manifest-backed `pin-media-index.json`; `snapshot_ready` and `motion_ready` are not substitutes for pin-media readiness.
- Choose a component family from `artifacts/component-pattern-index.md` before inventing a new screen structure.
- Start from the closest shipped OpenDevBrowser example in `artifacts/opendevbrowser-ui-example-map.md` when the repo already has a related surface.
- Route repo-first redesigns through `artifacts/existing-surface-adaptation.md` before changing shells or component anatomy.
- Decide state ownership before writing component APIs, prompts, or `/canvas` patches.
- Declare app-shell, route, and overlay ownership with `artifacts/app-shell-and-state-wiring.md` before expanding navigation chrome or shared panels.
- Declare navigation and deep-link ownership in the contract before buttons, tabs, or search params start pushing route changes ad hoc.
- Declare async and search ownership with `artifacts/async-search-state-ownership.md` before wiring input-driven fetches, scopes, or background refresh.
- Keep one semantic token source with `artifacts/theming-and-token-ownership.md`; do not let leaf components invent raw colors, spacing, or type rules ad hoc.
- Define layout-preserving loading, empty/error recovery, and transient feedback surfaces with `artifacts/loading-and-feedback-surfaces.md` before polishing the happy path.
- For scan-heavy screens, declare list identity, lazy-loading, and progressive-reveal posture before polishing individual cards or rows.
- Keep one visual direction per task. Do not mix unrelated design languages.
- Prefer real content, realistic states, and explicit user journeys over placeholder copy.
- Preserve the repo's existing design system when one already exists. Only introduce a new direction when the brief or product gap justifies it.
- Treat `/canvas` governance as the strongest contract in the repo: read the handshake, respect `generationPlanRequirements`, inspect typed repair examples, and do not mutate before the plan is accepted.
- Treat `preflightState="handshake_read"` as the required ready state for the first post-open decision loop unless the handshake is already reporting an invalid-plan repair path.
- Keep durable design-agent work products under `.opendevbrowser/design-agent/<run-id>/`; use `.tmp/` only for disposable command params, extractor output, and scratch responses.
- Preserve Canvas document persistence through `canvas.document.save` under `.opendevbrowser/canvas/...`; do not replace it with design-agent work-product storage.
- For non-canvas frontend work, still fill the same design-contract fields before coding so decisions stay consistent across code, preview, and docs.
- Use one owner for overlays, drawers, sheets, and detail panels; prefer item-backed state over boolean sprawl.
- If motion depends on scroll or viewport progress, define the driver and reduced-motion fallback before implementation.
- For animation systems, route the motion-specific decisions through `../opendevbrowser-motion-design/artifacts/motion-pattern-catalog.md`, `../opendevbrowser-motion-design/artifacts/platform-framework-guide.md`, `../opendevbrowser-motion-design/artifacts/performance-frame-budget.md`, and `../opendevbrowser-motion-design/artifacts/open-dev-browser-motion-evidence.md`.
- Carry advanced motion cues through `designVectors` and `motionSystem` as design intent only; they do not authorize new runtime libraries.
- Keep `libraryPolicy.motion` and `libraryPolicy.threeD` empty in samples unless a separate runtime change explicitly approves those lanes.
- Use `artifacts/scroll-reveal-surface-planning.md` whenever the design depends on pinned sections, reveal stages, or viewport-driven sequencing.
- Validate new patterns in isolation or `/canvas` preview with `artifacts/isolated-preview-validation.md`, including deterministic fixtures and installed dependencies, before declaring the integrated screen finished.
- Verify default, hover, focus, empty, loading, success, and error states when they are relevant.
- Validate responsive behavior intentionally; do not assume desktop layouts scale down cleanly.
- If the UI feels slow or unstable, switch to `artifacts/performance-audit-playbook.md` and capture a baseline before changing structure.
- Use OpenDevBrowser CLI for real-browser validation, not just static reasoning.
- Record the final ship decision in `assets/templates/design-release-gate.v1.json`; if evidence is missing, the task is not done.
- Finish by updating docs, AGENTS guidance, and any skill-pack references affected by the new UI behavior.

## Design Contract

The mandatory design contract lives in `assets/templates/design-contract.v1.json`.

Every design task should answer these blocks before implementation:

- `intent`
- `designLanguage`
- `contentModel`
- `navigationModel`
- `asyncModel`
- `layoutSystem`
- `typographySystem`
- `motionSystem`
- `performanceModel`
- `responsiveSystem`
- `accessibilityPolicy`
- `generationPlan`

### `/canvas` Required Generation Plan Fields

The `generationPlan` block must include:

- `targetOutcome`
- `visualDirection`
- `layoutStrategy`
- `contentStrategy`
- `componentStrategy`
- `motionPosture`
- `responsivePosture`
- `accessibilityPosture`
- `validationTargets`

Optional `designVectors` may carry advanced motion advisories, but it must not change the required CanvasGenerationPlan fields or imply shader, WebGL, Spline, or 3D runtime support.

Use `scripts/extract-canvas-plan.sh` when the full contract already exists and only the `/canvas` payload is needed. The extracted request is a command payload, not the durable source of truth. Keep the filled full contract in `.opendevbrowser/design-agent/<run-id>/design-contract.json` and use `.tmp/canvas-plan.request.json` for scratch submission.

## Recommended Workflow Modes

### `contract-first`

Use when starting from a brief or existing product requirement.

- Fill `assets/templates/design-brief.v1.md`.
- Translate it into `assets/templates/design-contract.v1.json`.
- Check `artifacts/opendevbrowser-ui-example-map.md` and `artifacts/app-shell-and-state-wiring.md` before deciding the shell structure.
- If a nearby shipped surface exists, review `artifacts/existing-surface-adaptation.md` before changing shell or component structure.
- Review `artifacts/design-contract-playbook.md` and `artifacts/design-agent-work-products.md`.
- Implement only after the contract is coherent.

### `research-harvest`

Use when a redesign needs external references or when the brief explicitly asks for competitive learning.

- Start with `artifacts/research-harvest-workflow.md`.
- Capture `3` to `5` live references with OpenDevBrowser.
- For Pinterest, use the browser-native `social/pinterest` recipe with extension mode and cookies instead of treating Pinterest as a default full provider.
- Before extension-mode Pinterest harvests, preflight `npx opendevbrowser status --daemon --output-format json` and continue only when `data.fingerprintCurrent === true`, `data.relay.extensionConnected === true`, and `data.relay.extensionHandshakeComplete === true`.
- Inspect top-level `ready`, `productSuccess`, `artifactAuthority`, `evidenceAuthority`, and manifest-backed ranked reference evidence before using the bundle; use `nextStepGuidance.readiness`, `nextStepGuidance.doNotProceedIf`, and recovery commands only as follow-through or recovery guidance. For canonical Pinterest pin-media harvests, continue only with top-level `ready=true`, `productSuccess=true`, `artifactAuthority=product_ready`, `evidenceAuthority=pin_media_ready`, and manifest-backed `pin-media-index.json`; this is pin-media-first readiness, not screenshot or motion substitution.
- Record ready evidence in `assets/templates/reference-pattern-board.v1.json`.
- Turn the synthesis into contract deltas before implementation.

### `screenshot-audit`

Use when starting from screenshots, mocks, or an existing page.

- Decompose the design into layout, type, spacing, state, motion, and accessibility decisions.
- Rewrite those observations into the same contract fields used for `/canvas`.
- Record issues and fixes in `assets/templates/design-audit-report.v1.md`.
- Use `artifacts/frontend-evaluation-rubric.md` before editing code.
- If the screen uses scroll-driven sequencing, add `artifacts/scroll-reveal-surface-planning.md` to the audit inputs.

### `canvas-contract`

Use when the task should run through the design canvas.

- Start by creating `.tmp/` and `.opendevbrowser/design-agent/<run-id>/`.
- Copy `assets/templates/design-contract.v1.json` into `.opendevbrowser/design-agent/<run-id>/design-contract.json`, then fill the full contract before extraction.
- Use `artifacts/design-contract-playbook.md` for section construction guidance and `artifacts/design-agent-work-products.md` for durable run files.
- Start with `canvas.session.open`; use `canvas.capabilities.get` only after you have a `canvasSessionId`.
- Use `--output-format json` for Canvas CLI commands whenever you read returned IDs, statuses, guidance, or follow-up fields.
- Read the handshake and inspect `planStatus`, `preflightState`, `generationPlanRequirements.allowedValues`, `generationPlanIssues`, `guidance.recommendedNextCommands`, `guidance.nextStepGuidance`, params examples, field examples, validation checks, and do-not-proceed blockers before choosing the next command.
- Treat `preflightState="handshake_read"` as the normal first-step checkpoint before `canvas.plan.set`; if the handshake already reports `plan_invalid`, repair the plan instead of mutating.
- Extract the generation plan to `.tmp/canvas-plan.request.json` after session open by passing `.tmp/canvas-session.open.json` to `scripts/extract-canvas-plan.sh`; `.tmp` is scratch-only.
- Submit `canvas.plan.set --params-file .tmp/canvas-plan.request.json`.
- If `canvas.plan.set` succeeds with `planStatus="accepted"` or `preflightState="plan_accepted"`, copy the accepted plan request into `.opendevbrowser/design-agent/<run-id>/canvas-plan.request.json` and follow the returned `guidance.recommendedNextCommands`.
- Keep Canvas preview projection on `canvas_html` by default. Use `bound_app_runtime` only after runtime bridge preflight proves the bound app is reachable, intentional, and part of the accepted validation plan.
- Copy `assets/templates/canvas-patch.request.v1.json` to `.tmp/canvas-patch.request.json`, then fill accepted `canvasSessionId`, `leaseId`, latest numeric `baseRevision`, page IDs, node IDs, and token placeholders before mutation.
- If `canvas.plan.set` fails with `generation_plan_invalid`, inspect `details.missingFields`, `details.issues`, `guidance.paramsExamples`, `guidance.fieldExamples`, `guidance.validationChecks`, `guidance.doNotProceedIf`, and `generationPlanIssues`, then repair and resubmit the params file. Use `canvas.plan.get` or `canvas.capabilities.get` only when diagnostics are still needed after reading repair examples.
- Inspect `canvas.starter.list` before hand-authoring common dashboard, auth, marketing, settings, or docs shells when the requested design resembles a starter. Starter use is advisory and must be rejected when it does not satisfy the design contract.
- Use `canvas.starter.apply` only when a starter fits the contract; inspect or align any starter-seeded plan before further mutation.
- For multi-agent or multi-section design reviews, use `canvas.workspace.open`, `canvas.workspace.status`, `canvas.workspace.child.add`, `canvas.workspace.child.execute`, `canvas.workspace.child.close`, and `canvas.workspace.close` only after each child has a normal canvas session. Treat the workspace manifest as refs-only orchestration; child documents, leases, code-sync bindings, previews, and feedback remain child-owned. Do not route nested workspace commands or mutate sibling children; each child owns its document state and accepted plan.
- Call `canvas.inventory.list` after plan acceptance when reusable sections or components might fit. Use `canvas.inventory.insert` only with an accepted plan, current lease, page, parent, placement, and latest revision.
- Mutate with `canvas.document.patch --params-file .tmp/canvas-patch.request.json`, then copy the exact submitted patch into `.opendevbrowser/design-agent/<run-id>/canvas-patch.request.json`.
- Treat `assets/templates/canvas-patch.request.v1.json` as a minimal mutation smoke payload. Before `canvas.document.save` or `canvas.document.export` with `exportTarget="design_document"`, patch every `requiredBeforeSave` governance block reported by the handshake or policy warnings.
- After every successful `canvas.document.patch`, `canvas.preview.render`, `canvas.preview.refresh`, `canvas.feedback.poll`, `canvas.document.save`, or `canvas.document.export`, read `guidance.recommendedNextCommands` and `guidance.reason` before choosing the next step.
- Validate extension-stage history controls against public `canvas.history.undo` and `canvas.history.redo`; design-tab clicks emit the internal `canvas_history_requested` event, but acceptance is still on the public command outcomes.
- When token work is in scope, validate collection or mode authoring, token value or alias edits, selected-node binding, and token usage inspection in the extension stage.
- If annotation send is part of the workflow, record whether the design tab returned `Delivered to agent` or `Stored only; fetch with annotate --stored`. Stored retrieval should expect Annotation V2 compact handoff with screenshot-free shared inbox storage, `schemaVersion: 2`, redaction metadata, selector bundles, and canvas identity when available; `annotate --stored` checks the shared repo-local inbox before extension-local fallback.
- Use `canvas.preview.render`, `canvas.feedback.poll`, `canvas.preview.refresh`, `canvas.document.save`, and `canvas.document.export` as the validation and persistence loop. If `canvas.feedback.poll` returns a `preflight-blocker`, return to `canvas.plan.set` before continuing.
- Remember that saved Canvas documents live under `.opendevbrowser/canvas/...`; `.opendevbrowser/design-agent/<run-id>/` only stores planning, request, evidence, and handoff files.

### `real-surface-validation`

Use when design work must be proven on live surfaces.

- Validate the design on the actual browser surface with `snapshot`, `screenshot`, `debug-trace-snapshot`, and relevant `/canvas` preview commands.
- Run `artifacts/isolated-preview-validation.md` first when the component family or state matrix is still unstable.
- Run the same real task across supported modes when parity is part of the acceptance criteria.
- Record blockers explicitly instead of hand-waving them away.

### `performance-audit`

Use when the design feels heavy, re-renders too often, or becomes unstable with realistic content.

- Capture the slow interaction and baseline with `artifacts/performance-audit-playbook.md`.
- Use `assets/templates/design-audit-report.v1.md` to record `issue / evidence / fix / validation`.
- Prefer ownership and structure fixes before memoization or micro-optimizations.
- If scroll-driven motion is part of the problem, validate the progress owner with `artifacts/scroll-reveal-surface-planning.md` before tuning timing.

### `release-gate`

Use when the implementation looks done and the remaining work is proof and cleanup.

- Start with `artifacts/design-release-gate.md`.
- Fill `assets/templates/design-release-gate.v1.json`.
- Re-run the real-surface matrix and the design review checklist.
- Follow the canonical direct-run release evidence policy from `../opendevbrowser-best-practices/SKILL.md`; this pack does not redefine release-proof ownership.
- Fix remaining gaps before ship-audit.

## Research-Backed Patterns

These patterns are summarized in `artifacts/external-pattern-synthesis.md` and should shape how the skill is applied:

- Specialized agents work best when scope, tooling, and examples are explicit.
- Frontend generation quality improves when prompts specify stack, layout intent, interaction states, and visual references instead of generic adjectives.
- Competitive harvest works best when each reference captures borrow and reject decisions instead of a mood board only.
- Large UI tasks should be broken into deliberate passes: contract, structure, implementation, then live validation.
- Real content and real workflows outperform placeholder-heavy prompts.
- Frontend design agents should own both aesthetics and verification, not just code output.
- Component libraries and screen families should be referenced intentionally instead of rediscovered from scratch on every task.
- Existing shipped surfaces should be treated as first-class adaptation inputs, not obstacles to work around.
- State ownership, overlay ownership, async ownership, and preview discipline need to be explicit or the implementation will drift even when the design language is strong.
- Route ownership should be explicit and typed: one owner translates deep links, tabs, URL params, and external entry points into screen state.
- Scroll-reveal work needs one declared progress owner and an explicit reduced-motion contract or it will regress across breakpoints.
- Debounced async search, layout-preserving placeholders, semantic token ownership, and non-reflow feedback surfaces should be decided in the contract instead of improvised during polish.
- Scan-heavy screens need stable item identity, lazy containers or progressive reveal where justified, and a declared scan unit before per-item polish or motion work.

## Parallel Multitab Alignment

- Apply shared concurrency policy from `../opendevbrowser-best-practices/SKILL.md` ("Parallel Operations").
- Treat design validation as `session-per-worker`; do not alternate unrelated target streams inside one session.
- Re-check extension readiness before `/canvas` or relay-backed annotation steps after idle windows.

## Robustness Coverage (Known-Issue Matrix)

Matrix source: `../opendevbrowser-best-practices/artifacts/browser-agent-known-issues-matrix.md`

- `ISSUE-01`: stale refs and DOM churn during iterative UI validation
- `ISSUE-07`: MV3 extension state loss during `/canvas` and popup-driven design loops
- `ISSUE-08`: restricted origins and unsupported extension pages during design validation
- `ISSUE-12`: stale evidence or unsupported design claims in final deliverables

Reload discipline for unpacked-extension design work:

- After `npm run extension:build`, do not trust a live Chrome result until the unpacked extension is actually reloaded in Chrome.
- Stale MV3 runtime state can preserve old popup or `/canvas` design-tab behavior even when the repo bundle is already fixed.
- If design-tab commands still throw `restricted_url` on `chrome-extension://.../canvas.html`, treat that as an unpacked-extension reload problem first, then reconnect the extension and rerun the design workflow.

## Commands

```bash
./skills/opendevbrowser-design-agent/scripts/design-workflow.sh contract-first
./skills/opendevbrowser-design-agent/scripts/design-workflow.sh canvas-contract
./skills/opendevbrowser-design-agent/scripts/design-workflow.sh screenshot-audit
./skills/opendevbrowser-design-agent/scripts/design-workflow.sh real-surface-validation
./skills/opendevbrowser-design-agent/scripts/design-workflow.sh research-harvest
./skills/opendevbrowser-design-agent/scripts/design-workflow.sh performance-audit
./skills/opendevbrowser-design-agent/scripts/design-workflow.sh release-gate
./skills/opendevbrowser-design-agent/scripts/design-workflow.sh ship-audit
cat skills/opendevbrowser-design-agent/artifacts/design-agent-work-products.md
./skills/opendevbrowser-design-agent/scripts/extract-canvas-plan.sh .opendevbrowser/design-agent/<run-id>/design-contract.json > .tmp/canvas-plan.request.json
```

## References

- Anthropic Claude Code subagents best practices: https://docs.anthropic.com/en/docs/claude-code/sub-agents
- Anthropic Claude Code settings and agent ownership patterns: https://docs.anthropic.com/en/docs/claude-code/settings
- Vercel v0 prompting guide: https://v0.dev/docs/prompting/text
- Lovable prompting guide: https://docs.lovable.dev/prompting/prompting-best-practices
- Public frontend-designer subagent example: https://github.com/iannuttall/claude-agents
- Dimillian SwiftUI UI patterns: https://github.com/Dimillian/Skills/blob/main/swiftui-ui-patterns/SKILL.md
