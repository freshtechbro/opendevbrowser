# Investigation: Env-Limited Provider Reliability

Status: resolved
Date: 2026-03-21

## Summary

The env-limited reliability lane is closed without adding provider-specific hacks. Current source already centralized actionable provider issue surfacing for the residual live set, but research and product-video were still inconsistent about carrying those shared summaries through their own workflow outputs. The final fix was a shared workflow/reporting parity patch, not a new provider-runtime branch.

## Symptoms

- Older saved artifact `/tmp/odb-provider-direct-runs-postfix.json` still showed 5 `env_limited` rows.
- The user needed `environment_limited` to resolve into actionable next steps such as login, live browser rendering, or manual challenge completion.
- After the live truth narrowed to LinkedIn auth/session, Target render-required, and Temu challenge/manual, research and product-video still had branches that could collapse those shared constraints into generic workflow text.

## Investigation Log

### Phase 1 - Shared Classification Audit
**Hypothesis:** the remaining cases were multiple constraint classes being collapsed into one generic bucket.
**Findings:** current source already uses shared provider-issue classification rather than provider-specific hacks, and the live-output seam was mainly stale artifact drift rather than missing runtime plumbing.
**Evidence:** `src/providers/constraint.ts`, `src/providers/workflows.ts`, `src/providers/shopping/index.ts`, `src/providers/renderer.ts`, `src/cli/utils/workflow-message.ts`, `scripts/provider-direct-runs.mjs`
**Conclusion:** confirmed. The right fix surface is shared provider/workflow/CLI reporting, not more provider-specific branches.

### Phase 2 - Targeted Live Probe Verification
**Hypothesis:** the five residual March 21 cases did not all represent real current `env_limited` failures.
**Findings:** targeted reruns split the cases cleanly:
- LinkedIn is an auth/session boundary, not a generic environment failure.
- Target is a live browser-render requirement, not an auth failure.
- Temu is an anti-bot/manual challenge boundary.
- Others now succeeds.
- Costco now succeeds on the rebuilt CLI and no longer belongs in the residual failure set.
**Evidence:** `/tmp/odb-linkedin-live-20260321.json`, `/tmp/odb-target-live-20260321.json`, `/tmp/odb-temu-live-20260321.json`, `/tmp/odb-others-live-20260321.json`, `/tmp/odb-costco-live-20260321-postfix.json`
**Conclusion:** confirmed. Current live residual set is down to LinkedIn, Target, and Temu only.

### Phase 3 - Validation Gate Closure
**Hypothesis:** the remaining blocker was a coverage-only seam in social traversal, not a runtime reliability gap.
**Findings:** `coverage/lcov.info` showed the last misses at `src/providers/social/platform.ts:214` and `src/providers/social/platform.ts:342`. The title fallback at line 214 was real and needed a regression. The hop-limit branch at line 342 was unreachable because queue construction only enqueues `hop + 1` when `next.hop < traversal.hopLimit`, so `hop > traversal.hopLimit` could not occur.
**Evidence:** `coverage/lcov.info`, `src/providers/social/platform.ts:207-214`, `src/providers/social/platform.ts:339-359`, `tests/providers-social-platforms.test.ts:395-418`
**Conclusion:** confirmed. Remove the dead guard, add the missing comparator regression, rerun gates.

### Phase 4 - Cross-Workflow Constraint Parity
**Hypothesis:** the remaining reliability gap was not provider classification but inconsistent workflow result shaping for research and product-video.
**Findings:** `runShoppingWorkflow` already propagated `primary_constraint_summary`, and shopping compact output already rendered it. `runResearchWorkflow` still returned empty-state output without those fields, and `runProductVideoWorkflow` still preferred generic unresolved-name or raw upstream fetch errors even when shopping/failure data already carried a canonical summary.
**Evidence:** `src/providers/workflows.ts`, `src/providers/renderer.ts`, `src/cli/utils/workflow-message.ts`, `tests/providers-workflows-branches.test.ts`, `/tmp/odb-linkedin-live-20260321.json`, `/tmp/odb-target-live-20260321.json`, `/tmp/odb-temu-live-20260321.json`
**Conclusion:** confirmed. Fix the shared workflow/result contract instead of provider-specific runtime code.

## Root Cause

There were three separate root causes:

1. Reporting truth drift:
- Current shared issue surfaces were already correct in source, but the older March 21 postfix artifact overstated the live residual set.
- Fresh live evidence shows only three real operator-follow-up cases remain: LinkedIn (`session_required`), Target (`render_required`), and Temu (`challenge_detected`).
- Costco and Others no longer reproduce as env-limited in the current rebuilt CLI.

2. Validation drift:
- The repo stayed red because of a coverage-only seam in [`src/providers/social/platform.ts:339`](/Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/providers/social/platform.ts#L339), not because env-limited behavior was still broken.
- The unreachable `next.hop > traversal.hopLimit` guard was dead code under the local queue invariant.
- The duplicate-canonical title fallback at [`src/providers/social/platform.ts:214`](/Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/providers/social/platform.ts#L214) lacked a regression for the right-side missing-title comparator case.

3. Workflow parity drift:
- Shopping already surfaced `primary_constraint_summary`, but research and product-video still had generic branches that hid the shared operator guidance.
- [`src/providers/workflows.ts:1347`](/Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/providers/workflows.ts#L1347) now enriches research metadata with the same primary-constraint fields used by shopping.
- [`src/providers/renderer.ts:38`](/Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/providers/renderer.ts#L38) now mirrors shopping by appending `Primary constraint: ...` to empty research compact output.
- [`src/providers/workflows.ts:1595`](/Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/providers/workflows.ts#L1595) and [`src/providers/workflows.ts:1637`](/Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/providers/workflows.ts#L1637) now prefer canonical constraint summaries before falling back to generic unresolved-name or raw upstream product-video errors.

## Recommendations

1. Keep provider follow-up shared and typed:
- Preserve the current `constraint.kind` model (`session_required`, `render_required`) plus explicit challenge reasons.
- Do not reintroduce provider-specific hacks for LinkedIn, Target, or Temu.

2. Treat stale live artifacts as historical, not current truth:
- Prefer rebuilt-daemon targeted reruns over aggregate saved JSON when direct-provider rows look generic.
- Keep live artifacts alongside the investigation report when closing operator-facing reliability work.

3. Keep workflow result contracts shared:
- When a workflow already has classified provider failures, prefer shared `primary_constraint_summary` over generic empty-state or fallback text.
- Reuse one shared metadata-enrichment seam across workflows instead of duplicating provider-specific messaging.

4. Keep traversal code branch-light:
- Remove local dead guards instead of carrying unreachable defensive branches for coverage.
- Add small scenario tests for duplicate-canonical sorting and queue invariants instead of broad refactors.

## Preventive Measures

- Rebuild `dist` before claiming live provider truth from CLI probes.
- Keep current live artifacts for residual constrained providers in `/tmp/odb-*-live-*.json` and cite them directly in follow-up investigations.
- For future coverage misses, parse `coverage/lcov.info` first and distinguish real runtime branches from unreachable defensive code before editing shared provider logic.
- Add focused workflow regressions whenever a new provider constraint should surface through research, shopping, or product-video so shared follow-up text stays aligned across CLI, daemon, and tool consumers.
