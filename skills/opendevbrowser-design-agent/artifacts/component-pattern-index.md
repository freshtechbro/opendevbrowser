# Component Pattern Index

Use this index before inventing a new screen structure from scratch. Pick one dominant pattern family, justify it in the design contract, then adapt it to the repo's product language.

## 1. App Shells And Navigation

Use when the page has repeatable navigation, toolbars, inspectors, or multistep depth.

- Preferred families:
  - top bar + primary content + optional inspector rail
  - split navigation with list/detail content
  - dense workspace shell with command row, canvas pane, and secondary panels
- Web guidance:
  - keep route navigation and panel toggles separate
  - treat command bars, breadcrumbs, and tab rows as one system
  - collapse secondary rails deliberately on tablet and mobile
- Failure signals:
  - toolbar actions compete with global navigation
  - left rail, tabs, and breadcrumbs all claim the same hierarchy

## 2. Search, Filters, And Segmentation

Use when the user must narrow or switch views quickly.

- Preferred families:
  - search plus token filters
  - segmented control plus summary count
  - stacked refinement rail for dense datasets
- Web guidance:
  - keep search query, filter state, and sort state addressable in URL params when the view should survive refresh or sharing
  - separate quick toggles from advanced filters
- Failure signals:
  - filter chips, tabs, and sort dropdown all mutate the same state without a clear owner

## 3. Collections, Cards, And Feeds

Use when the UI is primarily about scanning repeated items.

- Preferred families:
  - editorial card stacks
  - compact data cards with one clear primary action
  - masonry or asymmetric feature grids only when the content supports it
- Web guidance:
  - define card anatomy once: media, eyebrow, title, metadata, actions
  - keep empty, loading, and error states visually related to the collection pattern
  - declare the scan unit and stable item identity before adding per-card motion or toolbar complexity
  - choose progressive reveal, lazy containers, or virtualization intentionally when realistic data volume will make the surface heavy
- Failure signals:
  - each card variant invents its own spacing, radius, or action order
  - card identity or expansion state is index-based and collapses during reordering or filtering

## 4. Forms, Settings, And Editors

Use when the interface collects or edits structured input.

- Preferred families:
  - grouped settings sections with clear save semantics
  - single-column editor with sticky action bar
  - split preview/editor only when the comparison is essential
- Web guidance:
  - state whether the flow autosaves, batches, or requires explicit submit
  - keep validation, hint text, and irreversible actions visually distinct
- Failure signals:
  - field-level save and page-level save coexist without clear precedence

## 5. Dashboards, Tables, And Detail Panes

Use when the screen mixes overview metrics with drill-down detail.

- Preferred families:
  - summary strip plus focused detail pane
  - table with sticky controls and adjacent record inspector
  - dashboard sections ordered by operator task frequency, not by visual symmetry
- Web guidance:
  - choose whether the primary scan unit is a row, card, or metric tile
  - keep dense tables readable before adding ornamental styling
  - keep inspectors, previews, and secondary panels lazy when the primary task is scanning or triage
- Failure signals:
  - cards, charts, and tables all have equal prominence and no scan path

## 6. Overlays, Drawers, Sheets, And Menus

Use when work must happen without leaving the current context.

- Preferred families:
  - item-owned detail drawer
  - single modal for confirmation or destructive review
  - contextual menu for low-commitment actions
- Web guidance:
  - use one owner for overlay visibility
  - prefer item-based presentation over multiple booleans
  - define escape, backdrop, and focus-return behavior up front
- Failure signals:
  - sibling components toggle the same modal independently
  - multiple overlays can stack accidentally

## 7. Empty, Loading, Success, And Error States

Treat state surfaces as first-class components, not afterthoughts.

- Required questions:
  - what reassures the user while data loads
  - what action is possible from the empty state
  - what recovery path exists from the error state
- Web guidance:
  - reuse the same layout skeleton as the successful state whenever possible
  - success states should confirm progress without hijacking the next action

## 8. Scroll-Driven Storytelling And Motion

Use only when motion improves comprehension or narrative sequencing.

- Preferred families:
  - section reveal with normalized progress
  - pinned explainer with explicit stage transitions
  - lightweight parallax reserved for emphasis, not default decoration
- Web guidance:
  - drive the effect from one progress model, not many competing observers
  - define reduced-motion fallbacks before implementation
- Failure signals:
  - every section animates differently
  - motion blocks reading or keyboard interaction

## Reference Routine

1. Pick one dominant pattern family.
2. Write the choice into the design contract and explain why it fits the task.
3. Declare the required states and state ownership before component code.
4. Validate the pattern in isolation or in `/canvas` preview before broad rollout.
5. Validate the integrated screen on a real browser surface.
