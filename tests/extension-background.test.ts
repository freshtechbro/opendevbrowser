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
  sendAnnotationResponse: ReturnType<typeof vi.fn>;
  sendAnnotationEvent: ReturnType<typeof vi.fn>;
  sendOpsMessage: ReturnType<typeof vi.fn>;
  getCdpRouter: ReturnType<typeof vi.fn>;
  relayHealthCheck: ReturnType<typeof vi.fn>;
  emitStatus: (status: ConnectionStatus) => void;
  emitAnnotationCommand: (command: unknown) => void;
  emitOpsMessage: (message: unknown) => void;
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
    sendAnnotationResponse = vi.fn();
    sendAnnotationEvent = vi.fn();
    sendOpsMessage = vi.fn();
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

    expect(mock.chrome.action.setBadgeText).toHaveBeenCalledWith({ text: "OFF" });
    expect(mock.chrome.action.setBadgeBackgroundColor).toHaveBeenCalledWith({ color: "#5b667a" });

    lastConnectionManager?.emitStatus("connected");
    expect(mock.chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: "ON" });
    expect(mock.chrome.action.setBadgeBackgroundColor).toHaveBeenLastCalledWith({ color: "#20d5c6" });
  });
});

describe("extension background annotation routing", () => {
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
      callback?.({ ok: true });
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
      callback?.({ ok: true });
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
          error: expect.objectContaining({ code: "injection_failed" })
        })
      })
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
});
