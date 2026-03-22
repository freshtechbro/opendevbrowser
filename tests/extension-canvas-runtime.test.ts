import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasRuntime } from "../extension/src/canvas/canvas-runtime";
import { MAX_CANVAS_PAYLOAD_BYTES, type CanvasEnvelope } from "../extension/src/types";

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));
const OPEN_HTML = "<!doctype html><html><body><main data-render=\"open\"></main></body></html>";
const SYNC_HTML = "<!doctype html><html><body><main data-render=\"sync\"></main></body></html>";

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

  it("chunks oversized canvas responses", () => {
    const sent: CanvasEnvelope[] = [];
    const runtime = new CanvasRuntime({
      send: (message) => sent.push(message)
    });

    (runtime as unknown as {
      sendResponse: (
        message: { requestId: string; clientId: string; canvasSessionId: string },
        payload: unknown
      ) => void;
    }).sendResponse(
      {
        requestId: "req-chunk",
        clientId: "client-1",
        canvasSessionId: "canvas_01"
      },
      { data: "x".repeat(MAX_CANVAS_PAYLOAD_BYTES + 1024) }
    );

    expect(sent[0]).toMatchObject({
      type: "canvas_response",
      requestId: "req-chunk",
      clientId: "client-1",
      canvasSessionId: "canvas_01",
      chunked: true,
      payloadId: expect.any(String),
      totalChunks: expect.any(Number)
    });
    const response = sent[0] as Extract<CanvasEnvelope, { type: "canvas_response" }>;
    const chunks = sent.slice(1) as Array<Extract<CanvasEnvelope, { type: "canvas_chunk" }>>;
    expect(chunks).toHaveLength(response.totalChunks ?? 0);
    expect(chunks.every((chunk) => chunk.type === "canvas_chunk")).toBe(true);
    expect(JSON.parse(chunks.map((chunk) => chunk.data).join(""))).toEqual({
      data: "x".repeat(MAX_CANVAS_PAYLOAD_BYTES + 1024)
    });
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
        html: OPEN_HTML,
        documentRevision: 2,
        summary: {
          canvasSessionId: "canvas_01",
          preflightState: "plan_accepted",
          planStatus: "accepted",
          mode: "dual-track",
          availableInventoryCount: 6,
          availableStarterCount: 8,
          catalogKitIds: ["dashboard.analytics-core", "marketing.product-launch"],
          starterId: "dashboard.analytics",
          starterName: "Analytics Dashboard",
          starterFrameworkId: "nextjs",
          starterAppliedAt: "2026-03-15T00:00:00.000Z",
          targets: []
        },
        document: {
          documentId: "dc_01",
          title: "Homepage Canvas",
          pages: [{ id: "page_home", rootNodeId: null, nodes: [] }],
          componentInventory: [{
            id: "inventory_hero",
            name: "HeroCard",
            componentName: "HeroCard",
            sourceKind: "code-sync",
            sourceFamily: "framework_component",
            origin: "code_sync",
            framework: { id: "react", metadata: {} },
            adapter: { id: "tsx-react-v1", metadata: {} },
            plugin: { id: "local-ui-kit", metadata: {} },
            variants: [],
            props: [],
            slots: [],
            events: [],
            content: {},
            metadata: {}
          }],
          tokens: {
            values: { theme: { primary: "#ffffff" } },
            collections: [],
            aliases: [],
            bindings: [],
            metadata: {}
          },
          meta: {
            imports: [{ id: "import_figma_1", kind: "figma" }],
            starter: {
              template: {
                id: "dashboard.analytics",
                name: "Analytics Dashboard",
                defaultFrameworkId: "react",
                compatibleFrameworkIds: ["react", "nextjs", "remix"],
                kitIds: ["dashboard.analytics-core"],
                tags: ["dashboard", "analytics"],
                metadata: {}
              },
              frameworkId: "nextjs",
              appliedAt: "2026-03-15T00:00:00.000Z",
              metadata: {}
            },
            adapterPlugins: [{ id: "local-ui-kit" }],
            pluginErrors: [{ pluginId: "local-ui-kit", code: "preview_skipped", message: "Preview disabled", details: {} }],
            metadata: {}
          }
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
        html: OPEN_HTML,
        previewState: "focused",
        summary: expect.objectContaining({
          availableInventoryCount: 6,
          availableStarterCount: 8,
          catalogKitIds: ["dashboard.analytics-core", "marketing.product-launch"],
          starterId: "dashboard.analytics",
          starterFrameworkId: "nextjs"
        }),
        document: expect.objectContaining({
          componentInventory: [expect.objectContaining({ id: "inventory_hero", sourceKind: "code-sync" })],
          tokens: expect.objectContaining({ values: { theme: { primary: "#ffffff" } } }),
          meta: expect.objectContaining({
            imports: [expect.objectContaining({ id: "import_figma_1" })],
            starter: expect.objectContaining({ frameworkId: "nextjs" }),
            pluginErrors: [expect.objectContaining({ pluginId: "local-ui-kit", code: "preview_skipped" })]
          })
        })
      })
    }));

    runtime.handleMessage({
      type: "canvas_request",
      requestId: "req-sync",
      clientId: "client-1",
      command: "canvas.tab.sync",
      payload: {
        targetId: "tab-1",
        html: SYNC_HTML,
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
        html: SYNC_HTML,
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
        html: OPEN_HTML,
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

  it("keeps the runtime session alive when a design tab closes but the host canvas session still exists", async () => {
    let nextTabId = 1;
    const tabsById = new Map<number, chrome.tabs.Tab>();
    globalThis.chrome = {
      runtime: {
        lastError: null,
        getURL: vi.fn((value: string) => `chrome-extension://test/${value}`)
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

    const sent: CanvasEnvelope[] = [];
    const runtime = new CanvasRuntime({
      send: (message) => sent.push(message)
    });

    runtime.handleMessage({
      type: "canvas_request",
      requestId: "req-open-keepalive",
      clientId: "client-1",
      command: "canvas.tab.open",
      payload: {
        previewMode: "focused",
        html: OPEN_HTML,
        summary: {
          canvasSessionId: "canvas_keepalive",
          preflightState: "plan_accepted",
          planStatus: "accepted",
          mode: "dual-track",
          targets: [{
            targetId: "tab-preview",
            prototypeId: "proto_home_default",
            previewState: "focused",
            previewMode: "focused",
            renderStatus: "rendered"
          }]
        },
        document: {
          documentId: "dc_keepalive",
          title: "Canvas",
          pages: [{ id: "page_home", rootNodeId: null, nodes: [] }]
        }
      }
    });
    await flushMicrotasks();

    runtime.handleMessage({
      type: "canvas_request",
      requestId: "req-close-keepalive",
      clientId: "client-1",
      command: "canvas.tab.close",
      payload: { targetId: "tab-1" }
    });
    await flushMicrotasks();

    const internal = runtime as unknown as {
      sessions: { get: (sessionId: string) => unknown };
    };
    expect(internal.sessions.get("canvas_keepalive")).toBeTruthy();
    expect(sent).toContainEqual(expect.objectContaining({
      type: "canvas_event",
      canvasSessionId: "canvas_keepalive",
      event: "canvas_target_closed",
      payload: expect.objectContaining({ targetId: "tab-1" })
    }));
    expect(sent).not.toContainEqual(expect.objectContaining({
      type: "canvas_event",
      canvasSessionId: "canvas_keepalive",
      event: "canvas_session_closed"
    }));
  });

  it("registers extension-hosted design tabs with ops when the canvas summary carries a browser session id", async () => {
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

    const registerOpsCanvasTarget = vi.fn().mockResolvedValue({
      targetId: "tab-1",
      url: "chrome-extension://test/canvas.html",
      title: "Canvas",
      adopted: true
    });

    const sent: CanvasEnvelope[] = [];
    const runtime = new CanvasRuntime({
      send: (message) => sent.push(message),
      registerOpsCanvasTarget
    });

    runtime.handleMessage({
      type: "canvas_request",
      requestId: "req-open-register",
      clientId: "client-1",
      command: "canvas.tab.open",
      payload: {
        previewMode: "focused",
        html: OPEN_HTML,
        summary: {
          canvasSessionId: "canvas_03",
          browserSessionId: "ops-session-1",
          preflightState: "plan_accepted",
          planStatus: "accepted",
          mode: "dual-track",
          targets: []
        },
        document: {
          documentId: "dc_register",
          title: "Canvas",
          pages: [{ id: "page_home", rootNodeId: null, nodes: [] }]
        }
      }
    });
    await flushMicrotasks();

    expect(registerOpsCanvasTarget).toHaveBeenCalledWith("ops-session-1", "tab-1");
    expect(sent).toContainEqual(expect.objectContaining({
      type: "canvas_response",
      requestId: "req-open-register",
      payload: expect.objectContaining({
        targetId: "tab-1",
        previewState: "focused"
      })
    }));
  });

  it("treats extension canvas tab close as idempotent when the runtime session is already gone", async () => {
    globalThis.chrome = {
      runtime: {
        lastError: null,
        getURL: vi.fn((path: string) => `chrome-extension://test/${path}`)
      },
      tabs: {
        create: vi.fn(),
        get: vi.fn(async () => null),
        remove: vi.fn((_tabId: number, callback?: () => void) => {
          callback?.();
        })
      }
    } as unknown as typeof chrome;

    const unregisterOpsCanvasTarget = vi.fn().mockResolvedValue(true);
    const sent: CanvasEnvelope[] = [];
    const runtime = new CanvasRuntime({
      send: (message) => sent.push(message),
      unregisterOpsCanvasTarget
    });

    runtime.handleMessage({
      type: "canvas_request",
      requestId: "req-close-stale",
      clientId: "client-1",
      command: "canvas.tab.close",
      payload: {
        targetId: "tab-9",
        browserSessionId: "ops-session-stale"
      }
    });
    await flushMicrotasks();

    expect(unregisterOpsCanvasTarget).toHaveBeenCalledWith("ops-session-stale", "tab-9");
    expect(globalThis.chrome.tabs.remove).toHaveBeenCalledWith(9, expect.any(Function));
    expect(sent).toContainEqual(expect.objectContaining({
      type: "canvas_response",
      requestId: "req-close-stale",
      payload: {
        ok: true,
        targetId: "tab-9",
        targetIds: [],
        releasedTargetIds: ["tab-9"],
        previewState: "background"
      }
    }));
  });

  it("keeps overlay commands on extension-hosted design tabs inside the canvas page channel", async () => {
    let nextTabId = 1;
    const tabsById = new Map<number, chrome.tabs.Tab>();
    const insertCSS = vi.fn();
    const executeScript = vi.fn();
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
      },
      scripting: {
        insertCSS: insertCSS as typeof chrome.scripting.insertCSS,
        executeScript: executeScript as typeof chrome.scripting.executeScript
      }
    } as unknown as typeof chrome;

    const sent: CanvasEnvelope[] = [];
    const runtime = new CanvasRuntime({
      send: (message) => sent.push(message)
    });

    runtime.handleMessage({
      type: "canvas_request",
      requestId: "req-open-overlay",
      clientId: "client-1",
      command: "canvas.tab.open",
      payload: {
        previewMode: "focused",
        html: OPEN_HTML,
        document: {
          documentId: "dc_overlay",
          title: "Overlay Canvas",
          pages: [{
            id: "page_home",
            rootNodeId: "node_root",
            nodes: [
              { id: "node_root", kind: "frame", name: "Root", rect: { x: 0, y: 0, width: 640, height: 480 }, childIds: ["node_card"] },
              { id: "node_card", kind: "frame", name: "Card", pageId: "page_home", parentId: "node_root", rect: { x: 96, y: 88, width: 320, height: 220 }, childIds: [] }
            ]
          }]
        }
      }
    });
    await flushMicrotasks();

    const port = createPort(1);
    runtime.attachPort(port as unknown as chrome.runtime.Port);

    runtime.handleMessage({
      type: "canvas_request",
      requestId: "req-mount-overlay",
      clientId: "client-1",
      command: "canvas.overlay.mount",
      payload: {
        targetId: "tab-1",
        prototypeId: "proto_home_default"
      }
    });
    await flushMicrotasks();

    const mountResponse = sent.find((message) =>
      message.type === "canvas_response" && message.requestId === "req-mount-overlay"
    );
    expect(mountResponse).toEqual(expect.objectContaining({
      payload: expect.objectContaining({
        targetId: "tab-1",
        overlayState: "mounted",
        mountId: expect.stringMatching(/^mount_/)
      })
    }));
    const mountId = (mountResponse as Extract<CanvasEnvelope, { type: "canvas_response" }>).payload?.mountId as string;
    expect(insertCSS).not.toHaveBeenCalled();
    expect(executeScript).not.toHaveBeenCalled();
    expect(port.messages.at(-1)).toEqual(expect.objectContaining({
      type: "canvas-page:update",
      state: expect.objectContaining({
        overlayMounts: [expect.objectContaining({ mountId, targetId: "tab-1" })]
      })
    }));

    runtime.handleMessage({
      type: "canvas_request",
      requestId: "req-select-overlay",
      clientId: "client-1",
      command: "canvas.overlay.select",
      payload: {
        targetId: "tab-1",
        mountId,
        nodeId: "node_card"
      }
    });
    await flushMicrotasks();

    expect(sent).toContainEqual(expect.objectContaining({
      type: "canvas_response",
      requestId: "req-select-overlay",
      payload: expect.objectContaining({
        targetId: "tab-1",
        selection: expect.objectContaining({
          matched: true,
          nodeId: "node_card",
          selector: "[data-node-id=\"node_card\"]"
        })
      })
    }));
    expect(port.messages.at(-1)).toEqual(expect.objectContaining({
      type: "canvas-page:update",
      state: expect.objectContaining({
        selection: expect.objectContaining({
          nodeId: "node_card",
          targetId: "tab-1"
        })
      })
    }));

    runtime.handleMessage({
      type: "canvas_request",
      requestId: "req-unmount-overlay",
      clientId: "client-1",
      command: "canvas.overlay.unmount",
      payload: {
        targetId: "tab-1",
        mountId
      }
    });
    await flushMicrotasks();

    expect(sent).toContainEqual(expect.objectContaining({
      type: "canvas_response",
      requestId: "req-unmount-overlay",
      payload: expect.objectContaining({
        ok: true,
        mountId,
        overlayState: "idle"
      })
    }));
    expect(port.messages.at(-1)).toEqual(expect.objectContaining({
      type: "canvas-page:update",
      state: expect.objectContaining({
        overlayMounts: []
      })
    }));
  });

  it("supports preview-tab overlay commands before any design tab is opened", async () => {
    const insertCSS = vi.fn((_details: unknown, callback?: () => void) => {
      callback?.();
    });
    const executeScript = vi.fn((details: unknown, callback?: (results: Array<{ result: unknown }>) => void) => {
      const script = details as { func?: { name?: string } };
      const resultByScriptName: Record<string, unknown> = {
        mountOverlayScript: { previewState: "overlay_mounted" },
        selectOverlayScript: {
          matched: true,
          selector: "[data-node-id=\"node_card\"]",
          nodeId: "node_card",
          tagName: "div",
          text: "Card",
          id: null,
          className: "preview-card"
        },
        syncOverlayScript: { overlayState: "mounted" },
        unmountOverlayScript: true
      };
      callback?.([{ result: resultByScriptName[script.func?.name ?? ""] ?? null }]);
    });

    globalThis.chrome = {
      runtime: {
        lastError: null,
        getURL: vi.fn((path: string) => `chrome-extension://test/${path}`)
      },
      tabs: {
        create: vi.fn(),
        get: vi.fn(async () => ({ id: 7, url: "https://example.com/preview", title: "Preview", status: "complete" })),
        remove: vi.fn()
      },
      scripting: {
        insertCSS: insertCSS as typeof chrome.scripting.insertCSS,
        executeScript: executeScript as typeof chrome.scripting.executeScript
      }
    } as unknown as typeof chrome;

    const sent: CanvasEnvelope[] = [];
    const runtime = new CanvasRuntime({
      send: (message) => sent.push(message)
    });

    runtime.handleMessage({
      type: "canvas_request",
      requestId: "req-preview-overlay-mount",
      clientId: "client-1",
      canvasSessionId: "canvas_preview_overlay_01",
      leaseId: "lease-preview-overlay-01",
      command: "canvas.overlay.mount",
      payload: {
        canvasSessionId: "canvas_preview_overlay_01",
        targetId: "tab-7",
        prototypeId: "proto_preview_default",
        document: {
          documentId: "dc_preview_overlay",
          title: "Preview Overlay Canvas",
          pages: [{
            id: "page_home",
            rootNodeId: "node_root",
            nodes: [
              { id: "node_root", kind: "frame", name: "Root", rect: { x: 0, y: 0, width: 800, height: 600 }, childIds: ["node_card"] },
              { id: "node_card", kind: "frame", name: "Card", parentId: "node_root", rect: { x: 120, y: 96, width: 360, height: 240 }, childIds: [] }
            ]
          }]
        },
        selection: {
          pageId: "page_home",
          nodeId: null,
          targetId: "tab-7"
        }
      }
    });
    await flushMicrotasks();

    const mountResponse = sent.find((message) =>
      message.type === "canvas_response" && message.requestId === "req-preview-overlay-mount"
    );
    expect(mountResponse).toEqual(expect.objectContaining({
      payload: expect.objectContaining({
        targetId: "tab-7",
        overlayState: "overlay_mounted",
        mountId: expect.stringMatching(/^mount_/)
      })
    }));
    const mountId = (mountResponse as Extract<CanvasEnvelope, { type: "canvas_response" }>).payload?.mountId as string;

    runtime.handleMessage({
      type: "canvas_request",
      requestId: "req-preview-overlay-select",
      clientId: "client-1",
      canvasSessionId: "canvas_preview_overlay_01",
      leaseId: "lease-preview-overlay-01",
      command: "canvas.overlay.select",
      payload: {
        targetId: "tab-7",
        mountId,
        nodeId: "node_card"
      }
    });
    await flushMicrotasks();

    expect(sent).toContainEqual(expect.objectContaining({
      type: "canvas_response",
      requestId: "req-preview-overlay-select",
      payload: expect.objectContaining({
        targetId: "tab-7",
        selection: expect.objectContaining({
          matched: true,
          nodeId: "node_card",
          selector: "[data-node-id=\"node_card\"]"
        })
      })
    }));

    runtime.handleMessage({
      type: "canvas_request",
      requestId: "req-preview-overlay-sync",
      clientId: "client-1",
      canvasSessionId: "canvas_preview_overlay_01",
      leaseId: "lease-preview-overlay-01",
      command: "canvas.overlay.sync",
      payload: {
        targetId: "tab-7",
        mountId
      }
    });
    await flushMicrotasks();

    expect(sent).toContainEqual(expect.objectContaining({
      type: "canvas_response",
      requestId: "req-preview-overlay-sync",
      payload: expect.objectContaining({
        ok: true,
        mountId,
        targetId: "tab-7",
        overlayState: "mounted"
      })
    }));

    runtime.handleMessage({
      type: "canvas_request",
      requestId: "req-preview-overlay-unmount",
      clientId: "client-1",
      canvasSessionId: "canvas_preview_overlay_01",
      leaseId: "lease-preview-overlay-01",
      command: "canvas.overlay.unmount",
      payload: {
        targetId: "tab-7",
        mountId
      }
    });
    await flushMicrotasks();

    expect(sent).toContainEqual(expect.objectContaining({
      type: "canvas_response",
      requestId: "req-preview-overlay-unmount",
      payload: expect.objectContaining({
        ok: true,
        mountId,
        overlayState: "idle"
      })
    }));
    expect(insertCSS).toHaveBeenCalledTimes(2);
    expect(executeScript.mock.calls.map(([details]) => (details as { func?: { name?: string } }).func?.name)).toEqual([
      "mountOverlayScript",
      "selectOverlayScript",
      "syncOverlayScript",
      "unmountOverlayScript"
    ]);
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
        html: OPEN_HTML,
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

    runtime.handleMessage({
      type: "canvas_request",
      requestId: "req-sync-editor",
      clientId: "client-1",
      command: "canvas.tab.sync",
      payload: {
        targetId: "tab-1",
        html: SYNC_HTML,
        documentRevision: 5,
        summary: {
          canvasSessionId: "canvas_editor_01",
          preflightState: "patching_enabled",
          planStatus: "accepted",
          mode: "dual-track",
          attachedClients: [
            {
              clientId: "client-1",
              role: "lease_holder",
              attachedAt: "2026-03-12T10:00:00.000Z",
              lastSeenAt: "2026-03-12T10:00:02.000Z"
            },
            {
              clientId: "client-2",
              role: "observer",
              attachedAt: "2026-03-12T10:00:01.000Z",
              lastSeenAt: "2026-03-12T10:00:03.000Z"
            }
          ],
          leaseHolderClientId: "client-1",
          watchState: "watching",
          codeSyncState: "projection_fallback",
          boundFiles: ["src/app/page.tsx"],
          conflictCount: 1,
          driftState: "conflict",
          bindings: [{
            bindingId: "binding_hero",
            nodeId: "node_root",
            repoPath: "src/app/page.tsx",
            adapter: "tsx-react-v1",
            syncMode: "watch",
            projection: "bound_app_runtime",
            state: "projection_fallback",
            driftState: "conflict",
            watchEnabled: true,
            conflictCount: 1,
            unsupportedCount: 0
          }],
          targets: [{
            targetId: "tab-preview",
            prototypeId: "proto_home_default",
            previewMode: "focused",
            previewState: "focused",
            renderStatus: "rendered",
            projection: "canvas_html",
            fallbackReason: "runtime_instrumentation_missing",
            parityArtifact: {
              projection: "canvas_html",
              rootBindingId: "binding_hero",
              capturedAt: "2026-03-12T10:00:04.000Z",
              hierarchyHash: "hierarchy_01",
              nodes: [
                {
                  nodeId: "node_root",
                  bindingId: "binding_hero",
                  text: "Root",
                  childOrderHash: "",
                  attributes: { "data-node-id": "node_root" },
                  styleProjection: { display: "block" }
                }
              ]
            }
          }]
        },
        targets: [{
          targetId: "tab-preview",
          prototypeId: "proto_home_default",
          previewMode: "focused",
          previewState: "focused",
          renderStatus: "rendered",
          projection: "canvas_html",
          fallbackReason: "runtime_instrumentation_missing",
          parityArtifact: {
            projection: "canvas_html",
            rootBindingId: "binding_hero",
            capturedAt: "2026-03-12T10:00:04.000Z",
            hierarchyHash: "hierarchy_01",
            nodes: [
              {
                nodeId: "node_root",
                bindingId: "binding_hero",
                text: "Root",
                childOrderHash: "",
                attributes: { "data-node-id": "node_root" },
                styleProjection: { display: "block" }
              }
            ]
          }
        }],
        feedbackCursor: "cursor-1",
        feedback: [{
          eventType: "feedback.item",
          item: {
            id: "fb_5",
            cursor: "cursor-1",
            severity: "info",
            category: "render",
            class: "render-complete",
            documentId: "dc_editor",
            pageId: "page_home",
            prototypeId: "proto_home_default",
            targetId: "tab-preview",
            documentRevision: 5,
            message: "Live preview refresh completed.",
            evidenceRefs: [],
            details: { cause: "patch_sync", source: "editor" }
          }
        }],
        document: {
          documentId: "dc_editor",
          title: "Editor Canvas Synced",
          pages: [{
            id: "page_home",
            rootNodeId: "node_root",
            nodes: [{ id: "node_root", kind: "frame", name: "Root", rect: { x: 0, y: 0, width: 640, height: 480 } }]
          }]
        }
      }
    });
    await flushMicrotasks();

    expect(port.messages.at(-1)).toEqual(expect.objectContaining({
      type: "canvas-page:update",
      state: expect.objectContaining({
        pendingMutation: false,
        documentRevision: 5,
        feedbackCursor: "cursor-1",
        title: "Editor Canvas Synced",
        summary: expect.objectContaining({
          leaseHolderClientId: "client-1",
          watchState: "watching",
          codeSyncState: "projection_fallback",
          conflictCount: 1,
          driftState: "conflict",
          attachedClients: expect.arrayContaining([
            expect.objectContaining({ clientId: "client-1", role: "lease_holder" }),
            expect.objectContaining({ clientId: "client-2", role: "observer" })
          ]),
          bindings: expect.arrayContaining([
            expect.objectContaining({
              bindingId: "binding_hero",
              projection: "bound_app_runtime",
              state: "projection_fallback"
            })
          ])
        }),
        targets: expect.arrayContaining([
          expect.objectContaining({
            targetId: "tab-preview",
            prototypeId: "proto_home_default",
            renderStatus: "rendered",
            projection: "canvas_html",
            fallbackReason: "runtime_instrumentation_missing",
            parityArtifact: expect.objectContaining({
              rootBindingId: "binding_hero",
              nodeCount: 1
            })
          })
        ]),
        feedback: expect.arrayContaining([
          expect.objectContaining({
            eventType: "feedback.item",
            item: expect.objectContaining({
              class: "render-complete",
              targetId: "tab-preview",
              documentRevision: 5
            })
          })
        ])
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
        html: OPEN_HTML,
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

  it("routes canvas page actions through the connected page port", async () => {
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

    const runtime = new CanvasRuntime({ send: vi.fn() });
    runtime.handleMessage({
      type: "canvas_request",
      requestId: "req-open-actions",
      clientId: "client-1",
      command: "canvas.tab.open",
      payload: {
        previewMode: "focused",
        html: OPEN_HTML,
        document: {
          documentId: "dc_actions",
          title: "Action Canvas",
          pages: [{ id: "page_home", rootNodeId: null, nodes: [] }]
        }
      }
    });
    await flushMicrotasks();

    const port = createPort(1);
    runtime.attachPort(port as unknown as chrome.runtime.Port);

    const actionPromise = runtime.performPageAction("tab-1", { type: "click" }, "[data-node-id='node_root']");
    await vi.waitFor(() => {
      expect(port.messages.at(-1)).toEqual(expect.objectContaining({
        type: "canvas-page-action-request",
        selector: "[data-node-id='node_root']",
        action: { type: "click" }
      }));
    });

    const requestId = (port.messages.at(-1) as { requestId: string }).requestId;
    port.emitMessage({
      type: "canvas-page-action-response",
      requestId,
      ok: true,
      value: true
    });

    await expect(actionPromise).resolves.toBe(true);
  });
