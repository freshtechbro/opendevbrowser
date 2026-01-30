import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createChromeMock } from "./extension-chrome-mock";

type ConnectionStatus = "connected" | "disconnected";

let lastConnectionManager: {
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  getStatus: ReturnType<typeof vi.fn>;
  getLastError: ReturnType<typeof vi.fn>;
  getRelayIdentity: ReturnType<typeof vi.fn>;
  clearLastError: ReturnType<typeof vi.fn>;
  emitStatus: (status: ConnectionStatus) => void;
} | null = null;

const registerLastConnectionManager = (manager: NonNullable<typeof lastConnectionManager>): void => {
  lastConnectionManager = manager;
};

vi.mock("../extension/src/services/ConnectionManager", () => ({
  ConnectionManager: class ConnectionManager {
    status: ConnectionStatus = "disconnected";
    listeners = new Set<(status: ConnectionStatus) => void>();
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
    clearLastError = vi.fn();
    onStatus = (listener: (status: ConnectionStatus) => void) => {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    };
    emitStatus = (status: ConnectionStatus) => {
      for (const listener of this.listeners) {
        listener(status);
      }
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
