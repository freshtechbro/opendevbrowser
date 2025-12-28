# Continuity Ledger (compaction-safe)
Maintain a single Continuity Ledger for this workspace in `CONTINUITY.md`. The ledger is the canonical session briefing designed to survive context compaction; do not rely on earlier chat text unless it's reflected in the ledger.

## How it works
- At the start of every assistant turn: read `CONTINUITY.md`, update it to reflect the latest goal/constraints/decisions/state, then proceed with the work.
- Update `CONTINUITY.md` again whenever any of these change: goal, constraints/assumptions, key decisions, progress state (Done/Now/Next), or important tool outcomes.
- Keep it short and stable: facts only, no transcripts. Prefer bullets. Mark uncertainty as `UNCONFIRMED` (never guess).
- If you notice missing recall or a compaction/summary event: refresh/rebuild the ledger from visible context, mark gaps `UNCONFIRMED`, ask up to 1-3 targeted questions, then continue.

## `todowrite` vs the Ledger
- `todowrite` is for short-term execution scaffolding while you work (a small 3-7 step plan with pending/in_progress/completed).
- `todoread` is for checking the current task plan state.
- `CONTINUITY.md` is for long-running continuity across compaction (the "what/why/current state"), not a step-by-step task list.
- Keep them consistent: when the plan or state changes, update the ledger at the intent/progress level (not every micro-step).

## In replies
- Begin with a brief "Ledger Snapshot" (Goal + Now/Next + Open Questions). Print the full ledger only when it materially changes or when the user asks.

## `CONTINUITY.md` format (keep headings)
Goal (incl. success criteria):
- Constraints/Assumptions:
- Key decisions:
- State:
  - Done:
  - Now:
  - Next: at least 4 next tasks/subtasks each with a brief description. must be detailed with a clear action item and expected outcome and files to be impacted
- Open questions (UNCONFIRMED if needed):
  - When you have open questions, do your research in the codebase (and on the internet for best practices) to understand the existing patterns and constraints. Choose answers that are consistent with the existing patterns and constraints and best-practice.
- Working set (files/ids/commands):

# Agent Guidelines (opendevbrowser)

## Purpose
This file orients agentic coding tools to this repository's expectations.
Use it as the authoritative reference for commands, style, and safety.

## Repository Layout
- `docs/` holds the authoritative plans and blueprints.
- `docs/PLAN.md`, `docs/opendevbrowser-plan.md`, `docs/IMPLEMENTATION_BLUEPRINT.md` must stay in sync.
- `src/` contains the OpenCode plugin implementation.
- `extension/` is reserved for the optional Chrome extension.
- `skills/` contains plugin skill packs.

## Repository Folder Structure
```
.
|-- coverage/
|-- dist/
|-- docs/
|-- extension/
|-- node_modules/
|-- skills/
|-- src/
`-- tests/
```

## Layered AGENTS.md
- Root `AGENTS.md` applies repo-wide; the nearest subfolder `AGENTS.md` overrides it.
- Subfolder guides: `src/AGENTS.md`, `extension/AGENTS.md`, `tests/AGENTS.md`, `docs/AGENTS.md`, `skills/AGENTS.md`.
- Nested guides exist under `src/**/AGENTS.md` and `extension/**/AGENTS.md`; the closest file to the working directory takes precedence.
- When working inside `src/` or `extension/`, check for module-level `AGENTS.md` (including `extension/src/**`) and follow it first.

## Setup
- Install dependencies: `npm install`

## Build, Lint, and Test Commands
Scripts are in `package.json`:
- `npm run build` (tsc -p tsconfig.json, outputs `dist/`)
- `npm run dev` (tsc -p tsconfig.json --watch)
- `npm run lint` (eslint "{src,tests}/**/*.ts")
- `npm run test` (vitest run --coverage)
- `npm run extension:build` (tsc -p extension/tsconfig.json)

### Single Test Guidance
Vitest:
- Run a single file: `npm run test -- tests/foo.test.ts`
- Run a single test name: `npm run test -- -t "test name"`
- Direct: `npx vitest run tests/foo.test.ts`

Playwright (when wired):
- Run a single file: `npx playwright test tests/foo.spec.ts`
- Run a single test name: `npx playwright test -g "test name"`

## Test Configuration
- `vitest.config.ts` uses Node environment and `tests/**/*.test.ts`.
- Coverage thresholds: 95% for lines/functions/branches/statements.
- Coverage scope: `src/**/*.ts` (excludes extension and a few internal files).

## Linting
- ESLint flat config in `eslint.config.js` using `@typescript-eslint`.
- `@typescript-eslint/no-explicit-any` is an error.
- `@typescript-eslint/no-unused-vars` ignores args prefixed with `_`.
- No Prettier config; follow ESLint and existing formatting.

## Formatting
- Indentation: 2 spaces.
- Line endings: LF.
- Keep edits ASCII unless the file already uses Unicode.

### Naming
- Files and folders: `kebab-case`.
- Variables and functions: `camelCase`.
- Classes and types: `PascalCase`.
- Tool and command names: `opendevbrowser_*`.

### Imports
- Order imports: Node built-ins, external packages, internal modules, relative paths.
- Use `import type` for type-only imports.
- Avoid deep relative chains when a local module export exists.

### TypeScript
- Compiler config: strict, noUncheckedIndexedAccess, ES2022 target, ESNext modules.
- Prefer explicit types at boundaries (tool args, public APIs).
- Avoid `any`, `@ts-ignore`, and `@ts-expect-error`.
- Use `unknown` for unsafe inputs, then narrow with validation.
- Use Zod schemas for tool argument validation.

### Error Handling
- Never use empty `catch` blocks.
- Prefer `throw new Error("message", { cause })` when rethrowing.
- Surface tool errors as structured error objects, not raw stack traces.
- Include enough context to debug without leaking secrets.

### Logging and Secrets
- Do not log cookies, tokens, or captured page data.
- Redact secrets in snapshots or logs.
- Keep CDP endpoints bound to `127.0.0.1` by default.

## Tooling Expectations
- Plugin runs in the OpenCode runtime (Bun).
- Prefer `Bun.$` for shell execution inside tools.
- Tool names must be namespaced as `opendevbrowser_*`.

## Testing Guidelines
- Unit tests: Vitest (`*.test.ts` or `*.spec.ts`).
- Integration tests: Playwright where relevant.
- Place tests in `tests/` or alongside modules, but keep naming consistent.

## Plugin Architecture Principles
- Plugin-native implementation only (no MCP orchestration).
- Script-first UX: snapshot -> refs -> actions.
- Snapshots should be token-efficient (AX-outline by default).
- Actions should operate on refs and be deterministic.

## Current Architecture (Implementation)
- Config loads from `~/.config/opencode/opendevbrowser.jsonc` via Zod; malformed JSONC throws.
- `BrowserManager` orchestrates Playwright sessions, `TargetManager` lifecycle, and ref invalidation listeners.
- Snapshot pipeline uses AX outline, entropy-based redaction, `snapshot.maxNodes`, and iframe-skip warnings.
- DevTools trackers capture console/network, strip query/hash by default, and honor `devtools.showFullUrls/showFullConsole`.
- Export pipeline captures DOM in page context, DOM-sanitizes by default, inlines subtree styles with node caps via `export.maxNodes`, and warns on truncation; `allowUnsafeExport` bypasses sanitization with warning.
- Skills load from `skills/` with fallback to parent dir; topic filtering is heading-based.
- Relay protocol types live in `src/relay/` and are consumed by the extension with configurable relay settings.

## Architecture Alignment (Planned vs Current)
- Source of truth: `docs/PLAN.md`, `docs/opendevbrowser-plan.md`, `docs/IMPLEMENTATION_BLUEPRINT.md`, `docs/ARCHITECTURE_COMPARISON.md`.
- Snapshots: prefer Accessibility-domain AX outline; avoid DOM mutation for refs.
- Refs: stable mapping `{ backendNodeId, frameId, targetId }`; invalidate on navigation/target switch.
- ScriptRunner: include retry/backoff helpers for waits and actions.
- Relay: extension honors configurable `relayPort`/`relayToken` (no hardcoded relay URL).
- Prompting guide: `topic` argument must filter guidance or be removed.

## Security and Safety
- Refuse non-local CDP endpoints unless explicitly allowed by config.
- CDP endpoint validation uses proper URL hostname parsing (allowlist: localhost, 127.0.0.1, ::1).
- Do not expose raw CDP tools unless user-enabled.
- Avoid writing browser profiles or caches into git.
- DevTools output (network/console) redacts sensitive query params and token-like strings by default.
- Export/clone pipeline sanitizes HTML by default (strips scripts, on* handlers, dangerous URLs).

## Plugin Configuration
- Config is stored in a plugin-owned file: `~/.config/opencode/opendevbrowser.jsonc`
- OpenCode's `opencode.json` only needs `"plugin": ["opendevbrowser"]` - no other keys required.
- The plugin works out-of-box with sensible defaults; config file is optional for customization.

### Plugin Versioning
- **Recommended**: Use bare package name `"opendevbrowser"` for stable, offline-friendly installs.
- **Pinned version**: Use `"opendevbrowser@1.2.3"` to lock to a specific version.
- **Updates**: Run `bun update opendevbrowser` in `~/.cache/opencode/node_modules/` to update manually.

### Config File Format (`~/.config/opencode/opendevbrowser.jsonc`)
```jsonc
{
  "headless": false,
  "profile": "default",
  "persistProfile": true,
  "snapshot": { "maxChars": 16000, "maxNodes": 1000 },
  "export": { "maxNodes": 1000, "inlineStyles": true },
  "devtools": { "showFullUrls": false, "showFullConsole": false },
  "security": {
    "allowRawCDP": false,
    "allowNonLocalCdp": false,
    "allowUnsafeExport": false
  },
  "relayPort": 8787,
  "relayToken": "optional-secret",
  "chromePath": "/path/to/chrome",
  "flags": []
}
```

## For LLM Agents (Installation Playbook)

When a user asks to install opendevbrowser, follow these steps:

1. **Read existing config** (do not overwrite):
   ```bash
   cat ~/.config/opencode/opencode.json
   ```

2. **Add plugin to array** (preserve existing plugins):
   - If `plugin` array exists, append `"opendevbrowser"` if not present.
   - If no `plugin` array, add `"plugin": ["opendevbrowser"]`.

3. **Example minimal opencode.json**:
   ```json
   {
     "$schema": "https://opencode.ai/config.json",
     "plugin": ["opendevbrowser"]
   }
   ```

4. **Verify installation**:
   - Restart OpenCode or start a new session.
   - Run `opendevbrowser_status` to confirm the plugin is loaded.

5. **Optional config customization**:
   - Only create `~/.config/opencode/opendevbrowser.jsonc` if user requests non-default settings.
   - Never add `opendevbrowser` keys to `opencode.json` (schema violation).

## Documentation Rules
- Keep the three plan docs in sync when scope changes.
- Update docs before proposing any release-related workflow.

## Implementation Plan Format

When creating detailed implementation plans, use this standardized task-by-task format. This ensures plans are actionable, traceable, and can be handed off to any agent for execution.

### Plan Document Structure

```markdown
# [Plan Title]

[Brief description of what this plan covers]

---

## Overview

### [Context heading, e.g., "Distribution channels" or "Scope"]
- Bullet points summarizing key aspects

### Key decisions
- Decision 1
- Decision 2

---

## Task N — [Task Title]

### Reasoning
[Why this task is necessary. What problem it solves or what value it adds.]

### What to do
[One-sentence summary of the task objective.]

### How
1. Step-by-step instructions
2. Be specific about what to change
3. Include code snippets or commands where helpful

### Files impacted
- `path/to/file1.ts`
- `path/to/file2.ts`
- `path/to/new-file.ts` (new file)

### End goal
[What success looks like when this task is complete.]

### Acceptance criteria
- [ ] Criterion 1 (testable/verifiable)
- [ ] Criterion 2
- [ ] Criterion 3

---

## File-by-file implementation sequence

[Optional section listing the order in which files should be modified to minimize conflicts]

1. `file1.ts` — Tasks 1, 3
2. `file2.ts` — Task 2
3. `new-file.ts` — Task 4 (new file)

---

## Dependencies to add

| Package | Version | Purpose |
|---------|---------|---------|
| `package-name` | `^1.0.0` | Brief purpose |

---

## Version history

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | YYYY-MM-DD | Initial plan |
| 1.1 | YYYY-MM-DD | Added tasks X-Y for [reason] |
```

### Task Section Requirements

Each task MUST include all of these sections:

| Section | Purpose |
|---------|---------|
| **Reasoning** | Explains WHY this task matters (context for the implementer) |
| **What to do** | One-sentence summary of the objective |
| **How** | Numbered step-by-step instructions |
| **Files impacted** | Explicit list of files to create/modify |
| **End goal** | Success state description |
| **Acceptance criteria** | Checkbox list of verifiable conditions |

### Best Practices

1. **Atomic tasks**: Each task should be independently completable
2. **Clear sequencing**: If tasks have dependencies, document the order
3. **Testable criteria**: Acceptance criteria must be verifiable (not vague)
4. **File-first thinking**: Always list impacted files explicitly
5. **New files marked**: Indicate `(new file)` for files that don't exist yet
6. **Version the plan**: Track changes in the version history table

### Example Task

```markdown
## Task 4 — Replace JSONC parsing with robust parser

### Reasoning
Regex stripping breaks valid JSONC strings containing `//` and doesn't support trailing commas.

### What to do
Use `jsonc-parser` in `src/config.ts` and strengthen tests.

### How
1. Add dependency: `jsonc-parser`
2. Replace regex comment stripping with `jsonc-parser`'s parse function
3. Add tests for `http://` strings and trailing commas

### Files impacted
- `package.json` (new dependency)
- `src/config.ts`
- `tests/config.test.ts`

### End goal
JSONC works reliably for real-world configs.

### Acceptance criteria
- [ ] Tests pass for trailing commas and URLs with `//`
- [ ] No regressions in config parsing
```

### When to Create Implementation Plans

Create a formal implementation plan when:
- Task involves 3+ files or 3+ distinct changes
- Multiple agents may work on the task
- Task spans multiple sessions or may be interrupted
- User requests a detailed plan before implementation
- Release, migration, or refactoring work

Save implementation plans to `docs/` with descriptive names (e.g., `docs/RELEASE_PLAN.md`, `docs/MIGRATION_PLAN.md`).

## Commit and PR Guidance
- No existing commit convention; use Conventional Commits.
- PRs should include summary, test notes, and extension screenshots if relevant.
- For releases, update `README.md` and related docs before publishing.

## Cursor / Copilot Rules
- No `.cursor/rules/`, `.cursorrules`, or `.github/copilot-instructions.md` files detected.

## Project-Specific Notes
- Preferred frameworks: Vitest for unit tests, Playwright for integration flows.
- Optional Chrome extension is staged; plugin must work without it.
- Use minimal, focused changes; avoid refactors during bug fixes.
