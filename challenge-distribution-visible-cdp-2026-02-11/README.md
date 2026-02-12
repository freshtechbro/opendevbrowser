# Browser Automation Challenge Distribution (Visible CDP)

This folder packages a successful **live visible CDP** run and all supporting materials.

If you are new, follow `SETUP_AND_RUN_GUIDE.md` first.

Directory placement (required):
- Keep this full folder intact at one path, for example:
  - `~/challenge-assignment/challenge-distribution-visible-cdp-2026-02-11`
- Do not separate `scripts/`, `dist/`, `artifacts/`, and `docs/` into different locations.

Prerequisite (assignment requirement):
- Install OpenDevBrowser CLI:
  - `npm install -g opendevbrowser`
  - verify with `opendevbrowser --version`
  - if global command is unavailable, verify with `npx -y opendevbrowser@latest --version`

## What is included

- `scripts/challenge-solver.mjs` - solver used to complete the challenge.
- `artifacts/successful-visible-cdp-run/` - full run artifacts:
  - `messages.txt`, `messages.json`
  - `timing.txt`, `timing.json`
  - `waste.txt`, `waste.json`
  - `session.json`
- `artifacts/summary-visible-cdp-latest.json` - run summary.
- `docs/CHALLENGE_APPROACH_REPORT.md` - approach report.
- `docs/CHALLENGE_LEARNINGS_LOG.md` - learnings log.
- `docs/CHALLENGE_SOLVING_GUIDE.md` - solving guide.
- `RUN_STATISTICS.md` - metrics (time, token usage, OpenAI cost).
- `SETUP_AND_RUN_GUIDE.md` - beginner step-by-step setup and run guide.
- `dist/chunk-JVBMT2O5.js` - local OpenDevBrowser core runtime bundle used by the solver.
- `package.json` - runtime dependencies required by the solver.

## Reproduce (live visible CDP, non-headless)

1. Install runtime dependencies:

```bash
npm install
```

2. Launch visible Chrome with CDP:

```bash
open -na "Google Chrome" --args \
  --remote-debugging-port=9666 \
  --user-data-dir=/tmp/odb-cdp-visible-9666 \
  --no-first-run \
  --no-default-browser-check \
  "https://serene-frangipane-7fd25b.netlify.app"
```

3. Run solver against that visible browser:

```bash
node scripts/challenge-solver.mjs --mode cdp --cdp-endpoint http://127.0.0.1:9666 --runs 1
```

4. Review run artifacts under `artifacts/challenge-runs/`.

## Compliance notes

- Uses browser interaction flow only.
- No session/local storage or source-code exploitation.
- No mid-run navigation reset.
