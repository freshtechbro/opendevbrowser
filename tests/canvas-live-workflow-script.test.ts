import { describe, expect, it } from "vitest";
import {
  DISCONNECT_TIMEOUT_MS,
  DISCONNECT_WRAPPER_TIMEOUT_MS,
  getSurfaceConfig,
  parseArgs
} from "../scripts/canvas-live-workflow.mjs";

describe("canvas-live-workflow script", () => {
  it("requires a known surface", () => {
    expect(() => parseArgs(["--surface", "unknown"])).toThrow(
      "Unknown --surface value: unknown"
    );
  });

  it("parses a valid surface and default artifact path", () => {
    const parsed = parseArgs(["--surface", "extension"]);

    expect(parsed.surface).toBe("extension");
    expect(parsed.out).toContain("/tmp/odb-canvas-extension-hero-");
  });

  it("uses temporary managed profiles for direct live workflow surfaces", () => {
    const managedHeadless = getSurfaceConfig("managed-headless");
    const managedHeaded = getSurfaceConfig("managed-headed");

    expect(managedHeadless?.launchArgs).toContain("--persist-profile");
    expect(managedHeadless?.launchArgs).toContain("false");
    expect(managedHeaded?.launchArgs).toContain("--persist-profile");
    expect(managedHeaded?.launchArgs).toContain("false");
  });

  it("keeps managed disconnect wrapper timeout above the CLI close-browser timeout", () => {
    const managedHeadless = getSurfaceConfig("managed-headless");
    const managedHeaded = getSurfaceConfig("managed-headed");
    const extension = getSurfaceConfig("extension");
    const cdp = getSurfaceConfig("cdp");

    expect(managedHeadless?.closeBrowser).toBe(true);
    expect(managedHeaded?.closeBrowser).toBe(true);
    expect(extension?.closeBrowser).toBe(false);
    expect(cdp?.closeBrowser).toBe(false);
    expect(DISCONNECT_TIMEOUT_MS).toBe(120_000);
    expect(DISCONNECT_WRAPPER_TIMEOUT_MS).toBeGreaterThan(DISCONNECT_TIMEOUT_MS);
  });
});
