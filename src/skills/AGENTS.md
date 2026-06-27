# src/skills/ - Agent Guidelines

Runtime skill loading and topic filtering. Extends `src/AGENTS.md`.

## Overview

Owns discovery and loading of bundled and user-installed skill packs for the runtime. This is distinct from `skills/AGENTS.md`, which governs authored skill-pack content.

## Structure

```text
src/skills/
├── skill-loader.ts       # Discovery, metadata parsing, topic matching, and load results
├── continuity-nudge.ts   # Continuity guidance for loaded skills
├── skill-nudge.ts        # Skill-specific nudge rendering helpers
├── bundled-skill-directories.ts # Packaged bundled-skill directory resolution
└── types.ts             # Runtime skill contracts
```

## Rules

- Keep file-system discovery deterministic and bounded; preserve installed-skill precedence and bundled fallback behavior.
- Parse skill metadata defensively with `unknown` narrowing and stable fallback names.
- Do not treat the pack-format guide in `skills/AGENTS.md` as runtime loader guidance; loader behavior belongs here.
- Topic filtering should be explainable from skill metadata and requested topics, not from fuzzy hidden state.
- Continuity nudges must remain advisory and must not rewrite user prompts or skill content.

## Anti-Patterns

| Never | Why |
|-------|-----|
| Load arbitrary directories without validating `SKILL.md` metadata | Skill discovery is a boundary |
| Conflate authored skill content with runtime loader behavior | They have separate AGENTS scopes |
| Hide skipped or malformed skill packs | Tool output should explain why a skill was unavailable |
