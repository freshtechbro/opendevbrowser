import { describe, it, expect } from "vitest";
import {
  buildContinuityNudgeMessage,
  consumeContinuityNudge,
  createContinuityNudgeState,
  markContinuityNudge,
  shouldTriggerContinuityNudge,
  CONTINUITY_NUDGE_MARKER
} from "../src/skills/continuity-nudge";

describe("continuity nudge", () => {
  it("triggers on keyword matches", () => {
    const keywords = ["plan", "migration", "long-running"];
    expect(shouldTriggerContinuityNudge("Plan the migration steps", keywords)).toBe(true);
    expect(shouldTriggerContinuityNudge("Long-running refactor", keywords)).toBe(true);
    expect(shouldTriggerContinuityNudge("Quick question", keywords)).toBe(false);
  });

  it("consumes pending nudges within max age", () => {
    const state = createContinuityNudgeState();
    markContinuityNudge(state, 1000);
    expect(consumeContinuityNudge(state, 1500, 10000)).toBe(true);
    expect(consumeContinuityNudge(state, 1600, 10000)).toBe(false);
  });

  it("returns false when no nudge is pending", () => {
    const state = createContinuityNudgeState();
    expect(consumeContinuityNudge(state, 1500, 10000)).toBe(false);
  });

  it("expires pending nudges after max age", () => {
    const state = createContinuityNudgeState();
    markContinuityNudge(state, 1000);
    expect(consumeContinuityNudge(state, 8000, 2000)).toBe(false);
  });

  it("clears pending nudges missing a timestamp", () => {
    const state = createContinuityNudgeState();
    state.pending = true;
    state.requestedAtMs = null;
    expect(consumeContinuityNudge(state, 2000, 2000)).toBe(false);
  });

  it("includes marker and file path in the nudge message", () => {
    const message = buildContinuityNudgeMessage("opendevbrowser_continuity.md");
    expect(message).toContain(CONTINUITY_NUDGE_MARKER);
    expect(message).toContain('skill("opendevbrowser-continuity-ledger")');
    expect(message).toContain("opendevbrowser_continuity.md");
  });

  it("falls back to default file path when none is provided", () => {
    const message = buildContinuityNudgeMessage();
    expect(message).toContain("opendevbrowser_continuity.md");
  });
});
