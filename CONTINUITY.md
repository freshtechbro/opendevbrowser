## Continuity Ledger

### Goal (incl. success criteria)
Answer extension-only CDP bypass questions and, if needed, fix `/ops` disconnect and legacy `/cdp` instability; keep tests >=97% coverage; run lint/build/typecheck; commit changes per protocol.

### Constraints/Assumptions
- Follow AGENTS.md: no stubs/placeholders, DRY, remove dead code, prefer `rg`, no destructive git.
- Only main agent edits `CONTINUITY.md`; sub-agents append to `sub_continuity.md`.
- Approval policy is `never`; run checks locally without prompts.
- Use the daemon started by the user (do not start our own daemon).
- Must use RepoPrompt for repo context before starting work.

### Key Decisions
- Verified current branch already contains ops screenshot timeout fallback and extension readiness/target sync fixes.
- Extension-only default uses `/ops`; legacy `/cdp` requires `--extension-legacy`.

### State
- **Done**:
  - Read `CONTINUITY.md` and `sub_continuity.md`.
  - Ran RepoPrompt context builder for ops/cdp routing.
  - Verified git state (existing fix/test/docs/chore commits; only ledger dirty).
  - Live test: `/ops` launch/goto/snapshot/screenshot/disconnect succeeded; `/cdp` legacy launch blocked by existing `/cdp` client (cdp=on).
- **Now**:
  - Answer CDP bypass and ops/cdp coverage questions with current findings.
  - Determine whether to clear `/cdp` client for re-test or proceed with design guidance only.
- **Next**:
  - If user wants, clear existing `/cdp` client and re-run legacy `/cdp` script to confirm remaining failures.
  - Implement any additional stabilization if `/cdp` still fails (then run tests/lint/build/tsc).
  - Commit ledger update (and any code changes) per protocol.

### Open Questions (UNCONFIRMED if needed)
- Which process currently holds the `/cdp` client slot (cdp=on), and should we close it to retest legacy `/cdp`?
- Do we need a true no-CDP extension path (content-script-only), or is `/ops` (CDP-backed) sufficient?

### Working Set (files/ids/commands)
- `CONTINUITY.md`
- `/private/tmp/opendevbrowser-extension-ops-cdp.mjs`
- `npx opendevbrowser status --daemon`

### Key learnings
- `/ops` path is functional in live test, including disconnect.
- Legacy `/cdp` cannot be validated while another `/cdp` client is connected.
