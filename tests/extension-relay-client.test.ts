import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RelayClient } from "../extension/src/services/RelayClient";

class FakeWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  private listeners = new Map<string, Set<(event: { data?: string }) => void>>();

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
    setTimeout(() => {
      this.readyState = FakeWebSocket.OPEN;
      this.emit("open");
    }, 0);
  }

  addEventListener(type: string, listener: (event: { data?: string }) => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close");
  }

  emit(type: string, event: { data?: string } = {}): void {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const listener of set) {
      listener(event);
    }
  }
}

describe("RelayClient", () => {
  const originalWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.useFakeTimers();
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.WebSocket = originalWebSocket;
  });

  it("connects, sends handshake, and routes commands", async () => {
    const onCommand = vi.fn();
    const onClose = vi.fn();
    const client = new RelayClient("ws://relay", { onCommand, onClose });

    const handshake = { type: "handshake", payload: { tabId: 1 } };
    const connectPromise = client.connect(handshake);
    await vi.advanceTimersByTimeAsync(0);

    const socket = FakeWebSocket.instances[0];
    expect(socket.sent[0]).toBe(JSON.stringify(handshake));
    socket.emit("message", {
      data: JSON.stringify({ type: "handshakeAck", payload: { instanceId: "relay-1", relayPort: 8787, pairingRequired: false } })
    });
    await connectPromise;

    socket.emit("message", {
      data: JSON.stringify({ method: "forwardCDPCommand", id: 1, params: { method: "Runtime.enable" } })
    });
    expect(onCommand).toHaveBeenCalledTimes(1);

    client.sendEvent({ method: "forwardCDPEvent", params: { method: "Page.loadEventFired", params: {} } });
    expect(socket.sent.some((item) => item.includes("forwardCDPEvent"))).toBe(true);

    socket.close();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
