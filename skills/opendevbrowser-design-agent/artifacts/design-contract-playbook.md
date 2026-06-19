# Design Contract Playbook

The design contract is the single source of truth for frontend decisions in this skill. Build it before implementation or Canvas mutation.

Each section below uses the same structure:

- purpose: why the section exists.
- expectedContents: what the agent must fill.
- howToUse: how the section guides work.
- mustNot: common misuse to avoid.
- Canvas mapping: how the section maps to `/canvas` plan, governance, patch, preview, or implementation-only context.

## 1. Intent

- purpose: define why the design exists and what success means.
- expectedContents: audience, task, successCriteria, trustPosture, primary journey, and non-goals.
- howToUse: use this to choose hierarchy, density, risk posture, and validation evidence.
- mustNot: do not start styling without a crisp audience and job-to-be-done.
- Canvas mapping: informs `generationPlan.targetOutcome`, preview scenarios, and validation evidence.

## 2. Design Language

- purpose: choose one coherent visual direction.
- expectedContents: direction, styleAxes, semanticTokenSource, approvedLibraries, texture, depth, shape language, and contrast posture.
- howToUse: translate the direction into semantic tokens, component anatomy, and patch naming.
- mustNot: do not mix unrelated design languages, and do not approve new libraries through design language alone.
- Canvas mapping: maps to `generationPlan.visualDirection`, token patches, and governance notes.

Valid example:

```json
{
  "direction": "editorial command center",
  "semanticTokenSource": "repo theme tokens",
  "approvedLibraries": ["existing design system only"]
}
```

Invalid example:

```json
{
  "direction": "make it modern with Three.js",
  "approvedLibraries": ["any animation package"]
}
```

The invalid example uses a vague direction and implies unsupported runtime libraries.

## 3. Content Model

- purpose: make content part of the design system.
- expectedContents: primary message, supporting messages, real data requirements, copy tone, state list, loading, empty, error, success, and transient feedback surfaces.
- howToUse: use this before writing nodes so the Canvas document has realistic text and states.
- mustNot: do not use placeholder copy when real content or product-specific labels are available.
- Canvas mapping: maps to `generationPlan.contentStrategy`, node text, feedback states, and preview scenarios.

## 4. Navigation Model

- purpose: define how routes, tabs, overlays, drawers, and deep links become screen state.
- expectedContents: owner, primaryRouteModel, deepLinkPolicy, invalidRouteFallback, overlayEntryPoints, and history behavior.
- howToUse: use this to decide whether navigation belongs in a shell patch, prototype link, implementation route, or future code task.
- mustNot: do not let buttons, tabs, and row actions invent route strings independently.
- Canvas mapping: implementation context unless represented through Canvas-safe prototype or governance fields. `generationPlan.layoutStrategy.navigationModel` can summarize the Canvas-safe navigation posture.

## 5. Async Model

- purpose: define how async work begins, restarts, cancels, and reports feedback.
- expectedContents: owner, loadTrigger, restartTriggers, debounceMs, emptyQueryBehavior, cancellationPolicy, URL ownership, stale-result handling, and retry behavior.
- howToUse: use this to design loading and recovery surfaces before wiring data calls.
- mustNot: do not encode network behavior as Canvas governance unless a Canvas field explicitly supports it.
- Canvas mapping: mostly implementation context. Canvas can represent loading, empty, error, and feedback states through nodes and `generationPlan.componentStrategy.interactionStates`.

## 6. Layout System

- purpose: define page architecture instead of a component list.
- expectedContents: grid type, container strategy, spacing rhythm, alignment rules, section sequence, scan unit, and responsive structure.
- howToUse: use this to choose starter fit, page structure, parent nodes, node placement, and patch order.
- mustNot: do not build tiled cards, side panels, or hero media by default without a layout reason.
- Canvas mapping: maps to `generationPlan.layoutStrategy`, starter choice, page mutations, and node insertion hierarchy.

## 7. Typography System

- purpose: make type hierarchy intentional.
- expectedContents: primary family, secondary family, scale, measure, weight, fallback policy, and loading strategy.
- howToUse: use this to create or update token values and text node styles.
- mustNot: do not default to generic system type unless the existing design system requires it.
- Canvas mapping: maps to token patches, node text styles, and validation targets for readability.

## 8. Motion System

- purpose: define motion that clarifies hierarchy, continuity, feedback, or state change.
- expectedContents: timing, easing, allowed surfaces, reduced-motion posture, transition inventory, and advisory advanced cues.
- howToUse: route motion-heavy work through the motion skill before patching or coding.
- mustNot: do not let shader, WebGL, Spline-style, 3D, or parallax references authorize new runtime libraries.
- Canvas mapping: maps to `generationPlan.motionPosture`, interaction-state representation, and preview evidence. Advanced cues belong in `designVectors` as advisory metadata only.

Valid example:

```json
{
  "motionSystem": {
    "allowed": ["focus transition", "panel reveal"],
    "reducedMotion": "preserve state changes without decorative movement"
  }
}
```

Invalid example:

```json
{
  "motionSystem": {
    "allowed": ["shader particle background"],
    "libraryPolicy": { "motion": ["new animation runtime"] }
  }
}
```

The invalid example promotes unsupported runtime capability from visual intent.

## 9. Performance Model

- purpose: prevent visually correct but unstable interfaces.
- expectedContents: renderHotspots, stableIdentityPolicy, listStrategy, secondaryPanelPolicy, measurementPlan, and performance budget.
- howToUse: use this before designing dense lists, dashboards, scroll stages, or heavy previews.
- mustNot: do not add virtualization, memoization, or lazy loading without an ownership and measurement reason.
- Canvas mapping: implementation context unless represented by Canvas-safe layout, validation, or governance notes. `generationPlan.validationTargets.maxInteractionLatencyMs` carries the measurable Canvas latency target.

Valid Canvas generation plan example:

```json
{
  "generationPlan": {
    "targetOutcome": {
      "mode": "high-fi-live-edit",
      "summary": "Improve hierarchy, clarity, and conversion confidence"
    },
    "visualDirection": {
      "profile": "product-story",
      "themeStrategy": "light-dark-parity"
    },
    "layoutStrategy": {
      "approach": "hero-led-grid",
      "navigationModel": "global-header"
    },
    "contentStrategy": {
      "source": "real-content-first"
    },
    "componentStrategy": {
      "mode": "reuse-first",
      "interactionStates": ["default", "hover", "focus", "active"]
    },
    "motionPosture": {
      "level": "subtle",
      "reducedMotion": "respect-user-preference"
    },
    "responsivePosture": {
      "primaryViewport": "desktop",
      "requiredViewports": ["desktop", "tablet", "mobile"]
    },
    "accessibilityPosture": {
      "target": "WCAG_2_2_AA",
      "keyboardNavigation": "full"
    },
    "validationTargets": {
      "blockOn": ["contrast-failure", "responsive-mismatch"],
      "requiredThemes": ["light", "dark"],
      "browserValidation": "required",
      "maxInteractionLatencyMs": 160
    }
  }
}
```

## 10. Responsive System

- purpose: make responsive behavior an authored outcome.
- expectedContents: breakpoints, primary viewport, required viewports, layout shifts, collapsed navigation, touch targets, overflow rules, and mobile validation steps.
- howToUse: design mobile, tablet, and desktop before declaring the layout complete.
- mustNot: do not assume desktop layout scales down cleanly.
- Canvas mapping: maps to `generationPlan.responsivePosture` and `generationPlan.responsivePosture.requiredViewports`.

## 11. Accessibility Policy

- purpose: set explicit accessibility requirements.
- expectedContents: WCAG target, semantic structure, focus visibility, keyboard navigation, color contrast, reduced-motion requirements, and screen-reader expectations.
- howToUse: use this to construct nodes, labels, focus states, and feedback surfaces.
- mustNot: do not rely on color alone or treat accessibility as final polish.
- Canvas mapping: maps to `generationPlan.accessibilityPosture`, `validationTargets`, preview checks, and feedback evidence.

## 12. Generation Plan

- purpose: provide the mutation-safe subset used by `/canvas`.
- expectedContents: `targetOutcome`, `visualDirection`, `layoutStrategy`, `contentStrategy`, `componentStrategy`, `motionPosture`, `responsivePosture`, `accessibilityPosture`, and `validationTargets`.
- howToUse: extract it from the full contract, submit it with `canvas.plan.set`, and wait for accepted plan status before mutating.
- mustNot: do not use `generationPlan` as a generic notes bucket, and do not put unsupported implementation context into it.
- Canvas mapping: direct `canvas.plan.set` payload. This is the mutation gate for `canvas.document.patch`, starter use, and inventory mutation.

Valid example:

```json
{
  "generationPlan": {
    "targetOutcome": {
      "mode": "high-fi-live-edit",
      "summary": "Improve hierarchy, clarity, and conversion confidence"
    },
    "visualDirection": {
      "profile": "product-story",
      "themeStrategy": "light-dark-parity"
    },
    "layoutStrategy": {
      "approach": "hero-led-grid",
      "navigationModel": "global-header"
    },
    "contentStrategy": {
      "source": "real-content-first"
    },
    "componentStrategy": {
      "mode": "reuse-first",
      "interactionStates": ["default", "hover", "focus", "active"]
    },
    "motionPosture": {
      "level": "subtle",
      "reducedMotion": "respect-user-preference"
    },
    "responsivePosture": {
      "primaryViewport": "desktop",
      "requiredViewports": ["desktop", "tablet", "mobile"]
    },
    "accessibilityPosture": {
      "target": "WCAG_2_2_AA",
      "keyboardNavigation": "full"
    },
    "validationTargets": {
      "blockOn": ["contrast-failure", "responsive-mismatch"],
      "requiredThemes": ["light", "dark"],
      "browserValidation": "required",
      "maxInteractionLatencyMs": 160
    }
  }
}
```

Invalid example:

```json
{
  "generationPlan": {
    "notes": "Use any library that looks premium",
    "navigationModel": "the app router can decide later"
  }
}
```

The invalid example omits required Canvas fields and stores implementation uncertainty in the mutation gate.

## 13. Design Vectors

- purpose: carry advisory metadata that helps interpret a visual direction.
- expectedContents: borrow cues, reject cues, motion advisories, reference notes, and tone constraints.
- howToUse: use vectors to guide human and agent judgment while keeping runtime contracts strict.
- mustNot: do not treat vectors as authorization for unsupported Canvas fields, new dependencies, shaders, WebGL, Spline-style assets, or 3D runtime behavior.
- Canvas mapping: advisory metadata only. It may inform patch choices but does not change the required `CanvasGenerationPlan` shape.

## Canvas Governance Versus Implementation Context

Canvas governance-relevant:

- `generationPlan`
- semantic tokens and token source
- accessibility target
- responsive validation targets
- motion posture and reduced-motion policy
- preview, feedback, save, and export evidence

Implementation-only unless mapped to a Canvas-safe field:

- detailed app router behavior from `navigationModel`
- async fetch, cancellation, cache, and retry behavior from `asyncModel`
- performance implementation choices from `performanceModel`
- vendor-specific libraries or framework internals

Do not patch omitted implementation context into Canvas governance just to make the contract feel complete.

## Patch Construction Guidance

- Read `guidance.recommendedNextCommands` after every successful Canvas command.
- Use the latest accepted lease and latest returned revision as `baseRevision`.
- Build small coherent patches: governance update, page update or insert, node insert, token update, then prototype or inventory operations only when needed.
- Use prototype or navigation targets only when the contract defines the navigation owner and target state.
- Use tokens for reusable color, typography, spacing, radius, shadow, and motion values instead of repeated raw values.
- Inspect `canvas.starter.list` before hand-authoring common dashboard, auth, marketing, settings, or docs shells when they match the brief.
- Reject a starter when it does not satisfy the design contract.
- Call `canvas.inventory.list` after plan acceptance to inspect reusable sections or components.
- Use `canvas.inventory.insert` when an item fits the accepted plan, lease, page, parent, and placement.
- Promote custom nodes into inventory only after the contract and preview evidence prove they are reusable.

## Review Questions

Before implementation, answer:

1. What should the user notice first?
2. What should they do second?
3. What content is real, and what still needs product input?
4. Which layer owns async restarts, query state, and stale-request handling?
5. Which layer owns route translation, deep-link recovery, and overlay entry points?
6. What loading, empty, error, and transient feedback surfaces are required?
7. Where is the canonical theme or token source?
8. Which list, grid, or pane is most likely to become render-heavy under realistic data?
9. What part of the design is most likely to regress on mobile?
10. Are advanced motion cues advisory only, with no runtime or library-policy authorization implied?
11. What evidence will prove the design works on a real browser surface?
