---
name: opendevbrowser-continuity-ledger
description: This skill should be used when the user asks to "track continuity", "resume a long task", "maintain CONTINUITY.md", or run multi-step work that may span context compaction.
version: 1.1.0
---

# OpenDevBrowser Continuity Ledger

Use this guide to maintain compaction-safe project state in `CONTINUITY.md`.

## Ownership Rules

Apply these rules exactly:

- Allow only the main orchestrator agent to edit `CONTINUITY.md`.
- Instruct sub-agents to never edit `CONTINUITY.md`.
- Require sub-agents to append their outcomes to `sub_continuity.md`.
- If `CONTINUITY.md` is modified incorrectly by another agent, restore it immediately and continue.

## Start-of-Turn Protocol

Run this sequence at the beginning of each turn:

1. Read `CONTINUITY.md`.
2. Read `sub_continuity.md`.
3. Update `CONTINUITY.md` to reflect the current goal, constraints, decisions, and execution state.
4. Proceed with implementation.

If recall is incomplete, rebuild from visible context, mark gaps `UNCONFIRMED`, then continue.

## Required Ledger Template

Maintain these headings and sections:

```markdown
Goal (incl. success criteria):
- Constraints/Assumptions:
- Key decisions:
- State:
  - Done:
  - Now:
  - Next: at least 4 next tasks/subtasks each with a brief description. must be detailed with a clear action item and expected outcome and files to be impacted
- Open questions (UNCONFIRMED if needed):
  - When you have open questions, do your research in the codebase (and on the internet for best practices) to understand the existing patterns and constraints. Choose answers that are consistent with the existing patterns and constraints and best-practice and research all synchronized into logical recommendations. You must research codebase + external sources first, state the recommended option with brief rationale, and explicitly list any items that still require user input.
- Working set (files/ids/commands):
- Key learnings: what worked; what didn't work, best approach identified for next time
```

## Update Triggers

Update `CONTINUITY.md` whenever one of these changes:

- Goal or success criteria
- Constraints or assumptions
- Key decisions
- Progress state (`Done`, `Now`, `Next`)
- Important command/tool outcomes

Keep entries factual and concise. Avoid transcript-style logging.

## Handling Open Questions

When uncertainty exists:

1. Research codebase patterns first.
2. Research external best practices where relevant.
3. Recommend a preferred option with rationale.
4. List only unresolved user-input decisions.
5. Mark unknown facts as `UNCONFIRMED`.

## Reply Pattern

Start response messages with a short ledger snapshot:

- Goal
- Now/Next
- Open questions + recommended option

Print the full ledger only when it materially changes or when requested.
