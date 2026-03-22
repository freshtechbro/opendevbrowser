# External Pattern Synthesis

This file captures the external patterns that shaped the OpenDevBrowser design-agent skill.

## Official Anthropic Patterns

Sources:

- Claude Code subagents: https://docs.anthropic.com/en/docs/claude-code/sub-agents
- Claude Code settings: https://docs.anthropic.com/en/docs/claude-code/settings

Patterns carried into this skill:

- keep the agent focused on one domain instead of making a general prompt larger
- be explicit about tool access, scope, and success criteria
- preload reusable expertise so repeated tasks are faster and more consistent
- use concrete examples and deterministic workflows instead of vague stylistic advice

## Official Vercel v0 Patterns

Source:

- v0 prompting guide: https://v0.dev/docs/prompting/text

Patterns carried into this skill:

- specify stack, layout intent, and UI constraints directly
- describe structure, state, and interaction, not just mood adjectives
- break large UI requests into staged prompts and refinements
- include enough design detail that the system does not invent critical behavior
- collect concrete visual references before direction lock instead of treating "modern" or "premium" as sufficient input

## Official Lovable Patterns

Source:

- Lovable prompting best practices: https://docs.lovable.dev/prompting/prompting-best-practices

Patterns carried into this skill:

- use real content and real workflows whenever possible
- prompt by component and user flow, not by abstract buzzwords
- keep iterations narrow and intentional
- write prompts that explain what should improve and why it matters
- keep inspiration grounded in screenshots and product references instead of text-only taste claims

## Public Frontend-Designer Agent Patterns

Source:

- Public claude-agents repository: https://github.com/iannuttall/claude-agents

Patterns carried into this skill:

- assess the current stack and available assets before proposing UI direction
- turn observations into a repeatable design schema
- include an explicit review and feedback loop
- combine aesthetics, accessibility, and implementation practicality in the same agent
- split work into analyze, specify, and generate phases so direction-setting and implementation stay distinct

## Dimillian SwiftUI UI Pattern Library

Source:

- Dimillian Skills repo: https://github.com/Dimillian/Skills/tree/main
- SwiftUI UI patterns skill: https://github.com/Dimillian/Skills/blob/main/swiftui-ui-patterns/SKILL.md

Patterns carried into this skill:

- keep a component and screen-pattern index so the agent starts from proven families instead of inventing a structure every time
- start from the closest existing surface when the repo already ships the right family, then adapt instead of forking a parallel shell
- declare state ownership before component implementation, especially for navigation, overlays, async data, and editing flows
- keep route translation and deep-link handling centralized instead of spreading string-based navigation across controls
- prefer item-driven or enum-driven sheet and overlay routing so modal state stays typed and recoverable
- define async restart, debounce, and cancellation behavior explicitly when user input can restart work
- keep search-query ownership narrow and make URL ownership deliberate instead of accidental
- preserve layout during loading with deterministic placeholder counts instead of spinner-heavy state drift
- keep one semantic theme or token source so leaf components stay visual consumers instead of token owners
- use overlays for transient banners or toasts so feedback does not reflow the main layout
- document app wiring and shell boundaries explicitly so route, overlay, and shared-service ownership stay coherent
- treat isolated previews and deterministic fixtures as a required stop before full integration
- keep a reusable performance-audit path with baseline measurement, symptom classification, and evidence-backed fixes
- give scroll-reveal and pinned-stage UIs one explicit progress owner plus a reduced-motion contract
- keep scan-heavy screens fast by deciding stable identity, lazy container posture, and progressive reveal before polishing each item
- include explicit anti-patterns so the skill blocks weak implementation habits instead of only describing ideal outcomes
- treat previews, examples, and isolated validation as part of frontend engineering, not optional polish
- document app wiring concerns such as shells, routing depth, overlay ownership, scroll drivers, and performance restraint alongside visual direction

## OpenDevBrowser-Specific Adaptation

The external patterns above are not copied verbatim into this pack. They are adapted to OpenDevBrowser's shipped capabilities:

- `/canvas` governance handshake and `canvas.plan.set`
- extension, managed, and CDP-backed validation
- repo-local docs and AGENTS sync requirements
- repeated audit/fix loops before sign-off
- real-browser proof instead of purely textual design claims
- web-first component families in `artifacts/component-pattern-index.md`
- explicit ownership decisions in `artifacts/state-ownership-matrix.md`
- async and query ownership decisions in `artifacts/async-search-state-ownership.md`
- semantic token ownership in `artifacts/theming-and-token-ownership.md`
- loading and transient feedback discipline in `artifacts/loading-and-feedback-surfaces.md`
- failure shields in `artifacts/implementation-anti-patterns.md`
