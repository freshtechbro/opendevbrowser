# src/macros/ — Agent Guidelines

Extends `src/AGENTS.md`.

**Scope:** Macro expression parsing, resolution, and provider action expansion

## Overview

Macro system for expanding expressions like `@media.search("query", "youtube", 5)` into concrete provider actions with provenance tracking. Supports positional and named arguments, pack-based organization, and async resolution.

## Structure

```
src/macros/
├── index.ts            # Factory functions and default registry
├── registry.ts         # MacroRegistry class, parsing, resolution
├── execute.ts          # Action execution with tracing
├── execute-runtime.ts  # Runtime execution helpers
└── packs/
    └── core.ts         # Built-in macros (@media.search, @shopping.deals)
```

## Key Classes

### MacroRegistry
- **Purpose:** Register and resolve macro expressions
- **Packs:** Grouped macro definitions
- **Parsing:** `@name(arg1, arg2, key=value)` format

```typescript
const registry = createMacroRegistry();
const resolution = await registry.resolve("@media.search('ai news', 'youtube', 10)");
// { action: { source, operation, input }, provenance: { macro, provider, pack, args } }
```

### MacroDefinition
```typescript
interface MacroDefinition {
  name: string;           // "media.search"
  pack: string;           // "core"
  description?: string;
  resolve: (parsed, context) => MacroAction;
}
```

### ParsedMacro
```typescript
interface ParsedMacro {
  name: string;           // "media.search"
  positional: ["ai news", "youtube", 10];
  named: { limit: 10 };
  raw: "@media.search('ai news', 'youtube', 10)";
}
```

## Expression Syntax

```
@pack.macro("string arg", 123, key=value, flag=true)
```

- **Strings:** Single or double quotes, escaped: `"foo \"bar\""`
- **Numbers:** Integers or decimals: `10`, `3.14`
- **Booleans:** `true`, `false`
- **Named args:** `key=value` after positional args

## Built-in Macros (core.ts)

| Macro | Provider | Purpose |
|-------|----------|---------|
| `@media.search(query, source, limit?)` | web | Search media platforms |
| `@shopping.deals(query, store?, maxPrice?)` | shopping | Find deals |
| `@research.topic(query, depth?, sources?)` | web | Research topics |

## Adding Macros

1. Define in `packs/core.ts` or create new pack:

```typescript
export const myMacro: MacroDefinition = {
  name: "custom.action",
  pack: "myPack",
  resolve: (parsed, context) => ({
    action: {
      source: { type: "provider", name: "web" },
      operation: "search",
      input: { query: parsed.positional[0] }
    },
    provenance: { macro: parsed.raw, ... }
  })
};
```

2. Register in pack factory:

```typescript
registry.registerPack({
  name: "myPack",
  macros: [myMacro]
});
```

## Execution Flow

1. **Parse:** `@media.search('query', 'youtube', 5)` → ParsedMacro
2. **Resolve:** Find matching MacroDefinition → MacroAction
3. **Execute:** Run provider operation with input
4. **Trace:** Record provenance for audit

## Required sync points

When macro syntax, public macro surfaces, or execution provenance changes:
- `docs/CLI.md`
- `docs/SURFACE_REFERENCE.md`
- `README.md`

## Anti-Patterns

| Never | Why |
|-------|-----|
| Parse macros with regex | Use MacroRegistry.parseMacro() |
| Hardcode provider names | Use ProviderSelection abstraction |
| Skip provenance | Required for audit trails |

## Dependencies

- `../providers/types.ts` - ProviderOperation, ProviderSelection
- `../providers/errors.ts` - ProviderRuntimeError

## Testing

- Test parser with edge cases (quotes, escapes, empty args)
- Mock provider resolution
- Verify provenance structure
