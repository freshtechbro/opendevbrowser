import { describe, expect, it } from "vitest";
import {
  classifyWorkflowFailure,
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

  it("classifies restricted-url preview failures as env-limited only for extension-backed surfaces", () => {
    const detail = "[restricted_url] Active tab uses a restricted URL scheme. Focus a normal http(s) tab and retry.";

    expect(classifyWorkflowFailure("extension", detail)).toEqual({
      status: "env_limited",
      detail
    });
    expect(classifyWorkflowFailure("cdp", detail)).toEqual({
      status: "env_limited",
      detail
    });
    expect(classifyWorkflowFailure("managed-headless", detail)).toEqual({
      status: "fail",
      detail
    });
  });

  it("uses tighter bounded retries for the direct cdp canvas surface", () => {
    const cdp = getSurfaceConfig("cdp");

    expect(cdp?.connectAttempts).toBe(2);
    expect(cdp?.connectTimeoutMs).toBe(45_000);
    expect(cdp?.gotoTimeoutMs).toBe(30_000);
    expect(cdp?.statusTimeoutMs).toBe(15_000);
  });
});
