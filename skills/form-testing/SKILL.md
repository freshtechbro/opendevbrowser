---
name: form-testing
description: This skill should be used when the user asks to "test a form", "verify validation", "check submission behavior", "test multi-step forms", or "debug form errors" with OpenDevBrowser.
version: 1.1.0
---

# Form Testing Skill

Use this guide for comprehensive validation, submission, and error-state testing.

## Form Discovery Pass

Start every form suite with structural discovery:

1. Capture `actionables` snapshot.
2. Map refs for each input, control, and submit button.
3. Record required and optional fields.
4. Record dependent/conditional fields.

```text
opendevbrowser_snapshot sessionId="<session-id>" format="actionables"
```

## Validation Matrix

Build a deterministic matrix per field type:

| Category | Cases |
|---|---|
| Required | empty value, whitespace-only, valid value |
| Email | valid format, missing `@`, missing domain |
| Numeric | below min, above max, boundary values |
| Length | below min length, exact bounds, above max length |
| Pattern | valid regex match, invalid charset, malformed input |
| Select/Radio | no selection, valid selection, invalid dependent state |

Re-snapshot after each invalid submit to capture updated error refs.

## Submission Workflow

Run positive-path submission only after field validation is complete:

1. Fill required fields.
2. Set select/radio/checkbox controls.
3. Verify submit button is enabled.
4. Submit and wait for network/UI completion.

```text
opendevbrowser_type sessionId="<session-id>" ref="<text-ref>" text="valid value"
opendevbrowser_select sessionId="<session-id>" ref="<select-ref>" values=["expected-option"]
opendevbrowser_check sessionId="<session-id>" ref="<terms-ref>"
opendevbrowser_is_enabled sessionId="<session-id>" ref="<submit-ref>"
opendevbrowser_click sessionId="<session-id>" ref="<submit-ref>"
opendevbrowser_wait sessionId="<session-id>" until="networkidle"
```

## Error-State Assertions

For invalid submissions, assert three dimensions:

1. Error text is present and specific.
2. Accessibility attributes are set correctly (for example `aria-invalid="true"`).
3. Focus behavior moves to first invalid field when applicable.

```text
opendevbrowser_get_attr sessionId="<session-id>" ref="<field-ref>" name="aria-invalid"
opendevbrowser_dom_get_text sessionId="<session-id>" ref="<error-ref>"
```

## Multi-Step Form Pattern

For wizard-style forms:

1. Validate and submit current step.
2. Wait for next-step container ref.
3. Continue step-by-step until final submit.
4. Verify completion state and any generated confirmation ID.

Use `opendevbrowser_wait` with `ref` checks between steps.

## Network Verification

Correlate UI behavior with network activity:

- Poll network events after submit.
- Confirm expected endpoint, method, and status.
- Flag silent frontend failures where UI does not surface server errors.

```text
opendevbrowser_network_poll sessionId="<session-id>" max=50
```

## File Upload Limitation

Current tool surface does not provide direct file input attachment.

- Handle upload steps manually, or
- Extend tooling with a dedicated upload capability before automating file-input paths.

## Regression-Friendly Batch Pattern

Use `opendevbrowser_run` to keep suites deterministic and compact:

```text
opendevbrowser_run sessionId="<session-id>" steps=[{"action":"snapshot","args":{"format":"actionables"}},{"action":"type","args":{"ref":"<field-ref>","text":""}},{"action":"click","args":{"ref":"<submit-ref>"}},{"action":"snapshot","args":{"format":"outline"}}]
```
