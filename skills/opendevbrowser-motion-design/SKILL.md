---
name: opendevbrowser-motion-design
description: Deterministic motion and animation design guidance for OpenDevBrowser agents building web and mobile UI with real-browser temporal evidence.
version: 1.0.0
---

# Motion Design Skill

Use this skill when a task asks for animation, motion language, transition systems, scroll choreography, gesture motion, reduced-motion audits, browser replay evidence, or motion-heavy UI implementation.

## Pack Contents

- `artifacts/motion-terminology.md`
- `artifacts/motion-pattern-catalog.md`
- `artifacts/platform-framework-guide.md`
- `artifacts/device-breakpoint-posture.md`
- `artifacts/accessibility-reduced-motion.md`
- `artifacts/performance-frame-budget.md`
- `artifacts/open-dev-browser-motion-evidence.md`
- `artifacts/motion-release-gate.md`
- `artifacts/motion-anti-patterns.md`
- `assets/templates/motion-contract.v1.json`
- `assets/templates/motion-audit-report.v1.md`
- `assets/templates/motion-viewport-matrix.v1.json`
- `assets/templates/motion-release-gate.v1.json`
- `scripts/motion-workflow.sh`
- `scripts/validate-skill-assets.sh`

## Quick Start

1. Load `opendevbrowser-best-practices` first for OpenDevBrowser runtime rules.
2. Load `opendevbrowser-design-agent` for the parent UI implementation workflow, design contract, `/canvas`, and real-surface validation.
3. Load `opendevbrowser-motion-design` for motion language, pattern selection, platform policy, device posture, reduced motion, frame budget, and temporal proof.
4. Validate this pack before relying on its assets. From the loaded `opendevbrowser-motion-design` skill root, run:

```bash
./scripts/validate-skill-assets.sh
./scripts/motion-workflow.sh contract-first
./scripts/motion-workflow.sh temporal-proof
```

## InspireDesign Harvest Inputs

When an InspireDesign harvest bundle is available, inspect `nextStepGuidance.readiness` and `doNotProceedIf` before selecting motion patterns. Read `meta-prompt.md`, `ranked-references.json`, `visual-evidence.json`, `screenshot-index.json`, and the referenced PNG files only after the bundle is ready or while following recovery guidance. Treat harvested motion posture as evidence-backed design intent, not permission to add dependencies or copy source-brand choreography. Carry accepted cues into the motion contract with explicit reduced-motion behavior, device posture, frame budget, and temporal proof requirements.

## Motion Contract

Motion is a contract field, not decoration. Before implementation, fill `assets/templates/motion-contract.v1.json` and connect it to the design-agent `motionSystem`, `performanceModel`, `responsiveSystem`, and `accessibilityPolicy` fields.

The contract must define:

- intent and user value
- selected patterns from `artifacts/motion-pattern-catalog.md`
- timing tokens, easing tokens, and spring tokens
- driver ownership for scroll, viewport, gesture, route, and state transitions
- device and breakpoint posture from `artifacts/device-breakpoint-posture.md`
- `prefers-reduced-motion` behavior from `artifacts/accessibility-reduced-motion.md`
- performance budget from `artifacts/performance-frame-budget.md`
- verification plan from `artifacts/open-dev-browser-motion-evidence.md`

## Pattern Selection

Choose patterns by user job, not visual novelty. Start with the smallest motion grammar that clarifies hierarchy or state:

- no-motion for stable task surfaces
- opacity or fade-through for low-attention state changes
- shared element, FLIP, or layout transition when continuity is the point
- sheet, modal, popover, toast, and progressive disclosure motion for containment
- scroll reveal, parallax, pinned stage, or scroll snap only when the narrative depends on viewport progress
- gesture, inertia, spring settle, interruptibility, and haptics only when direct manipulation matters
- Lottie, Rive, 3D transform, or WebGL/spatial motion only when the illustration or spatial model carries meaning

Every selected pattern needs a reduced-motion fallback, device posture, and temporal evidence.

## Platform And Framework Policy

Frameworks are implementation primitives, not permission to add dependencies. Prefer existing project libraries and platform primitives. New runtime dependencies require separate explicit approval and must be recorded in `libraryPolicy`.

Use `artifacts/platform-framework-guide.md` for CSS transitions, CSS keyframes, Web Animations API, View Transition API, CSS scroll-driven animations, Motion for React with `motion/react`, GSAP 3.x, Anime.js 4.x, react-spring, Lottie, Rive, Three.js, react-three-fiber, Spline/WebGL advisory, SwiftUI, UIKit/Core Animation, Jetpack Compose, Android MotionLayout, React Native Reanimated 4.x, Flutter animation APIs, and haptics.

## Device Posture

Motion must change across phones, tablets, laptops, desktops, large monitors, short viewports, coarse pointers, fine pointers, keyboard-only use, reduced-power devices, high-refresh displays, and foldable posture. Use `artifacts/device-breakpoint-posture.md` and `assets/templates/motion-viewport-matrix.v1.json` before coding responsive animation.

## Reduced Motion

Reduced motion is mandatory. Follow WCAG 2.2 SC 2.3.3 and `prefers-reduced-motion`. The reduced path must preserve meaning and task completion. It may remove travel, parallax, pinning, looping, and large transform distance, but it must not hide information, reorder focus, or remove feedback.

## Verification

Prove motion in a real browser. Static code review is not enough for timing, choreography, scroll stages, or gesture behavior.

Required evidence for motion-heavy work:

- `snapshot`
- `screenshot`
- `debug-trace-snapshot`
- `screencast-start`
- interaction or scroll sequence
- `screencast-stop`
- console and network stability checks
- viewport matrix checks
- reduced-motion checks
- `/canvas` preview evidence when using design-agent canvas workflow

Use `scripts/motion-workflow.sh temporal-proof` and `artifacts/open-dev-browser-motion-evidence.md`.

## Anti-patterns

Do not ship motion when any of these are true:

- the motion has no user value
- the progress owner is unclear
- multiple scroll observers fight the same narrative
- layout properties animate in hot paths
- reduced motion removes meaning
- hover is the only affordance
- mobile travel is long enough to disorient
- pinned scroll traps reading order or focus
- gesture animation cannot be interrupted or retargeted
- a new dependency was added without approval

Use `artifacts/motion-anti-patterns.md` before release.

## Related Skills

- `opendevbrowser-best-practices`: runtime, CLI, browser, evidence, and release governance.
- `opendevbrowser-design-agent`: parent UI design, InspireDesign harvest review, and `/canvas` implementation workflow.
- `opendevbrowser-motion-design`: motion-specific terminology, pattern catalog, platform policy, device posture, reduced motion, performance, and temporal evidence.
