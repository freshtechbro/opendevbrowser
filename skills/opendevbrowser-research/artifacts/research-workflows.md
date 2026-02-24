# Research Workflows

## Deterministic baseline workflow

1. Define topic and strict time window
2. Resolve source selection (`auto|all|explicit`)
3. Run research workflow command
4. Persist context/report artifacts
5. Validate source diversity and freshness

## Cross-source corroboration workflow

1. Identify claims from first-pass output
2. Require at least two independent source records for critical claims
3. Mark unsupported claims as tentative
4. Escalate when corroboration is missing

## Backoff/retry workflow

1. Detect repeated 429/upstream throttling
2. Honor retry windows and bounded retries
3. Resume from persisted context artifact
4. Report partial coverage when limits persist

## Compact handoff workflow

1. Produce compact summary with key findings
2. Include unresolved risks and missing evidence
3. Attach artifact paths for replay
