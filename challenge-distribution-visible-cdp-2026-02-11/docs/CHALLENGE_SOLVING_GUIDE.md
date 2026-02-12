# Browser Automation Challenge Solving Guide

This guide documents the **challenge-solving logic** (what to do on each challenge type), independent of implementation/tool wrappers.

## Rules to keep

- Do one initial page entry, then stay in-session.
- Do not reload or navigate away mid-run.
- Do not read codes from storage/source.
- Solve by interacting with the challenge UI as intended.

## Core loop (steps 1-30)

1. Detect current step state and challenge type from the challenge text/UI.
2. Run the minimal action sequence for that type.
3. Wait only as needed for reveal/async completion.
4. Extract the revealed code from challenge UI (not hidden storage).
5. Submit once, then continue to next step.

## Method playbook

Use this as the deterministic per-step action map:

- `visible`: read code and submit.
- `hidden_dom`: click required hidden counter area until complete, then submit.
- `click_reveal`: click reveal button/card, then submit.
- `scroll_reveal`: scroll until target px reached, then submit.
- `delayed_reveal`: passive wait; avoid disruptive clicks.
- `drag_drop`: drag each piece into matching slot, then submit.
- `keyboard_sequence`: press required key sequence length, then submit.
- `memory`: click `I Remember` when available, then submit.
- `hover_reveal`: hover and hold until code reveals, then submit.
- `timing`: click capture at correct timing state, then submit.
- `canvas`: draw required strokes on challenge canvas, click reveal, submit.
- `audio`: trigger play, wait completion window, click complete, submit.
- `video`: perform frame/seek actions, complete, submit.
- `split_parts`: click all visible parts until all marked done, submit.
- `encoded_base64`: complete decode/reveal flow, then submit revealed code.
- `rotating`: perform capture cycle, then submit.
- `obfuscated`: decode flow to reveal real code, then submit.
- `multi_tab`: visit all challenge tabs, reveal, submit.
- `gesture`: draw gesture path on challenge canvas, complete, submit.
- `sequence` / `conditional_reveal`: execute click + hover + type + scroll sequence, complete, submit.
- `puzzle_solve` / `calculated`: solve expression, fill numeric answer, click solve, then submit.
- `shadow_dom`: click Level 1 → Level 2 → Level 3 → Reveal Code, then submit.
- `websocket`: connect, wait ready state, reveal code, then submit.
- `service_worker`: register worker, retrieve from cache, submit.
- `mutation`: trigger required mutations, complete, submit.
- `recursive_iframe`: enter nested levels, extract code at deepest level, submit.

## Proven anti-failure checks

- Only submit when challenge completion/reveal state is present.
- Ignore decoy controls outside the challenge card for stateful methods.
- In timer/delay phases, avoid random fallback clicks that can reset progress.
- For puzzle-family methods, clear stale prior-step solved state before solving current expression.
- For gesture/canvas methods, always target the challenge-card canvas, not first canvas on page.

## Known terminal bug states (current)

- `shadow_dom`: can stall at `Levels revealed: 2/3`.
- `websocket`: can stall at `Code: null`.
- `recursive_iframe`: can stall at deepest-level extract state.

When these appear, use narrow step-specific recovery logic; do not broaden global fallback behavior.

## Run documentation checklist

For each run, keep:
- `messages.txt`: action and decision trace.
- `timing.txt`: wall/agent/tool timing split.
- `waste.txt`: per-step calls + retries/errors.
- `session.json`: machine-readable run metrics.

For trend tracking:
- append key observations to `docs/CHALLENGE_LEARNINGS_LOG.md`.
