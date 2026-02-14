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
    const keywords = ["quick start", "getting started", "launch", "connect", "setup"];
    expect(shouldTriggerSkillNudge("Give me a quick start for this session", keywords)).toBe(true);
    expect(shouldTriggerSkillNudge("Please connect to my existing browser", keywords)).toBe(true);
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

  it("includes a marker and explicit quick start suggestion", () => {
    const message = buildSkillNudgeMessage();
    expect(message).toContain(SKILL_NUDGE_MARKER);
    expect(message).toContain('skill("opendevbrowser-best-practices", "quick start")');
  });
});
