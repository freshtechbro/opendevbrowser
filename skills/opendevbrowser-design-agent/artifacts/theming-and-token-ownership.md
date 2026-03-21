# Theming And Token Ownership

Use this when the design task touches visual direction, design systems, or any reusable UI surface that should remain consistent over time.

## 1. Keep One Semantic Token Source

Choose one owner for shared visual tokens:

- app root or workspace shell for global theme values
- feature shell only when the product intentionally supports a local variant

The token source should define semantic values such as background, surface, text, accent, spacing, radius, shadow, and motion tiers.

## 2. Keep Components Semantic

- consume semantic tokens instead of raw hex values or one-off spacing constants
- let typography, spacing, and motion inherit from the same token system when possible
- reserve raw values for rare one-off illustration or algorithmic art cases, not routine UI structure

This keeps visual changes centralized and makes previews and audits easier to trust.

## 3. Theme Controls Need An Owner

- user theme preferences belong in settings or an app-level controller
- temporary campaign or feature skins must still map back to semantic tokens
- previews and isolated fixtures should install the same token source the real UI expects

Do not let a leaf component quietly become the token authority.

## 4. Review Prompts

1. Where is the canonical token source?
2. Which semantic tokens does this surface rely on?
3. Are any raw values hiding inside repeated components?
4. Does the preview or fixture install the same theme owner as the integrated screen?
5. If the product supports theming controls, who owns them?

## Failure Signals

- repeated components hardcode their own colors or spacing
- the visual direction depends on raw values scattered across leaves
- preview fixtures do not install the theme or token owner required by production
- feature-local overrides drift away from the semantic token vocabulary
