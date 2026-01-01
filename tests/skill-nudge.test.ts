import { describe, it, expect } from "vitest";
import {
  buildSkillNudgeMessage,
  extractTextFromParts,
  consumeSkillNudge,
  createSkillNudgeState,
  markSkillNudge,
  shouldTriggerSkillNudge,
  SKILL_NUDGE_MARKER
} from "../src/skills/skill-nudge";

describe("skill nudge", () => {
  it("triggers on keyword matches", () => {
    const keywords = ["login", "form", "extract"];
    expect(shouldTriggerSkillNudge("Help me login to the site", keywords)).toBe(true);
    expect(shouldTriggerSkillNudge("Please extract table data", keywords)).toBe(true);
    expect(shouldTriggerSkillNudge("Just saying hello", keywords)).toBe(false);
  });

  it("consumes pending nudges within max age", () => {
    const state = createSkillNudgeState();
    markSkillNudge(state, 1000);
    expect(consumeSkillNudge(state, 1500, 10000)).toBe(true);
    expect(consumeSkillNudge(state, 1600, 10000)).toBe(false);
  });

  it("returns false when no nudge is pending", () => {
    const state = createSkillNudgeState();
    expect(consumeSkillNudge(state, 1500, 10000)).toBe(false);
  });

  it("expires pending nudges after max age", () => {
    const state = createSkillNudgeState();
    markSkillNudge(state, 1000);
    expect(consumeSkillNudge(state, 8000, 2000)).toBe(false);
  });

  it("clears pending nudges missing a timestamp", () => {
    const state = createSkillNudgeState();
    state.pending = true;
    state.requestedAtMs = null;
    expect(consumeSkillNudge(state, 2000, 2000)).toBe(false);
  });

  it("extracts text parts and ignores non-text parts", () => {
    const text = extractTextFromParts([
      { type: "text", text: "First line" },
      { type: "file", text: "ignored" },
      { type: "text", text: "Second line" },
      { type: "text", text: "" }
    ]);
    expect(text).toBe("First line\nSecond line");
  });

  it("includes a marker in the nudge message", () => {
    expect(buildSkillNudgeMessage()).toContain(SKILL_NUDGE_MARKER);
  });
});
