# Landing + Dashboard Design Findings

Date: 2026-02-16
Scope: OpenDevBrowser marketing landing pages and product dashboard planning
Method: design-agent skill workflow (repo audit -> capability mapping -> wireframe ideation -> proposal)

Status: historical design-finding record (superseded for current implementation truth by `docs/FRONTEND.md`, `docs/FRONTEND_DESIGN_AUDIT.md`, and `docs/SURFACE_REFERENCE.md`).

## Executive Summary

- At audit time (2026-02-16), OpenDevBrowser had a strong technical core but no dedicated web landing/dashboard product surface yet.
- Existing extension UI styling shows an initial glassmorphism direction that can be evolved into a full brand system.
- Static design-agent audit found UX debt patterns (focus handling, form labeling, performance hints) that should be addressed in any new UI system baseline.
- Source-of-truth inventory in code has outpaced surface docs: current code exposes more CLI/tool surfaces than documented totals.
- Recommended direction: build a clean, responsive marketing site + operational dashboard using one design system, with selective 3D/isometric/glass accents and strong whitespace discipline.

## Audit Inputs

Primary references used:

- `src/tools/index.ts`
- `src/cli/args.ts`
- `docs/SURFACE_REFERENCE.md`
- `docs/ARCHITECTURE.md`
- `docs/CLI.md`
- `README.md`
- `extension/popup.html`

Design-agent audit command used:

```bash
python3 /Users/bishopdotun/.codex/skills/design-agent/scripts/audit_ui.py --json extension/src extension/popup.html
```

## Findings

### 1) UI quality audit (design-agent)

Audit result totals:

- Total findings: 54
- Error: 1
- Warning: 27
- Info: 26

Category distribution:

- Content: 26
- Focus/forms: 10
- Performance: 18

Top repeated issue types:

- `perf-layout-read` (warning): 10
- `forms-input-label` (warning): 9
- `perf-large-list-no-virtualization` (warning): 8
- `focus-outline-none` (error): 1

High-severity anchor:

- Focus outline behavior in `extension/popup.html` requires safer focus-visible patterns.

### 2) Product-surface documentation drift

Audit-time snapshot:

- CLI commands: 53 (`src/cli/args.ts`, at 2026-02-16)
- Tools: 47 (`src/tools/index.ts`, at 2026-02-16)

Current source of truth (2026-02-22):

- CLI commands: 54 (`docs/SURFACE_REFERENCE.md`, `src/cli/args.ts`)
- Tools: 47 (`docs/SURFACE_REFERENCE.md`, `src/tools/index.ts`)

Newly present workflow surfaces include research/shopping/product-video command and tool paths.

### 3) Existing visual baseline observations

- Existing popup UI already uses translucent panels and blur (`extension/popup.html`), validating glassmorphism as a native direction.
- Product voice in docs/README is technical and operational; landing should preserve this clarity rather than generic startup marketing patterns.

## Full Functionality Inventory

## A) Platform capability inventory (source-aligned)

- Session lifecycle and transport orchestration (managed, extension/ops, legacy cdp)
- Tab/target/page management
- Navigation and interaction primitives
- DOM inspection surfaces
- Diagnostics and trace surfaces (console/network/perf/debug trace)
- Capture/export surfaces (screenshot/clone page/clone component)
- Automation workflows (research/shopping/product-video)
- Macro resolution/execute
- Skills discovery/loading and prompting guide
- Daemon/relay/native runtime controls

## B) Landing-page information architecture (all pages)

1. Home
- Hero positioning, mode overview, core CTA

2. Product
- Snapshot -> refs -> actions workflow, architecture value, differentiators

3. Modes & Channels
- Managed vs Extension/Ops vs Legacy CDP with decision guidance

4. Workflow Studio
- Research, Shopping, Product Video workflows and outputs

5. Security & Reliability
- Local-only defaults, token auth, redaction, rate limiting, test posture

6. Docs & Install
- Install tracks, quickstart, command/tool entrypoints

7. Pricing / Plans
- Free/community/pro teams (or placeholder pricing framework if not finalized)

8. Changelog & Release Notes
- Version timeline, compatibility notes, migration notices

## C) Dashboard information architecture (all pages)

1. Overview
- Health summary, active sessions, channel status, recent runs

2. Sessions
- Session list, mode, target, state, quick actions

3. Targets & Pages
- Tab/target graph + page controls

4. Command Runner
- Safe form-driven command execution and response view

5. Diagnostics
- Console/network/debug trace timeline with filters

6. Artifacts
- Screenshots, clone outputs, workflow artifacts, export/download

7. Relay & Daemon
- Relay health, handshake/pairing status, daemon state, reconnect controls

8. Skills & Settings
- Skill discovery/load, runtime preferences, accessibility and motion settings

## Wireframe Concepts (5)

## Concept 1: Isometric Command Deck

Landing:
- Asymmetric hero with isometric product block stack (CLI, relay, extension, workflow)
- Glass capability panels in staggered depth
- Strong whitespace bands between sections

Dashboard:
- Left rail navigation + top health strip + modular glass cards
- Operational cockpit feel with clear hierarchy

Strengths:
- Best fit for requested 3D/isometric/glass direction
- Strong brand distinctiveness with practical UI readability

Risks:
- Needs careful contrast and reduced-motion fallbacks

## Concept 2: Glass Atlas

Landing:
- Central translucent “control globe” with orbiting capability chips
- Section transitions driven by subtle depth parallax

Dashboard:
- Node-map style session/provider visualization + detail drawer

Strengths:
- Highly modern, visually memorable

Risks:
- More custom interaction engineering effort

## Concept 3: Blueprint Prism

Landing:
- Technical blueprint grid with prism-glass panels and measured typography
- Architecture-first storytelling

Dashboard:
- Pipeline-lane layout (input -> command -> result -> artifact)

Strengths:
- Strong trust signal for technical audience

Risks:
- Can feel too dense without strict whitespace guardrails

## Concept 4: Studio Ribbon

Landing:
- Bold editorial ribbons, modular feature bands, soft 3D object accents

Dashboard:
- Split workspace (composer left, telemetry/result right)

Strengths:
- Great for workflow education and onboarding

Risks:
- Requires strong copy discipline to avoid clutter

## Concept 5: Quiet Quartz

Landing:
- Minimal premium layout with one signature 3D hero element
- Maximum whitespace, low visual noise

Dashboard:
- Table-first operational UI with modal deep-dive surfaces

Strengths:
- Very fast to ship and scale

Risks:
- Lower perceived novelty if 3D direction is understated

## Recommended Proposal

Recommended design direction: **Concept 1 (Isometric Command Deck)**

Why:

- Directly matches requested aesthetic (3D + isometric + glassmorphism)
- Preserves operational clarity needed for complex platform functionality
- Balances uniqueness with implementation feasibility

Recommended stack:

- Next.js + TypeScript
- CSS variables for tokenized design system
- Selective GPU-friendly 3D accents (hero/background only)
- Component primitives for cards, stats, timelines, command forms, artifact lists

Implementation phases:

1. Foundation
- Design tokens, typography, spacing, color ramps, elevation, focus/motion standards

2. Landing v1
- Home, Product, Modes, Workflow Studio, Security, Docs CTA

3. Dashboard v1
- Overview, Sessions, Diagnostics, Artifacts (read-first with safe run actions)

4. Dashboard v1.1
- Relay/Daemon controls and skill/settings surfaces

5. Hardening
- Accessibility, reduced motion, responsive tuning, performance budget checks

## Quality Gate Snapshot (Workspace State at Audit Time)

Commands executed:

```bash
npm run lint
npx tsc --noEmit
npm run build
npm run test
```

Observed status:

- `lint`: pass
- `build`: pass
- `tsc --noEmit`: fail (existing provider typing errors)
- `test`: fail (existing provider suite failures)

Note: these failing checks were pre-existing workspace state during design documentation and are not caused by this findings document.

## Decisions Needed

1. Confirm preferred visual direction (recommend Concept 1).
2. Confirm dashboard v1 scope depth:
- Option A (recommended): read-first + safe action triggers
- Option B: full control plane in v1
3. Confirm implementation stack choice:
- Option A (recommended): Next.js
- Option B: static/Vite

## Appendix: Evidence Anchors

- Tool inventory source: `src/tools/index.ts`
- CLI command inventory source: `src/cli/args.ts`
- Surface reference currently published: `docs/SURFACE_REFERENCE.md`
- Architecture and runtime surfaces: `docs/ARCHITECTURE.md`, `docs/CLI.md`, `README.md`
- Existing glass UI baseline: `extension/popup.html`
