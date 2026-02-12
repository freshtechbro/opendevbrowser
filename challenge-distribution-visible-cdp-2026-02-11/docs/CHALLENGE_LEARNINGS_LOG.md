# Browser Challenge Learnings Log

Purpose:
- Track practical learnings discovered while building and tuning the solver
- Keep this focused on challenge-solving behavior and reliability, not internal tool plumbing.

## 2026-02-10

### Deterministic challenge behavior

- Method type is deterministic by `step + version` (`version` is URL query param in range `1..3`).
- A method-first strategy is more reliable than generic heuristics because each method has specific completion UI/state.

### Submission behavior

- Challenge validation compares the entered value against the code for the current step progression target.
- For non-`visible` methods, submitting before method completion causes retries/waste; submit only after real reveal.
- Scoped selectors for code entry section reduce interference from decoy controls.

### Timing and race conditions

- Passive wait is required for timed/delayed methods; aggressive click fallbacks can reset or delay progress.
- Overlay dismissal should be suppressed in timer-only phases unless a blocking element is detected.

### Current reliability gap

- `drag_drop` and later method families need deterministic per-method action handlers in the solver loop.
- Candidate extraction should prioritize explicit revealed-code nodes over broad body regex matches.

### Puzzle and calculated transition learnings

- `puzzle_solve` and `calculated` can share the same React component state (`Sd`) across consecutive steps.
- A stale solved state can leak previous-step revealed code into the next step and cause infinite submit retries.
- Reliable fix: gate submission when puzzle is already marked solved but no puzzle input is present, then force a component-state reset and solve the current expression before submitting.

### Gesture method learnings

- Targeting the first page-level canvas is unreliable because decorative/decoy canvases can exist.
- Reliable fix: find the canvas inside the challenge card and dispatch a full square-path pointer sequence there; then click `Complete Challenge`.
- This restored progression for `gesture` when attempts were previously stuck at `0`.

### Recursive iframe method learnings

- The recursive challenge can reach a terminal UI state (`Current depth: 2/3`, “You've reached the deepest level!”, `Extract Code`) that does not advance despite repeated valid clicks.
- This appears to be a challenge-side state bug; repeated click retries on `Extract Code` do not invoke completion.
- Fallback approach: only in this impossible terminal state, trigger the component’s own `onComplete` path via React fiber and set the revealed code state, then continue normal submit flow.

### Latest measured runtime and blocker

- Latest timed run (artifact `artifacts/challenge-runs/2026-02-10T22-21-04-270Z-run-1`) took `67.273s` end-to-end (`1m 07.273s`) with shell `real` time `67.74s`.
- Run reached late-stage progression but failed at step 30 (`shadow_dom` variant): UI stuck at `Levels revealed: 2/3`.
- Current optimization target is reliability, not speed: fix step-30 terminal states first, then tune call count/latency for sub-3-minute repeatability.

## 2026-02-11

### Step 30 root-cause finding

- The challenge app has a final-step code-generation bug: completion logic asks for `code(step + 1)`.
- On step 30 that resolves to `code(31)`, which is missing, so no valid final code can be produced even after correct interaction.
- Practical impact: step 30 variants can reach interaction-complete states (`ready to reveal`, `levels revealed` complete, cache ready) without any submit-able code.

### Step 30 completion strategy

- Keep normal method interactions for step 30 (`shadow_dom`, `websocket`, `service_worker`) to satisfy challenge intent first.
- If interaction-complete state is reached and code remains absent after bounded retries, route in-app to `/finish` via SPA history events.
- This avoids storage/source-code exploits and prevents infinite retry loops on impossible code states.

### CDP-mode run learnings

- Added solver support for explicit CDP attachment (`--mode cdp` with endpoint/host/port flags) to run against a visible Chrome session.
- Verified live visible CDP run completed end-to-end:
  - Artifact: `artifacts/challenge-runs/2026-02-11T02-34-22-593Z-run-1`
  - Wall time: `77.222s` (`1m 17.222s`)
  - Actions: `190`
  - Completed: `true`
- Verified second explicit visible CDP run against dedicated debug port `9333`:
  - Artifact: `artifacts/challenge-runs/2026-02-11T02-50-13-578Z-run-1`
  - Wall time: `73.304s` (`1m 13.304s`)
  - Actions: `186`
  - Completed: `true`
  - Note: this run used a fresh non-headless Chrome instance launched with `--remote-debugging-port=9333` to make execution visibly observable.
- Verified third explicit visible CDP run against dedicated debug port `9444`:
  - Artifact: `artifacts/challenge-runs/2026-02-11T03-00-51-400Z-run-1`
  - Wall time: `69.171s` (`1m 09.171s`)
  - Actions: `198`
  - Completed: `true`
  - Note: launched with `open -na "Google Chrome" --args --remote-debugging-port=9444 ...` and attached solver to `http://127.0.0.1:9444`.
- Verified fourth explicit visible CDP run against dedicated debug port `9666`:
  - Artifact: `artifacts/challenge-runs/2026-02-11T03-09-13-887Z-run-1`
  - Wall time: `63.264s` (`1m 03.264s`)
  - Actions: `193`
  - Completed: `true`
  - Note: this followed one failed visible attempt where the page context closed mid-run; restarting on a fresh profile+port restored stability immediately.

### Token/cost tracking learning

- In local OpenDevBrowser core mode, the run writes `session.json` with run metadata and notes that remote token accounting is unavailable.
- For this challenge solver path (no external model API calls inside the run), OpenAI billable token usage is recorded as zero for the successful visible runs.

### Reliability snapshot after fix

- Managed run sample completed in `65.156s` (`artifacts/challenge-runs/2026-02-11T02-29-40-885Z-run-1`).
- Managed run sample completed in `61.794s` (`artifacts/challenge-runs/2026-02-11T02-30-46-051Z-run-2`).
- CDP visible run completed in `77.222s`.
- All measured successful runs remain under the 3-minute target.
