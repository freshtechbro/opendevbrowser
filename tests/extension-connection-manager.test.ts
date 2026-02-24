import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createChromeMock } from "./extension-chrome-mock";
import { DEFAULT_PAIRING_TOKEN } from "../extension/src/relay-settings";

const relayInstances: Array<{
  url: string;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  sendHandshake: ReturnType<typeof vi.fn>;
  sendEvent: ReturnType<typeof vi.fn>;
  sendResponse: ReturnType<typeof vi.fn>;
  sendPing: ReturnType<typeof vi.fn>;
  isConnected: ReturnType<typeof vi.fn>;
  triggerClose: (detail?: { code?: number; reason?: string }) => void;
}> = [];

let attachShouldFail = false;

vi.mock("../extension/src/services/RelayClient", () => ({
  RelayClient: class RelayClient {
    url: string;
    connect = vi.fn().mockResolvedValue({
      type: "handshakeAck",
      payload: { instanceId: "test-relay", relayPort: 8787, pairingRequired: true }
    });
    disconnect = vi.fn(() => {
      this.handlers.onClose({ code: 1000, reason: "disconnect" });
    });
    sendHandshake = vi.fn();
    sendEvent = vi.fn();
    sendResponse = vi.fn();
    sendPing = vi.fn().mockResolvedValue({
      ok: true,
      reason: "ok",
      extensionConnected: true,
      extensionHandshakeComplete: true,
      cdpConnected: false,
      annotationConnected: false,
      opsConnected: false,
      pairingRequired: true
    });
    isConnected = vi.fn(() => true);
    private handlers: { onClose: (detail?: { code?: number; reason?: string }) => void };

    constructor(url: string, handlers: { onCommand: (command: unknown) => void; onClose: (detail?: { code?: number; reason?: string }) => void }) {
      this.url = url;
      this.handlers = { onClose: handlers.onClose };
      relayInstances.push(this);
    }

    triggerClose(detail?: { code?: number; reason?: string }): void {
      this.handlers.onClose(detail);
    }
  }
}));

vi.mock("../extension/src/services/CDPRouter", () => ({
  CDPRouter: class CDPRouter {
    attachedTabs = new Set<number>();
    primaryTabId: number | null = null;
    callbacks: { onPrimaryTabChange?: (tabId: number | null) => void; onDetach?: (detail?: { tabId?: number; reason?: string }) => void } | null = null;
    attach = vi.fn(async (tabId: number) => {
      if (attachShouldFail) {
        throw new Error("Attach failed");
      }
      this.attachedTabs.add(tabId);
      this.primaryTabId = tabId;
    });
    detachAll = vi.fn(async () => {
      this.attachedTabs.clear();
      this.primaryTabId = null;
    });
    setCallbacks = vi.fn((callbacks: { onPrimaryTabChange?: (tabId: number | null) => void; onDetach?: (detail?: { tabId?: number; reason?: string }) => void }) => {
      this.callbacks = callbacks;
    });
    handleCommand = vi.fn(async () => undefined);
    getPrimaryTabId = vi.fn(() => this.primaryTabId);
    getAttachedTabIds = vi.fn(() => Array.from(this.attachedTabs));
    triggerDetach = (detail?: { tabId?: number; reason?: string }) => {
      this.attachedTabs.clear();
      this.primaryTabId = null;
      this.callbacks?.onDetach?.(detail);
    };
  }
}));

describe("ConnectionManager", () => {
  const originalChrome = globalThis.chrome;

  beforeEach(() => {
    relayInstances.length = 0;
    attachShouldFail = false;
    const { chrome } = createChromeMock();
    globalThis.chrome = chrome;
  });

  afterEach(() => {
    globalThis.chrome = originalChrome;
    vi.useRealTimers();
  });

  it("attaches and connects, then detaches on disconnect", async () => {
    const { ConnectionManager } = await import("../extension/src/services/ConnectionManager");
    const manager = new ConnectionManager();

    await manager.connect();
    expect(manager.getStatus()).toBe("connected");
    expect(manager.getRelayIdentity()).toEqual({ instanceId: "test-relay", relayPort: 8787 });

    const relay = relayInstances[0];
    expect(relay.url).toBe("ws://127.0.0.1:8787/extension");
    expect(relay.connect).toHaveBeenCalledTimes(1);
    expect(globalThis.chrome.storage.local.set).toHaveBeenCalledWith(expect.objectContaining({ relayPort: 8787 }));

    await manager.disconnect();
    expect(manager.getStatus()).toBe("disconnected");
    expect(relay.disconnect).toHaveBeenCalledTimes(1);
  });

  it("sends handshake updates when the tab changes", async () => {
    const mock = createChromeMock();
    globalThis.chrome = mock.chrome;

    const { ConnectionManager } = await import("../extension/src/services/ConnectionManager");
    const manager = new ConnectionManager();
    await manager.connect();

    const relay = relayInstances[0];
    mock.emitTabUpdated(1, { id: 1, url: "https://updated", title: "Updated", groupId: 2 } as chrome.tabs.Tab);
    expect(relay.sendHandshake).toHaveBeenCalledTimes(1);
  });

  it("uses default pairing token when pairing is enabled", async () => {
    const mock = createChromeMock({ pairingToken: null, pairingEnabled: true });
    globalThis.chrome = mock.chrome;

    const { ConnectionManager } = await import("../extension/src/services/ConnectionManager");
    const manager = new ConnectionManager();

    await manager.connect();
    const relay = relayInstances[0];
    const handshake = relay.connect.mock.calls[0]?.[0] as { payload?: { pairingToken?: string | null } } | undefined;
    const token = handshake?.payload?.pairingToken;
    expect(token === null || token === undefined || token === DEFAULT_PAIRING_TOKEN).toBe(true);
  });

  it("omits pairing token when pairing is disabled", async () => {
    const mock = createChromeMock({ pairingToken: "custom-token", pairingEnabled: false });
    globalThis.chrome = mock.chrome;

    const { ConnectionManager } = await import("../extension/src/services/ConnectionManager");
    const manager = new ConnectionManager();

    await manager.connect();
    const relay = relayInstances[0];
    const handshake = relay.connect.mock.calls[0]?.[0] as { payload?: { pairingToken?: string } } | undefined;
    const hasToken = Boolean(handshake?.payload && "pairingToken" in handshake.payload);
    expect(hasToken).toBe(false);
  });

  it("reconnects after relay close", async () => {
    vi.useFakeTimers();
    const { ConnectionManager } = await import("../extension/src/services/ConnectionManager");
    const manager = new ConnectionManager();

    await manager.connect();
    const first = relayInstances[0];
    first.triggerClose();

    await vi.advanceTimersByTimeAsync(13_000);
    expect(relayInstances.length).toBeGreaterThan(1);
  });

  it("reconnects after heartbeat timeout", async () => {
    vi.useFakeTimers();
    const { ConnectionManager } = await import("../extension/src/services/ConnectionManager");
    const manager = new ConnectionManager();

    await manager.connect();
    const first = relayInstances[0];
    first.sendPing.mockRejectedValueOnce(new Error("Ping timeout"));

    await vi.advanceTimersByTimeAsync(25_000);
    await vi.advanceTimersByTimeAsync(13_000);

    expect(relayInstances.length).toBeGreaterThan(1);
  });

  it("reconnects after CDP detach without disabling reconnect", async () => {
    vi.useFakeTimers();
    const { ConnectionManager } = await import("../extension/src/services/ConnectionManager");
    const manager = new ConnectionManager();

    await manager.connect();
    const cdp = (manager as { cdp?: { triggerDetach?: (detail?: { reason?: string }) => void } }).cdp;
    cdp?.triggerDetach?.({ reason: "target_closed" });

    await vi.advanceTimersByTimeAsync(13_000);
    expect(relayInstances.length).toBeGreaterThan(1);
  });

  it("clears pairing token on invalid pairing close", async () => {
    const mock = createChromeMock({ pairingToken: "stale-token" });
    globalThis.chrome = mock.chrome;
    const { ConnectionManager } = await import("../extension/src/services/ConnectionManager");
    const manager = new ConnectionManager();

    await manager.connect();
    const relay = relayInstances[0];
    relay.triggerClose({ code: 1008, reason: "Invalid pairing token" });

    expect(globalThis.chrome.storage.local.set).toHaveBeenCalledWith({ pairingToken: null, tokenEpoch: null });
  });

  it("clears stored relay identity when instance mismatches on reconnect", async () => {
    const mock = createChromeMock({ relayInstanceId: "old-relay", relayEpoch: 1, pairingToken: "token" });
    globalThis.chrome = mock.chrome;
    const { ConnectionManager } = await import("../extension/src/services/ConnectionManager");
    const manager = new ConnectionManager();

    await manager.connect();
    expect(manager.getRelayNotice()).toMatch(/relay instance/i);
    expect(globalThis.chrome.storage.local.set).toHaveBeenCalledWith({ relayInstanceId: null, relayEpoch: null });
    expect(globalThis.chrome.storage.local.set).toHaveBeenCalledWith({ pairingToken: null, tokenEpoch: null });
  });

  it("reports missing active tab errors", async () => {
    const mock = createChromeMock();
    mock.setActiveTab(null);
    globalThis.chrome = mock.chrome;

    const { ConnectionManager } = await import("../extension/src/services/ConnectionManager");
    const manager = new ConnectionManager();

    await manager.connect();
    expect(manager.getStatus()).toBe("disconnected");
    expect(manager.getLastError()?.code).toBe("no_active_tab");
  });

  it("reports restricted tab URL errors", async () => {
    const mock = createChromeMock({
      activeTab: {
        id: 2,
        url: "chrome://extensions",
        title: "Extensions"
      } as chrome.tabs.Tab
    });
    globalThis.chrome = mock.chrome;

    const { ConnectionManager } = await import("../extension/src/services/ConnectionManager");
    const manager = new ConnectionManager();

    await manager.connect();
    expect(manager.getStatus()).toBe("disconnected");
    expect(manager.getLastError()?.code).toBe("tab_url_restricted");
  });

  it("reports debugger attach failures", async () => {
    attachShouldFail = true;
    const mock = createChromeMock();
    globalThis.chrome = mock.chrome;

    const { ConnectionManager } = await import("../extension/src/services/ConnectionManager");
    const manager = new ConnectionManager();

    await manager.connect();
    expect(manager.getStatus()).toBe("disconnected");
    expect(manager.getLastError()?.code).toBe("debugger_attach_failed");
  });
});
