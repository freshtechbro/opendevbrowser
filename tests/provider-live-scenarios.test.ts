import { describe, expect, it } from "vitest";
import {
  buildProviderCoverageSummary,
  expectedProviderIdsFromSource,
  scenarioProviderIds,
  shoppingProvidersForMode,
  socialPlatformsForMode
} from "../scripts/provider-live-scenarios.mjs";

describe("provider-live-scenarios", () => {
  it("loads expected provider ids from source", () => {
    const expected = expectedProviderIdsFromSource();
    expect(expected.web).toEqual(["web/default"]);
    expect(expected.community).toEqual(["community/default"]);
    expect(expected.social).toContain("social/youtube");
    expect(expected.shopping).toContain("shopping/amazon");
    expect(expected.shopping).toContain("shopping/costco");
    expect(expected.all.length).toBeGreaterThan(10);
  });

  it("applies smoke/full provider selections", () => {
    expect(socialPlatformsForMode(true)).toEqual(["x", "facebook", "linkedin", "instagram", "youtube"]);
    expect(socialPlatformsForMode(false)).toContain("reddit");
    expect(shoppingProvidersForMode(true)).toEqual(["shopping/amazon", "shopping/costco"]);
    expect(shoppingProvidersForMode(false)).toContain("shopping/bestbuy");
  });

  it("excludes gated shopping providers in non-release mode by default", () => {
    const scenarios = scenarioProviderIds({
      smoke: false,
      runAuthGated: false,
      runHighFriction: false,
      releaseGate: false
    });

    expect(scenarios.shopping).not.toContain("shopping/costco");
    expect(scenarios.shopping).not.toContain("shopping/macys");
    expect(scenarios.shopping).not.toContain("shopping/bestbuy");
  });

  it("ensures full provider coverage in release-gate mode", () => {
    const summary = buildProviderCoverageSummary({
      smoke: false,
      runAuthGated: true,
      runHighFriction: true,
      releaseGate: true
    });

    expect(summary.ok).toBe(true);
    expect(summary.missingProviderIds).toEqual([]);
    expect(summary.scenarios.all).toContain("shopping/costco");
    expect(summary.scenarios.all).toContain("shopping/bestbuy");
    expect(summary.scenarios.all).toContain("social/reddit");
  });
});
