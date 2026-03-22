# Loading And Feedback Surfaces

Use this when the screen needs loading, empty, success, error, toast, or banner states that must feel intentional instead of bolted on.

## 1. Preserve Layout While Loading

Prefer layout-preserving placeholders over generic spinners:

- keep the real content structure and swap in placeholder data or skeleton rows
- use a fixed placeholder count for repeated content, usually `3` to `6`
- keep placeholder frames stable so the loaded state does not jump

Use a single section-level loader only when the layout cannot be meaningfully previewed during load.

## 2. Give Each Region One Loading Story

- one loading affordance per region
- one empty-state message per result set
- one recovery action near the failing region

Do not stack row spinners, section spinners, and page spinners for the same fetch.

## 3. Empty, Error, And Success Are Part Of The Design

- empty states should explain why nothing is shown and offer a next action
- error states should keep retry or fallback actions close to the failed area
- success states should confirm progress without hijacking the next task

If the screen cannot explain its empty or error behavior in the contract, it is not ready.

## 4. Use Overlays For Transient Feedback

Use overlays, toasts, or banners for short-lived feedback that should not distort the layout:

- keep a single owner for transient feedback state
- align overlays to a clear edge and keep the motion short
- auto-dismiss short confirmations when that will not hide critical information
- queue or replace overlapping feedback instead of stacking many transient surfaces

Use modal or blocking UI only when the user must stop and decide.

## 5. Review Prompts

1. Does the loading state preserve the final layout?
2. How many placeholders render, and why that count?
3. What action can the user take from the empty or error state?
4. Which feedback belongs in layout, and which belongs in an overlay?
5. Who owns transient banners or toasts?

## Failure Signals

- placeholder layouts collapse or shift when content arrives
- the design uses more than one loading indicator for the same async region
- empty and error states are generic copy without a next action
- toast or banner feedback reflows the main layout unnecessarily
- multiple features can stack transient overlays without coordination
