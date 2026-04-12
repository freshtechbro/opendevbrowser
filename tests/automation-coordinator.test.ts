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

const expectDesktopFailure = (
  value: unknown,
  code: DesktopFailureCode,
  auditId: string,
  message: string
) => {
  expect(value).toMatchObject({
    ok: false,
    code,
    message,
    audit: {
      auditId
    }
  });
};

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
    expect(observation).not.toHaveProperty("windowsFailure");
    expect(observation).not.toHaveProperty("activeWindow");
    expect(observation).not.toHaveProperty("activeWindowFailure");
    expect(observation).not.toHaveProperty("capture");
    expect(observation).not.toHaveProperty("captureFailure");
    expect(observation).not.toHaveProperty("accessibility");
    expect(observation).not.toHaveProperty("accessibilityFailure");
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

  it("surfaces desktop capture failure details when the sibling runtime returns a failure", async () => {
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
    expectDesktopFailure(
      observation.captureFailure,
      "desktop_capture_failed",
      "desktop-capture-failure",
      "capture failed"
    );
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

  it("surfaces active-window capture failures when no active window can be resolved", async () => {
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
    expectDesktopFailure(
      observation.captureFailure,
      "desktop_window_not_found",
      "missing-active-window",
      "Requested desktop window could not be resolved."
    );
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
    expectDesktopFailure(
      observation.captureFailure,
      "desktop_window_not_found",
      "preloaded-missing-active",
      "Requested desktop window could not be resolved."
    );
  });

  it("uses the preloaded active window and surfaces capture failures when window capture fails", async () => {
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
    expectDesktopFailure(
      observation.captureFailure,
      "desktop_capture_failed",
      "active-window-capture-failed",
      "capture failed"
    );
  });

  it("surfaces active-window capture failures when the active window lookup fails", async () => {
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
    expectDesktopFailure(
      observation.activeWindowFailure,
      "desktop_query_failed",
      "active-window-failed",
      "active window lookup failed"
    );
    expect(observation).not.toHaveProperty("capture");
    expectDesktopFailure(
      observation.captureFailure,
      "desktop_query_failed",
      "active-window-failed",
      "active window lookup failed"
    );
  });

  it("surfaces hinted-window capture failures when no target hint is provided", async () => {
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
    expectDesktopFailure(
      observation.captureFailure,
      "desktop_window_not_found",
      "windows",
      "Requested desktop window could not be resolved."
    );
  });

  it("surfaces hinted-window capture failures when no matching window exists", async () => {
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
    expectDesktopFailure(
      observation.captureFailure,
      "desktop_window_not_found",
      "windows",
      "Requested desktop window could not be resolved."
    );
  });

  it("surfaces hinted-window capture failures when the capture attempt fails", async () => {
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
    expectDesktopFailure(
      observation.captureFailure,
      "desktop_capture_failed",
      "hinted-capture-failed",
      "capture failed"
    );
  });

  it("surfaces hinted-window capture failures when window discovery fails", async () => {
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
    expectDesktopFailure(
      observation.windowsFailure,
      "desktop_query_failed",
      "window-query-failed",
      "query failed"
    );
    expect(observation).not.toHaveProperty("capture");
    expectDesktopFailure(
      observation.captureFailure,
      "desktop_query_failed",
      "window-query-failed",
      "query failed"
    );
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
    expectDesktopFailure(
      observation.windowsFailure,
      "desktop_query_failed",
      "preloaded-window-query-failed",
      "query failed"
    );
    expect(observation).not.toHaveProperty("capture");
    expectDesktopFailure(
      observation.captureFailure,
      "desktop_query_failed",
      "preloaded-window-query-failed",
      "query failed"
    );
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

  it("surfaces accessibility failures when no active window can be resolved", async () => {
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
    expectDesktopFailure(
      observation.accessibilityFailure,
      "desktop_window_not_found",
      "missing-active-window-accessibility",
      "Requested desktop window could not be resolved."
    );
  });

  it("surfaces active-window accessibility lookup failures without preloaded active-window state", async () => {
    const { createAutomationCoordinator } = await import("../src/automation/coordinator");
    const activeWindow = vi.fn(async () =>
      failResult<DesktopWindowSummary | null>(
        "desktop_query_failed",
        "active window lookup failed",
        "active-window-accessibility-query-failed"
      )
    );
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
      reason: "active-window-accessibility-query-failed",
      accessibility: "active_window"
    });

    expect(activeWindow).toHaveBeenCalledWith("active-window-accessibility-query-failed");
    expect(accessibilitySnapshot).not.toHaveBeenCalled();
    expect(observation).not.toHaveProperty("accessibility");
    expectDesktopFailure(
      observation.accessibilityFailure,
      "desktop_query_failed",
      "active-window-accessibility-query-failed",
      "active window lookup failed"
    );
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

  it("surfaces accessibility failures when the sibling runtime accessibility lookup fails", async () => {
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
    expectDesktopFailure(
      observation.accessibilityFailure,
      "desktop_accessibility_unavailable",
      "ax-failed",
      "accessibility unavailable"
    );
  });

  it("surfaces hinted-window accessibility failures when no matching window exists", async () => {
    const { createAutomationCoordinator } = await import("../src/automation/coordinator");
    const accessibilitySnapshot = vi.fn();
    const desktopRuntime = makeDesktopRuntime({ accessibilitySnapshot });
    const coordinator = createAutomationCoordinator({
      manager: {} as BrowserManagerLike,
      desktopRuntime
    });

    const observation = await coordinator.requestDesktopObservation({
      reason: "hinted-window-accessibility-missing",
      targetWindowHint: {
        ownerName: "Google Chrome",
        title: "Missing Title"
      },
      accessibility: "hinted_window"
    });

    expect(desktopRuntime.listWindows).toHaveBeenCalledWith("hinted-window-accessibility-missing");
    expect(accessibilitySnapshot).not.toHaveBeenCalled();
    expect(observation).not.toHaveProperty("accessibility");
    expectDesktopFailure(
      observation.accessibilityFailure,
      "desktop_window_not_found",
      "windows",
      "Requested desktop window could not be resolved."
    );
  });

  it("surfaces hinted-window accessibility failures when window discovery fails", async () => {
    const { createAutomationCoordinator } = await import("../src/automation/coordinator");
    const listWindows = vi.fn(async () =>
      failResult<{ windows: DesktopWindowSummary[] }>(
        "desktop_query_failed",
        "query failed",
        "hinted-accessibility-query-failed"
      )
    );
    const accessibilitySnapshot = vi.fn();
    const desktopRuntime = makeDesktopRuntime({
      listWindows,
      accessibilitySnapshot
    });
    const coordinator = createAutomationCoordinator({
      manager: {} as BrowserManagerLike,
      desktopRuntime
    });

    const observation = await coordinator.requestDesktopObservation({
      reason: "hinted-window-accessibility-query-failed",
      targetWindowHint: {
        ownerName: "Google Chrome",
        title: "ChatGPT"
      },
      accessibility: "hinted_window"
    });

    expect(listWindows).toHaveBeenCalledWith("hinted-window-accessibility-query-failed");
    expect(accessibilitySnapshot).not.toHaveBeenCalled();
    expect(observation).not.toHaveProperty("accessibility");
    expectDesktopFailure(
      observation.windowsFailure,
      "desktop_query_failed",
      "hinted-accessibility-query-failed",
      "query failed"
    );
    expectDesktopFailure(
      observation.accessibilityFailure,
      "desktop_query_failed",
      "hinted-accessibility-query-failed",
      "query failed"
    );
  });

  it("preserves window-list probe failures when windows are explicitly requested", async () => {
    const { createAutomationCoordinator } = await import("../src/automation/coordinator");
    const listWindows = vi.fn(async () =>
      failResult<{ windows: DesktopWindowSummary[] }>(
        "desktop_query_failed",
        "window list failed",
        "window-list-failed"
      )
    );
    const desktopRuntime = makeDesktopRuntime({ listWindows });
    const coordinator = createAutomationCoordinator({
      manager: {} as BrowserManagerLike,
      desktopRuntime
    });

    const observation = await coordinator.requestDesktopObservation({
      reason: "window-list-failed",
      includeWindows: true,
      capture: "none"
    });

    expect(observation).not.toHaveProperty("windows");
    expectDesktopFailure(
      observation.windowsFailure,
      "desktop_query_failed",
      "window-list-failed",
      "window list failed"
    );
  });

  it("preserves active-window probe failures when active-window inspection is explicitly requested", async () => {
    const { createAutomationCoordinator } = await import("../src/automation/coordinator");
    const activeWindow = vi.fn(async () =>
      failResult<DesktopWindowSummary | null>(
        "desktop_query_failed",
        "active window failed",
        "active-window-probe-failed"
      )
    );
    const desktopRuntime = makeDesktopRuntime({ activeWindow });
    const coordinator = createAutomationCoordinator({
      manager: {} as BrowserManagerLike,
      desktopRuntime
    });

    const observation = await coordinator.requestDesktopObservation({
      reason: "active-window-probe-failed",
      includeActiveWindow: true,
      capture: "none"
    });

    expect(observation).not.toHaveProperty("activeWindow");
    expectDesktopFailure(
      observation.activeWindowFailure,
      "desktop_query_failed",
      "active-window-probe-failed",
      "active window failed"
    );
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
