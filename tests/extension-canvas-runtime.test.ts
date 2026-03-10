import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasRuntime } from "../extension/src/canvas/canvas-runtime";
import type { CanvasEnvelope } from "../extension/src/types";

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

type PortListener = (message: unknown, port: chrome.runtime.Port) => void;
type DisconnectListener = (port: chrome.runtime.Port) => void;

const createPort = (tabId: number) => {
  const messageListeners = new Set<PortListener>();
  const disconnectListeners = new Set<DisconnectListener>();
  const messages: unknown[] = [];
  const port = {
    name: "canvas-page",
    sender: { tab: { id: tabId } },
    postMessage: vi.fn((message: unknown) => {
      messages.push(message);
    }),
    disconnect: vi.fn(() => {
      for (const listener of disconnectListeners) {
        listener(port as chrome.runtime.Port);
      }
    }),
    onMessage: {
      addListener: (listener: PortListener) => {
        messageListeners.add(listener);
      }
    },
    onDisconnect: {
      addListener: (listener: DisconnectListener) => {
        disconnectListeners.add(listener);
      }
    },
    emitMessage: (message: unknown) => {
      for (const listener of messageListeners) {
        listener(message, port as chrome.runtime.Port);
      }
    },
    messages
  };
  return port;
};

describe("CanvasRuntime", () => {
  const originalChrome = globalThis.chrome;

  afterEach(() => {
    globalThis.chrome = originalChrome;
    vi.restoreAllMocks();
  });

  it("opens extension-hosted canvas tabs and syncs state to connected page ports", async () => {
    let nextTabId = 1;
    const tabsById = new Map<number, chrome.tabs.Tab>();
    globalThis.chrome = {
      runtime: {
        lastError: null,
        getURL: vi.fn((path: string) => `chrome-extension://test/${path}`)
      },
      tabs: {
        create: vi.fn((createProperties: chrome.tabs.CreateProperties, callback?: (tab: chrome.tabs.Tab) => void) => {
          const tab: chrome.tabs.Tab = {
            id: nextTabId,
            url: createProperties.url,
            title: "Canvas",
            status: "complete",
            pinned: createProperties.pinned
          };
          tabsById.set(nextTabId, tab);
          nextTabId += 1;
          callback?.(tab);
          return tab;
        }),
        get: vi.fn(async (tabId: number) => tabsById.get(tabId) ?? null),
        remove: vi.fn((tabId: number, callback?: () => void) => {
          tabsById.delete(tabId);
          callback?.();
        })
      }
    } as unknown as typeof chrome;

    const sent: CanvasEnvelope[] = [];
    const runtime = new CanvasRuntime({
      send: (message) => sent.push(message)
    });

    runtime.handleMessage({
      type: "canvas_request",
      requestId: "req-open",
      clientId: "client-1",
      command: "canvas.tab.open",
      payload: {
        previewMode: "focused",
        documentRevision: 2,
        summary: { canvasSessionId: "canvas_01", preflightState: "plan_accepted", planStatus: "accepted", mode: "dual-track", targets: [] },
        document: {
          documentId: "dc_01",
          title: "Homepage Canvas",
          pages: [{ id: "page_home", rootNodeId: null, nodes: [] }]
        }
      }
    });
    await flushMicrotasks();

    expect(globalThis.chrome.tabs.create).toHaveBeenCalledWith(
      expect.objectContaining({ url: "chrome-extension://test/canvas.html" }),
      expect.any(Function)
    );
    expect(sent).toContainEqual(expect.objectContaining({
      type: "canvas_response",
      requestId: "req-open",
      payload: expect.objectContaining({ targetId: "tab-1", previewState: "focused" })
    }));

    const port = createPort(1);
    runtime.attachPort(port as unknown as chrome.runtime.Port);
    expect(port.messages.at(-1)).toEqual(expect.objectContaining({
      type: "canvas-page:init",
      state: expect.objectContaining({
        targetId: "tab-1",
        documentId: "dc_01",
        documentRevision: 2,
        previewState: "focused"
      })
    }));

    runtime.handleMessage({
      type: "canvas_request",
      requestId: "req-sync",
      clientId: "client-1",
      command: "canvas.tab.sync",
      payload: {
        targetId: "tab-1",
        documentRevision: 3,
        summary: { canvasSessionId: "canvas_01", preflightState: "patching_enabled", planStatus: "accepted", mode: "dual-track", targets: ["tab-1"] },
        document: {
          documentId: "dc_01",
          title: "Homepage Canvas Revised",
          pages: [{ id: "page_home", rootNodeId: null, nodes: [] }]
        }
      }
    });
    await flushMicrotasks();

    expect(port.messages.at(-1)).toEqual(expect.objectContaining({
      type: "canvas-page:update",
      state: expect.objectContaining({
        title: "Homepage Canvas Revised",
        documentRevision: 3
      })
    }));
  });

  it("notifies connected canvas pages before closing their design tab", async () => {
    let nextTabId = 1;
    const tabsById = new Map<number, chrome.tabs.Tab>();
    globalThis.chrome = {
      runtime: {
        lastError: null,
        getURL: vi.fn((path: string) => `chrome-extension://test/${path}`)
      },
      tabs: {
        create: vi.fn((createProperties: chrome.tabs.CreateProperties, callback?: (tab: chrome.tabs.Tab) => void) => {
          const tab: chrome.tabs.Tab = { id: nextTabId, url: createProperties.url, title: "Canvas", status: "complete" };
          tabsById.set(nextTabId, tab);
          nextTabId += 1;
          callback?.(tab);
          return tab;
        }),
        get: vi.fn(async (tabId: number) => tabsById.get(tabId) ?? null),
        remove: vi.fn((tabId: number, callback?: () => void) => {
          tabsById.delete(tabId);
          callback?.();
        })
      }
    } as unknown as typeof chrome;

    const runtime = new CanvasRuntime({ send: vi.fn() });
    runtime.handleMessage({
      type: "canvas_request",
      requestId: "req-open",
      clientId: "client-1",
      command: "canvas.tab.open",
      payload: {
        previewMode: "background",
        document: {
          documentId: "dc_02",
          title: "Canvas",
          pages: [{ id: "page_home", rootNodeId: null, nodes: [] }]
        }
      }
    });
    await flushMicrotasks();

    const port = createPort(1);
    runtime.attachPort(port as unknown as chrome.runtime.Port);
    runtime.handleMessage({
      type: "canvas_request",
      requestId: "req-close",
      clientId: "client-1",
      command: "canvas.tab.close",
      payload: { targetId: "tab-1" }
    });
    await flushMicrotasks();

    expect(port.messages.at(-1)).toEqual(expect.objectContaining({
      type: "canvas-page:closed",
      reason: "target_closed"
    }));
    expect(globalThis.chrome.tabs.remove).toHaveBeenCalledWith(1, expect.any(Function));
  });

  it("forwards design-tab patch requests as live canvas events", async () => {
    let nextTabId = 1;
    const tabsById = new Map<number, chrome.tabs.Tab>();
    globalThis.chrome = {
      runtime: {
        lastError: null,
        getURL: vi.fn((path: string) => `chrome-extension://test/${path}`)
      },
      tabs: {
        create: vi.fn((createProperties: chrome.tabs.CreateProperties, callback?: (tab: chrome.tabs.Tab) => void) => {
          const tab: chrome.tabs.Tab = { id: nextTabId, url: createProperties.url, title: "Canvas", status: "complete" };
          tabsById.set(nextTabId, tab);
          nextTabId += 1;
          callback?.(tab);
          return tab;
        }),
        get: vi.fn(async (tabId: number) => tabsById.get(tabId) ?? null),
        remove: vi.fn()
      }
    } as unknown as typeof chrome;

    const sent: CanvasEnvelope[] = [];
    const runtime = new CanvasRuntime({
      send: (message) => sent.push(message)
    });

    runtime.handleMessage({
      type: "canvas_request",
      requestId: "req-open-editor",
      clientId: "client-1",
      command: "canvas.tab.open",
      payload: {
        previewMode: "focused",
        documentRevision: 4,
        summary: { canvasSessionId: "canvas_editor_01", targets: [] },
        document: {
          documentId: "dc_editor",
          title: "Editor Canvas",
          pages: [{
            id: "page_home",
            rootNodeId: "node_root",
            nodes: [{ id: "node_root", kind: "frame", name: "Root", rect: { x: 0, y: 0, width: 640, height: 480 } }]
          }]
        }
      }
    });
    await flushMicrotasks();

    const port = createPort(1);
    runtime.attachPort(port as unknown as chrome.runtime.Port);
    port.emitMessage({
      type: "canvas-page-patch-request",
      baseRevision: 4,
      selection: {
        pageId: "page_home",
        nodeId: "node_root",
        targetId: "tab-1"
      },
      patches: [{
        op: "node.update",
        nodeId: "node_root",
        changes: { "rect.x": 128 }
      }]
    });
    await flushMicrotasks();

    expect(port.messages.at(-1)).toEqual(expect.objectContaining({
      type: "canvas-page:update",
      state: expect.objectContaining({
        pendingMutation: true,
        selection: expect.objectContaining({
          nodeId: "node_root",
          targetId: "tab-1"
        })
      })
    }));
    expect(sent).toContainEqual(expect.objectContaining({
      type: "canvas_event",
      event: "canvas_patch_requested",
      canvasSessionId: "canvas_editor_01",
      payload: expect.objectContaining({
        baseRevision: 4,
        documentId: "dc_editor",
        selection: expect.objectContaining({
          nodeId: "node_root",
          targetId: "tab-1"
        }),
        patches: [{
          op: "node.update",
          nodeId: "node_root",
          changes: { "rect.x": 128 }
        }]
      })
    }));
  });

  it("rejects degraded preview mode for canvas tab open", async () => {
    globalThis.chrome = {
      runtime: {
        lastError: null,
        getURL: vi.fn((path: string) => `chrome-extension://test/${path}`)
      },
      tabs: {
        create: vi.fn(),
        get: vi.fn(),
        remove: vi.fn()
      }
    } as unknown as typeof chrome;

    const sent: CanvasEnvelope[] = [];
    const runtime = new CanvasRuntime({
      send: (message) => sent.push(message)
    });

    runtime.handleMessage({
      type: "canvas_request",
      requestId: "req-open-invalid",
      clientId: "client-1",
      command: "canvas.tab.open",
      payload: {
        previewMode: "degraded",
        document: {
          documentId: "dc_invalid",
          title: "Canvas",
          pages: [{ id: "page_home", rootNodeId: null, nodes: [] }]
        }
      }
    });
    await flushMicrotasks();

    expect(sent).toContainEqual(expect.objectContaining({
      type: "canvas_error",
      requestId: "req-open-invalid",
      error: expect.objectContaining({
        code: "execution_failed"
      })
    }));
    expect(globalThis.chrome.tabs.create).not.toHaveBeenCalled();
  });
});
