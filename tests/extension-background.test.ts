import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createChromeMock } from "./extension-chrome-mock";

type ConnectionStatus = "connected" | "disconnected";

let lastConnectionManager: {
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  getStatus: ReturnType<typeof vi.fn>;
  emitStatus: (status: ConnectionStatus) => void;
} | null = null;

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
      lastConnectionManager = this;
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
