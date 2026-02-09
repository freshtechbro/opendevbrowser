---
name: opendevbrowser-continuity-ledger
description: Maintain an OpenDevBrowser continuity ledger in CONTINUITY.md for long-running tasks and resumable work.
version: 1.0.0
---

# OpenDevBrowser Continuity Ledger

Use a lightweight ledger to keep long-running tasks on track across sessions or context compaction.

## When to use
- Multi-step work that spans several actions
- Refactors, migrations, or release work
- Investigations with multiple findings
- Any task likely to resume later

## Ledger file
- Always use `CONTINUITY.md` at the repo root.
- Create it if it does not exist.
- Keep it short and factual.

## Exact template (copy as-is)

```markdown
# OpenDevBrowser Continuity Ledger

Goal (incl. success criteria):
- Constraints/Assumptions:
- Key decisions:
- State:
  - Done:
  - Now:
  - Next:
- Open questions (UNCONFIRMED if needed):
- Working set (files/ids/commands):
```

## Update rules
1. At the start of a long task, read the ledger and refresh Goal/Now/Next.
2. Update the ledger when goals, decisions, or progress state change.
3. Record important tool outcomes briefly.
4. If context is lost, rebuild the ledger from visible state and mark gaps as `UNCONFIRMED`.

## Reply pattern
Start replies with a short "Ledger Snapshot" (Goal + Now/Next + Open questions) when the ledger is in use.
