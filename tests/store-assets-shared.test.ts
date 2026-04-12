import { describe, expect, it } from "vitest";
import {
  STORE_ASSET_SPECS,
  requiredStoreAssetSpecs,
  scoreExtensionCaptureCandidate,
  sortExtensionCaptureCandidates
} from "../scripts/store-assets-shared.mjs";

describe("store asset shared helpers", () => {
  it("keeps the required compliance screenshots explicit and leaves canvas optional", () => {
    expect(requiredStoreAssetSpecs().map((spec) => spec.filename)).toEqual([
      "icon-store-128.png",
      "promo-small-440x280.png",
      "promo-marquee-1400x560.png",
      "screenshot-automation-demo.png",
      "screenshot-popup-connected.png",
      "screenshot-popup-disconnected.png"
    ]);
    expect(STORE_ASSET_SPECS.find((spec) => spec.filename === "screenshot-canvas.png")?.required).toBe(false);
  });

  it("scores Chrome for Testing and Chromium ahead of stable Chrome", () => {
    expect(scoreExtensionCaptureCandidate("")).toBe(0);
    expect(scoreExtensionCaptureCandidate("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")).toBe(2);
    expect(scoreExtensionCaptureCandidate("/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary")).toBe(3);
    expect(
      scoreExtensionCaptureCandidate(
        "/Users/test/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
      )
    ).toBe(4);
    expect(scoreExtensionCaptureCandidate("/Applications/Chromium.app/Contents/MacOS/Chromium")).toBe(4);
    expect(scoreExtensionCaptureCandidate("/tmp/custom-browser")).toBe(1);
  });

  it("sorts preferred extension capture browsers first", () => {
    const sorted = sortExtensionCaptureCandidates([
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/tmp/custom-browser",
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
      "/Users/test/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
    ]);

    expect(sorted[0]).toContain("Google Chrome for Testing");
    expect(sorted[1]).toContain("Chrome Canary");
    expect(sorted.at(-1)).toBe("/tmp/custom-browser");
  });
});
