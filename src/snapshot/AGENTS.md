# Local AGENTS.md (src/snapshot)

Applies to `src/snapshot/`. Extends `src/AGENTS.md` and root `AGENTS.md`.

## Local Architecture
- AX snapshot pipeline respects `snapshot.maxNodes` and emits iframe-skip warnings.
- Ref storage feeds tool actions and is invalidated on navigation/target changes.

## Responsibilities
- Build snapshots and manage ref stores for targets.
- Keep AX-outline snapshots token-efficient and deterministic.

## Safety & Constraints
- Preserve stable ref mapping `{ backendNodeId, frameId, targetId }`.
- Clear refs on navigation or target changes.
- Do not mutate the DOM to create refs.

## Testing
- Add/adjust Vitest coverage for snapshot/ref lifecycle behavior.

## Documentation Sync
- Update `docs/REFACTORING_PLAN.md` if snapshot/ref behavior changes.

## Folder Structure
```
src/snapshot/
```
