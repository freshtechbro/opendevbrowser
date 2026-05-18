# Accessibility And Reduced Motion

Motion must satisfy WCAG 2.2 SC 2.3.3 Animation from Interactions and respect `prefers-reduced-motion`.

## Essential Versus Non-essential Motion

Essential motion is required to understand spatial continuity, preserve orientation, or complete a task. Non-essential motion is decorative, atmospheric, or brand-only. Non-essential motion must be disableable. Essential motion still needs a reduced alternative that preserves meaning.

## Required Rules

- Provide a `prefers-reduced-motion` path for every selected pattern.
- Preserve all information in the reduced path.
- Do not remove task feedback, labels, focus, or completion state when reducing motion.
- Do not rely on motion-only feedback; pair it with text, state, color, icon, or ARIA where relevant.
- Avoid vestibular triggers: large parallax, zoom, spinning, unbounded loops, forced pinning, and long-distance travel.
- Keep keyboard order and visual order coherent.
- Keep focus stable before, during, and after animation.
- Provide pause, disable, or non-looping behavior for decorative repeated animation.
- Screen-reader alternatives must describe state changes when animation communicates status.
- Use ARIA live regions for async status only when they are relevant and not noisy.

## Reduced-motion Examples

- Shared element transition becomes fade-through or instant route change with heading focus.
- Pinned scroll stage becomes stacked static sections.
- Parallax becomes a static layered image.
- Skeleton shimmer becomes a static skeleton with loading text.
- Drag overshoot becomes direct snap to final target.
- Lottie or Rive loop becomes a poster frame.

## Blocking Failures

- Reduced motion removes content.
- Reduced motion leaves content hidden because the reveal animation never runs.
- Focus moves to an invisible or offscreen element.
- A hover animation is the only affordance.
- A loop cannot be paused or stopped.
