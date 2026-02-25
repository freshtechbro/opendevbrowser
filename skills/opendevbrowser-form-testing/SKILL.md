---
name: opendevbrowser-form-testing
description: This skill should be used when the user asks to "test a form", "verify validation", "check submission behavior", "test multi-step forms", or "debug form errors" with OpenDevBrowser.
version: 2.0.0
---

# Form Testing Skill

Use this skill for robust form automation across dynamic, multi-step, challenge-protected, and accessibility-critical flows.

## Pack Contents

- `artifacts/form-workflows.md`
- `assets/templates/validation-matrix.json`
- `assets/templates/challenge-decision-tree.json`
- `assets/templates/a11y-assertions.md`
- `assets/templates/multi-step-state.json`
- `scripts/run-form-workflow.sh`
- `scripts/validate-skill-assets.sh`
- Shared robustness matrix: `../opendevbrowser-best-practices/artifacts/browser-agent-known-issues-matrix.md`

## Fast Start

```bash
./skills/opendevbrowser-form-testing/scripts/validate-skill-assets.sh
./skills/opendevbrowser-form-testing/scripts/run-form-workflow.sh validation
./skills/opendevbrowser-form-testing/scripts/run-form-workflow.sh multi-step
./skills/opendevbrowser-form-testing/scripts/run-form-workflow.sh challenge-checkpoint
```

## Core Rules

- Snapshot first, then act.
- Keep one field mutation per decision loop in failure analysis.
- Re-snapshot after each invalid submit to avoid stale refs.
- Verify both UX and network behavior for each submission branch.
- Keep challenge retries bounded and honor `Retry-After` when 429 pressure appears.

## Parallel Multitab Alignment

- Apply shared concurrency policy from `../opendevbrowser-best-practices/SKILL.md` ("Parallel Operations").
- Validate form workflows in `managed`, `extension`, and `cdpConnect` paths before parity sign-off.
- Keep one session per worker and avoid alternating `target-use` inside one command stream.

## Robustness Coverage (Known-Issue Matrix)

Matrix source: `../opendevbrowser-best-practices/artifacts/browser-agent-known-issues-matrix.md`

- `ISSUE-01`: stale refs after dynamic validation rerenders
- `ISSUE-02`: iframe challenge or embedded payment/auth forms
- `ISSUE-05`: anti-bot checkpoint loops on submit
- `ISSUE-06`: rate-limit/backoff behavior
- `ISSUE-08`: restricted origin or unsupported test surface

## Form Coverage Matrix

Cover at least:
- required/optional fields
- format/pattern constraints
- numeric and length boundaries
- dependent and conditional sections
- disabled/enabled transitions
- server-side rejection paths

Use the matrix template in `assets/templates/validation-matrix.json`.

| Validation area | Minimal assertion | Evidence capture |
| --- | --- | --- |
| Required vs optional | Empty required field blocks submit; optional field allows submit | `snapshot`, inline error text, submit request status |
| Format and pattern | Invalid format shows field error and keeps form invalid | `dom_get_text`, `get_attr aria-invalid`, request payload |
| Numeric and length bounds | Min/max boundaries are enforced consistently client+server | field value checks, server response body |
| Conditional sections | Dependent fields appear/disappear with correct state reset | before/after snapshots, visibility checks |
| Disabled/enabled transitions | Submit only enables when constraints are satisfied | `is_enabled`, transition snapshots |
| Server-side rejection | Backend validation errors map to correct field/global errors | `network_poll`, rendered error copy |

## Canonical Validation Flow

```text
opendevbrowser_snapshot sessionId="<session-id>" format="actionables"
opendevbrowser_type sessionId="<session-id>" ref="<field-ref>" text=""
opendevbrowser_click sessionId="<session-id>" ref="<submit-ref>"
opendevbrowser_snapshot sessionId="<session-id>" format="outline"
opendevbrowser_dom_get_text sessionId="<session-id>" ref="<error-ref>"
```

## Accessibility Assertions

Validate error handling semantics:
- error text bound to invalid field
- `aria-invalid="true"` when invalid
- keyboard focus on first invalid field when applicable
- labels/instructions remain programmatically associated

```text
opendevbrowser_get_attr sessionId="<session-id>" ref="<field-ref>" name="aria-invalid"
opendevbrowser_get_attr sessionId="<session-id>" ref="<field-ref>" name="aria-describedby"
```

## Anti-Bot and Challenge Branches

For forms guarded by challenge providers:

1. Detect challenge widget/frame state.
2. Mark manual checkpoint in run log.
3. Complete challenge manually or by approved test key in non-production.
4. Resume from fresh snapshot and continue validation.

Do not implement challenge bypass behavior.

Loop guardrail:
- Stop after 2 repeated challenge checkpoints without forward progress.
- Capture network evidence and escalate as blocker.

## Multi-Step and Conditional Forms

For wizard flows:
1. validate current step
2. submit and wait for next-step container ref
3. assert state carryover from prior step
4. finalize and validate confirmation payload

Use `assets/templates/multi-step-state.json` to track progression.

## Network Correlation

Always poll and inspect submit requests:

```text
opendevbrowser_network_poll sessionId="<session-id>" max=50
```

Flag mismatch cases:
- UI shows success but network fails
- UI hides server validation errors
- repeated 429/403 challenge pressure on submit endpoint

## References

- Playwright best practices: https://playwright.dev/docs/best-practices
- WCAG 2.2 (Input assistance + accessible authentication): https://www.w3.org/TR/WCAG22/
- Cloudflare Turnstile testing: https://developers.cloudflare.com/turnstile/tutorials/testing/
- reCAPTCHA v2 test keys: https://developers.google.com/recaptcha/docs/faq
- hCaptcha test keys: https://docs.hcaptcha.com/
