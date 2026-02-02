## Continuity Ledger

### Goal (incl. success criteria)
Verify the Chrome extension connection end-to-end by launching an extension session via CLI and disconnecting cleanly; keep extension artifacts up to date.

### Constraints/Assumptions
- Follow AGENTS.md: no stubs/placeholders, DRY, remove dead code, prefer `rg`, no destructive git.
- Only main agent edits `CONTINUITY.md`; sub-agents append to `sub_continuity.md`.
- Approval policy is `never`; run checks locally without prompts.
- Must use RepoPrompt for repo context before starting work.

### Key Decisions
- Use `npx eslint "extension/src/**/*.ts"`, `npx tsc -p extension/tsconfig.json --noEmit`, and `npm run extension:build` to validate extension changes.

### State
- **Done**:
  - Extension lint now passes after fixing `Window` global declaration. (`extension/src/annotate-content.ts`)
  - Extension typecheck passes (`npx tsc -p extension/tsconfig.json --noEmit`).
  - Extension build passes (`npm run extension:build`).
- **Now**:
  - Await further instructions (e.g., re-test extension launch/disconnect).
- **Next**:
  - Re-run extension launch + disconnect test when requested.

### Open Questions (UNCONFIRMED if needed)
- None.

### Working Set (files/ids/commands)
- `extension/src/annotate-content.ts`
- `npx eslint "extension/src/**/*.ts"`
- `npx tsc -p extension/tsconfig.json --noEmit`
- `npm run extension:build`

