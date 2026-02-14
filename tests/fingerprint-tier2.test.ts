import { describe, expect, it } from "vitest";
import {
  applyTier2NetworkEvent,
  createTier2RuntimeState,
  detectTier2Challenge,
  type Tier2RuntimeConfig
} from "../src/browser/fingerprint/tier2-runtime";

const config: Tier2RuntimeConfig = {
  enabled: true,
  mode: "adaptive",
  rotationIntervalMs: 60_000,
  challengePatterns: ["captcha", "challenge"],
  maxChallengeEvents: 5,
  scorePenalty: 30,
  scoreRecovery: 5,
  rotationHealthThreshold: 60
};

describe("fingerprint tier2 runtime", () => {
  it("creates deterministic initial profile", () => {
    const stateA = createTier2RuntimeState(config, "session-1", "default", 1700000000000);
    const stateB = createTier2RuntimeState(config, "session-1", "default", 1700000000000);

    expect(stateA.profile.id).toBe(stateB.profile.id);
    expect(stateA.profile.rotationCount).toBe(0);
  });

  it("detects challenge signals from status and URL pattern", () => {
    const statusChallenge = detectTier2Challenge({ url: "https://example.com", status: 429 }, config.challengePatterns);
    expect(statusChallenge?.type).toBe("status");

    const patternChallenge = detectTier2Challenge({ url: "https://example.com/captcha", status: 200 }, config.challengePatterns);
    expect(patternChallenge?.type).toBe("url-pattern");
  });

  it("applies challenge penalties and rotates in adaptive mode", () => {
    let state = createTier2RuntimeState(config, "session-2", "default", 1700000000000);

    const first = applyTier2NetworkEvent(
      state,
      config,
      { url: "https://example.com/challenge", status: 403, ts: 1700000005000 },
      1700000005000
    );

    state = first.state;
    expect(first.challenge).not.toBeNull();
    expect(state.profile.healthScore).toBeLessThan(100);

    const second = applyTier2NetworkEvent(
      state,
      config,
      { url: "https://example.com/challenge", status: 429, ts: 1700000010000 },
      1700000010000
    );

    expect(second.rotated).toBe(true);
    expect(second.reason).toBe("challenge");
    expect(second.state.profile.rotationCount).toBeGreaterThan(0);
  });

  it("ignores invalid patterns and supports interval-disabled mode", () => {
    const noMatch = detectTier2Challenge(
      { url: "https://example.com/ok", status: 200, ts: 1700000000000 },
      ["[invalid-regex", "challenge"]
    );
    expect(noMatch).toBeNull();

    const state = createTier2RuntimeState(
      { ...config, rotationIntervalMs: 0 },
      "session-3",
      "default",
      1700000000000
    );
    const result = applyTier2NetworkEvent(
      state,
      { ...config, rotationIntervalMs: 0 },
      { url: "https://example.com/ok", status: 200, ts: 1700000005000 },
      1700000005000
    );
    expect(result.rotated).toBe(false);
    expect(result.reason).toBeUndefined();
  });

  it("recovers score on non-challenge signals and respects off mode", () => {
    let state = createTier2RuntimeState(config, "session-4", "default", 1700000000000);

    const challenged = applyTier2NetworkEvent(
      state,
      config,
      { url: "https://example.com/challenge", status: 429, ts: 1700000001000 },
      1700000001000
    );
    state = challenged.state;
    const afterPenalty = state.profile.healthScore;

    const recovered = applyTier2NetworkEvent(
      state,
      config,
      { url: "https://example.com/home", status: 200, ts: 1700000002000 },
      1700000002000
    );
    expect(recovered.challenge).toBeNull();
    expect(recovered.state.profile.healthScore).toBeGreaterThan(afterPenalty);

    const offResult = applyTier2NetworkEvent(
      recovered.state,
      { ...config, mode: "off" },
      { url: "https://example.com/challenge", status: 429, ts: 1700000003000 },
      1700000003000
    );
    expect(offResult.challenge).toBeNull();
    expect(offResult.state.profile.challengeCount).toBe(recovered.state.profile.challengeCount);
  });
});
