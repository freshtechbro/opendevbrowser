import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RelayClient } from "../extension/src/services/RelayClient";

class FakeWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];
  static autoOpen = true;

  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  private listeners = new Map<string, Set<(event: { data?: string }) => void>>();

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
    if (FakeWebSocket.autoOpen) {
      setTimeout(() => {
        this.readyState = FakeWebSocket.OPEN;
        this.emit("open");
      }, 0);
    }
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
    this.emit("close", { code: 1000, reason: "" });
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
    FakeWebSocket.autoOpen = true;
    vi.useFakeTimers();
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.WebSocket = originalWebSocket;
  });

  it("connects, sends handshake, and routes commands", async () => {
    const onCommand = vi.fn();
    const onCdpControl = vi.fn();
    const onClose = vi.fn();
    const client = new RelayClient("ws://relay", { onCommand, onCdpControl, onClose });

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

    socket.emit("message", {
      data: JSON.stringify({ type: "cdp_control", action: "client_closed" })
    });
    expect(onCdpControl).toHaveBeenCalledWith({ type: "cdp_control", action: "client_closed" });

    client.sendEvent({ method: "forwardCDPEvent", params: { method: "Page.loadEventFired", params: {} } });
    expect(socket.sent.some((item) => item.includes("forwardCDPEvent"))).toBe(true);

    socket.close();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("sends ping and resolves pong", async () => {
    const onCommand = vi.fn();
    const onClose = vi.fn();
    const client = new RelayClient("ws://relay", { onCommand, onClose });

    const handshake = { type: "handshake", payload: { tabId: 1 } };
    const connectPromise = client.connect(handshake);
    await vi.advanceTimersByTimeAsync(0);

    const socket = FakeWebSocket.instances[0];
    socket.emit("message", {
      data: JSON.stringify({ type: "handshakeAck", payload: { instanceId: "relay-1", relayPort: 8787, pairingRequired: false } })
    });
    await connectPromise;

    const pingPromise = client.sendPing(500);
    const sentPing = socket.sent.find((message) => message.includes("\"type\":\"ping\""));
    expect(sentPing).toBeTruthy();

    const parsed = sentPing ? JSON.parse(sentPing) as { id: string } : { id: "" };
    socket.emit("message", {
      data: JSON.stringify({
        type: "pong",
        id: parsed.id,
        payload: {
          ok: true,
          reason: "ok",
          extensionConnected: true,
          extensionHandshakeComplete: true,
          cdpConnected: false,
          annotationConnected: false,
          opsConnected: false,
          pairingRequired: false
        }
      })
    });

    await expect(pingPromise).resolves.toMatchObject({ reason: "ok" });
  });

  it("awaits a fresh handshake acknowledgement when re-handshaking on an open socket", async () => {
    const client = new RelayClient("ws://relay", { onCommand: vi.fn(), onClose: vi.fn() });
    const initialHandshake = { type: "handshake", payload: { tabId: 1 } } as const;
    const connectPromise = client.connect(initialHandshake);
    await vi.advanceTimersByTimeAsync(0);

    const socket = FakeWebSocket.instances[0];
    socket.emit("message", {
      data: JSON.stringify({ type: "handshakeAck", payload: { instanceId: "relay-1", relayPort: 8787, pairingRequired: false } })
    });
    await connectPromise;

    const refreshedHandshake = {
      type: "handshake",
      payload: { tabId: 2, url: "https://example.com/next" }
    } as const;
    const rehandshakePromise = client.sendHandshake(refreshedHandshake);
    expect(socket.sent.at(-1)).toBe(JSON.stringify(refreshedHandshake));

    let resolved = false;
    void rehandshakePromise.then(() => {
      resolved = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).toBe(false);

    socket.emit("message", {
      data: JSON.stringify({ type: "handshakeAck", payload: { instanceId: "relay-1", relayPort: 8787, pairingRequired: false } })
    });

    await expect(rehandshakePromise).resolves.toMatchObject({
      payload: { instanceId: "relay-1", relayPort: 8787, pairingRequired: false }
    });
  });

  it("times out a stalled socket open and allows a later retry", async () => {
    const client = new RelayClient("ws://relay", { onCommand: vi.fn(), onClose: vi.fn() });
    const handshake = { type: "handshake", payload: { tabId: 1 } };

    FakeWebSocket.autoOpen = false;
    const stalledConnect = client.connect(handshake);
    const stalledExpectation = expect(stalledConnect).rejects.toThrow("Relay socket open timed out");
    await vi.advanceTimersByTimeAsync(3000);
    await stalledExpectation;
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0]?.readyState).toBe(FakeWebSocket.CLOSED);

    FakeWebSocket.autoOpen = true;
    const retryConnect = client.connect(handshake);
    await vi.advanceTimersByTimeAsync(0);

    const retrySocket = FakeWebSocket.instances[1];
    expect(retrySocket).toBeTruthy();
    retrySocket.emit("message", {
      data: JSON.stringify({ type: "handshakeAck", payload: { instanceId: "relay-2", relayPort: 8787, pairingRequired: false } })
    });

    await expect(retryConnect).resolves.toMatchObject({
      payload: { instanceId: "relay-2", relayPort: 8787, pairingRequired: false }
    });
  });
});
