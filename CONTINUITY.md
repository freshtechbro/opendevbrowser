Goal (incl. success criteria):
- Perform code review per user protocol (survey git state, run context_builder review, report findings with file/line references).

Constraints/Assumptions:
- Use RepoPrompt MCP tools for git and context_builder.
- Ask user to confirm review scope if not specified.
- Follow code review output format and max bullet limits.
- Cannot use TodoWrite/Task tools (per system/dev constraints).

Key decisions:
- Start with git status/log/diff to survey changes, then confirm scope.
- Use context_builder response_type="review" on confirmed scope.

State:
  - Done:
    - Read and updated CONTINUITY.md.
  - Now:
    - Run git status/log/diff to survey changes.
  - Next:
    - Ask user to confirm review scope (uncommitted/staged/back:N/main...HEAD).
    - Run context_builder review on confirmed scope.
    - Provide findings in required format.

Open questions (UNCONFIRMED if needed):
- Review scope: uncommitted, staged, back:N, or main...HEAD?

Working set (files/ids/commands):
- CONTINUITY.md
