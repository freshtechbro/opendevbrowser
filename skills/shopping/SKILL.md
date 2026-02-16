---
name: shopping
description: Deterministic multi-provider shopping and deal-comparison workflow.
version: 1.0.0
---

# Shopping Skill

Use this skill for deal discovery and price comparison across shopping providers.

## Triggers
- "find best deal"
- "compare prices"
- "shopping intelligence"
- "price matrix"

## Workflow
1. Resolve provider set (`10 + others` by default).
2. Run shopping workflow.
3. Sort by requested strategy.
4. Return compact/json/md/context/path output.

## Commands
```bash
opendevbrowser shopping run --query "<query>" --sort best_deal --mode context
```
