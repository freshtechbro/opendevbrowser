# App Shell And State Wiring

Use this guide when the design task affects navigation shells, route depth, search params, inspectors, drawers, or shared workspace state.

## 1. Shell First

Before styling, decide which layer owns each responsibility:

- app shell: global navigation, workspace switchers, auth-scoped chrome, top-level keyboard shortcuts
- feature shell: feature tabs, inspector visibility, page-local actions, route-local loading states
- component: presentational toggles, disclosure state, hover or pressed affordances

If the same concern appears in two shells, pick one owner and document it in the design contract.

## 2. Route Ownership

Use the URL for state that should survive refresh, deep links, or handoff:

- active tab that matters outside one component
- search query, sort, filters, pagination, selected record id
- editor sub-mode when the user expects shareable or recoverable state

Keep purely presentational toggles out of the URL:

- card expansion that does not change the task
- hover or preview affordances
- temporary compare or reveal states

Treat deep links as a translation contract, not a side effect:

- one route owner maps params into tabs, filters, selected records, or editor sub-modes
- one invalid-route fallback returns the user to a safe baseline when params are stale or incomplete
- row actions, tabs, and shortcut handlers should call the same route translator instead of assembling strings independently
- external entry points should resolve to the same canonical route model as in-app navigation

## 3. Overlay Ownership

All overlays need one owner:

- route-owned when the overlay changes page meaning or selected entity
- feature-owned when the overlay is local to a workflow
- component-owned only for low-risk ephemeral UI

Prefer item-backed overlay state:

- `activeDrawerItemId`
- `commandPaletteMode`
- `confirmDeleteTarget`

Avoid parallel booleans for one overlay family.

## 4. Shared Dependencies

Keep dependency boundaries explicit:

- data caches and async records belong in the data layer
- auth/session context belongs at the app or workspace shell
- feature controllers own only feature-local orchestration
- heavy editors or canvases should expose narrow mutation surfaces instead of leaking internal state across the tree

## 5. Async And Error Boundaries

State which shell owns:

- initial loading
- incremental refresh
- empty results
- recoverable errors
- destructive retry actions

Do not split one async story across unrelated branches unless the user can act on them independently.

## 6. Review Prompts

Before implementation, answer:

1. Which state belongs in the URL?
2. Which state belongs in a shared workspace store?
3. Which overlay has the final authority to open or close?
4. Which shell owns the primary action row?
5. Which route owner resolves deep links, invalid params, and tab switching?
6. Which branch is allowed to show the loading or error affordance?

If any answer is unclear, the shell wiring is not ready.
