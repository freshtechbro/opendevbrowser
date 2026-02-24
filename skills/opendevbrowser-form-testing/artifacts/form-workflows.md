# Form Workflows

## Validation workflow

1. Discover refs
2. Run negative matrix cases
3. Assert field-level and summary errors
4. Run positive submission path
5. Re-snapshot after each submit branch

## Multi-step workflow

1. Validate each step in isolation
2. Preserve and verify carried values
3. Validate final confirmation state and IDs

## Dynamic requirement workflow

1. Trigger conditional sections (toggles/selectors)
2. Re-snapshot and discover newly required fields
3. Validate requiredness transitions and submit gating
4. Verify hidden fields are not submitted unexpectedly

## File upload workflow

1. Validate accepted type/size constraints
2. Validate invalid file rejection path
3. Validate success path and server response correlation
4. Confirm upload state survives step transitions

## Challenge checkpoint workflow

1. Detect challenge state
2. Pause and annotate checkpoint
3. Resume after manual completion
4. Continue assertions from refreshed snapshot
5. Stop and escalate after repeated challenge loops
