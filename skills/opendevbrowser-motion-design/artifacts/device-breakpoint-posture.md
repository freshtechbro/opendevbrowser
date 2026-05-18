# Device And Breakpoint Posture

Motion must adapt to posture, pointer, viewport height, power, and refresh rate. Do not assume desktop timing scales down.

## Posture Matrix

| Posture | Motion Changes |
|---|---|
| Mobile portrait | Shorter duration, shorter travel, no default parallax, avoid pinned scroll, larger gesture thresholds, protect touch targets. |
| Mobile landscape | Reduce vertical choreography, avoid blocking short viewports, keep primary actions visible. |
| Tablet portrait | Moderate travel, sheet or side panel based on density, touch-friendly drag thresholds. |
| Tablet landscape | Can use wider spatial transitions, but preserve reading order and pointer/touch parity. |
| Laptop and desktop | Fine pointer allows hover and richer route continuity, but keyboard parity remains required. |
| Large monitor | Avoid excessive travel across long distances; anchor transitions to local regions. |
| Short viewport | Disable pinning, reduce stage count, avoid vertical reveal dependency. |
| Coarse pointer | Prefer press/tap feedback, larger handles, drag thresholds, no hover-only affordance. |
| Fine pointer | Hover/focus microinteractions allowed with keyboard equivalent. |
| Trackpad | Scroll and inertia can be richer, but must not fight native scroll. |
| Touch gesture context | Use interruptible, retargetable, threshold-based motion. |
| Keyboard-only context | Motion cannot change focus order or hide reachable controls. |
| Reduced-power devices | Prefer opacity, transform, static skeletons, fewer simultaneous animations. |
| High-refresh displays | Validate smoothness at high refresh and avoid timing tied to frame counts. |
| Foldable/device posture | Treat `device-posture` as experimental progressive enhancement only. Default to responsive breakpoints first. |

## What Changes By Posture

- Duration: shorter on phones, reduced-power devices, and repeated workflows.
- Distance: local on mobile and large monitors; never force long travel across the screen.
- Pinned-scroll allowance: desktop only by default, disabled on short viewports and most phones.
- Parallax allowance: off by default on mobile and reduced motion.
- Gesture thresholds: larger for touch, smaller for precision pointer, always cancellable.
- Touch target protection: animation must not shrink active targets below usable size.
- Density: reduce stagger count and choreography in dense content.
- Viewport-height constraints: no stage should require more height than the viewport can provide.
- Fallback behavior: static, stacked, and readable content must exist for every scroll stage.
- Reduced-motion handling: remove travel, pinning, parallax, loops, and non-essential gesture flourish.

## Foldable Rule

`device-posture` is experimental. Use it only as progressive enhancement after the default responsive layout and motion contract already work without it.
