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
- `assets/templates/design-review-checklist.json`
- `assets/templates/real-surface-design-matrix.json`
- `assets/templates/reference-pattern-board.v1.json`
- `assets/templates/design-release-gate.v1.json`
- `scripts/design-workflow.sh`
- `scripts/extract-canvas-plan.sh`
- `scripts/validate-skill-assets.sh`
- Shared robustness matrix: `../opendevbrowser-best-practices/artifacts/browser-agent-known-issues-matrix.md`
- Shared canvas workflow baseline: `../opendevbrowser-best-practices/SKILL.md`

## Fast Start

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

- Use browser replay (`screencast-start` / `screencast-stop`) during real-surface validation when motion, sequencing, or transition timing matters.
- Desktop observation stays read-only and is only for external window or OS-level evidence around the workflow; it is not a design-surface control lane.
- Browser-scoped computer use remains a challenge posture knob via `--challenge-automation-mode`, not a desktop-agent capability.

## Core Rules

- Start with a design contract, not ad-hoc implementation.
- Build a reference pattern board before locking a new direction when external inspiration matters.
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
- Treat `/canvas` governance as the strongest contract in the repo: read the handshake, respect `generationPlanRequirements`, and do not mutate before the plan is accepted.
- For non-canvas frontend work, still fill the same design-contract fields before coding so decisions stay consistent across code, preview, and docs.
- Use one owner for overlays, drawers, sheets, and detail panels; prefer item-backed state over boolean sprawl.
- If motion depends on scroll or viewport progress, define the driver and reduced-motion fallback before implementation.
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

Use `scripts/extract-canvas-plan.sh` when the full contract already exists and only the `/canvas` payload is needed.

## Recommended Workflow Modes

### `contract-first`

Use when starting from a brief or existing product requirement.

- Fill `assets/templates/design-brief.v1.md`.
- Translate it into `assets/templates/design-contract.v1.json`.
- Check `artifacts/opendevbrowser-ui-example-map.md` and `artifacts/app-shell-and-state-wiring.md` before deciding the shell structure.
- If a nearby shipped surface exists, review `artifacts/existing-surface-adaptation.md` before changing shell or component structure.
- Review `artifacts/design-contract-playbook.md`.
- Implement only after the contract is coherent.

### `research-harvest`

Use when a redesign needs external references or when the brief explicitly asks for competitive learning.

- Start with `artifacts/research-harvest-workflow.md`.
- Capture `3` to `5` live references with OpenDevBrowser.
- Record them in `assets/templates/reference-pattern-board.v1.json`.
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

- Start with `canvas.session.open` or `canvas.capabilities.get`.
- Read the handshake and confirm `preflightState="handshake_read"`, `planStatus`, and `guidance.recommendedNextCommands` before choosing the next command.
- Fill the full design contract and extract the `generationPlan`.
- Submit `canvas.plan.set`.
- Re-check `canvas.plan.get` or `canvas.capabilities.get` until the runtime reports `planStatus="accepted"` or `preflightState="plan_accepted"`.
- Follow `guidance.recommendedNextCommands` after `canvas.plan.set`, then mutate with `canvas.document.patch`.
- After every successful `canvas.document.patch`, `canvas.preview.render`, `canvas.preview.refresh`, `canvas.feedback.poll`, `canvas.document.save`, or `canvas.document.export`, read `guidance.recommendedNextCommands` and `guidance.reason` before choosing the next step.
- Validate extension-stage history controls against public `canvas.history.undo` and `canvas.history.redo`; design-tab clicks emit the internal `canvas_history_requested` event, but acceptance is still on the public command outcomes.
- When token work is in scope, validate collection or mode authoring, token value or alias edits, selected-node binding, and token usage inspection in the extension stage.
- If annotation send is part of the workflow, record whether the design tab returned `Delivered to agent` or `Stored only; fetch with annotate --stored`.
- Use `canvas.preview.render`, `canvas.feedback.poll`, `canvas.preview.refresh`, and `canvas.document.save` as the validation loop in that order.

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
./skills/opendevbrowser-design-agent/scripts/extract-canvas-plan.sh ./tmp/design-contract.json
```

## References

- Anthropic Claude Code subagents best practices: https://docs.anthropic.com/en/docs/claude-code/sub-agents
- Anthropic Claude Code settings and agent ownership patterns: https://docs.anthropic.com/en/docs/claude-code/settings
- Vercel v0 prompting guide: https://v0.dev/docs/prompting/text
- Lovable prompting guide: https://docs.lovable.dev/prompting/prompting-best-practices
- Public frontend-designer subagent example: https://github.com/iannuttall/claude-agents
- Dimillian SwiftUI UI patterns: https://github.com/Dimillian/Skills/blob/main/swiftui-ui-patterns/SKILL.md
