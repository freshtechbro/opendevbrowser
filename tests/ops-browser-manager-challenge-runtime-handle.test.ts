import { describe, expect, it, vi } from "vitest";
import { OpsBrowserManager } from "../src/browser/ops-browser-manager";
import { resolveConfig } from "../src/config";

describe("ops browser manager challenge runtime handle", () => {
  it("delegates every challenge handle call and always clears suppression state", async () => {
    const manager = new OpsBrowserManager({ setChallengeOrchestrator: vi.fn() } as never, resolveConfig({}));
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
    await handle.status("session-ops");
    await handle.goto("session-ops", "https://example.com/login", "domcontentloaded", 1000, undefined, "tab-1");
    await handle.waitForLoad("session-ops", "networkidle", 1000, "tab-1");
    await handle.snapshot("session-ops", "actionables", 2000, undefined, "tab-1");
    await handle.click("session-ops", "r1", "tab-1");
    await expect(handle.hover("session-ops", "r1", "tab-1")).rejects.toThrow("hover failed");
    await handle.press("session-ops", "Tab", undefined, "tab-1");
    await handle.type("session-ops", "r2", "value", true, false, "tab-1");
    await handle.select("session-ops", "r3", ["ca"], "tab-1");
    await handle.scroll("session-ops", 300, undefined, "tab-1");
    await handle.pointerMove("session-ops", 10, 20, "tab-1", 4);
    await handle.pointerDown("session-ops", 10, 20, "tab-1", "left", 1);
    await handle.pointerUp("session-ops", 10, 20, "tab-1", "left", 1);
    await handle.drag("session-ops", { x: 0, y: 0 }, { x: 5, y: 5 }, "tab-1", 3);
    await handle.cookieList("session-ops", ["https://example.com"]);
    await handle.cookieImport("session-ops", [{ name: "sid", value: "1", url: "https://example.com" }], true);
    await handle.debugTraceSnapshot("session-ops", { max: 10 });

    expect(status).toHaveBeenCalledWith("session-ops");
    expect(goto).toHaveBeenCalledWith("session-ops", "https://example.com/login", "domcontentloaded", 1000, undefined, "tab-1");
    expect(waitForLoad).toHaveBeenCalledWith("session-ops", "networkidle", 1000, "tab-1");
    expect(snapshot).toHaveBeenCalledWith("session-ops", "actionables", 2000, undefined, "tab-1");
    expect(click).toHaveBeenCalledWith("session-ops", "r1", "tab-1");
    expect(type).toHaveBeenCalledWith("session-ops", "r2", "value", true, false, "tab-1");
    expect(select).toHaveBeenCalledWith("session-ops", "r3", ["ca"], "tab-1");
    expect(scroll).toHaveBeenCalledWith("session-ops", 300, undefined, "tab-1");
    expect(pointerMove).toHaveBeenCalledWith("session-ops", 10, 20, "tab-1", 4);
    expect(pointerDown).toHaveBeenCalledWith("session-ops", 10, 20, "tab-1", "left", 1);
    expect(pointerUp).toHaveBeenCalledWith("session-ops", 10, 20, "tab-1", "left", 1);
    expect(drag).toHaveBeenCalledWith("session-ops", { x: 0, y: 0 }, { x: 5, y: 5 }, "tab-1", 3);
    expect(cookieList).toHaveBeenCalledWith("session-ops", ["https://example.com"]);
    expect(cookieImport).toHaveBeenCalledWith("session-ops", [{ name: "sid", value: "1", url: "https://example.com" }], true);
    expect(debugTraceSnapshot).toHaveBeenCalledWith("session-ops", { max: 10 });
    expect((manager as unknown as { isChallengeAutomationSuppressed: (sessionId: string) => boolean }).isChallengeAutomationSuppressed("session-ops")).toBe(false);
  });
});
