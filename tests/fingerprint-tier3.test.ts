import { describe, expect, it, vi } from "vitest";
import {
  createTier3RuntimeState,
  evaluateTier3Adaptive,
  resolveTier3Fallback,
  type Tier3RuntimeConfig
} from "../src/browser/fingerprint/tier3-adaptive";
import {
  DeterministicTier3Adapter,
  resolveTier3Adapter,
  type Tier3Adapter
} from "../src/browser/fingerprint/adapters";
import { createCanaryState, pushCanarySample } from "../src/browser/fingerprint/canary";
import {
  createFingerprintProfile,
  profileSeedFrom,
  rotateFingerprintProfile
} from "../src/browser/fingerprint/profiles";

const config: Tier3RuntimeConfig = {
  enabled: true,
  fallbackTier: "tier2",
  canary: {
    windowSize: 5,
    minSamples: 2,
    promoteThreshold: 80,
    rollbackThreshold: 30
  }
};

describe("fingerprint tier3 adaptive", () => {
  it("creates runtime state with deterministic adapter default", () => {
    const state = createTier3RuntimeState(config);
    expect(state.enabled).toBe(true);
    expect(state.adapterName).toBe("deterministic");
    expect(state.status).toBe("active");
  });

  it("promotes canary level when sustained scores are high", () => {
    const adapter: Tier3Adapter = {
      name: "test-adapter",
      evaluate: () => ({ score: 95, reason: "healthy" })
    };

    let state = createTier3RuntimeState(config, adapter);
    const first = evaluateTier3Adaptive(state, config, {
      hasChallenge: false,
      healthScore: 95,
      challengeCount: 0,
      rotationCount: 0
    }, adapter, 1700000000000);
    state = first.state;

    const second = evaluateTier3Adaptive(state, config, {
      hasChallenge: false,
      healthScore: 95,
      challengeCount: 0,
      rotationCount: 0
    }, adapter, 1700000005000);

    expect(second.action).toBe("promote");
    expect(second.state.canary.level).toBeGreaterThan(0);
  });

  it("rolls back when adapter forces rollback", () => {
    const adapter: Tier3Adapter = {
      name: "rollback-adapter",
      evaluate: () => ({ score: 10, reason: "critical", forceRollback: true })
    };

    const state = createTier3RuntimeState(config, adapter);
    const result = evaluateTier3Adaptive(state, config, {
      hasChallenge: true,
      healthScore: 10,
      challengeCount: 4,
      rotationCount: 2
    }, adapter, 1700000010000);

    expect(result.action).toBe("rollback");
    expect(result.state.status).toBe("fallback");
    expect(result.state.fallbackReason).toBe("critical");

    const manualFallback = resolveTier3Fallback(result.state, "manual", 1700000015000);
    expect(manualFallback.status).toBe("fallback");
    expect(manualFallback.fallbackReason).toBe("manual");
  });

  it("runs deterministic adapter penalties and fallback resolver", () => {
    const adapter = new DeterministicTier3Adapter();
    const critical = adapter.evaluate({
      hasChallenge: true,
      healthScore: 15,
      challengeCount: 5,
      rotationCount: 3
    });
    expect(critical).toEqual({
      score: 0,
      reason: "health score critically low",
      forceRollback: true
    });

    const stable = adapter.evaluate({
      hasChallenge: false,
      healthScore: 95,
      challengeCount: 0,
      rotationCount: 0
    });
    expect(stable).toEqual({
      score: 95,
      reason: "stable"
    });

    const challenged = adapter.evaluate({
      hasChallenge: true,
      healthScore: 85,
      challengeCount: 0,
      rotationCount: 0
    });
    expect(challenged).toEqual({
      score: 60,
      reason: "challenge detected"
    });

    expect(resolveTier3Adapter().name).toBe("deterministic");
    const custom: Tier3Adapter = {
      name: "custom-tier3",
      evaluate: () => ({ score: 77, reason: "custom" })
    };
    expect(resolveTier3Adapter(custom).name).toBe("custom-tier3");
  });

  it("executes canary rollback branch and adapter callbacks", () => {
    const rollbackSpy = vi.fn();
    const adapter: Tier3Adapter = {
      name: "rollback-canary",
      evaluate: () => ({ score: 10, reason: "degraded" }),
      onRollback: rollbackSpy
    };

    const rollbackConfig: Tier3RuntimeConfig = {
      enabled: true,
      fallbackTier: "tier2",
      canary: {
        windowSize: 3,
        minSamples: 1,
        promoteThreshold: 95,
        rollbackThreshold: 30
      }
    };

    const state = createTier3RuntimeState(rollbackConfig, adapter);
    const result = evaluateTier3Adaptive(state, rollbackConfig, {
      hasChallenge: false,
      healthScore: 10,
      challengeCount: 1,
      rotationCount: 1
    }, adapter, 1700000020000);

    expect(result.action).toBe("rollback");
    expect(result.state.status).toBe("fallback");
    expect(result.state.fallbackReason).toBe("degraded");
    expect(rollbackSpy).toHaveBeenCalledTimes(1);

    const canaryRollback = pushCanarySample(
      createCanaryState(1),
      {
        windowSize: 1,
        minSamples: 1,
        promoteThreshold: 90,
        rollbackThreshold: 20
      },
      {
        ts: 1700000021000,
        score: 0,
        success: false,
        reason: "critical"
      }
    );
    expect(canaryRollback.action).toBe("rollback");
    expect(canaryRollback.state.level).toBe(0);
  });

  it("promotes from fallback and clears fallback reason", () => {
    const promoteSpy = vi.fn();
    const adapter: Tier3Adapter = {
      name: "promoter",
      evaluate: () => ({ score: 99, reason: "healthy" }),
      onPromote: promoteSpy
    };

    const promoteConfig: Tier3RuntimeConfig = {
      enabled: true,
      fallbackTier: "tier2",
      canary: {
        windowSize: 2,
        minSamples: 1,
        promoteThreshold: 90,
        rollbackThreshold: 20
      }
    };

    const initial = resolveTier3Fallback(createTier3RuntimeState(promoteConfig, adapter), "temporary", 1700000030000);
    const promoted = evaluateTier3Adaptive(initial, promoteConfig, {
      hasChallenge: false,
      healthScore: 99,
      challengeCount: 0,
      rotationCount: 0
    }, adapter, 1700000035000);

    expect(promoted.action).toBe("promote");
    expect(promoted.state.status).toBe("active");
    expect(promoted.state.fallbackReason).toBeUndefined();
    expect(promoteSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps deterministic profile helpers stable across rotations", () => {
    expect(profileSeedFrom("session-1")).toBe("default:session-1");
    expect(profileSeedFrom("session-1", "named")).toBe("named:session-1");

    const profile = createFingerprintProfile("seed", 0, 1700000040000);
    const rotated = rotateFingerprintProfile(
      {
        ...profile,
        healthScore: 30,
        challengeCount: 2,
        rotationCount: 4
      },
      1700000045000
    );

    expect(rotated.rotationCount).toBe(5);
    expect(rotated.challengeCount).toBe(2);
    expect(rotated.healthScore).toBe(40);
  });
});
