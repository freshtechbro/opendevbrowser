import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NativePortManager } from "../extension/src/services/NativePortManager";

type MessageListener = (payload: unknown) => void;
type DisconnectListener = () => void;

const makeMockPort = (options: { respondToPing?: boolean } = {}) => {
  const respondToPing = options.respondToPing !== false;
  const messageListeners = new Set<MessageListener>();
  const disconnectListeners = new Set<DisconnectListener>();
  const port = {
    postMessage: vi.fn((payload: unknown) => {
      const record = payload as Record<string, unknown>;
      if (respondToPing && record?.type === "ping" && typeof record.id === "string") {
        for (const listener of messageListeners) {
          listener({ type: "pong", id: record.id });
        }
      }
    }),
    onMessage: {
      addListener: (listener: MessageListener) => messageListeners.add(listener),
      removeListener: (listener: MessageListener) => messageListeners.delete(listener)
    },
    onDisconnect: {
      addListener: (listener: DisconnectListener) => disconnectListeners.add(listener),
      removeListener: (listener: DisconnectListener) => disconnectListeners.delete(listener)
    },
    disconnect: vi.fn(() => {
      for (const listener of disconnectListeners) {
        listener();
      }
    })
  };
  return { port, messageListeners, disconnectListeners };
};

describe("NativePortManager", () => {
  const originalChrome = globalThis.chrome;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.chrome = originalChrome;
  });

  it("connects and resolves ping", async () => {
    const { port } = makeMockPort();
    globalThis.chrome = {
      runtime: {
        connectNative: vi.fn(() => port),
        lastError: null
      }
    } as unknown as typeof chrome;

    const manager = new NativePortManager();
    const connected = await manager.connect();
    expect(connected).toBe(true);

    await expect(manager.ping(500)).resolves.toBeUndefined();
    expect(manager.getHealth().status).toBe("connected");
  });

  it("classifies not installed errors on connect", async () => {
    globalThis.chrome = {
      runtime: {
        connectNative: vi.fn(() => {
          throw new Error("Specified native messaging host not found.");
        }),
        lastError: null
      }
    } as unknown as typeof chrome;

    const manager = new NativePortManager();
    const connected = await manager.connect();
    expect(connected).toBe(false);
    expect(manager.getHealth().error).toBe("host_not_installed");
  });

  it("classifies forbidden errors on disconnect", async () => {
    const { port } = makeMockPort();
    globalThis.chrome = {
      runtime: {
        connectNative: vi.fn(() => port),
        lastError: null
      }
    } as unknown as typeof chrome;

    const manager = new NativePortManager();
    await manager.connect();
    globalThis.chrome.runtime.lastError = { message: "Access to the specified native messaging host is forbidden." };
    port.disconnect();
    expect(manager.getHealth().error).toBe("host_forbidden");
  });

  it("rejects pending ping when native host disconnects", async () => {
    const { port } = makeMockPort({ respondToPing: false });
    globalThis.chrome = {
      runtime: {
        connectNative: vi.fn(() => port),
        lastError: null
      }
    } as unknown as typeof chrome;

    const manager = new NativePortManager();
    await manager.connect();

    const pingPromise = manager.ping(5000);
    port.disconnect();

    await expect(pingPromise).rejects.toThrow("Native host disconnected");
    expect(manager.getHealth().error).toBe("host_disconnect");
  });
});
