---
name: research
description: Deterministic multi-source research workflow with strict timebox and artifact outputs.
version: 1.0.0
---

# Research Skill

Use this skill when you need benchmark-style research across `web|community|social|shopping` with strict timebox semantics and stable output modes.

## Triggers
- "research this topic"
- "last 30 days"
- "cross-source summary"
- "output as context/json/markdown"

## Workflow
1. Resolve timebox (`days` or `from/to`).
2. Choose sources (`auto|web|community|social|shopping|all`).
3. Run `opendevbrowser research run`.
4. Return requested mode output and artifact path.

## Commands
```bash
opendevbrowser research run --topic "<topic>" --days 30 --mode context
```

## Notes
- `auto` resolves to `web|community|social` in v1.
- Use `--source-selection all` or `--sources shopping,...` to include shopping.
