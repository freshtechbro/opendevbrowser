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
  triggerCdpControl: (message: { type: "cdp_control"; action: "client_closed" }) => void;
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
    private handlers: {
      onClose: (detail?: { code?: number; reason?: string }) => void;
      onCdpControl?: (message: { type: "cdp_control"; action: "client_closed" }) => void;
    };

    constructor(url: string, handlers: {
      onCommand: (command: unknown) => void;
      onClose: (detail?: { code?: number; reason?: string }) => void;
      onCdpControl?: (message: { type: "cdp_control"; action: "client_closed" }) => void;
    }) {
      this.url = url;
      this.handlers = { onClose: handlers.onClose, onCdpControl: handlers.onCdpControl };
      relayInstances.push(this);
    }

    triggerClose(detail?: { code?: number; reason?: string }): void {
      this.handlers.onClose(detail);
    }

    triggerCdpControl(message: { type: "cdp_control"; action: "client_closed" }): void {
      this.handlers.onCdpControl?.(message);
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
    markClientClosed = vi.fn(() => undefined);
    getPrimaryTabId = vi.fn(() => this.primaryTabId);
    getAttachedTabIds = vi.fn(() => Array.from(this.attachedTabs));
    triggerDetach = (detail?: { tabId?: number; reason?: string }) => {
      this.attachedTabs.clear();
      this.primaryTabId = null;
      this.callbacks?.onPrimaryTabChange?.(null);
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

  it("marks legacy cdp state stale when the relay reports the client closed", async () => {
    const { ConnectionManager } = await import("../extension/src/services/ConnectionManager");
    const manager = new ConnectionManager();

    await manager.connect();
    const relay = relayInstances[0];
    const cdp = (manager as { cdp?: { markClientClosed?: ReturnType<typeof vi.fn> } }).cdp;

    relay.triggerCdpControl({ type: "cdp_control", action: "client_closed" });

    expect(cdp?.markClientClosed).toHaveBeenCalledTimes(1);
  });

  it("keeps the tracked web tab when the primary tab changes to the extension canvas", async () => {
    const webTab = {
      id: 1,
      url: "https://example.com",
      title: "Example",
      status: "complete",
      active: true,
      lastAccessed: 20
    } satisfies chrome.tabs.Tab;
    const canvasTab = {
      id: 2,
      url: "chrome-extension://test/canvas.html",
      title: "OpenDevBrowser Canvas",
      status: "complete",
      active: false,
      lastAccessed: 30
    } satisfies chrome.tabs.Tab;
    const mock = createChromeMock({ activeTab: webTab, tabs: [webTab, canvasTab] });
    globalThis.chrome = mock.chrome;

    const { ConnectionManager } = await import("../extension/src/services/ConnectionManager");
    const manager = new ConnectionManager();
    await manager.connect();

    const relay = relayInstances[0];
    const cdp = (manager as { cdp?: { callbacks?: { onPrimaryTabChange?: (tabId: number | null) => void } } }).cdp;
    const onPrimaryTabChange = cdp?.callbacks?.onPrimaryTabChange;
    expect(onPrimaryTabChange).toBeTypeOf("function");
    await onPrimaryTabChange?.(canvasTab.id);

    const trackedTab = (manager as { trackedTab?: { id?: number } | null }).trackedTab;
    expect(trackedTab?.id).toBe(webTab.id);
    expect(relay.isConnected()).toBe(true);
  });

  it("falls back to the first http tab when connect starts from about:blank", async () => {
    const webTab = {
      id: 1,
      url: "https://example.com/workspace",
      title: "Workspace",
      status: "complete",
      active: false,
      lastAccessed: 10
    } satisfies chrome.tabs.Tab;
    const blankTab = {
      id: 2,
      url: "about:blank",
      title: "about:blank",
      status: "complete",
      active: true,
      lastAccessed: 20
    } satisfies chrome.tabs.Tab;
    const mock = createChromeMock({ activeTab: blankTab, tabs: [webTab, blankTab] });
    globalThis.chrome = mock.chrome;

    const { ConnectionManager } = await import("../extension/src/services/ConnectionManager");
    const manager = new ConnectionManager();
    await manager.connect();

    const relay = relayInstances[0];
    const handshake = relay.connect.mock.calls[0]?.[0] as {
      payload?: { tabId?: number; url?: string };
    } | undefined;
    const trackedTab = (manager as { trackedTab?: { id?: number } | null }).trackedTab;
    const cdp = (manager as { cdp?: { attach?: ReturnType<typeof vi.fn> } }).cdp;

    expect(cdp?.attach).toHaveBeenCalledWith(webTab.id);
    expect(handshake?.payload?.tabId).toBe(webTab.id);
    expect(handshake?.payload?.url).toBe(webTab.url);
    expect(trackedTab?.id).toBe(webTab.id);
  });

  it("falls back to the first http tab when no active tab is available on startup", async () => {
    const webTab = {
      id: 2,
      url: "https://example.com/workspace",
      title: "Workspace",
      status: "complete",
      active: false,
      lastAccessed: 10
    } satisfies chrome.tabs.Tab;
    const mock = createChromeMock({ tabs: [webTab] });
    mock.setActiveTab(null);
    globalThis.chrome = mock.chrome;

    const { ConnectionManager } = await import("../extension/src/services/ConnectionManager");
    const manager = new ConnectionManager();
    await manager.connect();

    const relay = relayInstances[0];
    const handshake = relay.connect.mock.calls[0]?.[0] as {
      payload?: { tabId?: number; url?: string };
    } | undefined;
    const trackedTab = (manager as { trackedTab?: { id?: number } | null }).trackedTab;
    const cdp = (manager as { cdp?: { attach?: ReturnType<typeof vi.fn> } }).cdp;

    expect(cdp?.attach).toHaveBeenCalledWith(webTab.id);
    expect(handshake?.payload?.tabId).toBe(webTab.id);
    expect(handshake?.payload?.url).toBe(webTab.url);
    expect(trackedTab?.id).toBe(webTab.id);
  });

  it("bootstraps a fresh browser tab when connect starts from the internal design canvas blank tab", async () => {
    const canvasBlankTab = {
      id: 2,
      url: "about:blank",
      title: "Untitled Design Canvas",
      status: "complete",
      active: true,
      lastAccessed: 20
    } satisfies chrome.tabs.Tab;
    const mock = createChromeMock({ activeTab: canvasBlankTab, tabs: [canvasBlankTab] });
    globalThis.chrome = mock.chrome;

    const { ConnectionManager } = await import("../extension/src/services/ConnectionManager");
    const manager = new ConnectionManager();
    await manager.connect();

    const relay = relayInstances[0];
    const handshake = relay.connect.mock.calls[0]?.[0] as {
      payload?: { tabId?: number; url?: string };
    } | undefined;
    const trackedTab = (manager as { trackedTab?: { id?: number } | null }).trackedTab;
    const cdp = (manager as { cdp?: { attach?: ReturnType<typeof vi.fn> } }).cdp;

    expect(globalThis.chrome.tabs.create).toHaveBeenCalledWith({ url: "about:blank", active: true }, expect.any(Function));
    expect(cdp?.attach).toHaveBeenCalledWith(3);
    expect(handshake?.payload?.tabId).toBe(3);
    expect(handshake?.payload?.url).toBe("about:blank");
    expect(trackedTab?.id).toBe(3);
  });

  it("bootstraps a fresh browser tab when startup only has a restricted tab", async () => {
    const restrictedTab = {
      id: 2,
      url: "chrome://extensions",
      title: "Extensions",
      status: "complete",
      active: true,
      lastAccessed: 20
    } satisfies chrome.tabs.Tab;
    const mock = createChromeMock({ activeTab: restrictedTab, tabs: [restrictedTab] });
    globalThis.chrome = mock.chrome;

    const { ConnectionManager } = await import("../extension/src/services/ConnectionManager");
    const manager = new ConnectionManager();
    await manager.connect();

    const relay = relayInstances[0];
    const handshake = relay.connect.mock.calls[0]?.[0] as {
      payload?: { tabId?: number; url?: string };
    } | undefined;
    const trackedTab = (manager as { trackedTab?: { id?: number } | null }).trackedTab;
    const cdp = (manager as { cdp?: { attach?: ReturnType<typeof vi.fn> } }).cdp;

    expect(globalThis.chrome.tabs.create).toHaveBeenCalledWith({ url: "about:blank", active: true }, expect.any(Function));
    expect(cdp?.attach).toHaveBeenCalledWith(3);
    expect(handshake?.payload?.tabId).toBe(3);
    expect(handshake?.payload?.url).toBe("about:blank");
    expect(trackedTab?.id).toBe(3);
  });

  it("bootstraps a fresh browser tab when refreshTrackedTab sees a restricted-only reconnect target", async () => {
    const restrictedTab = {
      id: 2,
      url: "about:blank",
      title: "Untitled Design Canvas",
      status: "complete",
      active: true,
      lastAccessed: 20
    } satisfies chrome.tabs.Tab;
    const mock = createChromeMock({ activeTab: restrictedTab, tabs: [restrictedTab] });
    globalThis.chrome = mock.chrome;

    const { ConnectionManager } = await import("../extension/src/services/ConnectionManager");
    const manager = new ConnectionManager();
    await (manager as unknown as { refreshTrackedTab: (tabId: number) => Promise<void> }).refreshTrackedTab(restrictedTab.id);

    const trackedTab = (manager as { trackedTab?: { id?: number; url?: string } | null }).trackedTab;

    expect(globalThis.chrome.tabs.create).toHaveBeenCalledWith({ url: "about:blank", active: true }, expect.any(Function));
    expect(trackedTab?.id).toBe(3);
    expect(trackedTab?.url).toBe("about:blank");
  });

  it("keeps the tracked web tab when the primary tab changes to about:blank", async () => {
    const webTab = {
      id: 1,
      url: "https://example.com",
      title: "Example",
      status: "complete",
      active: true,
      lastAccessed: 20
    } satisfies chrome.tabs.Tab;
    const blankTab = {
      id: 2,
      url: "about:blank",
      title: "about:blank",
      status: "complete",
      active: false,
      lastAccessed: 30
    } satisfies chrome.tabs.Tab;
    const mock = createChromeMock({ activeTab: webTab, tabs: [webTab, blankTab] });
    globalThis.chrome = mock.chrome;

    const { ConnectionManager } = await import("../extension/src/services/ConnectionManager");
    const manager = new ConnectionManager();
    await manager.connect();

    const relay = relayInstances[0];
    const cdp = (manager as { cdp?: { callbacks?: { onPrimaryTabChange?: (tabId: number | null) => void } } }).cdp;
    const onPrimaryTabChange = cdp?.callbacks?.onPrimaryTabChange;
    expect(onPrimaryTabChange).toBeTypeOf("function");
    await onPrimaryTabChange?.(blankTab.id);

    const trackedTab = (manager as { trackedTab?: { id?: number } | null }).trackedTab;
    expect(trackedTab?.id).toBe(webTab.id);
    expect(relay.isConnected()).toBe(true);
  });

  it("keeps the tracked web tab when the primary tab changes to popup with no remaining http fallback", async () => {
    const webTab = {
      id: 1,
      url: "https://example.com",
      title: "Example",
      status: "complete",
      active: true,
      lastAccessed: 20
    } satisfies chrome.tabs.Tab;
    const popupTab = {
      id: 2,
      url: "chrome-extension://test/popup.html",
      title: "OpenDevBrowser",
      status: "complete",
      active: true,
      lastAccessed: 30
    } satisfies chrome.tabs.Tab;
    const mock = createChromeMock({ activeTab: webTab });
    globalThis.chrome = mock.chrome;

    const { ConnectionManager } = await import("../extension/src/services/ConnectionManager");
    const manager = new ConnectionManager();
    await manager.connect();

    mock.setActiveTab(popupTab);

    const relay = relayInstances[0];
    const cdp = (manager as { cdp?: { callbacks?: { onPrimaryTabChange?: (tabId: number | null) => void } } }).cdp;
    const onPrimaryTabChange = cdp?.callbacks?.onPrimaryTabChange;
    expect(onPrimaryTabChange).toBeTypeOf("function");
    await onPrimaryTabChange?.(popupTab.id);

    const trackedTab = (manager as { trackedTab?: { id?: number; url?: string } | null }).trackedTab;
    expect(trackedTab?.id).toBe(webTab.id);
    expect(trackedTab?.url).toBe(webTab.url);
    expect(relay.isConnected()).toBe(true);
  });

  it("moves the tracked tab to a newly primary web tab once that tab finishes loading", async () => {
    const webTab = {
      id: 1,
      url: "https://example.com/root",
      title: "Root",
      status: "complete",
      active: true,
      lastAccessed: 20
    } satisfies chrome.tabs.Tab;
    const loadingTab = {
      id: 3,
      url: "about:blank",
      title: "Loading",
      status: "loading",
      active: false,
      lastAccessed: 30
    } satisfies chrome.tabs.Tab;
    const loadedTab = {
      id: 3,
      url: "https://example.com/new-root",
      title: "New Root",
      status: "complete",
      active: true,
      lastAccessed: 40
    } satisfies chrome.tabs.Tab;
    const mock = createChromeMock({ activeTab: webTab, tabs: [webTab, loadingTab] });
    globalThis.chrome = mock.chrome;

    const { ConnectionManager } = await import("../extension/src/services/ConnectionManager");
    const manager = new ConnectionManager();
    await manager.connect();

    const relay = relayInstances[0];
    const cdp = (manager as {
      cdp?: {
        primaryTabId: number | null;
        callbacks?: { onPrimaryTabChange?: (tabId: number | null) => void };
      }
    }).cdp;
    const onPrimaryTabChange = cdp?.callbacks?.onPrimaryTabChange;
    expect(onPrimaryTabChange).toBeTypeOf("function");

    if (cdp) {
      cdp.primaryTabId = loadingTab.id;
    }
    await onPrimaryTabChange?.(loadingTab.id);

    let trackedTab = (manager as { trackedTab?: { id?: number; url?: string } | null }).trackedTab;
    expect(trackedTab?.id).toBe(webTab.id);

    relay.sendHandshake.mockClear();
    await (manager as unknown as {
      handleTabUpdated: (tabId: number, changeInfo: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab) => void;
    }).handleTabUpdated(loadingTab.id, { status: "complete" }, loadedTab);

    await vi.waitFor(() => {
      trackedTab = (manager as { trackedTab?: { id?: number; url?: string } | null }).trackedTab;
      expect(trackedTab?.id).toBe(loadedTab.id);
      expect(trackedTab?.url).toBe(loadedTab.url);
      expect(relay.sendHandshake).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            tabId: loadedTab.id,
            url: loadedTab.url,
            title: loadedTab.title
          })
        })
      );
    });
  });

  it("refreshes the tracked tab when a stale restricted tracked tab is removed but another attached web tab remains", async () => {
    const webTab = {
      id: 1,
      url: "https://example.com",
      title: "Example",
      status: "complete",
      active: true,
      lastAccessed: 20
    } satisfies chrome.tabs.Tab;
    const canvasTab = {
      id: 2,
      url: "about:blank",
      title: "Untitled Design Canvas",
      status: "complete",
      active: false,
      lastAccessed: 30
    } satisfies chrome.tabs.Tab;
    const mock = createChromeMock({ activeTab: webTab, tabs: [webTab, canvasTab] });
    globalThis.chrome = mock.chrome;

    const { ConnectionManager } = await import("../extension/src/services/ConnectionManager");
    const manager = new ConnectionManager();
    await manager.connect();

    const relay = relayInstances[0];
    const managerAny = manager as {
      trackedTab?: { id?: number; url?: string } | null;
      cdp?: { attachedTabs: Set<number>; primaryTabId: number | null };
    };
    managerAny.trackedTab = { id: canvasTab.id, url: canvasTab.url, title: canvasTab.title };
    managerAny.cdp?.attachedTabs.add(canvasTab.id);
    if (managerAny.cdp) {
      managerAny.cdp.primaryTabId = canvasTab.id;
    }

    globalThis.chrome.tabs.remove(canvasTab.id);
    await vi.waitFor(() => {
      expect(managerAny.trackedTab?.id).toBe(webTab.id);
    });

    expect(managerAny.trackedTab?.url).toBe(webTab.url);
    expect(relay.sendHandshake).toHaveBeenCalled();
    expect(relay.isConnected()).toBe(true);
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

  it("skips a timed reconnect when another path already restored the relay", async () => {
    vi.useFakeTimers();
    const { ConnectionManager } = await import("../extension/src/services/ConnectionManager");
    const manager = new ConnectionManager();

    await manager.connect();
    const first = relayInstances[0];
    first.triggerClose();

    const managerState = manager as { status: string };
    managerState.status = "connected";

    await vi.advanceTimersByTimeAsync(13_000);

    expect(relayInstances).toHaveLength(1);
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

  it("preserves the relay connection across manual session cleanup detaches", async () => {
    const { ConnectionManager } = await import("../extension/src/services/ConnectionManager");
    const manager = new ConnectionManager();

    await manager.connect();
    const relay = relayInstances[0];
    const cdp = (manager as {
      cdp?: {
        attach?: ReturnType<typeof vi.fn>;
        triggerDetach?: (detail?: { tabId?: number; reason?: string }) => void;
      };
    }).cdp;

    cdp?.triggerDetach?.({ tabId: 1, reason: "manual_disconnect" });

    await vi.waitFor(() => {
      expect(cdp?.attach).toHaveBeenCalledTimes(2);
    });
    expect(relay.disconnect).not.toHaveBeenCalled();
    expect(manager.getStatus()).toBe("connected");
  });

  it("preserves the relay connection when manual cleanup detaches a stale design tab", async () => {
    const webTab = {
      id: 1,
      url: "https://example.com",
      title: "Example",
      status: "complete",
      active: true,
      lastAccessed: 20
    } satisfies chrome.tabs.Tab;
    const mock = createChromeMock({ activeTab: webTab, tabs: [webTab] });
    globalThis.chrome = mock.chrome;

    const { ConnectionManager } = await import("../extension/src/services/ConnectionManager");
    const manager = new ConnectionManager();
    await manager.connect();

    const relay = relayInstances[0];
    const cdp = (manager as {
      cdp?: {
        attach?: ReturnType<typeof vi.fn>;
        attachedTabs: Set<number>;
        primaryTabId: number | null;
        triggerDetach?: (detail?: { tabId?: number; reason?: string }) => void;
      };
    }).cdp;

    cdp?.attach?.mockImplementation(async (tabId: number) => {
      cdp.attachedTabs.clear();
      cdp.attachedTabs.add(tabId === 99 ? webTab.id : tabId);
      cdp.primaryTabId = tabId === 99 ? webTab.id : tabId;
    });

    cdp?.triggerDetach?.({ tabId: 99, reason: "manual_disconnect" });

    await vi.waitFor(() => {
      expect(cdp?.attach).toHaveBeenCalledWith(99);
    });
    expect(relay.disconnect).not.toHaveBeenCalled();
    expect(manager.getStatus()).toBe("connected");
    const trackedTab = (manager as { trackedTab?: { id?: number; url?: string } | null }).trackedTab;
    expect(trackedTab?.id).toBe(webTab.id);
    expect(trackedTab?.url).toBe(webTab.url);
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
    const createTab = globalThis.chrome.tabs.create as unknown as ReturnType<typeof vi.fn>;
    createTab.mockImplementation((_properties: chrome.tabs.CreateProperties, callback?: (tab: chrome.tabs.Tab) => void) => {
      globalThis.chrome.runtime.lastError = { message: "Tab creation blocked" };
      callback?.(undefined as unknown as chrome.tabs.Tab);
      globalThis.chrome.runtime.lastError = null;
      return undefined as unknown as chrome.tabs.Tab;
    });

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
      } as chrome.tabs.Tab,
      tabs: [{
        id: 2,
        url: "chrome://extensions",
        title: "Extensions",
        status: "complete",
        active: true
      } as chrome.tabs.Tab]
    });
    globalThis.chrome = mock.chrome;
    const createTab = globalThis.chrome.tabs.create as unknown as ReturnType<typeof vi.fn>;
    createTab.mockImplementation((_properties: chrome.tabs.CreateProperties, callback?: (tab: chrome.tabs.Tab) => void) => {
      globalThis.chrome.runtime.lastError = { message: "Tab creation blocked" };
      callback?.(undefined as unknown as chrome.tabs.Tab);
      globalThis.chrome.runtime.lastError = null;
      return undefined as unknown as chrome.tabs.Tab;
    });

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
