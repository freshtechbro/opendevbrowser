---
name: opendevbrowser-continuity-ledger
description: This skill should be used when the user asks to track continuity, resume a long task, maintain opendevbrowser_continuity.md or a configured continuity ledger, or run multi-step work that may span context compaction.
version: 1.2.0
---

# OpenDevBrowser Continuity Ledger

Use this guide to maintain compaction-safe project state in the configured continuity ledger. Runtime default: `opendevbrowser_continuity.md`. Override it with `continuity.filePath` when project guidance requires another ledger name such as `CONTINUITY.md`.

Validation helper:

- `scripts/validate-skill-assets.sh`

## When to Use This Skill

Use this skill when any of these are true:

- Work is multi-step or long-running.
- Context compaction or session handoff is likely.
- Multiple agents are coordinating the same task.

Start with `opendevbrowser-best-practices` quick start for execution. Switch here once continuity tracking is required.

## Ledger Filename Policy

- Use `opendevbrowser_continuity.md` unless `continuity.filePath` or explicit project guidance selects another path.
- Treat `CONTINUITY.md` as a repo-policy override only when project guidance or configuration explicitly names it.
- Keep `sub_continuity.md` as the sub-agent note convention unless project guidance says otherwise.

## Ownership Rules

Apply these rules exactly:

- Allow only the main orchestrator agent to edit the configured continuity ledger.
- Instruct sub-agents to never edit the configured continuity ledger.
- Require sub-agents to append their outcomes to `sub_continuity.md`.
- If the configured continuity ledger is modified incorrectly by another agent, restore it immediately and continue.

## Start-of-Turn Protocol

Run this sequence at the beginning of each turn:

1. Resolve the ledger path from `continuity.filePath`; use `opendevbrowser_continuity.md` when no override is configured.
2. Read the configured continuity ledger.
3. Read `sub_continuity.md` when present.
4. Update the configured continuity ledger to reflect the current goal, constraints, decisions, and execution state.
5. Proceed with implementation.

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

Update the configured continuity ledger whenever one of these changes:

- Goal or success criteria
- Constraints or assumptions
- Key decisions
- Progress state (`Done`, `Now`, `Next`)
- Important command/tool outcomes

Keep entries factual and concise. Avoid transcript-style logging.

## Validator Contract

The validator must confirm all of these remain documented:

- runtime default `opendevbrowser_continuity.md`
- `continuity.filePath` override policy
- `CONTINUITY.md` as an explicit repo-policy override, not the universal runtime default
- `sub_continuity.md` ownership boundary
- start-of-turn read and update protocol
- required ledger headings and `UNCONFIRMED` handling
- reply pattern with a short ledger snapshot before the main answer

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
