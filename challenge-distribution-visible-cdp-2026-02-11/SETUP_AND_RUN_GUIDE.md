# Setup And Run Guide (Beginner Friendly)

This guide is for someone starting from scratch.

## 1. Put the distribution folder in the right place

Use one parent folder and keep everything together.

Recommended location:

```bash
mkdir -p ~/challenge-assignment
```

Move/copy this full folder into that location so you have:

```text
~/challenge-assignment/challenge-distribution-visible-cdp-2026-02-11/
```

Important:
- Do not split files across different directories.
- Keep `scripts/`, `dist/`, `artifacts/`, and `docs/` inside the same distribution folder.

## 2. Install prerequisites

You need:
- Node.js 20+ (or 18+)
- Google Chrome
- OpenDevBrowser CLI
- Terminal access

Check installs:

```bash
node -v
npm -v
```

If these commands fail, install Node.js first: https://nodejs.org

## 3. Install OpenDevBrowser

Install globally:

```bash
npm install -g opendevbrowser
```

Confirm install:

```bash
opendevbrowser --version
```

If global install is blocked, use `npx`:

```bash
npx -y opendevbrowser@latest --version
```

## 4. Open a terminal and go to the distribution folder

```bash
cd ~/challenge-assignment/challenge-distribution-visible-cdp-2026-02-11
```

You should see:
- `scripts/challenge-solver.mjs`
- `dist/chunk-JVBMT2O5.js`

## 5. Install solver runtime dependencies

Run this in the distribution folder:

```bash
npm install
```

This installs the required runtime packages (for example `playwright-core`) used by `dist/chunk-JVBMT2O5.js`.

## 6. Start Chrome in visible CDP mode (not headless)

Run this in terminal (macOS):

```bash
open -na "Google Chrome" --args \
  --remote-debugging-port=9666 \
  --user-data-dir=/tmp/odb-cdp-visible-9666 \
  --no-first-run \
  --no-default-browser-check \
  "https://serene-frangipane-7fd25b.netlify.app"
```

What this does:
- opens a real visible Chrome window
- enables CDP on port `9666`
- opens the challenge site

If you are on Linux/Windows, launch Chrome manually with equivalent flags:
- `--remote-debugging-port=9666`
- `--user-data-dir=/tmp/odb-cdp-visible-9666` (or any empty temp folder)
- open URL `https://serene-frangipane-7fd25b.netlify.app`

## 7. Run the solver

In another terminal tab (same folder), run:

```bash
node scripts/challenge-solver.mjs --mode cdp --cdp-endpoint http://127.0.0.1:9666 --runs 1
```

You should see the browser solving steps automatically.

Optional connectivity check before running solver:

```bash
curl -s http://127.0.0.1:9666/json/version
```

## 8. Verify success

At the end, terminal output should show:
- `"completed": true`
- a run folder path under `artifacts/challenge-runs/...`

Also check the browser ends on:
- `/finish` with the completion message

## 9. Find run artifacts

For each run, inspect:
- `artifacts/challenge-runs/<timestamp>-run-1/messages.txt`
- `artifacts/challenge-runs/<timestamp>-run-1/timing.txt`
- `artifacts/challenge-runs/<timestamp>-run-1/waste.txt`
- `artifacts/challenge-runs/<timestamp>-run-1/session.json`
- `artifacts/challenge-runs/summary-<timestamp>.json`

## 10. If something fails

### Problem: `Target page, context or browser has been closed`
Fix:
1. Close Chrome
2. Restart with a new port + profile
3. Re-run solver with matching port

Example:

```bash
open -na "Google Chrome" --args --remote-debugging-port=9777 --user-data-dir=/tmp/odb-cdp-visible-9777 "https://serene-frangipane-7fd25b.netlify.app"
node scripts/challenge-solver.mjs --mode cdp --cdp-endpoint http://127.0.0.1:9777 --runs 1
```

### Problem: port already in use
Use a different port (example `9777`) in both commands.

### Problem: command not found for `node`
Install Node.js, reopen terminal, run again.

## 11. Notes on token and cost metrics

- This solver run is local CDP automation.
- OpenAI billable token usage for this run mode is `0` unless you add an external model call.
- Strict artifact tokenization counts are in `RUN_STATISTICS.md`.

## 12. Why install OpenDevBrowser if solver is local?

- Assignment requirement: show OpenDevBrowser is installed and available.
- This distribution includes a local runtime bundle for reproducibility, but you should still install OpenDevBrowser and confirm it works (`opendevbrowser --version`).
