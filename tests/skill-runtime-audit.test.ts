import { describe, expect, it } from "vitest";
import {
  derivePackStatus,
  normalizeLaneStatus,
  summarizeJsonLane
} from "../scripts/skill-runtime-audit.mjs";

describe("skill runtime audit status modeling", () => {
  it("keeps mixed pass plus external counts as a passing lane", () => {
    expect(normalizeLaneStatus({
      pass: 21,
      fail: 0,
      env_limited: 6,
      expected_timeout: 0,
      skipped: 0
    })).toBe("pass");
  });

  it("treats mixed shared lanes as pass with advisory external observations", () => {
    const lane = summarizeJsonLane("provider-direct", "Direct provider runs", {
      ok: true,
      counts: {
        pass: 21,
        fail: 0,
        env_limited: 6,
        expected_timeout: 0,
        skipped: 0
      },
      out: "artifacts/provider-direct.json"
    });

    const derived = derivePackStatus({
      packId: "opendevbrowser-shopping",
      allowsEnvLimited: true,
      docOnly: false
    }, [lane]);

    expect(lane.status).toBe("pass");
    expect(lane.observedExternalConstraintCount).toBe(6);
    expect(derived.status).toBe("pass");
    expect(derived.externalConstraints).toEqual([]);
    expect(derived.observedExternalConstraints).toEqual([
      expect.objectContaining({
        id: "provider-direct",
        constraintCount: 6,
        envLimitedCount: 6,
        expectedTimeoutCount: 0
      })
    ]);
  });

  it("keeps pure env-limited lanes as blocking external constraints", () => {
    const lane = summarizeJsonLane("live-regression", "Live regression", {
      ok: true,
      counts: {
        pass: 0,
        fail: 0,
        env_limited: 1,
        expected_timeout: 2,
        skipped: 0
      },
      out: "artifacts/live-regression.json"
    });

    const derived = derivePackStatus({
      packId: "opendevbrowser-design-agent",
      allowsEnvLimited: true,
      docOnly: false
    }, [lane]);

    expect(lane.status).toBe("env_limited");
    expect(derived.status).toBe("env_limited");
    expect(derived.externalConstraints).toEqual([
      expect.objectContaining({
        id: "live-regression",
        constraintCount: 3,
        envLimitedCount: 1,
        expectedTimeoutCount: 2
      })
    ]);
    expect(derived.observedExternalConstraints).toEqual([]);
  });
});
