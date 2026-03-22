# Isolated Preview Validation

Use this playbook before full-page rollout. The goal is to prove the pattern in a stable fixture before broader integration and then carry the same state matrix onto real browser surfaces.

## When To Use It

- new component families
- dense shells or editors
- async-heavy screens
- motion or scroll-driven interactions
- any UI that already failed once in live validation

## Preview Discipline

Build a deterministic isolated surface first:

- story, fixture route, local sandbox, or `/canvas` preview target
- realistic copy and realistic data volume
- fixed viewport sizes for mobile, tablet, and desktop
- installed theme, router, and shell dependencies when the real surface requires them
- explicit reduced-motion and empty/error variants when relevant

Do not continue layering polish on a preview that already crashes or visually collapses.

## Required Fixture States

Cover the relevant set explicitly:

- default
- hover and focus
- loading
- empty
- success
- error
- overflow or long-content
- reduced-motion
- mobile compact layout

If the component never renders one of these states in isolation, it is likely to regress when integrated.

## Dependency Rules

- inject mock or deterministic data sources into the preview
- remove network dependence from the isolated fixture
- install every required environment, provider, or theme dependency directly in the preview
- keep async, search, and filter fixtures deterministic, including empty-query and non-happy paths
- keep one owner for feature flags, search params, or overlay state inside the preview
- if the UI depends on app-shell context, stub only the minimum shell contract needed for the task
- do not make required production dependencies optional just to silence preview crashes

## Validation Loop

1. Build the isolated surface.
2. Fix preview crashes, missing dependency wiring, or state drift before broader integration.
3. Validate the same states in a real browser session.
4. Only then move to the integrated page, shell, or `/canvas` workflow.

## OpenDevBrowser Commands

```bash
npx opendevbrowser launch --no-extension --start-url http://127.0.0.1:3000/preview/component
npx opendevbrowser snapshot --session-id <session-id>
npx opendevbrowser screenshot --session-id <session-id>
npx opendevbrowser debug-trace-snapshot --session-id <session-id>
npx opendevbrowser canvas --command canvas.preview.render --params '{"canvasSessionId":"<canvas-session-id>","leaseId":"<lease-id>","targetId":"<target-id>","projection":"canvas_html"}'
```

Use the same fixture states as the contract when comparing preview and integrated behavior.
