# Implementation Anti-Patterns

Use this list to stop weak frontend patterns before they spread.

## 1. Boolean Sprawl

Bad:

- one screen tracks `isModalOpen`, `isDrawerOpen`, `isPopoverOpen`, `isConfirmingDelete`, and `selectedId` across many siblings

Prefer:

- one overlay owner with an item-backed state object

## 2. Mixed State Ownership

Bad:

- the same filter state lives in component state, URL params, and a shared store

Prefer:

- one canonical owner with derived views elsewhere

## 3. Placeholder-Led Layout

Bad:

- the UI only looks balanced with fake short copy or idealized data

Prefer:

- real or realistic content, plus explicit overflow and truncation rules

## 4. Pattern Drift

Bad:

- repeated cards, panels, or controls each invent their own spacing, radius, or interaction order

Prefer:

- one pattern family per screen, documented in the contract and checked against the component index

## 5. Motion Without A Driver

Bad:

- many components each own their own scroll math, timing, or parallax rules

Prefer:

- one normalized progress model with reduced-motion fallback

## 6. Heavy Work Per Item

Bad:

- each row or card performs expensive layout, measurement, or data reshaping during render

Prefer:

- precomputed data, memoized derivations only when justified by existing project patterns, and lazy detail work

## 7. Overlay Ownership Split

Bad:

- a toolbar opens a modal while a row also mutates that modal's data source independently

Prefer:

- route or feature ownership plus explicit focus-return behavior

## 8. Contract-Free Canvas Mutation

Bad:

- patching `/canvas` before the design contract and generation plan are coherent

Prefer:

- contract first, plan second, mutation third, preview and feedback after

## 9. Unverified Responsive Claims

Bad:

- declaring mobile support without checking layout, scroll, focus, and overflow at mobile widths

Prefer:

- real-surface validation at the required breakpoints

## 10. Stale Runtime Trust

Bad:

- assuming `npm run extension:build` means a live unpacked extension tab is already running the new code

Prefer:

- reload the unpacked extension, reconnect, and then validate the real surface again

## 11. Unbounded Async Restarts

Bad:

- each keystroke, scope switch, or filter tap starts new async work with no debounce or stale-request handling

Prefer:

- one restart policy with debounce, cancellation, and a clear empty-query behavior

## 12. Spinner Stacking

Bad:

- the same async region shows multiple loaders, layout-shifting placeholders, and no stable empty/error plan

Prefer:

- one loading story per region plus layout-preserving placeholders when the final structure matters

## 13. Raw Token Sprawl

Bad:

- repeated components hardcode colors, spacing, or radius values that drift away from the design system

Prefer:

- one semantic token source with leaf components consuming tokens instead of inventing them

## 14. Live-Service Previews

Bad:

- isolated previews depend on live APIs, auth, or global singletons and only render when the full app happens to be running

Prefer:

- deterministic fixtures, explicit dependency installation, and isolated preview state that mirrors production ownership

## 15. Stringly Routed Actions

Bad:

- buttons, tabs, rows, and shortcuts each assemble route strings or params independently

Prefer:

- one typed route translator with explicit invalid-route fallback and shared deep-link handling

## 16. Unstable List Identity

Bad:

- selection, expansion, or animation state is keyed by array index on a sortable or filterable collection

Prefer:

- stable item identity plus an explicit scan-heavy performance plan for large result sets
