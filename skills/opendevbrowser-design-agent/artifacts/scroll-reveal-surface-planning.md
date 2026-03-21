# Scroll Reveal Surface Planning

Use this when narrative sequencing, pinned sections, or viewport-driven motion is part of the design instead of decorative afterthought.

## 1. Declare The Driver First

Choose one progress owner before writing animation code:

- page-level normalized progress
- section-local reveal progress
- pinned stage index with explicit transitions

Do not mix multiple observers, ad-hoc scroll listeners, and independent card timers for the same narrative.

## 2. Separate Layout From Motion

- layout owns reading order, overflow, and breakpoint behavior
- motion owns interpolation and reveal timing
- content owns message sequencing and copy density

If motion changes layout ownership, the design contract is incomplete.

## 3. Reduced Motion Is Not Optional

Define the fallback up front:

- no pinning
- instant section reveal
- opacity-only transitions
- static ordering with no transform-based staging

The reduced-motion path should preserve comprehension, not merely disable animation.

## 4. Keep Stages Explicit

For every scroll-driven surface, document:

- stage count
- trigger range
- sticky or pinned regions
- exit condition
- fallback behavior on mobile or short viewports

If the stage model cannot be written down, it is too implicit to ship safely.

## 5. Browser Validation

Validate:

- mobile, tablet, and desktop viewport behavior
- keyboard and reading order while the effect is active
- console stability during scroll
- reduced-motion output
- no competing transforms across sibling sections

Use `snapshot`, `screenshot`, and `debug-trace-snapshot` on the real surface after the isolated preview passes.

## Failure Signals

- each section owns its own scroll math
- pinned content traps focus or blocks reading order
- reduced-motion removes structure instead of motion only
- mobile collapses because the reveal model depends on tall desktop viewports
- the design cannot explain which value actually drives the reveal
