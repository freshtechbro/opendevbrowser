# Critique: Google OAuth Session Continuity Plan

## Context and Scope

Reviewed only the named plan plus its investigation, audit, and docs guidance. This critique is plan-only and does not propose implementation beyond clarifying or cutting scope.

## Findings

1. Intent propagation is under-specified. Task 1 says to place `GoogleAuthIntent` in the smallest shared module and thread it through provider, browser, CLI, and tools, but it leaves the owning boundary open while also requiring daemon and remote forwarding later (`docs/plans/google-oauth-session-continuity-2026-06-22.md:46-58`, `:76-82`). Before implementation, decide the single source of truth for intent parsing and serialization so launch, connect, daemon, remote, provider fallback, and tool calls cannot drift.

2. CDP connect parity is ambiguous. The goal and Task 3 say managed and CDP bootstrap should be controllable, but the file list and acceptance criteria make direct CDP connect parity optional with "if included" wording (`docs/plans/google-oauth-session-continuity-2026-06-22.md:109-128`, `:134-139`). This is a blocker-level seam because the investigation identifies CDP cookie overlay as a core failure path. Either include CDP parity in the first branch or explicitly cut CDP from the stated success criteria.

3. Provenance diagnostics need a smaller schema and state owner. Task 4 lists many fields, possible storage in `session-store`, launch/connect responses, and provider fallback diagnostics (`docs/plans/google-oauth-session-continuity-2026-06-22.md:150-169`). The plan should name one minimal diagnostic contract and one owning layer. Otherwise this can sprawl into a broad auth framework, which the audit explicitly warned against.

## Contradictions and Sequencing Problems

- Task 7 tests no managed fallback after extension failure, which is Task 2 behavior, but its dependencies omit Task 2 (`docs/plans/google-oauth-session-continuity-2026-06-22.md:260-265`, `:284`).
- Task 6 depends on Tasks 1 through 4, but it also documents popup recovery from Task 5 and final command wording from Task 2 (`docs/plans/google-oauth-session-continuity-2026-06-22.md:219-226`, `:250`).
- The Open Questions section says no implementation-blocking questions remain while CDP parity, diagnostic ownership, and public flag surface remain unresolved (`docs/plans/google-oauth-session-continuity-2026-06-22.md:327-331`).

## Simplify or Cut

Task 6 is likely over-planned. Updating every public surface, `ASSET_INVENTORY`, `docs/README`, root README, skills, and possibly nested `AGENTS.md` in one branch risks doc churn (`docs/plans/google-oauth-session-continuity-2026-06-22.md:219-241`). Keep only source-owned flag/help docs, troubleshooting, generated manifests, and the required skill update unless a changed surface actually cites the new behavior.

## Questions That Change Implementation Order

1. Is CDP connect parity required in the first branch? If yes, Task 3 must include connect CLI/tool and tests unconditionally.
2. Which layer owns `googleAuthIntent` validation and normalized values: CLI/tool boundary, browser manager, or provider policy?
3. What is the exact public diagnostic schema, and is it session state or response-only metadata?

## Recommendation

Proceed only after clarifying those three seams. Prefer deletion and tighter sequencing over adding new planner tasks.
