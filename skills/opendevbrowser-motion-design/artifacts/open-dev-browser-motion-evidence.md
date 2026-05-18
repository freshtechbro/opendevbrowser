# OpenDevBrowser Motion Evidence

Motion cannot be accepted from code inspection alone. Use OpenDevBrowser to prove timing, continuity, scroll behavior, gesture response, reduced motion, and viewport posture on a real browser surface.

## Required Proof Commands

Use the snapshot to refs to actions model:

```bash
opendevbrowser launch --no-extension --start-url <url> --output-format json
opendevbrowser snapshot --session-id <session-id>
opendevbrowser screenshot --session-id <session-id>
opendevbrowser debug-trace-snapshot --session-id <session-id>
opendevbrowser screencast-start --session-id <session-id> --output-dir <artifact-dir>
# perform click, pointer-drag, scroll, route, or keyboard interaction
opendevbrowser screencast-stop --session-id <session-id> --screencast-id <screencast-id>
```

## Temporal Proof Requirements

Timing-sensitive choreography, route transitions, shared element transitions, scroll-driven stages, and gesture-coupled motion require browser replay evidence with `screencast-start` and `screencast-stop`.

## Viewport Matrix

Capture the viewport matrix with screenshot, snapshot, and relevant interaction proof across:

- phone portrait
- phone landscape
- tablet portrait
- tablet landscape
- laptop or desktop
- large monitor when supported
- short viewport
- reduced motion
- coarse pointer path when relevant
- keyboard-only path

## Reduced Motion Proof

Prove that `prefers-reduced-motion` preserves content and task completion. The reduced path should remove non-essential travel, parallax, pinning, loops, and overshoot.

## Canvas Preview

When the design-agent `/canvas` workflow is used, include `canvas.preview.render`, `canvas.feedback.poll`, and saved preview evidence in the motion audit.

## Stability Checks

Record console and network stability after the motion sequence. A motion implementation with runtime errors, unresolved network failures, focus traps, overflow, or hidden content does not pass release.
