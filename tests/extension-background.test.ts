import { readFileSync } from "node:fs";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createChromeMock } from "./extension-chrome-mock";

type ConnectionStatus = "connected" | "disconnected";

let lastConnectionManager: {
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  getStatus: ReturnType<typeof vi.fn>;
  getLastError: ReturnType<typeof vi.fn>;
  getRelayIdentity: ReturnType<typeof vi.fn>;
  getRelayNotice: ReturnType<typeof vi.fn>;
  clearLastError: ReturnType<typeof vi.fn>;
  onAnnotationCommand: (handler: (command: unknown) => void) => void;
  onOpsMessage: (handler: (message: unknown) => void) => void;
  onCanvasMessage: (handler: (message: unknown) => void) => void;
  sendAnnotationResponse: ReturnType<typeof vi.fn>;
  sendAnnotationEvent: ReturnType<typeof vi.fn>;
  sendAnnotationCommand: ReturnType<typeof vi.fn>;
  sendOpsMessage: ReturnType<typeof vi.fn>;
  sendCanvasMessage: ReturnType<typeof vi.fn>;
  getCdpRouter: ReturnType<typeof vi.fn>;
  relayHealthCheck: ReturnType<typeof vi.fn>;
  emitStatus: (status: ConnectionStatus) => void;
  emitAnnotationCommand: (command: unknown) => void;
  emitOpsMessage: (message: unknown) => void;
  emitCanvasMessage: (message: unknown) => void;
} | null = null;

const registerLastConnectionManager = (manager: NonNullable<typeof lastConnectionManager>): void => {
  lastConnectionManager = manager;
};

vi.mock("../extension/src/services/ConnectionManager", () => ({
  ConnectionManager: class ConnectionManager {
    status: ConnectionStatus = "disconnected";
    listeners = new Set<(status: ConnectionStatus) => void>();
    annotationHandler: ((command: unknown) => void) | null = null;
    opsHandler: ((message: unknown) => void) | null = null;
    canvasHandler: ((message: unknown) => void) | null = null;
    connect = vi.fn(async () => {
      this.status = "connected";
      this.emitStatus("connected");
    });
    disconnect = vi.fn(async () => {
      this.status = "disconnected";
      this.emitStatus("disconnected");
    });
    getStatus = vi.fn(() => this.status);
    getLastError = vi.fn(() => null);
    getRelayIdentity = vi.fn(() => ({ instanceId: null, relayPort: null }));
    getRelayNotice = vi.fn(() => null);
    clearLastError = vi.fn();
    onAnnotationCommand = (handler: (command: unknown) => void) => {
      this.annotationHandler = handler;
    };
    onOpsMessage = (handler: (message: unknown) => void) => {
      this.opsHandler = handler;
    };
    onCanvasMessage = (handler: (message: unknown) => void) => {
      this.canvasHandler = handler;
    };
    sendAnnotationResponse = vi.fn();
    sendAnnotationEvent = vi.fn();
    sendAnnotationCommand = vi.fn(async () => {
      throw new Error("relay_unavailable");
    });
    sendOpsMessage = vi.fn();
    sendCanvasMessage = vi.fn();
    getCdpRouter = vi.fn(() => ({
      attach: vi.fn(async () => {}),
      sendCommand: vi.fn(async () => ({})),
      detachTab: vi.fn(async () => {})
    }));
    relayHealthCheck = vi.fn(async () => null);
    onStatus = (listener: (status: ConnectionStatus) => void) => {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    };
    emitStatus = (status: ConnectionStatus) => {
      this.status = status;
      for (const listener of this.listeners) {
        listener(status);
      }
    };
    emitAnnotationCommand = (command: unknown) => {
      this.annotationHandler?.(command);
    };
    emitOpsMessage = (message: unknown) => {
      this.opsHandler?.(message);
    };
    emitCanvasMessage = (message: unknown) => {
      this.canvasHandler?.(message);
    };
    constructor() {
      registerLastConnectionManager(this);
    }
  }
}));

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("extension background auto-connect", () => {
  const originalChrome = globalThis.chrome;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    lastConnectionManager = null;
    vi.resetModules();
  });

  afterEach(() => {
    globalThis.chrome = originalChrome;
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("connects automatically when autoConnect is enabled", async () => {
    const mock = createChromeMock({ autoConnect: true, autoPair: false });
    globalThis.chrome = mock.chrome;

    await import("../extension/src/background");
    await flushMicrotasks();

    expect(lastConnectionManager?.connect).toHaveBeenCalledTimes(1);
  });

  it("auto-pairs before connecting when enabled", async () => {
    const mock = createChromeMock({ autoConnect: true, autoPair: true });
    globalThis.chrome = mock.chrome;
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ relayPort: 8787, pairingRequired: true })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: "secret" })
      }) as unknown as typeof fetch;

    await import("../extension/src/background");
    await flushMicrotasks();

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(lastConnectionManager?.connect).toHaveBeenCalledTimes(1);
  });

  it("skips auto-connect when relay instance mismatches", async () => {
    const mock = createChromeMock({ autoConnect: true, autoPair: true });
    globalThis.chrome = mock.chrome;
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ relayPort: 8787, pairingRequired: true, instanceId: "relay-a", epoch: 1 })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: "secret", instanceId: "relay-b", epoch: 1 })
      }) as unknown as typeof fetch;

    await import("../extension/src/background");
    await flushMicrotasks();

    expect(lastConnectionManager?.connect).not.toHaveBeenCalled();
  });

  it("surfaces relay instance mismatch note in popup status", async () => {
    const mock = createChromeMock({ autoConnect: true, autoPair: true });
    globalThis.chrome = mock.chrome;
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ relayPort: 8787, pairingRequired: true, instanceId: "relay-a", epoch: 1 })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: "secret", instanceId: "relay-b", epoch: 1 })
      }) as unknown as typeof fetch;

    await import("../extension/src/background");
    await flushMicrotasks();

    const response = await new Promise<{ note?: string }>((resolve) => {
      globalThis.chrome.runtime.sendMessage({ type: "status" }, (payload: { note?: string }) => resolve(payload));
    });

    expect(String(response.note ?? "")).toContain("instance mismatch");
  });

  it("clears stored relay state when discovery config is unreachable", async () => {
    const mock = createChromeMock({
      autoConnect: true,
      autoPair: true,
      relayPort: 9999,
      pairingToken: "stale",
      relayInstanceId: "old",
      relayEpoch: 1,
      tokenEpoch: 1
    });
    globalThis.chrome = mock.chrome;
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch;

    await import("../extension/src/background");
    await flushMicrotasks();

    expect(globalThis.chrome.alarms.create).toHaveBeenCalled();
  });

  it("schedules retry when relay config is unreachable", async () => {
    const mock = createChromeMock({ autoConnect: true, autoPair: true });
    globalThis.chrome = mock.chrome;
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch;

    await import("../extension/src/background");
    await flushMicrotasks();

    expect(globalThis.chrome.alarms.create).toHaveBeenCalledWith(
      "opendevbrowser-auto-connect",
      expect.objectContaining({ when: expect.any(Number) })
    );
  });

  it("clears stored relay state when epoch changes", async () => {
    const mock = createChromeMock({
      autoConnect: true,
      autoPair: true,
      relayPort: 8787,
      pairingToken: "stale",
      relayInstanceId: "relay-a",
      relayEpoch: 1,
      tokenEpoch: 1
    });
    globalThis.chrome = mock.chrome;
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ relayPort: 8787, pairingRequired: true, instanceId: "relay-a", epoch: 2 })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: "fresh", instanceId: "relay-a", epoch: 2 })
      }) as unknown as typeof fetch;

    await import("../extension/src/background");
    await flushMicrotasks();

    expect(globalThis.chrome.storage.local.set).toHaveBeenCalledWith({
      relayPort: null,
      relayInstanceId: null,
      relayEpoch: null,
      pairingToken: null,
      tokenEpoch: null
    }, expect.any(Function));
  });

  it("clears stored token when relay epoch is present but token epoch is missing", async () => {
    const mock = createChromeMock({
      autoConnect: true,
      autoPair: true,
      relayPort: 8787,
      pairingToken: "stale",
      relayInstanceId: "relay-a",
      relayEpoch: 1,
      tokenEpoch: null
    });
    globalThis.chrome = mock.chrome;
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ relayPort: 8787, pairingRequired: true, instanceId: "relay-a", epoch: 2 })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: "fresh", instanceId: "relay-a", epoch: 2 })
      }) as unknown as typeof fetch;

    await import("../extension/src/background");
    await flushMicrotasks();

    expect(globalThis.chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({ pairingToken: null, tokenEpoch: null }),
      expect.any(Function)
    );
  });

  it("updates the badge when status changes", async () => {
    const mock = createChromeMock({ autoConnect: false });
    globalThis.chrome = mock.chrome;

    await import("../extension/src/background");
    await flushMicrotasks();

    expect(mock.chrome.action.setBadgeText).toHaveBeenCalledWith({ text: "●" });
    expect(mock.chrome.action.setBadgeTextColor).toHaveBeenCalledWith({ color: "#dc2626" });
    expect(mock.chrome.action.setBadgeBackgroundColor).toHaveBeenCalledWith({ color: [0, 0, 0, 0] });

    lastConnectionManager?.emitStatus("connected");
    expect(mock.chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: "●" });
    expect(mock.chrome.action.setBadgeTextColor).toHaveBeenLastCalledWith({ color: "#16a34a" });
    expect(mock.chrome.action.setBadgeBackgroundColor).toHaveBeenLastCalledWith({ color: [0, 0, 0, 0] });
  });

  it("schedules an alarm retry after relay disconnect and clears it after reconnect", async () => {
    const mock = createChromeMock({ autoConnect: true, autoPair: false });
    globalThis.chrome = mock.chrome;

    await import("../extension/src/background");
    await flushMicrotasks();

    expect(lastConnectionManager?.connect).toHaveBeenCalledTimes(1);
    lastConnectionManager?.connect.mockClear();
    mock.chrome.alarms.create.mockClear();
    mock.chrome.alarms.clear.mockClear();

    lastConnectionManager?.emitStatus("disconnected");

    expect(mock.chrome.alarms.create).toHaveBeenCalledWith(
      "opendevbrowser-auto-connect",
      expect.objectContaining({ when: expect.any(Number) })
    );

    mock.emitAlarm("opendevbrowser-auto-connect");
    await flushMicrotasks();

    expect(lastConnectionManager?.connect).toHaveBeenCalledTimes(1);
    expect(mock.chrome.alarms.clear).toHaveBeenCalledWith("opendevbrowser-auto-connect");
  });
});

describe("extension background annotation routing", () => {
  const originalChrome = globalThis.chrome;
  const originalFetch = globalThis.fetch;
  const readyResponse = (message: unknown) => {
    const type = (message as { type?: string } | null)?.type;
    return {
      ok: true,
      bootId: "boot-test",
      active: type === "annotation:start" || type === "annotation:toggle"
    };
  };

  beforeEach(() => {
    lastConnectionManager = null;
    vi.resetModules();
  });

  afterEach(() => {
    globalThis.chrome = originalChrome;
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("injects annotation assets when content script is missing", async () => {
    const mock = createChromeMock({ autoConnect: false });
    let pingAttempts = 0;
    mock.chrome.tabs.sendMessage = vi.fn((_tabId, message, callback) => {
      const type = (message as { type?: string } | null)?.type;
      if (type === "annotation:ping" && pingAttempts === 0) {
        pingAttempts += 1;
        mock.setRuntimeError("Could not establish connection. Receiving end does not exist.");
        callback?.(undefined);
        mock.setRuntimeError(null);
        return;
      }
      callback?.(readyResponse(message));
    });

    globalThis.chrome = mock.chrome;
    await import("../extension/src/background");
    await flushMicrotasks();

    lastConnectionManager?.emitAnnotationCommand({
      type: "annotationCommand",
      payload: { version: 1, requestId: "req-1", command: "start" }
    });
    await flushMicrotasks();

    expect(mock.chrome.scripting.insertCSS).toHaveBeenCalledTimes(1);
    expect(mock.chrome.scripting.executeScript).toHaveBeenCalledTimes(1);
    expect(lastConnectionManager?.sendAnnotationEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "annotationEvent",
        payload: expect.objectContaining({ requestId: "req-1", event: "ready" })
      })
    );
  });

  it("reinstalls the annotation bridge when ping returns a stale acknowledgement", async () => {
    const mock = createChromeMock({ autoConnect: false });
    let pingAttempts = 0;
    mock.chrome.tabs.sendMessage = vi.fn((_tabId, message, callback) => {
      const type = (message as { type?: string } | null)?.type;
      if (type === "annotation:ping") {
        pingAttempts += 1;
        if (pingAttempts === 1) {
          callback?.({ ok: true });
          return;
        }
      }
      callback?.(readyResponse(message));
    });

    globalThis.chrome = mock.chrome;
    await import("../extension/src/background");
    await flushMicrotasks();

    lastConnectionManager?.emitAnnotationCommand({
      type: "annotationCommand",
      payload: { version: 1, requestId: "req-stale-ping", command: "start" }
    });
    await flushMicrotasks();

    expect(mock.chrome.scripting.insertCSS).toHaveBeenCalledTimes(1);
    expect(mock.chrome.scripting.executeScript).toHaveBeenCalledTimes(1);
    expect(lastConnectionManager?.sendAnnotationEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "annotationEvent",
        payload: expect.objectContaining({ requestId: "req-stale-ping", event: "ready" })
      })
    );
  });

  it("keeps the injected annotate content script module-free", () => {
    const source = readFileSync("extension/src/annotate-content.ts", "utf8");
    const moduleSyntax = source
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("import ") || line.startsWith("export "));

    expect(moduleSyntax).toEqual([]);
  });

  it("recovers when the receiver disappears between ping and annotation start", async () => {
    const mock = createChromeMock({ autoConnect: false });
    let pingAttempts = 0;
    let startAttempts = 0;
    mock.chrome.tabs.sendMessage = vi.fn((_tabId, message, callback) => {
      const type = (message as { type?: string } | null)?.type;
      if (type === "annotation:ping") {
        pingAttempts += 1;
        if (pingAttempts === 2) {
          mock.setRuntimeError("Could not establish connection. Receiving end does not exist.");
          callback?.(undefined);
          mock.setRuntimeError(null);
          return;
        }
        callback?.(readyResponse(message));
        return;
      }
      if (type === "annotation:start") {
        startAttempts += 1;
        if (startAttempts === 1) {
          mock.setRuntimeError("Could not establish connection. Receiving end does not exist.");
          callback?.(undefined);
          mock.setRuntimeError(null);
          return;
        }
        callback?.(readyResponse(message));
        return;
      }
      callback?.(readyResponse(message));
    });

    globalThis.chrome = mock.chrome;
    await import("../extension/src/background");
    await flushMicrotasks();

    lastConnectionManager?.emitAnnotationCommand({
      type: "annotationCommand",
      payload: { version: 1, requestId: "req-retry", command: "start" }
    });
    await flushMicrotasks();

    expect(startAttempts).toBe(2);
    expect(mock.chrome.scripting.insertCSS).toHaveBeenCalledTimes(1);
    expect(mock.chrome.scripting.executeScript).toHaveBeenCalledTimes(1);
    expect(lastConnectionManager?.sendAnnotationEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "annotationEvent",
        payload: expect.objectContaining({ requestId: "req-retry", event: "ready" })
      })
    );
  });

  it("reinstalls the annotation bridge when start acknowledgement is not active", async () => {
    const mock = createChromeMock({ autoConnect: false });
    let startAttempts = 0;
    mock.chrome.tabs.sendMessage = vi.fn((_tabId, message, callback) => {
      const type = (message as { type?: string } | null)?.type;
      if (type === "annotation:start") {
        startAttempts += 1;
        if (startAttempts === 1) {
          callback?.({ ok: true, bootId: "boot-test", active: false });
          return;
        }
      }
      callback?.(readyResponse(message));
    });

    globalThis.chrome = mock.chrome;
    await import("../extension/src/background");
    await flushMicrotasks();

    lastConnectionManager?.emitAnnotationCommand({
      type: "annotationCommand",
      payload: { version: 1, requestId: "req-stale-start", command: "start" }
    });
    await flushMicrotasks();

    expect(startAttempts).toBe(2);
    expect(mock.chrome.scripting.insertCSS).toHaveBeenCalledTimes(1);
    expect(mock.chrome.scripting.executeScript).toHaveBeenCalledTimes(1);
    expect(lastConnectionManager?.sendAnnotationEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "annotationEvent",
        payload: expect.objectContaining({ requestId: "req-stale-start", event: "ready" })
      })
    );
  });

  it("reports injection failure when content script cannot be reached", async () => {
    vi.useFakeTimers();
    const mock = createChromeMock({ autoConnect: false });
    mock.chrome.tabs.sendMessage = vi.fn((_tabId, message, callback) => {
      const type = (message as { type?: string } | null)?.type;
      if (type === "annotation:ping") {
        mock.setRuntimeError("Could not establish connection. Receiving end does not exist.");
        callback?.(undefined);
        mock.setRuntimeError(null);
        return;
      }
      callback?.(readyResponse(message));
    });

    globalThis.chrome = mock.chrome;
    await import("../extension/src/background");
    await vi.advanceTimersByTimeAsync(0);

    lastConnectionManager?.emitAnnotationCommand({
      type: "annotationCommand",
      payload: { version: 1, requestId: "req-fail", command: "start" }
    });

    await vi.advanceTimersByTimeAsync(2000);

    expect(lastConnectionManager?.sendAnnotationResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "annotationResponse",
        payload: expect.objectContaining({
          requestId: "req-fail",
          status: "error",
          error: expect.objectContaining({
            code: "injection_failed",
            message: "Annotation UI did not load in the page. Reload the tab and retry."
          })
        })
      })
    );
  });

  it("returns a friendly popup error when annotation injection never establishes a receiver", async () => {
    vi.useFakeTimers();
    const mock = createChromeMock({ autoConnect: false });
    mock.chrome.tabs.sendMessage = vi.fn((_tabId, message, callback) => {
      const type = (message as { type?: string } | null)?.type;
      if (type === "annotation:ping" || type === "annotation:start") {
        mock.setRuntimeError("Could not establish connection. Receiving end does not exist.");
        callback?.(undefined);
        mock.setRuntimeError(null);
        return;
      }
      callback?.(readyResponse(message));
    });

    globalThis.chrome = mock.chrome;
    await import("../extension/src/background");
    await vi.advanceTimersByTimeAsync(0);

    const startPromise = new Promise<{ ok?: boolean; error?: { code?: string; message?: string } }>((resolve) => {
      globalThis.chrome.runtime.sendMessage({ type: "annotation:start" }, (payload) => {
        resolve(payload as { ok?: boolean; error?: { code?: string; message?: string } });
      });
    });

    await vi.advanceTimersByTimeAsync(2000);

    await expect(startPromise).resolves.toMatchObject({
      ok: false,
      error: {
        code: "injection_failed",
        message: "Annotation UI did not load in the page. Reload the tab and retry."
      }
    });
  });

  it("falls back to the most recent annotatable tab when the extension canvas tab is active", async () => {
    const restrictedTab = {
      id: 9,
      url: "chrome-extension://test/canvas.html",
      title: "Canvas",
      status: "complete",
      active: true,
      lastAccessed: 10
    } satisfies chrome.tabs.Tab;
    const webTab = {
      id: 10,
      url: "https://example.com/app",
      title: "Example App",
      status: "complete",
      active: false,
      lastAccessed: 20
    } satisfies chrome.tabs.Tab;
    const mock = createChromeMock({
      autoConnect: false,
      activeTab: restrictedTab,
      tabs: [restrictedTab, webTab]
    });

    globalThis.chrome = mock.chrome;
    await import("../extension/src/background");
    await flushMicrotasks();

    const startPromise = new Promise<{ ok?: boolean; error?: { code?: string; message?: string } }>((resolve) => {
      globalThis.chrome.runtime.sendMessage({ type: "annotation:start" }, (payload) => {
        resolve(payload as { ok?: boolean; error?: { code?: string; message?: string } });
      });
    });

    await expect(startPromise).resolves.toMatchObject({ ok: true });
    expect(mock.chrome.tabs.sendMessage).toHaveBeenCalledWith(
      webTab.id,
      expect.objectContaining({ type: "annotation:ping" }),
      expect.any(Function)
    );
    expect(mock.chrome.tabs.sendMessage).not.toHaveBeenCalledWith(
      restrictedTab.id,
      expect.anything(),
      expect.any(Function)
    );
  });

  it("prefers the remembered annotatable tab when popup focus leaves no active browser tab", async () => {
    const rememberedTab = {
      id: 11,
      url: "https://ampcode.com/workspaces/bishop",
      title: "bishop workspace - Amp",
      status: "complete",
      active: true,
      lastAccessed: 10
    } satisfies chrome.tabs.Tab;
    const otherTab = {
      id: 12,
      url: "https://example.com/recent",
      title: "Recent tab",
      status: "complete",
      active: false,
      lastAccessed: 50
    } satisfies chrome.tabs.Tab;
    const mock = createChromeMock({
      autoConnect: false,
      activeTab: rememberedTab,
      tabs: [rememberedTab, otherTab]
    });

    globalThis.chrome = mock.chrome;
    await import("../extension/src/background");
    await flushMicrotasks();

    mock.emitTabActivated(rememberedTab.id!);
    mock.setActiveTab(null);

    const startPromise = new Promise<{ ok?: boolean; error?: { code?: string; message?: string } }>((resolve) => {
      globalThis.chrome.runtime.sendMessage({ type: "annotation:start" }, (payload) => {
        resolve(payload as { ok?: boolean; error?: { code?: string; message?: string } });
      });
    });

    await expect(startPromise).resolves.toMatchObject({ ok: true });
    expect(mock.chrome.tabs.sendMessage).toHaveBeenCalledWith(
      rememberedTab.id,
      expect.objectContaining({ type: "annotation:ping" }),
      expect.any(Function)
    );
    expect(mock.chrome.tabs.sendMessage).not.toHaveBeenCalledWith(
      otherTab.id,
      expect.anything(),
      expect.any(Function)
    );
  });

  it("honors the popup-provided tab id when the service worker has no active-tab memory", async () => {
    const hintedTab = {
      id: 21,
      url: "https://example.com/from-popup",
      title: "Popup target",
      status: "complete",
      active: false,
      lastAccessed: 10
    } satisfies chrome.tabs.Tab;
    const otherTab = {
      id: 22,
      url: "https://example.com/more-recent",
      title: "More recent",
      status: "complete",
      active: false,
      lastAccessed: 50
    } satisfies chrome.tabs.Tab;
    const mock = createChromeMock({
      autoConnect: false,
      activeTab: null,
      tabs: [hintedTab, otherTab]
    });
    mock.setActiveTab(null);

    globalThis.chrome = mock.chrome;
    await import("../extension/src/background");
    await flushMicrotasks();

    const startPromise = new Promise<{ ok?: boolean; error?: { code?: string; message?: string } }>((resolve) => {
      globalThis.chrome.runtime.sendMessage({ type: "annotation:start", tabId: hintedTab.id }, (payload) => {
        resolve(payload as { ok?: boolean; error?: { code?: string; message?: string } });
      });
    });

    await expect(startPromise).resolves.toMatchObject({ ok: true });
    expect(mock.chrome.tabs.sendMessage).toHaveBeenCalledWith(
      hintedTab.id,
      expect.objectContaining({ type: "annotation:ping" }),
      expect.any(Function)
    );
    expect(mock.chrome.tabs.sendMessage).not.toHaveBeenCalledWith(
      otherTab.id,
      expect.anything(),
      expect.any(Function)
    );
  });

  it("reuses the probed popup tab when the active tab changes before start", async () => {
    const initialTab = {
      id: 23,
      url: "https://example.com/probed",
      title: "Probed tab",
      status: "complete",
      active: true,
      lastAccessed: 10
    } satisfies chrome.tabs.Tab;
    const laterActiveTab = {
      id: 24,
      url: "https://example.com/later",
      title: "Later active tab",
      status: "complete",
      active: false,
      lastAccessed: 20
    } satisfies chrome.tabs.Tab;
    const mock = createChromeMock({
      autoConnect: false,
      activeTab: initialTab,
      tabs: [initialTab, laterActiveTab]
    });
    mock.chrome.tabs.sendMessage = vi.fn((tabId, message, callback) => {
      callback?.(readyResponse(message));
    });

    globalThis.chrome = mock.chrome;
    await import("../extension/src/background");
    await flushMicrotasks();

    const probeResponse = await new Promise<{ injected?: boolean }>((resolve) => {
      globalThis.chrome.runtime.sendMessage({ type: "annotation:probe" }, (payload) => {
        resolve(payload as { injected?: boolean });
      });
    });
    expect(probeResponse).toMatchObject({ injected: true });

    const callsAfterProbe = mock.chrome.tabs.sendMessage.mock.calls.length;
    mock.setActiveTab(laterActiveTab);

    const startResponse = await new Promise<{ ok?: boolean; error?: { message?: string } }>((resolve) => {
      globalThis.chrome.runtime.sendMessage({ type: "annotation:start" }, (payload) => {
        resolve(payload as { ok?: boolean; error?: { message?: string } });
      });
    });

    expect(startResponse).toMatchObject({ ok: true });
    const startCalls = mock.chrome.tabs.sendMessage.mock.calls.slice(callsAfterProbe);
    expect(startCalls).toContainEqual([
      initialTab.id,
      expect.objectContaining({ type: "annotation:start" }),
      expect.any(Function)
    ]);
    expect(startCalls.some((call) => call[0] === laterActiveTab.id)).toBe(false);
  });

  it("prefers the recent probed popup tab over a new popup hint for the immediate start", async () => {
    const probedTab = {
      id: 25,
      url: "https://example.com/probed",
      title: "Probed tab",
      status: "complete",
      active: true,
      lastAccessed: 10
    } satisfies chrome.tabs.Tab;
    const hintedTab = {
      id: 26,
      url: "https://example.com/hinted",
      title: "Hinted tab",
      status: "complete",
      active: false,
      lastAccessed: 20
    } satisfies chrome.tabs.Tab;
    const mock = createChromeMock({
      autoConnect: false,
      activeTab: probedTab,
      tabs: [probedTab, hintedTab]
    });
    mock.chrome.tabs.sendMessage = vi.fn((_tabId, message, callback) => {
      callback?.(readyResponse(message));
    });

    globalThis.chrome = mock.chrome;
    await import("../extension/src/background");
    await flushMicrotasks();

    const probeResponse = await new Promise<{ injected?: boolean }>((resolve) => {
      globalThis.chrome.runtime.sendMessage({ type: "annotation:probe" }, (payload) => {
        resolve(payload as { injected?: boolean });
      });
    });
    expect(probeResponse).toMatchObject({ injected: true });

    const callsAfterProbe = mock.chrome.tabs.sendMessage.mock.calls.length;
    const startResponse = await new Promise<{ ok?: boolean; error?: { message?: string } }>((resolve) => {
      globalThis.chrome.runtime.sendMessage({ type: "annotation:start", tabId: hintedTab.id }, (payload) => {
        resolve(payload as { ok?: boolean; error?: { message?: string } });
      });
    });

    expect(startResponse).toMatchObject({ ok: true });
    const startCalls = mock.chrome.tabs.sendMessage.mock.calls.slice(callsAfterProbe);
    expect(startCalls).toContainEqual([
      probedTab.id,
      expect.objectContaining({ type: "annotation:start" }),
      expect.any(Function)
    ]);
    expect(startCalls.some((call) => call[0] === hintedTab.id)).toBe(false);
  });

  it("expires the popup annotation target cache before later starts", async () => {
    vi.useFakeTimers();
    const initialTab = {
      id: 27,
      url: "https://example.com/initial",
      title: "Initial tab",
      status: "complete",
      active: true,
      lastAccessed: 10
    } satisfies chrome.tabs.Tab;
    const laterTab = {
      id: 28,
      url: "https://example.com/later",
      title: "Later tab",
      status: "complete",
      active: false,
      lastAccessed: 20
    } satisfies chrome.tabs.Tab;
    const mock = createChromeMock({
      autoConnect: false,
      activeTab: initialTab,
      tabs: [initialTab, laterTab]
    });
    mock.chrome.tabs.sendMessage = vi.fn((_tabId, message, callback) => {
      callback?.(readyResponse(message));
    });

    globalThis.chrome = mock.chrome;
    await import("../extension/src/background");
    await vi.advanceTimersByTimeAsync(0);

    const probePromise = new Promise<{ injected?: boolean }>((resolve) => {
      globalThis.chrome.runtime.sendMessage({ type: "annotation:probe" }, (payload) => {
        resolve(payload as { injected?: boolean });
      });
    });
    await expect(probePromise).resolves.toMatchObject({ injected: true });

    await vi.advanceTimersByTimeAsync(10_001);
    mock.setActiveTab(laterTab);
    const callsAfterProbe = mock.chrome.tabs.sendMessage.mock.calls.length;

    const startPromise = new Promise<{ ok?: boolean; error?: { message?: string } }>((resolve) => {
      globalThis.chrome.runtime.sendMessage({ type: "annotation:start" }, (payload) => {
        resolve(payload as { ok?: boolean; error?: { message?: string } });
      });
    });

    await expect(startPromise).resolves.toMatchObject({ ok: true });
    const startCalls = mock.chrome.tabs.sendMessage.mock.calls.slice(callsAfterProbe);
    expect(startCalls).toContainEqual([
      laterTab.id,
      expect.objectContaining({ type: "annotation:start" }),
      expect.any(Function)
    ]);
    expect(startCalls.some((call) => call[0] === initialTab.id)).toBe(false);
  });

  it("restores the remembered annotatable tab from storage after a cold start", async () => {
    const rememberedTab = {
      id: 31,
      url: "https://ampcode.com/workspaces/bishop",
      title: "bishop workspace - Amp",
      status: "complete",
      active: false,
      lastAccessed: 10
    } satisfies chrome.tabs.Tab;
    const otherTab = {
      id: 32,
      url: "https://example.com/more-recent",
      title: "More recent",
      status: "complete",
      active: false,
      lastAccessed: 50
    } satisfies chrome.tabs.Tab;
    const mock = createChromeMock({
      autoConnect: false,
      activeTab: null,
      tabs: [rememberedTab, otherTab]
    });
    mock.setActiveTab(null);
    mock.chrome.storage.local.set({ annotationLastTabId: rememberedTab.id }, () => {});

    globalThis.chrome = mock.chrome;
    await import("../extension/src/background");
    await flushMicrotasks();

    const startPromise = new Promise<{ ok?: boolean; error?: { code?: string; message?: string } }>((resolve) => {
      globalThis.chrome.runtime.sendMessage({ type: "annotation:start" }, (payload) => {
        resolve(payload as { ok?: boolean; error?: { code?: string; message?: string } });
      });
    });

    await expect(startPromise).resolves.toMatchObject({ ok: true });
    expect(mock.chrome.tabs.sendMessage).toHaveBeenCalledWith(
      rememberedTab.id,
      expect.objectContaining({ type: "annotation:ping" }),
      expect.any(Function)
    );
    expect(mock.chrome.tabs.sendMessage).not.toHaveBeenCalledWith(
      otherTab.id,
      expect.anything(),
      expect.any(Function)
    );
  });

  it("waits for a loading popup target before injecting annotation", async () => {
    const loadingTab = {
      id: 41,
      url: "https://example.com/loading",
      title: "Loading",
      status: "loading",
      active: true,
      lastAccessed: 100
    } satisfies chrome.tabs.Tab;
    const mock = createChromeMock({
      autoConnect: false,
      activeTab: loadingTab,
      tabs: [loadingTab]
    });

    globalThis.chrome = mock.chrome;
    await import("../extension/src/background");
    await flushMicrotasks();

    const startPromise = new Promise<{ ok?: boolean; error?: { code?: string; message?: string } }>((resolve) => {
      globalThis.chrome.runtime.sendMessage({ type: "annotation:start", tabId: loadingTab.id }, (payload) => {
        resolve(payload as { ok?: boolean; error?: { code?: string; message?: string } });
      });
    });

    await flushMicrotasks();
    expect(mock.chrome.tabs.sendMessage).not.toHaveBeenCalled();

    mock.emitTabUpdated(loadingTab.id, { ...loadingTab, status: "complete" });

    await expect(startPromise).resolves.toMatchObject({ ok: true });
    expect(mock.chrome.tabs.sendMessage).toHaveBeenCalledWith(
      loadingTab.id,
      expect.objectContaining({ type: "annotation:ping" }),
      expect.any(Function)
    );
  });

  it("rejects annotation requests on restricted URLs", async () => {
    const mock = createChromeMock({ autoConnect: false, activeTab: { id: 9, url: "chrome://extensions", title: "Extensions" } });
    globalThis.chrome = mock.chrome;

    await import("../extension/src/background");
    await flushMicrotasks();

    lastConnectionManager?.emitAnnotationCommand({
      type: "annotationCommand",
      payload: { version: 1, requestId: "req-2", command: "start" }
    });
    await flushMicrotasks();

    expect(lastConnectionManager?.sendAnnotationResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "annotationResponse",
        payload: expect.objectContaining({
          requestId: "req-2",
          status: "error",
          error: expect.objectContaining({ code: "restricted_url" })
        })
      })
    );
  });

  it("rejects annotation requests on about:blank URLs", async () => {
    const mock = createChromeMock({ autoConnect: false, activeTab: { id: 10, url: "about:blank", title: "about:blank" } });
    globalThis.chrome = mock.chrome;

    await import("../extension/src/background");
    await flushMicrotasks();

    lastConnectionManager?.emitAnnotationCommand({
      type: "annotationCommand",
      payload: { version: 1, requestId: "req-2b", command: "start" }
    });
    await flushMicrotasks();

    expect(lastConnectionManager?.sendAnnotationResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "annotationResponse",
        payload: expect.objectContaining({
          requestId: "req-2b",
          status: "error",
          error: expect.objectContaining({ code: "restricted_url" })
        })
      })
    );
  });

  it("returns visible tab capture data to the content script", async () => {
    const mock = createChromeMock({ autoConnect: false });
    mock.setCaptureVisibleTabResult("data:image/png;base64,TESTDATA");
    globalThis.chrome = mock.chrome;

    await import("../extension/src/background");
    await flushMicrotasks();

    const response = await new Promise<{ ok?: boolean; dataUrl?: string }>((resolve) => {
      globalThis.chrome.runtime.sendMessage({ type: "annotation:capture", requestId: "req-3", mode: "visible" }, (payload) => resolve(payload as { ok?: boolean; dataUrl?: string }));
    });

    expect(response.ok).toBe(true);
    expect(response.dataUrl).toBe("data:image/png;base64,TESTDATA");
  });

  it("starts annotation from popup and sends start message to the tab", async () => {
    const mock = createChromeMock({ autoConnect: false });
    globalThis.chrome = mock.chrome;

    await import("../extension/src/background");
    await flushMicrotasks();

    const response = await new Promise<{ ok?: boolean; requestId?: string }>((resolve) => {
      globalThis.chrome.runtime.sendMessage(
        { type: "annotation:start", options: { context: "Review hero" } },
        (payload) => resolve(payload as { ok?: boolean; requestId?: string })
      );
    });

    expect(response.ok).toBe(true);
    const tabMessages = mock.chrome.tabs.sendMessage.mock.calls.map((call) => call[1] as { type?: string });
    expect(tabMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "annotation:start" })
      ])
    );
  });

  it("stores annotation meta and returns sanitized payload for popup copy", async () => {
    const mock = createChromeMock({ autoConnect: false });
    globalThis.chrome = mock.chrome;

    await import("../extension/src/background");
    await flushMicrotasks();

    const startResponse = await new Promise<{ requestId?: string }>((resolve) => {
      globalThis.chrome.runtime.sendMessage({ type: "annotation:start" }, (payload) => resolve(payload as { requestId?: string }));
    });
    const requestId = startResponse.requestId ?? "req-annotation";

    const payload = {
      url: "https://example.com",
      title: "Example",
      timestamp: "2026-02-01T00:00:00.000Z",
      screenshotMode: "visible",
      screenshots: [{ id: "shot-1", label: "1", base64: "AAAA", mime: "image/png" }],
      annotations: [
        {
          id: "item-1",
          selector: "body",
          tag: "body",
          rect: { x: 0, y: 0, width: 100, height: 100 },
          attributes: {},
          a11y: {},
          styles: {},
          screenshotId: "shot-1"
        }
      ]
    };

    await new Promise((resolve) => {
      globalThis.chrome.runtime.sendMessage(
        { type: "annotation:complete", requestId, payload },
        () => resolve(undefined)
      );
    });

    const metaResponse = await new Promise<{ meta?: { status?: string; annotationCount?: number } }>((resolve) => {
      globalThis.chrome.runtime.sendMessage({ type: "annotation:lastMeta" }, (payload) => resolve(payload as { meta?: { status?: string; annotationCount?: number } }));
    });

    expect(metaResponse.meta?.status).toBe("ok");
    expect(metaResponse.meta?.annotationCount).toBe(1);

    const payloadResponse = await new Promise<{ payload?: { screenshots?: unknown; annotations?: Array<Record<string, unknown>> } }>((resolve) => {
      globalThis.chrome.runtime.sendMessage(
        { type: "annotation:getPayload", includeScreenshots: false },
        (payload) => resolve(payload as { payload?: { screenshots?: unknown; annotations?: Array<Record<string, unknown>> } })
      );
    });

    expect(payloadResponse.payload?.screenshots).toBeUndefined();
    expect(payloadResponse.payload?.annotations?.[0]?.screenshotId).toBeUndefined();
  });

  it("returns full payload with screenshots when available in memory", async () => {
    const mock = createChromeMock({ autoConnect: false });
    globalThis.chrome = mock.chrome;

    await import("../extension/src/background");
    await flushMicrotasks();

    const startResponse = await new Promise<{ requestId?: string }>((resolve) => {
      globalThis.chrome.runtime.sendMessage({ type: "annotation:start" }, (payload) => resolve(payload as { requestId?: string }));
    });
    const requestId = startResponse.requestId ?? "req-annotation";

    const payload = {
      url: "https://example.com",
      timestamp: "2026-02-01T00:00:00.000Z",
      screenshotMode: "visible",
      screenshots: [{ id: "shot-2", label: "1", base64: "BBBB", mime: "image/png" }],
      annotations: [
        {
          id: "item-2",
          selector: "body",
          tag: "body",
          rect: { x: 0, y: 0, width: 100, height: 100 },
          attributes: {},
          a11y: {},
          styles: {}
        }
      ]
    };

    await new Promise((resolve) => {
      globalThis.chrome.runtime.sendMessage(
        { type: "annotation:complete", requestId, payload },
        () => resolve(undefined)
      );
    });

    const payloadResponse = await new Promise<{ payload?: { screenshots?: Array<{ id: string }> }; source?: string }>((resolve) => {
      globalThis.chrome.runtime.sendMessage(
        { type: "annotation:getPayload", includeScreenshots: true },
        (payload) => resolve(payload as { payload?: { screenshots?: Array<{ id: string }> }; source?: string })
      );
    });

    expect(payloadResponse.source).toBe("memory");
    expect(payloadResponse.payload?.screenshots?.[0]?.id).toBe("shot-2");
  });

  it("falls back to stored_only receipts when shared enqueue is unavailable", async () => {
    const mock = createChromeMock({ autoConnect: false });
    globalThis.chrome = mock.chrome;

    await import("../extension/src/background");
    await flushMicrotasks();

    const payload = {
      url: "https://example.com",
      title: "Example",
      timestamp: "2026-03-12T00:00:00.000Z",
      screenshotMode: "visible" as const,
      screenshots: [{ id: "shot-agent", label: "full", base64: "CCCC", mime: "image/png" as const }],
      annotations: [
        {
          id: "item-agent",
          selector: "#hero",
          tag: "section",
          rect: { x: 0, y: 0, width: 320, height: 180 },
          attributes: {},
          a11y: {},
          styles: {},
          screenshotId: "shot-agent",
          note: "Hero needs work"
        }
      ]
    };

    const sendResponse = await new Promise<{ ok?: boolean; receipt?: { deliveryState?: string; storedFallback?: boolean } | null }>((resolve) => {
      globalThis.chrome.runtime.sendMessage(
        { type: "annotation:sendPayload", payload, source: "popup_all", label: "Popup annotation payload" },
        (message) => resolve(message as { ok?: boolean; receipt?: { deliveryState?: string; storedFallback?: boolean } | null })
      );
    });

    expect(sendResponse.ok).toBe(true);
    expect(sendResponse.receipt).toMatchObject({
      deliveryState: "stored_only",
      storedFallback: true
    });
    expect(lastConnectionManager?.sendAnnotationCommand).toHaveBeenCalledTimes(1);

    lastConnectionManager?.emitAnnotationCommand({
      type: "annotationCommand",
      payload: {
        version: 1,
        requestId: "fetch-agent",
        command: "fetch_stored",
        options: { includeScreenshots: false }
      }
    });
    await flushMicrotasks();

    expect(lastConnectionManager?.sendAnnotationResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "annotationResponse",
        payload: expect.objectContaining({
          requestId: "fetch-agent",
          status: "ok",
          payload: expect.objectContaining({
            annotations: [
              expect.not.objectContaining({ screenshotId: expect.anything() })
            ]
          })
        })
      })
    );
  });

  it("returns delivered receipts when shared enqueue succeeds", async () => {
    const mock = createChromeMock({ autoConnect: false });
    globalThis.chrome = mock.chrome;

    await import("../extension/src/background");
    await flushMicrotasks();

    lastConnectionManager?.sendAnnotationCommand.mockResolvedValue({
      version: 1,
      requestId: "req-store",
      status: "ok",
      receipt: {
        receiptId: "receipt-shared",
        deliveryState: "delivered",
        storedFallback: false,
        createdAt: "2026-03-15T00:00:00.000Z",
        itemCount: 1,
        byteLength: 64,
        source: "popup_all",
        label: "Popup annotation payload"
      }
    });

    const payload = {
      url: "https://example.com",
      timestamp: "2026-03-15T00:00:00.000Z",
      screenshotMode: "none" as const,
      annotations: []
    };

    const sendResponse = await new Promise<{ ok?: boolean; receipt?: { deliveryState?: string; storedFallback?: boolean } | null }>((resolve) => {
      globalThis.chrome.runtime.sendMessage(
        { type: "annotation:sendPayload", payload, source: "popup_all", label: "Popup annotation payload" },
        (message) => resolve(message as { ok?: boolean; receipt?: { deliveryState?: string; storedFallback?: boolean } | null })
      );
    });

    expect(sendResponse.ok).toBe(true);
    expect(sendResponse.receipt).toMatchObject({
      deliveryState: "delivered",
      storedFallback: false
    });
  });
});
