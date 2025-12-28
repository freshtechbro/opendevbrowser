# Local AGENTS.md (src/tools)

Applies to `src/tools/`. Extends `src/AGENTS.md` and root `AGENTS.md`.

## Local Architecture
- Tools validate inputs with Zod, delegate to managers/services, and return shaped responses.

## Responsibilities
- Define tool schemas and validate inputs with Zod.
- Delegate core work to managers/services; keep tools thin.

## Safety & Constraints
- Tool names must be `opendevbrowser_*`.
- Return structured error objects; avoid raw stack traces.
- Do not use `any` or suppress TypeScript errors.

## Testing
- Add/adjust Vitest coverage for tool validation and response shapes.

## Folder Structure
```
src/tools/
```
