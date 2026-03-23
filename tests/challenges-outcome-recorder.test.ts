import { describe, expect, it } from "vitest";
import { OutcomeRecorder } from "../src/challenges";

describe("challenge outcome recorder", () => {
  it("keeps bounded history per challenge and exposes the latest record", () => {
    const recorder = new OutcomeRecorder();
    for (let index = 0; index < 30; index += 1) {
      recorder.record({
        at: `2026-03-22T00:00:${String(index).padStart(2, "0")}.000Z`,
        challengeId: "challenge-1",
        lane: "generic_browser_autonomy",
        status: "still_blocked",
        reason: `attempt-${index}`,
        attempts: index,
        reusedExistingSession: index > 0,
        reusedCookies: false,
        evidence: {
          url: "https://example.com/challenge",
          title: "Security verification",
          blockerType: "anti_bot_challenge",
          loginRefs: [],
          humanVerificationRefs: ["r1"],
          checkpointRefs: []
        },
        resumeOutcome: "still_blocked",
        executedSteps: []
      });
    }

    expect(recorder.read("challenge-1")).toHaveLength(25);
    expect(recorder.latest("challenge-1")?.reason).toBe("attempt-29");
    expect(recorder.latest("challenge-1")?.reusedExistingSession).toBe(true);
  });

  it("returns empty values for missing challenge ids", () => {
    const recorder = new OutcomeRecorder();

    recorder.record({
      at: "2026-03-22T00:00:00.000Z",
      challengeId: undefined,
      lane: "human_yield",
      status: "yield_required",
      reason: "manual step required",
      attempts: 0,
      reusedExistingSession: false,
      reusedCookies: false,
      evidence: {
        url: "https://example.com/login",
        title: "Sign in",
        blockerType: "auth_required",
        loginRefs: ["r1"],
        humanVerificationRefs: [],
        checkpointRefs: []
      },
      resumeOutcome: "awaiting_human_reclaim",
      executedSteps: []
    });

    expect(recorder.latest(undefined)).toBeUndefined();
    expect(recorder.read(undefined)).toEqual([]);
    expect(recorder.latest("missing")).toBeUndefined();
    expect(recorder.read("missing")).toEqual([]);
  });
});
