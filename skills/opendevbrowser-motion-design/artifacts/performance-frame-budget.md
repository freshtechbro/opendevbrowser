# Performance And Frame Budget

Motion quality is measured in real browser behavior. If frame stability cannot be proven, simplify the motion.

## Budget Rules

- Prefer transform and opacity for high-frequency animation.
- Avoid animating layout and paint-heavy properties in hot paths.
- Use compositing intentionally; do not scatter `will-change` across many elements.
- Remove `will-change` after the interaction when possible.
- Keep scroll listeners passive and bounded; prefer platform scroll timelines or IntersectionObserver when suitable.
- Use `requestAnimationFrame` for visual reads and writes that must happen per frame.
- Separate layout reads from writes to avoid layout thrash.
- Protect INP and input latency during gesture and scroll motion.
- Validate dropped frames and high refresh behavior for complex choreography, scroll-driven stages, and gesture-coupled motion.
- Test realistic data volume, not empty lists.
- Check mobile thermal and battery impact for loops, WebGL, Lottie, Rive, and long timelines.
- Perform cleanup for animation handles, event listeners, render loops, media, and runtime objects.
- Do not introduce layout shift after animation settles.
- Do not introduce horizontal overflow at any breakpoint.

## Evidence Required Before Shipping Complex Motion

- browser replay for the motion sequence
- debug trace after the interaction
- console and network stability checks
- viewport matrix screenshots
- reduced-motion screenshots or replay
- performance notes for low-power mobile posture when relevant

## Simplification Ladder

1. Remove decorative loops.
2. Reduce number of simultaneously animated elements.
3. Replace layout animation with opacity or transform.
4. Remove parallax or pinning on mobile.
5. Replace custom timeline with platform transition.
6. Fall back to no-motion stability.
