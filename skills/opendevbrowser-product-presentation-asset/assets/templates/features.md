# Product Features

Readiness source: `presentation-readiness.json.promotedClaims[]` plus `manifest.readiness`.

Production rule:
- `pass`: features may be used after each claim maps to evidence.
- `partial`: features are gated candidates until warnings and reason codes are resolved.
- `fail`: features are diagnostics only and must not be labeled verified.

- Feature 1:
  - Evidence:
  - Readiness reason code:
- Feature 2:
  - Evidence:
  - Readiness reason code:
