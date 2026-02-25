# Open Source Roadmap

Status: public
Last updated: 2026-02-16
Owner: maintainer

Purpose:
- canonical roadmap source for landing `/open-source` copy.
- keep public roadmap aligned with actual release direction.

Update rules:
- update this file before publishing landing copy changes that reference roadmap tracks.
- each roadmap item must represent realistic, in-scope work.
- when priorities change, update this file first, then update landing copy.

Status taxonomy:
- `planned`: scoped, not started.
- `in_progress`: active implementation.
- `blocked`: waiting on dependency or decision.
- `done`: shipped and documented.

## Milestone Sequencing (Rolling Plan)

| milestone | target window (UTC) | primary goal | track owner | status |
|----------|----------------------|--------------|-------------|--------|
| M1 | 2026-02-23 to 2026-03-20 | ship baseline skill-pack expansion and hardening test matrix | maintainer (skills + runtime) | planned |
| M2 | 2026-03-23 to 2026-04-24 | expand workflow depth and reliability on priority lanes | maintainer (runtime) | planned |
| M3 | 2026-04-27 to 2026-05-29 | recurrent shopping-deal automation beta with scheduler controls | maintainer (workflow automation) | planned |

Dependency order:
1. Track A M1 foundations unlock Track B scale-out work.
2. Track B M1/M2 reliability gates unlock Track C recurrent automation rollout.
3. Track C M3 launch requires Track B quality gates to remain >= 97% branch coverage.

## Track A - Batteries Included Skill Packs

Focus:
- expand workflow-ready skill packs with deterministic scripts/templates.

Owner: maintainer (skills)
Current status: planned
Delivery sequence: M1 -> M2

Current direction:
- research deep-dive packs
- shopping-deal monitoring packs
- UGC asset-pack generation packs
- QA loop playbook packs

Milestones:
- M1 (2026-02-23 to 2026-03-20): publish baseline packs for research + QA loop + shopping deals with docs and examples.
- M2 (2026-03-23 to 2026-04-24): add UI component extraction and UGC/presentation asset packs, plus validation templates.

## Track B - Workflow Hardening

Focus areas:
1. Research
2. QA loop
3. UI component extraction
4. UGC and product-presentation asset collection
5. Shopping deals workflows

Hardening goals:
- stronger deterministic outputs
- better failure handling and diagnostics
- tighter quality gates and regression coverage

Owner: maintainer (runtime)
Current status: planned
Delivery sequence: M1 -> M2 -> M3

Milestones:
- M1 (2026-02-23 to 2026-03-20): harden research + QA loop reliability (failure classification, deterministic output schema, baseline regression tests).
- M2 (2026-03-23 to 2026-04-24): harden UI extraction + UGC/presentation asset collection and shopping workflow diagnostics.
- M3 (2026-04-27 to 2026-05-29): stabilize all hardening lanes under sustained regression/coverage gates for launch-readiness.

## Track C - Recurrent Agent Deal Automation

Goal:
- enable agents to run recurrent deal checks for specific products.

Planned capabilities:
- saved watchlists
- repeat cadence rules
- alert thresholds (price/availability/delta)
- periodic summary artifacts for agent review

Owner: maintainer (workflow automation)
Current status: planned
Delivery sequence: M2 discovery -> M3 beta

Milestones:
- M2 (2026-03-23 to 2026-04-24): finalize scheduler contract, watchlist schema, and alert threshold semantics.
- M3 (2026-04-27 to 2026-05-29): ship beta recurrent deal runs with periodic summary artifacts and operator controls.

## Landing Copy Sync Contract

Required for `/open-source` landing content:
- Do not claim a roadmap capability unless its milestone and status exist in this file.
- Display milestone window and status badge per roadmap track.
- When status changes, update this file before landing copy updates.
