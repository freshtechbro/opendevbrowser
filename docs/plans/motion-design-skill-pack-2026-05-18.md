# Motion Design Skill Pack: Plan

## Goal

Create a canonical bundled `opendevbrowser-motion-design` skill pack that teaches agents how to specify, implement, and verify purposeful motion and animation across web and mobile UI work. The pack should be deterministic, authoritative, expansive across modern motion styles, and integrated with OpenDevBrowser CLI skill discovery, installation, validation, docs, and release gates.

## Background

The user wants a hands-off deep implementation plan, not implementation. The Oracle response at `/Users/bishopdotun/Downloads/motion-design-skill-pack-plan.md` recommends a separate canonical bundled pack named `skills/opendevbrowser-motion-design/` instead of only expanding `opendevbrowser-design-agent`. The key product decision from that response is to make motion a contract-governed design capability, not a library recommendation engine.

The current canonical skill registry is `src/skills/bundled-skill-directories.ts:5`, where the bundled list contains 9 packs through `src/skills/bundled-skill-directories.ts:14`. Registry helpers at `src/skills/bundled-skill-directories.ts:21` through `src/skills/bundled-skill-directories.ts:30` feed loader, installer, and tests.

Skill-pack governance lives in `skills/AGENTS.md:3` through `skills/AGENTS.md:18`, which still says there are 9 canonical packs. The same file defines frontmatter and topic-section shape at `skills/AGENTS.md:20` through `skills/AGENTS.md:33`, discovery priority at `skills/AGENTS.md:35` through `skills/AGENTS.md:46`, constraints at `skills/AGENTS.md:48` through `skills/AGENTS.md:60`, and adding-skill sync requirements at `skills/AGENTS.md:62` through `skills/AGENTS.md:66`.

`SkillLoader` constructs bundled skill fallback through `src/skills/skill-loader.ts:15` through `src/skills/skill-loader.ts:26`, exposes `loadSkill` and topic filtering at `src/skills/skill-loader.ts:51` through `src/skills/skill-loader.ts:68`, adds bundled fallback after project/global/custom paths at `src/skills/skill-loader.ts:169` through `src/skills/skill-loader.ts:175`, parses frontmatter at `src/skills/skill-loader.ts:245` through `src/skills/skill-loader.ts:278`, and filters headings by topic at `src/skills/skill-loader.ts:358` through `src/skills/skill-loader.ts:390`.

Installer lifecycle uses canonical pack names through `src/cli/installers/skills.ts:82` through `src/cli/installers/skills.ts:84`. Sync verifies every canonical source directory and fingerprints it at `src/cli/installers/skills.ts:430` through `src/cli/installers/skills.ts:447`, installs or refreshes active packs at `src/cli/installers/skills.ts:449` through `src/cli/installers/skills.ts:484`, and removes retired managed artifacts at `src/cli/installers/skills.ts:551` through `src/cli/installers/skills.ts:619`.

Existing design guidance is already contract-first. `skills/opendevbrowser-design-agent/SKILL.md:72` through `skills/opendevbrowser-design-agent/SKILL.md:77` names browser replay for motion timing and keeps shader/WebGL/Spline/custom 3D as advisory. `skills/opendevbrowser-design-agent/SKILL.md:81` through `skills/opendevbrowser-design-agent/SKILL.md:110` requires design contracts, existing design-system preservation, explicit scroll/viewport drivers, reduced-motion fallback, empty `libraryPolicy.motion` and `libraryPolicy.threeD` unless separately approved, real-browser validation, and docs/skill sync. The same pack lists required design contract fields including `motionSystem`, `performanceModel`, `responsiveSystem`, and `accessibilityPolicy` at `skills/opendevbrowser-design-agent/SKILL.md:112` through `skills/opendevbrowser-design-agent/SKILL.md:147`.

Scroll-driven motion already has a focused standard. `skills/opendevbrowser-design-agent/artifacts/scroll-reveal-surface-planning.md:5` through `skills/opendevbrowser-design-agent/artifacts/scroll-reveal-surface-planning.md:21` requires one progress owner and separation of layout, motion, and content. `skills/opendevbrowser-design-agent/artifacts/scroll-reveal-surface-planning.md:23` through `skills/opendevbrowser-design-agent/artifacts/scroll-reveal-surface-planning.md:32` makes reduced motion mandatory and meaning-preserving. `skills/opendevbrowser-design-agent/artifacts/scroll-reveal-surface-planning.md:34` through `skills/opendevbrowser-design-agent/artifacts/scroll-reveal-surface-planning.md:56` requires explicit stages and browser validation across mobile, tablet, desktop, keyboard order, console stability, reduced motion, and transform conflicts.

Testing and validation surfaces are count-sensitive. `tests/skill-workflow-packs.test.ts:42` through `tests/skill-workflow-packs.test.ts:153` declares required files per workflow skill. The same file verifies bundled workflow discovery at `tests/skill-workflow-packs.test.ts:155` through `tests/skill-workflow-packs.test.ts:216` and required files at `tests/skill-workflow-packs.test.ts:218` through `tests/skill-workflow-packs.test.ts:223`. Docs drift checks read existing skill files at `scripts/docs-drift-check.mjs:109` through `scripts/docs-drift-check.mjs:120` and assert best-practices/public-surface invariants at `scripts/docs-drift-check.mjs:666` through `scripts/docs-drift-check.mjs:681`.

CI currently runs docs drift and best-practices skill validation. PR checks run `node scripts/docs-drift-check.mjs` at `.github/workflows/pr-checks.yml:36` through `.github/workflows/pr-checks.yml:53` and only `./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh` for bundled skill assets at `.github/workflows/pr-checks.yml:74` through `.github/workflows/pr-checks.yml:91`. Release gates repeat `node scripts/docs-drift-check.mjs` and best-practices validation at `.github/workflows/release-public.yml:120` through `.github/workflows/release-public.yml:132`.

Primary-source fact check from the external research lane: CSS transitions and animations remain baseline web primitives; WAAPI exposes `Element.animate()`, `Animation`, `KeyframeEffect`, timelines, and `document.getAnimations()`; View Transitions support SPA and MPA DOM-state transitions; CSS scroll-driven animations use scroll-progress and view-progress timelines; Motion for React is now documented as `motion` with `motion/react` imports and WAAPI/ScrollTimeline plus JS fallback; GSAP docs are v3.15; Anime.js docs show 4.0.0; Rive web runtime requires cleanup of runtime objects; React Native Reanimated 4.x requires React Native New Architecture/Fabric and separate `react-native-worklets`; Flutter animation docs show Flutter 3.41.5 and page updated 2026-05-05; WCAG 2.2 SC 2.3.3 requires interaction-triggered non-essential motion to be disableable; `prefers-reduced-motion` is Baseline and widely available; `device-posture` is experimental and should be progressive enhancement.

The Oracle response proposes a broad pattern catalog with at least 42 named motion styles, including no-motion, opacity fade, fade-through, shared element, FLIP, staggered reveal, choreography, transition hierarchy, progressive disclosure, modal/sheet/popover motion, skeleton shimmer, progress morph, gesture/inertia/spring/overshoot/anticipation/follow-through/retargeting, hover/press/haptic feedback, scroll reveal, parallax, pinned scroll stage, scroll snap, SVG path draw, icon morph, Lottie/Rive illustration, and 3D/WebGL/spatial motion. It also proposes artifacts for terminology, platform/frameworks, device posture, accessibility/reduced motion, performance/frame budgets, gesture/haptics, scroll/spatial motion, library policy, release gates, anti-patterns, motion contract templates, audit reports, viewport matrix, runtime evidence, workflow router, and validator.

## Approach

Implement `opendevbrowser-motion-design` as a new canonical bundled skill pack. Keep `opendevbrowser-design-agent` as the parent contract-first UI implementation workflow, and make the new pack the deeper motion authority for terminology, pattern selection, platform/framework posture, device and breakpoint requirements, accessibility, performance, and temporal evidence.

The implementation should start with the new skill directory and its own validator, then register it as canonical, then update cross-links, runtime matrices, tests, public docs, CI, and release gates. This order keeps source assets valid before the registry and installer begin treating the new pack as canonical.

## Work Items

### Work Item 1 - Define The Motion Pack Inventory

Goal: Establish the exact `skills/opendevbrowser-motion-design/` file inventory before wiring the pack into the canonical registry.

Done when:
- The implementation creates these exact files:
  - `skills/opendevbrowser-motion-design/SKILL.md`
  - `skills/opendevbrowser-motion-design/artifacts/motion-terminology.md`
  - `skills/opendevbrowser-motion-design/artifacts/motion-pattern-catalog.md`
  - `skills/opendevbrowser-motion-design/artifacts/platform-framework-guide.md`
  - `skills/opendevbrowser-motion-design/artifacts/device-breakpoint-posture.md`
  - `skills/opendevbrowser-motion-design/artifacts/accessibility-reduced-motion.md`
  - `skills/opendevbrowser-motion-design/artifacts/performance-frame-budget.md`
  - `skills/opendevbrowser-motion-design/artifacts/open-dev-browser-motion-evidence.md`
  - `skills/opendevbrowser-motion-design/artifacts/motion-release-gate.md`
  - `skills/opendevbrowser-motion-design/artifacts/motion-anti-patterns.md`
  - `skills/opendevbrowser-motion-design/assets/templates/motion-contract.v1.json`
  - `skills/opendevbrowser-motion-design/assets/templates/motion-audit-report.v1.md`
  - `skills/opendevbrowser-motion-design/assets/templates/motion-viewport-matrix.v1.json`
  - `skills/opendevbrowser-motion-design/assets/templates/motion-release-gate.v1.json`
  - `skills/opendevbrowser-motion-design/scripts/motion-workflow.sh`
  - `skills/opendevbrowser-motion-design/scripts/validate-skill-assets.sh`
- No canonical registry changes happen until the pack has its validator and required files.

Key files:
- `skills/opendevbrowser-motion-design/SKILL.md`
- `skills/opendevbrowser-motion-design/artifacts/**`
- `skills/opendevbrowser-motion-design/assets/templates/**`
- `skills/opendevbrowser-motion-design/scripts/**`

Dependencies:
- None.

Size: S

### Work Item 2 - Author The Skill Entrypoint

Goal: Create a concise, topic-filterable `SKILL.md` that makes motion-design discoverable and sets the ownership boundary.

Done when:
- Frontmatter uses `name: opendevbrowser-motion-design`, a concise description, and `version: 1.0.0`.
- The entrypoint states that design-agent remains the parent UI implementation workflow.
- The entrypoint tells agents to load best-practices first, design-agent for UI implementation, and motion-design for motion-heavy work.
- Topic headings include Quick Start, Motion Contract, Pattern Selection, Platform And Framework Policy, Device Posture, Reduced Motion, Verification, Anti-patterns, and Related Skills.
- The entrypoint references every artifact, template, and script in this pack.

Key files:
- `skills/opendevbrowser-motion-design/SKILL.md`

Dependencies:
- Work Item 1.

Size: M

### Work Item 3 - Add Motion Terminology

Goal: Give agents a shared, deterministic vocabulary for describing animation behavior instead of vague creative adjectives.

Done when:
- `motion-terminology.md` defines duration, delay, easing, spring, damping, stiffness, mass, keyframe, timeline, choreography, stagger, interpolation, transform, opacity, layout animation, shared element transition, FLIP, scroll progress, view progress, gesture velocity, inertia, overshoot, anticipation, follow-through, interruptibility, retargeting, reduced motion, motion contract, motion evidence, frame budget, input latency, and compositing.
- The artifact distinguishes decorative motion from meaning-bearing motion.
- The artifact states that motion must preserve hierarchy, comprehension, accessibility, and task flow.

Key files:
- `skills/opendevbrowser-motion-design/artifacts/motion-terminology.md`

Dependencies:
- Work Item 2.

Size: M

### Work Item 4 - Add The Motion Pattern Catalog

Goal: Cover the length and breadth of modern motion styles with a deterministic pattern catalog agents can select from.

Done when:
- `motion-pattern-catalog.md` includes at least 30 stable, machine-checkable pattern entries, using the implementation's chosen heading convention consistently.
- Each entry includes use case, avoid case, user value, implementation primitives, reduced-motion fallback, device posture, verification evidence, and failure signals.
- The catalog includes no-motion, opacity fade, fade-through, crossfade, scale fade, slide, shared element, FLIP layout transition, list reordering, staggered reveal, choreographed sequence, transition hierarchy, progressive disclosure, modal motion, sheet motion, popover motion, toast motion, skeleton shimmer, progress morph, pull-to-refresh elasticity, swipe-to-dismiss, drag/reorder coupling, inertia, spring settle, overshoot, anticipation, follow-through, interruptibility/retargeting, hover/focus microinteraction, press/tap feedback, haptic-synchronized motion, scroll reveal, parallax, pinned scroll stage, scroll snap, text/count transition, SVG path draw, icon morph, Lottie/Rive illustration, 3D transform, and WebGL/spatial motion.

Key files:
- `skills/opendevbrowser-motion-design/artifacts/motion-pattern-catalog.md`

Dependencies:
- Work Item 3.

Size: L

### Work Item 5 - Add Platform And Framework Guidance

Goal: Document web and mobile motion frameworks as implementation primitives and policy-bound options, not as automatic dependency recommendations.

Done when:
- `platform-framework-guide.md` covers CSS transitions, CSS keyframe animations, Web Animations API, View Transition API, CSS scroll-driven animations, Motion for React with `motion/react`, GSAP 3.x, Anime.js 4.x, react-spring, Lottie, Rive web runtime, Three.js/react-three-fiber, Spline/WebGL advisory, SwiftUI, UIKit/Core Animation, Jetpack Compose, Android MotionLayout, React Native Reanimated 4.x, Flutter animation APIs, and haptics.
- Each framework entry includes approved use, avoid conditions, primitive mapping, reduced-motion path, performance hazards, lifecycle/cleanup concerns where relevant, and library-policy note.
- The artifact states that new runtime dependencies require separate approval and are not authorized by design intent.

Key files:
- `skills/opendevbrowser-motion-design/artifacts/platform-framework-guide.md`

Dependencies:
- Work Item 4.

Size: L

### Work Item 6 - Add Device And Breakpoint Posture

Goal: Make responsive motion decisions explicit for phones, tablets, laptops, desktops, large monitors, short viewports, and foldable posture.

Done when:
- `device-breakpoint-posture.md` covers mobile portrait, mobile landscape, tablet portrait, tablet landscape, laptop/desktop, large monitor, short viewport, coarse pointer, fine pointer, trackpad, touch gesture contexts, keyboard-only contexts, reduced-power devices, high-refresh displays, and foldable/device-posture progressive enhancement.
- The artifact specifies what changes by posture: duration, distance, pinned-scroll allowance, parallax allowance, gesture thresholds, touch target protection, density, viewport-height constraints, fallback behavior, and reduced-motion handling.
- The artifact states that `device-posture` is experimental and must be progressive enhancement only.

Key files:
- `skills/opendevbrowser-motion-design/artifacts/device-breakpoint-posture.md`

Dependencies:
- Work Item 4.

Size: M

### Work Item 7 - Add Accessibility And Reduced-Motion Rules

Goal: Make accessibility and reduced-motion behavior mandatory for every motion design decision.

Done when:
- `accessibility-reduced-motion.md` references WCAG 2.2 SC 2.3.3 and `prefers-reduced-motion`.
- The artifact distinguishes essential and non-essential motion.
- The artifact requires meaning-preserving reduced-motion alternatives and prohibits reduced-motion paths that remove information or break task completion.
- The artifact covers vestibular risk, keyboard order, focus stability, no motion-only feedback, animation pause/disable behavior, screen-reader alternatives, and ARIA/live-region considerations where relevant.

Key files:
- `skills/opendevbrowser-motion-design/artifacts/accessibility-reduced-motion.md`

Dependencies:
- Work Item 3.

Size: M

### Work Item 8 - Add Performance And Frame Budget Guidance

Goal: Give agents concrete performance constraints for motion-heavy UI so animation does not introduce jank, layout shift, or input latency.

Done when:
- `performance-frame-budget.md` covers transform and opacity preference, layout/paint hazards, compositing, `will-change` caution, scroll listener limits, requestAnimationFrame discipline, INP/input latency, dropped frames, high-refresh validation, realistic data volume, mobile thermal/battery concerns, runtime cleanup, no layout shift, and no horizontal overflow.
- The artifact requires performance evidence before shipping complex, scroll-driven, or gesture-coupled motion.
- The artifact requires fallback to simpler motion when frame stability cannot be proven.

Key files:
- `skills/opendevbrowser-motion-design/artifacts/performance-frame-budget.md`

Dependencies:
- Work Item 5.

Size: M

### Work Item 9 - Add OpenDevBrowser Motion Evidence Guidance

Goal: Define exactly how agents prove that motion works in real browser surfaces.

Done when:
- `open-dev-browser-motion-evidence.md` requires `snapshot`, `screenshot`, `debug-trace-snapshot`, `screencast-start`, `screencast-stop`, console/network stability, viewport matrix checks, reduced-motion checks, and `/canvas` preview where relevant.
- Timing-sensitive choreography, scroll-driven stages, and gesture-coupled motion require browser replay evidence.
- The artifact uses OpenDevBrowser CLI command examples and preserves the snapshot to refs to actions model.

Key files:
- `skills/opendevbrowser-motion-design/artifacts/open-dev-browser-motion-evidence.md`

Dependencies:
- Work Item 6.
- Work Item 7.
- Work Item 8.

Size: M

### Work Item 10 - Add Release Gate And Anti-pattern Artifacts

Goal: Define ship criteria and failure patterns specific to motion design.

Done when:
- `motion-release-gate.md` defines blocking and non-blocking release checks for contract alignment, pattern justification, reduced motion, keyboard order, viewport matrix, temporal proof, debug trace, console/network stability, performance, overflow, focus traps, and library policy.
- `motion-anti-patterns.md` documents decorative motion without user value, missing progress owner, competing scroll observers, layout-property animation in hot paths, long-distance mobile travel, default parallax, pinned scroll without escape, hover-only affordance, hidden focus/order changes, reduced motion that removes meaning, unbounded loops, fake progress, unapproved runtime dependency, haptic spam, index-keyed animated lists, and non-interruptible gesture animation.

Key files:
- `skills/opendevbrowser-motion-design/artifacts/motion-release-gate.md`
- `skills/opendevbrowser-motion-design/artifacts/motion-anti-patterns.md`

Dependencies:
- Work Item 9.

Size: M

### Work Item 11 - Add Motion Templates

Goal: Provide reusable templates for motion contracts, audits, viewport validation, and release decisions.

Done when:
- `motion-contract.v1.json` is valid JSON and includes intent, motion language, selected patterns, tokens, device posture, accessibility, performance, library policy, and verification plan.
- `motion-audit-report.v1.md` includes scope, contract source, selected patterns, device matrix, reduced-motion result, keyboard result, performance result, temporal evidence, issues, and release decision.
- `motion-viewport-matrix.v1.json` is valid JSON and includes phone, tablet, desktop, large monitor, short viewport, reduced motion, coarse pointer, fine pointer, keyboard-only, reduced power, and foldable/adaptive rows.
- `motion-release-gate.v1.json` is valid JSON and includes contract, pattern justification, reduced motion, keyboard, viewports, temporal proof, debug trace, console/network, performance, overflow, focus, and library policy checks.

Key files:
- `skills/opendevbrowser-motion-design/assets/templates/motion-contract.v1.json`
- `skills/opendevbrowser-motion-design/assets/templates/motion-audit-report.v1.md`
- `skills/opendevbrowser-motion-design/assets/templates/motion-viewport-matrix.v1.json`
- `skills/opendevbrowser-motion-design/assets/templates/motion-release-gate.v1.json`

Dependencies:
- Work Item 4.
- Work Item 5.
- Work Item 6.
- Work Item 7.
- Work Item 8.
- Work Item 9.
- Work Item 10.

Size: M

### Work Item 12 - Add Motion Workflow Router

Goal: Create a deterministic script that prints motion-design workflows and OpenDevBrowser proof commands.

Done when:
- `motion-workflow.sh` exists, is executable, sources `../../opendevbrowser-best-practices/scripts/resolve-odb-cli.sh`, and uses `CLI_PREFIX`.
- Modes include `list`, `contract-first`, `pattern-select`, `viewport-matrix`, `reduced-motion-check`, `temporal-proof`, `scroll-stage-audit`, `gesture-motion`, `performance-audit`, and `release-gate`.
- `temporal-proof` prints `screencast-start`, an interaction placeholder, `screencast-stop`, `snapshot`, `screenshot`, and `debug-trace-snapshot`.
- Each mode returns deterministic non-empty output and names the relevant artifact/template.

Key files:
- `skills/opendevbrowser-motion-design/scripts/motion-workflow.sh`

Dependencies:
- Work Item 9.
- Work Item 11.

Size: M

### Work Item 13 - Add Motion Asset Validator

Goal: Create a deterministic validator that fails fast when motion-design guidance, templates, scripts, or references drift.

Done when:
- `validate-skill-assets.sh` exists and is executable.
- The validator checks required files, executable scripts, JSON template parsing, `SKILL.md` references, required terminology, at least 30 pattern catalog entries, required framework names, required device categories, reduced-motion markers, library-policy markers, and workflow router modes.
- The validator checks that temporal proof output includes `screencast-start`, `screencast-stop`, `snapshot`, `screenshot`, and `debug-trace-snapshot`.
- The validator prints `Motion-design skill assets validated.` on success.

Key files:
- `skills/opendevbrowser-motion-design/scripts/validate-skill-assets.sh`

Dependencies:
- Work Item 12.

Size: M

### Work Item 14 - Register The Canonical Skill

Goal: Add the new pack to canonical bundled skill discovery after its own assets validate.

Done when:
- `src/skills/bundled-skill-directories.ts` includes `{ name: "opendevbrowser-motion-design" }` near `opendevbrowser-design-agent`.
- No loader rewrite is added because `SkillLoader` already filters bundled fallback through `isBundledSkillName()`.
- No installer rewrite is added because `syncBundledSkills` already derives canonical pack names from `listBundledSkillDirectories()`.

Key files:
- `src/skills/bundled-skill-directories.ts`
- `src/skills/skill-loader.ts`
- `src/cli/installers/skills.ts`

Dependencies:
- Work Item 13.

Size: S

### Work Item 15 - Cross-link Design-agent And Motion-design

Goal: Route motion-heavy UI work into motion-design without duplicating or replacing design-agent.

Done when:
- `opendevbrowser-design-agent` references `opendevbrowser-motion-design` for motion terminology, pattern catalog, framework policy, performance budgets, and temporal evidence.
- `opendevbrowser-motion-design` references `opendevbrowser-design-agent` for parent design contract and `/canvas` implementation workflow.
- Existing `motionSystem`, `motionPosture`, and scroll-reveal guidance remain authoritative in design-agent.
- No language says motion-design replaces design-agent.

Key files:
- `skills/opendevbrowser-design-agent/SKILL.md`
- `skills/opendevbrowser-design-agent/artifacts/scroll-reveal-surface-planning.md`
- `skills/opendevbrowser-motion-design/SKILL.md`
- `skills/opendevbrowser-motion-design/artifacts/motion-pattern-catalog.md`
- `skills/opendevbrowser-motion-design/artifacts/open-dev-browser-motion-evidence.md`

Dependencies:
- Work Item 14.

Size: S

### Work Item 16 - Update Runtime Matrices And Best-practices Router

Goal: Add motion-design to runtime and evidence governance so canonical pack validation stays aligned.

Done when:
- `skill-runtime-pack-matrix.json` includes `opendevbrowser-motion-design`, its validator command, relevant runtime surfaces, and relevant evidence lanes.
- The motion-design matrix entry uses `packType: "browser_surface"` unless current matrix schema inspection shows a narrower existing type is required.
- The motion-design runtime surfaces include CLI commands `screenshot`, `debug-trace-snapshot`, `screencast-start`, `screencast-stop`, and `canvas`.
- The motion-design runtime surfaces include tools `opendevbrowser_screenshot`, `opendevbrowser_debug_trace_snapshot`, `opendevbrowser_screencast_start`, `opendevbrowser_screencast_stop`, and `opendevbrowser_canvas`.
- The motion-design runtime modes include `managed`, `extension`, and `cdpConnect` when the current matrix schema supports mode declarations.
- The `skills-assets-discovery`, `canvas-annotate-design`, and `extension-relay-cdp` audit domains include `opendevbrowser-motion-design` where schema inspection confirms those domains apply.
- `skill-runtime-surface-matrix.md` contains a matching human-readable row and domain mapping.
- `odb-workflow.sh skill-runtime-audit` prints `./skills/opendevbrowser-motion-design/scripts/validate-skill-assets.sh`.
- Best-practices validator assertions are updated if they check exact router output or canonical matrix parity.

Key files:
- `skills/opendevbrowser-best-practices/assets/templates/skill-runtime-pack-matrix.json`
- `skills/opendevbrowser-best-practices/artifacts/skill-runtime-surface-matrix.md`
- `skills/opendevbrowser-best-practices/scripts/odb-workflow.sh`
- `skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh`

Dependencies:
- Work Item 14.
- Work Item 15.

Size: M

### Work Item 17 - Update Skill Discovery And Pack Tests

Goal: Ensure tests assert the new pack is discoverable, complete, executable, and valid.

Done when:
- `tests/skill-workflow-packs.test.ts` adds `opendevbrowser-motion-design` to required files, discovery assertions, shared CLI resolver checks, workflow router checks, and validator execution list.
- `tests/skill-loader.test.ts` asserts `getBundledSkillDirectory("opendevbrowser-motion-design")`, `isBundledSkillName("opendevbrowser-motion-design")`, bundled fallback availability, `SKILL.md` asset references, executable bit checks, and direct validator execution.
- Tests do not add hardcoded pack counts when count-derived assertions already exist.

Key files:
- `tests/skill-workflow-packs.test.ts`
- `tests/skill-loader.test.ts`

Dependencies:
- Work Item 13.
- Work Item 14.

Size: M

### Work Item 18 - Verify Installer Lifecycle Coverage

Goal: Confirm installer sync, update, uninstall, and retired-pack behavior include motion-design through existing canonical pack derivation.

Done when:
- `tests/cli-skills-installer.test.ts` continues deriving expected pack names from `bundledSkillDirectories`.
- A focused assertion confirms `opendevbrowser-motion-design/SKILL.md` is installed in managed targets if existing assertions are too generic.
- Existing install, refresh, unchanged, removal, and retired-pack tests pass with the new pack included.

Key files:
- `tests/cli-skills-installer.test.ts`

Dependencies:
- Work Item 14.

Size: S

### Work Item 19 - Update Public Docs And Docs Drift In One Batch

Goal: Update public docs and docs drift invariants atomically so implementation does not create a known red interval where drift checks assert docs that have not been updated yet.

Done when:
- `skills/AGENTS.md` says 10 canonical packs and includes `opendevbrowser-motion-design/SKILL.md` in the structure block.
- Root `AGENTS.md` updates canonical skill inventory/count text without changing unrelated governance, after task-scoped maintainer approval is confirmed for that governance edit.
- `README.md` adds the motion pack to the bundled skills section, updates 10-pack installer wording, updates repository tree count text if present, and adds the motion validator to release audit commands.
- `docs/CLI.md` says to load motion-design after design-agent for motion-heavy UI work, animation systems, scroll motion, gesture motion, reduced-motion audits, or motion release evidence.
- `docs/ARCHITECTURE.md` lists motion-design artifacts, templates, workflow router, and validator in the skill artifacts and operational gates section.
- `scripts/docs-drift-check.mjs` reads `skills/opendevbrowser-motion-design/SKILL.md`.
- New drift checks assert README documents the pack, `docs/CLI.md` documents when to load it, `docs/ARCHITECTURE.md` lists its artifacts and validator, design-agent cross-links it, it cross-links design-agent, and it mentions `prefers-reduced-motion`, `screencast-start`, `screencast-stop`, and `debug-trace-snapshot`.
- `tests/docs-drift-check.test.ts` includes the new check IDs.

Key files:
- `skills/AGENTS.md`
- `AGENTS.md`
- `README.md`
- `docs/CLI.md`
- `docs/ARCHITECTURE.md`
- `scripts/docs-drift-check.mjs`
- `tests/docs-drift-check.test.ts`

Dependencies:
- Work Item 15.
- Work Item 16.

Size: M

### Work Item 20 - Update CI And Release Gates

Goal: Ensure broken motion-design assets fail both PR checks and release publication.

Done when:
- `.github/workflows/pr-checks.yml` `skill-assets` job runs best-practices, design-agent, and motion-design validators.
- `.github/workflows/release-public.yml` release quality gates run the motion-design validator after docs drift and before broad build/test gates.
- CI changes do not require network access.

Key files:
- `.github/workflows/pr-checks.yml`
- `.github/workflows/release-public.yml`

Dependencies:
- Work Item 13.
- Work Item 19.

Size: S

### Work Item 21 - Run Focused Asset And Router Validation

Goal: Prove the skill pack assets and workflow outputs before running broader tests.

Done when:
- These commands pass with zero errors:
  - `./skills/opendevbrowser-motion-design/scripts/validate-skill-assets.sh`
  - `./skills/opendevbrowser-design-agent/scripts/validate-skill-assets.sh`
  - `./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh`
  - `./skills/opendevbrowser-best-practices/scripts/odb-workflow.sh skill-runtime-audit`
  - `./skills/opendevbrowser-motion-design/scripts/motion-workflow.sh list`
  - `./skills/opendevbrowser-motion-design/scripts/motion-workflow.sh temporal-proof`
  - `./skills/opendevbrowser-motion-design/scripts/motion-workflow.sh release-gate`

Key files:
- `skills/opendevbrowser-motion-design/scripts/validate-skill-assets.sh`
- `skills/opendevbrowser-motion-design/scripts/motion-workflow.sh`
- `skills/opendevbrowser-design-agent/scripts/validate-skill-assets.sh`
- `skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh`
- `skills/opendevbrowser-best-practices/scripts/odb-workflow.sh`

Dependencies:
- Work Item 20.

Size: S

### Work Item 22 - Update Runtime Audit Tests And Run Focused Tests

Goal: Validate discovery, required files, installer lifecycle, docs drift, and runtime audit behavior.

Done when:
- `tests/skill-runtime-audit.test.ts` is updated for the new canonical pack, matrix entry, and validator command expectations.
- These commands pass with zero errors:
  - `npm run test -- tests/skill-workflow-packs.test.ts`
  - `npm run test -- tests/skill-loader.test.ts`
  - `npm run test -- tests/cli-skills-installer.test.ts`
  - `npm run test -- tests/docs-drift-check.test.ts`
  - `npm run test -- tests/skill-runtime-audit.test.ts`
- Failures are fixed at root cause, not suppressed.

Key files:
- `tests/skill-workflow-packs.test.ts`
- `tests/skill-loader.test.ts`
- `tests/cli-skills-installer.test.ts`
- `tests/docs-drift-check.test.ts`
- `tests/skill-runtime-audit.test.ts`

Dependencies:
- Work Item 17.
- Work Item 18.
- Work Item 19.

Size: M

### Work Item 23 - Run Full Quality Gates And Acceptance Review

Goal: Confirm the repository remains release-ready after adding the canonical pack.

Done when:
- These commands pass with zero errors and zero warnings:
  - `node scripts/docs-drift-check.mjs`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test`
  - `npm run build`
  - `npx opendevbrowser --help`
  - `npx opendevbrowser help`
- `opendevbrowser_skill_list` shows `opendevbrowser-motion-design`.
- `opendevbrowser_skill_load opendevbrowser-motion-design "quick start"` returns the expected section.
- Managed skill sync installs the new pack through existing installer lifecycle.
- Best-practices runtime matrix parity passes.
- The motion pack includes terminology, at least 30 motion styles, framework guidance, device posture, reduced-motion, performance, and OpenDevBrowser evidence.
- Design-agent is cross-linked and remains the parent UI implementation workflow.
- CI and release gates validate motion-design.
- No implementation includes hidden fallbacks, stubs, placeholders, suppressed errors, or undocumented dependencies.

Key files:
- `src/skills/bundled-skill-directories.ts`
- `skills/opendevbrowser-motion-design/**`
- `skills/opendevbrowser-design-agent/SKILL.md`
- `skills/opendevbrowser-best-practices/assets/templates/skill-runtime-pack-matrix.json`
- `README.md`
- `docs/CLI.md`
- `docs/ARCHITECTURE.md`
- `.github/workflows/pr-checks.yml`
- `.github/workflows/release-public.yml`

Dependencies:
- Work Item 21.
- Work Item 22.

Size: M

## Open Questions

None. The plan should assume the recommended path is a separate canonical `opendevbrowser-motion-design` pack and preserve `opendevbrowser-design-agent` as the parent UI implementation workflow.

## References

- Oracle response: `/Users/bishopdotun/Downloads/motion-design-skill-pack-plan.md`
- Prior Oracle export: `prompt-exports/2026-05-17-0000-plan-motion-design-skill-pack.md`
- Material Design motion: <https://m3.material.io/styles/motion/overview>
- Apple Human Interface Guidelines Motion: <https://developer.apple.com/design/human-interface-guidelines/motion>
- WCAG 2.2 Animation from Interactions: <https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html>
- MDN prefers-reduced-motion: <https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion>
- MDN Web Animations API: <https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API>
- MDN View Transition API: <https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API>
- MDN CSS scroll-driven animations: <https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Scroll-driven_animations>
- Motion for React: <https://motion.dev/docs/react>
- GSAP docs: <https://gsap.com/docs/v3/>
- Anime.js docs: <https://animejs.com/documentation/>
- Rive Web JS runtime docs: <https://rive.app/docs/runtimes/web/web-js>
- React Native Reanimated docs: <https://docs.swmansion.com/react-native-reanimated/docs/fundamentals/getting-started/>
- Flutter animations docs: <https://docs.flutter.dev/ui/animations>
