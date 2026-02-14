import { describe, expect, it, vi } from "vitest";
import { createCanaryState, pushCanarySample } from "../src/browser/fingerprint/canary";
import { evaluateTier1Coherence, formatTier1Warnings } from "../src/browser/fingerprint/tier1-coherence";

describe("fingerprint tier1 coherence", () => {
  it("returns ok when checks are disabled", () => {
    const result = evaluateTier1Coherence(
      {
        enabled: false,
        warnOnly: true,
        expectedLanguages: [],
        requireProxy: false,
        geolocationRequired: false
      },
      {
        languages: []
      }
    );

    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("flags locale/timezone/language mismatches", () => {
    const result = evaluateTier1Coherence(
      {
        enabled: true,
        warnOnly: true,
        expectedLocale: "en-US",
        expectedTimezone: "America/New_York",
        expectedLanguages: ["en-US"],
        requireProxy: true,
        geolocationRequired: true
      },
      {
        locale: "fr-FR",
        timezone: "Europe/Paris",
        languages: ["fr-FR"],
        proxy: undefined,
        geolocation: undefined
      }
    );

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "locale_mismatch",
      "timezone_mismatch",
      "language_mismatch",
      "proxy_missing",
      "geolocation_missing"
    ]));
    const warnings = formatTier1Warnings(result);
    expect(warnings[0]).toContain("[fingerprint:tier1]");
  });

  it("accepts coherent locale/language/timezone combos", () => {
    const result = evaluateTier1Coherence(
      {
        enabled: true,
        warnOnly: true,
        expectedLocale: "en-US",
        expectedTimezone: "America/New_York",
        expectedLanguages: ["en-US"],
        requireProxy: false,
        geolocationRequired: false
      },
      {
        locale: "en-US",
        timezone: "America/New_York",
        languages: ["en-US"],
        proxy: "http://proxy.local",
        geolocation: {
          latitude: 40.7128,
          longitude: -74.006,
          accuracy: 50
        }
      }
    );

    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("accepts documented locale/timezone region pairs", () => {
    const pairs = [
      { locale: "de-DE", timezone: "Europe/Berlin", language: "de-DE" },
      { locale: "jp-JP", timezone: "Asia/Tokyo", language: "jp-JP" },
      { locale: "cn-CN", timezone: "Asia/Shanghai", language: "cn-CN" },
      { locale: "in-IN", timezone: "Asia/Kolkata", language: "in-IN" },
      { locale: "au-AU", timezone: "Australia/Sydney", language: "au-AU" }
    ];

    for (const pair of pairs) {
      const result = evaluateTier1Coherence(
        {
          enabled: true,
          warnOnly: true,
          expectedLanguages: [],
          requireProxy: false,
          geolocationRequired: false
        },
        {
          locale: pair.locale,
          timezone: pair.timezone,
          languages: [pair.language]
        }
      );

      expect(result.ok).toBe(true);
      expect(result.issues).toEqual([]);
    }
  });

  it("flags locale/language and locale/timezone incoherence branches", () => {
    const result = evaluateTier1Coherence(
      {
        enabled: true,
        warnOnly: true,
        expectedLanguages: [],
        requireProxy: false,
        geolocationRequired: false
      },
      {
        locale: "en-US",
        timezone: "Europe/Paris",
        languages: ["fr-FR"]
      }
    );

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "locale_language_incoherent",
      "locale_timezone_incoherent"
    ]));
  });

  it("covers locale/timezone parsing edges and mapped compatibility branches", () => {
    const baseConfig = {
      enabled: true,
      warnOnly: true,
      expectedLanguages: [],
      requireProxy: false,
      geolocationRequired: false
    };

    const noRegion = evaluateTier1Coherence(baseConfig, {
      locale: "en",
      timezone: "/Paris",
      languages: ["en"]
    });
    expect(noRegion.ok).toBe(true);
    expect(noRegion.issues).toEqual([]);

    const caUs = evaluateTier1Coherence(baseConfig, {
      locale: "en-CA",
      timezone: "America/Toronto",
      languages: ["en-CA"]
    });
    expect(caUs.ok).toBe(true);

    const gbEu = evaluateTier1Coherence(baseConfig, {
      locale: "en-GB",
      timezone: "Europe/London",
      languages: ["en-GB"]
    });
    expect(gbEu.ok).toBe(true);
  });

  it("treats missing locale/timezone as non-blocking and formats no warnings", () => {
    const result = evaluateTier1Coherence(
      {
        enabled: true,
        warnOnly: true,
        expectedLanguages: [],
        requireProxy: false,
        geolocationRequired: false
      },
      {
        languages: []
      }
    );

    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
    expect(formatTier1Warnings(result)).toEqual([]);
  });

  it("covers canary promote/rollback and min-samples guard", () => {
    const promote = pushCanarySample(
      createCanaryState(0),
      {
        windowSize: 2,
        minSamples: 1,
        promoteThreshold: 80,
        rollbackThreshold: 20
      },
      {
        ts: 1700000000000,
        score: 95,
        success: true,
        reason: "healthy"
      }
    );
    expect(promote.action).toBe("promote");
    expect(promote.state.level).toBe(1);

    const first = pushCanarySample(
      createCanaryState(1),
      {
        windowSize: 2,
        minSamples: 2,
        promoteThreshold: 95,
        rollbackThreshold: 30
      },
      {
        ts: 1700000001000,
        score: 20,
        success: false,
        reason: "dip"
      }
    );
    expect(first.action).toBe("none");
    expect(first.state.level).toBe(1);

    const rollback = pushCanarySample(
      first.state,
      {
        windowSize: 2,
        minSamples: 2,
        promoteThreshold: 95,
        rollbackThreshold: 30
      },
      {
        ts: 1700000002000,
        score: 0,
        success: false,
        reason: "critical"
      }
    );
    expect(rollback.action).toBe("rollback");
    expect(rollback.state.level).toBe(0);

    const noAction = pushCanarySample(
      createCanaryState(2),
      {
        windowSize: 2,
        minSamples: 1,
        promoteThreshold: 90,
        rollbackThreshold: 10
      },
      {
        ts: 1700000003000,
        score: 50,
        success: true,
        reason: "neutral"
      }
    );
    expect(noAction.action).toBe("none");
    expect(noAction.state.level).toBe(2);
  });

  it("uses default canary average when sample window resolves empty", () => {
    const sliceSpy = vi.spyOn(Array.prototype, "slice").mockReturnValueOnce([]);
    try {
      const result = pushCanarySample(
        createCanaryState(3),
        {
          windowSize: 1,
          minSamples: 1,
          promoteThreshold: 90,
          rollbackThreshold: 10
        },
        {
          ts: 1700000004000,
          score: 20,
          success: false,
          reason: "forced-empty"
        }
      );

      expect(result.action).toBe("none");
      expect(result.state.averageScore).toBe(100);
      expect(result.state.samples).toEqual([]);
    } finally {
      sliceSpy.mockRestore();
    }
  });
});
