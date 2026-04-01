import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpsRuntime } from "../extension/src/ops/ops-runtime";
import { OpsSessionStore } from "../extension/src/ops/ops-session-store";
import { CDPRouter } from "../extension/src/services/CDPRouter";
import { createChromeMock } from "./extension-chrome-mock";

type TabRemovedListener = (tabId: number) => void;
type TabCreatedListener = (tab: chrome.tabs.Tab) => void;
type DebuggerDetachListener = (source: chrome.debugger.Debuggee) => void;
const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const createPopupRuntimeHarness = async (): Promise<{
  mock: ReturnType<typeof createChromeMock>;
  router: CDPRouter;
  runtime: OpsRuntime;
  sent: Array<{ type?: string; requestId?: string; payload?: unknown; error?: { code?: string; retryable?: boolean; message?: string } }>;
  session: ReturnType<OpsSessionStore["getByTabId"]>;
  rootSessionId: string;
}> => {
  const mock = createChromeMock({
    activeTab: {
      id: 101,
      url: "https://example.com/root",
      title: "Root Page",
      groupId: 1,
      status: "complete",
      active: true
    }
  });
  globalThis.chrome = mock.chrome;

  const router = new CDPRouter();
  const routerEvents: Array<{ tabId: number; method: string; params?: unknown; sessionId?: string }> = [];
  router.setCallbacks({ onEvent: vi.fn(), onResponse: vi.fn(), onDetach: vi.fn() });
  router.addEventListener((event) => {
    routerEvents.push(event);
  });

  const sent: Array<{ type?: string; requestId?: string; payload?: unknown; error?: { code?: string; retryable?: boolean; message?: string } }> = [];
  const runtime = new OpsRuntime({
    send: (message) => sent.push(message as { type?: string; requestId?: string; payload?: unknown; error?: { code?: string; retryable?: boolean; message?: string } }),
    cdp: router as never
  });

  runtime.handleMessage({
    type: "ops_request",
    requestId: "req-launch-popup-harness",
    clientId: "client-1",
    command: "session.launch",
    payload: {
      tabId: 101
    }
  });

  const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
  await vi.waitFor(() => {
    expect(sessions.getByTabId(101)).not.toBeNull();
    expect(routerEvents.some((event) => event.method === "Target.attachedToTarget")).toBe(true);
  });

  const session = sessions.getByTabId(101);
  const rootAttachedEvent = routerEvents.find((event) => event.method === "Target.attachedToTarget");
  const rootSessionId = (rootAttachedEvent?.params as { sessionId?: string } | undefined)?.sessionId;
  if (!session || !rootSessionId) {
    throw new Error("Expected popup runtime harness to create a launched root session");
  }

  return { mock, router, runtime, sent, session, rootSessionId };
};

describe("OpsRuntime target teardown", () => {
  const originalChrome = globalThis.chrome;

  let tabRemovedListener: TabRemovedListener | null = null;
  let tabCreatedListener: TabCreatedListener | null = null;
  let debuggerDetachListener: DebuggerDetachListener | null = null;

  beforeEach(() => {
    tabRemovedListener = null;
    tabCreatedListener = null;
    debuggerDetachListener = null;

    globalThis.chrome = {
      runtime: {
        lastError: undefined
      },
      tabs: {
        create: vi.fn(),
        get: vi.fn(async () => null),
        query: vi.fn(async () => []),
        remove: vi.fn((_tabId: number, callback?: () => void) => {
          callback?.();
        }),
        update: vi.fn((_tabId: number, _updateProperties: chrome.tabs.UpdateProperties, callback?: (tab?: chrome.tabs.Tab) => void) => {
          callback?.({
            id: _tabId,
            status: "complete",
            url: "https://example.com/",
            title: "Example Domain"
          } as chrome.tabs.Tab);
        }),
        onRemoved: {
          addListener: vi.fn((listener: TabRemovedListener) => {
            tabRemovedListener = listener;
          }),
          removeListener: vi.fn((listener: TabRemovedListener) => {
            if (tabRemovedListener === listener) {
              tabRemovedListener = null;
            }
          })
        },
        onCreated: {
          addListener: vi.fn((listener: TabCreatedListener) => {
            tabCreatedListener = listener;
          }),
          removeListener: vi.fn((listener: TabCreatedListener) => {
            if (tabCreatedListener === listener) {
              tabCreatedListener = null;
            }
          })
        },
        onUpdated: {
          addListener: vi.fn(),
          removeListener: vi.fn()
        }
      },
      debugger: {
        onEvent: {
          addListener: vi.fn()
        },
        onDetach: {
          addListener: vi.fn((listener: DebuggerDetachListener) => {
            debuggerDetachListener = listener;
          })
        }
      },
      scripting: {
        executeScript: vi.fn()
      }
    } as unknown as typeof chrome;
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.chrome = originalChrome;
    vi.restoreAllMocks();
  });

  it("attaches a replacement target without issuing a manual detach when the router already owns root normalization", async () => {
    const cdp = {
      attach: vi.fn(async () => undefined),
      detachTab: vi.fn(async () => undefined),
      getPrimaryTabId: vi.fn(() => 101)
    };

    const runtime = new OpsRuntime({
      send: () => undefined,
      cdp: cdp as never
    });

    await (runtime as unknown as { attachTargetTab: (tabId: number) => Promise<void> }).attachTargetTab(202);

    expect(cdp.attach).toHaveBeenCalledWith(202);
    expect(cdp.detachTab).not.toHaveBeenCalled();
  });

  it("retries a blocked replacement attach without reattaching the previous root tab", async () => {
    vi.useFakeTimers();
    const cdp = {
      attach: vi.fn()
        .mockRejectedValueOnce(new Error("Not allowed"))
        .mockResolvedValueOnce(undefined),
      detachTab: vi.fn(async () => undefined),
      getPrimaryTabId: vi.fn(() => 101)
    };

    const runtime = new OpsRuntime({
      send: () => undefined,
      cdp: cdp as never
    });

    const attachPromise = (runtime as unknown as { attachTargetTab: (tabId: number) => Promise<void> }).attachTargetTab(202);
    await vi.advanceTimersByTimeAsync(50);
    await attachPromise;

    expect(cdp.attach).toHaveBeenNthCalledWith(1, 202);
    expect(cdp.attach).toHaveBeenNthCalledWith(2, 202);
    expect(cdp.detachTab).not.toHaveBeenCalled();
  });

  it("resolves root targets through the router's live debuggee when one is available", () => {
    const cdp = {
      getTabDebuggee: vi.fn((tabId: number) => (
        tabId === 101
          ? { tabId: 101, targetId: "target-101", attachBy: "targetId" as const }
          : null
      ))
    };

    const runtime = new OpsRuntime({
      send: () => undefined,
      cdp: cdp as never
    });

    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const session = sessions.createSession("client-1", 101, "lease-1", { url: "https://root.example" });

    const resolved = (runtime as unknown as {
      resolveTargetContext: (opsSession: ReturnType<OpsSessionStore["get"]>, targetId: string) => {
        debuggee: chrome.debugger.Debuggee & { sessionId?: string; targetId?: string; attachBy?: "tabId" | "targetId" };
      } | null;
    }).resolveTargetContext(session, session.targetId);

    expect(resolved?.debuggee).toEqual(
      expect.objectContaining({
        tabId: 101,
        targetId: "target-101",
        attachBy: "targetId"
      })
    );
  });

  it("does not teardown the full session when a non-root tab is removed", () => {
    const sent: unknown[] = [];
    const cdp = {
      detachTab: vi.fn(async () => undefined)
    };

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message),
      cdp: cdp as never
    });

    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const session = sessions.createSession("client-1", 101, "lease-1", { url: "https://root.example" });
    sessions.addTarget(session.id, 202, { url: "https://child.example" });

    tabRemovedListener?.(202);

    const updated = sessions.get(session.id);
    expect(updated).not.toBeNull();
    expect(updated?.targets.has("tab-101")).toBe(true);
    expect(updated?.targets.has("tab-202")).toBe(false);
    expect(cdp.detachTab).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });

  it("marks the shared cdp router stale when an ops client disconnects", () => {
    const cdp = {
      detachTab: vi.fn(async () => undefined),
      markClientClosed: vi.fn()
    };

    const runtime = new OpsRuntime({
      send: () => undefined,
      cdp: cdp as never
    });

    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    sessions.createSession("client-1", 101, "lease-1", { url: "https://root.example" });

    runtime.handleMessage({
      type: "ops_event",
      clientId: "client-1",
      event: "ops_client_disconnected",
      payload: { at: Date.now() }
    });

    expect(cdp.markClientClosed).toHaveBeenCalledTimes(1);
  });

  it("tears down the full session when root tab is removed", () => {
    const sent: Array<{ type?: string; event?: string; opsSessionId?: string }> = [];
    const cdp = {
      detachTab: vi.fn(async () => undefined)
    };

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; event?: string; opsSessionId?: string }),
      cdp: cdp as never
    });

    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const session = sessions.createSession("client-1", 101, "lease-1", { url: "https://root.example" });
    sessions.addTarget(session.id, 202, { url: "https://child.example" });

    tabRemovedListener?.(101);

    expect(sessions.get(session.id)).toBeNull();
    expect(cdp.detachTab).toHaveBeenCalledWith(202);
    expect(sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "ops_event", event: "ops_tab_closed", opsSessionId: session.id })
      ])
    );
  });

  it("does not teardown full session when non-root debugger detaches", async () => {
    const sent: unknown[] = [];
    const cdp = {
      detachTab: vi.fn(async () => undefined)
    };

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message),
      cdp: cdp as never
    });

    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const session = sessions.createSession("client-1", 101, "lease-1", { url: "https://root.example" });
    sessions.addTarget(session.id, 202, { url: "https://child.example" });

    debuggerDetachListener?.({ tabId: 202 });
    await flushMicrotasks();

    const updated = sessions.get(session.id);
    expect(updated).not.toBeNull();
    expect(updated?.targets.has("tab-101")).toBe(true);
    expect(updated?.targets.has("tab-202")).toBe(false);
    expect(cdp.detachTab).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });

  it("retains canvas design tabs when their debugger session detaches", async () => {
    const sent: unknown[] = [];
    const cdp = {
      detachTab: vi.fn(async () => undefined)
    };

    globalThis.chrome.runtime.getURL = vi.fn((path: string) => `chrome-extension://test/${path}`);

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message),
      cdp: cdp as never
    });

    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const session = sessions.createSession("client-1", 101, "lease-1", { url: "https://root.example" });
    sessions.addTarget(session.id, 202, { url: "chrome-extension://test/canvas.html", title: "Canvas" });

    debuggerDetachListener?.({ tabId: 202 });
    await flushMicrotasks();

    const updated = sessions.get(session.id);
    expect(updated).not.toBeNull();
    expect(updated?.targets.has("tab-101")).toBe(true);
    expect(updated?.targets.has("tab-202")).toBe(true);
    expect(cdp.detachTab).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });

  it("closes canvas design targets even when tabs.remove never fires its callback", async () => {
    vi.useFakeTimers();

    const sent: Array<{ type?: string; requestId?: string; payload?: unknown }> = [];
    const cdp = {
      detachTab: vi.fn(async () => undefined)
    };

    globalThis.chrome.runtime.getURL = vi.fn((path: string) => `chrome-extension://test/${path}`);
    const getTabMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    let designTabOpen = true;
    getTabMock.mockImplementation(async (tabId: number) => {
      if (tabId === 202) {
        return designTabOpen
          ? { id: 202, url: "chrome-extension://test/canvas.html", title: "Canvas", status: "complete" } as chrome.tabs.Tab
          : null;
      }
      if (tabId === 101) {
        return { id: 101, url: "https://root.example", title: "Root", status: "complete" } as chrome.tabs.Tab;
      }
      return null;
    });
    const removeMock = globalThis.chrome.tabs.remove as unknown as ReturnType<typeof vi.fn>;
    removeMock.mockImplementation((tabId: number, _callback?: () => void) => {
      setTimeout(() => {
        if (tabId === 202) {
          designTabOpen = false;
          tabRemovedListener?.(tabId);
        }
      }, 50);
    });

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; requestId?: string; payload?: unknown }),
      cdp: cdp as never
    });

    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const session = sessions.createSession("client-1", 101, "lease-1", { url: "https://root.example", title: "Root" });
    sessions.addTarget(session.id, 202, { url: "chrome-extension://test/canvas.html", title: "Canvas" });

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-close-canvas",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: "lease-1",
      command: "targets.close",
      payload: {
        targetId: "tab-202"
      }
    });

    await vi.advanceTimersByTimeAsync(120);

    expect(sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "ops_response",
          requestId: "req-close-canvas",
          payload: { ok: true }
        })
      ])
    );
    expect(sessions.get(session.id)?.targets.has("tab-202")).toBe(false);
  });

  it("responds to canvas target close before best-effort tab cleanup settles", async () => {
    vi.useFakeTimers();

    const sent: Array<{ type?: string; requestId?: string; payload?: unknown }> = [];
    const cdp = {
      detachTab: vi.fn(async () => undefined)
    };

    globalThis.chrome.runtime.getURL = vi.fn((path: string) => `chrome-extension://test/${path}`);
    const getTabMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getTabMock.mockImplementation(async (tabId: number) => {
      if (tabId === 202) {
        return { id: 202, url: "chrome-extension://test/canvas.html", title: "Canvas", status: "complete" } as chrome.tabs.Tab;
      }
      if (tabId === 101) {
        return { id: 101, url: "https://root.example", title: "Root", status: "complete" } as chrome.tabs.Tab;
      }
      return null;
    });
    const removeMock = globalThis.chrome.tabs.remove as unknown as ReturnType<typeof vi.fn>;
    removeMock.mockImplementation(() => undefined);

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; requestId?: string; payload?: unknown }),
      cdp: cdp as never
    });

    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const session = sessions.createSession("client-1", 101, "lease-1", { url: "https://root.example", title: "Root" });
    sessions.addTarget(session.id, 202, { url: "chrome-extension://test/canvas.html", title: "Canvas" });

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-close-canvas-prompt",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: "lease-1",
      command: "targets.close",
      payload: {
        targetId: "tab-202"
      }
    });

    await flushMicrotasks();

    expect(sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "ops_response",
          requestId: "req-close-canvas-prompt",
          payload: { ok: true }
        })
      ])
    );
    expect(sessions.get(session.id)?.targets.has("tab-202")).toBe(false);

    await vi.advanceTimersByTimeAsync(5100);
  });

  it("retains canvas design tabs on debugger detach when only the live tab url confirms canvas ownership", async () => {
    const sent: unknown[] = [];
    const cdp = {
      detachTab: vi.fn(async () => undefined)
    };

    globalThis.chrome.runtime.getURL = vi.fn((path: string) => `chrome-extension://test/${path}`);

    const getTabMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getTabMock.mockImplementation(async (tabId: number) => ({
      id: tabId,
      url: tabId === 202 ? "chrome-extension://test/canvas.html" : "https://root.example",
      title: tabId === 202 ? "Canvas" : "Root",
      status: "complete"
    } as chrome.tabs.Tab));

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message),
      cdp: cdp as never
    });

    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const session = sessions.createSession("client-1", 101, "lease-1", { url: "https://root.example" });
    sessions.addTarget(session.id, 202, { title: "Canvas" });

    debuggerDetachListener?.({ tabId: 202 });
    await flushMicrotasks();

    const updated = sessions.get(session.id);
    expect(updated).not.toBeNull();
    expect(updated?.targets.has("tab-101")).toBe(true);
    expect(updated?.targets.has("tab-202")).toBe(true);
    expect(updated?.targets.get("tab-202")).toMatchObject({
      tabId: 202,
      url: "chrome-extension://test/canvas.html",
      title: "Canvas"
    });
    expect(cdp.detachTab).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });

  it("ignores root debugger detach when multiple targets remain", async () => {
    const sent: unknown[] = [];
    const cdp = {
      detachTab: vi.fn(async () => undefined)
    };

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message),
      cdp: cdp as never
    });

    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const session = sessions.createSession("client-1", 101, "lease-1", { url: "https://root.example" });
    sessions.addTarget(session.id, 202, { url: "https://child.example" });
    const getTabMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getTabMock.mockResolvedValue({ id: 101, url: "https://root.example" } as chrome.tabs.Tab);

    debuggerDetachListener?.({ tabId: 101 });
    await flushMicrotasks();

    const updated = sessions.get(session.id);
    expect(updated).not.toBeNull();
    expect(updated?.targets.has("tab-101")).toBe(true);
    expect(updated?.targets.has("tab-202")).toBe(true);
    expect(cdp.detachTab).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });

  it("reattaches a retained target when targets.use selects it after debugger detach", async () => {
    const sent: Array<{ type?: string; requestId?: string; payload?: unknown }> = [];
    const cdp = {
      attach: vi.fn(async () => undefined),
      detachTab: vi.fn(async () => undefined),
      sendCommand: vi.fn(async () => ({}))
    };

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; requestId?: string; payload?: unknown }),
      cdp: cdp as never
    });

    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const session = sessions.createSession("client-1", 101, "lease-1", { url: "https://root.example", title: "Root" });
    sessions.addTarget(session.id, 202, { url: "https://child.example", title: "Child" });
    const getTabMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getTabMock.mockImplementation(async (tabId: number) => ({
      id: tabId,
      url: tabId === 101 ? "https://root.example" : "https://child.example",
      title: tabId === 101 ? "Root" : "Child",
      status: "complete"
    } as chrome.tabs.Tab));

    debuggerDetachListener?.({ tabId: 101 });
    await flushMicrotasks();

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-use-root",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: "lease-1",
      command: "targets.use",
      payload: { targetId: "tab-101" }
    });
    await vi.waitFor(() => {
      expect(cdp.attach).toHaveBeenCalledWith(101);
      expect(cdp.sendCommand).toHaveBeenCalledWith({ tabId: 101 }, "Runtime.enable", {});
      expect(cdp.sendCommand).toHaveBeenCalledWith({ tabId: 101 }, "Network.enable", {});
      expect(cdp.sendCommand).toHaveBeenCalledWith({ tabId: 101 }, "Performance.enable", {});
    });
    expect(sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "ops_response",
          requestId: "req-use-root",
          payload: expect.objectContaining({
            activeTargetId: "tab-101",
            url: "https://root.example",
            title: "Root"
          })
        })
      ])
    );
  });

  it("reports the active target url and title in session.status", async () => {
    const sent: Array<{ type?: string; requestId?: string; payload?: unknown }> = [];
    const cdp = {
      detachTab: vi.fn(async () => undefined)
    };

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; requestId?: string; payload?: unknown }),
      cdp: cdp as never
    });

    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const session = sessions.createSession("client-1", 101, "lease-1", { url: "https://root.example", title: "Root" });
    sessions.addTarget(session.id, 202, {
      url: "chrome-extension://test/canvas.html",
      title: "Canvas"
    });
    session.activeTargetId = "tab-202";

    const getTabMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getTabMock.mockImplementation(async (tabId: number) => ({
      id: tabId,
      url: tabId === 202 ? "chrome-extension://test/canvas.html" : "https://root.example",
      title: tabId === 202 ? "Canvas" : "Root",
      status: "complete"
    } as chrome.tabs.Tab));

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-session-status",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: "lease-1",
      command: "session.status",
      payload: {}
    });
    await flushMicrotasks();

    expect(sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "ops_response",
          requestId: "req-session-status",
          payload: expect.objectContaining({
            activeTargetId: "tab-202",
            url: "chrome-extension://test/canvas.html",
            title: "Canvas",
            leaseId: "lease-1",
            state: "active"
          })
        })
      ])
    );
  });

  it("reclaims an active session when the lease matches on a new ops client id", async () => {
    const sent: Array<{ type?: string; requestId?: string; payload?: unknown }> = [];
    const cdp = {
      detachTab: vi.fn(async () => undefined)
    };

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; requestId?: string; payload?: unknown }),
      cdp: cdp as never
    });

    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const session = sessions.createSession("client-1", 101, "lease-1", { url: "https://root.example", title: "Root" });

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-session-reclaim",
      clientId: "client-2",
      opsSessionId: session.id,
      leaseId: "lease-1",
      command: "session.status",
      payload: {}
    });
    await flushMicrotasks();

    expect(session.ownerClientId).toBe("client-2");
    expect(sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "ops_response",
          requestId: "req-session-reclaim",
          payload: expect.objectContaining({
            activeTargetId: "tab-101",
            leaseId: "lease-1",
            state: "active"
          })
        })
      ])
    );
  });

  it("captures first-class review payloads over the ops surface", async () => {
    const sent: Array<{ type?: string; requestId?: string; payload?: unknown }> = [];
    const cdp = {
      detachTab: vi.fn(async () => undefined),
      sendCommand: vi.fn(async (_debuggee: chrome.debugger.Debuggee, method: string, params?: Record<string, unknown>) => {
        if (method === "Accessibility.enable" || method === "DOM.enable") {
          return {};
        }
        if (method === "Accessibility.getFullAXTree") {
          return {
            nodes: [{
              nodeId: "ax-1",
              backendDOMNodeId: 1,
              role: { value: "button" },
              name: { value: "Review CTA" }
            }]
          };
        }
        if (method === "DOM.resolveNode") {
          return { object: { objectId: "node-1" } };
        }
        if (method === "Runtime.callFunctionOn") {
          const declaration = typeof params?.functionDeclaration === "string"
            ? params.functionDeclaration
            : "";
          if (declaration.includes("querySelectorAll")) {
            return { result: { value: "#review-cta" } };
          }
          return { result: { value: null } };
        }
        return {};
      })
    };

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; requestId?: string; payload?: unknown }),
      cdp: cdp as never
    });

    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const session = sessions.createSession("client-1", 101, "lease-1", {
      url: "https://example.com/review",
      title: "Review Page"
    });

    const getTabMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getTabMock.mockResolvedValue({
      id: 101,
      url: "https://example.com/review",
      title: "Review Page",
      status: "complete"
    } as chrome.tabs.Tab);

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-nav-review",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: "lease-1",
      command: "nav.review",
      payload: {
        maxChars: 4096
      }
    });
    await vi.waitFor(() => {
      expect(cdp.sendCommand).toHaveBeenCalledWith({ tabId: 101 }, "Accessibility.getFullAXTree", {});
    });

    expect(sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "ops_response",
          requestId: "req-nav-review",
          payload: expect.objectContaining({
            sessionId: session.id,
            targetId: "tab-101",
            mode: "extension",
            snapshotId: expect.any(String),
            url: "https://example.com/review",
            title: "Review Page",
            refCount: 1,
            content: expect.stringContaining('Review CTA')
          })
        })
      ])
    );
  });

  it("captures review payloads for the active popup target over the ops surface", async () => {
    const { mock, runtime, sent, session, rootSessionId } = await createPopupRuntimeHarness();
    const sendCommandMock = globalThis.chrome.debugger.sendCommand as unknown as ReturnType<typeof vi.fn>;
    sendCommandMock.mockClear();
    sendCommandMock.mockImplementation((debuggee, method, params, callback) => {
      void debuggee;
      if (method === "Accessibility.enable" || method === "DOM.enable" || method === "Target.setAutoAttach") {
        callback?.({});
        return;
      }
      if (method === "Accessibility.getFullAXTree") {
        callback?.({
          nodes: [{
            nodeId: "ax-popup-1",
            backendDOMNodeId: 2,
            role: { value: "button" },
            name: { value: "Popup CTA" }
          }]
        });
        return;
      }
      if (method === "DOM.resolveNode") {
        callback?.({ object: { objectId: "popup-node-1" } });
        return;
      }
      if (method === "Runtime.callFunctionOn") {
        const declaration = typeof (params as { functionDeclaration?: unknown } | undefined)?.functionDeclaration === "string"
          ? (params as { functionDeclaration: string }).functionDeclaration
          : "";
        if (declaration.includes("querySelectorAll")) {
          callback?.({ result: { value: "#popup-cta" } });
          return;
        }
        callback?.({ result: { value: null } });
        return;
      }
      callback?.({});
    });

    const getTabMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getTabMock.mockImplementation(async (tabId: number) => ({
      id: tabId,
      url: "https://example.com/root",
      title: "Root Page",
      status: "complete"
    } as chrome.tabs.Tab));

    mock.emitDebuggerEvent(
      { sessionId: rootSessionId },
      "Target.targetCreated",
      {
        targetInfo: {
          targetId: "popup-202",
          type: "page",
          url: "https://popup.example.com/challenge",
          title: "Popup Challenge",
          openerId: "tab-101"
        }
      }
    );
    mock.emitDebuggerEvent(
      { sessionId: rootSessionId },
      "Target.attachedToTarget",
      {
        sessionId: "popup-session-202",
        targetInfo: {
          targetId: "popup-202",
          type: "page",
          url: "https://popup.example.com/challenge",
          title: "Popup Challenge",
          openerId: "tab-101"
        },
        waitingForDebugger: false
      }
    );

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-targets-list-popup",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "targets.list",
      payload: {
        includeUrls: true
      }
    });
    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-targets-list-popup",
            payload: expect.objectContaining({
              targets: expect.arrayContaining([
                expect.objectContaining({
                  targetId: "popup-202",
                  url: "https://popup.example.com/challenge",
                  title: "Popup Challenge"
                })
              ])
            })
          })
        ])
      );
    });

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-nav-review-popup",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "nav.review",
      payload: {
        maxChars: 4096
      }
    });
    await vi.waitFor(() => {
      expect(sendCommandMock).toHaveBeenCalledWith(
        { tabId: 101, sessionId: "popup-session-202" },
        "Accessibility.getFullAXTree",
        {},
        expect.any(Function)
      );
    });

    expect(sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "ops_response",
          requestId: "req-nav-review-popup",
          payload: expect.objectContaining({
            sessionId: session.id,
            targetId: "popup-202",
            mode: "extension",
            snapshotId: expect.any(String),
            url: "https://popup.example.com/challenge",
            title: "Popup Challenge",
            refCount: 1,
            content: expect.stringContaining("Popup CTA")
          })
        })
      ])
    );
  });

  it("captures review payloads when the popup child target reuses the real popup target id", async () => {
    const { mock, runtime, sent, session, rootSessionId } = await createPopupRuntimeHarness();
    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    sessions.addTarget(session.id, 202, {
      url: "https://popup.example.com/numeric",
      title: "Popup Numeric",
      openerTargetId: session.targetId
    });
    const sendCommandMock = globalThis.chrome.debugger.sendCommand as unknown as ReturnType<typeof vi.fn>;
    sendCommandMock.mockClear();
    sendCommandMock.mockImplementation((debuggee, method, params, callback) => {
      void debuggee;
      if (method === "Accessibility.enable" || method === "DOM.enable" || method === "Target.setAutoAttach") {
        callback?.({});
        return;
      }
      if (method === "Accessibility.getFullAXTree") {
        callback?.({
          nodes: [{
            nodeId: "ax-popup-numeric-1",
            backendDOMNodeId: 2,
            role: { value: "button" },
            name: { value: "Popup Same Id CTA" }
          }]
        });
        return;
      }
      if (method === "DOM.resolveNode") {
        callback?.({ object: { objectId: "popup-node-same-id-1" } });
        return;
      }
      if (method === "Runtime.callFunctionOn") {
        const declaration = typeof (params as { functionDeclaration?: unknown } | undefined)?.functionDeclaration === "string"
          ? (params as { functionDeclaration: string }).functionDeclaration
          : "";
        if (declaration.includes("querySelectorAll")) {
          callback?.({ result: { value: "#popup-same-id-cta" } });
          return;
        }
        callback?.({ result: { value: null } });
        return;
      }
      callback?.({});
    });

    const getTabMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getTabMock.mockImplementation(async (tabId: number) => ({
      id: tabId,
      url: tabId === 202 ? "https://popup.example.com/numeric" : "https://example.com/root",
      title: tabId === 202 ? "Popup Numeric" : "Root Page",
      status: "complete"
    } as chrome.tabs.Tab));

    mock.emitDebuggerEvent(
      { sessionId: rootSessionId },
      "Target.targetCreated",
      {
        targetInfo: {
          targetId: "tab-202",
          type: "page",
          url: "https://popup.example.com/numeric",
          title: "Popup Numeric",
          openerId: "tab-101"
        }
      }
    );
    mock.emitDebuggerEvent(
      { sessionId: rootSessionId },
      "Target.attachedToTarget",
      {
        sessionId: "popup-session-same-id-202",
        targetInfo: {
          targetId: "tab-202",
          type: "page",
          url: "https://popup.example.com/numeric",
          title: "Popup Numeric",
          openerId: "tab-101"
        },
        waitingForDebugger: false
      }
    );

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-review-popup-numeric-target-id",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "nav.review",
      payload: {
        targetId: "tab-202",
        maxChars: 4096
      }
    });

    await vi.waitFor(() => {
      expect(sendCommandMock).toHaveBeenCalledWith(
        { tabId: 202, sessionId: "popup-session-same-id-202" },
        "Accessibility.getFullAXTree",
        {},
        expect.any(Function)
      );
    });

    expect(sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "ops_response",
          requestId: "req-review-popup-numeric-target-id",
          payload: expect.objectContaining({
            sessionId: session.id,
            targetId: "tab-202",
            mode: "extension",
            snapshotId: expect.any(String),
            url: "https://popup.example.com/numeric",
            title: "Popup Numeric",
            refCount: 1,
            content: expect.stringContaining("Popup Same Id CTA")
          })
        })
      ])
    );
  });

  it("dispatches non-canvas clicks through Input.dispatchMouseEvent", async () => {
    const sent: Array<{ type?: string; requestId?: string; payload?: unknown; error?: { code?: string; retryable?: boolean; message?: string } }> = [];
    const sendCommand = vi.fn(async (_debuggee: chrome.debugger.Debuggee, method: string, params?: Record<string, unknown>) => {
      if (method === "DOM.resolveNode") {
        return { object: { objectId: "node-1" } };
      }
      if (method === "DOM.getBoxModel") {
        return {
          model: {
            content: [10, 20, 30, 20, 30, 40, 10, 40]
          }
        };
      }
      if (method === "Runtime.callFunctionOn") {
        return { result: { value: undefined } };
      }
      if (method === "Input.dispatchMouseEvent") {
        return {};
      }
      return {};
    });
    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; requestId?: string; payload?: unknown; error?: { code?: string; retryable?: boolean; message?: string } }),
      cdp: {
        detachTab: vi.fn(async () => undefined),
        sendCommand
      } as never
    });

    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const session = sessions.createSession("client-1", 101, "lease-1", {
      url: "https://example.com/root",
      title: "Root Page"
    });
    session.refStore.setSnapshot("tab-101", [{
      ref: "r1",
      selector: "#open-popup",
      backendNodeId: 3,
      role: "link",
      name: "Open Popup Window"
    }]);

    const getTabMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getTabMock.mockResolvedValue({
      id: 101,
      url: "https://example.com/root",
      title: "Root Page",
      status: "complete"
    } as chrome.tabs.Tab);

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-click-real-input",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "interact.click",
      payload: {
        ref: "r1"
      }
    });
    await vi.waitFor(() => {
      expect(globalThis.chrome.tabs.update).toHaveBeenCalledWith(
        101,
        { active: true },
        expect.any(Function)
      );
      expect(sendCommand).toHaveBeenCalledWith(
        { tabId: 101 },
        "Input.dispatchMouseEvent",
        expect.objectContaining({ type: "mouseMoved", x: 20, y: 30 })
      );
      expect(sendCommand).toHaveBeenCalledWith(
        { tabId: 101 },
        "Input.dispatchMouseEvent",
        expect.objectContaining({ type: "mousePressed", x: 20, y: 30, button: "left", clickCount: 1 })
      );
      expect(sendCommand).toHaveBeenCalledWith(
        { tabId: 101 },
        "Input.dispatchMouseEvent",
        expect.objectContaining({ type: "mouseReleased", x: 20, y: 30, button: "left", clickCount: 1 })
      );
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-click-real-input",
            payload: expect.objectContaining({ navigated: false })
          })
        ])
      );
    });
  });

  it("lists popup targets when router events are keyed only by the popup child target id", async () => {
    const { mock, runtime, sent, session } = await createPopupRuntimeHarness();

    const getTabMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getTabMock.mockImplementation(async (tabId: number) => ({
      id: tabId,
      url: "https://example.com/root",
      title: "Root Page",
      status: "complete"
    } as chrome.tabs.Tab));

    mock.emitDebuggerEvent(
      { targetId: "popup-303" },
      "Target.targetCreated",
      {
        targetInfo: {
          targetId: "popup-303",
          type: "page",
          url: "https://popup.example.com/child-source",
          title: "Popup Child Source",
          openerId: "tab-101"
        }
      }
    );
    mock.emitDebuggerEvent(
      { targetId: "popup-303" },
      "Target.attachedToTarget",
      {
        sessionId: "popup-session-303",
        targetInfo: {
          targetId: "popup-303",
          type: "page",
          url: "https://popup.example.com/child-source",
          title: "Popup Child Source",
          openerId: "tab-101"
        },
        waitingForDebugger: false
      }
    );

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-targets-list-popup-child-source",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "targets.list",
      payload: {
        includeUrls: true
      }
    });

    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-targets-list-popup-child-source",
            payload: expect.objectContaining({
              targets: expect.arrayContaining([
                expect.objectContaining({
                  targetId: "popup-303",
                  url: "https://popup.example.com/child-source",
                  title: "Popup Child Source"
                })
              ])
            })
          })
        ])
      );
    });
  });

  it("adopts top-level popup tabs created with an opener tab id when Chrome allows only one attached root tab", async () => {
    const { mock, runtime, sent, session } = await createPopupRuntimeHarness();
    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;
    const detachMock = globalThis.chrome.debugger.detach as unknown as ReturnType<typeof vi.fn>;
    const sendCommandMock = globalThis.chrome.debugger.sendCommand as unknown as ReturnType<typeof vi.fn>;
    let attachedTabId: number | null = 101;
    const resolveDebuggeeTabId = (debuggee: chrome.debugger.Debuggee): number | null => {
      if (typeof debuggee.tabId === "number") {
        return debuggee.tabId;
      }
      if (typeof debuggee.targetId === "string" && debuggee.targetId.startsWith("target-")) {
        const parsed = Number.parseInt(debuggee.targetId.slice("target-".length), 10);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    };

    attachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      if (typeof tabId === "number" && attachedTabId !== null && attachedTabId !== tabId) {
        globalThis.chrome.runtime.lastError = { message: "Not allowed" } as never;
        callback();
        globalThis.chrome.runtime.lastError = null as never;
        return;
      }
      attachedTabId = typeof tabId === "number" ? tabId : attachedTabId;
      globalThis.chrome.runtime.lastError = null as never;
      callback();
    });

    detachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, callback: () => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      if (typeof tabId === "number" && attachedTabId === tabId) {
        attachedTabId = null;
      }
      globalThis.chrome.runtime.lastError = null as never;
      callback();
    });

    sendCommandMock.mockClear();
    sendCommandMock.mockImplementation((debuggee: chrome.debugger.Debuggee, method: string, params: object, callback: (result?: unknown) => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      if (typeof tabId === "number" && attachedTabId !== tabId) {
        globalThis.chrome.runtime.lastError = {
          message: `Debugger is not attached to the tab with id: ${tabId}.`
        } as never;
        callback(undefined);
        globalThis.chrome.runtime.lastError = null as never;
        return;
      }
      globalThis.chrome.runtime.lastError = null as never;
      if (method === "Target.attachToTarget") {
        callback({ sessionId: `session-${tabId ?? 0}` });
        return;
      }
      if (
        method === "Accessibility.enable"
        || method === "DOM.enable"
        || method === "Target.setAutoAttach"
        || method === "Target.setDiscoverTargets"
        || method === "Runtime.enable"
        || method === "Network.enable"
        || method === "Performance.enable"
      ) {
        callback({});
        return;
      }
      if (method === "Page.getFrameTree") {
        callback({
          frameTree: {
            frame: {
              id: `tab-${tabId ?? 0}`,
              url: tabId === 202 ? "https://popup.example.com/top-level" : "https://example.com/root"
            }
          }
        });
        return;
      }
      if (method === "Accessibility.getFullAXTree") {
        callback({
          nodes: [{
            nodeId: "ax-popup-1",
            backendDOMNodeId: 2,
            role: { value: "button" },
            name: { value: "Popup CTA" }
          }]
        });
        return;
      }
      if (method === "DOM.resolveNode") {
        callback({ object: { objectId: "popup-node-1" } });
        return;
      }
      if (method === "Runtime.callFunctionOn") {
        const declaration = typeof (params as { functionDeclaration?: unknown } | undefined)?.functionDeclaration === "string"
          ? (params as { functionDeclaration: string }).functionDeclaration
          : "";
        if (declaration.includes("querySelectorAll")) {
          callback({ result: { value: "#popup-cta" } });
          return;
        }
        callback({ result: { value: null } });
        return;
      }
      callback({});
    });

    const getTabMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getTabMock.mockImplementation(async (tabId: number) => ({
      id: tabId,
      url: tabId === 202 ? "https://popup.example.com/top-level" : "https://example.com/root",
      title: tabId === 202 ? "Popup Top Level" : "Root Page",
      status: "complete",
      active: tabId === 202
    } as chrome.tabs.Tab));

    mock.emitTabCreated({
      id: 202,
      openerTabId: 101,
      url: "about:blank",
      title: "about:blank",
      status: "loading",
      active: true
    } as chrome.tabs.Tab);
    mock.emitTabUpdated(202, {
      id: 202,
      openerTabId: 101,
      url: "https://popup.example.com/top-level",
      title: "Popup Top Level",
      status: "complete",
      active: true
    } as chrome.tabs.Tab);

    await vi.waitFor(() => {
      expect(session.targets.get("tab-202")?.openerTargetId).toBe(session.targetId);
      expect(session.activeTargetId).toBe("tab-101");
    });

    expect(detachMock).not.toHaveBeenCalled();
    expect(attachMock).not.toHaveBeenCalledWith({ tabId: 202 }, "1.3", expect.any(Function));

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-targets-list-popup-top-level",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "targets.list",
      payload: {
        includeUrls: true
      }
    });

    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-targets-list-popup-top-level",
            payload: expect.objectContaining({
              activeTargetId: "tab-101",
              targets: expect.arrayContaining([
                expect.objectContaining({
                  targetId: "tab-202",
                  url: "https://popup.example.com/top-level",
                  title: "Popup Top Level"
                })
              ])
            })
          })
        ])
      );
    });

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-nav-review-popup-top-level",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "nav.review",
      payload: {
        maxChars: 4096,
        targetId: "tab-202"
      }
    });

    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-nav-review-popup-top-level",
            payload: expect.objectContaining({
              targetId: "tab-202",
              title: "Popup Top Level",
              url: "https://popup.example.com/top-level",
              content: expect.stringContaining("Popup CTA")
            })
          })
        ])
      );
    });
  });

  it("reuses a matching synthetic popup session for a top-level popup target when direct popup root attach is not allowed", async () => {
    const { runtime, sent, session } = await createPopupRuntimeHarness();
    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const popupTarget = sessions.addTarget(session.id, 202, {
      url: "https://popup.example.com/top-level",
      title: "Popup Top Level"
    });
    sessions.upsertSyntheticTarget(session.id, {
      targetId: "popup-202",
      tabId: 101,
      type: "page",
      url: "https://popup.example.com/top-level",
      title: "Popup Top Level",
      sessionId: "popup-session-202",
      openerTargetId: session.targetId,
      attachedAt: Date.now()
    });

    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;
    const sendCommandMock = globalThis.chrome.debugger.sendCommand as unknown as ReturnType<typeof vi.fn>;
    const resolveDebuggeeTabId = (debuggee: chrome.debugger.Debuggee): number | null => {
      if (typeof debuggee.tabId === "number") {
        return debuggee.tabId;
      }
      if (typeof debuggee.targetId === "string" && debuggee.targetId.startsWith("target-")) {
        const parsed = Number.parseInt(debuggee.targetId.slice("target-".length), 10);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    };

    attachMock.mockClear();
    attachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      if (tabId === 202) {
        globalThis.chrome.runtime.lastError = { message: "Not allowed" } as never;
        callback();
        globalThis.chrome.runtime.lastError = null as never;
        return;
      }
      globalThis.chrome.runtime.lastError = null as never;
      callback();
    });

    sendCommandMock.mockClear();
    sendCommandMock.mockImplementation((debuggee: chrome.debugger.Debuggee, method: string, params: object, callback: (result?: unknown) => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      const sessionId = (debuggee as { sessionId?: string }).sessionId;
      if (tabId === 101 && sessionId === "popup-session-202") {
        globalThis.chrome.runtime.lastError = null as never;
        if (method === "Accessibility.enable" || method === "DOM.enable") {
          callback({});
          return;
        }
        if (method === "Accessibility.getFullAXTree") {
          callback({
            nodes: [{
              nodeId: "ax-popup-bridge-1",
              backendDOMNodeId: 2,
              role: { value: "button" },
              name: { value: "Popup CTA" }
            }]
          });
          return;
        }
        if (method === "DOM.resolveNode") {
          callback({ object: { objectId: "popup-node-bridge-1" } });
          return;
        }
        if (method === "Runtime.callFunctionOn") {
          const declaration = typeof (params as { functionDeclaration?: unknown } | undefined)?.functionDeclaration === "string"
            ? (params as { functionDeclaration: string }).functionDeclaration
            : "";
          if (declaration.includes("querySelectorAll")) {
            callback({ result: { value: "#popup-cta" } });
            return;
          }
          callback({ result: { value: null } });
          return;
        }
      }
      if (tabId === 202) {
        globalThis.chrome.runtime.lastError = {
          message: `Debugger is not attached to the tab with id: ${tabId}.`
        } as never;
        callback(undefined);
        globalThis.chrome.runtime.lastError = null as never;
        return;
      }
      globalThis.chrome.runtime.lastError = null as never;
      callback({});
    });

    const getTabMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getTabMock.mockImplementation(async (tabId: number) => ({
      id: tabId,
      url: tabId === 202 ? "https://popup.example.com/top-level" : "https://example.com/root",
      title: tabId === 202 ? "Popup Top Level" : "Root Page",
      status: "complete",
      active: tabId === 202
    } as chrome.tabs.Tab));

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-target-use-popup-bridge",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "targets.use",
      payload: {
        targetId: popupTarget.targetId
      }
    });

    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-target-use-popup-bridge",
            payload: expect.objectContaining({
              activeTargetId: "tab-202",
              url: "https://popup.example.com/top-level",
              title: "Popup Top Level"
            })
          })
        ])
      );
    });

    expect(
      attachMock.mock.calls.some(([debuggee]) => ((debuggee as { tabId?: number }).tabId === 202))
    ).toBe(false);

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-review-popup-bridge",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "nav.review",
      payload: {
        maxChars: 4096
      }
    });

    await vi.waitFor(() => {
      expect(sendCommandMock).toHaveBeenCalledWith(
        { tabId: 101, sessionId: "popup-session-202" },
        "Accessibility.getFullAXTree",
        {},
        expect.any(Function)
      );
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-review-popup-bridge",
            payload: expect.objectContaining({
              targetId: "tab-202",
              title: "Popup Top Level",
              url: "https://popup.example.com/top-level",
              content: expect.stringContaining("Popup CTA")
            })
          })
        ])
      );
    });
  });

  it("reuses a synthetic popup session by opener when the child session metadata is still on about:blank and the opener uses a stale root alias", async () => {
    const { runtime, sent, session } = await createPopupRuntimeHarness();
    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const popupTarget = sessions.addTarget(session.id, 202, {
      url: "https://popup.example.com/top-level",
      title: "Popup Top Level",
      openerTargetId: session.targetId
    });
    sessions.upsertSyntheticTarget(session.id, {
      targetId: "popup-202",
      tabId: 101,
      type: "page",
      url: "about:blank",
      title: "about:blank",
      sessionId: "popup-session-202",
      openerTargetId: "target-101",
      attachedAt: Date.now()
    });

    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;
    const sendCommandMock = globalThis.chrome.debugger.sendCommand as unknown as ReturnType<typeof vi.fn>;
    const resolveDebuggeeTabId = (debuggee: chrome.debugger.Debuggee): number | null => {
      if (typeof debuggee.tabId === "number") {
        return debuggee.tabId;
      }
      if (typeof debuggee.targetId === "string" && debuggee.targetId.startsWith("target-")) {
        const parsed = Number.parseInt(debuggee.targetId.slice("target-".length), 10);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    };

    attachMock.mockClear();
    attachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      if (tabId === 202) {
        globalThis.chrome.runtime.lastError = { message: "Not allowed" } as never;
        callback();
        globalThis.chrome.runtime.lastError = null as never;
        return;
      }
      globalThis.chrome.runtime.lastError = null as never;
      callback();
    });

    sendCommandMock.mockClear();
    sendCommandMock.mockImplementation((debuggee: chrome.debugger.Debuggee, method: string, params: object, callback: (result?: unknown) => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      const sessionId = (debuggee as { sessionId?: string }).sessionId;
      if (tabId === 101 && sessionId === "popup-session-202") {
        globalThis.chrome.runtime.lastError = null as never;
        if (method === "Accessibility.enable" || method === "DOM.enable") {
          callback({});
          return;
        }
        if (method === "Accessibility.getFullAXTree") {
          callback({
            nodes: [{
              nodeId: "ax-popup-bridge-opener-1",
              backendDOMNodeId: 2,
              role: { value: "button" },
              name: { value: "Popup CTA" }
            }]
          });
          return;
        }
        if (method === "DOM.resolveNode") {
          callback({ object: { objectId: "popup-node-bridge-opener-1" } });
          return;
        }
        if (method === "Runtime.callFunctionOn") {
          const declaration = typeof (params as { functionDeclaration?: unknown } | undefined)?.functionDeclaration === "string"
            ? (params as { functionDeclaration: string }).functionDeclaration
            : "";
          if (declaration.includes("querySelectorAll")) {
            callback({ result: { value: "#popup-cta" } });
            return;
          }
          callback({ result: { value: null } });
          return;
        }
      }
      if (tabId === 202) {
        globalThis.chrome.runtime.lastError = {
          message: `Debugger is not attached to the tab with id: ${tabId}.`
        } as never;
        callback(undefined);
        globalThis.chrome.runtime.lastError = null as never;
        return;
      }
      globalThis.chrome.runtime.lastError = null as never;
      callback({});
    });

    const getTabMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getTabMock.mockImplementation(async (tabId: number) => ({
      id: tabId,
      url: tabId === 202 ? "https://popup.example.com/top-level" : "https://example.com/root",
      title: tabId === 202 ? "Popup Top Level" : "Root Page",
      status: "complete",
      active: tabId === 202
    } as chrome.tabs.Tab));

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-target-use-popup-bridge-opener",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "targets.use",
      payload: {
        targetId: popupTarget.targetId
      }
    });

    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-target-use-popup-bridge-opener",
            payload: expect.objectContaining({
              activeTargetId: "tab-202",
              url: "https://popup.example.com/top-level",
              title: "Popup Top Level"
            })
          })
        ])
      );
    });

    expect(
      attachMock.mock.calls.some(([debuggee]) => ((debuggee as { tabId?: number }).tabId === 202))
    ).toBe(false);

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-review-popup-bridge-opener",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "nav.review",
      payload: {
        maxChars: 4096
      }
    });

    await vi.waitFor(() => {
      expect(sendCommandMock).toHaveBeenCalledWith(
        { tabId: 101, sessionId: "popup-session-202" },
        "Accessibility.getFullAXTree",
        {},
        expect.any(Function)
      );
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-review-popup-bridge-opener",
            payload: expect.objectContaining({
              targetId: "tab-202",
              title: "Popup Top Level",
              url: "https://popup.example.com/top-level",
              content: expect.stringContaining("Popup CTA")
            })
          })
        ])
      );
    });
  });

  it("creates a popup child-session bridge on demand when direct top-level popup attach is blocked", async () => {
    const { runtime, sent, session } = await createPopupRuntimeHarness();
    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const popupTarget = sessions.addTarget(session.id, 202, {
      url: "https://popup.example.com/top-level",
      title: "Popup Child",
      openerTargetId: session.targetId
    });

    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;
    const sendCommandMock = globalThis.chrome.debugger.sendCommand as unknown as ReturnType<typeof vi.fn>;
    const resolveDebuggeeTabId = (debuggee: chrome.debugger.Debuggee): number | null => {
      if (typeof debuggee.tabId === "number") {
        return debuggee.tabId;
      }
      if (typeof debuggee.targetId === "string" && debuggee.targetId.startsWith("target-")) {
        const parsed = Number.parseInt(debuggee.targetId.slice("target-".length), 10);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    };

    attachMock.mockClear();
    attachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      if (tabId === 202) {
        globalThis.chrome.runtime.lastError = { message: "Not allowed" } as never;
        callback();
        globalThis.chrome.runtime.lastError = null as never;
        return;
      }
      globalThis.chrome.runtime.lastError = null as never;
      callback();
    });

    sendCommandMock.mockClear();
    sendCommandMock.mockImplementation((debuggee: chrome.debugger.Debuggee, method: string, params: object, callback: (result?: unknown) => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      const sessionId = (debuggee as { sessionId?: string }).sessionId;
      if (tabId === 101 && typeof sessionId !== "string") {
        globalThis.chrome.runtime.lastError = null as never;
        if (method === "Target.getTargets") {
          callback({
            targetInfos: [{
              targetId: "popup-202",
              type: "page",
              url: "https://popup.example.com/top-level",
              title: "Popup Child"
            }]
          });
          return;
        }
        if (method === "Target.attachToTarget") {
          expect(params).toEqual({
            targetId: "popup-202",
            flatten: true
          });
          callback({ sessionId: "popup-session-202" });
          return;
        }
      }
      if (tabId === 101 && sessionId === "popup-session-202") {
        globalThis.chrome.runtime.lastError = null as never;
        if (method === "Accessibility.enable" || method === "DOM.enable") {
          callback({});
          return;
        }
        if (method === "Accessibility.getFullAXTree") {
          callback({
            nodes: [{
              nodeId: "ax-popup-bridge-demand-1",
              backendDOMNodeId: 2,
              role: { value: "button" },
              name: { value: "Popup CTA" }
            }]
          });
          return;
        }
        if (method === "DOM.resolveNode") {
          callback({ object: { objectId: "popup-node-bridge-demand-1" } });
          return;
        }
        if (method === "Runtime.callFunctionOn") {
          const declaration = typeof (params as { functionDeclaration?: unknown } | undefined)?.functionDeclaration === "string"
            ? (params as { functionDeclaration: string }).functionDeclaration
            : "";
          if (declaration.includes("querySelectorAll")) {
            callback({ result: { value: "#popup-cta" } });
            return;
          }
          callback({ result: { value: null } });
          return;
        }
      }
      if (tabId === 202) {
        globalThis.chrome.runtime.lastError = {
          message: `Debugger is not attached to the tab with id: ${tabId}.`
        } as never;
        callback(undefined);
        globalThis.chrome.runtime.lastError = null as never;
        return;
      }
      globalThis.chrome.runtime.lastError = null as never;
      callback({});
    });

    const getTabMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getTabMock.mockImplementation(async (tabId: number) => ({
      id: tabId,
      url: tabId === 202 ? "https://popup.example.com/top-level" : "https://example.com/root",
      title: tabId === 202 ? "Popup Child" : "Root Page",
      status: "complete",
      active: tabId === 202
    } as chrome.tabs.Tab));

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-target-use-popup-bridge-demand",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "targets.use",
      payload: {
        targetId: popupTarget.targetId
      }
    });

    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-target-use-popup-bridge-demand",
            payload: expect.objectContaining({
              activeTargetId: "tab-202",
              url: "https://popup.example.com/top-level",
              title: "Popup Child"
            })
          })
        ])
      );
    });

    expect(
      attachMock.mock.calls.some(([debuggee]) => ((debuggee as { tabId?: number }).tabId === 202))
    ).toBe(true);
    expect(sendCommandMock).toHaveBeenCalledWith(
      { tabId: 101 },
      "Target.attachToTarget",
      { targetId: "popup-202", flatten: true },
      expect.any(Function)
    );

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-review-popup-bridge-demand",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "nav.review",
      payload: {
        maxChars: 4096
      }
    });

    await vi.waitFor(() => {
      expect(sendCommandMock).toHaveBeenCalledWith(
        { tabId: 101, sessionId: "popup-session-202" },
        "Accessibility.getFullAXTree",
        {},
        expect.any(Function)
      );
      expect(
        sendCommandMock.mock.calls.some(([debuggee, method]) => (
          (debuggee as { tabId?: number; sessionId?: string }).tabId === 202
          && (debuggee as { sessionId?: string }).sessionId === undefined
          && method === "Accessibility.getFullAXTree"
        ))
      ).toBe(false);
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-review-popup-bridge-demand",
            payload: expect.objectContaining({
              targetId: "tab-202",
              title: "Popup Child",
              url: "https://popup.example.com/top-level",
              content: expect.stringContaining("Popup CTA")
            })
          })
        ])
      );
    });
  });

  it("hydrates a missing popup opener from router metadata before targets.use bridges the popup", async () => {
    const { mock, runtime, sent, session, rootSessionId } = await createPopupRuntimeHarness();
    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const popupTarget = sessions.addTarget(session.id, 202, {
      url: "https://popup.example.com/top-level",
      title: "Popup Child"
    });

    const getTargetsMock = globalThis.chrome.debugger.getTargets as unknown as ReturnType<typeof vi.fn>;
    getTargetsMock.mockImplementation((callback: (result: chrome.debugger.TargetInfo[]) => void) => {
      callback([
        {
          id: "target-101",
          tabId: 101,
          type: "page",
          title: "Root Page",
          url: "https://example.com/root",
          attached: false
        },
        {
          id: "popup-202",
          tabId: 202,
          type: "page",
          title: "Popup Child",
          url: "https://popup.example.com/top-level",
          attached: false
        },
        {
          id: "popup-202-initial",
          tabId: 202,
          type: "page",
          title: "about:blank",
          url: "about:blank",
          openerId: "target-101",
          attached: false
        }
      ] as chrome.debugger.TargetInfo[]);
    });

    mock.emitDebuggerEvent(
      { sessionId: rootSessionId },
      "Target.targetCreated",
      {
        targetInfo: {
          targetId: "popup-202",
          type: "page",
          title: "Popup Child",
          url: "https://popup.example.com/top-level",
          openerId: "target-101"
        }
      }
    );

    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;
    const sendCommandMock = globalThis.chrome.debugger.sendCommand as unknown as ReturnType<typeof vi.fn>;
    const resolveDebuggeeTabId = (debuggee: chrome.debugger.Debuggee): number | null => {
      if (typeof debuggee.tabId === "number") {
        return debuggee.tabId;
      }
      if (typeof debuggee.targetId === "string" && debuggee.targetId.startsWith("target-")) {
        const parsed = Number.parseInt(debuggee.targetId.slice("target-".length), 10);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    };

    attachMock.mockClear();
    attachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      if (tabId === 202) {
        globalThis.chrome.runtime.lastError = { message: "Not allowed" } as never;
        callback();
        globalThis.chrome.runtime.lastError = null as never;
        return;
      }
      globalThis.chrome.runtime.lastError = null as never;
      callback();
    });

    sendCommandMock.mockClear();
    sendCommandMock.mockImplementation((debuggee: chrome.debugger.Debuggee, method: string, params: object, callback: (result?: unknown) => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      const sessionId = (debuggee as { sessionId?: string }).sessionId;
      if (tabId === 101 && typeof sessionId !== "string") {
        globalThis.chrome.runtime.lastError = null as never;
        if (method === "Target.getTargets") {
          callback({
            targetInfos: [{
              targetId: "popup-202",
              type: "page",
              url: "https://popup.example.com/top-level",
              title: "Popup Child",
              openerId: "target-101"
            }]
          });
          return;
        }
        if (method === "Target.attachToTarget") {
          expect(params).toEqual({
            targetId: "popup-202",
            flatten: true
          });
          callback({ sessionId: "popup-session-202" });
          return;
        }
      }
      if (tabId === 101 && sessionId === "popup-session-202") {
        globalThis.chrome.runtime.lastError = null as never;
        if (method === "Accessibility.enable" || method === "DOM.enable") {
          callback({});
          return;
        }
        if (method === "Accessibility.getFullAXTree") {
          callback({
            nodes: [{
              nodeId: "ax-popup-hydrated-use-1",
              backendDOMNodeId: 2,
              role: { value: "button" },
              name: { value: "Popup CTA" }
            }]
          });
          return;
        }
        if (method === "DOM.resolveNode") {
          callback({ object: { objectId: "popup-node-hydrated-use-1" } });
          return;
        }
        if (method === "Runtime.callFunctionOn") {
          const declaration = typeof (params as { functionDeclaration?: unknown } | undefined)?.functionDeclaration === "string"
            ? (params as { functionDeclaration: string }).functionDeclaration
            : "";
          if (declaration.includes("querySelectorAll")) {
            callback({ result: { value: "#popup-cta" } });
            return;
          }
          callback({ result: { value: null } });
          return;
        }
      }
      if (tabId === 202) {
        globalThis.chrome.runtime.lastError = {
          message: `Debugger is not attached to the tab with id: ${tabId}.`
        } as never;
        callback(undefined);
        globalThis.chrome.runtime.lastError = null as never;
        return;
      }
      globalThis.chrome.runtime.lastError = null as never;
      callback({});
    });

    const getTabMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getTabMock.mockImplementation(async (tabId: number) => ({
      id: tabId,
      url: tabId === 202 ? "https://popup.example.com/top-level" : "https://example.com/root",
      title: tabId === 202 ? "Popup Child" : "Root Page",
      status: "complete",
      active: tabId === 202
    } as chrome.tabs.Tab));

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-target-use-popup-hydrated-opener",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "targets.use",
      payload: {
        targetId: popupTarget.targetId
      }
    });

    await vi.waitFor(() => {
      expect(popupTarget.openerTargetId).toBe(session.targetId);
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-target-use-popup-hydrated-opener",
            payload: expect.objectContaining({
              activeTargetId: "tab-202",
              url: "https://popup.example.com/top-level",
              title: "Popup Child"
            })
          })
        ])
      );
    });

    expect(
      attachMock.mock.calls.some(([debuggee]) => ((debuggee as { tabId?: number }).tabId === 202))
    ).toBe(false);
    expect(sendCommandMock).toHaveBeenCalledWith(
      { tabId: 101 },
      "Target.attachToTarget",
      { targetId: "popup-202", flatten: true },
      expect.any(Function)
    );

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-review-popup-hydrated-opener",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "nav.review",
      payload: {
        maxChars: 4096
      }
    });

    await vi.waitFor(() => {
      expect(sendCommandMock).toHaveBeenCalledWith(
        { tabId: 101, sessionId: "popup-session-202" },
        "Accessibility.getFullAXTree",
        {},
        expect.any(Function)
      );
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-review-popup-hydrated-opener",
            payload: expect.objectContaining({
              targetId: "tab-202",
              title: "Popup Child",
              url: "https://popup.example.com/top-level",
              content: expect.stringContaining("Popup CTA")
            })
          })
        ])
      );
    });
  });

  it("bridges targets.use when only the synthetic router target carries the popup opener id", async () => {
    const { mock, runtime, sent, session, rootSessionId } = await createPopupRuntimeHarness();
    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const popupTarget = sessions.addTarget(session.id, 202, {
      url: "https://popup.example.com/top-level",
      title: "Popup Child"
    });

    const getTargetsMock = globalThis.chrome.debugger.getTargets as unknown as ReturnType<typeof vi.fn>;
    getTargetsMock.mockImplementation((callback: (result: chrome.debugger.TargetInfo[]) => void) => {
      callback([
        {
          id: "target-101",
          tabId: 101,
          type: "page",
          title: "Root Page",
          url: "https://example.com/root",
          attached: false
        },
        {
          id: "popup-202",
          tabId: 202,
          type: "page",
          title: "Popup Child",
          url: "https://popup.example.com/top-level",
          attached: false
        }
      ] as chrome.debugger.TargetInfo[]);
    });

    mock.emitDebuggerEvent(
      { sessionId: rootSessionId },
      "Target.targetCreated",
      {
        targetInfo: {
          targetId: "popup-202",
          type: "page",
          title: "Popup Child",
          url: "https://popup.example.com/top-level",
          openerId: "tab-101"
        }
      }
    );

    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;
    const sendCommandMock = globalThis.chrome.debugger.sendCommand as unknown as ReturnType<typeof vi.fn>;
    const resolveDebuggeeTabId = (debuggee: chrome.debugger.Debuggee): number | null => {
      if (typeof debuggee.tabId === "number") {
        return debuggee.tabId;
      }
      if (typeof debuggee.targetId === "string" && debuggee.targetId.startsWith("target-")) {
        const parsed = Number.parseInt(debuggee.targetId.slice("target-".length), 10);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    };

    attachMock.mockClear();
    attachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      if (tabId === 202) {
        globalThis.chrome.runtime.lastError = { message: "Not allowed" } as never;
        callback();
        globalThis.chrome.runtime.lastError = null as never;
        return;
      }
      globalThis.chrome.runtime.lastError = null as never;
      callback();
    });

    sendCommandMock.mockClear();
    sendCommandMock.mockImplementation((debuggee: chrome.debugger.Debuggee, method: string, params: object, callback: (result?: unknown) => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      const sessionId = (debuggee as { sessionId?: string }).sessionId;
      if (tabId === 101 && typeof sessionId !== "string") {
        globalThis.chrome.runtime.lastError = null as never;
        if (method === "Target.getTargets") {
          callback({
            targetInfos: [{
              targetId: "popup-202",
              type: "page",
              url: "https://popup.example.com/top-level",
              title: "Popup Child",
              openerId: "tab-101"
            }]
          });
          return;
        }
        if (method === "Target.attachToTarget") {
          expect(params).toEqual({
            targetId: "popup-202",
            flatten: true
          });
          callback({ sessionId: "popup-session-202" });
          return;
        }
      }
      if (tabId === 101 && sessionId === "popup-session-202") {
        globalThis.chrome.runtime.lastError = null as never;
        if (method === "Accessibility.enable" || method === "DOM.enable") {
          callback({});
          return;
        }
        if (method === "Accessibility.getFullAXTree") {
          callback({
            nodes: [{
              nodeId: "ax-popup-synthetic-opener-1",
              backendDOMNodeId: 2,
              role: { value: "button" },
              name: { value: "Popup CTA" }
            }]
          });
          return;
        }
        if (method === "DOM.resolveNode") {
          callback({ object: { objectId: "popup-node-synthetic-opener-1" } });
          return;
        }
        if (method === "Runtime.callFunctionOn") {
          const declaration = typeof (params as { functionDeclaration?: unknown } | undefined)?.functionDeclaration === "string"
            ? (params as { functionDeclaration: string }).functionDeclaration
            : "";
          if (declaration.includes("querySelectorAll")) {
            callback({ result: { value: "#popup-cta" } });
            return;
          }
          callback({ result: { value: null } });
          return;
        }
      }
      if (tabId === 202) {
        globalThis.chrome.runtime.lastError = {
          message: `Debugger is not attached to the tab with id: ${tabId}.`
        } as never;
        callback(undefined);
        globalThis.chrome.runtime.lastError = null as never;
        return;
      }
      globalThis.chrome.runtime.lastError = null as never;
      callback({});
    });

    const getTabMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getTabMock.mockImplementation(async (tabId: number) => ({
      id: tabId,
      url: tabId === 202 ? "https://popup.example.com/top-level" : "https://example.com/root",
      title: tabId === 202 ? "Popup Child" : "Root Page",
      status: "complete",
      active: tabId === 202
    } as chrome.tabs.Tab));

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-target-use-popup-synthetic-opener",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "targets.use",
      payload: {
        targetId: popupTarget.targetId
      }
    });

    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-target-use-popup-synthetic-opener",
            payload: expect.objectContaining({
              activeTargetId: "tab-202",
              url: "https://popup.example.com/top-level",
              title: "Popup Child"
            })
          })
        ])
      );
    });

    expect(
      attachMock.mock.calls.some(([debuggee]) => ((debuggee as { tabId?: number }).tabId === 202))
    ).toBe(false);
    expect(sendCommandMock).toHaveBeenCalledWith(
      { tabId: 101 },
      "Target.attachToTarget",
      { targetId: "popup-202", flatten: true },
      expect.any(Function)
    );

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-review-popup-synthetic-opener",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "nav.review",
      payload: {
        maxChars: 4096
      }
    });

    await vi.waitFor(() => {
      expect(sendCommandMock).toHaveBeenCalledWith(
        { tabId: 101, sessionId: "popup-session-202" },
        "Accessibility.getFullAXTree",
        {},
        expect.any(Function)
      );
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-review-popup-synthetic-opener",
            payload: expect.objectContaining({
              targetId: "tab-202",
              title: "Popup Child",
              url: "https://popup.example.com/top-level",
              content: expect.stringContaining("Popup CTA")
            })
          })
        ])
      );
    });
  });

  it("restores the opener root attach before bridging a blocked popup during popup creation", async () => {
    const { mock, router, runtime, sent, session } = await createPopupRuntimeHarness();
    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;
    const detachMock = globalThis.chrome.debugger.detach as unknown as ReturnType<typeof vi.fn>;
    const sendCommandMock = globalThis.chrome.debugger.sendCommand as unknown as ReturnType<typeof vi.fn>;
    let attachedTabId: number | null = 101;
    const resolveDebuggeeTabId = (debuggee: chrome.debugger.Debuggee): number | null => {
      if (typeof debuggee.tabId === "number") {
        return debuggee.tabId;
      }
      if (typeof debuggee.targetId === "string" && debuggee.targetId.startsWith("target-")) {
        const parsed = Number.parseInt(debuggee.targetId.slice("target-".length), 10);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    };

    attachMock.mockClear();
    attachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      if (tabId === 202) {
        globalThis.chrome.runtime.lastError = { message: "Not allowed" } as never;
        callback();
        globalThis.chrome.runtime.lastError = null as never;
        return;
      }
      if (typeof tabId === "number" && attachedTabId !== null && attachedTabId !== tabId) {
        globalThis.chrome.runtime.lastError = { message: "Not allowed" } as never;
        callback();
        globalThis.chrome.runtime.lastError = null as never;
        return;
      }
      attachedTabId = typeof tabId === "number" ? tabId : attachedTabId;
      globalThis.chrome.runtime.lastError = null as never;
      callback();
    });

    detachMock.mockClear();
    detachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, callback: () => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      if (typeof tabId === "number" && attachedTabId === tabId) {
        attachedTabId = null;
      }
      globalThis.chrome.runtime.lastError = null as never;
      callback();
    });

    sendCommandMock.mockClear();
    sendCommandMock.mockImplementation((debuggee: chrome.debugger.Debuggee, method: string, params: object, callback: (result?: unknown) => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      const sessionId = (debuggee as { sessionId?: string }).sessionId;
      if (typeof tabId === "number" && attachedTabId !== tabId) {
        globalThis.chrome.runtime.lastError = {
          message: `Debugger is not attached to the tab with id: ${tabId}.`
        } as never;
        callback(undefined);
        globalThis.chrome.runtime.lastError = null as never;
        return;
      }
      globalThis.chrome.runtime.lastError = null as never;
      if (tabId === 101 && typeof sessionId !== "string") {
        if (method === "Target.getTargets") {
          callback({
            targetInfos: [{
              targetId: "popup-202",
              type: "page",
              url: "https://popup.example.com/top-level",
              title: "Popup Top Level"
            }]
          });
          return;
        }
        if (method === "Target.attachToTarget") {
          const requestedTargetId = typeof (params as { targetId?: unknown } | undefined)?.targetId === "string"
            ? (params as { targetId: string }).targetId
            : null;
          if (requestedTargetId === "popup-202" || requestedTargetId === "target-101") {
            callback({ sessionId: requestedTargetId === "popup-202" ? "popup-session-202" : "root-session-101" });
            return;
          }
        }
      }
      if (tabId === 101 && sessionId === "popup-session-202") {
        if (method === "Accessibility.enable" || method === "DOM.enable") {
          callback({});
          return;
        }
        if (method === "Accessibility.getFullAXTree") {
          callback({
            nodes: [{
              nodeId: "ax-popup-restored-root-1",
              backendDOMNodeId: 2,
              role: { value: "button" },
              name: { value: "Popup CTA" }
            }]
          });
          return;
        }
        if (method === "DOM.resolveNode") {
          callback({ object: { objectId: "popup-node-restored-root-1" } });
          return;
        }
        if (method === "Runtime.callFunctionOn") {
          const declaration = typeof (params as { functionDeclaration?: unknown } | undefined)?.functionDeclaration === "string"
            ? (params as { functionDeclaration: string }).functionDeclaration
            : "";
          if (declaration.includes("querySelectorAll")) {
            callback({ result: { value: "#popup-cta" } });
            return;
          }
          callback({ result: { value: null } });
          return;
        }
      }
      callback({});
    });

    const getTabMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getTabMock.mockImplementation(async (tabId: number) => ({
      id: tabId,
      url: tabId === 202 ? "https://popup.example.com/top-level" : "https://example.com/root",
      title: tabId === 202 ? "Popup Top Level" : "Root Page",
      status: "complete",
      active: tabId === 202
    } as chrome.tabs.Tab));

    mock.emitTabCreated({
      id: 202,
      openerTabId: 101,
      url: "about:blank",
      title: "about:blank",
      status: "loading",
      active: true
    } as chrome.tabs.Tab);
    mock.emitTabUpdated(202, {
      id: 202,
      openerTabId: 101,
      url: "https://popup.example.com/top-level",
      title: "Popup Top Level",
      status: "complete",
      active: true
    } as chrome.tabs.Tab);

    await vi.waitFor(() => {
      expect(session.targets.get("tab-202")?.openerTargetId).toBe(session.targetId);
      expect(session.activeTargetId).toBe("tab-101");
      expect(attachedTabId).toBe(101);
    });

    expect(router.getAttachedTabIds()).toEqual([101]);
    expect(attachMock).not.toHaveBeenCalledWith({ tabId: 202 }, "1.3", expect.any(Function));
    expect(attachMock).not.toHaveBeenCalledWith({ tabId: 101 }, "1.3", expect.any(Function));

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-review-popup-restored-root",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "nav.review",
      payload: {
        maxChars: 4096,
        targetId: "tab-202"
      }
    });

    await vi.waitFor(() => {
      expect(sendCommandMock).toHaveBeenCalledWith(
        { tabId: 101, sessionId: "popup-session-202" },
        "Accessibility.getFullAXTree",
        {},
        expect.any(Function)
      );
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-review-popup-restored-root",
            payload: expect.objectContaining({
              targetId: "tab-202",
              title: "Popup Top Level",
              url: "https://popup.example.com/top-level",
              content: expect.stringContaining("Popup CTA")
            })
          })
        ])
      );
    });
  });

  it("keeps the opener root usable after blocked popup attach following router client reset", async () => {
    const { mock, router, runtime, sent, session } = await createPopupRuntimeHarness();
    router.markClientClosed();
    await router.handleCommand({
      id: 990,
      method: "forwardCDPCommand",
      params: { method: "Runtime.enable", params: {} }
    });

    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;
    const detachMock = globalThis.chrome.debugger.detach as unknown as ReturnType<typeof vi.fn>;
    const sendCommandMock = globalThis.chrome.debugger.sendCommand as unknown as ReturnType<typeof vi.fn>;
    let attachedTabId: number | null = 101;
    const resolveDebuggeeTabId = (debuggee: chrome.debugger.Debuggee): number | null => {
      if (typeof debuggee.tabId === "number") {
        return debuggee.tabId;
      }
      if (typeof debuggee.targetId === "string" && debuggee.targetId.startsWith("target-")) {
        const parsed = Number.parseInt(debuggee.targetId.slice("target-".length), 10);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    };

    attachMock.mockClear();
    attachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      if (tabId === 202) {
        globalThis.chrome.runtime.lastError = { message: "Not allowed" } as never;
        callback();
        globalThis.chrome.runtime.lastError = null as never;
        return;
      }
      if (typeof tabId === "number" && attachedTabId !== null && attachedTabId !== tabId) {
        globalThis.chrome.runtime.lastError = { message: "Not allowed" } as never;
        callback();
        globalThis.chrome.runtime.lastError = null as never;
        return;
      }
      attachedTabId = typeof tabId === "number" ? tabId : attachedTabId;
      globalThis.chrome.runtime.lastError = null as never;
      callback();
    });

    detachMock.mockClear();
    detachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, callback: () => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      if (typeof tabId === "number" && attachedTabId === tabId) {
        attachedTabId = null;
      }
      globalThis.chrome.runtime.lastError = null as never;
      callback();
    });

    sendCommandMock.mockClear();
    sendCommandMock.mockImplementation((debuggee: chrome.debugger.Debuggee, method: string, params: object, callback: (result?: unknown) => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      const sessionId = (debuggee as { sessionId?: string }).sessionId;
      if (typeof tabId === "number" && attachedTabId !== tabId) {
        globalThis.chrome.runtime.lastError = {
          message: `Debugger is not attached to the tab with id: ${tabId}.`
        } as never;
        callback(undefined);
        globalThis.chrome.runtime.lastError = null as never;
        return;
      }
      globalThis.chrome.runtime.lastError = null as never;
      if (tabId === 101 && typeof sessionId !== "string") {
        if (method === "Target.getTargets") {
          callback({
            targetInfos: [{
              targetId: "popup-202",
              type: "page",
              url: "https://popup.example.com/top-level",
              title: "Popup Top Level"
            }]
          });
          return;
        }
        if (method === "Target.attachToTarget") {
          const requestedTargetId = typeof (params as { targetId?: unknown } | undefined)?.targetId === "string"
            ? (params as { targetId: string }).targetId
            : null;
          if (requestedTargetId === "popup-202" || requestedTargetId === "target-101") {
            callback({ sessionId: requestedTargetId === "popup-202" ? "popup-session-202" : "root-session-101" });
            return;
          }
        }
        if (method === "Accessibility.enable" || method === "DOM.enable" || method === "Runtime.enable") {
          callback({});
          return;
        }
        if (method === "Accessibility.getFullAXTree") {
          callback({
            nodes: [{
              nodeId: "ax-root-after-reset-1",
              backendDOMNodeId: 1,
              role: { value: "link" },
              name: { value: "Open Popup Window" }
            }]
          });
          return;
        }
        if (method === "DOM.resolveNode") {
          callback({ object: { objectId: "root-node-after-reset-1" } });
          return;
        }
        if (method === "Runtime.callFunctionOn") {
          const declaration = typeof (params as { functionDeclaration?: unknown } | undefined)?.functionDeclaration === "string"
            ? (params as { functionDeclaration: string }).functionDeclaration
            : "";
          if (declaration.includes("querySelectorAll")) {
            callback({ result: { value: "#open-popup" } });
            return;
          }
          callback({ result: { value: null } });
          return;
        }
      }
      if (tabId === 101 && sessionId === "popup-session-202") {
        if (method === "Accessibility.enable" || method === "DOM.enable") {
          callback({});
          return;
        }
        if (method === "Accessibility.getFullAXTree") {
          callback({
            nodes: [{
              nodeId: "ax-popup-after-reset-1",
              backendDOMNodeId: 2,
              role: { value: "button" },
              name: { value: "Popup CTA" }
            }]
          });
          return;
        }
        if (method === "DOM.resolveNode") {
          callback({ object: { objectId: "popup-node-after-reset-1" } });
          return;
        }
        if (method === "Runtime.callFunctionOn") {
          const declaration = typeof (params as { functionDeclaration?: unknown } | undefined)?.functionDeclaration === "string"
            ? (params as { functionDeclaration: string }).functionDeclaration
            : "";
          if (declaration.includes("querySelectorAll")) {
            callback({ result: { value: "#popup-cta" } });
            return;
          }
          callback({ result: { value: null } });
          return;
        }
      }
      callback({});
    });

    const getTabMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getTabMock.mockImplementation(async (tabId: number) => ({
      id: tabId,
      url: tabId === 202 ? "https://popup.example.com/top-level" : "https://example.com/root",
      title: tabId === 202 ? "Popup Top Level" : "Root Page",
      status: "complete",
      active: tabId === 202
    } as chrome.tabs.Tab));

    mock.emitTabCreated({
      id: 202,
      openerTabId: 101,
      url: "about:blank",
      title: "about:blank",
      status: "loading",
      active: true
    } as chrome.tabs.Tab);
    mock.emitTabUpdated(202, {
      id: 202,
      openerTabId: 101,
      url: "https://popup.example.com/top-level",
      title: "Popup Top Level",
      status: "complete",
      active: true
    } as chrome.tabs.Tab);

    await vi.waitFor(() => {
      expect(session.targets.has("tab-202")).toBe(true);
      expect(attachedTabId).toBe(101);
    });

    expect(router.getAttachedTabIds()).toEqual([101]);

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-root-review-after-reset",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "nav.review",
      payload: {
        maxChars: 4096,
        targetId: "tab-101"
      }
    });

    await vi.waitFor(() => {
      expect(sendCommandMock).toHaveBeenCalledWith(
        { tabId: 101 },
        "Accessibility.getFullAXTree",
        {},
        expect.any(Function)
      );
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-root-review-after-reset",
            payload: expect.objectContaining({
              targetId: "tab-101",
              title: "Root Page",
              url: "https://example.com/root",
              content: expect.stringContaining("Open Popup Window")
            })
          })
        ])
      );
    });
  });

  it("bridges a popup child session during popup creation when Target.getTargets still reports about:blank", async () => {
    const { mock, runtime, sent, session } = await createPopupRuntimeHarness();
    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;
    const sendCommandMock = globalThis.chrome.debugger.sendCommand as unknown as ReturnType<typeof vi.fn>;
    const resolveDebuggeeTabId = (debuggee: chrome.debugger.Debuggee): number | null => {
      if (typeof debuggee.tabId === "number") {
        return debuggee.tabId;
      }
      if (typeof debuggee.targetId === "string" && debuggee.targetId.startsWith("target-")) {
        const parsed = Number.parseInt(debuggee.targetId.slice("target-".length), 10);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    };

    attachMock.mockClear();
    attachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      if (tabId === 202) {
        globalThis.chrome.runtime.lastError = { message: "Not allowed" } as never;
        callback();
        globalThis.chrome.runtime.lastError = null as never;
        return;
      }
      globalThis.chrome.runtime.lastError = null as never;
      callback();
    });

    sendCommandMock.mockClear();
    sendCommandMock.mockImplementation((debuggee: chrome.debugger.Debuggee, method: string, params: object, callback: (result?: unknown) => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      const sessionId = (debuggee as { sessionId?: string }).sessionId;
      if (tabId === 101 && typeof sessionId !== "string") {
        globalThis.chrome.runtime.lastError = null as never;
        if (method === "Target.getTargets") {
          callback({
            targetInfos: [
              {
                targetId: "root-101",
                type: "page",
                url: "https://example.com/root",
                title: "Root Page"
              },
              {
                targetId: "popup-202",
                type: "page",
                url: "about:blank",
                title: "about:blank"
              }
            ]
          });
          return;
        }
        if (method === "Target.attachToTarget") {
          expect(params).toEqual({
            targetId: "popup-202",
            flatten: true
          });
          callback({ sessionId: "popup-session-202" });
          return;
        }
      }
      if (tabId === 101 && sessionId === "popup-session-202") {
        globalThis.chrome.runtime.lastError = null as never;
        if (method === "Accessibility.enable" || method === "DOM.enable") {
          callback({});
          return;
        }
        if (method === "Accessibility.getFullAXTree") {
          callback({
            nodes: [{
              nodeId: "ax-popup-live-bridge-1",
              backendDOMNodeId: 2,
              role: { value: "button" },
              name: { value: "Popup CTA" }
            }]
          });
          return;
        }
        if (method === "DOM.resolveNode") {
          callback({ object: { objectId: "popup-node-live-bridge-1" } });
          return;
        }
        if (method === "Runtime.callFunctionOn") {
          const declaration = typeof (params as { functionDeclaration?: unknown } | undefined)?.functionDeclaration === "string"
            ? (params as { functionDeclaration: string }).functionDeclaration
            : "";
          if (declaration.includes("querySelectorAll")) {
            callback({ result: { value: "#popup-cta" } });
            return;
          }
          callback({ result: { value: null } });
          return;
        }
      }
      if (tabId === 202) {
        globalThis.chrome.runtime.lastError = {
          message: `Debugger is not attached to the tab with id: ${tabId}.`
        } as never;
        callback(undefined);
        globalThis.chrome.runtime.lastError = null as never;
        return;
      }
      globalThis.chrome.runtime.lastError = null as never;
      callback({});
    });

    const getTabMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getTabMock.mockImplementation(async (tabId: number) => ({
      id: tabId,
      url: tabId === 202 ? "https://popup.example.com/top-level" : "https://example.com/root",
      title: tabId === 202 ? "Popup Top Level" : "Root Page",
      status: "complete",
      active: tabId === 202
    } as chrome.tabs.Tab));

    mock.emitTabCreated({
      id: 202,
      openerTabId: 101,
      url: "about:blank",
      title: "about:blank",
      status: "loading",
      active: true
    } as chrome.tabs.Tab);
    mock.emitTabUpdated(202, {
      id: 202,
      openerTabId: 101,
      url: "https://popup.example.com/top-level",
      title: "Popup Top Level",
      status: "complete",
      active: true
    } as chrome.tabs.Tab);

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-targets-list-popup-top-level-live-bridge",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "targets.list",
      payload: {
        includeUrls: true
      }
    });

    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-targets-list-popup-top-level-live-bridge",
            payload: expect.objectContaining({
              activeTargetId: "tab-101",
              targets: expect.arrayContaining([
                expect.objectContaining({
                  targetId: "tab-202",
                  url: "https://popup.example.com/top-level",
                  title: "Popup Top Level"
                })
              ])
            })
          })
        ])
      );
    });

    expect(attachMock).not.toHaveBeenCalledWith({ tabId: 202 }, "1.3", expect.any(Function));

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-review-popup-top-level-live-bridge",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "nav.review",
      payload: {
        maxChars: 4096,
        targetId: "tab-202"
      }
    });

    await vi.waitFor(() => {
      expect(sendCommandMock).toHaveBeenCalledWith(
        { tabId: 101, sessionId: "popup-session-202" },
        "Accessibility.getFullAXTree",
        {},
        expect.any(Function)
      );
      expect(
        sendCommandMock.mock.calls.some(([debuggee, method]) => (
          (debuggee as { tabId?: number; sessionId?: string }).tabId === 202
          && (debuggee as { sessionId?: string }).sessionId === undefined
          && method === "Accessibility.getFullAXTree"
        ))
      ).toBe(false);
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-review-popup-top-level-live-bridge",
            payload: expect.objectContaining({
              targetId: "tab-202",
              title: "Popup Top Level",
              url: "https://popup.example.com/top-level",
              content: expect.stringContaining("Popup CTA")
            })
          })
        ])
      );
    });
  });

  it("hydrates popup opener ownership from router metadata when popup creation omits openerTabId", async () => {
    const { mock, runtime, sent, session, rootSessionId } = await createPopupRuntimeHarness();
    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;
    const sendCommandMock = globalThis.chrome.debugger.sendCommand as unknown as ReturnType<typeof vi.fn>;
    const getTargetsMock = globalThis.chrome.debugger.getTargets as unknown as ReturnType<typeof vi.fn>;
    const resolveDebuggeeTabId = (debuggee: chrome.debugger.Debuggee): number | null => {
      if (typeof debuggee.tabId === "number") {
        return debuggee.tabId;
      }
      if (typeof debuggee.targetId === "string" && debuggee.targetId.startsWith("target-")) {
        const parsed = Number.parseInt(debuggee.targetId.slice("target-".length), 10);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    };

    getTargetsMock.mockImplementation((callback: (result: chrome.debugger.TargetInfo[]) => void) => {
      callback([
        {
          id: "target-101",
          tabId: 101,
          type: "page",
          title: "Root Page",
          url: "https://example.com/root",
          attached: false
        },
        {
          id: "popup-202",
          tabId: 202,
          type: "page",
          title: "about:blank",
          url: "about:blank",
          attached: false
        }
      ] as chrome.debugger.TargetInfo[]);
    });

    mock.emitDebuggerEvent(
      { sessionId: rootSessionId },
      "Target.targetCreated",
      {
        targetInfo: {
          targetId: "popup-202",
          type: "page",
          title: "about:blank",
          url: "about:blank",
          openerId: "target-101"
        }
      }
    );

    attachMock.mockClear();
    attachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      if (tabId === 202) {
        globalThis.chrome.runtime.lastError = { message: "Not allowed" } as never;
        callback();
        globalThis.chrome.runtime.lastError = null as never;
        return;
      }
      globalThis.chrome.runtime.lastError = null as never;
      callback();
    });

    sendCommandMock.mockClear();
    sendCommandMock.mockImplementation((debuggee: chrome.debugger.Debuggee, method: string, params: object, callback: (result?: unknown) => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      const sessionId = (debuggee as { sessionId?: string }).sessionId;
      if (tabId === 101 && typeof sessionId !== "string") {
        globalThis.chrome.runtime.lastError = null as never;
        if (method === "Target.getTargets") {
          callback({
            targetInfos: [
              {
                targetId: "root-101",
                type: "page",
                url: "https://example.com/root",
                title: "Root Page"
              },
              {
                targetId: "popup-202",
                type: "page",
                url: "about:blank",
                title: "about:blank",
                openerId: "target-101"
              }
            ]
          });
          return;
        }
        if (method === "Target.attachToTarget") {
          expect(params).toEqual({
            targetId: "popup-202",
            flatten: true
          });
          callback({ sessionId: "popup-session-202" });
          return;
        }
      }
      if (tabId === 101 && sessionId === "popup-session-202") {
        globalThis.chrome.runtime.lastError = null as never;
        if (method === "Accessibility.enable" || method === "DOM.enable") {
          callback({});
          return;
        }
        if (method === "Accessibility.getFullAXTree") {
          callback({
            nodes: [{
              nodeId: "ax-popup-hydrated-create-1",
              backendDOMNodeId: 2,
              role: { value: "button" },
              name: { value: "Popup CTA" }
            }]
          });
          return;
        }
        if (method === "DOM.resolveNode") {
          callback({ object: { objectId: "popup-node-hydrated-create-1" } });
          return;
        }
        if (method === "Runtime.callFunctionOn") {
          const declaration = typeof (params as { functionDeclaration?: unknown } | undefined)?.functionDeclaration === "string"
            ? (params as { functionDeclaration: string }).functionDeclaration
            : "";
          if (declaration.includes("querySelectorAll")) {
            callback({ result: { value: "#popup-cta" } });
            return;
          }
          callback({ result: { value: null } });
          return;
        }
      }
      if (tabId === 202) {
        globalThis.chrome.runtime.lastError = {
          message: `Debugger is not attached to the tab with id: ${tabId}.`
        } as never;
        callback(undefined);
        globalThis.chrome.runtime.lastError = null as never;
        return;
      }
      globalThis.chrome.runtime.lastError = null as never;
      callback({});
    });

    const getTabMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getTabMock.mockImplementation(async (tabId: number) => ({
      id: tabId,
      url: tabId === 202 ? "https://popup.example.com/top-level" : "https://example.com/root",
      title: tabId === 202 ? "Popup Top Level" : "Root Page",
      status: "complete",
      active: tabId === 202
    } as chrome.tabs.Tab));

    mock.emitTabCreated({
      id: 202,
      url: "about:blank",
      title: "about:blank",
      status: "loading",
      active: true
    } as chrome.tabs.Tab);
    mock.emitTabUpdated(202, {
      id: 202,
      url: "https://popup.example.com/top-level",
      title: "Popup Top Level",
      status: "complete",
      active: true
    } as chrome.tabs.Tab);

    await vi.waitFor(() => {
      expect(session.targets.get("tab-202")?.openerTargetId).toBe(session.targetId);
      expect(session.activeTargetId).toBe("tab-101");
    });

    expect(
      attachMock.mock.calls.some(([debuggee]) => ((debuggee as { tabId?: number }).tabId === 202))
    ).toBe(false);
  });

  it("adopts a popup on tab update when router opener metadata arrives after tab creation", async () => {
    const { mock, runtime, session, rootSessionId } = await createPopupRuntimeHarness();
    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;
    const sendCommandMock = globalThis.chrome.debugger.sendCommand as unknown as ReturnType<typeof vi.fn>;
    const getTargetsMock = globalThis.chrome.debugger.getTargets as unknown as ReturnType<typeof vi.fn>;
    const resolveDebuggeeTabId = (debuggee: chrome.debugger.Debuggee): number | null => {
      if (typeof debuggee.tabId === "number") {
        return debuggee.tabId;
      }
      if (typeof debuggee.targetId === "string" && debuggee.targetId.startsWith("target-")) {
        const parsed = Number.parseInt(debuggee.targetId.slice("target-".length), 10);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    };

    let openerReady = false;
    getTargetsMock.mockImplementation((callback: (result: chrome.debugger.TargetInfo[]) => void) => {
      callback([
        {
          id: "target-101",
          tabId: 101,
          type: "page",
          title: "Root Page",
          url: "https://example.com/root",
          attached: false
        },
        {
          id: "popup-202",
          tabId: 202,
          type: "page",
          title: openerReady ? "Popup Top Level" : "about:blank",
          url: openerReady ? "https://popup.example.com/top-level" : "about:blank",
          ...(openerReady ? { openerId: "target-101" } : {}),
          attached: false
        }
      ] as chrome.debugger.TargetInfo[]);
    });

    attachMock.mockClear();
    attachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      if (tabId === 202) {
        globalThis.chrome.runtime.lastError = { message: "Not allowed" } as never;
        callback();
        globalThis.chrome.runtime.lastError = null as never;
        return;
      }
      globalThis.chrome.runtime.lastError = null as never;
      callback();
    });

    sendCommandMock.mockClear();
    sendCommandMock.mockImplementation((debuggee: chrome.debugger.Debuggee, method: string, params: object, callback: (result?: unknown) => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      const sessionId = (debuggee as { sessionId?: string }).sessionId;
      if (tabId === 101 && typeof sessionId !== "string") {
        globalThis.chrome.runtime.lastError = null as never;
        if (method === "Target.getTargets") {
          callback({
            targetInfos: [
              {
                targetId: "target-101",
                type: "page",
                url: "https://example.com/root",
                title: "Root Page"
              },
              {
                targetId: "popup-202",
                type: "page",
                url: openerReady ? "https://popup.example.com/top-level" : "about:blank",
                title: openerReady ? "Popup Top Level" : "about:blank",
                ...(openerReady ? { openerId: "target-101" } : {})
              }
            ]
          });
          return;
        }
        if (method === "Target.attachToTarget") {
          expect(params).toEqual({
            targetId: "popup-202",
            flatten: true
          });
          callback({ sessionId: "popup-session-202" });
          return;
        }
      }
      if (tabId === 101 && sessionId === "popup-session-202") {
        globalThis.chrome.runtime.lastError = null as never;
        if (method === "Accessibility.enable" || method === "DOM.enable") {
          callback({});
          return;
        }
      }
      if (tabId === 202) {
        globalThis.chrome.runtime.lastError = {
          message: `Debugger is not attached to the tab with id: ${tabId}.`
        } as never;
        callback(undefined);
        globalThis.chrome.runtime.lastError = null as never;
        return;
      }
      globalThis.chrome.runtime.lastError = null as never;
      callback({});
    });

    const getTabMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getTabMock.mockImplementation(async (tabId: number) => ({
      id: tabId,
      url: tabId === 202 ? "https://popup.example.com/top-level" : "https://example.com/root",
      title: tabId === 202 ? "Popup Top Level" : "Root Page",
      status: "complete",
      active: tabId === 202
    } as chrome.tabs.Tab));

    mock.emitTabCreated({
      id: 202,
      url: "about:blank",
      title: "about:blank",
      status: "loading",
      active: true
    } as chrome.tabs.Tab);

    await flushMicrotasks();
    expect(session.targets.has("tab-202")).toBe(false);

    openerReady = true;
    mock.emitDebuggerEvent(
      { sessionId: rootSessionId },
      "Target.targetCreated",
      {
        targetInfo: {
          targetId: "popup-202",
          type: "page",
          title: "Popup Top Level",
          url: "https://popup.example.com/top-level",
          openerId: "target-101"
        }
      }
    );
    mock.emitTabUpdated(202, {
      id: 202,
      url: "https://popup.example.com/top-level",
      title: "Popup Top Level",
      status: "complete",
      active: true
    } as chrome.tabs.Tab);

    await vi.waitFor(() => {
      expect(session.targets.get("tab-202")?.openerTargetId).toBe(session.targetId);
      expect(session.activeTargetId).toBe("tab-101");
    });

    expect(
      attachMock.mock.calls.some(([debuggee]) => ((debuggee as { tabId?: number }).tabId === 202))
    ).toBe(false);
  });

  it("lists popup targets when created-navigation metadata preserves opener ownership without openerTabId", async () => {
    const { mock, runtime, sent, session } = await createPopupRuntimeHarness();

    mock.emitCreatedNavigationTarget({
      sourceTabId: 101,
      sourceFrameId: 0,
      tabId: 202,
      timeStamp: 1,
      url: "https://popup.example.com/navigation"
    } as chrome.webNavigation.WebNavigationSourceCallbackDetails);

    mock.emitTabCreated({
      id: 202,
      url: "about:blank",
      title: "about:blank",
      status: "loading",
      active: true
    } as chrome.tabs.Tab);
    mock.emitTabUpdated(202, {
      id: 202,
      url: "https://popup.example.com/navigation",
      title: "Popup Navigation",
      status: "complete",
      active: true
    } as chrome.tabs.Tab);

    await vi.waitFor(() => {
      expect(session.targets.has("tab-202")).toBe(true);
      expect(session.targets.get("tab-202")?.openerTargetId).toBe("tab-101");
    });

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-targets-list-created-navigation-popup",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "targets.list",
      payload: {
        includeUrls: true
      }
    });

    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-targets-list-created-navigation-popup",
            payload: expect.objectContaining({
              targets: expect.arrayContaining([
                expect.objectContaining({
                  targetId: "tab-202",
                  title: "Popup Navigation",
                  url: "https://popup.example.com/navigation"
                })
              ])
            })
          })
        ])
      );
    });
  });

  it("lists popup alias targets from router target events using the parsed popup tab id", async () => {
    const { mock, runtime, sent, session, rootSessionId } = await createPopupRuntimeHarness();

    const getTabMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getTabMock.mockImplementation(async (tabId: number) => ({
      id: tabId,
      url: tabId === 202 ? "https://popup.example.com/top-level" : "https://example.com/root",
      title: tabId === 202 ? "Popup Top Level" : "Root Page",
      status: "complete",
      active: tabId === 202
    } as chrome.tabs.Tab));

    mock.emitDebuggerEvent(
      { sessionId: rootSessionId },
      "Target.targetCreated",
      {
        targetInfo: {
          targetId: "tab-202",
          type: "page",
          title: "Popup Top Level",
          url: "https://popup.example.com/top-level",
          openerId: session.targetId
        }
      }
    );

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-targets-list-popup-alias",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "targets.list",
      payload: {
        includeUrls: true
      }
    });

    await vi.waitFor(() => {
      const storedSynthetic = ((runtime as unknown as { sessions: OpsSessionStore }).sessions.get(session.id)?.syntheticTargets
        .get("tab-202"));
      expect(storedSynthetic?.tabId).toBe(202);
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-targets-list-popup-alias",
            payload: expect.objectContaining({
              targets: expect.arrayContaining([
                expect.objectContaining({
                  targetId: "tab-202",
                  title: "Popup Top Level",
                  url: "https://popup.example.com/top-level"
                })
              ])
            })
          })
        ])
      );
    });
  });

  it("retries popup child-session bridging through an attached root session when root Target.attachToTarget is not allowed", async () => {
    const { runtime, sent, session } = await createPopupRuntimeHarness();
    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const popupTarget = sessions.addTarget(session.id, 202, {
      url: "https://popup.example.com/top-level",
      title: "Popup Child",
      openerTargetId: session.targetId
    });

    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;
    const sendCommandMock = globalThis.chrome.debugger.sendCommand as unknown as ReturnType<typeof vi.fn>;
    const resolveDebuggeeTabId = (debuggee: chrome.debugger.Debuggee): number | null => {
      if (typeof debuggee.tabId === "number") {
        return debuggee.tabId;
      }
      if (typeof debuggee.targetId === "string" && debuggee.targetId.startsWith("target-")) {
        const parsed = Number.parseInt(debuggee.targetId.slice("target-".length), 10);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    };

    attachMock.mockClear();
    attachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      if (tabId === 202) {
        globalThis.chrome.runtime.lastError = { message: "Not allowed" } as never;
        callback();
        globalThis.chrome.runtime.lastError = null as never;
        return;
      }
      globalThis.chrome.runtime.lastError = null as never;
      callback();
    });

    sendCommandMock.mockClear();
    sendCommandMock.mockImplementation((debuggee: chrome.debugger.Debuggee, method: string, params: object, callback: (result?: unknown) => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      const sessionId = (debuggee as { sessionId?: string }).sessionId;
      if (tabId === 101 && typeof sessionId !== "string") {
        globalThis.chrome.runtime.lastError = null as never;
        if (method === "Target.getTargets") {
          callback({
            targetInfos: [{
              targetId: "popup-202",
              type: "page",
              url: "https://popup.example.com/top-level",
              title: "Popup Child"
            }]
          });
          return;
        }
        if (method === "Target.attachToTarget") {
          const requestedTargetId = typeof (params as { targetId?: unknown } | undefined)?.targetId === "string"
            ? (params as { targetId: string }).targetId
            : null;
          if (requestedTargetId === "target-101") {
            callback({ sessionId: "root-session-101" });
            return;
          }
          globalThis.chrome.runtime.lastError = { message: "Not allowed" } as never;
          callback(undefined);
          globalThis.chrome.runtime.lastError = null as never;
          return;
        }
      }
      if (tabId === 101 && sessionId === "root-session-101") {
        globalThis.chrome.runtime.lastError = null as never;
        if (method === "Target.attachToTarget") {
          callback({ sessionId: "popup-session-202" });
          return;
        }
      }
      if (tabId === 101 && sessionId === "popup-session-202") {
        globalThis.chrome.runtime.lastError = null as never;
        if (method === "Accessibility.enable" || method === "DOM.enable") {
          callback({});
          return;
        }
        if (method === "Accessibility.getFullAXTree") {
          callback({
            nodes: [{
              nodeId: "ax-popup-browser-session-1",
              backendDOMNodeId: 2,
              role: { value: "button" },
              name: { value: "Popup CTA" }
            }]
          });
          return;
        }
        if (method === "DOM.resolveNode") {
          callback({ object: { objectId: "popup-node-browser-session-1" } });
          return;
        }
        if (method === "Runtime.callFunctionOn") {
          const declaration = typeof (params as { functionDeclaration?: unknown } | undefined)?.functionDeclaration === "string"
            ? (params as { functionDeclaration: string }).functionDeclaration
            : "";
          if (declaration.includes("querySelectorAll")) {
            callback({ result: { value: "#popup-cta" } });
            return;
          }
          callback({ result: { value: null } });
          return;
        }
      }
      if (tabId === 202) {
        globalThis.chrome.runtime.lastError = {
          message: `Debugger is not attached to the tab with id: ${tabId}.`
        } as never;
        callback(undefined);
        globalThis.chrome.runtime.lastError = null as never;
        return;
      }
      globalThis.chrome.runtime.lastError = null as never;
      callback({});
    });

    const getTabMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getTabMock.mockImplementation(async (tabId: number) => ({
      id: tabId,
      url: tabId === 202 ? "https://popup.example.com/top-level" : "https://example.com/root",
      title: tabId === 202 ? "Popup Child" : "Root Page",
      status: "complete",
      active: tabId === 202
    } as chrome.tabs.Tab));

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-target-use-popup-bridge-browser-session",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "targets.use",
      payload: {
        targetId: popupTarget.targetId
      }
    });

    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-target-use-popup-bridge-browser-session",
            payload: expect.objectContaining({
              activeTargetId: "tab-202",
              url: "https://popup.example.com/top-level",
              title: "Popup Child"
            })
          })
        ])
      );
      expect(sendCommandMock).toHaveBeenCalledWith(
        { tabId: 101 },
        "Target.attachToTarget",
        { targetId: "target-101", flatten: true },
        expect.any(Function)
      );
      expect(sendCommandMock).toHaveBeenCalledWith(
        { targetId: "target-101", sessionId: "root-session-101" },
        "Target.attachToTarget",
        { targetId: "popup-202", flatten: true },
        expect.any(Function)
      );
    });

    expect(
      attachMock.mock.calls.some(([debuggee]) => ((debuggee as { tabId?: number }).tabId === 202))
    ).toBe(true);

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-review-popup-bridge-browser-session",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "nav.review",
      payload: {
        maxChars: 4096
      }
    });

    await vi.waitFor(() => {
      expect(sendCommandMock).toHaveBeenCalledWith(
        { tabId: 101, sessionId: "popup-session-202" },
        "Accessibility.getFullAXTree",
        {},
        expect.any(Function)
      );
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-review-popup-bridge-browser-session",
            payload: expect.objectContaining({
              targetId: "tab-202",
              title: "Popup Child",
              url: "https://popup.example.com/top-level",
              content: expect.stringContaining("Popup CTA")
            })
          })
        ])
      );
    });
  });

  it("retries popup child-session bridging through an attached root session when the first root attach returns no session id", async () => {
    const { runtime, sent, session } = await createPopupRuntimeHarness();
    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const popupTarget = sessions.addTarget(session.id, 202, {
      url: "https://popup.example.com/top-level-null",
      title: "Popup Child Null Attach",
      openerTargetId: session.targetId
    });

    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;
    const sendCommandMock = globalThis.chrome.debugger.sendCommand as unknown as ReturnType<typeof vi.fn>;
    const resolveDebuggeeTabId = (debuggee: chrome.debugger.Debuggee): number | null => {
      if (typeof debuggee.tabId === "number") {
        return debuggee.tabId;
      }
      if (typeof debuggee.targetId === "string" && debuggee.targetId.startsWith("target-")) {
        const parsed = Number.parseInt(debuggee.targetId.slice("target-".length), 10);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    };

    attachMock.mockClear();
    attachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      if (tabId === 202) {
        globalThis.chrome.runtime.lastError = { message: "Not allowed" } as never;
        callback();
        globalThis.chrome.runtime.lastError = null as never;
        return;
      }
      globalThis.chrome.runtime.lastError = null as never;
      callback();
    });

    sendCommandMock.mockClear();
    sendCommandMock.mockImplementation((debuggee: chrome.debugger.Debuggee, method: string, params: object, callback: (result?: unknown) => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      const sessionId = (debuggee as { sessionId?: string }).sessionId;
      if (tabId === 101 && typeof sessionId !== "string") {
        globalThis.chrome.runtime.lastError = null as never;
        if (method === "Target.getTargets") {
          callback({
            targetInfos: [{
              targetId: "popup-202",
              type: "page",
              url: "https://popup.example.com/top-level-null",
              title: "Popup Child Null Attach"
            }]
          });
          return;
        }
        if (method === "Target.attachToTarget") {
          const requestedTargetId = typeof (params as { targetId?: unknown } | undefined)?.targetId === "string"
            ? (params as { targetId: string }).targetId
            : null;
          if (requestedTargetId === "popup-202") {
            callback({});
            return;
          }
          if (requestedTargetId === "target-101") {
            callback({ sessionId: "root-session-101" });
            return;
          }
        }
      }
      if (tabId === 101 && sessionId === "root-session-101") {
        globalThis.chrome.runtime.lastError = null as never;
        if (method === "Target.attachToTarget") {
          callback({ sessionId: "popup-session-202" });
          return;
        }
      }
      callback({});
    });

    const getTabMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getTabMock.mockImplementation(async (tabId: number) => ({
      id: tabId,
      url: tabId === 202 ? "https://popup.example.com/top-level-null" : "https://example.com/root",
      title: tabId === 202 ? "Popup Child Null Attach" : "Root Page",
      status: "complete",
      active: tabId === 202
    } as chrome.tabs.Tab));

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-target-use-popup-null-attach-browser-session",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "targets.use",
      payload: {
        targetId: popupTarget.targetId
      }
    });

    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-target-use-popup-null-attach-browser-session",
            payload: expect.objectContaining({
              activeTargetId: "tab-202",
              url: "https://popup.example.com/top-level-null",
              title: "Popup Child Null Attach"
            })
          })
        ])
      );
      expect(sendCommandMock).toHaveBeenCalledWith(
        { tabId: 101 },
        "Target.attachToTarget",
        { targetId: "popup-202", flatten: true },
        expect.any(Function)
      );
      expect(sendCommandMock).toHaveBeenCalledWith(
        { tabId: 101 },
        "Target.attachToTarget",
        { targetId: "target-101", flatten: true },
        expect.any(Function)
      );
      expect(sendCommandMock).toHaveBeenCalledWith(
        { targetId: "target-101", sessionId: "root-session-101" },
        "Target.attachToTarget",
        { targetId: "popup-202", flatten: true },
        expect.any(Function)
      );
    });

    expect(
      attachMock.mock.calls.some(([debuggee]) => ((debuggee as { tabId?: number }).tabId === 202))
    ).toBe(true);
  });

  it("keeps popup creation on the opener bridge path even when a top-level attach would succeed on retry", async () => {
    const { mock, runtime, sent, session } = await createPopupRuntimeHarness();
    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;
    const detachMock = globalThis.chrome.debugger.detach as unknown as ReturnType<typeof vi.fn>;
    const sendCommandMock = globalThis.chrome.debugger.sendCommand as unknown as ReturnType<typeof vi.fn>;
    let attachedTabId: number | null = 101;
    const resolveDebuggeeTabId = (debuggee: chrome.debugger.Debuggee): number | null => {
      if (typeof debuggee.tabId === "number") {
        return debuggee.tabId;
      }
      if (typeof debuggee.targetId === "string" && debuggee.targetId.startsWith("target-")) {
        const parsed = Number.parseInt(debuggee.targetId.slice("target-".length), 10);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    };

    attachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      if (typeof tabId === "number" && attachedTabId !== null && attachedTabId !== tabId) {
        globalThis.chrome.runtime.lastError = { message: "Not allowed" } as never;
        callback();
        globalThis.chrome.runtime.lastError = null as never;
        return;
      }
      attachedTabId = typeof tabId === "number" ? tabId : attachedTabId;
      globalThis.chrome.runtime.lastError = null as never;
      callback();
    });

    detachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, callback: () => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      if (typeof tabId === "number" && attachedTabId === tabId) {
        attachedTabId = null;
      }
      globalThis.chrome.runtime.lastError = null as never;
      callback();
    });

    sendCommandMock.mockClear();
    sendCommandMock.mockImplementation((debuggee: chrome.debugger.Debuggee, method: string, params: object, callback: (result?: unknown) => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      if (typeof tabId === "number" && attachedTabId !== tabId) {
        globalThis.chrome.runtime.lastError = {
          message: `Debugger is not attached to the tab with id: ${tabId}.`
        } as never;
        callback(undefined);
        globalThis.chrome.runtime.lastError = null as never;
        return;
      }
      globalThis.chrome.runtime.lastError = null as never;
      if (method === "Target.attachToTarget") {
        callback({ sessionId: `session-${tabId ?? 0}` });
        return;
      }
      if (
        method === "Accessibility.enable"
        || method === "DOM.enable"
        || method === "Target.setAutoAttach"
        || method === "Target.setDiscoverTargets"
        || method === "Runtime.enable"
        || method === "Network.enable"
        || method === "Performance.enable"
      ) {
        callback({});
        return;
      }
      if (method === "Accessibility.getFullAXTree") {
        callback({
          nodes: [{
            nodeId: "ax-popup-retry-1",
            backendDOMNodeId: 2,
            role: { value: "button" },
            name: { value: "Popup CTA" }
          }]
        });
        return;
      }
      if (method === "DOM.resolveNode") {
        callback({ object: { objectId: "popup-node-retry-1" } });
        return;
      }
      if (method === "Runtime.callFunctionOn") {
        const declaration = typeof (params as { functionDeclaration?: unknown } | undefined)?.functionDeclaration === "string"
          ? (params as { functionDeclaration: string }).functionDeclaration
          : "";
        if (declaration.includes("querySelectorAll")) {
          callback({ result: { value: "#popup-cta" } });
          return;
        }
        callback({ result: { value: null } });
        return;
      }
      callback({});
    });

    const getTabMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getTabMock.mockImplementation(async (tabId: number) => ({
      id: tabId,
      url: tabId === 202 ? "https://popup.example.com/top-level" : "https://example.com/root",
      title: tabId === 202 ? "Popup Top Level" : "Root Page",
      status: "complete",
      active: tabId === 202
    } as chrome.tabs.Tab));

    mock.emitTabCreated({
      id: 202,
      openerTabId: 101,
      url: "about:blank",
      title: "about:blank",
      status: "loading",
      active: true
    } as chrome.tabs.Tab);
    mock.emitTabUpdated(202, {
      id: 202,
      openerTabId: 101,
      url: "https://popup.example.com/top-level",
      title: "Popup Top Level",
      status: "complete",
      active: true
    } as chrome.tabs.Tab);

    await vi.waitFor(() => {
      expect(attachedTabId).toBe(101);
      expect(session.activeTargetId).toBe("tab-101");
    });

    expect(detachMock).not.toHaveBeenCalled();
    expect(attachMock).not.toHaveBeenCalledWith({ tabId: 202 }, "1.3", expect.any(Function));

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-review-popup-retry",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "nav.review",
      payload: {
        maxChars: 4096,
        targetId: "tab-202"
      }
    });

    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-review-popup-retry",
            payload: expect.objectContaining({
              targetId: "tab-202",
              title: "Popup Top Level",
              url: "https://popup.example.com/top-level",
              content: expect.stringContaining("Popup CTA")
            })
          })
        ])
      );
    });
  });

  it("prefers stored canvas target metadata in session.status when live tab lookup disagrees", async () => {
    const sent: Array<{ type?: string; requestId?: string; payload?: unknown }> = [];
    const cdp = {
      detachTab: vi.fn(async () => undefined)
    };

    globalThis.chrome.runtime.getURL = vi.fn((path: string) => `chrome-extension://test/${path}`);

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; requestId?: string; payload?: unknown }),
      cdp: cdp as never
    });

    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const session = sessions.createSession("client-1", 101, "lease-1", { url: "https://root.example", title: "Root" });
    sessions.addTarget(session.id, 202, {
      url: "chrome-extension://test/canvas.html",
      title: "Canvas"
    });
    session.activeTargetId = "tab-202";

    const getTabMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getTabMock.mockImplementation(async (tabId: number) => ({
      id: tabId,
      url: "https://root.example",
      title: "Root",
      status: "complete"
    } as chrome.tabs.Tab));

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-session-status-canvas-race",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: "lease-1",
      command: "session.status",
      payload: {}
    });
    await flushMicrotasks();

    expect(sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "ops_response",
          requestId: "req-session-status-canvas-race",
          payload: expect.objectContaining({
            activeTargetId: "tab-202",
            url: "chrome-extension://test/canvas.html",
            title: "Canvas"
          })
        })
      ])
    );
  });

  it("handles storage.setCookies with validated payloads", async () => {
    const sent: Array<{ type?: string; requestId?: string; payload?: unknown }> = [];
    const cdp = {
      detachTab: vi.fn(async () => undefined),
      sendCommand: vi.fn(async () => ({}))
    };

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; requestId?: string; payload?: unknown }),
      cdp: cdp as never
    });

    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const session = sessions.createSession("client-1", 101, "lease-1", { url: "https://root.example" });

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-cookies",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: "lease-1",
      command: "storage.setCookies",
      payload: {
        requestId: "cookie-import-1",
        strict: true,
        cookies: [{ name: "session", value: "abc123", url: "https://example.com" }]
      }
    });
    await flushMicrotasks();

    expect(cdp.sendCommand).toHaveBeenCalledWith(
      { tabId: 101 },
      "Network.setCookies",
      {
        cookies: [{ name: "session", value: "abc123", url: "https://example.com/" }]
      }
    );
    expect(sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "ops_response",
          requestId: "req-cookies",
          payload: {
            requestId: "cookie-import-1",
            imported: 1,
            rejected: []
          }
        })
      ])
    );
  });

  it("applies the canvas runtime preview bridge through the ops surface", async () => {
    const sent: Array<{ type?: string; requestId?: string; payload?: unknown }> = [];
    const cdp = {
      detachTab: vi.fn(async () => undefined)
    };

    const executeScriptMock = globalThis.chrome.scripting.executeScript as unknown as ReturnType<typeof vi.fn>;
    executeScriptMock.mockResolvedValue([{
      result: {
        ok: true,
        artifact: {
          projection: "bound_app_runtime",
          rootBindingId: "binding-runtime",
          capturedAt: "2026-03-12T12:00:00.000Z",
          hierarchyHash: "node-root:",
          nodes: []
        }
      }
    }]);

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; requestId?: string; payload?: unknown }),
      cdp: cdp as never
    });

    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const session = sessions.createSession("client-1", 101, "lease-1", { url: "https://root.example" });

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-runtime-bridge",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: "lease-1",
      command: "canvas.applyRuntimePreviewBridge",
      payload: {
        bindingId: "binding-runtime",
        rootSelector: "#runtime-root",
        html: "<article data-node-id=\"node-root\"></article>"
      }
    });
    await flushMicrotasks();
    await vi.waitFor(() => {
      expect(sent.length).toBeGreaterThan(0);
    });

    expect(executeScriptMock).toHaveBeenCalledTimes(1);
    expect(sent[0]).toMatchObject({
      type: "ops_response",
      requestId: "req-runtime-bridge",
      payload: {
        ok: true,
        artifact: {
          projection: "bound_app_runtime",
          rootBindingId: "binding-runtime",
          capturedAt: "2026-03-12T12:00:00.000Z",
          hierarchyHash: "node-root:",
          nodes: []
        }
      }
    });
  });

  it("handles preview overlay commands through ops sessions", async () => {
    const sent: Array<{ type?: string; requestId?: string; payload?: unknown; error?: { code?: string } }> = [];
    const cdp = {
      attach: vi.fn(async () => undefined),
      detachTab: vi.fn(async () => undefined)
    };

    const executeScriptMock = globalThis.chrome.scripting.executeScript as unknown as ReturnType<typeof vi.fn>;
    executeScriptMock.mockImplementation(async (details: unknown) => {
      const name = (details as { func?: { name?: string } }).func?.name ?? "";
      const resultByName: Record<string, unknown> = {
        mountCanvasOverlayScript: { overlayState: "mounted" },
        selectCanvasOverlayScript: {
          matched: true,
          selector: "[data-node-id=\"node_card\"]",
          nodeId: "node_card",
          tagName: "div",
          text: "Card",
          id: null,
          className: "preview-card opendevbrowser-canvas-highlight"
        },
        syncCanvasOverlayScript: { overlayState: "mounted" },
        unmountCanvasOverlayScript: true
      };
      return [{ result: resultByName[name] ?? null }];
    });

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; requestId?: string; payload?: unknown; error?: { code?: string } }),
      cdp: cdp as never
    });

    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const session = sessions.createSession("client-1", 101, "lease-1", { url: "https://preview.example", title: "Preview" });

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-overlay-mount",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: "lease-1",
      command: "canvas.overlay.mount",
      payload: {
        targetId: "tab-101",
        mountId: "mount-preview-01",
        title: "Preview Overlay Canvas",
        prototypeId: "proto_preview_default",
        selection: {
          pageId: "page_home",
          nodeId: null,
          targetId: "tab-101"
        }
      }
    });
    await flushMicrotasks();

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-overlay-select",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: "lease-1",
      command: "canvas.overlay.select",
      payload: {
        targetId: "tab-101",
        mountId: "mount-preview-01",
        nodeId: "node_card"
      }
    });
    await flushMicrotasks();

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-overlay-sync",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: "lease-1",
      command: "canvas.overlay.sync",
      payload: {
        targetId: "tab-101",
        mountId: "mount-preview-01",
        title: "Preview Overlay Canvas",
        selection: {
          pageId: "page_home",
          nodeId: "node_card",
          targetId: "tab-101"
        }
      }
    });
    await flushMicrotasks();

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-overlay-unmount",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: "lease-1",
      command: "canvas.overlay.unmount",
      payload: {
        targetId: "tab-101",
        mountId: "mount-preview-01"
      }
    });
    await flushMicrotasks();
    await vi.waitFor(() => {
      expect(sent.filter((message) => message.type === "ops_response")).toHaveLength(4);
    });

    expect(sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "ops_response",
          requestId: "req-overlay-mount",
          payload: expect.objectContaining({
            mountId: "mount-preview-01",
            targetId: "tab-101",
            overlayState: "mounted",
            capabilities: { selection: true, guides: true }
          })
        }),
        expect.objectContaining({
          type: "ops_response",
          requestId: "req-overlay-select",
          payload: expect.objectContaining({
            mountId: "mount-preview-01",
            targetId: "tab-101",
            selection: expect.objectContaining({
              matched: true,
              selector: "[data-node-id=\"node_card\"]",
              nodeId: "node_card"
            })
          })
        }),
        expect.objectContaining({
          type: "ops_response",
          requestId: "req-overlay-sync",
          payload: expect.objectContaining({
            ok: true,
            mountId: "mount-preview-01",
            targetId: "tab-101",
            overlayState: "mounted"
          })
        }),
        expect.objectContaining({
          type: "ops_response",
          requestId: "req-overlay-unmount",
          payload: expect.objectContaining({
            ok: true,
            mountId: "mount-preview-01",
            targetId: "tab-101",
            overlayState: "idle"
          })
        })
      ])
    );
    expect(executeScriptMock.mock.calls.map(([details]) => (details as { func?: { name?: string } }).func?.name)).toEqual([
      "mountCanvasOverlayScript",
      "selectCanvasOverlayScript",
      "syncCanvasOverlayScript",
      "unmountCanvasOverlayScript"
    ]);
  });

  it("registers canvas design tabs into ops sessions and allows clone-page capture", async () => {
    const sent: Array<{ type?: string; requestId?: string; payload?: unknown; error?: { code?: string } }> = [];
    const cdp = {
      attach: vi.fn(async () => undefined),
      detachTab: vi.fn(async () => undefined),
      sendCommand: vi.fn(async () => ({}))
    };

    globalThis.chrome.runtime.getURL = vi.fn((path: string) => `chrome-extension://test/${path}`);
    const getMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getMock.mockImplementation(async (tabId: number) => {
      if (tabId === 202) {
        return {
          id: 202,
          url: "chrome-extension://test/canvas.html",
          title: "Canvas",
          status: "complete"
        } as chrome.tabs.Tab;
      }
      return {
        id: tabId,
        url: "https://root.example",
        title: "Root",
        status: "complete"
      } as chrome.tabs.Tab;
    });

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; requestId?: string; payload?: unknown; error?: { code?: string } }),
      cdp: cdp as never,
      getCanvasPageState: () => ({
        html: "<!doctype html><html><body><main data-surface=\"canvas\"></main></body></html>"
      } as never)
    });

    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const session = sessions.createSession("client-1", 101, "lease-1", { url: "https://root.example", title: "Root" });

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-register-canvas",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: "lease-1",
      command: "targets.registerCanvas",
      payload: { targetId: "tab-202" }
    });
    await flushMicrotasks();
    await vi.waitFor(() => {
      expect(sent.length).toBeGreaterThan(0);
    });

    expect(cdp.attach).toHaveBeenCalledWith(202);
    expect(sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "ops_response",
          requestId: "req-register-canvas",
          payload: expect.objectContaining({
            targetId: "tab-202",
            adopted: true,
            url: "chrome-extension://test/canvas.html"
          })
        })
      ])
    );

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-clone-canvas",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: "lease-1",
      command: "export.clonePage",
      payload: { targetId: "tab-202", sanitize: true }
    });
    await flushMicrotasks();
    await vi.waitFor(() => {
      expect(sent.some((message) => message.requestId === "req-clone-canvas")).toBe(true);
    });

    const executeScriptMock = globalThis.chrome.scripting.executeScript as unknown as ReturnType<typeof vi.fn>;
    expect(executeScriptMock).not.toHaveBeenCalled();
    expect(sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "ops_response",
          requestId: "req-clone-canvas",
          payload: expect.objectContaining({
            capture: expect.objectContaining({
              html: "<body><main data-surface=\"canvas\"></main></body>",
              warnings: ["canvas_state_capture"]
            })
          })
        })
      ])
    );
    expect(sent.some((message) => message.type === "ops_error" && message.requestId === "req-clone-canvas")).toBe(false);
  });

  it("registers and unregisters extension canvas targets through the public helper methods", async () => {
    const cdp = {
      attach: vi.fn(async () => undefined),
      detachTab: vi.fn(async () => undefined),
      sendCommand: vi.fn(async () => ({}))
    };

    globalThis.chrome.runtime.getURL = vi.fn((path: string) => `chrome-extension://test/${path}`);
    const getMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getMock.mockImplementation(async (tabId: number) => {
      if (tabId === 202) {
        return {
          id: 202,
          url: "chrome-extension://test/canvas.html",
          title: "Canvas",
          status: "complete"
        } as chrome.tabs.Tab;
      }
      return {
        id: tabId,
        url: "https://root.example",
        title: "Root",
        status: "complete"
      } as chrome.tabs.Tab;
    });

    const runtime = new OpsRuntime({
      send: () => undefined,
      cdp: cdp as never
    });

    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const session = sessions.createSession("client-1", 101, "lease-1", {
      url: "https://root.example",
      title: "Root"
    });

    await expect(runtime.registerCanvasTargetForSession("missing-session", "tab-202")).resolves.toBeNull();
    await expect(runtime.registerCanvasTargetForSession(session.id, "tab-202")).resolves.toMatchObject({
      targetId: "tab-202",
      adopted: true,
      url: "chrome-extension://test/canvas.html"
    });
    expect(cdp.attach).toHaveBeenCalledWith(202);
    expect(sessions.get(session.id)?.targets.has("tab-202")).toBe(true);
    expect(runtime.unregisterCanvasTargetForSession(session.id, "tab-202")).toBe(true);
    expect(runtime.unregisterCanvasTargetForSession(session.id, "tab-202")).toBe(false);
    expect(runtime.unregisterCanvasTargetForSession(session.id, "tab-101")).toBe(false);
  });

  it("captures live stage media when cached canvas html is stale", async () => {
    const cdp = {
      attach: vi.fn(async () => undefined),
      detachTab: vi.fn(async () => undefined),
      sendCommand: vi.fn(async () => ({}))
    };

    const executeScriptMock = globalThis.chrome.scripting.executeScript as unknown as ReturnType<typeof vi.fn>;
    executeScriptMock.mockResolvedValue([{
      result: "<body><main data-surface=\"canvas\" style=\"position:relative;width:880px;min-height:620px;\"><div data-node-id=\"node_media\"><img src=\"hero.png\" /><video src=\"demo.webm\"></video><audio src=\"demo.mp3\"></audio></div></main></body>"
    }]);

    const runtime = new OpsRuntime({
      send: () => undefined,
      cdp: cdp as never,
      getCanvasPageState: () => ({
        html: "<!doctype html><html><body><main data-surface=\"canvas\"></main></body></html>",
        pendingMutation: true,
        document: {
          documentId: "dc_media",
          title: "Media Canvas",
          pages: [{
            id: "page_home",
            name: "Home",
            path: "/",
            rootNodeId: "node_media",
            prototypeIds: [],
            metadata: {},
            nodes: [{
              id: "node_media",
              kind: "frame",
              name: "Media",
              childIds: [],
              rect: { x: 0, y: 0, width: 320, height: 180 },
              props: { tagName: "video" },
              style: {},
              bindingRefs: {},
              metadata: {}
            }]
          }],
          bindings: [],
          assets: [],
          componentInventory: []
        }
      } as never)
    });

    const capture = await (runtime as unknown as {
      captureCanvasPage: (tabId: number, targetId: string) => Promise<{
        html: string;
        warnings: string[];
        inlineStyles: boolean;
      } | null>;
    }).captureCanvasPage(202, "tab-202");

    expect(executeScriptMock).toHaveBeenCalledTimes(1);
    expect(capture).toMatchObject({
      warnings: ["canvas_state_capture"],
      inlineStyles: true
    });
    expect(capture?.html).toContain("<video");
    expect(capture?.html).toContain("<audio");
    expect(capture?.html).toContain("<img");
  });

  it("falls back to document-derived media capture when live stage probing is unavailable", async () => {
    const cdp = {
      attach: vi.fn(async () => undefined),
      detachTab: vi.fn(async () => undefined),
      sendCommand: vi.fn(async () => ({}))
    };

    const executeScriptMock = globalThis.chrome.scripting.executeScript as unknown as ReturnType<typeof vi.fn>;
    executeScriptMock.mockRejectedValue(new Error("Cannot access extension page context"));

    const runtime = new OpsRuntime({
      send: () => undefined,
      cdp: cdp as never,
      getCanvasPageState: () => ({
        html: "<!doctype html><html><body><main data-surface=\"canvas\"></main></body></html>",
        document: {
          documentId: "dc_media",
          title: "Media Canvas",
          pages: [{
            id: "page_home",
            name: "Home",
            path: "/",
            rootNodeId: "node_image",
            prototypeIds: [],
            metadata: {},
            nodes: [
              {
                id: "node_image",
                kind: "frame",
                name: "Hero Image",
                childIds: [],
                rect: { x: 0, y: 0, width: 320, height: 180 },
                props: { tagName: "img", src: "hero.png", alt: "Hero artwork" },
                style: {},
                bindingRefs: {},
                metadata: {}
              },
              {
                id: "node_video",
                kind: "frame",
                name: "Demo Video",
                childIds: [],
                rect: { x: 340, y: 0, width: 320, height: 180 },
                props: { tagName: "video", src: "demo.webm", poster: "demo.jpg" },
                style: {},
                bindingRefs: {},
                metadata: {}
              },
              {
                id: "node_audio",
                kind: "frame",
                name: "Audio Track",
                childIds: [],
                rect: { x: 0, y: 220, width: 320, height: 72 },
                props: { tagName: "audio", src: "demo.mp3", text: "Narration" },
                style: {},
                bindingRefs: {},
                metadata: {}
              }
            ]
          }],
          bindings: [],
          assets: [],
          componentInventory: []
        }
      } as never)
    });

    const capture = await (runtime as unknown as {
      captureCanvasPage: (tabId: number, targetId: string) => Promise<{
        html: string;
        warnings: string[];
        inlineStyles: boolean;
      } | null>;
    }).captureCanvasPage(202, "tab-202");

    expect(executeScriptMock).toHaveBeenCalledTimes(1);
    expect(capture).toMatchObject({
      warnings: ["canvas_state_capture"],
      inlineStyles: true
    });
    expect(capture?.html).toContain("<img");
    expect(capture?.html).toContain("hero.png");
    expect(capture?.html).toContain("<video");
    expect(capture?.html).toContain("demo.webm");
    expect(capture?.html).toContain("<audio");
    expect(capture?.html).toContain("demo.mp3");
  });

  it("launches startUrl sessions after the created tab resolves to a navigable http page", async () => {
    const sent: Array<{ type?: string; requestId?: string; payload?: unknown; error?: { code?: string } }> = [];
    const cdp = {
      attach: vi.fn(async () => undefined),
      detachTab: vi.fn(async () => undefined),
      sendCommand: vi.fn(async () => ({}))
    };

    const createMock = globalThis.chrome.tabs.create as unknown as ReturnType<typeof vi.fn>;
    const getMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    createMock.mockImplementation((_createProperties, callback) => {
      callback?.({
        id: 404,
        status: "loading",
        url: "chrome://newtab/",
        title: "New Tab"
      } as chrome.tabs.Tab);
    });
    getMock.mockResolvedValue({
      id: 404,
      status: "complete",
      url: "http://127.0.0.1:41731/",
      title: "Canvas Audit Runtime"
    } as chrome.tabs.Tab);

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; requestId?: string; payload?: unknown; error?: { code?: string } }),
      cdp: cdp as never
    });

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-launch-start-url",
      clientId: "client-1",
      command: "session.launch",
      payload: {
        startUrl: "http://127.0.0.1:41731/"
      }
    });
    await vi.waitFor(() => {
      expect(cdp.attach).toHaveBeenCalledWith(404);
    });
    expect(sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "ops_response",
          requestId: "req-launch-start-url",
          payload: expect.objectContaining({
            activeTargetId: "tab-404",
            url: "http://127.0.0.1:41731/",
            title: "Canvas Audit Runtime"
          })
        })
      ])
    );
    expect(sent.some((message) => message.type === "ops_error" && message.error?.code === "restricted_url")).toBe(false);
  });

  it("recovers a blocked attach during session.connect startUrl reuse before returning cdp_attach_failed", async () => {
    vi.useFakeTimers();
    const sent: Array<{ type?: string; requestId?: string; payload?: unknown; error?: { code?: string } }> = [];
    const cdp = {
      attach: vi.fn()
        .mockRejectedValueOnce(new Error("Not allowed"))
        .mockRejectedValueOnce(new Error("Not allowed"))
        .mockResolvedValueOnce(undefined),
      detachTab: vi.fn(async () => undefined),
      markClientClosed: vi.fn(),
      setDiscoverTargetsEnabled: vi.fn(async () => undefined),
      configureAutoAttach: vi.fn(async () => undefined),
      sendCommand: vi.fn(async () => ({}))
    };

    const createMock = globalThis.chrome.tabs.create as unknown as ReturnType<typeof vi.fn>;
    const getMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    createMock.mockImplementation((_createProperties, callback) => {
      callback?.({
        id: 405,
        status: "loading",
        url: "chrome://newtab/",
        title: "New Tab"
      } as chrome.tabs.Tab);
    });
    getMock.mockResolvedValue({
      id: 405,
      status: "complete",
      url: "https://bsky.app/search?q=browser+automation+bluesky",
      title: "Search - Bluesky"
    } as chrome.tabs.Tab);

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; requestId?: string; payload?: unknown; error?: { code?: string } }),
      cdp: cdp as never
    });

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-session-connect-start-url-retry",
      clientId: "client-1",
      command: "session.connect",
      payload: {
        startUrl: "https://bsky.app/search?q=browser+automation+bluesky"
      }
    });

    await vi.advanceTimersByTimeAsync(100);
    await vi.waitFor(() => {
      expect(cdp.attach).toHaveBeenCalledTimes(3);
      expect(cdp.markClientClosed).toHaveBeenCalledTimes(1);
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-session-connect-start-url-retry",
            payload: expect.objectContaining({
              activeTargetId: "tab-405",
              url: "https://bsky.app/search?q=browser+automation+bluesky",
              title: "Search - Bluesky"
            })
          })
        ])
      );
    });

    expect(sent.some((message) => message.type === "ops_error" && message.error?.code === "cdp_attach_failed")).toBe(false);
  });

  it("reuses a requested sessionId and tabId for session.connect recovery", async () => {
    const sent: Array<{ type?: string; requestId?: string; payload?: unknown; error?: { code?: string } }> = [];
    const cdp = {
      attach: vi.fn(async () => undefined),
      detachTab: vi.fn(async () => undefined),
      sendCommand: vi.fn(async () => ({}))
    };

    const getMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getMock.mockResolvedValue({
      id: 202,
      status: "complete",
      url: "https://example.com/recovered",
      title: "Recovered Tab"
    } as chrome.tabs.Tab);

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; requestId?: string; payload?: unknown; error?: { code?: string } }),
      cdp: cdp as never
    });

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-session-recover",
      clientId: "client-1",
      leaseId: "lease-recover",
      command: "session.connect",
      payload: {
        sessionId: "ops-recover",
        tabId: 202
      }
    });
    await vi.waitFor(() => {
      expect(cdp.attach).toHaveBeenCalledWith(202);
    });

    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const session = sessions.get("ops-recover");
    expect(session).not.toBeNull();
    expect(session?.leaseId).toBe("lease-recover");
    expect(sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "ops_response",
          requestId: "req-session-recover",
          payload: expect.objectContaining({
            opsSessionId: "ops-recover",
            activeTargetId: "tab-202",
            url: "https://example.com/recovered",
            title: "Recovered Tab",
            leaseId: "lease-recover"
          })
        })
      ])
    );
  });

  it("enables target discovery and auto-attach during session.launch", async () => {
    const sent: Array<{ type?: string; requestId?: string; payload?: unknown; error?: { code?: string } }> = [];
    const cdp = {
      attach: vi.fn(async () => undefined),
      detachTab: vi.fn(async () => undefined),
      setDiscoverTargetsEnabled: vi.fn(async () => undefined),
      configureAutoAttach: vi.fn(async () => undefined),
      sendCommand: vi.fn(async () => ({}))
    };

    const getMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getMock.mockResolvedValue({
      id: 202,
      status: "complete",
      url: "https://example.com/recovered",
      title: "Recovered Tab"
    } as chrome.tabs.Tab);

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; requestId?: string; payload?: unknown; error?: { code?: string } }),
      cdp: cdp as never
    });

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-session-target-tracking",
      clientId: "client-1",
      command: "session.launch",
      payload: {
        tabId: 202
      }
    });
    await vi.waitFor(() => {
      expect(cdp.attach).toHaveBeenCalledWith(202);
      expect(cdp.setDiscoverTargetsEnabled).toHaveBeenCalledWith(true);
      expect(cdp.configureAutoAttach).toHaveBeenCalledWith({
        autoAttach: true,
        waitForDebuggerOnStart: false,
        flatten: true
      });
    });
    expect(sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "ops_response",
          requestId: "req-session-target-tracking",
          payload: expect.objectContaining({
            activeTargetId: "tab-202",
            url: "https://example.com/recovered",
            title: "Recovered Tab"
          })
        })
      ])
    );
  });

  it("retries a blocked attach during session.launch before returning cdp_attach_failed", async () => {
    vi.useFakeTimers();
    const sent: Array<{ type?: string; requestId?: string; payload?: unknown; error?: { code?: string } }> = [];
    const cdp = {
      attach: vi.fn()
        .mockRejectedValueOnce(new Error("Not allowed"))
        .mockResolvedValueOnce(undefined),
      detachTab: vi.fn(async () => undefined),
      setDiscoverTargetsEnabled: vi.fn(async () => undefined),
      configureAutoAttach: vi.fn(async () => undefined),
      sendCommand: vi.fn(async () => ({}))
    };

    const getMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getMock.mockResolvedValue({
      id: 202,
      status: "complete",
      url: "https://example.com/recovered",
      title: "Recovered Tab"
    } as chrome.tabs.Tab);

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; requestId?: string; payload?: unknown; error?: { code?: string } }),
      cdp: cdp as never
    });

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-session-launch-retry",
      clientId: "client-1",
      command: "session.launch",
      payload: {
        tabId: 202
      }
    });

    await vi.advanceTimersByTimeAsync(50);
    await vi.waitFor(() => {
      expect(cdp.attach).toHaveBeenCalledTimes(2);
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-session-launch-retry",
            payload: expect.objectContaining({
              activeTargetId: "tab-202",
              url: "https://example.com/recovered",
              title: "Recovered Tab"
            })
          })
        ])
      );
    });

    expect(cdp.attach).toHaveBeenNthCalledWith(1, 202);
    expect(cdp.attach).toHaveBeenNthCalledWith(2, 202);
    expect(sent.some((message) => message.type === "ops_error" && message.error?.code === "cdp_attach_failed")).toBe(false);
  });

  it("surfaces root attach diagnostics in session.launch cdp_attach_failed responses", async () => {
    vi.useFakeTimers();
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const sent: Array<{
      type?: string;
      requestId?: string;
      payload?: unknown;
      error?: { code?: string; message?: string; details?: Record<string, unknown> };
    }> = [];
    const cdp = {
      attach: vi.fn().mockRejectedValue(new Error("Not allowed")),
      detachTab: vi.fn(async () => undefined),
      getLastRootAttachDiagnostic: vi.fn(() => ({
        tabId: 202,
        origin: "root_attach" as const,
        stage: "root_debugger_attach_failed" as const,
        attachBy: "tabId" as const,
        reason: "Not allowed",
        at: Date.now()
      })),
      setDiscoverTargetsEnabled: vi.fn(async () => undefined),
      configureAutoAttach: vi.fn(async () => undefined),
      sendCommand: vi.fn(async () => ({}))
    };

    const getMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getMock.mockResolvedValue({
      id: 202,
      status: "complete",
      url: "https://example.com/recovered",
      title: "Recovered Tab"
    } as chrome.tabs.Tab);

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as {
        type?: string;
        requestId?: string;
        payload?: unknown;
        error?: { code?: string; message?: string; details?: Record<string, unknown> };
      }),
      cdp: cdp as never
    });

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-session-launch-root-attach-stage",
      clientId: "client-1",
      command: "session.launch",
      payload: {
        tabId: 202
      }
    });

    await vi.advanceTimersByTimeAsync(50);
    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_error",
            requestId: "req-session-launch-root-attach-stage",
            error: expect.objectContaining({
              code: "cdp_attach_failed",
              message: "Not allowed (origin: root_attach; stage: root_debugger_attach_failed)",
              details: expect.objectContaining({
                origin: "root_attach",
                stage: "root_debugger_attach_failed",
                attachBy: "tabId",
                reason: "Not allowed"
              })
            })
          })
        ])
      );
    });

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[opendevbrowser]",
      expect.stringContaining("\"context\":\"ops.direct_attach_stage\"")
    );
  });

  it("surfaces root attach diagnostics in session.connect startUrl cdp_attach_failed responses after recovery is exhausted", async () => {
    vi.useFakeTimers();
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const sent: Array<{
      type?: string;
      requestId?: string;
      payload?: unknown;
      error?: { code?: string; message?: string; details?: Record<string, unknown> };
    }> = [];
    const cdp = {
      attach: vi.fn().mockImplementation(async () => {
        throw new Error("Not allowed");
      }),
      detachTab: vi.fn(async () => undefined),
      markClientClosed: vi.fn(),
      getLastRootAttachDiagnostic: vi.fn(() => ({
        tabId: 406,
        origin: "root_attach" as const,
        stage: "root_debugger_attach_failed" as const,
        attachBy: "tabId" as const,
        reason: "Not allowed",
        at: Date.now()
      })),
      setDiscoverTargetsEnabled: vi.fn(async () => undefined),
      configureAutoAttach: vi.fn(async () => undefined),
      sendCommand: vi.fn(async () => ({}))
    };

    const createMock = globalThis.chrome.tabs.create as unknown as ReturnType<typeof vi.fn>;
    const getMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    createMock.mockImplementation((_createProperties, callback) => {
      callback?.({
        id: 406,
        status: "loading",
        url: "chrome://newtab/",
        title: "New Tab"
      } as chrome.tabs.Tab);
    });
    getMock.mockResolvedValue({
      id: 406,
      status: "complete",
      url: "https://bsky.app/search?q=browser+automation+bluesky",
      title: "Search - Bluesky"
    } as chrome.tabs.Tab);

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as {
        type?: string;
        requestId?: string;
        payload?: unknown;
        error?: { code?: string; message?: string; details?: Record<string, unknown> };
      }),
      cdp: cdp as never
    });

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-session-connect-start-url-root-attach-stage",
      clientId: "client-1",
      command: "session.connect",
      payload: {
        startUrl: "https://bsky.app/search?q=browser+automation+bluesky"
      }
    });

    await vi.advanceTimersByTimeAsync(100);
    await vi.waitFor(() => {
      expect(cdp.markClientClosed).toHaveBeenCalledTimes(1);
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_error",
            requestId: "req-session-connect-start-url-root-attach-stage",
            error: expect.objectContaining({
              code: "cdp_attach_failed",
              message: "Not allowed (origin: root_attach; stage: root_debugger_attach_failed)",
              details: expect.objectContaining({
                origin: "root_attach",
                stage: "root_debugger_attach_failed",
                attachBy: "tabId",
                reason: "Not allowed"
              })
            })
          })
        ])
      );
    });

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[opendevbrowser]",
      expect.stringContaining("\"context\":\"ops.direct_attach_stage\"")
    );
  });

  it("surfaces flat-session bootstrap diagnostics in session.launch cdp_attach_failed responses", async () => {
    vi.useFakeTimers();
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const sent: Array<{
      type?: string;
      requestId?: string;
      payload?: unknown;
      error?: { code?: string; message?: string; details?: Record<string, unknown> };
    }> = [];
    const cdp = {
      attach: vi.fn().mockRejectedValue(
        new Error("Chrome 125+ required for extension relay (flat sessions). (Not allowed)")
      ),
      detachTab: vi.fn(async () => undefined),
      getLastRootAttachDiagnostic: vi.fn(() => ({
        tabId: 202,
        origin: "flat_session_bootstrap" as const,
        stage: "fallback_flat_session_probe_failed" as const,
        attachBy: "targetId" as const,
        probeMethod: "Target.setAutoAttach" as const,
        reason: "Chrome 125+ required for extension relay (flat sessions). (Not allowed)",
        at: Date.now()
      })),
      setDiscoverTargetsEnabled: vi.fn(async () => undefined),
      configureAutoAttach: vi.fn(async () => undefined),
      sendCommand: vi.fn(async () => ({}))
    };

    const getMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getMock.mockResolvedValue({
      id: 202,
      status: "complete",
      url: "https://example.com/recovered",
      title: "Recovered Tab"
    } as chrome.tabs.Tab);

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as {
        type?: string;
        requestId?: string;
        payload?: unknown;
        error?: { code?: string; message?: string; details?: Record<string, unknown> };
      }),
      cdp: cdp as never
    });

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-session-launch-bootstrap-stage",
      clientId: "client-1",
      command: "session.launch",
      payload: {
        tabId: 202
      }
    });

    await vi.advanceTimersByTimeAsync(50);
    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_error",
            requestId: "req-session-launch-bootstrap-stage",
            error: expect.objectContaining({
              code: "cdp_attach_failed",
              message: "Chrome 125+ required for extension relay (flat sessions). (Not allowed) (origin: flat_session_bootstrap; stage: fallback_flat_session_probe_failed)",
              details: expect.objectContaining({
                origin: "flat_session_bootstrap",
                stage: "fallback_flat_session_probe_failed",
                attachBy: "targetId",
                probeMethod: "Target.setAutoAttach",
                reason: "Chrome 125+ required for extension relay (flat sessions). (Not allowed)"
              })
            })
          })
        ])
      );
    });

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[opendevbrowser]",
      expect.stringContaining("\"context\":\"ops.direct_attach_stage\"")
    );
  });

  it("falls back to the first attachable http tab when session.launch sees a restricted active tab", async () => {
    const sent: Array<{ type?: string; requestId?: string; payload?: unknown; error?: { code?: string } }> = [];
    const cdp = {
      attach: vi.fn(async () => undefined),
      detachTab: vi.fn(async () => undefined),
      sendCommand: vi.fn(async () => ({}))
    };

    const queryMock = globalThis.chrome.tabs.query as unknown as ReturnType<typeof vi.fn>;
    queryMock.mockImplementation(async (queryInfo?: chrome.tabs.QueryInfo) => {
      if (queryInfo?.active) {
        return [{
          id: 101,
          status: "complete",
          url: "chrome://newtab/",
          title: "New Tab",
          active: true
        } as chrome.tabs.Tab];
      }
      return [
        {
          id: 101,
          status: "complete",
          url: "chrome://newtab/",
          title: "New Tab",
          active: true
        } as chrome.tabs.Tab,
        {
          id: 202,
          status: "complete",
          url: "https://www.facebook.com/search/top/?q=browser%20automation",
          title: "Facebook Search"
        } as chrome.tabs.Tab
      ];
    });

    const getMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getMock.mockImplementation(async (tabId: number) => {
      if (tabId === 202) {
        return {
          id: 202,
          status: "complete",
          url: "https://www.facebook.com/search/top/?q=browser%20automation",
          title: "Facebook Search"
        } as chrome.tabs.Tab;
      }
      if (tabId === 101) {
        return {
          id: 101,
          status: "complete",
          url: "chrome://newtab/",
          title: "New Tab"
        } as chrome.tabs.Tab;
      }
      return null;
    });

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; requestId?: string; payload?: unknown; error?: { code?: string } }),
      cdp: cdp as never
    });

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-launch-fallback-http",
      clientId: "client-1",
      command: "session.launch",
      payload: {}
    });
    await vi.waitFor(() => {
      expect(cdp.attach).toHaveBeenCalledWith(202);
    });

    expect(sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "ops_response",
          requestId: "req-launch-fallback-http",
          payload: expect.objectContaining({
            activeTargetId: "tab-202",
            url: "https://www.facebook.com/search/top/?q=browser%20automation",
            title: "Facebook Search"
          })
        })
      ])
    );
    expect(sent.some((message) => message.type === "ops_error" && message.error?.code === "restricted_url")).toBe(false);
  });

  it("rejects strict storage.setCookies payloads with invalid entries", async () => {
    const sent: Array<{ type?: string; requestId?: string; error?: { code?: string; message?: string } }> = [];
    const cdp = {
      detachTab: vi.fn(async () => undefined),
      sendCommand: vi.fn(async () => ({}))
    };

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; requestId?: string; error?: { code?: string; message?: string } }),
      cdp: cdp as never
    });

    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const session = sessions.createSession("client-1", 101, "lease-1", { url: "https://root.example" });

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-cookies-invalid",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: "lease-1",
      command: "storage.setCookies",
      payload: {
        requestId: "cookie-import-2",
        strict: true,
        cookies: [{ name: "session", value: "abc123", domain: ".example.com", sameSite: "None", secure: false }]
      }
    });
    await flushMicrotasks();

    expect(cdp.sendCommand).not.toHaveBeenCalled();
    expect(sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "ops_error",
          requestId: "req-cookies-invalid",
          error: expect.objectContaining({
            code: "invalid_request",
            message: "Cookie import rejected 1 entries."
          })
        })
      ])
    );
  });

  it("routes canvas target clicks through the canvas page bridge", async () => {
    const sent: Array<{ type?: string; requestId?: string; payload?: unknown; error?: { code?: string } }> = [];
    const cdp = {
      attach: vi.fn(async () => undefined),
      detachTab: vi.fn(async () => undefined),
      sendCommand: vi.fn(async () => ({}))
    };
    const performCanvasPageAction = vi.fn(async () => true);
    globalThis.chrome.runtime.getURL = vi.fn((path: string) => `chrome-extension://test/${path}`);

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; requestId?: string; payload?: unknown; error?: { code?: string } }),
      cdp: cdp as never,
      performCanvasPageAction
    });

    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const session = sessions.createSession("client-1", 101, "lease-1", { url: "https://root.example", title: "Root" });
    sessions.addTarget(session.id, 202, {
      url: "chrome-extension://test/canvas.html",
      title: "Canvas"
    });
    session.activeTargetId = "tab-202";
    session.refStore.setSnapshot("tab-202", [{
      ref: "r1",
      selector: "[data-node-id='node_root']",
      backendNodeId: 1,
      role: "button",
      name: "Hero Card"
    }]);

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-canvas-click",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: "lease-1",
      command: "interact.click",
      payload: {
        ref: "r1",
        targetId: "tab-202"
      }
    });
    await vi.waitFor(() => {
      expect(performCanvasPageAction).toHaveBeenCalledWith(
        "tab-202",
        { type: "click" },
        "[data-node-id='node_root']"
      );
    });
    expect(sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "ops_response",
          requestId: "req-canvas-click",
          payload: expect.objectContaining({ navigated: false })
        })
      ])
    );
  });

  it("renders html data urls into extension targets and reports the synthetic target url", async () => {
    const sent: Array<{ type?: string; requestId?: string; payload?: unknown }> = [];
    const cdp = {
      detachTab: vi.fn(async () => undefined),
      sendCommand: vi.fn(async () => ({}))
    };

    const getMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getMock.mockResolvedValue({
      id: 101,
      status: "complete",
      url: "https://example.com/",
      title: "Example Domain"
    } as chrome.tabs.Tab);
    const executeScriptMock = globalThis.chrome.scripting.executeScript as unknown as ReturnType<typeof vi.fn>;
    executeScriptMock.mockImplementation((_details, callback?: (results?: chrome.scripting.InjectionResult<unknown>[]) => void) => {
      callback?.([{ result: { title: "Synthetic Preview" } } as chrome.scripting.InjectionResult<unknown>]);
    });

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; requestId?: string; payload?: unknown }),
      cdp: cdp as never
    });

    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const session = sessions.createSession("client-1", 101, "lease-1", { url: "https://example.com/" });
    const syntheticUrl = "data:text/html;charset=utf-8,%3Ctitle%3ESynthetic%20Preview%3C%2Ftitle%3E%3Ch1%3Ehello%3C%2Fh1%3E";

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-data-goto",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: "lease-1",
      command: "nav.goto",
      payload: {
        targetId: "tab-101",
        url: syntheticUrl,
        timeoutMs: 1000
      }
    });
    await vi.waitFor(() => {
      expect(executeScriptMock).toHaveBeenCalledTimes(1);
      const storedSession = sessions.get(session.id) as {
        syntheticTargets?: Map<string, { url: string; title?: string }>;
      } | null;
      expect(storedSession?.syntheticTargets?.get("tab-101")?.url).toBe(syntheticUrl);
      expect(storedSession?.syntheticTargets?.get("tab-101")?.title).toBe("Synthetic Preview");
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-data-goto",
            payload: expect.objectContaining({
              finalUrl: syntheticUrl
            })
          })
        ])
      );
    });

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-targets-list",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: "lease-1",
      command: "targets.list",
      payload: {
        includeUrls: true
      }
    });
    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-targets-list",
            payload: expect.objectContaining({
              targets: expect.arrayContaining([
                expect.objectContaining({
                  targetId: "tab-101",
                  url: syntheticUrl,
                  title: "Synthetic Preview"
                })
              ])
            })
          })
        ])
      );
    });

    expect(sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "ops_response",
          requestId: "req-targets-list",
          payload: expect.objectContaining({
            targets: expect.arrayContaining([
              expect.objectContaining({
                targetId: "tab-101",
                url: syntheticUrl,
                title: "Synthetic Preview"
              })
            ])
          })
        })
      ])
    );
  });

  it("allows follow-up nav.wait commands on the synthetic root target after html data preview navigation", async () => {
    const sent: Array<{ type?: string; requestId?: string; payload?: unknown; error?: { code?: string } }> = [];
    const cdp = {
      detachTab: vi.fn(async () => undefined),
      sendCommand: vi.fn(async () => ({}))
    };

    const getMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getMock.mockResolvedValue({
      id: 101,
      status: "complete",
      url: "https://example.com/",
      title: "Example Domain"
    } as chrome.tabs.Tab);
    const executeScriptMock = globalThis.chrome.scripting.executeScript as unknown as ReturnType<typeof vi.fn>;
    executeScriptMock.mockImplementation((_details, callback?: (results?: chrome.scripting.InjectionResult<unknown>[]) => void) => {
      callback?.([{ result: { title: "Synthetic Preview" } } as chrome.scripting.InjectionResult<unknown>]);
    });

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; requestId?: string; payload?: unknown; error?: { code?: string } }),
      cdp: cdp as never
    });

    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const session = sessions.createSession("client-1", 101, "lease-1", { url: "https://example.com/" });
    const syntheticUrl = "data:text/html;charset=utf-8,%3Ctitle%3ESynthetic%20Preview%3C%2Ftitle%3E%3Ch1%3Ehello%3C%2Fh1%3E";

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-data-goto-followup",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "nav.goto",
      payload: {
        targetId: "tab-101",
        url: syntheticUrl,
        timeoutMs: 1000
      }
    });
    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-data-goto-followup",
            payload: expect.objectContaining({
              finalUrl: syntheticUrl
            })
          })
        ])
      );
    });

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-data-wait-followup",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "nav.wait",
      payload: {
        targetId: "tab-101",
        timeoutMs: 1000
      }
    });
    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-data-wait-followup",
            payload: expect.objectContaining({
              timingMs: expect.any(Number)
            })
          })
        ])
      );
    });

    expect(sent.some((message) => message.type === "ops_error" && message.requestId === "req-data-wait-followup")).toBe(false);
  });

  it("allows follow-up page.screenshot commands on the synthetic root target after html data preview navigation", async () => {
    const sent: Array<{ type?: string; requestId?: string; payload?: unknown; error?: { code?: string } }> = [];
    const cdp = {
      detachTab: vi.fn(async () => undefined),
      sendCommand: vi.fn(async (_debuggee, method) => {
        if (method === "Page.captureScreenshot") {
          return { data: "ZmFrZQ==" };
        }
        return {};
      })
    };

    const getMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getMock.mockResolvedValue({
      id: 101,
      status: "complete",
      url: "https://example.com/",
      title: "Example Domain"
    } as chrome.tabs.Tab);
    const executeScriptMock = globalThis.chrome.scripting.executeScript as unknown as ReturnType<typeof vi.fn>;
    executeScriptMock.mockImplementation((_details, callback?: (results?: chrome.scripting.InjectionResult<unknown>[]) => void) => {
      callback?.([{ result: { title: "Synthetic Preview" } } as chrome.scripting.InjectionResult<unknown>]);
    });

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; requestId?: string; payload?: unknown; error?: { code?: string } }),
      cdp: cdp as never
    });

    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const session = sessions.createSession("client-1", 101, "lease-1", { url: "https://example.com/" });
    const syntheticUrl = "data:text/html;charset=utf-8,%3Ctitle%3ESynthetic%20Preview%3C%2Ftitle%3E%3Ch1%3Ehello%3C%2Fh1%3E";

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-data-goto-screenshot-followup",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "nav.goto",
      payload: {
        targetId: "tab-101",
        url: syntheticUrl,
        timeoutMs: 1000
      }
    });
    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-data-goto-screenshot-followup",
            payload: expect.objectContaining({
              finalUrl: syntheticUrl
            })
          })
        ])
      );
    });

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-data-screenshot-followup",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "page.screenshot",
      payload: {
        targetId: "tab-101"
      }
    });
    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-data-screenshot-followup",
            payload: expect.objectContaining({
              base64: "ZmFrZQ=="
            })
          })
        ])
      );
    });

    expect(sent.some((message) => (
      message.type === "ops_error"
      && message.requestId === "req-data-screenshot-followup"
      && message.error?.code === "restricted_url"
    ))).toBe(false);
  });

  it("allows follow-up devtools.perf commands on the synthetic root target after html data preview navigation", async () => {
    const sent: Array<{ type?: string; requestId?: string; payload?: unknown; error?: { code?: string } }> = [];
    const cdp = {
      detachTab: vi.fn(async () => undefined),
      sendCommand: vi.fn(async (_debuggee, method) => {
        if (method === "Performance.getMetrics") {
          return {
            metrics: [{ name: "LayoutCount", value: 1 }]
          };
        }
        return {};
      })
    };

    const getMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getMock.mockResolvedValue({
      id: 101,
      status: "complete",
      url: "https://example.com/",
      title: "Example Domain"
    } as chrome.tabs.Tab);
    const executeScriptMock = globalThis.chrome.scripting.executeScript as unknown as ReturnType<typeof vi.fn>;
    executeScriptMock.mockImplementation((_details, callback?: (results?: chrome.scripting.InjectionResult<unknown>[]) => void) => {
      callback?.([{ result: { title: "Synthetic Preview" } } as chrome.scripting.InjectionResult<unknown>]);
    });

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; requestId?: string; payload?: unknown; error?: { code?: string } }),
      cdp: cdp as never
    });

    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const session = sessions.createSession("client-1", 101, "lease-1", { url: "https://example.com/" });
    const syntheticUrl = "data:text/html;charset=utf-8,%3Ctitle%3ESynthetic%20Preview%3C%2Ftitle%3E%3Ch1%3Ehello%3C%2Fh1%3E";

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-data-goto-perf-followup",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "nav.goto",
      payload: {
        targetId: "tab-101",
        url: syntheticUrl,
        timeoutMs: 1000
      }
    });
    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-data-goto-perf-followup",
            payload: expect.objectContaining({
              finalUrl: syntheticUrl
            })
          })
        ])
      );
    });

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-data-perf-followup",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "devtools.perf",
      payload: {
        targetId: "tab-101"
      }
    });
    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-data-perf-followup",
            payload: expect.objectContaining({
              metrics: [{ name: "LayoutCount", value: 1 }]
            })
          })
        ])
      );
    });

    expect(sent.some((message) => (
      message.type === "ops_error"
      && message.requestId === "req-data-perf-followup"
      && message.error?.code === "restricted_url"
    ))).toBe(false);
  });

  it("allows follow-up page.screenshot commands on registered canvas targets after html preview navigation", async () => {
    const sent: Array<{ type?: string; requestId?: string; payload?: unknown; error?: { code?: string } }> = [];
    const cdp = {
      detachTab: vi.fn(async () => undefined),
      sendCommand: vi.fn(async (_debuggee, method) => {
        if (method === "Page.captureScreenshot") {
          return { data: "ZmFrZQ==" };
        }
        return {};
      })
    };

    globalThis.chrome.runtime.getURL = vi.fn((path: string) => `chrome-extension://test/${path}`);
    const getMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getMock.mockImplementation(async (tabId: number) => {
      if (tabId === 202) {
        return {
          id: 202,
          status: "complete",
          url: "chrome-extension://test/canvas.html",
          title: "Canvas"
        } as chrome.tabs.Tab;
      }
      return {
        id: 101,
        status: "complete",
        url: "https://example.com/root",
        title: "Root Page"
      } as chrome.tabs.Tab;
    });
    const executeScriptMock = globalThis.chrome.scripting.executeScript as unknown as ReturnType<typeof vi.fn>;
    executeScriptMock.mockImplementation((_details, callback?: (results?: chrome.scripting.InjectionResult<unknown>[]) => void) => {
      callback?.([{ result: { title: "Synthetic Preview" } } as chrome.scripting.InjectionResult<unknown>]);
    });

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; requestId?: string; payload?: unknown; error?: { code?: string } }),
      cdp: cdp as never
    });

    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const session = sessions.createSession("client-1", 101, "lease-1", {
      url: "https://example.com/root",
      title: "Root Page"
    });
    sessions.addTarget(session.id, 202, {
      url: "chrome-extension://test/canvas.html",
      title: "Canvas"
    });
    session.activeTargetId = "tab-101";
    const syntheticUrl = "data:text/html;charset=utf-8,%3Ctitle%3ESynthetic%20Preview%3C%2Ftitle%3E%3Ch1%3Ehello%3C%2Fh1%3E";

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-canvas-data-goto",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "nav.goto",
      payload: {
        targetId: "tab-202",
        url: syntheticUrl,
        timeoutMs: 1000
      }
    });
    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-canvas-data-goto",
            payload: expect.objectContaining({
              finalUrl: syntheticUrl
            })
          })
        ])
      );
    });

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-canvas-screenshot-followup",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "page.screenshot",
      payload: {
        targetId: "tab-202"
      }
    });
    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-canvas-screenshot-followup",
            payload: expect.objectContaining({
              base64: "ZmFrZQ=="
            })
          })
        ])
      );
    });

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-root-status-followup",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "session.status",
      payload: {}
    });
    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-root-status-followup",
            payload: expect.objectContaining({
              activeTargetId: "tab-101",
              url: "https://example.com/root",
              title: "Root Page"
            })
          })
        ])
      );
    });

    expect(sent.some((message) => (
      message.type === "ops_error"
      && message.requestId === "req-canvas-screenshot-followup"
      && message.error?.code === "restricted_url"
    ))).toBe(false);
  });

  it("returns retry guidance when a popup target has not finished attaching", async () => {
    const { mock, runtime, sent, session, rootSessionId } = await createPopupRuntimeHarness();
    const sendCommandMock = globalThis.chrome.debugger.sendCommand as unknown as ReturnType<typeof vi.fn>;
    sendCommandMock.mockClear();

    mock.emitDebuggerEvent(
      { sessionId: rootSessionId },
      "Target.targetCreated",
      {
        targetInfo: {
          targetId: "popup-303",
          type: "page",
          url: "https://popup.example.com/attach",
          title: "Popup Pending",
          openerId: "tab-101"
        }
      }
    );
    session.refStore.setSnapshot("popup-303", [{
      ref: "r1",
      selector: "#popup-cta",
      backendNodeId: 3,
      role: "button",
      name: "Popup CTA"
    }]);

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-popup-click-pending",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "interact.click",
      payload: {
        ref: "r1",
        targetId: "popup-303"
      }
    });
    await flushMicrotasks();

    expect(sendCommandMock).not.toHaveBeenCalled();
    expect(sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "ops_error",
          requestId: "req-popup-click-pending",
          error: expect.objectContaining({
            code: "execution_failed",
            retryable: true,
            message: "Popup target has not finished attaching yet. Take a new review or snapshot and retry."
          })
        })
      ])
    );
  });

  it("returns a review payload for an explicitly targeted top-level popup when cached popup snapshot state is already available", async () => {
    const { mock, router, runtime, sent, session } = await createPopupRuntimeHarness();
    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;
    const sendCommandMock = globalThis.chrome.debugger.sendCommand as unknown as ReturnType<typeof vi.fn>;
    sendCommandMock.mockClear();

    attachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
      if ((debuggee as { tabId?: number }).tabId === 202) {
        mock.setRuntimeError("Not allowed");
        callback();
        mock.setRuntimeError(null);
        return;
      }
      callback();
    });

    mock.emitTabCreated({
      id: 202,
      openerTabId: 101,
      url: "about:blank",
      title: "about:blank",
      status: "loading",
      active: true
    } as chrome.tabs.Tab);
    mock.emitTabUpdated(202, {
      id: 202,
      openerTabId: 101,
      url: "https://popup.example.com/pending",
      title: "Popup Pending",
      status: "complete",
      active: true
    } as chrome.tabs.Tab);

    await vi.waitFor(() => {
      expect(session.targets.has("tab-202")).toBe(true);
    });

    session.refStore.setSnapshot("tab-202", [{
      ref: "r1",
      selector: "#popup-cta",
      backendNodeId: 4,
      role: "button",
      name: "Popup CTA"
    }]);

    expect(session.activeTargetId).toBe("tab-101");

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-popup-review-pending-top-level",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "nav.review",
      payload: {
        maxChars: 4096,
        targetId: "tab-202"
      }
    });
    await vi.waitFor(() => {
      expect(
        sendCommandMock.mock.calls.some(([debuggee, method]) => (
          (debuggee as { tabId?: number; sessionId?: string }).tabId === 202
          && (debuggee as { sessionId?: string }).sessionId === undefined
          && method === "Accessibility.getFullAXTree"
        ))
      ).toBe(false);
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-popup-review-pending-top-level",
            payload: expect.objectContaining({
              targetId: "tab-202",
              title: "Popup Pending",
              url: "https://popup.example.com/pending"
            })
          })
        ])
      );
    });
    expect(
      attachMock.mock.calls.some(([debuggee]) => ((debuggee as { tabId?: number }).tabId === 202))
    ).toBe(true);
  });

  it("returns retry guidance for targets.use on a top-level popup tab before attach or bridge is ready", async () => {
    const { mock, router, runtime, sent, session } = await createPopupRuntimeHarness();
    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;
    const sendCommandMock = globalThis.chrome.debugger.sendCommand as unknown as ReturnType<typeof vi.fn>;

    attachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
      if ((debuggee as { tabId?: number }).tabId === 202) {
        mock.setRuntimeError("Not allowed");
        callback();
        mock.setRuntimeError(null);
        return;
      }
      callback();
    });

    mock.emitTabCreated({
      id: 202,
      openerTabId: 101,
      url: "about:blank",
      title: "about:blank",
      status: "loading",
      active: true
    } as chrome.tabs.Tab);
    mock.emitTabUpdated(202, {
      id: 202,
      openerTabId: 101,
      url: "https://popup.example.com/pending",
      title: "Popup Pending",
      status: "complete",
      active: true
    } as chrome.tabs.Tab);

    await vi.waitFor(() => {
      expect(session.targets.has("tab-202")).toBe(true);
    });

    attachMock.mockClear();
    sendCommandMock.mockClear();
    sendCommandMock.mockImplementation((debuggee: chrome.debugger.Debuggee, method: string, _params: object, callback: (result?: unknown) => void) => {
      const tabId = (debuggee as { tabId?: number }).tabId;
      if (tabId === 101 && method === "Target.getTargets") {
        callback({
          targetInfos: [{
            targetId: "target-101",
            type: "page",
            url: "https://example.com/root",
            title: "Root Page"
          }]
        });
        return;
      }
      if (tabId === 101 && method === "Target.attachToTarget") {
        mock.setRuntimeError("Not allowed");
        callback(undefined);
        mock.setRuntimeError(null);
        return;
      }
      callback({ ok: true });
    });
    sent.length = 0;

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-popup-target-use-pending-top-level",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "targets.use",
      payload: {
        targetId: "tab-202"
      }
    });
    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_error",
            requestId: "req-popup-target-use-pending-top-level",
            error: expect.objectContaining({
              code: "execution_failed",
              retryable: true,
              message: "Popup target has not finished attaching yet (stage: attached_root_unavailable; root-target-retry: missing_root_target_id; attached-root: session_missing; terminal: root_debuggee_reattach). Take a new review or snapshot and retry.",
              details: expect.objectContaining({
                stage: "attached_root_unavailable",
                popupTargetId: "target-202",
                matcher: "resolve_tab_target_id",
                initialStage: "raw_attach_blocked",
                rootTargetRetryStage: "missing_root_target_id",
                attachedRootRecoveryStage: "session_missing",
                attachedRootRecoveryRetriedAfterRegisterRoot: true,
                attachedRootRecoveryRegisterRootChanged: false,
                attachedRootRecoveryRegisterRootAttachTargetChanged: false,
                attachedRootRecoveryRegisterAttachedRootSessionCalled: false,
                attachedRootUnavailableTerminalBranch: "root_debuggee_reattach",
                reattachRecoveryStage: "root_debuggee_attach_blocked",
                reattachRecoveryReason: "Not allowed",
                attachedRootRecoveryReason: "attach_target_id_unavailable",
                reason: "Not allowed"
              })
            })
          })
        ])
      );
    });

    expect(
      attachMock.mock.calls.some(([debuggee]) => ((debuggee as { tabId?: number }).tabId === 202))
    ).toBe(true);
  });

  it("retries a transient popup attach stage once before surfacing an error for targets.use", async () => {
    const { mock, router, runtime, sent, session } = await createPopupRuntimeHarness();
    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;

    mock.emitTabCreated({
      id: 202,
      openerTabId: 101,
      url: "about:blank",
      title: "about:blank",
      status: "loading",
      active: true
    } as chrome.tabs.Tab);
    mock.emitTabUpdated(202, {
      id: 202,
      openerTabId: 101,
      url: "https://popup.example.com/retry-success",
      title: "Popup Retry Success",
      status: "complete",
      active: true
    } as chrome.tabs.Tab);

    await vi.waitFor(() => {
      expect(session.targets.has("tab-202")).toBe(true);
    });

    attachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
      if ((debuggee as { tabId?: number }).tabId === 202) {
        mock.setRuntimeError("Not allowed");
        callback();
        mock.setRuntimeError(null);
        return;
      }
      callback();
    });

    const attachChildTarget = vi.fn<CDPRouter["attachChildTarget"]>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("popup-session-202");
    const getLastChildAttachDiagnostic = vi.fn<CDPRouter["getLastChildAttachDiagnostic"]>()
      .mockReturnValue({
        tabId: 101,
        targetId: "target-202",
        stage: "attached_root_unavailable",
        attachedRootRecoveryAttachTargetId: "target-101",
        attachedRootRecoveryRetriedAfterRegisterRoot: true,
        attachedRootUnavailableTerminalBranch: "root_debuggee_reattach",
        reattachRecoveryStage: "root_debuggee_attach_blocked",
        at: Date.now()
      });
    (router as unknown as { attachChildTarget: CDPRouter["attachChildTarget"] }).attachChildTarget = attachChildTarget;
    (router as unknown as { getLastChildAttachDiagnostic: CDPRouter["getLastChildAttachDiagnostic"] }).getLastChildAttachDiagnostic = getLastChildAttachDiagnostic;

    sent.length = 0;

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-popup-target-use-retry-success",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "targets.use",
      payload: {
        targetId: "tab-202"
      }
    });

    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-popup-target-use-retry-success",
            payload: expect.objectContaining({
              activeTargetId: "tab-202",
              title: "Popup Retry Success",
              url: "https://popup.example.com/retry-success"
            })
          })
        ])
      );
    });

    expect(attachChildTarget.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(getLastChildAttachDiagnostic).toHaveBeenCalledWith(101, "target-202");
  });

  it("refreshes the opener tab attachment before popup attach when opener target lookup reports a detached debugger", async () => {
    const { mock, router, runtime, sent, session } = await createPopupRuntimeHarness();
    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;
    const sendCommandMock = globalThis.chrome.debugger.sendCommand as unknown as ReturnType<typeof vi.fn>;
    const activateTabMock = globalThis.chrome.tabs.update as unknown as ReturnType<typeof vi.fn>;

    mock.emitTabCreated({
      id: 202,
      openerTabId: 101,
      url: "about:blank",
      title: "about:blank",
      status: "loading",
      active: true
    } as chrome.tabs.Tab);
    mock.emitTabUpdated(202, {
      id: 202,
      openerTabId: 101,
      url: "https://popup.example.com/refreshed",
      title: "Popup Refreshed",
      status: "complete",
      active: true
    } as chrome.tabs.Tab);

    await vi.waitFor(() => {
      expect(session.targets.has("tab-202")).toBe(true);
    });

    attachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
      if ((debuggee as { tabId?: number }).tabId === 202) {
        mock.setRuntimeError("Not allowed");
        callback();
        mock.setRuntimeError(null);
        return;
      }
      callback();
    });

    sendCommandMock.mockImplementation((debuggee: chrome.debugger.Debuggee, method: string, _params: object, callback: (result?: unknown) => void) => {
      if ((debuggee as { tabId?: number }).tabId === 101 && method === "Target.getTargets") {
        mock.setRuntimeError("Debugger is not attached to the tab with id: 101.");
        callback(undefined);
        mock.setRuntimeError(null);
        return;
      }
      callback({ ok: true });
    });

    const refreshTabAttachment = vi.fn(async (_tabId: number) => {});
    const resolveTabTargetId = vi.fn(async (_tabId: number) => "target-202");
    const attachChildTarget = vi.fn(async (_tabId: number, _targetId: string) => "popup-session-202");
    (router as unknown as { refreshTabAttachment: (tabId: number) => Promise<void> }).refreshTabAttachment = refreshTabAttachment;
    (router as unknown as { resolveTabTargetId: (tabId: number) => Promise<string | null> }).resolveTabTargetId = resolveTabTargetId;
    (router as unknown as { attachChildTarget: (tabId: number, targetId: string) => Promise<string | null> }).attachChildTarget = attachChildTarget;

    sent.length = 0;
    activateTabMock.mockClear();

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-popup-target-use-refresh-opener",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "targets.use",
      payload: {
        targetId: "tab-202"
      }
    });

    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-popup-target-use-refresh-opener",
            payload: expect.objectContaining({
              activeTargetId: "tab-202",
              title: "Popup Refreshed",
              url: "https://popup.example.com/refreshed"
            })
          })
        ])
      );
    });

    expect(refreshTabAttachment).toHaveBeenCalledWith(101);
    expect(attachChildTarget).toHaveBeenCalledWith(101, "target-202");
    expect(activateTabMock).toHaveBeenCalledWith(202, { active: true }, expect.any(Function));
  });

  it("includes root refresh diagnostics when popup attach still fails after a detached-opener lookup refresh", async () => {
    const { router, runtime, sent, session } = await createPopupRuntimeHarness();
    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;
    sessions.addTarget(session.id, 202, {
      url: "https://popup.example.com/refresh-failed",
      title: "Popup Refresh Failed",
      openerTargetId: session.targetId
    });

    attachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
      if ((debuggee as { tabId?: number }).tabId === 202) {
        globalThis.chrome.runtime.lastError = { message: "Not allowed" } as never;
        callback();
        globalThis.chrome.runtime.lastError = null as never;
        return;
      }
      callback();
    });

    const sendCommand = vi.fn(async (_debuggee: chrome.debugger.Debuggee, method: string) => {
      if (method === "Target.getTargets") {
        throw new Error("Debugger is not attached to the tab with id: 101.");
      }
      return { ok: true };
    });
    const refreshTabAttachment = vi.fn(async (_tabId: number) => {});
    const getLastRootRefreshDiagnostic = vi.fn(() => ({
      tabId: 101,
      path: "reattach_root_debuggee" as const,
      refreshCompleted: true,
      debuggeePresentAfterRefresh: true,
      rootSessionPresentAfterRefresh: true,
      rootTargetIdAfterRefresh: "target-101",
      probeMethod: "Target.getTargets" as const,
      probeStage: "failed" as const,
      probeReason: "Debugger is not attached to the tab with id: 101.",
      at: Date.now()
    }));
    const resolveTabTargetId = vi.fn(async (_tabId: number) => "target-202");
    const attachChildTarget = vi.fn(async (_tabId: number, _targetId: string) => {
      throw new Error("Debugger is not attached to the tab with id: 101.");
    });
    const getLastChildAttachDiagnostic = vi.fn(() => ({
      tabId: 101,
      targetId: "target-202",
      stage: "raw_attach_failed" as const,
      reason: "Debugger is not attached to the tab with id: 101.",
      at: Date.now()
    }));

    (router as unknown as { sendCommand: typeof sendCommand }).sendCommand = sendCommand;
    (router as unknown as { refreshTabAttachment: typeof refreshTabAttachment }).refreshTabAttachment = refreshTabAttachment;
    (router as unknown as { getLastRootRefreshDiagnostic: typeof getLastRootRefreshDiagnostic }).getLastRootRefreshDiagnostic = getLastRootRefreshDiagnostic;
    (router as unknown as { resolveTabTargetId: typeof resolveTabTargetId }).resolveTabTargetId = resolveTabTargetId;
    (router as unknown as { attachChildTarget: typeof attachChildTarget }).attachChildTarget = attachChildTarget;
    (router as unknown as { getLastChildAttachDiagnostic: typeof getLastChildAttachDiagnostic }).getLastChildAttachDiagnostic = getLastChildAttachDiagnostic;

    sent.length = 0;
    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-popup-target-use-refresh-diagnostic",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "targets.use",
      payload: {
        targetId: "tab-202"
      }
    });

    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_error",
            requestId: "req-popup-target-use-refresh-diagnostic",
            error: expect.objectContaining({
              code: "execution_failed",
              retryable: true,
              message: "Popup target has not finished attaching yet (stage: raw_attach_failed). Take a new review or snapshot and retry.",
              details: expect.objectContaining({
                stage: "raw_attach_failed",
                matcher: "resolve_tab_target_id",
                targetsLookupFailed: true,
                refreshPath: "reattach_root_debuggee",
                refreshCompleted: true,
                refreshDebuggeePresent: true,
                refreshRootSessionPresent: true,
                refreshRootTargetId: "target-101",
                refreshProbeMethod: "Target.getTargets",
                refreshProbeStage: "failed",
                refreshProbeReason: "Debugger is not attached to the tab with id: 101.",
                reason: "Debugger is not attached to the tab with id: 101."
              })
            })
          })
        ])
      );
    });

    expect(refreshTabAttachment).toHaveBeenCalledWith(101);
    expect(getLastRootRefreshDiagnostic).toHaveBeenCalledWith(101);
    expect(resolveTabTargetId).toHaveBeenCalledWith(202);
    expect(attachChildTarget).toHaveBeenCalledWith(101, "target-202");
  });

  it("reports resolve_tab_target_failed when the popup target cannot be matched or resolved from the tab id", async () => {
    const { mock, runtime, sent, session } = await createPopupRuntimeHarness();
    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;
    const sendCommandMock = globalThis.chrome.debugger.sendCommand as unknown as ReturnType<typeof vi.fn>;
    const getTargetsMock = globalThis.chrome.debugger.getTargets as unknown as ReturnType<typeof vi.fn>;

    attachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
      if ((debuggee as { tabId?: number }).tabId === 202) {
        mock.setRuntimeError("Not allowed");
        callback();
        mock.setRuntimeError(null);
        return;
      }
      callback();
    });

    mock.emitTabCreated({
      id: 202,
      openerTabId: 101,
      url: "about:blank",
      title: "about:blank",
      status: "loading",
      active: true
    } as chrome.tabs.Tab);
    mock.emitTabUpdated(202, {
      id: 202,
      openerTabId: 101,
      url: "https://popup.example.com/unresolved",
      title: "Popup Unresolved",
      status: "complete",
      active: true
    } as chrome.tabs.Tab);

    await vi.waitFor(() => {
      expect(session.targets.has("tab-202")).toBe(true);
    });

    getTargetsMock.mockImplementation((callback: (result: chrome.debugger.TargetInfo[]) => void) => {
      callback([{
        id: "target-101",
        tabId: 101,
        type: "page",
        title: "Root Page",
        url: "https://example.com/root",
        attached: false
      } as chrome.debugger.TargetInfo]);
    });
    sendCommandMock.mockClear();
    sendCommandMock.mockImplementation((debuggee: chrome.debugger.Debuggee, method: string, _params: object, callback: (result?: unknown) => void) => {
      const tabId = (debuggee as { tabId?: number }).tabId;
      if (tabId === 101 && method === "Target.getTargets") {
        callback({
          targetInfos: [{
            targetId: "target-101",
            type: "page",
            url: "https://example.com/root",
            title: "Root Page"
          }]
        });
        return;
      }
      callback({ ok: true });
    });
    sent.length = 0;

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-popup-target-use-unresolved-top-level",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "targets.use",
      payload: {
        targetId: "tab-202"
      }
    });

    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_error",
            requestId: "req-popup-target-use-unresolved-top-level",
            error: expect.objectContaining({
              code: "execution_failed",
              retryable: true,
              message: "Popup target has not finished attaching yet (stage: resolve_tab_target_failed). Take a new review or snapshot and retry.",
              details: expect.objectContaining({
                stage: "resolve_tab_target_failed"
              })
            })
          })
        ])
      );
    });
  });

  it("bridges a top-level popup via resolveTabTargetId when opener Target.getTargets only returns the root page", async () => {
    const { mock, runtime, sent, session } = await createPopupRuntimeHarness();
    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;
    const sendCommandMock = globalThis.chrome.debugger.sendCommand as unknown as ReturnType<typeof vi.fn>;
    const resolveDebuggeeTabId = (debuggee: chrome.debugger.Debuggee): number | null => {
      if (typeof debuggee.tabId === "number") {
        return debuggee.tabId;
      }
      if (typeof debuggee.targetId === "string" && debuggee.targetId.startsWith("target-")) {
        const parsed = Number.parseInt(debuggee.targetId.slice("target-".length), 10);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    };

    attachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
      if ((debuggee as { tabId?: number }).tabId === 202) {
        mock.setRuntimeError("Not allowed");
        callback();
        mock.setRuntimeError(null);
        return;
      }
      callback();
    });

    mock.emitTabCreated({
      id: 202,
      openerTabId: 101,
      url: "about:blank",
      title: "about:blank",
      status: "loading",
      active: true
    } as chrome.tabs.Tab);
    mock.emitTabUpdated(202, {
      id: 202,
      openerTabId: 101,
      url: "https://popup.example.com/fallback",
      title: "Popup Fallback",
      status: "complete",
      active: true
    } as chrome.tabs.Tab);

    await vi.waitFor(() => {
      expect(session.targets.has("tab-202")).toBe(true);
    });

    sendCommandMock.mockClear();
    sendCommandMock.mockImplementation((debuggee: chrome.debugger.Debuggee, method: string, params: object, callback: (result?: unknown) => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      const sessionId = (debuggee as { sessionId?: string }).sessionId;
      if (tabId === 101 && typeof sessionId !== "string") {
        if (method === "Target.getTargets") {
          callback({
            targetInfos: [{
              targetId: "target-101",
              type: "page",
              url: "https://example.com/root",
              title: "Root Page"
            }]
          });
          return;
        }
        if (method === "Target.attachToTarget") {
          expect(params).toEqual({
            targetId: "target-202",
            flatten: true
          });
          callback({ sessionId: "popup-session-202" });
          return;
        }
      }
      if (tabId === 101 && sessionId === "popup-session-202") {
        if (method === "Accessibility.enable" || method === "DOM.enable") {
          callback({});
          return;
        }
        if (method === "Accessibility.getFullAXTree") {
          callback({
            nodes: [{
              nodeId: "ax-popup-fallback-1",
              backendDOMNodeId: 8,
              role: { value: "button" },
              name: { value: "Popup Fallback CTA" }
            }]
          });
          return;
        }
      }
      if (method === "DOM.resolveNode") {
        callback({ object: { objectId: "popup-fallback-node-1" } });
        return;
      }
      if (method === "Runtime.callFunctionOn") {
        const declaration = typeof (params as { functionDeclaration?: unknown } | undefined)?.functionDeclaration === "string"
          ? (params as { functionDeclaration: string }).functionDeclaration
          : "";
        if (declaration.includes("querySelectorAll")) {
          callback({ result: { value: "#popup-fallback-cta" } });
          return;
        }
        callback({ result: { value: null } });
        return;
      }
      callback({});
    });
    sent.length = 0;

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-popup-target-use-root-only-targets",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "targets.use",
      payload: {
        targetId: "tab-202"
      }
    });

    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-popup-target-use-root-only-targets",
            payload: expect.objectContaining({
              activeTargetId: "tab-202",
              title: "Popup Fallback",
              url: "https://popup.example.com/fallback"
            })
          })
        ])
      );
    });

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-popup-review-root-only-targets",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "nav.review",
      payload: {
        maxChars: 4096,
        targetId: "tab-202"
      }
    });

    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-popup-review-root-only-targets",
            payload: expect.objectContaining({
              targetId: "tab-202",
              title: "Popup Fallback",
              url: "https://popup.example.com/fallback",
              content: expect.stringContaining("Popup Fallback CTA")
            })
          })
        ])
      );
    });
  });

  it("bridges a top-level popup via resolveTabTargetId when opener Target.getTargets fails outright", async () => {
    const { mock, runtime, sent, session } = await createPopupRuntimeHarness();
    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;
    const sendCommandMock = globalThis.chrome.debugger.sendCommand as unknown as ReturnType<typeof vi.fn>;
    const resolveDebuggeeTabId = (debuggee: chrome.debugger.Debuggee): number | null => {
      if (typeof debuggee.tabId === "number") {
        return debuggee.tabId;
      }
      if (typeof debuggee.targetId === "string" && debuggee.targetId.startsWith("target-")) {
        const parsed = Number.parseInt(debuggee.targetId.slice("target-".length), 10);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    };

    attachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
      if ((debuggee as { tabId?: number }).tabId === 202) {
        mock.setRuntimeError("Not allowed");
        callback();
        mock.setRuntimeError(null);
        return;
      }
      callback();
    });

    mock.emitTabCreated({
      id: 202,
      openerTabId: 101,
      url: "about:blank",
      title: "about:blank",
      status: "loading",
      active: true
    } as chrome.tabs.Tab);
    mock.emitTabUpdated(202, {
      id: 202,
      openerTabId: 101,
      url: "https://popup.example.com/fallback-error",
      title: "Popup Fallback Error",
      status: "complete",
      active: true
    } as chrome.tabs.Tab);

    await vi.waitFor(() => {
      expect(session.targets.has("tab-202")).toBe(true);
    });

    sendCommandMock.mockClear();
    sendCommandMock.mockImplementation((debuggee: chrome.debugger.Debuggee, method: string, params: object, callback: (result?: unknown) => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      const sessionId = (debuggee as { sessionId?: string }).sessionId;
      if (tabId === 101 && typeof sessionId !== "string") {
        if (method === "Target.getTargets") {
          mock.setRuntimeError("Not allowed");
          callback(undefined);
          mock.setRuntimeError(null);
          return;
        }
        if (method === "Target.attachToTarget") {
          expect(params).toEqual({
            targetId: "target-202",
            flatten: true
          });
          callback({ sessionId: "popup-session-202" });
          return;
        }
      }
      callback({});
    });
    sent.length = 0;

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-popup-target-use-targets-error",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "targets.use",
      payload: {
        targetId: "tab-202"
      }
    });

    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-popup-target-use-targets-error",
            payload: expect.objectContaining({
              activeTargetId: "tab-202",
              title: "Popup Fallback Error",
              url: "https://popup.example.com/fallback-error"
            })
          })
        ])
      );
    });
  });

  it("handles storage.getCookies with url filters", async () => {
    const sent: Array<{ type?: string; requestId?: string; payload?: unknown }> = [];
    const cdp = {
      detachTab: vi.fn(async () => undefined),
      sendCommand: vi.fn(async () => ({
        cookies: [{
          name: "session",
          value: "abc123",
          domain: "example.com",
          path: "/",
          expires: -1,
          httpOnly: true,
          secure: true,
          sameSite: "Lax"
        }]
      }))
    };

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; requestId?: string; payload?: unknown }),
      cdp: cdp as never
    });

    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const session = sessions.createSession("client-1", 101, "lease-1", { url: "https://root.example" });

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-cookies-list",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: "lease-1",
      command: "storage.getCookies",
      payload: {
        requestId: "cookie-list-1",
        urls: ["https://example.com"]
      }
    });
    await flushMicrotasks();

    expect(cdp.sendCommand).toHaveBeenCalledWith(
      { tabId: 101 },
      "Network.getCookies",
      { urls: ["https://example.com/"] }
    );
    expect(sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "ops_response",
          requestId: "req-cookies-list",
          payload: {
            requestId: "cookie-list-1",
            cookies: [{
              name: "session",
              value: "abc123",
              domain: "example.com",
              path: "/",
              expires: -1,
              httpOnly: true,
              secure: true,
              sameSite: "Lax"
            }],
            count: 1
          }
        })
      ])
    );
  });

  it("rejects invalid storage.getCookies url filters", async () => {
    const sent: Array<{ type?: string; requestId?: string; error?: { code?: string; message?: string } }> = [];
    const cdp = {
      detachTab: vi.fn(async () => undefined),
      sendCommand: vi.fn(async () => ({ cookies: [] }))
    };

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; requestId?: string; error?: { code?: string; message?: string } }),
      cdp: cdp as never
    });

    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const session = sessions.createSession("client-1", 101, "lease-1", { url: "https://root.example" });

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-cookies-list-invalid",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: "lease-1",
      command: "storage.getCookies",
      payload: {
        urls: ["ftp://example.com"]
      }
    });
    await flushMicrotasks();

    expect(cdp.sendCommand).not.toHaveBeenCalled();
    expect(sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "ops_error",
          requestId: "req-cookies-list-invalid",
          error: expect.objectContaining({
            code: "invalid_request",
            message: expect.stringContaining("http(s)")
          })
        })
      ])
    );
  });
});
