# Motion Release Gate

Use this gate before shipping animation-heavy work.

## Blocking Checks

- Contract alignment: implementation matches `motion-contract.v1.json`.
- Pattern justification: every pattern maps to a user value.
- Reduced motion: `prefers-reduced-motion` path preserves meaning and task completion.
- Keyboard order: focus remains stable and visible.
- Viewport matrix: phone, tablet, desktop, short viewport, and reduced-motion checks pass.
- Temporal proof: `screencast-start` and `screencast-stop` evidence exists for timing-sensitive motion.
- Debug trace: `debug-trace-snapshot` shows no repo-owned motion defects.
- Console/network stability: no unexplained errors during the sequence.
- Performance: no jank, runaway loops, layout thrash, or uncontrolled render loops.
- Overflow: no horizontal overflow and no clipped required content.
- Focus traps: overlays, sheets, and pinned stages have exits.
- Library policy: no unapproved runtime dependency.

## Non-blocking Checks

- Fine-tune easing tokens when evidence is otherwise stable.
- Reduce decorative flourish if it does not affect comprehension.
- Improve brand-specific motion language after accessibility and performance pass.

## Release Decision

Record each check in `assets/templates/motion-release-gate.v1.json`. Missing evidence is a blocking failure.
