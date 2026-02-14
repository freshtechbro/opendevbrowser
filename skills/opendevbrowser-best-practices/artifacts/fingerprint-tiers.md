# Fingerprint Tiers

## Purpose

Choose the lowest hardening tier that keeps runs reliable; avoid unnecessary complexity.

## Tiers

### Tier 0 — Baseline

- Default runtime behavior.
- Use for internal pages and low-friction targets.

### Tier 1 — Coherence Profile (default recommendation)

- Consistent profile/session reuse.
- Stable launch flags and deterministic workflow ordering.
- Best default for most production automation.

### Tier 2 — Runtime Hardening

- Add stricter runtime controls (timeouts, retries, pacing discipline).
- Use when targets show intermittent anti-bot or high flakiness.

### Tier 3 — Adaptive Hardening (optional track)

- Dynamic policy adjustments and canary validation loops.
- Use only when Tier 1/2 cannot achieve target reliability.
- Treat as opt-in track, not baseline release requirement.

## Selection Heuristic

1. Start Tier 0 for local validation.
2. Promote to Tier 1 for shared/CI workflows.
3. Use Tier 2 when failures are environment-dependent.
4. Use Tier 3 only for sustained high-friction environments.
