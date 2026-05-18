# Platform And Framework Guide

Motion frameworks are implementation primitives. They do not authorize new dependencies. Prefer existing project libraries and platform APIs. Any new runtime dependency requires approval, maintenance review, and a `libraryPolicy` entry in the motion contract.

## Web Platform

### CSS Transitions
- Approved use: simple state changes on opacity, transform, color, and filter when supported by the design system.
- Avoid: sequencing, complex interruption, or layout-property animation.
- Primitive mapping: duration, easing, transition-property.
- Reduced motion: shorten or remove transition under `prefers-reduced-motion`.
- Performance hazards: animating width, height, top, left, or box-shadow in hot paths.
- Library policy: no dependency.

### CSS Keyframe Animations
- Approved use: repeated decorative effects, skeletons, icon states, and controlled loops.
- Avoid: user-blocking sequences and infinite attention traps.
- Primitive mapping: `@keyframes`, animation duration, direction, fill mode.
- Reduced motion: pause, remove, or replace with static state.
- Performance hazards: infinite animations on many nodes.
- Library policy: no dependency.

### Web Animations API
- Approved use: cancellable timeline control, dynamic keyframes, and interruption.
- Avoid: trivial CSS-only transitions.
- Primitive mapping: `Element.animate()`, `Animation`, `KeyframeEffect`, playback controls, `document.getAnimations()`.
- Reduced motion: cancel or retarget to final states.
- Performance hazards: unmanaged animation handles and missing cleanup.
- Library policy: no dependency.

### View Transition API
- Approved use: route, view, or shared element continuity in supported browsers.
- Avoid: pages with unstable identity or unsupported fallback needs that have not been designed.
- Primitive mapping: `document.startViewTransition`, view-transition names, route hooks.
- Reduced motion: focus-first instant navigation or fade-through.
- Performance hazards: stale snapshots, large raster layers, and wrong shared names.
- Library policy: no dependency.

### CSS Scroll-driven Animations
- Approved use: scroll progress and view progress where progressive enhancement is acceptable.
- Avoid: core task flows that require all browsers to animate.
- Primitive mapping: scroll timelines, view timelines, CSS animation progress.
- Reduced motion: static content, no pinning, no parallax.
- Performance hazards: unreadable content during scroll, browser support gaps.
- Library policy: no dependency.

## JavaScript And React Libraries

### Motion For React
- Approved use: React UI transitions, layout transitions, gesture, and scroll hooks when already in the project or explicitly approved.
- Avoid: adding it only for one opacity fade.
- Primitive mapping: `motion/react`, motion components, layout, variants, AnimatePresence.
- Reduced motion: use reduced-motion hooks and contract fallback.
- Performance hazards: layout measurement on large lists and unbounded re-renders.
- Library policy: new dependency requires approval.

### GSAP 3.x
- Approved use: complex timelines, SVG, scroll scenes, and production-grade choreography when approved.
- Avoid: basic UI state transitions and unowned scroll stages.
- Primitive mapping: timelines, tweens, ScrollTrigger when allowed.
- Reduced motion: disable timelines or jump to final state.
- Performance hazards: competing scroll observers and cleanup leaks.
- Library policy: new dependency requires approval.

### Anime.js 4.x
- Approved use: lightweight timeline and SVG effects when approved.
- Avoid: framework state transitions that platform or existing libraries cover.
- Primitive mapping: timelines, keyframes, targets.
- Reduced motion: pause or complete instantly.
- Performance hazards: broad selectors and unmanaged loops.
- Library policy: new dependency requires approval.

### react-spring
- Approved use: spring-driven UI states and direct manipulation when already installed or approved.
- Avoid: deterministic route choreography that needs exact timing.
- Primitive mapping: spring config, damping, stiffness, mass.
- Reduced motion: critically damped or instant states.
- Performance hazards: too many active springs and inaccessible bounce.
- Library policy: new dependency requires approval.

### Lottie
- Approved use: exported illustration, onboarding, empty states, and success moments.
- Avoid: critical controls or data-only content.
- Primitive mapping: JSON animation, renderer, poster fallback.
- Reduced motion: static poster frame or no loop.
- Performance hazards: large JSON, endless loops, renderer overhead.
- Lifecycle: stop and destroy when removed.
- Library policy: new dependency requires approval.

### Rive Web Runtime
- Approved use: state-machine illustration and interactive animated diagrams.
- Avoid: essential controls without static equivalent.
- Primitive mapping: Rive state machines, inputs, canvas/WebGL renderer.
- Reduced motion: static artboard or disabled autoplay.
- Performance hazards: runtime object leaks, heavy canvases.
- Lifecycle: clean up runtime objects.
- Library policy: new dependency requires approval.

### Three.js And react-three-fiber
- Approved use: real spatial product or scene requirements.
- Avoid: decorative background only.
- Primitive mapping: scene, camera, mesh, material, render loop, controls.
- Reduced motion: static render or 2D equivalent.
- Performance hazards: GPU cost, battery drain, inaccessible canvas.
- Lifecycle: dispose geometries, materials, textures, and renderers.
- Library policy: new dependency requires approval.

### Spline And WebGL Advisory
- Approved use: visual reference or exported asset only when runtime support and dependency policy are explicit.
- Avoid: assuming a Spline reference can ship directly.
- Primitive mapping: static export, embedded scene, or translated Three.js model.
- Reduced motion: poster frame.
- Performance hazards: black-box runtime size and device load.
- Library policy: advisory unless approved.

## Native And Mobile Platforms

### SwiftUI
- Approved use: state-driven transitions, matched geometry, gestures, and springs.
- Avoid: hiding navigation or focus order changes behind animation.
- Primitive mapping: `withAnimation`, `transition`, `matchedGeometryEffect`, gestures.
- Reduced motion: inspect accessibility reduce-motion setting and reduce travel.
- Performance hazards: animating large view trees and repeated layout invalidation.

### UIKit And Core Animation
- Approved use: explicit view, layer, and transition animations.
- Avoid: running animations outside lifecycle ownership.
- Primitive mapping: UIView animation, Core Animation, interruptible animators.
- Reduced motion: instant state or crossfade where essential.
- Performance hazards: offscreen rendering and layer churn.

### Jetpack Compose
- Approved use: declarative state animation, visibility, content size, and transitions.
- Avoid: motion that changes semantic order.
- Primitive mapping: animate APIs, updateTransition, AnimatedVisibility.
- Reduced motion: use platform animator duration scale and static fallbacks.
- Performance hazards: recomposition churn and list animation without keys.

### Android MotionLayout
- Approved use: complex constraint transitions and coordinated layout states.
- Avoid: simple microinteractions.
- Primitive mapping: constraint sets, transitions, progress.
- Reduced motion: jump to end state or simplified transition.
- Performance hazards: constraint complexity and gesture conflict.

### React Native Reanimated 4.x
- Approved use: gesture-coupled native-thread animation with approved architecture.
- Avoid: projects not on required New Architecture/Fabric posture.
- Primitive mapping: shared values, worklets, gestures, animations.
- Reduced motion: static state, shorter duration, or disabled gesture flourish.
- Performance hazards: JS/native boundary assumptions and missing cleanup.
- Library policy: new dependency and architecture requirements need approval.

### Flutter Animation APIs
- Approved use: implicit and explicit animation, page transitions, gestures.
- Avoid: animation controller sprawl without lifecycle ownership.
- Primitive mapping: AnimationController, Tween, AnimatedBuilder, Hero.
- Reduced motion: respect platform accessibility and provide non-motion path.
- Performance hazards: expensive rebuilds and missing controller disposal.

### Haptics
- Approved use: threshold, snap, selection, and confirmation feedback on native surfaces.
- Avoid: web-only assumptions, loops, errors, or high-frequency feedback.
- Primitive mapping: platform haptics, optional vibration where appropriate.
- Reduced motion: haptics cannot be the only feedback.
- Performance hazards: annoyance, accessibility conflict, battery impact.
