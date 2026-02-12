# Run Statistics (Successful Visible CDP Run)

Run folder:
- `artifacts/successful-visible-cdp-run`

Summary file:
- `artifacts/summary-visible-cdp-latest.json`

## Metrics

- Completed: `true`
- Wall time: `63.264s` (`63264 ms`)
- Agent time: `22.621s` (`22621 ms`)
- Tool time: `40.643s` (`40643 ms`)
- API latency: `0 ms`
- Actions: `193`
- Steps solved: `30`
- Final URL: `https://serene-frangipane-7fd25b.netlify.app/finish`

## OpenAI cost metrics

- Billable OpenAI input tokens: `0`
- Billable OpenAI output tokens: `0`
- Estimated OpenAI API cost: `$0.00`
- Source: `artifacts/successful-visible-cdp-run/session.json` (`local core mode`, no external model call usage logged)

## Strict tokenizer-based counts (`cl100k_base`)

Method:
- Tokenized packaged run artifacts with `tiktoken` using `cl100k_base`.
- Command basis: exact UTF-8 file contents from this distribution folder.

Per-file token counts:
- `artifacts/successful-visible-cdp-run/messages.txt`: `25,577`
- `artifacts/successful-visible-cdp-run/messages.json`: `34,465`
- `artifacts/successful-visible-cdp-run/waste.txt`: `1,394`
- `artifacts/successful-visible-cdp-run/waste.json`: `2,377`
- `artifacts/successful-visible-cdp-run/timing.txt`: `103`
- `artifacts/successful-visible-cdp-run/timing.json`: `128`
- `artifacts/successful-visible-cdp-run/session.json`: `96`
- `artifacts/summary-visible-cdp-latest.json`: `144`

Aggregate token count across all listed artifacts:
- `64,284` tokens (`cl100k_base`)

Notes:
- This aggregate is an artifact text-volume count, not billable API usage.
- `messages.txt` and `messages.json` contain overlapping data, so summing both overstates unique conversational content.
