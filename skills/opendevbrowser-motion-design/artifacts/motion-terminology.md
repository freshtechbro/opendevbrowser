# Motion Terminology

Use precise motion vocabulary so implementation, review, and browser evidence match the same contract.

## Core Terms

- Duration: the active time for one animation segment.
- Delay: the time before a segment starts.
- Easing: the curve that maps elapsed time to progress.
- Spring: a physics model that settles based on stiffness, damping, and mass.
- Damping: resistance that reduces oscillation.
- Stiffness: spring force that increases return speed.
- Mass: simulated object weight that changes spring response.
- Keyframe: a named or timed value in an animation sequence.
- Timeline: the clock or progress source for one or more animations.
- Choreography: multiple animated elements coordinated by one intent.
- Stagger: ordered offsets across sibling elements.
- Interpolation: computed values between two states.
- Transform: compositor-friendly movement, scale, rotation, or skew.
- Opacity: compositor-friendly visibility change.
- Layout animation: transition between layout states, often requiring measurement.
- Shared element transition: continuity where one semantic object appears to move between containers.
- FLIP: First, Last, Invert, Play layout animation technique.
- Scroll progress: normalized progress based on scroll position.
- View progress: normalized progress based on an element entering or leaving the viewport.
- Gesture velocity: speed and direction from touch, pointer, or drag input.
- Inertia: continued movement after release based on velocity.
- Overshoot: controlled movement past the final value before settling.
- Anticipation: small preparatory movement that clarifies the next action.
- Follow-through: residual motion that makes a stop feel physical.
- Interruptibility: ability to stop or redirect motion during user input.
- Retargeting: redirecting an active animation toward a new target state.
- Reduced motion: alternate motion path selected by preference or accessibility need.
- Motion contract: documented intent, patterns, tokens, device posture, accessibility, performance, and evidence.
- Motion evidence: screenshots, snapshots, debug traces, screencasts, viewport checks, and reduced-motion proof.
- Frame budget: time available for each rendered frame.
- Input latency: delay between input and visible response.
- Compositing: browser layer composition without expensive layout or paint.

## Decorative Versus Meaning-bearing Motion

Decorative motion adds atmosphere but does not change comprehension. Meaning-bearing motion explains hierarchy, state, continuity, causality, gesture response, or task progress. Meaning-bearing motion must have an equivalent reduced-motion path.

## Motion Quality Rule

Motion must preserve hierarchy, comprehension, accessibility, and task flow. If it competes with reading, hides state, blocks input, or makes verification ambiguous, simplify it.
