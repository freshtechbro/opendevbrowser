import { describe, expect, it } from "vitest";
import {
  CDP_CODE_SYNC_STEP_TIMEOUT_MS,
  CDP_LONG_STEP_TIMEOUT_MS,
  CDP_PARENT_WATCHDOG_MS,
  CDP_TEARDOWN_RESERVE_MS,
  classifyWorkflowFailure,
  DISCONNECT_TIMEOUT_MS,
  DISCONNECT_WRAPPER_TIMEOUT_MS,
  GENERATION_PLAN,
  getSurfaceConfig,
  parseArgs,
  resolveCanvasWorkflowTargetId,
  shouldCreateCanvasWorkflowTarget,
  resolveWorkflowTimeout
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

  it("keeps the live workflow generation plan aligned to the current canvas contract", () => {
    expect(GENERATION_PLAN).toEqual({
      targetOutcome: {
        mode: "high-fi-live-edit",
        summary: "Validate the current /canvas workflow against a real hero scenario."
      },
      visualDirection: {
        profile: "clean-room",
        themeStrategy: "single-theme"
      },
      layoutStrategy: {
        approach: "hero-led-grid",
        navigationModel: "global-header"
      },
      contentStrategy: {
        source: "document-context"
      },
      componentStrategy: {
        mode: "reuse-first",
        interactionStates: ["default", "hover", "focus", "disabled"]
      },
      motionPosture: {
        level: "subtle",
        reducedMotion: "respect-user-preference"
      },
      responsivePosture: {
        primaryViewport: "desktop",
        requiredViewports: ["desktop", "tablet", "mobile"]
      },
      accessibilityPosture: {
        target: "WCAG_2_2_AA",
        keyboardNavigation: "full"
      },
      validationTargets: {
        blockOn: ["contrast-failure", "responsive-mismatch"],
        requiredThemes: ["light"],
        browserValidation: "required",
        maxInteractionLatencyMs: 180
      }
    });
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

  it("keeps enough parent watchdog budget for late cdp export, save, close, and disconnect cleanup", () => {
    expect(CDP_PARENT_WATCHDOG_MS).toBe(420_000);
    expect(CDP_PARENT_WATCHDOG_MS).toBeGreaterThan(
      CDP_CODE_SYNC_STEP_TIMEOUT_MS + (4 * CDP_LONG_STEP_TIMEOUT_MS) + CDP_TEARDOWN_RESERVE_MS
    );
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

  it("uses startUrl-based connect setup for the direct cdp canvas surface", () => {
    const cdp = getSurfaceConfig("cdp");

    expect(cdp?.connectArgs).toContain("--start-url");
    expect(cdp?.connectArgs).toContain("https://example.com/?canvas-cdp-preview=1");
    expect(cdp?.connectAttempts).toBe(2);
    expect(cdp?.connectTimeoutMs).toBe(45_000);
    expect(cdp?.statusTimeoutMs).toBe(15_000);
  });

  it("keeps managed targets unchanged when no reseed is required", () => {
    expect(resolveCanvasWorkflowTargetId({
      surface: "managed-headed",
      capturedTargetId: "tab-managed",
      activeTargetId: "tab-fresh",
      targets: [{ targetId: "tab-fresh" }]
    })).toBe("tab-managed");
  });

  it("prefers the refreshed active target for extension-backed surfaces", () => {
    expect(resolveCanvasWorkflowTargetId({
      surface: "extension",
      capturedTargetId: "tab-stale",
      activeTargetId: "tab-live",
      targets: [{ targetId: "tab-live" }, { targetId: "tab-other" }]
    })).toBe("tab-live");
  });

  it("falls back to the captured target when it still survives target sync", () => {
    expect(resolveCanvasWorkflowTargetId({
      surface: "cdp",
      capturedTargetId: "tab-captured",
      activeTargetId: null,
      targets: [{ targetId: "tab-captured" }, { targetId: "tab-other" }]
    })).toBe("tab-captured");
  });

  it("falls back to the first surviving target when the captured target is gone", () => {
    expect(resolveCanvasWorkflowTargetId({
      surface: "extension",
      capturedTargetId: "tab-stale",
      activeTargetId: null,
      targets: [{ targetId: "tab-1" }, { targetId: "tab-2" }]
    })).toBe("tab-1");
  });

  it("can keep the captured target when a step must stay pinned to it", () => {
    expect(resolveCanvasWorkflowTargetId({
      surface: "extension",
      capturedTargetId: "tab-mounted",
      activeTargetId: "tab-active",
      targets: [{ targetId: "tab-active" }, { targetId: "tab-mounted" }],
      preferCaptured: true
    })).toBe("tab-mounted");
  });

  it("returns null when no surviving extension target remains", () => {
    expect(resolveCanvasWorkflowTargetId({
      surface: "cdp",
      capturedTargetId: "tab-stale",
      activeTargetId: null,
      targets: []
    })).toBeNull();
  });

  it("only allows empty-target recovery for the cdp surface when a create URL exists", () => {
    expect(shouldCreateCanvasWorkflowTarget({
      surface: "cdp",
      targetId: null,
      createUrl: "https://example.com"
    })).toBe(true);
    expect(shouldCreateCanvasWorkflowTarget({
      surface: "extension",
      targetId: null,
      createUrl: "https://example.com"
    })).toBe(false);
    expect(shouldCreateCanvasWorkflowTarget({
      surface: "cdp",
      targetId: "tab-live",
      createUrl: "https://example.com"
    })).toBe(false);
  });

  it("keeps cdp long-running steps inside the parent watchdog budget", () => {
    expect(resolveWorkflowTimeout({
      surface: "extension",
      startedAtMs: 0,
      requestedTimeoutMs: 300_000,
      stepName: "preview.render",
      currentTimeMs: 0
    })).toBe(300_000);

    expect(resolveWorkflowTimeout({
      surface: "cdp",
      startedAtMs: 0,
      requestedTimeoutMs: 300_000,
      stepName: "preview.render",
      currentTimeMs: 0
    })).toBe(CDP_LONG_STEP_TIMEOUT_MS);

    expect(resolveWorkflowTimeout({
      surface: "cdp",
      startedAtMs: 0,
      requestedTimeoutMs: 300_000,
      stepName: "code.push",
      currentTimeMs: 0
    })).toBe(CDP_CODE_SYNC_STEP_TIMEOUT_MS);

    expect(resolveWorkflowTimeout({
      surface: "cdp",
      startedAtMs: 0,
      requestedTimeoutMs: 300_000,
      stepName: "document.patch.code",
      currentTimeMs: 0
    })).toBe(CDP_CODE_SYNC_STEP_TIMEOUT_MS);

    expect(resolveWorkflowTimeout({
      surface: "cdp",
      startedAtMs: 0,
      requestedTimeoutMs: 300_000,
      stepName: "code.push",
      currentTimeMs: CDP_PARENT_WATCHDOG_MS - CDP_TEARDOWN_RESERVE_MS - 12_000
    })).toBe(12_000);

    expect(() => resolveWorkflowTimeout({
      surface: "cdp",
      startedAtMs: 0,
      requestedTimeoutMs: 300_000,
      stepName: "disconnect",
      currentTimeMs: CDP_PARENT_WATCHDOG_MS - CDP_TEARDOWN_RESERVE_MS - 4_000
    })).toThrow("CDP workflow budget exhausted before disconnect.");
  });
});
