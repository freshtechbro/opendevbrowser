# OpenDevBrowser Automation Platform Research Spec

Status: Draft  
Owner: Docs Synchronization (Task 11)  
Last Updated: 2026-02-13

---

## Context

This document captures the concise research and documentation alignment decisions for automation platform Task 11.

---

## Canonical References

- Efficiency spec: [AUTOMATION_PLATFORM_EFFICIENCY_SPEC.md](AUTOMATION_PLATFORM_EFFICIENCY_SPEC.md)
- Implementation plan: [AUTOMATION_PLATFORM_IMPLEMENTATION_PLAN.md](AUTOMATION_PLATFORM_IMPLEMENTATION_PLAN.md)

---

## Research Focus

- Macro resolve execution path across tool/CLI/daemon surfaces.
- Additive execution metadata (`meta.tier.*`, `meta.provenance.*`) without breaking response compatibility.
- Fingerprint Tier 2/Tier 3 default-on continuous-signal posture.
- Validation reporting policy that avoids stale pass-count claims.

---

## Documentation Decisions

1. Keep existing command/tool names stable; document additive flags/fields only.
2. Document macro resolve as resolve-only by default with optional execute mode.
3. Document fingerprint Tier 2/Tier 3 as continuous-signal, default-on controls (debug trace is reporting/readout).
4. Keep CLI validation evidence section in pending-refresh state until the final full test run is complete.

---

## Follow-Up

- After the final full validation run, replace the pending-refresh placeholder in `docs/CLI.md` with dated command evidence.
