import { describe, expect, it, vi } from "vitest";
import { BrowserManager } from "../src/browser/browser-manager";
import { resolveConfig } from "../src/config";

describe("browser manager challenge runtime handle", () => {
  it("delegates every challenge handle call and always clears suppression state", async () => {
    const manager = new BrowserManager("/tmp/project", resolveConfig({}));
    const managerAny = manager as unknown as Record<string, ReturnType<typeof vi.fn> | ((sessionId: string) => boolean)>;
    const status = vi.fn(async () => ({ mode: "extension", activeTargetId: "tab-1", url: "https://example.com", title: "Example" }));
    const goto = vi.fn(async () => ({ timingMs: 1 }));
    const waitForLoad = vi.fn(async () => ({ timingMs: 1 }));
    const snapshot = vi.fn(async () => ({ content: "[r1] button \"Continue\"", warnings: [] }));
    const click = vi.fn(async () => ({ timingMs: 1, navigated: false }));
    const hover = vi.fn(async () => {
      throw new Error("hover failed");
    });
    const press = vi.fn(async () => ({ timingMs: 1 }));
    const type = vi.fn(async () => ({ timingMs: 1 }));
    const select = vi.fn(async () => undefined);
    const scroll = vi.fn(async () => undefined);
    const pointerMove = vi.fn(async () => ({ timingMs: 1 }));
    const pointerDown = vi.fn(async () => ({ timingMs: 1 }));
    const pointerUp = vi.fn(async () => ({ timingMs: 1 }));
    const drag = vi.fn(async () => ({ timingMs: 1 }));
    const cookieList = vi.fn(async () => ({ count: 2 }));
    const cookieImport = vi.fn(async () => ({ imported: 1, rejected: [] }));
    const debugTraceSnapshot = vi.fn(async () => ({ channels: { console: { events: [] }, network: { events: [] }, exception: { events: [] } } }));

    Object.assign(managerAny, {
      status,
      goto,
      waitForLoad,
      snapshot,
      click,
      hover,
      press,
      type,
      select,
      scroll,
      pointerMove,
      pointerDown,
      pointerUp,
      drag,
      cookieList,
      cookieImport,
      debugTraceSnapshot
    });

    const handle = manager.createChallengeRuntimeHandle();
    await handle.status("session-1");
    await handle.goto("session-1", "https://example.com/login", "domcontentloaded", 1000, undefined, "tab-1");
    await handle.waitForLoad("session-1", "networkidle", 1000, "tab-1");
    await handle.snapshot("session-1", "actionables", 2000, undefined, "tab-1");
    await handle.click("session-1", "r1", "tab-1");
    await expect(handle.hover("session-1", "r1", "tab-1")).rejects.toThrow("hover failed");
    await handle.press("session-1", "Tab", undefined, "tab-1");
    await handle.type("session-1", "r2", "value", true, false, "tab-1");
    await handle.select("session-1", "r3", ["ca"], "tab-1");
    await handle.scroll("session-1", 300, undefined, "tab-1");
    await handle.pointerMove("session-1", 10, 20, "tab-1", 4);
    await handle.pointerDown("session-1", 10, 20, "tab-1", "left", 1);
    await handle.pointerUp("session-1", 10, 20, "tab-1", "left", 1);
    await handle.drag("session-1", { x: 0, y: 0 }, { x: 5, y: 5 }, "tab-1", 3);
    await handle.cookieList("session-1", ["https://example.com"]);
    await handle.cookieImport("session-1", [{ name: "sid", value: "1", url: "https://example.com" }], true);
    await handle.debugTraceSnapshot("session-1", { max: 10 });

    expect(status).toHaveBeenCalledWith("session-1");
    expect(goto).toHaveBeenCalledWith("session-1", "https://example.com/login", "domcontentloaded", 1000, undefined, "tab-1");
    expect(waitForLoad).toHaveBeenCalledWith("session-1", "networkidle", 1000, "tab-1");
    expect(snapshot).toHaveBeenCalledWith("session-1", "actionables", 2000, undefined, "tab-1");
    expect(click).toHaveBeenCalledWith("session-1", "r1", "tab-1");
    expect(type).toHaveBeenCalledWith("session-1", "r2", "value", true, false, "tab-1");
    expect(select).toHaveBeenCalledWith("session-1", "r3", ["ca"], "tab-1");
    expect(scroll).toHaveBeenCalledWith("session-1", 300, undefined, "tab-1");
    expect(pointerMove).toHaveBeenCalledWith("session-1", 10, 20, "tab-1", 4);
    expect(pointerDown).toHaveBeenCalledWith("session-1", 10, 20, "tab-1", "left", 1);
    expect(pointerUp).toHaveBeenCalledWith("session-1", 10, 20, "tab-1", "left", 1);
    expect(drag).toHaveBeenCalledWith("session-1", { x: 0, y: 0 }, { x: 5, y: 5 }, "tab-1", 3);
    expect(cookieList).toHaveBeenCalledWith("session-1", ["https://example.com"]);
    expect(cookieImport).toHaveBeenCalledWith("session-1", [{ name: "sid", value: "1", url: "https://example.com" }], true);
    expect(debugTraceSnapshot).toHaveBeenCalledWith("session-1", { max: 10 });
    expect((manager as unknown as { isChallengeAutomationSuppressed: (sessionId: string) => boolean }).isChallengeAutomationSuppressed("session-1")).toBe(false);
  });
});
