# Async And Search State Ownership

Use this when a screen loads remote data, reacts to changing input, or exposes search, scope, filter, or sort controls that can restart work.

## 1. Choose The Trigger Model First

Name the async trigger before writing component structure:

- `load-on-enter`: initial screen load or detail fetch tied to first render
- `restart-on-input`: query, selection, scope, filter, or sort changes
- `long-lived-workflow`: work that must survive navigation, dismissal, or cross-screen reuse

If the trigger model is unclear, the UI will usually duplicate state or fire stale requests.

## 2. One Owner Per Search Story

Decide where query and result ownership lives:

- local component or route state when search is specific to one surface
- URL or search params when the search should survive refresh, deep links, or handoff
- shared store or service only when multiple surfaces truly need the same search session

Keep result arrays, status, and restart logic close to the canonical owner or in the data layer. Do not mirror them into sibling components.

## 3. Execution Rules

- Debounce user-driven restarts before they hit the network or expensive local filtering.
- Treat cancellation as normal for stale requests. Do not surface cancellation as a user-facing error.
- Clear back to a baseline or empty state when the query is empty unless the product explicitly needs default results.
- Apply the same restart policy to scope, filter, and sort changes when they mutate the same result set.
- Keep retry, caching, offline, and dedupe policy in a service once the rules exceed simple view ownership.

## 4. Move Work Out Of The View When

- the work must survive dismissal or route changes
- multiple screens depend on the same in-flight state
- cache, retry, or optimistic rules become product-level policy
- the view is mostly coordinating app-shell or account lifecycle instead of rendering a local task

The view should still own presentation-state transitions even when execution moves into a service.

## 5. Review Prompts

Before implementation, answer:

1. What restarts the async work?
2. Where do query, scope, and sort live?
3. What should happen on an empty query?
4. How are stale responses ignored or cancelled?
5. At what point does the work move out of the view into a service or shared controller?

## Failure Signals

- searches run for empty input with no product reason
- typeahead or scoped search has no debounce or cancellation story
- the same query state exists in the URL, local state, and a shared store
- result ownership is split across sibling components
- retry and cache rules leak into presentation components
