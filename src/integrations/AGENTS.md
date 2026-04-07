# src/integrations/ — Agent Guidelines

External integration adapters. Extends `src/AGENTS.md`.

## Overview

Hosts deterministic, typed integrations with external systems that feed core runtime features without leaking vendor-specific behavior into the rest of the codebase. The current in-repo integration family is Figma import.

## Structure

```text
src/integrations/
└── figma/
    ├── auth.ts       # Access-token resolution
    ├── client.ts     # Typed API client + failure normalization
    ├── normalize.ts  # Raw API payload → canvas import shapes
    ├── mappers.ts    # Node/value mapping helpers
    ├── variables.ts  # Variable import helpers
    ├── assets.ts     # Asset download/materialization
    └── url.ts        # Figma URL parsing
```

## Rules

- Keep vendor IO and error normalization inside the integration boundary.
- Return typed, normalized payloads that the canvas/runtime layers can consume without vendor-specific branching.
- Resolve credentials through config/env helpers; do not scatter token lookups across callers.
- Map remote failures to deterministic repo-level reason codes before they cross into canvas/browser layers.

## Anti-Patterns

| Never | Why |
|-------|-----|
| Expose raw vendor payloads directly to canvas/runtime code | Normalization belongs here |
| Hardcode access tokens or endpoints outside the integration client | Credential and endpoint handling must stay centralized |
| Smuggle plan/account/scope failures as generic errors | Canvas import needs typed failure codes |
