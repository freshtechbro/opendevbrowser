import { describe, expect, it, vi } from "vitest";
import { RemoteDesktopRuntime } from "../src/cli/remote-desktop-runtime";

describe("RemoteDesktopRuntime", () => {
  it("maps desktop runtime methods onto daemon commands", async () => {
    const call = vi.fn()
      .mockResolvedValueOnce({ available: true })
      .mockResolvedValueOnce({ ok: true, value: { windows: [] } })
      .mockResolvedValueOnce({ ok: true, value: null })
      .mockResolvedValueOnce({ ok: true, value: { capture: { path: "/tmp/desktop.png" } } })
      .mockResolvedValueOnce({ ok: true, value: { capture: { path: "/tmp/window.png" } } })
      .mockResolvedValueOnce({ ok: true, value: { tree: { role: "AXWindow", children: [] } } });

    const runtime = new RemoteDesktopRuntime({ call } as never);

    await runtime.status();
    await runtime.listWindows("list");
    await runtime.activeWindow("active");
    await runtime.captureDesktop({ reason: "desktop" });
    await runtime.captureWindow("window-1", { reason: "window" });
    await runtime.accessibilitySnapshot("accessibility", "window-1");

    expect(call).toHaveBeenNthCalledWith(1, "desktop.status");
    expect(call).toHaveBeenNthCalledWith(2, "desktop.windows.list", { reason: "list" });
    expect(call).toHaveBeenNthCalledWith(3, "desktop.window.active", { reason: "active" });
    expect(call).toHaveBeenNthCalledWith(4, "desktop.capture.desktop", { reason: "desktop" });
    expect(call).toHaveBeenNthCalledWith(5, "desktop.capture.window", {
      windowId: "window-1",
      reason: "window"
    });
    expect(call).toHaveBeenNthCalledWith(6, "desktop.accessibility.snapshot", {
      reason: "accessibility",
      windowId: "window-1"
    });
  });
});
