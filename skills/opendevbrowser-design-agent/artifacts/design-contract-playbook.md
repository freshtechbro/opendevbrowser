# Design Contract Playbook

The design contract is the single source of truth for frontend decisions in this skill.

## 1. Intent

Capture why the design exists.

- `audience`: who is this for
- `task`: what must they accomplish
- `successCriteria`: how the UI proves it succeeded
- `trustPosture`: conservative, neutral, bold, editorial, etc.

If the task does not have a crisp audience or job-to-be-done, stop and define it before styling anything.

## 2. Design Language

Choose one coherent direction.

- `direction`: a named visual family
- `styleAxes`: contrast, density, warmth, shape language, texture, depth, motion
- `semanticTokenSource`: which shell or provider owns semantic color, spacing, radius, shadow, and motion tokens
- `approvedLibraries`: allowed component, icon, and styling libraries

Do not mix multiple unrelated directions inside one screen.

## 3. Content Model

Content is part of the design system, not filler.

- define the primary message
- define the supporting messages
- require real content when possible
- list the UI states that must exist
- define loading, empty, error, and transient feedback behavior
- avoid placeholder copy unless the task explicitly needs scaffolding

## 4. Async Model

State how async work begins, restarts, and stops.

- `owner`: which layer owns query, result, and status transitions
- `loadTrigger`: load-on-enter, restart-on-input, or long-lived workflow
- `restartTriggers`: query, scope, sort, selection, or route changes
- `debounceMs`: the delay for user-driven restarts
- `emptyQueryBehavior`: what happens when the query clears
- `cancellationPolicy`: how stale work is ignored
- `urlOwnership`: when query, scope, or sort belongs in the URL

If async ownership is unclear, the design contract is incomplete even if the visual direction is strong.

## 5. Navigation Model

State how routes, tabs, overlays, and deep links are translated into UI state.

- `owner`: which shell or controller owns route resolution
- `primaryRouteModel`: the canonical route, tab, or view map
- `deepLinkPolicy`: which params survive refresh, sharing, or external entry
- `invalidRouteFallback`: what happens when params are missing, stale, or malformed
- `overlayEntryPoints`: which routes or actions are allowed to open drawers, sheets, or modal review states

Do not let buttons, tabs, and row actions invent route strings independently. One navigation owner should translate external entry points into screen state.

## 6. Layout System

State the page architecture, not just the component list.

- grid type
- container strategy
- spacing rhythm
- alignment rules
- section sequencing
- scan unit for dense collections or dashboards

## 7. Typography System

Decide typography deliberately.

- primary and secondary families
- scale
- measure
- fallback policy
- loading strategy

## 8. Motion System

Motion must help comprehension.

- timing and easing
- where motion is allowed
- reduced-motion posture
- whether depth, 3D, or parallax are justified

## 9. Performance Model

State the performance posture before interaction regressions appear.

- `renderHotspots`: which subtree is most likely to churn
- `stableIdentityPolicy`: how rows, cards, tabs, or stages keep stable ids
- `listStrategy`: static list, lazy container, progressive reveal, or virtualization threshold
- `secondaryPanelPolicy`: whether inspectors, previews, or editors load eagerly or on demand
- `measurementPlan`: which profiler or browser evidence proves the screen is healthy under realistic data

If scan-heavy or motion-heavy screens have no performance model, the design contract is incomplete.

## 10. Responsive System

Responsive behavior is an authored outcome.

- breakpoints
- layout changes by breakpoint
- touch targets
- overflow rules
- collapsed navigation or panel behavior

## 11. Accessibility Policy

Accessibility must be explicit.

- WCAG target
- keyboard requirements
- focus visibility rules
- semantic structure requirements
- color contrast expectations

## 12. Generation Plan

This is the mutation-safe subset used by `/canvas`.

Required keys:

- `targetOutcome`
- `visualDirection`
- `layoutStrategy`
- `contentStrategy`
- `componentStrategy`
- `motionPosture`
- `responsivePosture`
- `accessibilityPosture`
- `validationTargets`

Use `scripts/extract-canvas-plan.sh` to derive this from the full contract.

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
10. What evidence will prove the design works on a real browser surface?
