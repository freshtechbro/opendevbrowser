import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserManagerLike, BrowserReviewResult } from "../src/browser/manager-types";
import type {
  DesktopAccessibilityValue,
  DesktopCaptureValue,
  DesktopFailureCode,
  DesktopResult,
  DesktopRuntimeLike,
  DesktopRuntimeStatus,
  DesktopWindowSummary
} from "../src/desktop";

const buildBrowserReviewResult = vi.fn();

vi.mock("../src/browser/review-surface", () => ({
  buildBrowserReviewResult
}));

const desktopStatus: DesktopRuntimeStatus = {
  platform: "darwin",
  permissionLevel: "observe",
  available: true,
  capabilities: [
    "observe.windows",
    "observe.screen",
    "observe.window",
    "observe.accessibility"
  ],
  auditArtifactsDir: "/tmp/desktop-audit"
};

const unavailableDesktopStatus: DesktopRuntimeStatus = {
  ...desktopStatus,
  available: false,
  reason: "desktop_permission_denied",
  capabilities: []
};

const primaryWindow: DesktopWindowSummary = {
  id: "window-alpha",
  ownerName: "Google Chrome",
  ownerPid: 100,
  title: "ChatGPT",
  bounds: { x: 0, y: 0, width: 1280, height: 900 },
  layer: 0,
  alpha: 1,
  isOnscreen: true
};

const secondaryWindow: DesktopWindowSummary = {
  id: "window-beta",
  ownerName: "Codex",
  ownerPid: 101,
  title: "Codex",
  bounds: { x: 32, y: 32, width: 1100, height: 800 },
  layer: 0,
  alpha: 1,
  isOnscreen: true
};

const windowList: DesktopWindowSummary[] = [primaryWindow, secondaryWindow];

const makeAudit = (auditId: string, artifactPaths: string[] = []) => ({
  auditId,
  at: "2026-04-07T00:00:00.000Z",
  recordPath: `/tmp/${auditId}.json`,
  artifactPaths
});

const okResult = <T>(value: T, auditId: string, artifactPaths: string[] = []): DesktopResult<T> => ({
  ok: true,
  value,
  audit: makeAudit(auditId, artifactPaths)
});

const failResult = <T>(
  code: DesktopFailureCode,
  message: string,
  auditId: string
): DesktopResult<T> => ({
  ok: false,
  code,
  message,
  audit: makeAudit(auditId)
});

const makeDesktopCapture = (capturePath: string): DesktopCaptureValue => ({
  capture: { path: capturePath, mimeType: "image/png" }
});

const makeAccessibilitySnapshot = (
  window: DesktopWindowSummary = primaryWindow
): DesktopAccessibilityValue => ({
  window,
  tree: { role: "AXWindow", children: [] }
});

const makeDesktopRuntime = (overrides: Partial<DesktopRuntimeLike> = {}): DesktopRuntimeLike => ({
  status: vi.fn(async () => desktopStatus),
  listWindows: vi.fn(async () => okResult({ windows: windowList }, "windows")),
  activeWindow: vi.fn(async () => okResult(primaryWindow, "active")),
  captureDesktop: vi.fn(async () => okResult(makeDesktopCapture("/tmp/desktop.png"), "desktop", ["/tmp/desktop.png"])),
  captureWindow: vi.fn(async (windowId: string) => {
    const matchedWindow = windowList.find((entry) => entry.id === windowId) ?? primaryWindow;
    return okResult(
      {
        capture: { path: `/tmp/${windowId}.png`, mimeType: "image/png" },
        window: matchedWindow
      },
      "window",
        [`/tmp/${windowId}.png`]
      );
  }),
  accessibilitySnapshot: vi.fn(async () => okResult(makeAccessibilitySnapshot(), "ax")),
  ...overrides
});

describe("automation coordinator", () => {
  beforeEach(() => {
    buildBrowserReviewResult.mockReset();
  });

  it("reports desktop availability from the sibling runtime", async () => {
    const { createAutomationCoordinator } = await import("../src/automation/coordinator");
    const desktopRuntime = makeDesktopRuntime();
    const coordinator = createAutomationCoordinator({
      manager: {} as BrowserManagerLike,
      desktopRuntime
    });

    await expect(coordinator.desktopAvailable()).resolves.toBe(true);
  });

  it("reports unavailable desktop status as false", async () => {
    const { createAutomationCoordinator } = await import("../src/automation/coordinator");
    const desktopRuntime = makeDesktopRuntime({
      status: vi.fn(async () => unavailableDesktopStatus)
    });
    const coordinator = createAutomationCoordinator({
      manager: {} as BrowserManagerLike,
      desktopRuntime
    });

    await expect(coordinator.desktopAvailable()).resolves.toBe(false);
  });

  it("returns a minimal observation envelope when no observation work is requested", async () => {
    const { createAutomationCoordinator } = await import("../src/automation/coordinator");
    const desktopRuntime = makeDesktopRuntime();
    const coordinator = createAutomationCoordinator({
      manager: {} as BrowserManagerLike,
      desktopRuntime
    });

    const observation = await coordinator.requestDesktopObservation({
      reason: "minimal-observation",
      browserSessionId: "session-1",
      capture: "none"
    });

    expect(observation).toMatchObject({
      browserSessionId: "session-1",
      status: desktopStatus
    });
    expect(observation).not.toHaveProperty("windows");
    expect(observation).not.toHaveProperty("activeWindow");
    expect(observation).not.toHaveProperty("capture");
    expect(desktopRuntime.listWindows).not.toHaveBeenCalled();
    expect(desktopRuntime.activeWindow).not.toHaveBeenCalled();
    expect(desktopRuntime.captureDesktop).not.toHaveBeenCalled();
    expect(desktopRuntime.captureWindow).not.toHaveBeenCalled();
  });

  it("captures the full desktop when requested", async () => {
    const { createAutomationCoordinator } = await import("../src/automation/coordinator");
    const captureDesktop = vi.fn(async () =>
      okResult(makeDesktopCapture("/tmp/full-desktop.png"), "desktop-capture", ["/tmp/full-desktop.png"])
    );
    const desktopRuntime = makeDesktopRuntime({ captureDesktop });
    const coordinator = createAutomationCoordinator({
      manager: {} as BrowserManagerLike,
      desktopRuntime
    });

    const observation = await coordinator.requestDesktopObservation({
      reason: "capture-desktop",
      capture: "desktop"
    });

    expect(captureDesktop).toHaveBeenCalledWith({ reason: "capture-desktop" });
    expect(observation.capture).toMatchObject({
      capture: {
        path: "/tmp/full-desktop.png"
      }
    });
  });

  it("omits desktop capture when the sibling runtime returns a failure", async () => {
    const { createAutomationCoordinator } = await import("../src/automation/coordinator");
    const captureDesktop = vi.fn(async () =>
      failResult<DesktopCaptureValue>("desktop_capture_failed", "capture failed", "desktop-capture-failure")
    );
    const desktopRuntime = makeDesktopRuntime({ captureDesktop });
    const coordinator = createAutomationCoordinator({
      manager: {} as BrowserManagerLike,
      desktopRuntime
    });

    const observation = await coordinator.requestDesktopObservation({
      reason: "capture-desktop-failure",
      capture: "desktop"
    });

    expect(captureDesktop).toHaveBeenCalledWith({ reason: "capture-desktop-failure" });
    expect(observation).not.toHaveProperty("capture");
  });

  it("falls back to an active window lookup when active-window capture was not preloaded", async () => {
    const { createAutomationCoordinator } = await import("../src/automation/coordinator");
    const activeWindow = vi.fn(async () => okResult(secondaryWindow, "active-window-fallback"));
    const captureWindow = vi.fn(async (windowId: string) =>
      okResult(
        {
          capture: { path: `/tmp/${windowId}.png`, mimeType: "image/png" },
          window: secondaryWindow
        },
        "active-window-capture",
        [`/tmp/${windowId}.png`]
      )
    );
    const desktopRuntime = makeDesktopRuntime({
      activeWindow,
      captureWindow
    });
    const coordinator = createAutomationCoordinator({
      manager: {} as BrowserManagerLike,
      desktopRuntime
    });

    const observation = await coordinator.requestDesktopObservation({
      reason: "capture-active-window",
      capture: "active_window"
    });

    expect(activeWindow).toHaveBeenCalledWith("capture-active-window");
    expect(captureWindow).toHaveBeenCalledWith("window-beta", {
      reason: "capture-active-window"
    });
    expect(observation.capture).toMatchObject({
      capture: {
        path: "/tmp/window-beta.png"
      }
    });
  });

  it("omits active-window capture when no active window can be resolved", async () => {
    const { createAutomationCoordinator } = await import("../src/automation/coordinator");
    const activeWindow = vi.fn(async () => okResult<DesktopWindowSummary | null>(null, "missing-active-window"));
    const captureWindow = vi.fn();
    const desktopRuntime = makeDesktopRuntime({
      activeWindow,
      captureWindow
    });
    const coordinator = createAutomationCoordinator({
      manager: {} as BrowserManagerLike,
      desktopRuntime
    });

    const observation = await coordinator.requestDesktopObservation({
      reason: "capture-active-window-missing",
      capture: "active_window"
    });

    expect(activeWindow).toHaveBeenCalledWith("capture-active-window-missing");
    expect(captureWindow).not.toHaveBeenCalled();
    expect(observation).not.toHaveProperty("capture");
  });

  it("reuses a preloaded null active-window result without retrying the desktop runtime", async () => {
    const { createAutomationCoordinator } = await import("../src/automation/coordinator");
    const activeWindow = vi.fn(async () => okResult<DesktopWindowSummary | null>(null, "preloaded-missing-active"));
    const captureWindow = vi.fn();
    const desktopRuntime = makeDesktopRuntime({
      activeWindow,
      captureWindow
    });
    const coordinator = createAutomationCoordinator({
      manager: {} as BrowserManagerLike,
      desktopRuntime
    });

    const observation = await coordinator.requestDesktopObservation({
      reason: "capture-active-window-preloaded-missing",
      capture: "active_window",
      includeActiveWindow: true
    });

    expect(activeWindow).toHaveBeenCalledTimes(1);
    expect(captureWindow).not.toHaveBeenCalled();
    expect(observation).toMatchObject({
      activeWindow: null
    });
    expect(observation).not.toHaveProperty("capture");
  });

  it("uses the preloaded active window and omits capture when window capture fails", async () => {
    const { createAutomationCoordinator } = await import("../src/automation/coordinator");
    const activeWindow = vi.fn(async () => okResult(secondaryWindow, "preloaded-active-window"));
    const captureWindow = vi.fn(async () =>
      failResult<DesktopCaptureValue>("desktop_capture_failed", "capture failed", "active-window-capture-failed")
    );
    const desktopRuntime = makeDesktopRuntime({
      activeWindow,
      captureWindow
    });
    const coordinator = createAutomationCoordinator({
      manager: {} as BrowserManagerLike,
      desktopRuntime
    });

    const observation = await coordinator.requestDesktopObservation({
      reason: "capture-active-window-preloaded",
      capture: "active_window",
      includeActiveWindow: true
    });

    expect(activeWindow).toHaveBeenCalledTimes(1);
    expect(captureWindow).toHaveBeenCalledWith("window-beta", {
      reason: "capture-active-window-preloaded"
    });
    expect(observation.activeWindow).toEqual(secondaryWindow);
    expect(observation).not.toHaveProperty("capture");
  });

  it("omits active-window capture when the active window lookup fails", async () => {
    const { createAutomationCoordinator } = await import("../src/automation/coordinator");
    const activeWindow = vi.fn(async () =>
      failResult<DesktopWindowSummary | null>(
        "desktop_query_failed",
        "active window lookup failed",
        "active-window-failed"
      )
    );
    const captureWindow = vi.fn();
    const desktopRuntime = makeDesktopRuntime({
      activeWindow,
      captureWindow
    });
    const coordinator = createAutomationCoordinator({
      manager: {} as BrowserManagerLike,
      desktopRuntime
    });

    const observation = await coordinator.requestDesktopObservation({
      reason: "capture-active-window-failed",
      capture: "active_window",
      includeActiveWindow: true
    });

    expect(activeWindow).toHaveBeenCalledWith("capture-active-window-failed");
    expect(captureWindow).not.toHaveBeenCalled();
    expect(observation).not.toHaveProperty("activeWindow");
    expect(observation).not.toHaveProperty("capture");
  });

  it("omits hinted-window capture when no target hint is provided", async () => {
    const { createAutomationCoordinator } = await import("../src/automation/coordinator");
    const captureWindow = vi.fn();
    const desktopRuntime = makeDesktopRuntime({ captureWindow });
    const coordinator = createAutomationCoordinator({
      manager: {} as BrowserManagerLike,
      desktopRuntime
    });

    const observation = await coordinator.requestDesktopObservation({
      reason: "missing-hint",
      capture: "hinted_window"
    });

    expect(desktopRuntime.listWindows).toHaveBeenCalledWith("missing-hint");
    expect(captureWindow).not.toHaveBeenCalled();
    expect(observation.windows).toEqual(windowList);
    expect(observation).not.toHaveProperty("capture");
  });

  it("omits hinted-window capture when no matching window exists", async () => {
    const { createAutomationCoordinator } = await import("../src/automation/coordinator");
    const captureWindow = vi.fn();
    const desktopRuntime = makeDesktopRuntime({ captureWindow });
    const coordinator = createAutomationCoordinator({
      manager: {} as BrowserManagerLike,
      desktopRuntime
    });

    const observation = await coordinator.requestDesktopObservation({
      reason: "hint-miss",
      targetWindowHint: {
        ownerName: "Google Chrome",
        title: "Different Title"
      },
      capture: "hinted_window"
    });

    expect(desktopRuntime.listWindows).toHaveBeenCalledWith("hint-miss");
    expect(captureWindow).not.toHaveBeenCalled();
    expect(observation.windows).toEqual(windowList);
    expect(observation).not.toHaveProperty("capture");
  });

  it("omits hinted-window capture when the capture attempt fails", async () => {
    const { createAutomationCoordinator } = await import("../src/automation/coordinator");
    const captureWindow = vi.fn(async () =>
      failResult<DesktopCaptureValue>("desktop_capture_failed", "capture failed", "hinted-capture-failed")
    );
    const desktopRuntime = makeDesktopRuntime({ captureWindow });
    const coordinator = createAutomationCoordinator({
      manager: {} as BrowserManagerLike,
      desktopRuntime
    });

    const observation = await coordinator.requestDesktopObservation({
      reason: "hint-capture-failure",
      targetWindowHint: {
        ownerName: "   ",
        title: "ChatGPT"
      },
      capture: "hinted_window"
    });

    expect(captureWindow).toHaveBeenCalledWith("window-alpha", {
      reason: "hint-capture-failure"
    });
    expect(observation.windows).toEqual(windowList);
    expect(observation).not.toHaveProperty("capture");
  });

  it("omits hinted-window capture when window discovery fails", async () => {
    const { createAutomationCoordinator } = await import("../src/automation/coordinator");
    const listWindows = vi.fn(async () =>
      failResult<{ windows: DesktopWindowSummary[] }>("desktop_query_failed", "query failed", "window-query-failed")
    );
    const captureWindow = vi.fn();
    const desktopRuntime = makeDesktopRuntime({
      listWindows,
      captureWindow
    });
    const coordinator = createAutomationCoordinator({
      manager: {} as BrowserManagerLike,
      desktopRuntime
    });

    const observation = await coordinator.requestDesktopObservation({
      reason: "hint-query-failed",
      targetWindowHint: {
        ownerName: "Google Chrome",
        title: "ChatGPT"
      },
      capture: "hinted_window"
    });

    expect(listWindows).toHaveBeenCalledWith("hint-query-failed");
    expect(captureWindow).not.toHaveBeenCalled();
    expect(observation).not.toHaveProperty("windows");
    expect(observation).not.toHaveProperty("capture");
  });

  it("reuses a preloaded failed window list without retrying hinted capture discovery", async () => {
    const { createAutomationCoordinator } = await import("../src/automation/coordinator");
    const listWindows = vi.fn(async () =>
      failResult<{ windows: DesktopWindowSummary[] }>(
        "desktop_query_failed",
        "query failed",
        "preloaded-window-query-failed"
      )
    );
    const captureWindow = vi.fn();
    const desktopRuntime = makeDesktopRuntime({
      listWindows,
      captureWindow
    });
    const coordinator = createAutomationCoordinator({
      manager: {} as BrowserManagerLike,
      desktopRuntime
    });

    const observation = await coordinator.requestDesktopObservation({
      reason: "hint-preloaded-query-failed",
      targetWindowHint: {
        ownerName: "Google Chrome",
        title: "ChatGPT"
      },
      capture: "hinted_window",
      includeWindows: true
    });

    expect(listWindows).toHaveBeenCalledTimes(1);
    expect(captureWindow).not.toHaveBeenCalled();
    expect(observation).not.toHaveProperty("windows");
    expect(observation).not.toHaveProperty("capture");
  });

  it("routes hinted window capture through the desktop runtime without touching browser truth", async () => {
    const { createAutomationCoordinator } = await import("../src/automation/coordinator");
    const listWindows = vi.fn(async () => okResult({ windows: windowList }, "hinted-windows"));
    const captureWindow = vi.fn(async (windowId: string) =>
      okResult(
        {
          capture: { path: `/tmp/${windowId}.png`, mimeType: "image/png" },
          window: primaryWindow
        },
        "hinted-capture",
        [`/tmp/${windowId}.png`]
      )
    );
    const desktopRuntime = makeDesktopRuntime({
      listWindows,
      captureWindow
    });
    const coordinator = createAutomationCoordinator({
      manager: {} as BrowserManagerLike,
      desktopRuntime
    });

    const observation = await coordinator.requestDesktopObservation({
      reason: "hinted-window-capture",
      targetWindowHint: {
        ownerName: "Google Chrome",
        title: "ChatGPT"
      },
      capture: "hinted_window",
      includeWindows: true
    });

    expect(listWindows).toHaveBeenCalledWith("hinted-window-capture");
    expect(captureWindow).toHaveBeenCalledWith("window-alpha", {
      reason: "hinted-window-capture"
    });
    expect(observation).toMatchObject({
      status: desktopStatus,
      capture: {
        capture: {
          path: "/tmp/window-alpha.png"
        }
      }
    });
    expect(observation.windows).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "window-alpha" })])
    );
  });

  it("returns active-window accessibility when requested", async () => {
    const { createAutomationCoordinator } = await import("../src/automation/coordinator");
    const activeWindow = vi.fn(async () => okResult(secondaryWindow, "active-window-accessibility"));
    const accessibilitySnapshot = vi.fn(async (_reason: string, windowId?: string) =>
      okResult(makeAccessibilitySnapshot(windowId === "window-beta" ? secondaryWindow : primaryWindow), "ax-active")
    );
    const desktopRuntime = makeDesktopRuntime({
      activeWindow,
      accessibilitySnapshot
    });
    const coordinator = createAutomationCoordinator({
      manager: {} as BrowserManagerLike,
      desktopRuntime
    });

    const observation = await coordinator.requestDesktopObservation({
      reason: "active-window-accessibility",
      accessibility: "active_window",
      includeActiveWindow: true
    });

    expect(activeWindow).toHaveBeenCalledTimes(1);
    expect(accessibilitySnapshot).toHaveBeenCalledWith("active-window-accessibility", "window-beta");
    expect(observation).toMatchObject({
      activeWindow: secondaryWindow,
      accessibility: {
        window: secondaryWindow,
        tree: { role: "AXWindow", children: [] }
      }
    });
  });

  it("omits accessibility when no active window can be resolved", async () => {
    const { createAutomationCoordinator } = await import("../src/automation/coordinator");
    const activeWindow = vi.fn(async () => okResult<DesktopWindowSummary | null>(null, "missing-active-window-accessibility"));
    const accessibilitySnapshot = vi.fn();
    const desktopRuntime = makeDesktopRuntime({
      activeWindow,
      accessibilitySnapshot
    });
    const coordinator = createAutomationCoordinator({
      manager: {} as BrowserManagerLike,
      desktopRuntime
    });

    const observation = await coordinator.requestDesktopObservation({
      reason: "missing-active-window-accessibility",
      accessibility: "active_window"
    });

    expect(activeWindow).toHaveBeenCalledWith("missing-active-window-accessibility");
    expect(accessibilitySnapshot).not.toHaveBeenCalled();
    expect(observation).not.toHaveProperty("accessibility");
  });

  it("routes hinted-window accessibility through sibling runtime window discovery", async () => {
    const { createAutomationCoordinator } = await import("../src/automation/coordinator");
    const listWindows = vi.fn(async () => okResult({ windows: windowList }, "hinted-accessibility-windows"));
    const accessibilitySnapshot = vi.fn(async (_reason: string, windowId?: string) =>
      okResult(makeAccessibilitySnapshot(windowId === "window-alpha" ? primaryWindow : secondaryWindow), "ax-hinted")
    );
    const desktopRuntime = makeDesktopRuntime({
      listWindows,
      accessibilitySnapshot
    });
    const coordinator = createAutomationCoordinator({
      manager: {} as BrowserManagerLike,
      desktopRuntime
    });

    const observation = await coordinator.requestDesktopObservation({
      reason: "hinted-window-accessibility",
      targetWindowHint: {
        ownerName: "Google Chrome",
        title: "ChatGPT"
      },
      accessibility: "hinted_window",
      includeWindows: true
    });

    expect(listWindows).toHaveBeenCalledTimes(1);
    expect(accessibilitySnapshot).toHaveBeenCalledWith("hinted-window-accessibility", "window-alpha");
    expect(observation.windows).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "window-alpha" })])
    );
    expect(observation.accessibility).toMatchObject({
      window: primaryWindow,
      tree: { role: "AXWindow", children: [] }
    });
  });

  it("omits accessibility when the sibling runtime accessibility lookup fails", async () => {
    const { createAutomationCoordinator } = await import("../src/automation/coordinator");
    const accessibilitySnapshot = vi.fn(async () =>
      failResult<DesktopAccessibilityValue>(
        "desktop_accessibility_unavailable",
        "accessibility unavailable",
        "ax-failed"
      )
    );
    const desktopRuntime = makeDesktopRuntime({
      accessibilitySnapshot
    });
    const coordinator = createAutomationCoordinator({
      manager: {} as BrowserManagerLike,
      desktopRuntime
    });

    const observation = await coordinator.requestDesktopObservation({
      reason: "active-window-accessibility-failed",
      accessibility: "active_window"
    });

    expect(accessibilitySnapshot).toHaveBeenCalledWith("active-window-accessibility-failed", "window-alpha");
    expect(observation).not.toHaveProperty("accessibility");
  });

  it("returns browser-owned verification after desktop observation", async () => {
    const { createAutomationCoordinator } = await import("../src/automation/coordinator");
    const review: BrowserReviewResult = {
      sessionId: "session-1",
      targetId: null,
      mode: "managed",
      snapshotId: "snapshot-1",
      content: "review content",
      truncated: false,
      refCount: 1,
      timingMs: 5
    };
    buildBrowserReviewResult.mockResolvedValue(review);
    const manager = {} as BrowserManagerLike;
    const desktopRuntime = makeDesktopRuntime();
    const coordinator = createAutomationCoordinator({
      manager,
      desktopRuntime
    });

    const verification = await coordinator.verifyAfterDesktopObservation({
      browserSessionId: "session-1",
      targetId: "target-1",
      observationId: "observation-1",
      maxChars: 1200,
      cursor: "cursor-1"
    });

    expect(buildBrowserReviewResult).toHaveBeenCalledWith({
      manager,
      sessionId: "session-1",
      targetId: "target-1",
      maxChars: 1200,
      cursor: "cursor-1"
    });
    expect(verification).toMatchObject({
      observationId: "observation-1",
      review
    });
  });
});
