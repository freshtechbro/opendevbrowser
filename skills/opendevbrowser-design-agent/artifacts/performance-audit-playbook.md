# Performance Audit Playbook

Use this workflow when the UI feels heavy, re-renders too often, scrolls poorly, or becomes unstable under realistic data volume.

## Intake

Capture the problem before optimizing:

- interaction that feels slow
- viewport and data size
- whether the issue is input, scroll, resize, animation, or async refresh
- suspected heavy subtree or component family

## Baseline First

Measure before changing structure:

- React DevTools Profiler for render churn
- browser Performance panel when the problem looks layout or paint related
- `debug-trace-snapshot` for console and network regressions tied to the interaction

Treat components taking longer than roughly one frame budget as candidates for deeper audit.

## Common Fix Patterns

- isolate ticking or rapidly changing state from heavy subtrees
- avoid top-level branch swapping when a stable base tree can express the same states
- keep props narrow and stable before reaching for memoization
- move expensive derivations out of render paths
- virtualize or progressively reveal long collections
- delay heavy secondary panels until the user asks for them
- drive scroll motion from one normalized progress model

## Scan-Heavy Surface Discipline

When the screen is mostly about rows, cards, or staged panes:

- keep stable item identity through sorting, filtering, refresh, and optimistic updates
- avoid index-based expansion or selection state for reorderable collections
- pick one scan unit and optimize around that unit before styling the rest of the shell
- prefer lazy containers or progressive reveal before hand-tuned per-item memoization
- keep inspectors, previews, and secondary editors lazy when they are not needed for the first scan
- measure with realistic list density and content length instead of trimmed placeholder data

## Restraint Rules

- do not add memoization by default when the repo pattern does not support it
- do not optimize around fake placeholder data
- fix ownership churn before micro-optimizing components
- validate that the slow interaction is actually improved after each change

## Audit Output

Use `assets/templates/design-audit-report.v1.md` and capture:

- issue
- evidence
- suspected owner
- fix
- validation result

## Validation Commands

```bash
npx opendevbrowser launch --no-extension --start-url http://127.0.0.1:3000
npx opendevbrowser debug-trace-snapshot --session-id <session-id>
npx opendevbrowser screenshot --session-id <session-id>
```

Pair browser evidence with React DevTools Profiler or equivalent framework tooling when the regression is render-bound.
