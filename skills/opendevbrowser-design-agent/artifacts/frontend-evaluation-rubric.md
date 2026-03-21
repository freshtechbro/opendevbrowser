# Frontend Evaluation Rubric

Use this rubric before sign-off. A design should not pass on aesthetics alone.

## Must-Pass Gates

- The UI matches the current design contract.
- The screen has a clear information hierarchy.
- Focus, keyboard access, and readable contrast are present where relevant.
- Responsive behavior is intentional, not accidental.
- Copy is real enough to evaluate the actual layout.
- Browser validation was run on the relevant surface.

## Scored Categories

Score each category from `1` to `5`.

### Clarity

- Is the primary action obvious?
- Is the page purpose understandable within a few seconds?

### Visual Direction

- Does the design feel intentional instead of generic?
- Are color, type, and spacing working together as one system?

### Component Discipline

- Are repeated patterns actually consistent?
- Do components share the same edge radius, spacing rhythm, and interaction language?

### State Coverage

- Are default, hover, focus, empty, loading, success, and error states handled when needed?

### Responsiveness

- Does the layout adapt gracefully at the required viewports?
- Are touch targets and overflow behavior sane?

### Accessibility

- Are semantics, focus order, and contrast acceptable?
- Does motion preserve meaning when reduced motion is required?

### Performance And Restraint

- Is motion purposeful instead of noisy?
- Are heavy effects justified?
- Does the screen avoid unnecessary complexity?

## Failure Triggers

Fail the design review if any of these are true:

- The design depends on placeholder content to look good.
- Mobile or keyboard behavior is untested.
- The page is visually inconsistent across repeated components.
- The design contract and shipped output disagree materially.
- Real-browser validation was skipped without an explicit blocker.
