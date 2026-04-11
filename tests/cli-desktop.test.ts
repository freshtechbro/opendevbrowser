import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedArgs } from "../src/cli/args";
import { runDesktopStatus } from "../src/cli/commands/desktop/status";
import { runDesktopWindows } from "../src/cli/commands/desktop/windows";
import { runDesktopActiveWindow } from "../src/cli/commands/desktop/active-window";
import { runDesktopCaptureDesktop } from "../src/cli/commands/desktop/capture-desktop";
import { runDesktopCaptureWindow } from "../src/cli/commands/desktop/capture-window";
import { runDesktopAccessibilitySnapshot } from "../src/cli/commands/desktop/accessibility-snapshot";
import { DEFAULT_SCREENSHOT_TRANSPORT_TIMEOUT_MS } from "../src/cli/transport-timeouts";

const { callDaemon } = vi.hoisted(() => ({
  callDaemon: vi.fn()
}));

vi.mock("../src/cli/client", () => ({
  callDaemon
}));

const makeArgs = (command: ParsedArgs["command"], rawArgs: string[]): ParsedArgs => ({
  command,
  mode: undefined,
  withConfig: false,
  noPrompt: false,
  noInteractive: false,
  quiet: false,
  outputFormat: "json",
  transport: "relay",
  skillsMode: "global",
  fullInstall: false,
  rawArgs
});

describe("desktop CLI commands", () => {
  beforeEach(() => {
    callDaemon.mockReset();
  });

  it("forwards desktop status and optional list reasons", async () => {
    callDaemon
      .mockResolvedValueOnce({ available: false, permissionLevel: "off" })
      .mockResolvedValueOnce({ ok: true, value: { windows: [] } });

    await expect(runDesktopStatus(makeArgs("desktop-status", []))).resolves.toEqual({
      success: true,
      message: "Desktop status captured.",
      data: { available: false, permissionLevel: "off" }
    });
    await expect(runDesktopWindows(makeArgs("desktop-windows", ["--reason", "inventory", "--timeout-ms", "45000"]))).resolves.toEqual({
      success: true,
      message: "Desktop windows listed.",
      data: { ok: true, value: { windows: [] } }
    });

    expect(callDaemon).toHaveBeenNthCalledWith(1, "desktop.status", {}, {
      timeoutMs: DEFAULT_SCREENSHOT_TRANSPORT_TIMEOUT_MS
    });
    expect(callDaemon).toHaveBeenNthCalledWith(2, "desktop.windows.list", {
      reason: "inventory"
    }, {
      timeoutMs: 45000
    });
  });

  it("forwards active window and accessibility snapshot commands", async () => {
    callDaemon
      .mockResolvedValueOnce({ ok: true, value: null })
      .mockResolvedValueOnce({ ok: true, value: { tree: { role: "AXWindow", children: [] } } });

    await runDesktopActiveWindow(makeArgs("desktop-active-window", ["--reason=active-window"]));
    await runDesktopAccessibilitySnapshot(makeArgs("desktop-accessibility-snapshot", [
      "--reason",
      "accessibility",
      "--window-id",
      "window-1"
    ]));

    expect(callDaemon).toHaveBeenNthCalledWith(1, "desktop.window.active", {
      reason: "active-window"
    }, {
      timeoutMs: DEFAULT_SCREENSHOT_TRANSPORT_TIMEOUT_MS
    });
    expect(callDaemon).toHaveBeenNthCalledWith(2, "desktop.accessibility.snapshot", {
      reason: "accessibility",
      windowId: "window-1"
    }, {
      timeoutMs: DEFAULT_SCREENSHOT_TRANSPORT_TIMEOUT_MS
    });
  });

  it("requires reason-gated desktop capture flags", async () => {
    await expect(runDesktopCaptureDesktop(makeArgs("desktop-capture-desktop", []))).rejects.toThrow("Missing --reason");
    await expect(runDesktopCaptureWindow(makeArgs("desktop-capture-window", ["--reason", "capture"]))).rejects.toThrow("Missing --window-id");
    await expect(runDesktopCaptureWindow(makeArgs("desktop-capture-window", ["--window-id", "window-1"]))).rejects.toThrow("Missing --reason");
  });

  it("forwards desktop capture commands", async () => {
    callDaemon
      .mockResolvedValueOnce({ ok: true, value: { capture: { path: "/tmp/desktop.png" } } })
      .mockResolvedValueOnce({ ok: true, value: { capture: { path: "/tmp/window.png" } } });

    await runDesktopCaptureDesktop(makeArgs("desktop-capture-desktop", ["--reason", "desktop-capture"]));
    await runDesktopCaptureWindow(makeArgs("desktop-capture-window", [
      "--window-id",
      "window-1",
      "--reason",
      "window-capture",
      "--timeout-ms",
      "60000"
    ]));

    expect(callDaemon).toHaveBeenNthCalledWith(1, "desktop.capture.desktop", {
      reason: "desktop-capture"
    }, {
      timeoutMs: DEFAULT_SCREENSHOT_TRANSPORT_TIMEOUT_MS
    });
    expect(callDaemon).toHaveBeenNthCalledWith(2, "desktop.capture.window", {
      windowId: "window-1",
      reason: "window-capture"
    }, {
      timeoutMs: 60000
    });
  });
});
