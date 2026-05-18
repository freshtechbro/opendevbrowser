# Motion Pattern Catalog

Each pattern entry is deterministic: use case, avoid case, user value, implementation primitives, reduced-motion fallback, device posture, verification evidence, and failure signals.

## Pattern Selection Rules

- Select the fewest patterns that explain the interface.
- Assign one owner for each timeline: route, state, scroll, gesture, or media.
- Never select a pattern without a reduced-motion fallback.
- Capture temporal evidence for timing-sensitive, scroll-driven, or gesture-coupled patterns.

### Pattern 01 - No-motion Stability
- Use case: dense task surfaces, critical forms, security steps, and repeated workflows.
- Avoid case: first-run education where continuity is needed.
- User value: reduces cognitive load and protects speed.
- Implementation primitives: static DOM changes, focus management, instant state updates.
- Reduced-motion fallback: identical default path.
- Device posture: preferred on small phones, short viewports, keyboard-only contexts, and reduced-power devices.
- Verification evidence: snapshot, screenshot, keyboard order, no unexpected transition in screencast.
- Failure signals: hidden state changes, focus jumps, or fake smoothness from delayed updates.

### Pattern 02 - Opacity Fade
- Use case: low-attention reveal, disabled state, or image load transition.
- Avoid case: spatial continuity or route change where object location matters.
- User value: softens appearance without changing layout.
- Implementation primitives: CSS transition, CSS keyframes, WAAPI, Motion for React opacity.
- Reduced-motion fallback: shorter fade or instant opacity change.
- Device posture: safe across phones, tablets, desktops, and high-refresh displays.
- Verification evidence: screenshot before and after plus debug trace for console stability.
- Failure signals: invisible focus target, text fade that delays reading, or repeated flashing.

### Pattern 03 - Fade-through
- Use case: replacing unrelated content in the same region.
- Avoid case: related elements that need shared identity.
- User value: communicates state replacement without implying travel.
- Implementation primitives: opacity out, small hold, opacity in, optional `content-visibility`.
- Reduced-motion fallback: instant swap with stable focus.
- Device posture: safe on mobile when duration is short.
- Verification evidence: screencast and snapshot after replacement.
- Failure signals: blank gap too long, focus loss, or user cannot tell what changed.

### Pattern 04 - Crossfade
- Use case: image, media, or theme changes where both states occupy the same plane.
- Avoid case: content with separate reading order or interactive controls.
- User value: preserves visual continuity.
- Implementation primitives: stacked elements, opacity interpolation, View Transition API.
- Reduced-motion fallback: instant swap or minimal opacity.
- Device posture: avoid heavy media crossfades on low-power mobile.
- Verification evidence: screencast plus console/network poll.
- Failure signals: double readable text, pointer events on hidden layer, memory leak.

### Pattern 05 - Scale Fade
- Use case: menus, contextual controls, and small confirmations.
- Avoid case: large panels on phones or dense text blocks.
- User value: suggests local emergence.
- Implementation primitives: transform scale plus opacity, transform origin.
- Reduced-motion fallback: opacity-only or instant.
- Device posture: scale distance must be smaller on phones and short viewports.
- Verification evidence: screenshot at open state and keyboard focus check.
- Failure signals: blurred text, layout shift, or focus appears before visible control.

### Pattern 06 - Slide
- Use case: directional navigation, drawers, and page panels.
- Avoid case: long-distance mobile travel without clear origin.
- User value: communicates direction and containment.
- Implementation primitives: transform translate, View Transition API, platform navigation transitions.
- Reduced-motion fallback: instant or short opacity swap with preserved focus.
- Device posture: reduce distance on phones, allow larger travel on tablets and desktops.
- Verification evidence: screencast-start, interaction, screencast-stop, screenshot.
- Failure signals: horizontal overflow, scroll lock bug, or content moves opposite intent.

### Pattern 07 - Shared Element Transition
- Use case: card to detail, thumbnail to viewer, item to editor.
- Avoid case: unrelated objects or elements without stable identity.
- User value: preserves object continuity across route or state.
- Implementation primitives: View Transition API, FLIP, platform shared-element APIs.
- Reduced-motion fallback: fade-through with stable object label.
- Device posture: simplify on mobile and short viewports.
- Verification evidence: browser replay, snapshot before and after, debug-trace-snapshot.
- Failure signals: wrong element identity, flicker, clipped content, or focus detour.

### Pattern 08 - FLIP Layout Transition
- Use case: responsive rearrangement, filter changes, layout toggles.
- Avoid case: constantly changing lists without stable keys.
- User value: makes layout change comprehensible.
- Implementation primitives: measure first and last boxes, invert transform, play transform.
- Reduced-motion fallback: instant layout with optional opacity.
- Device posture: skip complex FLIP on low-power devices or very long lists.
- Verification evidence: screencast plus no layout shift after settle.
- Failure signals: index-keyed items, stale measurements, layout thrash.

### Pattern 09 - List Reordering
- Use case: drag sorting, priority changes, grouped filters.
- Avoid case: live data streams with unstable identity.
- User value: shows where the item moved.
- Implementation primitives: stable keys, FLIP, transform, drag overlay.
- Reduced-motion fallback: instant order update plus text announcement when needed.
- Device posture: touch targets and drag thresholds increase on phones.
- Verification evidence: pointer drag, snapshot order, screen-reader announcement check where relevant.
- Failure signals: item teleport, wrong item moves, focus lost after reorder.

### Pattern 10 - Staggered Reveal
- Use case: progressive disclosure of sibling content.
- Avoid case: long lists, dense dashboards, or critical data.
- User value: creates scan order and hierarchy.
- Implementation primitives: delay tokens, CSS custom properties, WAAPI, Motion for React variants.
- Reduced-motion fallback: all items visible immediately or opacity-only group reveal.
- Device posture: lower count and shorter delay on phones.
- Verification evidence: screencast and snapshot after all items settle.
- Failure signals: content blocked by choreography or keyboard order mismatches visual order.

### Pattern 11 - Choreographed Sequence
- Use case: hero introduction, onboarding, product explanation.
- Avoid case: repeated task flows.
- User value: tells a short visual story.
- Implementation primitives: timeline, named phases, stagger, easing, WAAPI, GSAP, Motion for React.
- Reduced-motion fallback: static final composition with optional instant phase labels.
- Device posture: cap duration on mobile and short viewports.
- Verification evidence: full browser replay, screenshots at start and end, console stability.
- Failure signals: skip impossible, content unreadable, or competing timelines.

### Pattern 12 - Transition Hierarchy
- Use case: nested state changes where parent and child both update.
- Avoid case: independent updates with no semantic relationship.
- User value: clarifies what changed first and why.
- Implementation primitives: parent timeline, child offsets, route transition boundaries.
- Reduced-motion fallback: parent state updates first, child state appears statically.
- Device posture: keep hierarchy but reduce travel on small screens.
- Verification evidence: screencast and debug trace.
- Failure signals: children animate before parent context exists.

### Pattern 13 - Progressive Disclosure
- Use case: accordions, filters, advanced settings, expandable content.
- Avoid case: hiding required primary content.
- User value: reveals complexity on demand.
- Implementation primitives: height auto avoidance, transform, clip-path with care, content visibility.
- Reduced-motion fallback: instant expand with focus placed after trigger.
- Device posture: avoid large vertical jumps on phones and short viewports.
- Verification evidence: snapshot after open, keyboard order, screenshot.
- Failure signals: focus trap, scroll jump, or text clipped after animation.

### Pattern 14 - Modal Motion
- Use case: interruptive task or confirmation.
- Avoid case: non-blocking information.
- User value: separates modal task from page context.
- Implementation primitives: backdrop opacity, dialog scale/translate, focus trap.
- Reduced-motion fallback: instant modal with focus moved to heading.
- Device posture: phone modal often becomes sheet or full-screen.
- Verification evidence: screenshot, keyboard loop, reduced-motion check.
- Failure signals: background remains interactive, focus appears before modal, or escape fails.

### Pattern 15 - Sheet Motion
- Use case: mobile action panels, filters, detail panels.
- Avoid case: desktop-only popovers with precise pointer anchor.
- User value: implies anchored temporary surface.
- Implementation primitives: translateY, drag handle, snap points, inertial release.
- Reduced-motion fallback: instant sheet or full-screen transition.
- Device posture: primary on phones; use side sheet or popover on tablet and desktop.
- Verification evidence: pointer drag, snapshot, screencast.
- Failure signals: scroll conflict, trapped content, or no escape path.

### Pattern 16 - Popover Motion
- Use case: anchored tips, menus, quick controls.
- Avoid case: complex workflows or large content.
- User value: preserves local context.
- Implementation primitives: opacity, scale, transform origin, collision-aware placement.
- Reduced-motion fallback: instant appearance.
- Device posture: convert to sheet on small touch devices when target is cramped.
- Verification evidence: screenshot at anchors, keyboard navigation.
- Failure signals: clipped popover, hover-only access, or focus order mismatch.

### Pattern 17 - Toast Motion
- Use case: non-blocking status after an action.
- Avoid case: critical errors requiring decision.
- User value: confirms action without stealing context.
- Implementation primitives: translate, opacity, timer, pause on hover/focus.
- Reduced-motion fallback: instant placement with same timeout rules.
- Device posture: avoid covering mobile navigation or primary actions.
- Verification evidence: screenshot, timing check, reduced-motion check.
- Failure signals: hidden focus, unpausable message, or repeated stack overflow.

### Pattern 18 - Skeleton Shimmer
- Use case: predictable loading structure.
- Avoid case: unknown layout, long waits, or reduced-motion contexts.
- User value: preserves layout while data arrives.
- Implementation primitives: static skeleton, gradient animation, CSS keyframes.
- Reduced-motion fallback: static skeleton or progress text.
- Device posture: prefer static skeleton on reduced-power mobile.
- Verification evidence: screenshot loading and loaded states.
- Failure signals: fake progress, shimmer never stops, or layout shifts after load.

### Pattern 19 - Progress Morph
- Use case: upload, generation, installation, checkout.
- Avoid case: unknown progress disguised as precision.
- User value: connects pending state to completion.
- Implementation primitives: determinate progress, path morph, width transform, state labels.
- Reduced-motion fallback: static steps or determinate text.
- Device posture: keep labels visible on phones.
- Verification evidence: screencast through progress and final state.
- Failure signals: fake progress, no failure state, or completion hidden.

### Pattern 20 - Pull-to-refresh Elasticity
- Use case: touch-first refresh gesture.
- Avoid case: desktop, keyboard-only, or pages with native refresh expectations.
- User value: gives direct-manipulation feedback.
- Implementation primitives: gesture threshold, transform, spring settle, haptic cue.
- Reduced-motion fallback: static refresh button.
- Device posture: phone and tablet touch only.
- Verification evidence: touch/pointer drag sequence and snapshot after refresh.
- Failure signals: accidental refresh, scroll conflict, or haptic spam.

### Pattern 21 - Swipe-to-dismiss
- Use case: dismiss cards, notifications, queued items.
- Avoid case: destructive actions without undo.
- User value: makes dismissal direct and fast.
- Implementation primitives: horizontal drag, threshold, velocity, undo state.
- Reduced-motion fallback: button-based dismiss with instant removal.
- Device posture: touch primary; keyboard and buttons required.
- Verification evidence: pointer drag, undo check, screenshot.
- Failure signals: no undo, accidental removal, or keyboard inaccessible.

### Pattern 22 - Drag/Reorder Coupling
- Use case: sortable boards, queues, playlists.
- Avoid case: dense content without stable handles.
- User value: item follows input and list responds.
- Implementation primitives: pointer capture, transform overlay, collision model, FLIP siblings.
- Reduced-motion fallback: explicit move up/down controls.
- Device posture: larger handles on coarse pointers.
- Verification evidence: pointer sequence, snapshot order, debug trace.
- Failure signals: scroll fights drag, item drops in wrong slot, or focus disappears.

### Pattern 23 - Inertia
- Use case: flingable carousels, maps, physics-like panels.
- Avoid case: precision tasks and reduced-motion users.
- User value: preserves momentum from input.
- Implementation primitives: velocity capture, decay, bounds, snap points.
- Reduced-motion fallback: snap immediately to nearest stable state.
- Device posture: touch and trackpad contexts only.
- Verification evidence: screencast of release and settle.
- Failure signals: unbounded movement, overscroll conflict, or hard-to-stop motion.

### Pattern 24 - Spring Settle
- Use case: panels, toggles, chips, drag release, shared elements.
- Avoid case: dense text or long lists where bounce distracts.
- User value: makes state changes feel responsive.
- Implementation primitives: spring tokens, damping, stiffness, mass.
- Reduced-motion fallback: critically damped short transition or instant.
- Device posture: smaller displacement on phones.
- Verification evidence: browser replay and no oscillation after settle.
- Failure signals: rubbery interface, endless bounce, or inconsistent tokens.

### Pattern 25 - Overshoot
- Use case: playful confirmation, snap point arrival, brand moment.
- Avoid case: critical, medical, financial, or destructive flows.
- User value: adds emphasis and physicality.
- Implementation primitives: easing curve, spring, keyframe beyond target.
- Reduced-motion fallback: no overshoot.
- Device posture: minimize on mobile and reduced-power devices.
- Verification evidence: screencast and final alignment screenshot.
- Failure signals: target misalignment, motion sickness, or childish tone mismatch.

### Pattern 26 - Anticipation
- Use case: button to panel, card expansion, drag pickup.
- Avoid case: immediate safety or emergency actions.
- User value: prepares the user for direction or scale.
- Implementation primitives: small pre-motion transform, phase timeline.
- Reduced-motion fallback: omit anticipation and show final state.
- Device posture: very short on phones.
- Verification evidence: screencast at normal speed.
- Failure signals: action feels delayed or reverse motion confuses.

### Pattern 27 - Follow-through
- Use case: physical objects, cards, icons, drag release.
- Avoid case: static enterprise data grids.
- User value: makes stop feel natural.
- Implementation primitives: secondary delayed movement, spring tail.
- Reduced-motion fallback: remove tail motion.
- Device posture: limit duration and amplitude on small screens.
- Verification evidence: screencast and final-state screenshot.
- Failure signals: content keeps moving while user tries next action.

### Pattern 28 - Interruptibility And Retargeting
- Use case: rapidly changing search, tabs, gestures, route transitions.
- Avoid case: irreversible submit flows.
- User value: keeps UI responsive to current intent.
- Implementation primitives: cancellable animations, active animation retarget, `document.getAnimations()`, framework controls.
- Reduced-motion fallback: instant retarget to current state.
- Device posture: required on touch and keyboard-heavy workflows.
- Verification evidence: rapid repeat interaction screencast.
- Failure signals: stale animation wins, wrong final state, or input ignored.

### Pattern 29 - Hover/Focus Microinteraction
- Use case: affordance, focus state, control grouping.
- Avoid case: hover-only disclosure or mobile-only surfaces.
- User value: confirms interactivity.
- Implementation primitives: CSS transition, focus-visible, transform/opacity/color.
- Reduced-motion fallback: static focus and color change.
- Device posture: hover for fine pointer; focus and press for coarse or keyboard.
- Verification evidence: hover, focus, keyboard screenshot.
- Failure signals: invisible focus, touch has no equivalent, or text shifts.

### Pattern 30 - Press/Tap Feedback
- Use case: buttons, chips, toggles, cards with actions.
- Avoid case: passive content or disabled controls.
- User value: confirms input was received.
- Implementation primitives: active scale, opacity, color, haptic where native.
- Reduced-motion fallback: color or state label only.
- Device posture: critical on touch; subtle on desktop.
- Verification evidence: interaction screencast and state snapshot.
- Failure signals: feedback appears after action completes or causes layout shift.

### Pattern 31 - Haptic-synchronized Motion
- Use case: native mobile confirmation, snap, selection, threshold crossing.
- Avoid case: web-only experiences without haptic API certainty or repeated loops.
- User value: reinforces tactile state.
- Implementation primitives: platform haptics, vibration API only when appropriate, synchronized visual state.
- Reduced-motion fallback: keep haptic optional and never required.
- Device posture: native phone and tablet only by default.
- Verification evidence: platform test notes plus visual screencast.
- Failure signals: haptic spam, inaccessible feedback, or mismatch with visual state.

### Pattern 32 - Scroll Reveal
- Use case: narrative landing pages and progressive section entry.
- Avoid case: essential content that must be immediately available.
- User value: guides reading order.
- Implementation primitives: IntersectionObserver, CSS view timelines, Motion for React scroll, GSAP ScrollTrigger when approved.
- Reduced-motion fallback: static content in reading order.
- Device posture: reduce distance and count on phones.
- Verification evidence: scroll screencast, snapshot after reveal, reduced-motion check.
- Failure signals: content hidden from keyboard or screen readers.

### Pattern 33 - Parallax
- Use case: spatial depth in brand or editorial surfaces.
- Avoid case: task flows, mobile default, or vestibular-risk contexts.
- User value: adds depth when background and foreground relationship matters.
- Implementation primitives: transform based on scroll progress, CSS perspective, WebGL where approved.
- Reduced-motion fallback: static layers.
- Device posture: off by default on mobile and short viewports.
- Verification evidence: screencast plus reduced-motion proof.
- Failure signals: nausea risk, jank, or text readability loss.

### Pattern 34 - Pinned Scroll Stage
- Use case: controlled product story with explicit stages.
- Avoid case: short viewports, keyboard-heavy content, or dense tasks.
- User value: aligns text and visual explanation.
- Implementation primitives: sticky layout, stage index, scroll progress, snap exits.
- Reduced-motion fallback: unpinned stacked sections.
- Device posture: avoid or simplify on phones and short viewports.
- Verification evidence: full scroll replay, keyboard order, escape condition.
- Failure signals: scroll trap, hidden content, or no exit.

### Pattern 35 - Scroll Snap
- Use case: carousels, panels, steps, media galleries.
- Avoid case: pages where free reading scroll matters.
- User value: lands content predictably.
- Implementation primitives: CSS scroll-snap, snap points, focus management.
- Reduced-motion fallback: preserve snap if it does not animate travel, otherwise static links.
- Device posture: useful on touch with clear navigation.
- Verification evidence: pointer/scroll sequence and snapshot at snap point.
- Failure signals: impossible partial reading, focus misalignment, or accidental snap.

### Pattern 36 - Text/Count Transition
- Use case: counters, metrics, filter totals, time-sensitive labels.
- Avoid case: critical exact numbers where animation delays comprehension.
- User value: indicates value changed.
- Implementation primitives: number interpolation, opacity swap, accessible text updates.
- Reduced-motion fallback: instant value update.
- Device posture: keep short on all devices.
- Verification evidence: before/after snapshot and screen-reader note where relevant.
- Failure signals: fake precision, stale ARIA, or unreadable rolling digits.

### Pattern 37 - SVG Path Draw
- Use case: diagrams, icons, process illustrations.
- Avoid case: repeated core interactions.
- User value: explains construction or direction.
- Implementation primitives: stroke-dasharray, stroke-dashoffset, WAAPI, CSS keyframes.
- Reduced-motion fallback: final path visible.
- Device posture: safe when light; avoid heavy SVG on low-power devices.
- Verification evidence: screencast and final screenshot.
- Failure signals: path meaning lost without animation or excessive CPU.

### Pattern 38 - Icon Morph
- Use case: menu to close, play to pause, save to saved.
- Avoid case: unrelated icons or ambiguous state.
- User value: shows state continuity in a compact control.
- Implementation primitives: SVG morph, crossfade, path interpolation, Rive.
- Reduced-motion fallback: instant icon swap with label.
- Device posture: must remain readable at mobile sizes.
- Verification evidence: interaction screenshot and reduced-motion check.
- Failure signals: unrecognizable in-between state or no text alternative.

### Pattern 39 - Lottie/Rive Illustration
- Use case: empty states, onboarding, success illustrations, interactive diagrams.
- Avoid case: critical controls, heavy pages, or unapproved runtime dependency.
- User value: communicates mood or process.
- Implementation primitives: Lottie renderer, Rive state machine, asset cleanup.
- Reduced-motion fallback: static poster frame or non-looping still.
- Device posture: pause or simplify on low-power and reduced-motion contexts.
- Verification evidence: replay, memory/lifecycle cleanup check, screenshot poster fallback.
- Failure signals: endless loop, inaccessible information, or leaked runtime object.

### Pattern 40 - 3D Transform
- Use case: card depth, carousel, spatial cue.
- Avoid case: core text reading or precise data.
- User value: suggests layers and orientation.
- Implementation primitives: CSS transform, perspective, backface visibility.
- Reduced-motion fallback: flat 2D state.
- Device posture: subtle on mobile and disabled when readability suffers.
- Verification evidence: screenshot at desktop and mobile, reduced-motion proof.
- Failure signals: blurry text, z-index bugs, or pointer mismatch.

### Pattern 41 - WebGL/Spatial Motion
- Use case: product configurator, spatial simulation, high-end brand surface.
- Avoid case: ordinary layout flourish or unapproved runtime lane.
- User value: shows spatial relationships not possible in 2D.
- Implementation primitives: Three.js, react-three-fiber, WebGL, Spline export only when approved.
- Reduced-motion fallback: static render, poster, or 2D equivalent.
- Device posture: require lower fidelity path for phones and low-power devices.
- Verification evidence: browser replay, screenshot, debug trace, performance evidence.
- Failure signals: inaccessible canvas, missing cleanup, battery drain, or dependency surprise.

### Pattern 42 - Route View Transition
- Use case: SPA or MPA route changes where continuity aids orientation.
- Avoid case: unrelated routes or pages with unstable DOM identity.
- User value: reduces page change disorientation.
- Implementation primitives: View Transition API, router transition hooks, shared names.
- Reduced-motion fallback: normal route navigation with focus on heading.
- Device posture: keep short and avoid long travel on mobile.
- Verification evidence: route-change screencast, snapshot after navigation, focus check.
- Failure signals: wrong shared names, stale screenshot, or browser support not handled.
