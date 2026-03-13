import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpsRuntime } from "../extension/src/ops/ops-runtime";
import { OpsSessionStore } from "../extension/src/ops/ops-session-store";

type TabRemovedListener = (tabId: number) => void;
type DebuggerDetachListener = (source: chrome.debugger.Debuggee) => void;
const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("OpsRuntime target teardown", () => {
  const originalChrome = globalThis.chrome;

  let tabRemovedListener: TabRemovedListener | null = null;
  let debuggerDetachListener: DebuggerDetachListener | null = null;

  beforeEach(() => {
    tabRemovedListener = null;
    debuggerDetachListener = null;

    globalThis.chrome = {
      runtime: {
        lastError: undefined
      },
      tabs: {
        create: vi.fn(),
        get: vi.fn(async () => null),
        query: vi.fn(async () => []),
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
    globalThis.chrome = originalChrome;
    vi.restoreAllMocks();
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
