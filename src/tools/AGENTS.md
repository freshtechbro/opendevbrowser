# src/tools/ — Agent Guidelines

Tool development patterns. Extends `src/AGENTS.md`.

## Overview

30 `opendevbrowser_*` tools. All thin wrappers: validate → delegate → respond.
Hub mode is enforced via `ensureHub` in `src/tools/index.ts` to rebind remote managers and avoid local relay fallback.

## Tool Structure

```typescript
// Pattern: every tool follows this
export function createFooTool(deps: ToolDeps): ToolDefinition {
  return {
    name: 'opendevbrowser_foo',
    description: 'One-line description',
    parameters: z.object({ ... }),  // Zod schema
    handler: async (params, context) => {
      // 1. Validate (already done by Zod)
      // 2. Delegate to manager
      const result = await deps.browserManager.foo(params);
      // 3. Shape response
      return { success: true, data: result };
    }
  };
}
```

## File Organization

| File | Tools |
|------|-------|
| `session.ts` | launch, connect, disconnect, status |
| `navigation.ts` | goto, wait, snapshot |
| `interaction.ts` | click, type, select, scroll |
| `targets.ts` | targets_list, target_use, target_new, target_close |
| `pages.ts` | page, list, close |
| `dom.ts` | dom_get_html, dom_get_text |
| `devtools.ts` | console_poll, network_poll, perf |
| `export.ts` | clone_page, clone_component, screenshot |
| `skills.ts` | skill_list, skill_load |
| `run.ts` | run (multi-action) |
| `prompting.ts` | prompting_guide |

## Where Logic Lives

| Layer | Responsibility |
|-------|----------------|
| `tools/` | Input validation, response shaping |
| `browser/` | Session lifecycle, CDP orchestration |
| `snapshot/` | AX-tree capture, ref resolution |
| `relay/` | Extension communication |

**Tools NEVER own business logic.** They delegate.

Keep tool names and counts in sync with `src/tools/index.ts` and `docs/CLI.md`.

## Response Pattern

```typescript
// Success
{ success: true, sessionId: '...', warnings?: [...] }

// Error
{ error: 'message', code: 'ERROR_CODE' }
```

## Adding a Tool

1. Create function in appropriate file (by category)
2. Define Zod schema for parameters
3. Delegate to existing manager method
4. Add to `createTools()` in `index.ts`
5. Add tests in `tests/`

## Anti-Patterns

| Never | Do Instead |
|-------|------------|
| Business logic in tool | Delegate to manager |
| `any` in parameters | Define Zod schema |
| Direct CDP calls | Use BrowserManager/ScriptRunner |
| Inline error strings | Use consistent error codes |
