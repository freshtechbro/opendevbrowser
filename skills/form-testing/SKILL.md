---
name: form-testing
description: Comprehensive form testing patterns including validation, submission, and error handling with OpenDevBrowser.
version: 1.0.0
---

# Form Testing Skill

## Form Field Discovery

1. Take a snapshot to map all form elements:
   ```
   opendevbrowser_snapshot sessionId="<session-id>"
   ```

2. Identify field types:
   - Text inputs: `<input type="text">`
   - Email fields: `<input type="email">`
   - Number fields: `<input type="number">`
   - Select dropdowns: `<select>`
   - Checkboxes: `<input type="checkbox">`
   - Radio buttons: `<input type="radio">`
   - Textareas: `<textarea>`
   - File uploads: `<input type="file">`

3. Note required fields (often marked with `required` attribute or asterisk).

## Validation Testing

Test each field's validation rules:

### Required Fields
1. Leave field empty
2. Submit form
3. Verify error message appears

### Email Validation
Test with:
- Valid email: `user@example.com`
- Missing @: `userexample.com`
- Missing domain: `user@`
- Invalid TLD: `user@example`

### Length Constraints
- Minimum length: Enter fewer characters than required
- Maximum length: Enter more characters than allowed
- Boundary values: Test exact min/max limits

### Pattern Matching
For fields with regex patterns:
- Valid pattern match
- Invalid characters
- Edge cases

## Form Submission Workflow

1. Fill all required fields:
   ```
   opendevbrowser_type sessionId="<session-id>" ref="[field-ref]" text="value"
   ```

2. For select dropdowns:
   ```
   opendevbrowser_select sessionId="<session-id>" ref="[select-ref]" values=["option-value"]
   ```

3. For checkboxes:
   ```
   opendevbrowser_click sessionId="<session-id>" ref="[checkbox-ref]"
   ```

4. Submit the form:
   ```
   opendevbrowser_click sessionId="<session-id>" ref="[submit-ref]"
   ```

5. Wait for response:
   ```
   opendevbrowser_wait sessionId="<session-id>" until="networkidle"
   ```

## Error Message Verification

After invalid submission:

1. Take new snapshot to capture error state
2. Look for error messages near each field
3. Verify error text matches expected message
4. Check ARIA attributes for accessibility

## Multi-Step Forms

For wizard-style forms:

1. Complete current step
2. Click next/continue button
3. Wait for next step to load
4. Repeat until completion
5. Verify final submission

## File Upload Testing

1. Current tools do not support file-input attachment directly.
2. Use manual upload steps or extend the toolset with a dedicated upload capability.
3. Verify file preview appears
4. Test file type restrictions
5. Test file size limits

## Form Reset Testing

1. Fill form with data
2. Click reset button
3. Verify all fields cleared
4. Verify any default values restored
