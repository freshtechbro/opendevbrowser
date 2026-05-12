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
const flushAsyncCleanup = async (): Promise<void> => {
  await flushMicrotasks();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const concreteRootDebuggee = (
  tabId: number
): chrome.debugger.Debuggee & { sessionId: string; targetId: string; attachBy: "targetId" } => ({
  tabId,
  sessionId: `root-session-${tabId}`,
  targetId: `target-${tabId}`,
  attachBy: "targetId"
});

const emitRoutedRuntimeEvent = (
  runtime: OpsRuntime,
  event: { tabId: number; method: string; params?: unknown; sessionId?: string }
): void => {
  (runtime as unknown as {
    handleCdpRouterEvent: (event: { tabId: number; method: string; params?: unknown; sessionId?: string }) => void;
  }).handleCdpRouterEvent(event);
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
        captureVisibleTab: vi.fn((_windowId: number | undefined, _options: chrome.tabs.CaptureVisibleTabOptions, callback: (dataUrl?: string) => void) => {
          callback("data:image/png;base64,AAAA");
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
      windows: {
        WINDOW_ID_CURRENT: -2
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

  it("releases ops ownership without deleting the session when a client disconnects", () => {
    const sent: Array<{ type?: string; event?: string; opsSessionId?: string; clientId?: string }> = [];
    const cdp = {
      detachTab: vi.fn(async () => undefined),
      markClientClosed: vi.fn()
    };

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; event?: string; opsSessionId?: string; clientId?: string }),
      cdp: cdp as never
    });

    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const session = sessions.createSession("client-1", 101, "lease-1", { url: "https://root.example" });

    runtime.handleMessage({
      type: "ops_event",
      clientId: "client-1",
      event: "ops_client_disconnected",
      payload: { at: Date.now() }
    });

    expect(sessions.get(session.id)).toBe(session);
    expect(session.state).toBe("closing");
    expect(cdp.markClientClosed).toHaveBeenCalledTimes(1);
    expect(sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "ops_event",
          event: "ops_session_released",
          opsSessionId: session.id,
          clientId: "client-1"
        })
      ])
    );
  });

  it("removes all ops sessions when the relay websocket disconnects", async () => {
    const sent: Array<{ type?: string; event?: string; opsSessionId?: string; clientId?: string }> = [];
    const cdp = {
      detachTab: vi.fn(async () => undefined),
      markClientClosed: vi.fn()
    };

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; event?: string; opsSessionId?: string; clientId?: string }),
      cdp: cdp as never
    });

    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const first = sessions.createSession("client-1", 101, "lease-1", { url: "https://root.example" });
    const second = sessions.createSession("client-2", 102, "lease-2", { url: "https://other.example" });

    runtime.handleRelayDisconnected();

    expect(sessions.get(first.id)).toBeNull();
    expect(sessions.get(second.id)).toBeNull();
    expect(cdp.markClientClosed).toHaveBeenCalledTimes(1);
    expect(cdp.detachTab).toHaveBeenCalledWith(101);
    expect(cdp.detachTab).toHaveBeenCalledWith(102);
    await flushAsyncCleanup();
    expect(sent).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: "ops_session_expired", opsSessionId: first.id, clientId: "client-1" }),
      expect.objectContaining({ event: "ops_session_expired", opsSessionId: second.id, clientId: "client-2" })
    ]));
  });

  it("emits final ownership release only after debugger detach finishes", async () => {
    const sent: Array<{ type?: string; event?: string; opsSessionId?: string; clientId?: string }> = [];
    let resolveDetach: (() => void) | null = null;
    const detachPromise = new Promise<void>((resolve) => {
      resolveDetach = resolve;
    });
    const cdp = {
      detachTab: vi.fn(() => detachPromise),
      markClientClosed: vi.fn()
    };

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; event?: string; opsSessionId?: string; clientId?: string }),
      cdp: cdp as never
    });

    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const session = sessions.createSession("client-1", 101, "lease-1", { url: "https://root.example" });

    runtime.handleRelayDisconnected();
    await flushAsyncCleanup();

    expect(sessions.get(session.id)).toBeNull();
    expect(cdp.detachTab).toHaveBeenCalledWith(101);
    expect(sent).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ event: "ops_session_expired", opsSessionId: session.id })
    ]));

    resolveDetach?.();
    await flushAsyncCleanup();

    expect(sent).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: "ops_session_expired", opsSessionId: session.id, clientId: "client-1" })
    ]));
  });

  it("waits for remaining debugger detaches when one target detach rejects", async () => {
    const sent: Array<{ type?: string; event?: string; opsSessionId?: string; clientId?: string }> = [];
    let resolveChildDetach: (() => void) | null = null;
    const childDetachPromise = new Promise<void>((resolve) => {
      resolveChildDetach = resolve;
    });
    const cdp = {
      detachTab: vi.fn((tabId: number) => (
        tabId === 101 ? Promise.reject(new Error("stale root debugger")) : childDetachPromise
      )),
      markClientClosed: vi.fn()
    };

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; event?: string; opsSessionId?: string; clientId?: string }),
      cdp: cdp as never
    });

    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const session = sessions.createSession("client-1", 101, "lease-1", { url: "https://root.example" });
    sessions.addTarget(session.id, 202, { url: "https://child.example" });

    runtime.handleRelayDisconnected();
    await flushAsyncCleanup();

    expect(sessions.get(session.id)).toBeNull();
    expect(cdp.detachTab).toHaveBeenCalledWith(101);
    expect(cdp.detachTab).toHaveBeenCalledWith(202);
    expect(sent).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ event: "ops_session_expired", opsSessionId: session.id })
    ]));

    resolveChildDetach?.();
    await flushAsyncCleanup();

    expect(sent).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: "ops_session_expired", opsSessionId: session.id, clientId: "client-1" })
    ]));
  });

  it("tears down the full session when root tab is removed", async () => {
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
    await flushAsyncCleanup();
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

  it("expires a root debugger detach when the root debuggee is not restored", async () => {
    vi.useFakeTimers();
    const sent: unknown[] = [];
    const cdp = {
      detachTab: vi.fn(async () => undefined),
      getTabDebuggee: vi.fn(() => null)
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

    expect(sessions.get(session.id)).not.toBeNull();
    expect(sent).toEqual([]);

    await vi.advanceTimersByTimeAsync(1000);
    await flushMicrotasks();

    expect(sessions.get(session.id)).toBeNull();
    expect(cdp.detachTab).toHaveBeenCalledWith(101);
    expect(cdp.detachTab).toHaveBeenCalledWith(202);
    expect(sent).toEqual([
      expect.objectContaining({ event: "ops_session_closed", opsSessionId: session.id })
    ]);
  });

  it("retains a root debugger detach when the debuggee returns within the verification window", async () => {
    vi.useFakeTimers();
    const sent: unknown[] = [];
    const cdp = {
      detachTab: vi.fn(async () => undefined),
      getTabDebuggee: vi.fn()
        .mockReturnValueOnce(null)
        .mockReturnValueOnce(null)
        .mockReturnValue({ tabId: 101 })
    };

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message),
      cdp: cdp as never
    });

    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const session = sessions.createSession("client-1", 101, "lease-1", { url: "https://root.example" });
    const getTabMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getTabMock.mockResolvedValue({ id: 101, url: "https://root.example" } as chrome.tabs.Tab);

    debuggerDetachListener?.({ tabId: 101 });
    await vi.advanceTimersByTimeAsync(500);
    await flushMicrotasks();

    expect(sessions.get(session.id)).not.toBeNull();
    expect(cdp.detachTab).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });

  it("expires a root debugger detach when tab lookup rejects", async () => {
    vi.useFakeTimers();
    const sent: unknown[] = [];
    const cdp = {
      detachTab: vi.fn(async () => undefined),
      getTabDebuggee: vi.fn(() => null)
    };

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message),
      cdp: cdp as never
    });

    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const session = sessions.createSession("client-1", 101, "lease-1", { url: "https://root.example" });
    const getTabMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getTabMock.mockRejectedValue(new Error("No tab with id: 101."));

    debuggerDetachListener?.({ tabId: 101 });
    await vi.advanceTimersByTimeAsync(250);
    await flushMicrotasks();

    expect(sessions.get(session.id)).toBeNull();
    expect(cdp.detachTab).toHaveBeenCalledWith(101);
    expect(sent).toEqual([
      expect.objectContaining({ event: "ops_session_closed", opsSessionId: session.id })
    ]);
  });

  it("reattaches a retained target when targets.use selects it after debugger detach", async () => {
    const sent: Array<{ type?: string; requestId?: string; payload?: unknown }> = [];
    let rootDebuggeeReady = false;
    const cdp = {
      attach: vi.fn(async (tabId: number) => {
        if (tabId === 101) {
          rootDebuggeeReady = true;
        }
      }),
      detachTab: vi.fn(async () => undefined),
      primeAttachedRootSession: vi.fn(async () => undefined),
      getTabDebuggee: vi.fn((tabId: number) => (
        rootDebuggeeReady && tabId === 101 ? concreteRootDebuggee(101) : null
      )),
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
      expect(cdp.sendCommand).toHaveBeenCalledWith(concreteRootDebuggee(101), "Runtime.enable", {});
      expect(cdp.sendCommand).toHaveBeenCalledWith(concreteRootDebuggee(101), "Network.enable", {});
      expect(cdp.sendCommand).toHaveBeenCalledWith(concreteRootDebuggee(101), "Performance.enable", {});
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

  it("prefers live metadata for a normal bridged target in session.status", async () => {
    const sent: Array<{ type?: string; requestId?: string; payload?: unknown }> = [];
    const cdp = {
      detachTab: vi.fn(async () => undefined),
      getTabDebuggee: vi.fn((tabId: number) => ({ tabId }))
    };

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; requestId?: string; payload?: unknown }),
      cdp: cdp as never
    });

    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const session = sessions.createSession("client-1", 101, "lease-1", { url: "https://root.example", title: "Root" });
    sessions.addTarget(session.id, 202, {
      url: "https://stored.example/old",
      title: "Stored Title"
    });
    sessions.upsertSyntheticTarget(session.id, {
      targetId: "child-session-202",
      tabId: 202,
      type: "page",
      url: "https://stored.example/old",
      title: "Stored Title",
      sessionId: "child-session-202",
      attachedAt: Date.now()
    });
    session.activeTargetId = "tab-202";

    const getTabMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getTabMock.mockImplementation(async (tabId: number) => ({
      id: tabId,
      url: tabId === 202 ? "https://live.example/current" : "https://root.example",
      title: tabId === 202 ? "Live Title" : "Root",
      status: "complete"
    } as chrome.tabs.Tab));

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-session-status-live-bridge",
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
          requestId: "req-session-status-live-bridge",
          payload: expect.objectContaining({
            activeTargetId: "tab-202",
            url: "https://live.example/current",
            title: "Live Title"
          })
        })
      ])
    );
  });

  it("falls back coherently to the root target after removing the active target", async () => {
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
      url: "https://secondary.example",
      title: "Secondary"
    });
    session.activeTargetId = "tab-202";
    sessions.removeTarget(session.id, "tab-202");

    const getTabMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getTabMock.mockImplementation(async (tabId: number) => ({
      id: tabId,
      url: tabId === 101 ? "https://root.example" : "https://secondary.example",
      title: tabId === 101 ? "Root" : "Secondary",
      status: "complete"
    } as chrome.tabs.Tab));

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-session-status-after-remove",
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
          requestId: "req-session-status-after-remove",
          payload: expect.objectContaining({
            activeTargetId: "tab-101",
            url: "https://root.example",
            title: "Root"
          })
        })
      ])
    );
  });

  it("falls back to the root target in session.status when the active popup child session is stale", async () => {
    const sent: Array<{ type?: string; requestId?: string; payload?: unknown }> = [];
    const cdp = {
      detachTab: vi.fn(async () => undefined),
      hasDebuggerSession: vi.fn((sessionId: string) => sessionId === "root-session-101"),
      getTabDebuggee: vi.fn((tabId: number) => (
        tabId === 101
          ? { tabId: 101, sessionId: "root-session-101", targetId: "target-101", attachBy: "targetId" as const }
          : null
      ))
    };

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; requestId?: string; payload?: unknown }),
      cdp: cdp as never
    });

    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const session = sessions.createSession("client-1", 101, "lease-1", {
      url: "https://root.example",
      title: "Root"
    });
    sessions.upsertSyntheticTarget(session.id, {
      targetId: "tab-202",
      tabId: 202,
      type: "page",
      url: "https://popup.example/stale",
      title: "Stale Popup",
      sessionId: "popup-session-stale",
      openerTargetId: "tab-101",
      attachedAt: Date.now()
    });
    session.activeTargetId = "tab-202";

    const getTabMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getTabMock.mockImplementation(async (tabId: number) => ({
      id: tabId,
      url: tabId === 101 ? "https://root.example" : "https://popup.example/stale",
      title: tabId === 101 ? "Root" : "Stale Popup",
      status: "complete"
    } as chrome.tabs.Tab));

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-session-status-stale-popup-session",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: "lease-1",
      command: "session.status",
      payload: {}
    });
    await flushMicrotasks();

    expect(cdp.hasDebuggerSession).toHaveBeenCalledWith("popup-session-stale");
    expect(session.activeTargetId).toBe("tab-101");
    expect(sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "ops_response",
          requestId: "req-session-status-stale-popup-session",
          payload: expect.objectContaining({
            activeTargetId: "tab-101",
            url: "https://root.example",
            title: "Root"
          })
        })
      ])
    );
  });

  it("falls back to the root target for nav.snapshot when the active popup child session is stale", async () => {
    const sent: Array<{ type?: string; requestId?: string; payload?: unknown; error?: { code?: string; message?: string } }> = [];
    const cdp = {
      detachTab: vi.fn(async () => undefined),
      hasDebuggerSession: vi.fn((sessionId: string) => sessionId === "root-session-101"),
      getTabDebuggee: vi.fn((tabId: number) => (
        tabId === 101
          ? { tabId: 101, sessionId: "root-session-101", targetId: "target-101", attachBy: "targetId" as const }
          : null
      )),
      sendCommand: vi.fn(async (debuggee: chrome.debugger.Debuggee, method: string, params?: Record<string, unknown>) => {
        if (typeof (debuggee as { sessionId?: string }).sessionId === "string" && debuggee.tabId === 202) {
          throw new Error("Debugger is not attached to the tab with id: 202.");
        }
        if (method === "Accessibility.enable" || method === "DOM.enable") {
          return {};
        }
        if (method === "Accessibility.getFullAXTree") {
          return {
            nodes: [{
              nodeId: "ax-root-1",
              backendDOMNodeId: 1,
              role: { value: "button" },
              name: { value: "Root CTA" }
            }]
          };
        }
        if (method === "DOM.resolveNode") {
          return { object: { objectId: "root-node-1" } };
        }
        if (method === "Runtime.callFunctionOn") {
          const declaration = typeof params?.functionDeclaration === "string"
            ? params.functionDeclaration
            : "";
          if (declaration.includes("querySelectorAll")) {
            return { result: { value: "#root-cta" } };
          }
          return { result: { value: null } };
        }
        return {};
      })
    };

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; requestId?: string; payload?: unknown; error?: { code?: string; message?: string } }),
      cdp: cdp as never
    });

    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const session = sessions.createSession("client-1", 101, "lease-1", {
      url: "https://root.example",
      title: "Root"
    });
    sessions.upsertSyntheticTarget(session.id, {
      targetId: "tab-202",
      tabId: 202,
      type: "page",
      url: "https://popup.example/stale",
      title: "Stale Popup",
      sessionId: "popup-session-stale",
      openerTargetId: "tab-101",
      attachedAt: Date.now()
    });
    session.activeTargetId = "tab-202";

    const getTabMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getTabMock.mockImplementation(async (tabId: number) => ({
      id: tabId,
      url: tabId === 101 ? "https://root.example" : "https://popup.example/stale",
      title: tabId === 101 ? "Root" : "Stale Popup",
      status: "complete"
    } as chrome.tabs.Tab));

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-nav-snapshot-stale-popup-session",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: "lease-1",
      command: "nav.snapshot",
      payload: {
        maxChars: 4096
      }
    });

    await vi.waitFor(() => {
      expect(cdp.sendCommand).toHaveBeenCalledWith(
        { tabId: 101, sessionId: "root-session-101", targetId: "target-101", attachBy: "targetId" },
        "Accessibility.getFullAXTree",
        {}
      );
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-nav-snapshot-stale-popup-session",
            payload: expect.objectContaining({
              snapshotId: expect.any(String),
              url: "https://root.example",
              title: "Root",
              refCount: 1,
              content: expect.stringContaining("Root CTA")
            })
          })
        ])
      );
    });

    expect(session.activeTargetId).toBe("tab-101");
    expect(sent.some((message) => (
      message.type === "ops_error"
      && message.requestId === "req-nav-snapshot-stale-popup-session"
    ))).toBe(false);
  });

  it("reclaims a closing session when the lease matches on a new ops client id", async () => {
    const sent: Array<{ type?: string; requestId?: string; payload?: unknown }> = [];
    const cdp = {
      detachTab: vi.fn(async () => undefined),
      markClientClosed: vi.fn()
    };

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; requestId?: string; payload?: unknown }),
      cdp: cdp as never
    });

    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const session = sessions.createSession("client-1", 101, "lease-1", { url: "https://root.example", title: "Root" });
    runtime.handleMessage({
      type: "ops_event",
      clientId: "client-1",
      event: "ops_client_disconnected",
      payload: { at: Date.now() }
    });
    sent.length = 0;

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
    expect(session.state).toBe("active");
    expect(sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "ops_event",
          event: "ops_session_reclaimed",
          opsSessionId: session.id,
          clientId: "client-2"
        }),
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
        expect.objectContaining({ tabId: 101 }),
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

  it("handles page.dialog while an interact.click is still pending on the same target", async () => {
    const sent: Array<{ type?: string; requestId?: string; payload?: unknown; error?: { code?: string; retryable?: boolean; message?: string } }> = [];
    let releaseClick: (() => void) | null = null;
    const clickReleased = new Promise<void>((resolve) => {
      releaseClick = resolve;
    });
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
        if (params?.type === "mouseReleased") {
          await clickReleased;
        }
        return {};
      }
      if (method === "Page.handleJavaScriptDialog") {
        releaseClick?.();
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
      selector: "#open-dialog",
      backendNodeId: 3,
      role: "button",
      name: "Open Dialog"
    }]);
    sessions.setDialog(session.id, "tab-101", {
      open: true,
      targetId: "tab-101",
      type: "alert",
      message: "I am a JS Alert"
    });

    const getTabMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getTabMock.mockResolvedValue({
      id: 101,
      url: "https://example.com/root",
      title: "Root Page",
      status: "complete"
    } as chrome.tabs.Tab);

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-click-pending-dialog",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "interact.click",
      payload: {
        ref: "r1"
      }
    });

    await vi.waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        { tabId: 101 },
        "Input.dispatchMouseEvent",
        expect.objectContaining({ type: "mouseReleased", x: 20, y: 30, button: "left", clickCount: 1 })
      );
    });
    expect(sent.some((message) => message.requestId === "req-click-pending-dialog" && message.type === "ops_response")).toBe(false);

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-dialog-status-pending-click",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "page.dialog",
      payload: {}
    });

    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-dialog-status-pending-click",
            payload: {
              dialog: {
                open: true,
                targetId: "tab-101",
                type: "alert",
                message: "I am a JS Alert"
              }
            }
          })
        ])
      );
    });
    expect(sent.some((message) => message.requestId === "req-click-pending-dialog" && message.type === "ops_response")).toBe(false);

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-dialog-accept-pending-click",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "page.dialog",
      payload: {
        action: "accept"
      }
    });

    await vi.waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        { tabId: 101 },
        "Page.handleJavaScriptDialog",
        { accept: true }
      );
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-dialog-accept-pending-click",
            payload: {
              dialog: { open: false, targetId: "tab-101" },
              handled: true
            }
          }),
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-click-pending-dialog",
            payload: expect.objectContaining({ navigated: false })
          })
        ])
      );
    });
  });

  it("maps Page.javascriptDialogOpening from the attached root session while interact.click is still pending", async () => {
    const { runtime, sent, session, rootSessionId } = await createPopupRuntimeHarness();
    let releaseClick: (() => void) | null = null;
    const clickReleased = new Promise<void>((resolve) => {
      releaseClick = resolve;
    });
    const sendCommandMock = globalThis.chrome.debugger.sendCommand as unknown as ReturnType<typeof vi.fn>;
    sendCommandMock.mockClear();
    sendCommandMock.mockImplementation((debuggee: chrome.debugger.Debuggee, method: string, params: object, callback: (result?: unknown) => void) => {
      void debuggee;
      if (method === "DOM.resolveNode") {
        callback({ object: { objectId: "node-1" } });
        return;
      }
      if (method === "DOM.getBoxModel") {
        callback({
          model: {
            content: [10, 20, 30, 20, 30, 40, 10, 40]
          }
        });
        return;
      }
      if (method === "Runtime.callFunctionOn") {
        callback({ result: { value: undefined } });
        return;
      }
      if (method === "Input.dispatchMouseEvent") {
        if ((params as { type?: unknown }).type === "mouseReleased") {
          void clickReleased.then(() => callback({}));
          return;
        }
        callback({});
        return;
      }
      if (method === "Page.handleJavaScriptDialog") {
        releaseClick?.();
        callback({});
        return;
      }
      callback({});
    });

    session.refStore.setSnapshot(session.targetId, [{
      ref: "r1",
      selector: "#open-dialog",
      backendNodeId: 3,
      role: "button",
      name: "Open Dialog"
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
      requestId: "req-click-pending-root-session-dialog",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "interact.click",
      payload: {
        ref: "r1"
      }
    });

    let mouseReleasedDebuggee: chrome.debugger.Debuggee | null = null;
    await vi.waitFor(() => {
      const mouseReleasedCall = sendCommandMock.mock.calls.find(([, method, params]) => (
        method === "Input.dispatchMouseEvent"
        && (params as { type?: unknown }).type === "mouseReleased"
      ));
      expect(mouseReleasedCall).toBeDefined();
      mouseReleasedDebuggee = mouseReleasedCall?.[0] as chrome.debugger.Debuggee;
      expect(mouseReleasedDebuggee).toEqual(
        expect.objectContaining({ sessionId: expect.any(String), targetId: "target-101" })
      );
    });
    expect(sent.some((message) => message.requestId === "req-click-pending-root-session-dialog" && message.type === "ops_response")).toBe(false);

    emitRoutedRuntimeEvent(runtime, {
      tabId: session.tabId,
      sessionId: rootSessionId,
      method: "Page.javascriptDialogOpening",
      params: {
        type: "alert",
        message: "I am a JS Alert",
        url: "https://example.com/root"
      }
    });
    await flushMicrotasks();

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-dialog-status-root-session",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "page.dialog",
      payload: {}
    });

    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-dialog-status-root-session",
            payload: {
              dialog: expect.objectContaining({
                open: true,
                targetId: session.targetId,
                type: "alert",
                message: "I am a JS Alert",
                url: "https://example.com/root"
              })
            }
          })
        ])
      );
    });
    expect(sent.some((message) => message.requestId === "req-click-pending-root-session-dialog" && message.type === "ops_response")).toBe(false);

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-dialog-accept-root-session",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "page.dialog",
      payload: {
        action: "accept"
      }
    });

    await vi.waitFor(() => {
      expect(sendCommandMock).toHaveBeenCalledWith(
        expect.objectContaining(mouseReleasedDebuggee ?? {}),
        "Page.handleJavaScriptDialog",
        { accept: true },
        expect.any(Function)
      );
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-dialog-accept-root-session",
            payload: {
              dialog: { open: false, targetId: session.targetId },
              handled: true
            }
          }),
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-click-pending-root-session-dialog",
            payload: expect.objectContaining({ navigated: false })
          })
        ])
      );
    });
  });

  it("handles dialog events when Chrome reports an unknown source session but preserves the attached root tab id while interact.click is pending", async () => {
    const { runtime, sent, session } = await createPopupRuntimeHarness();
    let releaseClick: (() => void) | null = null;
    const clickReleased = new Promise<void>((resolve) => {
      releaseClick = resolve;
    });
    const sendCommandMock = globalThis.chrome.debugger.sendCommand as unknown as ReturnType<typeof vi.fn>;
    sendCommandMock.mockClear();
    sendCommandMock.mockImplementation((debuggee: chrome.debugger.Debuggee, method: string, params: object, callback: (result?: unknown) => void) => {
      void debuggee;
      if (method === "DOM.resolveNode") {
        callback({ object: { objectId: "node-1" } });
        return;
      }
      if (method === "DOM.getBoxModel") {
        callback({
          model: {
            content: [10, 20, 30, 20, 30, 40, 10, 40]
          }
        });
        return;
      }
      if (method === "Runtime.callFunctionOn") {
        callback({ result: { value: undefined } });
        return;
      }
      if (method === "Input.dispatchMouseEvent") {
        if ((params as { type?: unknown }).type === "mouseReleased") {
          void clickReleased.then(() => callback({}));
          return;
        }
        callback({});
        return;
      }
      if (method === "Page.handleJavaScriptDialog") {
        releaseClick?.();
        callback({});
        return;
      }
      callback({});
    });

    session.refStore.setSnapshot(session.targetId, [{
      ref: "r1",
      selector: "#open-dialog",
      backendNodeId: 3,
      role: "button",
      name: "Open Dialog"
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
      requestId: "req-click-pending-unknown-root-session-dialog",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "interact.click",
      payload: {
        ref: "r1"
      }
    });

    let mouseReleasedDebuggee: chrome.debugger.Debuggee | null = null;
    await vi.waitFor(() => {
      const mouseReleasedCall = sendCommandMock.mock.calls.find(([, method, params]) => (
        method === "Input.dispatchMouseEvent"
        && (params as { type?: unknown }).type === "mouseReleased"
      ));
      expect(mouseReleasedCall).toBeDefined();
      mouseReleasedDebuggee = mouseReleasedCall?.[0] as chrome.debugger.Debuggee;
      expect(mouseReleasedDebuggee).toEqual(
        expect.objectContaining({ sessionId: expect.any(String), targetId: "target-101" })
      );
    });
    expect(sent.some((message) => message.requestId === "req-click-pending-unknown-root-session-dialog" && message.type === "ops_response")).toBe(false);

    emitRoutedRuntimeEvent(runtime, {
      tabId: session.tabId,
      method: "Page.javascriptDialogOpening",
      params: {
        type: "alert",
        message: "I am a JS Alert",
        url: "https://example.com/root"
      }
    });
    await flushMicrotasks();

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-dialog-status-unknown-root-session",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "page.dialog",
      payload: {}
    });

    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-dialog-status-unknown-root-session",
            payload: {
              dialog: expect.objectContaining({
                open: true,
                targetId: session.targetId,
                type: "alert",
                message: "I am a JS Alert",
                url: "https://example.com/root"
              })
            }
          })
        ])
      );
    });
    expect(sent.some((message) => message.requestId === "req-click-pending-unknown-root-session-dialog" && message.type === "ops_response")).toBe(false);

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-dialog-accept-unknown-root-session",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "page.dialog",
      payload: {
        action: "accept"
      }
    });

    await vi.waitFor(() => {
      expect(sendCommandMock).toHaveBeenCalledWith(
        expect.objectContaining(mouseReleasedDebuggee ?? {}),
        "Page.handleJavaScriptDialog",
        { accept: true },
        expect.any(Function)
      );
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-dialog-accept-unknown-root-session",
            payload: {
              dialog: { open: false, targetId: session.targetId },
              handled: true
            }
          }),
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-click-pending-unknown-root-session-dialog",
            payload: expect.objectContaining({ navigated: false })
          })
        ])
      );
    });
  });

  it("handles dialog events when Chrome reports only an unknown source session while interact.click is pending on a single attached tab", async () => {
    const { mock, runtime, sent, session } = await createPopupRuntimeHarness();
    let releaseClick: (() => void) | null = null;
    const clickReleased = new Promise<void>((resolve) => {
      releaseClick = resolve;
    });
    const sendCommandMock = globalThis.chrome.debugger.sendCommand as unknown as ReturnType<typeof vi.fn>;
    sendCommandMock.mockClear();
    sendCommandMock.mockImplementation((debuggee: chrome.debugger.Debuggee, method: string, params: object, callback: (result?: unknown) => void) => {
      void debuggee;
      if (method === "DOM.resolveNode") {
        callback({ object: { objectId: "node-1" } });
        return;
      }
      if (method === "DOM.getBoxModel") {
        callback({
          model: {
            content: [10, 20, 30, 20, 30, 40, 10, 40]
          }
        });
        return;
      }
      if (method === "Runtime.callFunctionOn") {
        callback({ result: { value: undefined } });
        return;
      }
      if (method === "Input.dispatchMouseEvent") {
        if ((params as { type?: unknown }).type === "mouseReleased") {
          void clickReleased.then(() => callback({}));
          return;
        }
        callback({});
        return;
      }
      if (method === "Page.handleJavaScriptDialog") {
        releaseClick?.();
        callback({});
        return;
      }
      callback({});
    });

    session.refStore.setSnapshot(session.targetId, [{
      ref: "r1",
      selector: "#open-dialog",
      backendNodeId: 3,
      role: "button",
      name: "Open Dialog"
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
      requestId: "req-click-pending-unknown-session-only-dialog",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "interact.click",
      payload: {
        ref: "r1"
      }
    });

    let mouseReleasedDebuggee: chrome.debugger.Debuggee | null = null;
    await vi.waitFor(() => {
      const mouseReleasedCall = sendCommandMock.mock.calls.find(([, method, params]) => (
        method === "Input.dispatchMouseEvent"
        && (params as { type?: unknown }).type === "mouseReleased"
      ));
      expect(mouseReleasedCall).toBeDefined();
      mouseReleasedDebuggee = mouseReleasedCall?.[0] as chrome.debugger.Debuggee;
      expect(mouseReleasedDebuggee).toEqual(
        expect.objectContaining({ sessionId: expect.any(String), targetId: "target-101" })
      );
    });
    expect(sent.some((message) => message.requestId === "req-click-pending-unknown-session-only-dialog" && message.type === "ops_response")).toBe(false);

    mock.emitDebuggerEvent(
      { sessionId: "unknown-root-session" },
      "Page.javascriptDialogOpening",
      {
        type: "alert",
        message: "I am a JS Alert",
        url: "https://example.com/root"
      }
    );
    await flushMicrotasks();

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-dialog-status-unknown-session-only",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "page.dialog",
      payload: {}
    });

    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-dialog-status-unknown-session-only",
            payload: {
              dialog: expect.objectContaining({
                open: true,
                targetId: session.targetId,
                type: "alert",
                message: "I am a JS Alert",
                url: "https://example.com/root"
              })
            }
          })
        ])
      );
    });
    expect(sent.some((message) => message.requestId === "req-click-pending-unknown-session-only-dialog" && message.type === "ops_response")).toBe(false);

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-dialog-accept-unknown-session-only",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "page.dialog",
      payload: {
        action: "accept"
      }
    });

    await vi.waitFor(() => {
      expect(sendCommandMock).toHaveBeenCalledWith(
        expect.objectContaining(mouseReleasedDebuggee ?? {}),
        "Page.handleJavaScriptDialog",
        { accept: true },
        expect.any(Function)
      );
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-dialog-accept-unknown-session-only",
            payload: {
              dialog: { open: false, targetId: session.targetId },
              handled: true
            }
          }),
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-click-pending-unknown-session-only-dialog",
            payload: expect.objectContaining({ navigated: false })
          })
        ])
      );
    });
  });

  it("clears routed dialog state when Page.javascriptDialogClosed is forwarded for the same target", async () => {
    const { runtime, sent, session, rootSessionId } = await createPopupRuntimeHarness();

    emitRoutedRuntimeEvent(runtime, {
      tabId: session.tabId,
      sessionId: rootSessionId,
      method: "Page.javascriptDialogOpening",
      params: {
        type: "alert",
        message: "I am a JS Alert",
        url: "https://example.com/root"
      }
    });
    await flushMicrotasks();

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-dialog-status-before-routed-close",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "page.dialog",
      payload: {}
    });

    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-dialog-status-before-routed-close",
            payload: {
              dialog: expect.objectContaining({
                open: true,
                targetId: session.targetId,
                type: "alert",
                message: "I am a JS Alert"
              })
            }
          })
        ])
      );
    });

    emitRoutedRuntimeEvent(runtime, {
      tabId: session.tabId,
      sessionId: rootSessionId,
      method: "Page.javascriptDialogClosed"
    });
    await flushMicrotasks();

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-dialog-status-after-routed-close",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "page.dialog",
      payload: {}
    });

    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-dialog-status-after-routed-close",
            payload: {
              dialog: {
                open: false,
                targetId: session.targetId
              }
            }
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
        expect.objectContaining({ tabId: 101 }),
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
        expect.objectContaining({ tabId: 101 }),
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

  it("recovers explicit overlay tab targets that fell out of session bookkeeping", async () => {
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
      requestId: "req-overlay-recover-mount",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: "lease-1",
      command: "canvas.overlay.mount",
      payload: {
        targetId: "tab-101",
        mountId: "mount-preview-recovery",
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

    sessions.removeTarget(session.id, "tab-101");
    expect(session.targets.has("tab-101")).toBe(false);
    expect(sessions.getTargetIdByTabId(session.id, 101)).toBeNull();
    expect(session.activeTargetId).toBeNull();

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-overlay-recover-select",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: "lease-1",
      command: "canvas.overlay.select",
      payload: {
        targetId: "tab-101",
        mountId: "mount-preview-recovery",
        nodeId: "node_card"
      }
    });
    await flushMicrotasks();

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-overlay-recover-sync",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: "lease-1",
      command: "canvas.overlay.sync",
      payload: {
        targetId: "tab-101",
        mountId: "mount-preview-recovery",
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
      requestId: "req-overlay-recover-unmount",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: "lease-1",
      command: "canvas.overlay.unmount",
      payload: {
        targetId: "tab-101",
        mountId: "mount-preview-recovery"
      }
    });
    await flushMicrotasks();
    await vi.waitFor(() => {
      expect(sent.filter((message) => message.type === "ops_response")).toHaveLength(4);
    });

    expect(sent).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "ops_error",
          requestId: "req-overlay-recover-select",
          error: expect.objectContaining({ code: "invalid_request" })
        })
      ])
    );
    expect(sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "ops_response",
          requestId: "req-overlay-recover-select",
          payload: expect.objectContaining({
            mountId: "mount-preview-recovery",
            targetId: "tab-101",
            selection: expect.objectContaining({
              matched: true,
              nodeId: "node_card"
            })
          })
        }),
        expect.objectContaining({
          type: "ops_response",
          requestId: "req-overlay-recover-sync",
          payload: expect.objectContaining({
            ok: true,
            mountId: "mount-preview-recovery",
            targetId: "tab-101",
            overlayState: "mounted"
          })
        }),
        expect.objectContaining({
          type: "ops_response",
          requestId: "req-overlay-recover-unmount",
          payload: expect.objectContaining({
            ok: true,
            mountId: "mount-preview-recovery",
            targetId: "tab-101",
            overlayState: "idle"
          })
        })
      ])
    );
    expect(session.activeTargetId).toBe("tab-101");
    expect(sessions.getTargetIdByTabId(session.id, 101)).toBe("tab-101");
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
      primeAttachedRootSession: vi.fn(async () => undefined),
      getTabDebuggee: vi.fn((tabId: number) => (
        tabId === 404 ? concreteRootDebuggee(404) : null
      )),
      sendCommand: vi.fn(async () => ({}))
    };

    const createMock = globalThis.chrome.tabs.create as unknown as ReturnType<typeof vi.fn>;
    const getMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    const updateMock = globalThis.chrome.tabs.update as unknown as ReturnType<typeof vi.fn>;
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
      primeAttachedRootSession: vi.fn(async () => undefined),
      getTabDebuggee: vi.fn((tabId: number) => (
        tabId === 405 ? concreteRootDebuggee(405) : null
      )),
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
      primeAttachedRootSession: vi.fn(async () => undefined),
      getTabDebuggee: vi.fn((tabId: number) => (
        tabId === 202 ? concreteRootDebuggee(202) : null
      )),
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
      primeAttachedRootSession: vi.fn(async () => undefined),
      getTabDebuggee: vi.fn((tabId: number) => (
        tabId === 202 ? concreteRootDebuggee(202) : null
      )),
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

  it("enables page domains on the attached root debuggee during session.launch", async () => {
    const cdp = {
      attach: vi.fn(async () => undefined),
      detachTab: vi.fn(async () => undefined),
      setDiscoverTargetsEnabled: vi.fn(async () => undefined),
      configureAutoAttach: vi.fn(async () => undefined),
      primeAttachedRootSession: vi.fn(async () => undefined),
      getTabDebuggee: vi.fn((tabId: number) => (
        tabId === 202
          ? { tabId: 202, sessionId: "root-session-202", targetId: "target-202", attachBy: "targetId" as const }
          : null
      )),
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
      send: () => undefined,
      cdp: cdp as never
    });

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-session-attached-root-domains",
      clientId: "client-1",
      command: "session.launch",
      payload: {
        tabId: 202
      }
    });

    await vi.waitFor(() => {
      expect(cdp.sendCommand).toHaveBeenCalledWith(
        concreteRootDebuggee(202),
        "Page.enable",
        {}
      );
      expect(cdp.sendCommand).toHaveBeenCalledWith(
        concreteRootDebuggee(202),
        "Page.setInterceptFileChooserDialog",
        { enabled: true }
      );
      expect(cdp.sendCommand).toHaveBeenCalledWith(
        concreteRootDebuggee(202),
        "Runtime.enable",
        {}
      );
      expect(cdp.sendCommand).toHaveBeenCalledWith(
        concreteRootDebuggee(202),
        "Network.enable",
        {}
      );
      expect(cdp.sendCommand).toHaveBeenCalledWith(
        concreteRootDebuggee(202),
        "Performance.enable",
        {}
      );
    });
  });

  it("fails session.launch when root page domains cannot be enabled after attach", async () => {
    const sent: Array<{ type?: string; requestId?: string; payload?: unknown; error?: { code?: string; message?: string } }> = [];
    const cdp = {
      attach: vi.fn(async () => undefined),
      detachTab: vi.fn(async () => undefined),
      setDiscoverTargetsEnabled: vi.fn(async () => undefined),
      configureAutoAttach: vi.fn(async () => undefined),
      primeAttachedRootSession: vi.fn(async () => undefined),
      getTabDebuggee: vi.fn((tabId: number) => (
        tabId === 202
          ? { tabId: 202, sessionId: "root-session-202", targetId: "target-202", attachBy: "targetId" as const }
          : null
      )),
      sendCommand: vi.fn(async (_debuggee: chrome.debugger.Debuggee, method: string) => {
        if (method === "Page.enable") {
          throw new Error("Page.enable failed");
        }
        return {};
      })
    };

    const getMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getMock.mockResolvedValue({
      id: 202,
      status: "complete",
      url: "https://example.com/recovered",
      title: "Recovered Tab"
    } as chrome.tabs.Tab);

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; requestId?: string; payload?: unknown; error?: { code?: string; message?: string } }),
      cdp: cdp as never
    });

    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-session-root-domains-fail",
      clientId: "client-1",
      command: "session.launch",
      payload: {
        tabId: 202
      }
    });

    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_error",
            requestId: "req-session-root-domains-fail",
            error: expect.objectContaining({
              code: "cdp_attach_failed",
              message: expect.stringContaining("Page.enable failed")
            })
          })
        ])
      );
    });

    expect(sessions.listOwnedBy("client-1")).toEqual([]);
  });

  it("keeps session.launch strict root-domain enablement alive when Target.setDiscoverTargets returns Not allowed", async () => {
    const sent: Array<{ type?: string; requestId?: string; payload?: unknown; error?: { code?: string; message?: string } }> = [];
    const cdp = {
      attach: vi.fn(async () => undefined),
      detachTab: vi.fn(async () => undefined),
      markClientClosed: vi.fn(),
      setDiscoverTargetsEnabled: vi.fn(async () => {
        throw { code: -32000, message: "Not allowed" };
      }),
      configureAutoAttach: vi.fn(async () => undefined),
      primeAttachedRootSession: vi.fn(async () => undefined),
      refreshTabAttachment: vi.fn(async () => undefined),
      getTabDebuggee: vi.fn((tabId: number) => (
        tabId === 209 ? concreteRootDebuggee(209) : null
      )),
      sendCommand: vi.fn(async () => ({}))
    };

    const getMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getMock.mockResolvedValue({
      id: 209,
      status: "complete",
      url: "https://example.com/recovered-after-discover-targets-refresh",
      title: "Recovered After Discover Targets Refresh"
    } as chrome.tabs.Tab);

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; requestId?: string; payload?: unknown; error?: { code?: string; message?: string } }),
      cdp: cdp as never
    });

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-session-root-discover-targets-retry",
      clientId: "client-1",
      command: "session.launch",
      payload: {
        tabId: 209
      }
    });

    await vi.waitFor(() => {
      expect(cdp.markClientClosed).not.toHaveBeenCalled();
      expect(cdp.refreshTabAttachment).not.toHaveBeenCalled();
      expect(cdp.setDiscoverTargetsEnabled).toHaveBeenCalledTimes(1);
      expect(cdp.sendCommand).toHaveBeenCalledWith(
        concreteRootDebuggee(209),
        "Page.enable",
        {}
      );
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-session-root-discover-targets-retry",
            payload: expect.objectContaining({
              activeTargetId: "tab-209",
              url: "https://example.com/recovered-after-discover-targets-refresh",
              title: "Recovered After Discover Targets Refresh"
            })
          })
        ])
      );
    });

    expect(sent.some((message) => message.type === "ops_error" && message.error?.code === "cdp_attach_failed")).toBe(false);
  });

  it("retries session.launch strict root-domain enablement when Target.setAutoAttach returns Not allowed before Page.enable", async () => {
    const sent: Array<{ type?: string; requestId?: string; payload?: unknown; error?: { code?: string; message?: string } }> = [];
    let refreshed = false;
    const cdp = {
      attach: vi.fn(async () => undefined),
      detachTab: vi.fn(async () => undefined),
      markClientClosed: vi.fn(),
      setDiscoverTargetsEnabled: vi.fn(async () => undefined),
      configureAutoAttach: vi.fn(async () => {
        if (!refreshed) {
          throw new Error("Not allowed");
        }
      }),
      primeAttachedRootSession: vi.fn(async () => undefined),
      refreshTabAttachment: vi.fn(async () => {
        refreshed = true;
      }),
      getTabDebuggee: vi.fn((tabId: number) => (
        tabId === 212 ? concreteRootDebuggee(212) : null
      )),
      sendCommand: vi.fn(async () => ({}))
    };

    const getMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getMock.mockResolvedValue({
      id: 212,
      status: "complete",
      url: "https://example.com/recovered-after-auto-attach-refresh",
      title: "Recovered After Auto Attach Refresh"
    } as chrome.tabs.Tab);

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; requestId?: string; payload?: unknown; error?: { code?: string; message?: string } }),
      cdp: cdp as never
    });

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-session-root-auto-attach-retry",
      clientId: "client-1",
      command: "session.launch",
      payload: {
        tabId: 212
      }
    });

    await vi.waitFor(() => {
      expect(cdp.markClientClosed).toHaveBeenCalledTimes(1);
      expect(cdp.refreshTabAttachment).toHaveBeenCalledWith(212);
      expect(cdp.configureAutoAttach).toHaveBeenCalledTimes(2);
      expect(cdp.sendCommand).toHaveBeenCalledWith(
        concreteRootDebuggee(212),
        "Page.enable",
        {}
      );
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-session-root-auto-attach-retry",
            payload: expect.objectContaining({
              activeTargetId: "tab-212",
              url: "https://example.com/recovered-after-auto-attach-refresh",
              title: "Recovered After Auto Attach Refresh"
            })
          })
        ])
      );
    });

    expect(sent.some((message) => message.type === "ops_error" && message.error?.code === "cdp_attach_failed")).toBe(false);
  });

  it("surfaces strict enablement diagnostics when Target.setAutoAttach stays blocked after one refresh retry", async () => {
    const sent: Array<{
      type?: string;
      requestId?: string;
      payload?: unknown;
      error?: { code?: string; message?: string; details?: Record<string, unknown> };
    }> = [];
    const cdp = {
      attach: vi.fn(async () => undefined),
      detachTab: vi.fn(async () => undefined),
      markClientClosed: vi.fn(),
      setDiscoverTargetsEnabled: vi.fn(async () => undefined),
      configureAutoAttach: vi.fn(async () => {
        throw { code: -32000, message: "Not allowed" };
      }),
      primeAttachedRootSession: vi.fn(async () => undefined),
      refreshTabAttachment: vi.fn(async () => undefined),
      getTabDebuggee: vi.fn((tabId: number) => (
        tabId === 213 ? concreteRootDebuggee(213) : null
      )),
      sendCommand: vi.fn(async () => ({}))
    };

    const getMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getMock.mockResolvedValue({
      id: 213,
      status: "complete",
      url: "https://example.com/auto-attach-still-blocked",
      title: "Auto Attach Still Blocked"
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
      requestId: "req-session-root-auto-attach-fail",
      clientId: "client-1",
      command: "session.launch",
      payload: {
        tabId: 213
      }
    });

    await vi.waitFor(() => {
      expect(cdp.markClientClosed).toHaveBeenCalledTimes(1);
      expect(cdp.refreshTabAttachment).toHaveBeenCalledWith(213);
      expect(cdp.configureAutoAttach).toHaveBeenCalledTimes(2);
      expect(cdp.sendCommand).not.toHaveBeenCalled();
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_error",
            requestId: "req-session-root-auto-attach-fail",
            error: expect.objectContaining({
              code: "cdp_attach_failed",
              message: "{\"code\":-32000,\"message\":\"Not allowed\"} (phase: strict_enablement; stage: configure_auto_attach)",
              details: expect.objectContaining({
                phase: "strict_enablement",
                enablementStage: "configure_auto_attach",
                tabId: 213,
                strict: true,
                allowRefresh: false,
                refreshedAfterBlock: true,
                reason: "{\"code\":-32000,\"message\":\"Not allowed\"}"
              })
            })
          })
        ])
      );
    });
  });

  it("still creates the ops session when Target.setDiscoverTargets stays blocked", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const sent: Array<{ type?: string; requestId?: string; payload?: unknown; error?: { code?: string; message?: string } }> = [];
    const cdp = {
      attach: vi.fn(async () => undefined),
      detachTab: vi.fn(async () => undefined),
      markClientClosed: vi.fn(),
      setDiscoverTargetsEnabled: vi.fn(async () => {
        throw { code: -32000, message: "Not allowed" };
      }),
      configureAutoAttach: vi.fn(async () => undefined),
      primeAttachedRootSession: vi.fn(async () => undefined),
      refreshTabAttachment: vi.fn(async () => undefined),
      getTabDebuggee: vi.fn((tabId: number) => (
        tabId === 210 ? concreteRootDebuggee(210) : null
      )),
      sendCommand: vi.fn(async () => ({}))
    };

    const getMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getMock.mockResolvedValue({
      id: 210,
      status: "complete",
      url: "https://example.com/discover-targets-still-blocked",
      title: "Discover Targets Still Blocked"
    } as chrome.tabs.Tab);

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; requestId?: string; payload?: unknown; error?: { code?: string; message?: string } }),
      cdp: cdp as never
    });

    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-session-root-discover-targets-fail",
      clientId: "client-1",
      command: "session.launch",
      payload: {
        tabId: 210
      }
    });

    await vi.waitFor(() => {
      expect(cdp.markClientClosed).not.toHaveBeenCalled();
      expect(cdp.refreshTabAttachment).not.toHaveBeenCalled();
      expect(cdp.setDiscoverTargetsEnabled).toHaveBeenCalledTimes(1);
      expect(cdp.sendCommand).toHaveBeenCalledWith(
        concreteRootDebuggee(210),
        "Page.enable",
        {}
      );
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-session-root-discover-targets-fail",
            payload: expect.objectContaining({
              activeTargetId: "tab-210",
              url: "https://example.com/discover-targets-still-blocked",
              title: "Discover Targets Still Blocked"
            })
          })
        ])
      );
    });

    expect(sent.some((message) => message.type === "ops_error" && message.error?.code === "cdp_attach_failed")).toBe(false);
    expect(sessions.listOwnedBy("client-1")).toHaveLength(1);
    expect(consoleErrorSpy).not.toHaveBeenCalledWith(
      "[opendevbrowser]",
      expect.stringContaining("\"context\":\"ops.discover_targets\"")
    );
    consoleErrorSpy.mockRestore();
  });

  it("fails strict session.launch enablement when Target.setDiscoverTargets has an unexpected error", async () => {
    const sent: Array<{
      type?: string;
      requestId?: string;
      payload?: unknown;
      error?: { code?: string; message?: string; details?: Record<string, unknown> };
    }> = [];
    const cdp = {
      attach: vi.fn(async () => undefined),
      detachTab: vi.fn(async () => undefined),
      markClientClosed: vi.fn(),
      setDiscoverTargetsEnabled: vi.fn(async () => {
        throw new Error("Protocol exploded");
      }),
      configureAutoAttach: vi.fn(async () => undefined),
      primeAttachedRootSession: vi.fn(async () => undefined),
      refreshTabAttachment: vi.fn(async () => undefined),
      getTabDebuggee: vi.fn((tabId: number) => (
        tabId === 214 ? concreteRootDebuggee(214) : null
      )),
      sendCommand: vi.fn(async () => ({}))
    };

    const getMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getMock.mockResolvedValue({
      id: 214,
      status: "complete",
      url: "https://example.com/discover-targets-unexpected",
      title: "Discover Targets Unexpected"
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
      requestId: "req-session-root-discover-targets-unexpected",
      clientId: "client-1",
      command: "session.launch",
      payload: {
        tabId: 214
      }
    });

    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_error",
            requestId: "req-session-root-discover-targets-unexpected",
            error: expect.objectContaining({
              code: "cdp_attach_failed",
              message: expect.stringContaining("Protocol exploded"),
              details: expect.objectContaining({
                phase: "strict_enablement",
                enablementStage: "set_discover_targets",
                tabId: 214,
                strict: true
              })
            })
          })
        ])
      );
    });
  });

  it("retries session.launch strict root-domain enablement when Page.enable returns Not allowed after attach recovery", async () => {
    const sent: Array<{ type?: string; requestId?: string; payload?: unknown; error?: { code?: string; message?: string } }> = [];
    let refreshed = false;
    const cdp = {
      attach: vi.fn(async () => undefined),
      detachTab: vi.fn(async () => undefined),
      setDiscoverTargetsEnabled: vi.fn(async () => undefined),
      configureAutoAttach: vi.fn(async () => undefined),
      primeAttachedRootSession: vi.fn(async () => undefined),
      refreshTabAttachment: vi.fn(async () => {
        refreshed = true;
      }),
      getTabDebuggee: vi.fn((tabId: number) => {
        if (tabId !== 207) {
          return null;
        }
        return refreshed
          ? concreteRootDebuggee(207)
          : { tabId: 207, sessionId: "stale-root-session-207", targetId: "target-207", attachBy: "targetId" as const };
      }),
      sendCommand: vi.fn(async (debuggee: chrome.debugger.Debuggee, method: string) => {
        if (method === "Page.enable" && (debuggee as { sessionId?: string }).sessionId === "stale-root-session-207") {
          throw new Error("Not allowed");
        }
        return {};
      })
    };

    const getMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getMock.mockResolvedValue({
      id: 207,
      status: "complete",
      url: "https://example.com/recovered-by-domain-refresh",
      title: "Recovered By Domain Refresh"
    } as chrome.tabs.Tab);

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; requestId?: string; payload?: unknown; error?: { code?: string; message?: string } }),
      cdp: cdp as never
    });

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-session-root-domains-attach-blocked-retry",
      clientId: "client-1",
      command: "session.launch",
      payload: {
        tabId: 207
      }
    });

    await vi.waitFor(() => {
      expect(cdp.refreshTabAttachment).toHaveBeenCalledWith(207);
      expect(cdp.sendCommand).toHaveBeenCalledWith(
        expect.objectContaining({ tabId: 207, sessionId: "stale-root-session-207", targetId: "target-207" }),
        "Page.enable",
        {}
      );
      expect(cdp.sendCommand).toHaveBeenCalledWith(
        concreteRootDebuggee(207),
        "Page.enable",
        {}
      );
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-session-root-domains-attach-blocked-retry",
            payload: expect.objectContaining({
              activeTargetId: "tab-207",
              url: "https://example.com/recovered-by-domain-refresh",
              title: "Recovered By Domain Refresh"
            })
          })
        ])
      );
    });

    expect(sent.some((message) => message.type === "ops_error" && message.error?.code === "cdp_attach_failed")).toBe(false);
  });

  it("retries session.launch strict root-domain enablement when Page.enable returns a raw blocked-attach payload after attach recovery", async () => {
    const sent: Array<{ type?: string; requestId?: string; payload?: unknown; error?: { code?: string; message?: string } }> = [];
    let refreshed = false;
    const cdp = {
      attach: vi.fn(async () => undefined),
      detachTab: vi.fn(async () => undefined),
      setDiscoverTargetsEnabled: vi.fn(async () => undefined),
      configureAutoAttach: vi.fn(async () => undefined),
      primeAttachedRootSession: vi.fn(async () => undefined),
      refreshTabAttachment: vi.fn(async () => {
        refreshed = true;
      }),
      getTabDebuggee: vi.fn((tabId: number) => {
        if (tabId !== 211) {
          return null;
        }
        return refreshed
          ? concreteRootDebuggee(211)
          : { tabId: 211, sessionId: "stale-root-session-211", targetId: "target-211", attachBy: "targetId" as const };
      }),
      sendCommand: vi.fn(async (debuggee: chrome.debugger.Debuggee, method: string) => {
        if (method === "Page.enable" && (debuggee as { sessionId?: string }).sessionId === "stale-root-session-211") {
          throw { code: -32000, message: "Not allowed" };
        }
        return {};
      })
    };

    const getMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getMock.mockResolvedValue({
      id: 211,
      status: "complete",
      url: "https://example.com/recovered-by-raw-domain-refresh",
      title: "Recovered By Raw Domain Refresh"
    } as chrome.tabs.Tab);

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; requestId?: string; payload?: unknown; error?: { code?: string; message?: string } }),
      cdp: cdp as never
    });

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-session-root-domains-raw-attach-blocked-retry",
      clientId: "client-1",
      command: "session.launch",
      payload: {
        tabId: 211
      }
    });

    await vi.waitFor(() => {
      expect(cdp.refreshTabAttachment).toHaveBeenCalledWith(211);
      expect(cdp.sendCommand).toHaveBeenCalledWith(
        expect.objectContaining({ tabId: 211, sessionId: "stale-root-session-211", targetId: "target-211" }),
        "Page.enable",
        {}
      );
      expect(cdp.sendCommand).toHaveBeenCalledWith(
        concreteRootDebuggee(211),
        "Page.enable",
        {}
      );
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-session-root-domains-raw-attach-blocked-retry",
            payload: expect.objectContaining({
              activeTargetId: "tab-211",
              url: "https://example.com/recovered-by-raw-domain-refresh",
              title: "Recovered By Raw Domain Refresh"
            })
          })
        ])
      );
    });

    expect(sent.some((message) => message.type === "ops_error" && message.error?.code === "cdp_attach_failed")).toBe(false);
  });

  it("fails session.launch when strict root-domain enablement stays blocked after one refresh retry", async () => {
    const sent: Array<{ type?: string; requestId?: string; payload?: unknown; error?: { code?: string; message?: string } }> = [];
    let refreshed = false;
    const cdp = {
      attach: vi.fn(async () => undefined),
      detachTab: vi.fn(async () => undefined),
      setDiscoverTargetsEnabled: vi.fn(async () => undefined),
      configureAutoAttach: vi.fn(async () => undefined),
      primeAttachedRootSession: vi.fn(async () => undefined),
      refreshTabAttachment: vi.fn(async () => {
        refreshed = true;
      }),
      getTabDebuggee: vi.fn((tabId: number) => {
        if (tabId !== 208) {
          return null;
        }
        return refreshed
          ? concreteRootDebuggee(208)
          : { tabId: 208, sessionId: "stale-root-session-208", targetId: "target-208", attachBy: "targetId" as const };
      }),
      sendCommand: vi.fn(async (_debuggee: chrome.debugger.Debuggee, method: string) => {
        if (method === "Page.enable") {
          throw new Error("Not allowed");
        }
        return {};
      })
    };

    const getMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getMock.mockResolvedValue({
      id: 208,
      status: "complete",
      url: "https://example.com/domain-refresh-still-blocked",
      title: "Domain Refresh Still Blocked"
    } as chrome.tabs.Tab);

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; requestId?: string; payload?: unknown; error?: { code?: string; message?: string } }),
      cdp: cdp as never
    });

    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-session-root-domains-attach-blocked-fail",
      clientId: "client-1",
      command: "session.launch",
      payload: {
        tabId: 208
      }
    });

    await vi.waitFor(() => {
      expect(cdp.refreshTabAttachment).toHaveBeenCalledWith(208);
      expect(cdp.sendCommand).toHaveBeenCalledWith(
        expect.objectContaining({ tabId: 208, sessionId: "stale-root-session-208", targetId: "target-208" }),
        "Page.enable",
        {}
      );
      expect(cdp.sendCommand).toHaveBeenCalledWith(
        concreteRootDebuggee(208),
        "Page.enable",
        {}
      );
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_error",
            requestId: "req-session-root-domains-attach-blocked-fail",
            error: expect.objectContaining({
              code: "cdp_attach_failed",
              message: expect.stringContaining("Not allowed")
            })
          })
        ])
      );
    });

    expect(sessions.listOwnedBy("client-1")).toEqual([]);
  });

  it("attaches targets.new before any completion wait for the new tab", async () => {
    const sent: Array<{ type?: string; requestId?: string; payload?: unknown; error?: { code?: string } }> = [];
    let observedTabLookupBeforeAttach = false;
    const cdp = {
      attach: vi.fn(async (tabId: number) => {
        expect(tabId).toBe(403);
        expect(observedTabLookupBeforeAttach).toBe(false);
      }),
      detachTab: vi.fn(async () => undefined),
      setDiscoverTargetsEnabled: vi.fn(async () => undefined),
      configureAutoAttach: vi.fn(async () => undefined),
      primeAttachedRootSession: vi.fn(async () => undefined),
      getTabDebuggee: vi.fn((tabId: number) => (
        tabId === 403
          ? { tabId: 403, sessionId: "root-session-403", targetId: "target-403", attachBy: "targetId" as const }
          : null
      )),
      sendCommand: vi.fn(async () => ({}))
    };

    const createMock = globalThis.chrome.tabs.create as unknown as ReturnType<typeof vi.fn>;
    const getMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    createMock.mockImplementation((_createProperties, callback) => {
      callback?.({
        id: 403,
        status: "loading",
        url: "https://example.com/loading-target",
        title: "Loading Target"
      } as chrome.tabs.Tab);
    });
    getMock.mockImplementation(async (tabId: number) => {
      if (tabId === 403) {
        observedTabLookupBeforeAttach = true;
      }
      return {
        id: tabId,
        status: "loading",
        url: "https://example.com/loading-target",
        title: "Loading Target"
      } as chrome.tabs.Tab;
    });

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; requestId?: string; payload?: unknown; error?: { code?: string } }),
      cdp: cdp as never
    });

    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const session = sessions.createSession("client-1", 101, "lease-1", {
      url: "https://example.com/root",
      title: "Root"
    });

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-targets-new-no-prewait",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "targets.new",
      payload: {
        url: "https://example.com/loading-target"
      }
    });

    await vi.waitFor(() => {
      expect(cdp.attach).toHaveBeenCalledWith(403);
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-targets-new-no-prewait",
            payload: expect.objectContaining({
              targetId: "tab-403"
            })
          })
        ])
      );
    });
  });

  it("attaches page.open before any completion wait for the new tab", async () => {
    const sent: Array<{ type?: string; requestId?: string; payload?: unknown; error?: { code?: string } }> = [];
    let observedTabLookupBeforeAttach = false;
    const cdp = {
      attach: vi.fn(async (tabId: number) => {
        expect(tabId).toBe(410);
        expect(observedTabLookupBeforeAttach).toBe(false);
      }),
      detachTab: vi.fn(async () => undefined),
      setDiscoverTargetsEnabled: vi.fn(async () => undefined),
      configureAutoAttach: vi.fn(async () => undefined),
      primeAttachedRootSession: vi.fn(async () => undefined),
      getTabDebuggee: vi.fn((tabId: number) => (
        tabId === 410
          ? { tabId: 410, sessionId: "root-session-410", targetId: "target-410", attachBy: "targetId" as const }
          : null
      )),
      sendCommand: vi.fn(async () => ({}))
    };

    const createMock = globalThis.chrome.tabs.create as unknown as ReturnType<typeof vi.fn>;
    const getMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    createMock.mockImplementation((_createProperties, callback) => {
      callback?.({
        id: 410,
        status: "loading",
        url: "https://example.com/loading-page-open",
        title: "Loading Page Open"
      } as chrome.tabs.Tab);
    });
    getMock.mockImplementation(async (tabId: number) => {
      if (tabId === 410) {
        observedTabLookupBeforeAttach = true;
      }
      return {
        id: tabId,
        status: "loading",
        url: "https://example.com/loading-page-open",
        title: "Loading Page Open"
      } as chrome.tabs.Tab;
    });

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; requestId?: string; payload?: unknown; error?: { code?: string } }),
      cdp: cdp as never
    });

    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const session = sessions.createSession("client-1", 101, "lease-1", {
      url: "https://example.com/root",
      title: "Root"
    });

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-page-open-no-prewait",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "page.open",
      payload: {
        name: "loading-page-open",
        url: "https://example.com/loading-page-open"
      }
    });

    await vi.waitFor(() => {
      expect(cdp.attach).toHaveBeenCalledWith(410);
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-page-open-no-prewait",
            payload: expect.objectContaining({
              targetId: "tab-410",
              created: true
            })
          })
        ])
      );
    });
  });

  it("reports pending loading-target metadata after targets.new in immediate session.status", async () => {
    const sent: Array<{ type?: string; requestId?: string; payload?: unknown; error?: { code?: string } }> = [];
    const cdp = {
      attach: vi.fn(async () => undefined),
      detachTab: vi.fn(async () => undefined),
      setDiscoverTargetsEnabled: vi.fn(async () => undefined),
      configureAutoAttach: vi.fn(async () => undefined),
      primeAttachedRootSession: vi.fn(async () => undefined),
      getTabDebuggee: vi.fn((tabId: number) => (
        tabId === 407
          ? { tabId: 407, sessionId: "root-session-407", targetId: "target-407", attachBy: "targetId" as const }
          : null
      )),
      sendCommand: vi.fn(async () => ({}))
    };

    const createMock = globalThis.chrome.tabs.create as unknown as ReturnType<typeof vi.fn>;
    const getMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    createMock.mockImplementation((_createProperties, callback) => {
      callback?.({
        id: 407,
        status: "loading",
        pendingUrl: "https://example.com/browser-automation",
        url: "https://example.com/headless-browser",
        title: "Headless browser - Wikipedia"
      } as chrome.tabs.Tab);
    });
    getMock.mockImplementation(async (tabId: number) => ({
      id: tabId,
      status: tabId === 407 ? "loading" : "complete",
      pendingUrl: tabId === 407 ? "https://example.com/browser-automation" : undefined,
      url: tabId === 407 ? "https://example.com/headless-browser" : "https://example.com/root",
      title: tabId === 407 ? "Headless browser - Wikipedia" : "Root"
    } as chrome.tabs.Tab));

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; requestId?: string; payload?: unknown; error?: { code?: string } }),
      cdp: cdp as never
    });

    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const session = sessions.createSession("client-1", 101, "lease-1", {
      url: "https://example.com/root",
      title: "Root"
    });

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-targets-new-loading-metadata",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "targets.new",
      payload: {
        url: "https://example.com/browser-automation"
      }
    });
    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-targets-new-loading-metadata",
            payload: expect.objectContaining({
              targetId: "tab-407"
            })
          })
        ])
      );
    });

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-session-status-loading-metadata",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "session.status",
      payload: {}
    });
    await flushMicrotasks();

    expect(sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "ops_response",
          requestId: "req-session-status-loading-metadata",
          payload: expect.objectContaining({
            activeTargetId: "tab-407",
            url: "https://example.com/browser-automation",
            title: undefined
          })
        })
      ])
    );
  });

  it("refreshes created tab metadata before persisting a targets.new target", async () => {
    const sent: Array<{ type?: string; requestId?: string; payload?: unknown; error?: { code?: string } }> = [];
    const cdp = {
      attach: vi.fn(async () => undefined),
      detachTab: vi.fn(async () => undefined),
      setDiscoverTargetsEnabled: vi.fn(async () => undefined),
      configureAutoAttach: vi.fn(async () => undefined),
      primeAttachedRootSession: vi.fn(async () => undefined),
      getTabDebuggee: vi.fn((tabId: number) => (
        tabId === 408
          ? { tabId: 408, sessionId: "root-session-408", targetId: "target-408", attachBy: "targetId" as const }
          : null
      )),
      sendCommand: vi.fn(async () => ({}))
    };

    const createMock = globalThis.chrome.tabs.create as unknown as ReturnType<typeof vi.fn>;
    const getMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    const updateMock = globalThis.chrome.tabs.update as unknown as ReturnType<typeof vi.fn>;
    createMock.mockImplementation((_createProperties, callback) => {
      callback?.({
        id: 408,
        status: "complete",
        url: "https://example.com/headless-browser",
        title: "Headless browser - Wikipedia"
      } as chrome.tabs.Tab);
    });
    getMock.mockImplementation(async (tabId: number) => ({
      id: tabId,
      status: tabId === 408 ? "loading" : "complete",
      pendingUrl: tabId === 408 ? "https://example.com/browser-automation" : undefined,
      url: tabId === 408 ? "https://example.com/headless-browser" : "https://example.com/root",
      title: tabId === 408 ? "Headless browser - Wikipedia" : "Root"
    } as chrome.tabs.Tab));

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; requestId?: string; payload?: unknown; error?: { code?: string } }),
      cdp: cdp as never
    });

    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const session = sessions.createSession("client-1", 101, "lease-1", {
      url: "https://example.com/root",
      title: "Root"
    });

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-targets-new-refresh-seed",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "targets.new",
      payload: {
        url: "https://example.com/browser-automation"
      }
    });

    await vi.waitFor(() => {
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "https://example.com/browser-automation",
          active: false
        }),
        expect.any(Function)
      );
      expect(getMock).toHaveBeenCalledWith(408);
      expect(updateMock).toHaveBeenCalledWith(408, { active: true }, expect.any(Function));
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-targets-new-refresh-seed",
            payload: expect.objectContaining({
              targetId: "tab-408"
            })
          })
        ])
      );
      expect(session.targets.get("tab-408")).toEqual(
        expect.objectContaining({
          targetId: "tab-408",
          tabId: 408,
          url: "https://example.com/browser-automation",
          title: undefined
        })
      );
    });
  });

  it("ignores in-flight targets.new tab listener adoption until the command-owned attach completes", async () => {
    const mock = createChromeMock({
      activeTab: {
        id: 101,
        url: "https://example.com/root",
        title: "Root",
        status: "complete",
        active: true
      }
    });
    globalThis.chrome = mock.chrome;

    let releaseAttach: (() => void) | null = null;
    const attachGate = new Promise<void>((resolve) => {
      releaseAttach = resolve;
    });
    let attachObserved = false;

    const sent: Array<{ type?: string; requestId?: string; payload?: unknown; error?: { code?: string } }> = [];
    const cdp = {
      attach: vi.fn(async (tabId: number) => {
        if (tabId === 411) {
          attachObserved = true;
          await attachGate;
        }
      }),
      detachTab: vi.fn(async () => undefined),
      setDiscoverTargetsEnabled: vi.fn(async () => undefined),
      configureAutoAttach: vi.fn(async () => undefined),
      primeAttachedRootSession: vi.fn(async () => undefined),
      getTabDebuggee: vi.fn((tabId: number) => (
        tabId === 411
          ? { tabId: 411, sessionId: "root-session-411", targetId: "target-411", attachBy: "targetId" as const }
          : null
      )),
      resolveTabOpenerTargetId: vi.fn(async (tabId: number) => (tabId === 411 ? "tab-101" : null)),
      sendCommand: vi.fn(async () => ({}))
    };

    const createMock = globalThis.chrome.tabs.create as unknown as ReturnType<typeof vi.fn>;
    const getMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    createMock.mockImplementation((_createProperties, callback) => {
      callback?.({
        id: 411,
        status: "loading",
        url: "about:blank",
        title: "about:blank",
        active: false
      } as chrome.tabs.Tab);
    });
    getMock.mockImplementation(async (tabId: number) => ({
      id: tabId,
      status: tabId === 411 && !attachObserved ? "loading" : "complete",
      url: tabId === 411 ? "https://example.com/raced-target" : "https://example.com/root",
      title: tabId === 411 ? "Raced Target" : "Root",
      active: false
    } as chrome.tabs.Tab));

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; requestId?: string; payload?: unknown; error?: { code?: string } }),
      cdp: cdp as never
    });

    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const session = sessions.createSession("client-1", 101, "lease-1", {
      url: "https://example.com/root",
      title: "Root"
    });

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-targets-new-command-owned",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "targets.new",
      payload: {
        url: "https://example.com/raced-target"
      }
    });

    await vi.waitFor(() => {
      expect(cdp.attach).toHaveBeenCalledWith(411);
    });

    mock.emitTabCreated({
      id: 411,
      status: "loading",
      url: "about:blank",
      title: "about:blank",
      active: false
    } as chrome.tabs.Tab);
    mock.emitTabUpdated(411, {
      id: 411,
      status: "complete",
      url: "https://example.com/raced-target",
      title: "Raced Target",
      active: false
    } as chrome.tabs.Tab);

    await flushMicrotasks();
    expect(session.targets.has("tab-411")).toBe(false);

    releaseAttach?.();

    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-targets-new-command-owned",
            payload: expect.objectContaining({
              targetId: "tab-411"
            })
          })
        ])
      );
      expect(session.targets.get("tab-411")).toEqual(
        expect.objectContaining({
          targetId: "tab-411",
          tabId: 411,
          url: "https://example.com/raced-target"
        })
      );
    });
  });

  it("reuses an already attached created tab when Chrome reports another attached debugger", async () => {
    const sent: Array<{ type?: string; requestId?: string; payload?: unknown; error?: { code?: string } }> = [];
    const cdp = {
      attach: vi.fn()
        .mockRejectedValueOnce(new Error("Another debugger is already attached to the tab with id: 412."))
        .mockRejectedValueOnce(new Error("Another debugger is already attached to the tab with id: 412.")),
      detachTab: vi.fn(async () => undefined),
      markClientClosed: vi.fn(),
      isTabAttached: vi.fn((tabId: number) => tabId === 412),
      setDiscoverTargetsEnabled: vi.fn(async () => undefined),
      configureAutoAttach: vi.fn(async () => undefined),
      primeAttachedRootSession: vi.fn(async () => undefined),
      getTabDebuggee: vi.fn((tabId: number) => (
        tabId === 412
          ? { tabId: 412, sessionId: "root-session-412", targetId: "target-412", attachBy: "targetId" as const }
          : null
      )),
      sendCommand: vi.fn(async () => ({}))
    };

    const createMock = globalThis.chrome.tabs.create as unknown as ReturnType<typeof vi.fn>;
    const getMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    createMock.mockImplementation((_createProperties, callback) => {
      callback?.({
        id: 412,
        status: "complete",
        url: "https://example.com/already-attached",
        title: "Already Attached"
      } as chrome.tabs.Tab);
    });
    getMock.mockResolvedValue({
      id: 412,
      status: "complete",
      url: "https://example.com/already-attached",
      title: "Already Attached"
    } as chrome.tabs.Tab);

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; requestId?: string; payload?: unknown; error?: { code?: string } }),
      cdp: cdp as never
    });

    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const session = sessions.createSession("client-1", 101, "lease-1", {
      url: "https://example.com/root",
      title: "Root"
    });

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-targets-new-already-attached",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "targets.new",
      payload: {
        url: "https://example.com/already-attached"
      }
    });

    await vi.waitFor(() => {
      expect(cdp.attach).not.toHaveBeenCalled();
      expect(cdp.markClientClosed).not.toHaveBeenCalled();
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-targets-new-already-attached",
            payload: expect.objectContaining({
              targetId: "tab-412"
            })
          })
        ])
      );
    });
  });

  it("reclaims an already adopted created tab into the current session before reusing the attached root", async () => {
    const sent: Array<{ type?: string; requestId?: string; payload?: unknown; error?: { code?: string } }> = [];
    const cdp = {
      attach: vi.fn(async () => undefined),
      detachTab: vi.fn(async () => undefined),
      markClientClosed: vi.fn(),
      isTabAttached: vi.fn((tabId: number) => tabId === 413),
      setDiscoverTargetsEnabled: vi.fn(async () => undefined),
      configureAutoAttach: vi.fn(async () => undefined),
      primeAttachedRootSession: vi.fn(async () => undefined),
      getTabDebuggee: vi.fn((tabId: number) => (
        tabId === 413
          ? { tabId: 413, sessionId: "root-session-413", targetId: "target-413", attachBy: "targetId" as const }
          : null
      )),
      sendCommand: vi.fn(async () => ({}))
    };

    const createMock = globalThis.chrome.tabs.create as unknown as ReturnType<typeof vi.fn>;
    const getMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    createMock.mockImplementation((_createProperties, callback) => {
      callback?.({
        id: 413,
        status: "complete",
        url: "https://example.com/reclaimed-created-tab",
        title: "Reclaimed Created Tab"
      } as chrome.tabs.Tab);
    });
    getMock.mockResolvedValue({
      id: 413,
      status: "complete",
      url: "https://example.com/reclaimed-created-tab",
      title: "Reclaimed Created Tab"
    } as chrome.tabs.Tab);

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; requestId?: string; payload?: unknown; error?: { code?: string } }),
      cdp: cdp as never
    });

    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const staleSession = sessions.createSession("client-stale", 100, "lease-stale", {
      url: "https://example.com/stale-root",
      title: "Stale Root"
    });
    const currentSession = sessions.createSession("client-1", 101, "lease-1", {
      url: "https://example.com/current-root",
      title: "Current Root"
    });
    sessions.addTarget(staleSession.id, 413, {
      url: "about:blank",
      title: "about:blank",
      openerTargetId: "tab-100"
    });

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-targets-new-reclaim-existing-owner",
      clientId: "client-1",
      opsSessionId: currentSession.id,
      leaseId: currentSession.leaseId,
      command: "targets.new",
      payload: {
        url: "https://example.com/reclaimed-created-tab"
      }
    });

    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-targets-new-reclaim-existing-owner",
            payload: expect.objectContaining({
              targetId: "tab-413"
            })
          })
        ])
      );
    });

    expect(cdp.attach).not.toHaveBeenCalledWith(413);
    expect(cdp.markClientClosed).not.toHaveBeenCalled();
    expect(staleSession.targets.has("tab-413")).toBe(false);
    expect(currentSession.targets.get("tab-413")).toEqual(
      expect.objectContaining({
        targetId: "tab-413",
        tabId: 413,
        url: "https://example.com/reclaimed-created-tab",
        title: "Reclaimed Created Tab",
        openerTargetId: undefined
      })
    );
    expect(currentSession.activeTargetId).toBe("tab-413");
  });

  it("primes page domains on a newly created target before promoting it active", async () => {
    const sent: Array<{ type?: string; requestId?: string; payload?: unknown; error?: { code?: string } }> = [];
    const cdp = {
      attach: vi.fn(async () => undefined),
      detachTab: vi.fn(async () => undefined),
      setDiscoverTargetsEnabled: vi.fn(async () => undefined),
      configureAutoAttach: vi.fn(async () => undefined),
      primeAttachedRootSession: vi.fn(async () => undefined),
      getTabDebuggee: vi.fn((tabId: number) => (
        tabId === 404
          ? { tabId: 404, sessionId: "root-session-404", targetId: "target-404", attachBy: "targetId" as const }
          : null
      )),
      sendCommand: vi.fn(async () => ({}))
    };

    const createMock = globalThis.chrome.tabs.create as unknown as ReturnType<typeof vi.fn>;
    const getMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    const updateMock = globalThis.chrome.tabs.update as unknown as ReturnType<typeof vi.fn>;
    createMock.mockImplementation((_createProperties, callback) => {
      callback?.({
        id: 404,
        status: "complete",
        url: "https://example.com/new-target",
        title: "New Target"
      } as chrome.tabs.Tab);
    });
    getMock.mockResolvedValue({
      id: 404,
      status: "complete",
      url: "https://example.com/new-target",
      title: "New Target"
    } as chrome.tabs.Tab);

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; requestId?: string; payload?: unknown; error?: { code?: string } }),
      cdp: cdp as never
    });

    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const session = sessions.createSession("client-1", 101, "lease-1", {
      url: "https://example.com/root",
      title: "Root"
    });

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-targets-new-prime-domains",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "targets.new",
      payload: {
        url: "https://example.com/new-target"
      }
    });

    await vi.waitFor(() => {
      expect(cdp.attach).toHaveBeenCalledWith(404);
      expect(cdp.sendCommand).toHaveBeenCalledWith(
        concreteRootDebuggee(404),
        "Page.enable",
        {}
      );
      expect(cdp.sendCommand).toHaveBeenCalledWith(
        concreteRootDebuggee(404),
        "Page.setInterceptFileChooserDialog",
        { enabled: true }
      );
      expect(cdp.sendCommand).toHaveBeenCalledWith(
        concreteRootDebuggee(404),
        "Runtime.enable",
        {}
      );
      expect(cdp.sendCommand).toHaveBeenCalledWith(
        concreteRootDebuggee(404),
        "Network.enable",
        {}
      );
      expect(cdp.sendCommand).toHaveBeenCalledWith(
        concreteRootDebuggee(404),
        "Performance.enable",
        {}
      );
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-targets-new-prime-domains",
            payload: expect.objectContaining({
              targetId: "tab-404"
            })
          })
        ])
      );
    });

    expect(session.activeTargetId).toBe("tab-404");
  });

  it("recovers blocked attach for targets.new by resetting the client before retrying", async () => {
    vi.useFakeTimers();
    const sent: Array<{ type?: string; requestId?: string; payload?: unknown; error?: { code?: string } }> = [];
    const cdp = {
      attach: vi.fn()
        .mockRejectedValueOnce(new Error("Not allowed"))
        .mockRejectedValueOnce(new Error("Not allowed"))
        .mockResolvedValueOnce(undefined),
      detachTab: vi.fn(async () => undefined),
      markClientClosed: vi.fn(),
      isTabAttached: vi.fn(() => false),
      setDiscoverTargetsEnabled: vi.fn(async () => undefined),
      configureAutoAttach: vi.fn(async () => undefined),
      primeAttachedRootSession: vi.fn(async () => undefined),
      getTabDebuggee: vi.fn((tabId: number) => (
        tabId === 405
          ? { tabId: 405, sessionId: "root-session-405", targetId: "target-405", attachBy: "targetId" as const }
          : null
      )),
      sendCommand: vi.fn(async () => ({}))
    };

    const createMock = globalThis.chrome.tabs.create as unknown as ReturnType<typeof vi.fn>;
    const getMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    createMock.mockImplementation((_createProperties, callback) => {
      callback?.({
        id: 405,
        status: "complete",
        url: "https://example.com/new-target-reset",
        title: "New Target Reset"
      } as chrome.tabs.Tab);
    });
    getMock.mockResolvedValue({
      id: 405,
      status: "complete",
      url: "https://example.com/new-target-reset",
      title: "New Target Reset"
    } as chrome.tabs.Tab);

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; requestId?: string; payload?: unknown; error?: { code?: string } }),
      cdp: cdp as never
    });

    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const session = sessions.createSession("client-1", 101, "lease-1", {
      url: "https://example.com/root",
      title: "Root"
    });

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-targets-new-reset-client",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "targets.new",
      payload: {
        url: "https://example.com/new-target-reset"
      }
    });

    await vi.advanceTimersByTimeAsync(50);
    await vi.waitFor(() => {
      expect(cdp.attach).toHaveBeenCalledTimes(3);
      expect(cdp.markClientClosed).toHaveBeenCalledTimes(1);
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-targets-new-reset-client",
            payload: expect.objectContaining({
              targetId: "tab-405"
            })
          })
        ])
      );
    });
  });

  it("primes page domains for page.open targets after blocked attach recovery", async () => {
    vi.useFakeTimers();
    const sent: Array<{ type?: string; requestId?: string; payload?: unknown; error?: { code?: string } }> = [];
    const cdp = {
      attach: vi.fn()
        .mockRejectedValueOnce(new Error("Not allowed"))
        .mockRejectedValueOnce(new Error("Not allowed"))
        .mockResolvedValueOnce(undefined),
      detachTab: vi.fn(async () => undefined),
      markClientClosed: vi.fn(),
      isTabAttached: vi.fn(() => false),
      setDiscoverTargetsEnabled: vi.fn(async () => undefined),
      configureAutoAttach: vi.fn(async () => undefined),
      primeAttachedRootSession: vi.fn(async () => undefined),
      getTabDebuggee: vi.fn((tabId: number) => (
        tabId === 406
          ? { tabId: 406, sessionId: "root-session-406", targetId: "target-406", attachBy: "targetId" as const }
          : null
      )),
      sendCommand: vi.fn(async () => ({}))
    };

    const createMock = globalThis.chrome.tabs.create as unknown as ReturnType<typeof vi.fn>;
    const getMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    createMock.mockImplementation((_createProperties, callback) => {
      callback?.({
        id: 406,
        status: "complete",
        url: "https://example.com/page-open-reset",
        title: "Page Open Reset"
      } as chrome.tabs.Tab);
    });
    getMock.mockResolvedValue({
      id: 406,
      status: "complete",
      url: "https://example.com/page-open-reset",
      title: "Page Open Reset"
    } as chrome.tabs.Tab);

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; requestId?: string; payload?: unknown; error?: { code?: string } }),
      cdp: cdp as never
    });

    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const session = sessions.createSession("client-1", 101, "lease-1", {
      url: "https://example.com/root",
      title: "Root"
    });

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-page-open-reset-client",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "page.open",
      payload: {
        name: "reset-page",
        url: "https://example.com/page-open-reset"
      }
    });

    await vi.advanceTimersByTimeAsync(50);
    await vi.waitFor(() => {
      expect(cdp.attach).toHaveBeenCalledTimes(3);
      expect(cdp.markClientClosed).toHaveBeenCalledTimes(1);
      expect(cdp.sendCommand).toHaveBeenCalledWith(
        concreteRootDebuggee(406),
        "Page.setInterceptFileChooserDialog",
        { enabled: true }
      );
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-page-open-reset-client",
            payload: expect.objectContaining({
              targetId: "tab-406",
              created: true
            })
          })
        ])
      );
    });
  });

  it("refreshes created tab metadata before responding from page.open", async () => {
    const sent: Array<{ type?: string; requestId?: string; payload?: unknown; error?: { code?: string } }> = [];
    const cdp = {
      attach: vi.fn(async () => undefined),
      detachTab: vi.fn(async () => undefined),
      setDiscoverTargetsEnabled: vi.fn(async () => undefined),
      configureAutoAttach: vi.fn(async () => undefined),
      primeAttachedRootSession: vi.fn(async () => undefined),
      getTabDebuggee: vi.fn((tabId: number) => (
        tabId === 409
          ? { tabId: 409, sessionId: "root-session-409", targetId: "target-409", attachBy: "targetId" as const }
          : null
      )),
      sendCommand: vi.fn(async () => ({}))
    };

    const createMock = globalThis.chrome.tabs.create as unknown as ReturnType<typeof vi.fn>;
    const getMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    const updateMock = globalThis.chrome.tabs.update as unknown as ReturnType<typeof vi.fn>;
    createMock.mockImplementation((_createProperties, callback) => {
      callback?.({
        id: 409,
        status: "complete",
        url: "https://example.com/headless-browser",
        title: "Headless browser - Wikipedia"
      } as chrome.tabs.Tab);
    });
    getMock.mockImplementation(async (tabId: number) => ({
      id: tabId,
      status: "complete",
      url: tabId === 409 ? "https://example.com/browser-automation" : "https://example.com/root",
      title: tabId === 409 ? "Browser automation - Wikipedia" : "Root"
    } as chrome.tabs.Tab));

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; requestId?: string; payload?: unknown; error?: { code?: string } }),
      cdp: cdp as never
    });

    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const session = sessions.createSession("client-1", 101, "lease-1", {
      url: "https://example.com/root",
      title: "Root"
    });

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-page-open-refresh-seed",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "page.open",
      payload: {
        name: "browser-automation",
        url: "https://example.com/browser-automation"
      }
    });

    await vi.waitFor(() => {
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "https://example.com/browser-automation",
          active: false
        }),
        expect.any(Function)
      );
      expect(getMock).toHaveBeenCalledWith(409);
      expect(updateMock).toHaveBeenCalledWith(409, { active: true }, expect.any(Function));
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-page-open-refresh-seed",
            payload: expect.objectContaining({
              targetId: "tab-409",
              created: true,
              url: "https://example.com/browser-automation",
              title: "Browser automation - Wikipedia"
            })
          })
        ])
      );
      expect(session.targets.get("tab-409")).toEqual(
        expect.objectContaining({
          targetId: "tab-409",
          tabId: 409,
          url: "https://example.com/browser-automation",
          title: "Browser automation - Wikipedia"
        })
      );
    });
  });

  it("ignores in-flight page.open tab listener adoption until the command-owned attach completes", async () => {
    const mock = createChromeMock({
      activeTab: {
        id: 101,
        url: "https://example.com/root",
        title: "Root",
        status: "complete",
        active: true
      }
    });
    globalThis.chrome = mock.chrome;

    let releaseAttach: (() => void) | null = null;
    const attachGate = new Promise<void>((resolve) => {
      releaseAttach = resolve;
    });
    let attachObserved = false;

    const sent: Array<{ type?: string; requestId?: string; payload?: unknown; error?: { code?: string } }> = [];
    const cdp = {
      attach: vi.fn(async (tabId: number) => {
        if (tabId === 413) {
          attachObserved = true;
          await attachGate;
        }
      }),
      detachTab: vi.fn(async () => undefined),
      setDiscoverTargetsEnabled: vi.fn(async () => undefined),
      configureAutoAttach: vi.fn(async () => undefined),
      primeAttachedRootSession: vi.fn(async () => undefined),
      getTabDebuggee: vi.fn((tabId: number) => (
        tabId === 413
          ? { tabId: 413, sessionId: "root-session-413", targetId: "target-413", attachBy: "targetId" as const }
          : null
      )),
      resolveTabOpenerTargetId: vi.fn(async (tabId: number) => (tabId === 413 ? "tab-101" : null)),
      sendCommand: vi.fn(async () => ({}))
    };

    const createMock = globalThis.chrome.tabs.create as unknown as ReturnType<typeof vi.fn>;
    const getMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    createMock.mockImplementation((_createProperties, callback) => {
      callback?.({
        id: 413,
        status: "loading",
        url: "about:blank",
        title: "about:blank",
        active: false
      } as chrome.tabs.Tab);
    });
    getMock.mockImplementation(async (tabId: number) => ({
      id: tabId,
      status: tabId === 413 && !attachObserved ? "loading" : "complete",
      url: tabId === 413 ? "https://example.com/raced-page-open" : "https://example.com/root",
      title: tabId === 413 ? "Raced Page Open" : "Root",
      active: false
    } as chrome.tabs.Tab));

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; requestId?: string; payload?: unknown; error?: { code?: string } }),
      cdp: cdp as never
    });

    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const session = sessions.createSession("client-1", 101, "lease-1", {
      url: "https://example.com/root",
      title: "Root"
    });

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-page-open-command-owned",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "page.open",
      payload: {
        name: "raced-page-open",
        url: "https://example.com/raced-page-open"
      }
    });

    await vi.waitFor(() => {
      expect(cdp.attach).toHaveBeenCalledWith(413);
    });

    mock.emitTabCreated({
      id: 413,
      status: "loading",
      url: "about:blank",
      title: "about:blank",
      active: false
    } as chrome.tabs.Tab);
    mock.emitTabUpdated(413, {
      id: 413,
      status: "complete",
      url: "https://example.com/raced-page-open",
      title: "Raced Page Open",
      active: false
    } as chrome.tabs.Tab);

    await flushMicrotasks();
    expect(session.targets.has("tab-413")).toBe(false);

    releaseAttach?.();

    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-page-open-command-owned",
            payload: expect.objectContaining({
              targetId: "tab-413",
              created: true
            })
          })
        ])
      );
      expect(session.targets.get("tab-413")).toEqual(
        expect.objectContaining({
          targetId: "tab-413",
          tabId: 413,
          url: "https://example.com/raced-page-open"
        })
      );
      expect((runtime as unknown as { sessions: OpsSessionStore }).sessions.getTargetIdByName(session.id, "raced-page-open")).toBe("tab-413");
    });
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
      primeAttachedRootSession: vi.fn(async () => undefined),
      getTabDebuggee: vi.fn((tabId: number) => (
        tabId === 202 ? concreteRootDebuggee(202) : null
      )),
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

  it("resets the client and retries session.launch when blocked attach persists after the first retry", async () => {
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
      primeAttachedRootSession: vi.fn(async () => undefined),
      getTabDebuggee: vi.fn((tabId: number) => (
        tabId === 203 ? concreteRootDebuggee(203) : null
      )),
      sendCommand: vi.fn(async () => ({}))
    };

    const getMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getMock.mockResolvedValue({
      id: 203,
      status: "complete",
      url: "https://example.com/recovered-after-reset",
      title: "Recovered After Reset"
    } as chrome.tabs.Tab);

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; requestId?: string; payload?: unknown; error?: { code?: string } }),
      cdp: cdp as never
    });

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-session-launch-reset-retry",
      clientId: "client-1",
      command: "session.launch",
      payload: {
        tabId: 203
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
            requestId: "req-session-launch-reset-retry",
            payload: expect.objectContaining({
              activeTargetId: "tab-203",
              url: "https://example.com/recovered-after-reset",
              title: "Recovered After Reset"
            })
          })
        ])
      );
    });

    expect(cdp.attach).toHaveBeenNthCalledWith(1, 203);
    expect(cdp.attach).toHaveBeenNthCalledWith(2, 203);
    expect(cdp.attach).toHaveBeenNthCalledWith(3, 203);
    expect(sent.some((message) => message.type === "ops_error" && message.error?.code === "cdp_attach_failed")).toBe(false);
  });

  it("refreshes the tab attachment when session.launch remains blocked after client reset", async () => {
    vi.useFakeTimers();
    const sent: Array<{ type?: string; requestId?: string; payload?: unknown; error?: { code?: string } }> = [];
    let refreshedRootReady = false;
    const cdp = {
      attach: vi.fn()
        .mockRejectedValueOnce(new Error("Not allowed"))
        .mockRejectedValueOnce(new Error("Not allowed"))
        .mockRejectedValueOnce(new Error("Not allowed"))
        .mockRejectedValueOnce(new Error("Not allowed")),
      detachTab: vi.fn(async () => undefined),
      markClientClosed: vi.fn(),
      refreshTabAttachment: vi.fn(async () => {
        refreshedRootReady = true;
      }),
      setDiscoverTargetsEnabled: vi.fn(async () => undefined),
      configureAutoAttach: vi.fn(async () => undefined),
      primeAttachedRootSession: vi.fn(async () => undefined),
      getTabDebuggee: vi.fn((tabId: number) => (
        refreshedRootReady && tabId === 204
          ? { tabId: 204, sessionId: "root-session-204", targetId: "target-204", attachBy: "targetId" as const }
          : null
      )),
      sendCommand: vi.fn(async () => ({}))
    };

    const getMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getMock.mockResolvedValue({
      id: 204,
      status: "complete",
      url: "https://example.com/recovered-by-refresh",
      title: "Recovered By Refresh"
    } as chrome.tabs.Tab);

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; requestId?: string; payload?: unknown; error?: { code?: string } }),
      cdp: cdp as never
    });

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-session-launch-refresh-retry",
      clientId: "client-1",
      command: "session.launch",
      payload: {
        tabId: 204
      }
    });

    await vi.advanceTimersByTimeAsync(150);
    await vi.waitFor(() => {
      expect(cdp.attach).toHaveBeenCalledTimes(4);
      expect(cdp.markClientClosed).toHaveBeenCalledTimes(1);
      expect(cdp.refreshTabAttachment).toHaveBeenCalledWith(204);
      expect(cdp.sendCommand).toHaveBeenCalledWith(
        { tabId: 204, sessionId: "root-session-204", targetId: "target-204", attachBy: "targetId" },
        "Page.enable",
        {}
      );
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-session-launch-refresh-retry",
            payload: expect.objectContaining({
              activeTargetId: "tab-204",
              url: "https://example.com/recovered-by-refresh",
              title: "Recovered By Refresh"
            })
          })
        ])
      );
    });

    expect(sent.some((message) => message.type === "ops_error" && message.error?.code === "cdp_attach_failed")).toBe(false);
  });

  it("primes an attached root session before strict launch enablement when attach recovery only exposes a targetId", async () => {
    const sent: Array<{ type?: string; requestId?: string; payload?: unknown; error?: { code?: string; message?: string } }> = [];
    let attachedRootPrimed = false;
    const cdp = {
      attach: vi.fn(async () => undefined),
      detachTab: vi.fn(async () => undefined),
      setDiscoverTargetsEnabled: vi.fn(async () => undefined),
      configureAutoAttach: vi.fn(async () => undefined),
      primeAttachedRootSession: vi.fn(async () => {
        attachedRootPrimed = true;
      }),
      getTabDebuggee: vi.fn((tabId: number) => {
        if (tabId !== 206) {
          return null;
        }
        return attachedRootPrimed
          ? concreteRootDebuggee(206)
          : { tabId: 206, targetId: "target-206", attachBy: "targetId" as const };
      }),
      sendCommand: vi.fn(async () => ({}))
    };

    const getMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getMock.mockResolvedValue({
      id: 206,
      status: "complete",
      url: "https://example.com/recovered-with-target-only-root",
      title: "Recovered With Target Only Root"
    } as chrome.tabs.Tab);

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; requestId?: string; payload?: unknown; error?: { code?: string; message?: string } }),
      cdp: cdp as never
    });

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-session-launch-prime-attached-root",
      clientId: "client-1",
      command: "session.launch",
      payload: {
        tabId: 206
      }
    });

    await vi.waitFor(() => {
      expect(cdp.primeAttachedRootSession).toHaveBeenCalledWith(206);
      expect(cdp.sendCommand).toHaveBeenCalledWith(
        concreteRootDebuggee(206),
        "Page.enable",
        {}
      );
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-session-launch-prime-attached-root",
            payload: expect.objectContaining({
              activeTargetId: "tab-206",
              url: "https://example.com/recovered-with-target-only-root",
              title: "Recovered With Target Only Root"
            })
          })
        ])
      );
    });

    expect(sent.some((message) => message.type === "ops_error" && message.error?.code === "cdp_attach_failed")).toBe(false);
  });

  it("accepts a targetId-only root debuggee during strict launch enablement after priming exhausts session recovery", async () => {
    const sent: Array<{ type?: string; requestId?: string; payload?: unknown; error?: { code?: string; message?: string } }> = [];
    const targetOnlyRootDebuggee = { tabId: 207, targetId: "target-207", attachBy: "targetId" as const };
    const cdp = {
      attach: vi.fn(async () => undefined),
      detachTab: vi.fn(async () => undefined),
      setDiscoverTargetsEnabled: vi.fn(async () => undefined),
      configureAutoAttach: vi.fn(async () => undefined),
      primeAttachedRootSession: vi.fn(async () => undefined),
      getTabDebuggee: vi.fn((tabId: number) => (
        tabId === 207
          ? targetOnlyRootDebuggee
          : null
      )),
      sendCommand: vi.fn(async () => ({}))
    };

    const getMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getMock.mockResolvedValue({
      id: 207,
      status: "complete",
      url: "https://example.com/target-only-root",
      title: "Target Only Root"
    } as chrome.tabs.Tab);

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; requestId?: string; payload?: unknown; error?: { code?: string; message?: string } }),
      cdp: cdp as never
    });

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-session-launch-target-only-root",
      clientId: "client-1",
      command: "session.launch",
      payload: {
        tabId: 207
      }
    });

    await vi.waitFor(() => {
      expect(cdp.primeAttachedRootSession).toHaveBeenCalledWith(207);
      expect(cdp.sendCommand).toHaveBeenCalledWith(
        targetOnlyRootDebuggee,
        "Page.enable",
        {}
      );
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-session-launch-target-only-root",
            payload: expect.objectContaining({
              activeTargetId: "tab-207",
              url: "https://example.com/target-only-root",
              title: "Target Only Root"
            })
          })
        ])
      );
    });

    expect(sent.some((message) => message.type === "ops_error" && message.error?.code === "cdp_attach_failed")).toBe(false);
  });

  it("fails session.launch after refresh recovery when the root debuggee never becomes concrete", async () => {
    vi.useFakeTimers();
    const sent: Array<{ type?: string; requestId?: string; payload?: unknown; error?: { code?: string; message?: string } }> = [];
    const cdp = {
      attach: vi.fn()
        .mockRejectedValueOnce(new Error("Not allowed"))
        .mockRejectedValueOnce(new Error("Not allowed"))
        .mockRejectedValueOnce(new Error("Not allowed"))
        .mockRejectedValueOnce(new Error("Not allowed")),
      detachTab: vi.fn(async () => undefined),
      markClientClosed: vi.fn(),
      refreshTabAttachment: vi.fn(async () => undefined),
      setDiscoverTargetsEnabled: vi.fn(async () => undefined),
      configureAutoAttach: vi.fn(async () => undefined),
      primeAttachedRootSession: vi.fn(async () => undefined),
      getTabDebuggee: vi.fn(() => null),
      sendCommand: vi.fn(async () => ({}))
    };

    const getMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getMock.mockResolvedValue({
      id: 205,
      status: "complete",
      url: "https://example.com/recovered-without-debuggee",
      title: "Recovered Without Debuggee"
    } as chrome.tabs.Tab);

    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; requestId?: string; payload?: unknown; error?: { code?: string; message?: string } }),
      cdp: cdp as never
    });

    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-session-launch-refresh-no-debuggee",
      clientId: "client-1",
      command: "session.launch",
      payload: {
        tabId: 205
      }
    });

    await vi.advanceTimersByTimeAsync(150);
    await vi.waitFor(() => {
      expect(cdp.attach).toHaveBeenCalledTimes(4);
      expect(cdp.markClientClosed).toHaveBeenCalledTimes(1);
      expect(cdp.refreshTabAttachment).toHaveBeenCalledWith(205);
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_error",
            requestId: "req-session-launch-refresh-no-debuggee",
            error: expect.objectContaining({
              code: "cdp_attach_failed",
              message: expect.stringContaining("Concrete debugger session unavailable for tab 205")
            })
          })
        ])
      );
    });

    expect(cdp.sendCommand).not.toHaveBeenCalled();
    expect(sessions.listOwnedBy("client-1")).toEqual([]);
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
      markClientClosed: vi.fn(),
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
      markClientClosed: vi.fn(),
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
      primeAttachedRootSession: vi.fn(async () => undefined),
      getTabDebuggee: vi.fn((tabId: number) => (
        tabId === 202 ? concreteRootDebuggee(202) : null
      )),
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
          url: "https://www.facebook.com/watch/search/?q=browser%20automation",
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
          url: "https://www.facebook.com/watch/search/?q=browser%20automation",
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
            url: "https://www.facebook.com/watch/search/?q=browser%20automation",
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

  it("forwards ref screenshot clips through the ops runtime without using non-ref fallback behavior", async () => {
    const sent: Array<{ type?: string; requestId?: string; payload?: unknown; error?: { code?: string; message?: string } }> = [];
    const sendCommand = vi.fn(async (_debuggee: chrome.debugger.Debuggee, method: string, params?: Record<string, unknown>) => {
      if (method === "DOM.resolveNode") {
        return { object: { objectId: "node-1" } };
      }
      if (method === "Runtime.callFunctionOn") {
        const declaration = typeof params?.functionDeclaration === "string"
          ? params.functionDeclaration
          : "";
        if (declaration.includes("odb-dom-screenshot-clip")) {
          return { result: { value: { x: 110, y: 220, width: 30, height: 40 } } };
        }
        return { result: { value: undefined } };
      }
      if (method === "Page.captureScreenshot") {
        return { data: "ZmFrZQ==" };
      }
      return {};
    });
    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; requestId?: string; payload?: unknown; error?: { code?: string; message?: string } }),
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
      selector: "#capture-card",
      backendNodeId: 3,
      role: "region",
      name: "Capture Card"
    }]);

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-ref-screenshot",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "page.screenshot",
      payload: {
        ref: "r1"
      }
    });

    await vi.waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        { tabId: 101 },
        "Page.captureScreenshot",
        expect.objectContaining({
          format: "png",
          captureBeyondViewport: true,
          clip: { x: 110, y: 220, width: 30, height: 40, scale: 1 }
        })
      );
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-ref-screenshot",
            payload: expect.objectContaining({
              base64: "ZmFrZQ=="
            })
          })
        ])
      );
    });
  });

  it("returns stale snapshot guidance for ref screenshots before extension clip capture", async () => {
    const sent: Array<{ type?: string; requestId?: string; payload?: unknown; error?: { code?: string; message?: string } }> = [];
    const sendCommand = vi.fn(async () => ({}));
    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; requestId?: string; payload?: unknown; error?: { code?: string; message?: string } }),
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
      ref: "r2",
      selector: "#other",
      backendNodeId: 4,
      role: "button",
      name: "Other"
    }]);

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-ref-screenshot-stale",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "page.screenshot",
      payload: {
        ref: "r1"
      }
    });

    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_error",
            requestId: "req-ref-screenshot-stale",
            error: expect.objectContaining({
              code: "invalid_request",
              message: "Unknown ref: r1. Take a new snapshot first."
            })
          })
        ])
      );
    });

    expect(sendCommand).not.toHaveBeenCalled();
  });

  it("falls back to visible-tab capture when visible page screenshot capture fails", async () => {
    const sent: Array<{ type?: string; requestId?: string; payload?: { base64?: string; warning?: string }; error?: { code?: string } }> = [];
    const sendCommand = vi.fn(async (_debuggee: chrome.debugger.Debuggee, method: string) => {
      if (method === "Page.captureScreenshot") {
        throw new Error("CDP screenshot failed");
      }
      return {};
    });
    const getMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getMock.mockResolvedValue({
      id: 101,
      windowId: 7,
      status: "complete",
      url: "https://example.com/",
      title: "Example Domain"
    } as chrome.tabs.Tab);
    const captureVisibleTab = globalThis.chrome.tabs.captureVisibleTab as unknown as ReturnType<typeof vi.fn>;
    captureVisibleTab.mockImplementation((_windowId: number | undefined, _options: chrome.tabs.CaptureVisibleTabOptions, callback: (dataUrl?: string) => void) => {
      callback("data:image/png;base64,RkFMTA==");
    });
    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; requestId?: string; payload?: { base64?: string; warning?: string }; error?: { code?: string } }),
      cdp: {
        detachTab: vi.fn(async () => undefined),
        sendCommand
      } as never
    });

    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const session = sessions.createSession("client-1", 101, "lease-1", { url: "https://example.com/" });

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-visible-fallback",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "page.screenshot",
      payload: {}
    });

    await vi.waitFor(() => {
      expect(captureVisibleTab).toHaveBeenCalledWith(7, { format: "png" }, expect.any(Function));
      expect(sent).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: "ops_response",
          requestId: "req-visible-fallback",
          payload: { base64: "RkFMTA==", warning: "visible_only_fallback" }
        })
      ]));
    });
  });

  it("returns a clean screenshot error when cdp and visible-tab capture both fail", async () => {
    const sent: Array<{ type?: string; requestId?: string; payload?: unknown; error?: { code?: string; message?: string } }> = [];
    const sendCommand = vi.fn(async (_debuggee: chrome.debugger.Debuggee, method: string) => {
      if (method === "Page.captureScreenshot") {
        throw new Error("CDP screenshot failed");
      }
      return {};
    });
    const captureVisibleTab = globalThis.chrome.tabs.captureVisibleTab as unknown as ReturnType<typeof vi.fn>;
    captureVisibleTab.mockImplementation((_windowId: number | undefined, _options: chrome.tabs.CaptureVisibleTabOptions, callback: (dataUrl?: string) => void) => {
      globalThis.chrome.runtime.lastError = { message: "capture denied" };
      callback(undefined);
      globalThis.chrome.runtime.lastError = undefined;
    });
    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; requestId?: string; payload?: unknown; error?: { code?: string; message?: string } }),
      cdp: {
        detachTab: vi.fn(async () => undefined),
        sendCommand
      } as never
    });

    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const session = sessions.createSession("client-1", 101, "lease-1", { url: "https://example.com/" });

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-visible-fallback-fail",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "page.screenshot",
      payload: {}
    });

    await vi.waitFor(() => {
      expect(sent).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: "ops_error",
          requestId: "req-visible-fallback-fail",
          error: { code: "execution_failed", message: "Screenshot failed", retryable: false }
        })
      ]));
    });
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

  it("refreshes the opener tab attachment before popup attach when opener target lookup reports no tab attached", async () => {
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
      url: "https://popup.example.com/no-tab-attached",
      title: "Popup No Tab Attached",
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
        mock.setRuntimeError("Target.attachToBrowserTarget No tab attached");
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
      requestId: "req-popup-target-use-refresh-no-tab-attached",
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
            requestId: "req-popup-target-use-refresh-no-tab-attached",
            payload: expect.objectContaining({
              activeTargetId: "tab-202",
              title: "Popup No Tab Attached",
              url: "https://popup.example.com/no-tab-attached"
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
