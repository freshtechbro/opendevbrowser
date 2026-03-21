# State Ownership Matrix

High-quality frontend work depends on deciding who owns state before component APIs or prompts expand. One state should have one clear owner.

| State kind | Primary owner | Typical examples | Avoid |
| --- | --- | --- | --- |
| Micro interaction state | Local component state | hover affordance, disclosure open state, input focus styling | lifting purely presentational state into global stores |
| Draft form state | Closest form controller or route-level model | unsaved edits, validation summary, staged submit payload | mirroring each field into unrelated sibling components |
| URL-addressable view state | URL or search params | filters, sort order, tabs, pagination, selected record id | hiding shareable or refresh-stable state in local component memory |
| Navigation and deep-link state | route owner or shell-level router | canonical route params, tab destination, invalid-param fallback, external entry translation | letting buttons and tabs build route strings independently |
| Remote async state | data layer or query cache | list fetch, optimistic mutations, background refresh | duplicating server state into local component snapshots without invalidation rules |
| Workspace or session state | app-level store or context | authenticated workspace, current project, cross-route inspector selection | pushing global state into prop chains when many routes need it |
| Overlay state | single route or feature owner | active modal item, drawer record id, command palette visibility | multiple booleans across siblings controlling one overlay |
| Canvas governance state | design contract and `/canvas` generation plan | plan acceptance, mutation requirements, validation targets | letting ad-hoc UI state bypass the contract |
| Scroll or motion progress | dedicated derived controller | section reveal progress, pinned story stage, viewport interpolation | separate observers per card with competing transforms |

## Ownership Rules

- If state must survive refresh, it probably belongs in the URL, repo, or data layer.
- If state must coordinate more than one branch of the tree, write down the owner explicitly before coding.
- If state exists only to mirror props, remove it unless the component is intentionally editing a local draft.
- For overlays, prefer item identity or a single state object over boolean pairs like `isOpen` plus `selectedId`.
- For async flows, define loading, success, and failure ownership together so the UI does not split them across unrelated hooks.

## Design-Agent Prompt Rules

When using this skill, declare:

- the owner of selection state
- the owner of navigation and deep-link translation
- the owner of async state
- the owner of overlay state
- whether view state belongs in the URL
- whether the `/canvas` plan or repo code is the mutation authority

If any of those are unclear, the contract is incomplete.
