import { describe, expect, it } from "vitest";
import {
  AntiBotPolicyEngine,
  DEFAULT_ANTI_BOT_POLICY_CONFIG,
  resolveAntiBotPolicyConfig
} from "../src/providers/shared/anti-bot-policy";

describe("anti-bot policy engine", () => {
  it("normalizes config bounds and trims optional hints", () => {
    const config = resolveAntiBotPolicyConfig({
      enabled: false,
      cooldownMs: 999999,
      maxChallengeRetries: -5,
      proxyHint: "  rotating-residential ",
      sessionHint: "  warm-profile  ",
      allowBrowserEscalation: true
    });

    expect(config.enabled).toBe(false);
    expect(config.cooldownMs).toBe(300000);
    expect(config.maxChallengeRetries).toBe(0);
    expect(config.proxyHint).toBe("rotating-residential");
    expect(config.sessionHint).toBe("warm-profile");
    expect(config.allowBrowserEscalation).toBe(true);
    expect(DEFAULT_ANTI_BOT_POLICY_CONFIG.cooldownMs).toBe(30000);
  });

  it("returns pass-through decisions when policy is disabled", () => {
    const engine = new AntiBotPolicyEngine({ enabled: false });

    expect(engine.preflight({
      providerId: "social/youtube",
      operation: "fetch",
      nowMs: 100
    })).toEqual({
      allow: true,
      escalationIntent: false
    });

    expect(engine.postflight({
      providerId: "social/youtube",
      operation: "fetch",
      success: false,
      reasonCode: "challenge_detected",
      retryable: true,
      attempt: 1,
      maxAttempts: 3,
      nowMs: 100
    })).toEqual({
      allowRetry: true,
      escalationIntent: false
    });
  });

  it("enforces cooldown windows and emits escalation hints", () => {
    const engine = new AntiBotPolicyEngine({
      enabled: true,
      cooldownMs: 50,
      maxChallengeRetries: 3,
      proxyHint: "proxy://residential",
      sessionHint: "session:warm",
      allowBrowserEscalation: true
    });

    const postflight = engine.postflight({
      providerId: "social/youtube",
      operation: "fetch",
      success: false,
      reasonCode: "challenge_detected",
      retryable: true,
      attempt: 1,
      maxAttempts: 3,
      nowMs: 100
    });
    expect(postflight).toMatchObject({
      allowRetry: true,
      reasonCode: "challenge_detected",
      retryAfterMs: 50,
      escalationIntent: true,
      proxyHint: "proxy://residential",
      sessionHint: "session:warm"
    });

    const activeCooldown = engine.preflight({
      providerId: "social/youtube",
      operation: "fetch",
      nowMs: 125
    });
    expect(activeCooldown).toMatchObject({
      allow: false,
      reasonCode: "challenge_detected",
      retryGuidance: "cooldown_active",
      escalationIntent: true,
      proxyHint: "proxy://residential",
      sessionHint: "session:warm"
    });
    expect(activeCooldown.retryAfterMs).toBe(25);

    expect(engine.preflight({
      providerId: "social/youtube",
      operation: "fetch",
      nowMs: 151
    })).toEqual({
      allow: true,
      escalationIntent: false
    });
  });

  it("respects challenge retry budget", () => {
    const engine = new AntiBotPolicyEngine({
      enabled: true,
      cooldownMs: 0,
      maxChallengeRetries: 0,
      allowBrowserEscalation: false
    });

    const firstAttempt = engine.postflight({
      providerId: "social/youtube",
      operation: "fetch",
      success: false,
      reasonCode: "challenge_detected",
      retryable: true,
      attempt: 1,
      maxAttempts: 3,
      nowMs: 200
    });
    expect(firstAttempt.allowRetry).toBe(true);

    const secondAttempt = engine.postflight({
      providerId: "social/youtube",
      operation: "fetch",
      success: false,
      reasonCode: "challenge_detected",
      retryable: true,
      attempt: 2,
      maxAttempts: 3,
      nowMs: 210
    });
    expect(secondAttempt.allowRetry).toBe(false);
  });

  it("clears cooldown state after success", () => {
    const engine = new AntiBotPolicyEngine({
      enabled: true,
      cooldownMs: 100,
      maxChallengeRetries: 1,
      allowBrowserEscalation: true
    });

    engine.postflight({
      providerId: "shopping/amazon",
      operation: "search",
      success: false,
      reasonCode: "rate_limited",
      retryable: true,
      attempt: 1,
      maxAttempts: 2,
      nowMs: 1000
    });
    expect(engine.preflight({
      providerId: "shopping/amazon",
      operation: "search",
      nowMs: 1050
    }).allow).toBe(false);

    engine.postflight({
      providerId: "shopping/amazon",
      operation: "search",
      success: true,
      retryable: false,
      attempt: 1,
      maxAttempts: 2,
      nowMs: 1060
    });

    expect(engine.preflight({
      providerId: "shopping/amazon",
      operation: "search",
      nowMs: 1061
    })).toEqual({
      allow: true,
      escalationIntent: false
    });
  });
});
