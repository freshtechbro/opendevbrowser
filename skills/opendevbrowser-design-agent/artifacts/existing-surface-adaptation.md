# Existing Surface Adaptation

Use this when the repo already has a nearby screen, shell, or component family and the goal is to evolve it instead of inventing a parallel UI language.

## 1. Start With The Nearest Shipped Surface

Before drafting a new structure:

- read `artifacts/opendevbrowser-ui-example-map.md`
- identify the closest shipped shell, editor, list/detail, or overlay pattern
- inspect the existing state owner, route owner, and token owner before changing visuals

If the repo already has the right family, extend it. Do not build a second shell that solves the same navigation or ownership problem.

## 2. Read The Surface In This Order

1. shell and route ownership
2. state ownership and async ownership
3. token and theme ownership
4. component anatomy
5. loading, empty, success, and error states
6. preview or fixture coverage

This keeps structural decisions ahead of styling polish.

## 3. Reuse Before Recompose

Prefer:

- refining existing component anatomy
- tightening spacing, hierarchy, and state handling
- widening deterministic preview coverage
- extracting a shared primitive only when two real surfaces need it

Avoid:

- forking a near-duplicate shell
- replacing a working component family with a generic new one
- moving ownership upward without a concrete cross-surface need

## 4. Review Prompts

Before implementation, answer:

1. Which shipped surface is the closest reference?
2. What should stay structurally stable?
3. Which ownership boundary actually needs to move?
4. Which visual or interaction debt is being corrected?
5. Which preview or browser proof needs to be updated with the change?

## Failure Signals

- a new shell is introduced when an existing one already fits
- component names and files diverge from the shipped family for cosmetic reasons
- previews still prove only the old behavior after a real structural change
- the work claims to preserve the design system while silently bypassing its token or state owners
