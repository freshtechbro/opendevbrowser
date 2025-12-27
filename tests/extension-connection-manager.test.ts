import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createChromeMock } from "./extension-chrome-mock";

const relayInstances: Array<{
  url: string;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  sendHandshake: ReturnType<typeof vi.fn>;
  sendEvent: ReturnType<typeof vi.fn>;
  sendResponse: ReturnType<typeof vi.fn>;
  isConnected: ReturnType<typeof vi.fn>;
  triggerClose: () => void;
}> = [];

vi.mock("../extension/src/services/RelayClient", () => ({
  RelayClient: class RelayClient {
    url: string;
    connect = vi.fn().mockResolvedValue(undefined);
    disconnect = vi.fn();
    sendHandshake = vi.fn();
    sendEvent = vi.fn();
    sendResponse = vi.fn();
    isConnected = vi.fn(() => true);
    private handlers: { onClose: () => void };

    constructor(url: string, handlers: { onCommand: (command: unknown) => void; onClose: () => void }) {
      this.url = url;
      this.handlers = { onClose: handlers.onClose };
      relayInstances.push(this);
    }

    triggerClose(): void {
      this.handlers.onClose();
    }
  }
}));

vi.mock("../extension/src/services/CDPRouter", () => ({
  CDPRouter: class CDPRouter {
    attachedTabId: number | null = null;
    attach = vi.fn(async (tabId: number) => {
      this.attachedTabId = tabId;
    });
    detach = vi.fn(async () => {
      this.attachedTabId = null;
    });
    setCallbacks = vi.fn();
    handleCommand = vi.fn(async () => undefined);
    getAttachedTabId = vi.fn(() => this.attachedTabId);
  }
}));

describe("ConnectionManager", () => {
  const originalChrome = globalThis.chrome;

  beforeEach(() => {
    relayInstances.length = 0;
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

    const relay = relayInstances[0];
    expect(relay.url).toBe("ws://127.0.0.1:8787/extension");
    expect(relay.connect).toHaveBeenCalledTimes(1);

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

  it("reconnects after relay close", async () => {
    vi.useFakeTimers();
    const { ConnectionManager } = await import("../extension/src/services/ConnectionManager");
    const manager = new ConnectionManager();

    await manager.connect();
    const first = relayInstances[0];
    first.triggerClose();

    await vi.advanceTimersByTimeAsync(600);
    expect(relayInstances.length).toBeGreaterThan(1);
  });
});
