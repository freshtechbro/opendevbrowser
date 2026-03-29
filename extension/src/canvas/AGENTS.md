# extension/src/canvas/ — Agent Guidelines

Extension-hosted canvas runtime. Extends `extension/AGENTS.md`.

## Overview

Owns the design-tab runtime used by `canvas.html`: editor-side state, same-origin synchronization, overlay coordination, viewport fitting, and the extension-side half of `/canvas` feedback and patch application.

## Structure

```text
extension/src/canvas/
├── canvas-runtime.ts  # Main design-tab runtime and command/event bridge
├── model.ts           # Canvas page/editor state types
└── viewport-fit.ts    # Viewport fitting and stage geometry helpers
```

## Rules

- Keep extension-side state compatibility-first with additive session-summary fields from core canvas documents.
- Treat `canvas.html` as the extension-hosted editor shell; do not confuse it with the default popup surface.
- Preserve same-origin design-tab sync semantics (IndexedDB/BroadcastChannel/runtime messages) when evolving state shape.
- Keep overlay and feedback behavior aligned with `/canvas` command contracts documented in `docs/SURFACE_REFERENCE.md`.

## Anti-Patterns

| Never | Why |
|-------|-----|
| Assume the extension canvas runtime is the source of truth for document persistence | Core canvas document/repo-store layers remain authoritative |
| Break additive parsing of session-summary metadata | Extension runtime must tolerate contract expansion |
| Re-route design-tab commands through popup-only logic | `canvas.html` is a dedicated runtime surface with its own state model |
