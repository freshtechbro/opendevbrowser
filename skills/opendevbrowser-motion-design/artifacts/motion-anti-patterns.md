# Motion Anti-patterns

Do not ship these motion failures.

- Decorative motion without user value.
- Missing progress owner for route, state, scroll, or gesture animation.
- Competing scroll observers for the same narrative.
- Layout-property animation in hot paths.
- Long-distance mobile travel.
- Default parallax without vestibular and reduced-motion review.
- Pinned scroll without escape condition.
- Hover-only affordance.
- Hidden focus or reading-order changes.
- Reduced motion that removes meaning.
- Unbounded loops.
- Fake progress.
- Unapproved runtime dependency.
- Haptic spam.
- Index-keyed animated lists.
- Non-interruptible gesture animation.
- Motion-only status feedback.
- Skeleton shimmer that never resolves.
- Shared element transition with unstable identity.
- WebGL or canvas motion without static accessible equivalent.
- Animation cleanup leaks after unmount or route change.

## Fix Pattern

For every anti-pattern, either remove the motion, reduce it to a simpler pattern, or rewrite the motion contract with a clear owner, fallback, and evidence plan.
