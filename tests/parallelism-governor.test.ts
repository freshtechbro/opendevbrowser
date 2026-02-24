import { describe, expect, it } from "vitest";
import { resolveConfig } from "../src/config";
import {
  createGovernorState,
  evaluateGovernor,
  resolveStaticCap,
  rssUsagePercent
} from "../src/browser/parallelism-governor";
import {
  DEFAULT_OPS_PARALLELISM_POLICY,
  createOpsGovernorState,
  evaluateOpsGovernor
} from "../extension/src/ops/parallelism-governor";

describe("parallelism governor", () => {
  it("keeps extension default policy aligned with resolved core config", () => {
    const policy = resolveConfig({}).parallelism;
    expect(policy).toEqual(DEFAULT_OPS_PARALLELISM_POLICY);
  });

  it("applies medium/high/critical penalties and lifecycle signals", () => {
    const policy = resolveConfig({}).parallelism;
    let state = createGovernorState(policy, "managedHeaded");

    const medium = evaluateGovernor(policy, state, {
      hostFreeMemPct: policy.hostFreeMemMediumPct,
      rssUsagePct: 10,
      queueAgeMs: 0,
      queueDepth: 0,
      frozenSignals: 1
    });
    expect(medium.pressure).toBe("medium");
    expect(medium.state.effectiveCap).toBe(state.staticCap - 2);
    state = medium.state;

    const high = evaluateGovernor(policy, state, {
      hostFreeMemPct: policy.hostFreeMemHighPct,
      rssUsagePct: policy.rssHighPct,
      queueAgeMs: policy.queueAgeHighMs,
      queueDepth: 1,
      discardedSignals: 1
    });
    expect(high.pressure).toBe("high");
    expect(high.state.effectiveCap).toBe(3);
    state = high.state;

    const critical = evaluateGovernor(policy, state, {
      hostFreeMemPct: policy.hostFreeMemCriticalPct,
      rssUsagePct: policy.rssCriticalPct,
      queueAgeMs: policy.queueAgeCriticalMs,
      queueDepth: 2
    });
    expect(critical.pressure).toBe("critical");
    expect(critical.state.effectiveCap).toBe(policy.floor);
    expect(critical.targetCap).toBe(policy.floor);
  });

  it("requires healthy windows before recovery and then recovers one slot at a time", () => {
    const policy = resolveConfig({ parallelism: { recoveryStableWindows: 2 } }).parallelism;
    let state = createGovernorState(policy, "managedHeaded");
    state = { ...state, effectiveCap: policy.floor, healthyWindows: 0 };

    const healthy1 = evaluateGovernor(policy, state, {
      hostFreeMemPct: 90,
      rssUsagePct: 5,
      queueAgeMs: 0,
      queueDepth: 0
    });
    expect(healthy1.state.effectiveCap).toBe(policy.floor);
    expect(healthy1.state.healthyWindows).toBe(1);

    const healthy2 = evaluateGovernor(policy, healthy1.state, {
      hostFreeMemPct: 90,
      rssUsagePct: 5,
      queueAgeMs: 0,
      queueDepth: 0
    });
    expect(healthy2.state.effectiveCap).toBe(policy.floor + 1);
    expect(healthy2.state.healthyWindows).toBe(0);
  });

  it("handles invalid percentages and queue values deterministically", () => {
    const policy = resolveConfig({}).parallelism;
    const state = createGovernorState(policy, "managedHeaded");
    const clamped = evaluateGovernor(policy, state, {
      hostFreeMemPct: 150,
      rssUsagePct: 150,
      queueAgeMs: 0,
      queueDepth: 1
    });
    expect(clamped.pressure).toBe("critical");

    const snapshot = evaluateGovernor(policy, state, {
      hostFreeMemPct: Number.NaN,
      rssUsagePct: Number.POSITIVE_INFINITY,
      queueAgeMs: Number.NaN,
      queueDepth: -4,
      discardedSignals: -1,
      frozenSignals: -2
    });
    expect(snapshot.pressure).toBe("critical");
    expect(snapshot.waitQueueDepth).toBe(0);
    expect(snapshot.waitQueueAgeMs).toBe(0);
  });

  it("clamps static cap and reports rss usage with non-positive budgets", () => {
    const policy = resolveConfig({}).parallelism;
    const mutated = {
      ...policy,
      floor: 3,
      modeCaps: {
        ...policy.modeCaps,
        extensionLegacyCdpHeaded: 1
      }
    };
    expect(resolveStaticCap(mutated, "extensionLegacyCdpHeaded")).toBe(3);
    expect(rssUsagePercent(1024, 0)).toBeGreaterThan(0);
  });

  it("replays synthetic pressure profile identically across core and ops governors", () => {
    const policy = resolveConfig({}).parallelism;
    let core = createGovernorState(policy, "extensionOpsHeaded");
    let ops = createOpsGovernorState(DEFAULT_OPS_PARALLELISM_POLICY, "extensionOpsHeaded");

    const profile = [
      { hostFreeMemPct: 70, rssUsagePct: 20, queueAgeMs: 0, queueDepth: 0, discardedSignals: 0, frozenSignals: 0 },
      { hostFreeMemPct: 24, rssUsagePct: 20, queueAgeMs: 0, queueDepth: 0, discardedSignals: 0, frozenSignals: 1 },
      { hostFreeMemPct: 17, rssUsagePct: 76, queueAgeMs: 2500, queueDepth: 1, discardedSignals: 1, frozenSignals: 0 },
      { hostFreeMemPct: 9, rssUsagePct: 86, queueAgeMs: 5500, queueDepth: 2, discardedSignals: 1, frozenSignals: 1 },
      { hostFreeMemPct: 80, rssUsagePct: 20, queueAgeMs: 0, queueDepth: 0, discardedSignals: 0, frozenSignals: 0 },
      { hostFreeMemPct: 80, rssUsagePct: 20, queueAgeMs: 0, queueDepth: 0, discardedSignals: 0, frozenSignals: 0 },
      { hostFreeMemPct: 80, rssUsagePct: 20, queueAgeMs: 0, queueDepth: 0, discardedSignals: 0, frozenSignals: 0 }
    ];

    for (let index = 0; index < profile.length; index += 1) {
      const now = 1_000 + index;
      const coreSnapshot = evaluateGovernor(policy, core, profile[index], now);
      const opsSnapshot = evaluateOpsGovernor(DEFAULT_OPS_PARALLELISM_POLICY, ops, profile[index], now);
      expect(coreSnapshot.pressure).toBe(opsSnapshot.pressure);
      expect(coreSnapshot.targetCap).toBe(opsSnapshot.targetCap);
      expect(coreSnapshot.state.effectiveCap).toBe(opsSnapshot.state.effectiveCap);
      core = coreSnapshot.state;
      ops = opsSnapshot.state;
    }
  });
});
