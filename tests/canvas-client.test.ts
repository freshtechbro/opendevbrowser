import { EventEmitter } from "events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer } from "ws";
import type { AddressInfo } from "net";
import { WebSocket } from "ws";
import { CanvasClient } from "../src/browser/canvas-client";

class FakeSocket extends EventEmitter {
  readyState = WebSocket.OPEN;
  sent: string[] = [];
  closeCalls: Array<{ code?: number; reason?: string }> = [];

  constructor(private readonly onSend?: (payload: string) => void) {
    super();
  }

  send(payload: string): void {
    if (this.onSend) {
      this.onSend(payload);
      return;
    }
    this.sent.push(payload);
  }

  close(code?: number, reason?: string): void {
    this.readyState = WebSocket.CLOSED;
    this.closeCalls.push({ code, reason });
  }
}

type PrivateCanvasClient = {
  socket: FakeSocket | null;
  connectPromise: Promise<unknown> | null;
  pendingRequests: Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timeoutId: NodeJS.Timeout }>;
  pendingChunks: Map<string, { totalChunks: number; chunks: string[] }>;
  pendingPings: Map<string, { resolve: () => void; reject: (error: Error) => void; timeoutId: NodeJS.Timeout }>;
  heartbeatTimer: NodeJS.Timeout | null;
  missedPongs: number;
  handleMessage: (data: WebSocket.RawData) => void;
  handleClose: (detail?: { code?: number; reason?: string }) => void;
  startHeartbeat: () => void;
  sendPing: () => Promise<void>;
  send: (payload: unknown) => void;
  sendRaw: (payload: string) => void;
};

const internals = (client: CanvasClient): PrivateCanvasClient => client as unknown as PrivateCanvasClient;

describe("CanvasClient", () => {
  let server: WebSocketServer | null = null;
  let baseUrl = "";

  beforeEach(async () => {
    server = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => server?.once("listening", () => resolve()));
    const address = server.address() as AddressInfo;
    baseUrl = `ws://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = null;
  });

  it("connects, receives events, and sends requests", async () => {
    const onEvent = vi.fn();
    server?.on("connection", (socket) => {
      socket.on("message", (data) => {
        const message = JSON.parse(String(data)) as Record<string, unknown>;
        if (message.type === "canvas_hello") {
          socket.send(JSON.stringify({
            type: "canvas_hello_ack",
            version: "1",
            maxPayloadBytes: 1024
          }));
          socket.send(JSON.stringify({
            type: "canvas_event",
            event: "canvas_feedback_item",
            payload: { id: "fb_1" }
          }));
          return;
        }
        if (message.type === "canvas_ping") {
          socket.send(JSON.stringify({
            type: "canvas_pong",
            id: message.id
          }));
          return;
        }
        if (message.type === "canvas_request") {
          socket.send(JSON.stringify({
            type: "canvas_response",
            requestId: message.requestId,
            payload: { ok: true, echoed: message.payload }
          }));
        }
      });
    });

    const client = new CanvasClient(baseUrl, {
      pingIntervalMs: 50,
      pingTimeoutMs: 50,
      onEvent
    });
    await client.connect();
    const result = await client.request<{ ok: boolean; echoed: unknown }>("canvas.overlay.mount", { targetId: "tab-1" });
    expect(result).toEqual({ ok: true, echoed: { targetId: "tab-1" } });
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ event: "canvas_feedback_item" }));
    client.disconnect();
  });

  it("attaches a steady-state socket error listener after connect", async () => {
    server?.on("connection", (socket) => {
      socket.on("message", (data) => {
        const message = JSON.parse(String(data)) as Record<string, unknown>;
        if (message.type === "canvas_hello") {
          socket.send(JSON.stringify({
            type: "canvas_hello_ack",
            version: "1",
            maxPayloadBytes: 1024
          }));
        }
      });
    });

    const client = new CanvasClient(baseUrl, { autoReconnect: false });
    await client.connect();
    expect(internals(client).socket?.listenerCount("error")).toBeGreaterThan(0);
    client.disconnect();
  });

  it("reassembles chunked responses", async () => {
    server?.on("connection", (socket) => {
      socket.on("message", (data) => {
        const message = JSON.parse(String(data)) as Record<string, unknown>;
        if (message.type === "canvas_hello") {
          socket.send(JSON.stringify({
            type: "canvas_hello_ack",
            version: "1",
            maxPayloadBytes: 1024
          }));
          return;
        }
        if (message.type === "canvas_request") {
          const payload = JSON.stringify({ status: "chunked", command: message.command });
          socket.send(JSON.stringify({
            type: "canvas_response",
            requestId: message.requestId,
            chunked: true,
            totalChunks: 2
          }));
          socket.send(JSON.stringify({
            type: "canvas_chunk",
            requestId: message.requestId,
            payloadId: "payload-1",
            chunkIndex: 0,
            totalChunks: 2,
            data: payload.slice(0, Math.ceil(payload.length / 2))
          }));
          socket.send(JSON.stringify({
            type: "canvas_chunk",
            requestId: message.requestId,
            payloadId: "payload-1",
            chunkIndex: 1,
            totalChunks: 2,
            data: payload.slice(Math.ceil(payload.length / 2))
          }));
        }
      });
    });

    const client = new CanvasClient(baseUrl, { autoReconnect: false });
    await client.connect();
    await expect(client.request("canvas.preview.refresh", { refreshMode: "full" })).resolves.toEqual({
      status: "chunked",
      command: "canvas.preview.refresh"
    });
    client.disconnect();
  });

  it("surfaces canvas errors", async () => {
    let serverSocket: { close: () => void } | null = null;
    server?.on("connection", (socket) => {
      serverSocket = socket;
      socket.on("message", (data) => {
        const message = JSON.parse(String(data)) as Record<string, unknown>;
        if (message.type === "canvas_hello") {
          socket.send(JSON.stringify({
            type: "canvas_hello_ack",
            version: "1",
            maxPayloadBytes: 1024
          }));
          return;
        }
        if (message.type === "canvas_request") {
          socket.send(JSON.stringify({
            type: "canvas_error",
            requestId: message.requestId,
            error: {
              code: "plan_required",
              message: "generationPlan must be accepted before mutation.",
              retryable: false
            }
          }));
        }
      });
    });

    const onClose = vi.fn();
    const client = new CanvasClient(baseUrl, {
      autoReconnect: false,
      onClose
    });
    await client.connect();
    await expect(client.request("canvas.document.patch", { patches: [] })).rejects.toThrow("[plan_required]");
    serverSocket?.close();
    await new Promise((resolve) => setTimeout(resolve, 25));
    client.disconnect();
    expect(onClose).toHaveBeenCalled();
  });

  it("fails the handshake on protocol errors or timeouts", async () => {
    server?.removeAllListeners("connection");
    let mode: "error" | "timeout" = "error";
    const handshakeTimeoutMs = 250;
    server?.on("connection", (socket) => {
      socket.on("message", (data) => {
        const message = JSON.parse(String(data)) as Record<string, unknown>;
        if (message.type !== "canvas_hello") {
          return;
        }
        if (mode === "error") {
          socket.send(JSON.stringify({
            type: "canvas_error",
            requestId: "canvas_hello",
            error: {
              code: "canvas_denied",
              message: "Denied by relay",
              retryable: false
            }
          }));
        }
      });
    });

    const errorClient = new CanvasClient(baseUrl, {
      autoReconnect: false,
      handshakeTimeoutMs
    });
    await expect(errorClient.connect()).rejects.toThrow("[canvas_denied] Denied by relay");
    errorClient.disconnect();

    mode = "timeout";
    const timeoutClient = new CanvasClient(baseUrl, {
      autoReconnect: false,
      handshakeTimeoutMs
    });
    await expect(timeoutClient.connect()).rejects.toThrow("Canvas handshake timeout");
    timeoutClient.disconnect();
  });

  it("reuses in-flight connects and covers handshake edge paths", async () => {
    const ack = {
      type: "canvas_hello_ack",
      version: "1",
      maxPayloadBytes: 1024
    } as const;

    const concurrentClient = new CanvasClient(baseUrl, { autoReconnect: false });
    let helloCount = 0;
    const concurrentSocket = new FakeSocket((payload) => {
      const message = JSON.parse(payload) as Record<string, unknown>;
      if (message.type === "canvas_hello") {
        helloCount += 1;
        setTimeout(() => concurrentSocket.emit("canvas_hello_ack", ack), 0);
      }
    });
    internals(concurrentClient).socket = concurrentSocket;

    const firstConnect = concurrentClient.connect();
    const secondConnect = concurrentClient.connect();
    const firstResult = await firstConnect;
    const secondResult = await secondConnect;
    expect(firstResult).toEqual(ack);
    expect(secondResult).toEqual(ack);
    expect(helloCount).toBe(1);
    internals(concurrentClient).startHeartbeat();
    expect(internals(concurrentClient).heartbeatTimer).not.toBeNull();
    concurrentClient.disconnect();

    const replacedPromiseClient = new CanvasClient(baseUrl, { autoReconnect: false });
    const replacedSocket = new FakeSocket((payload) => {
      const message = JSON.parse(payload) as Record<string, unknown>;
      if (message.type === "canvas_hello") {
        queueMicrotask(() => replacedSocket.emit("canvas_hello_ack", ack));
      }
    });
    internals(replacedPromiseClient).socket = replacedSocket;
    const replacedPromise = replacedPromiseClient.connect();
    internals(replacedPromiseClient).connectPromise = Promise.resolve("external");
    await expect(replacedPromise).resolves.toEqual(ack);
    expect(internals(replacedPromiseClient).connectPromise).not.toBeNull();
    internals(replacedPromiseClient).connectPromise = null;
    replacedPromiseClient.disconnect();

    const handshakeFailureClient = new CanvasClient(baseUrl, { autoReconnect: false });
    internals(handshakeFailureClient).socket = new FakeSocket(() => {
      throw "bad hello";
    });
    await expect(handshakeFailureClient.connect()).rejects.toThrow("Canvas handshake failed");
    handshakeFailureClient.disconnect();

    const errorHandshakeClient = new CanvasClient(baseUrl, { autoReconnect: false });
    internals(errorHandshakeClient).socket = new FakeSocket(() => {
      throw new Error("hello exploded");
    });
    await expect(errorHandshakeClient.connect()).rejects.toThrow("hello exploded");
    errorHandshakeClient.disconnect();
  });

  it("handles malformed messages and orphaned protocol frames", async () => {
    const onEvent = vi.fn();
    const client = new CanvasClient(baseUrl, { autoReconnect: false, onEvent });
    const socket = new FakeSocket();
    internals(client).socket = socket;

    let requestResolved: unknown = null;
    let requestRejected: Error | null = null;
    let chunkResolved: unknown = null;
    let nullResolved: unknown = "unset";
    let emptyChunkResolved: unknown = "unset";
    let pingResolved = false;
    const requestTimeout = setTimeout(() => undefined, 1000);
    const chunkTimeout = setTimeout(() => undefined, 1000);
    const nullTimeout = setTimeout(() => undefined, 1000);
    const emptyChunkTimeout = setTimeout(() => undefined, 1000);
    const invalidErrorTimeout = setTimeout(() => undefined, 1000);
    const zeroChunkTimeout = setTimeout(() => undefined, 1000);
    const pingTimeout = setTimeout(() => undefined, 1000);

    internals(client).pendingRequests.set("req_error", {
      resolve: () => undefined,
      reject: (error) => { requestRejected = error; },
      timeoutId: requestTimeout
    });
    internals(client).pendingRequests.set("req_ok", {
      resolve: (value) => { requestResolved = value; },
      reject: () => undefined,
      timeoutId: chunkTimeout
    });
    internals(client).pendingRequests.set("req_chunk", {
      resolve: (value) => { chunkResolved = value; },
      reject: () => undefined,
      timeoutId: setTimeout(() => undefined, 1000)
    });
    internals(client).pendingRequests.set("req_null", {
      resolve: (value) => { nullResolved = value; },
      reject: () => undefined,
      timeoutId: nullTimeout
    });
    internals(client).pendingRequests.set("req_empty_chunk", {
      resolve: (value) => { emptyChunkResolved = value; },
      reject: () => undefined,
      timeoutId: emptyChunkTimeout
    });
    internals(client).pendingRequests.set("req_invalid_error", {
      resolve: () => undefined,
      reject: () => undefined,
      timeoutId: invalidErrorTimeout
    });
    internals(client).pendingRequests.set("req_zero_chunk", {
      resolve: () => undefined,
      reject: () => undefined,
      timeoutId: zeroChunkTimeout
    });
    internals(client).pendingPings.set("ping-1", {
      resolve: () => { pingResolved = true; },
      reject: () => undefined,
      timeoutId: pingTimeout
    });
    internals(client).missedPongs = 2;

    internals(client).handleMessage(Buffer.from("{"));
    internals(client).handleMessage(Buffer.from("1"));
    internals(client).handleMessage(Buffer.from(JSON.stringify({ type: "canvas_response", requestId: "req_missing", payload: { ignored: true } })));
    internals(client).handleMessage(Buffer.from(JSON.stringify({ type: "canvas_response" })));
    internals(client).handleMessage(Buffer.from(JSON.stringify({ type: "canvas_chunk", requestId: "req_missing", chunkIndex: 0, totalChunks: 1, data: "x" })));
    internals(client).handleMessage(Buffer.from(JSON.stringify({ type: "canvas_chunk", requestId: "req_invalid_chunk", chunkIndex: 0, totalChunks: 1, data: 1 })));
    internals(client).handleMessage(Buffer.from(JSON.stringify({ type: "canvas_event" })));
    internals(client).handleMessage(Buffer.from(JSON.stringify({ type: "canvas_pong", id: "unknown" })));
    internals(client).handleMessage(Buffer.from(JSON.stringify({ type: "canvas_pong", id: 99 })));
    internals(client).handleMessage(Buffer.from(JSON.stringify({
      type: "canvas_error",
      error: {
        code: "plan_required",
        message: "Missing request id",
        retryable: false
      }
    })));
    internals(client).handleMessage(Buffer.from(JSON.stringify({
      type: "canvas_error",
      requestId: "req_invalid_error",
      error: "invalid"
    })));

    internals(client).handleMessage(Buffer.from(JSON.stringify({
      type: "canvas_error",
      requestId: "req_error",
      error: {
        code: "plan_required",
        message: "Plan is required",
        retryable: false
      }
    })));
    expect(requestRejected?.message).toBe("[plan_required] Plan is required");

    internals(client).handleMessage(Buffer.from(JSON.stringify({
      type: "canvas_response",
      requestId: "req_ok",
      payload: { ok: true }
    })));
    expect(requestResolved).toEqual({ ok: true });
    internals(client).handleMessage(Buffer.from(JSON.stringify({
      type: "canvas_response",
      requestId: "req_null"
    })));
    expect(nullResolved).toBeNull();

    internals(client).handleMessage(Buffer.from(JSON.stringify({
      type: "canvas_response",
      requestId: "req_chunk",
      chunked: true,
      totalChunks: 2
    })));
    internals(client).handleMessage(Buffer.from(JSON.stringify({
      type: "canvas_response",
      requestId: "req_zero_chunk",
      chunked: true
    })));
    internals(client).handleMessage(Buffer.from(JSON.stringify({
      type: "canvas_response",
      requestId: "req_empty_chunk",
      chunked: true,
      totalChunks: 0
    })));
    internals(client).handleMessage(Buffer.from(JSON.stringify({
      type: "canvas_chunk",
      requestId: "req_chunk",
      payloadId: "payload-1",
      chunkIndex: 0,
      totalChunks: 2,
      data: "{\"ok\":"
    })));
    internals(client).handleMessage(Buffer.from(JSON.stringify({
      type: "canvas_chunk",
      requestId: "req_chunk",
      payloadId: "payload-1",
      chunkIndex: 1,
      totalChunks: 2,
      data: "true}"
    })));
    expect(chunkResolved).toEqual({ ok: true });
    internals(client).handleMessage(Buffer.from(JSON.stringify({
      type: "canvas_chunk",
      requestId: "req_empty_chunk",
      payloadId: "payload-empty",
      chunkIndex: 0,
      totalChunks: 0,
      data: ""
    })));
    expect(emptyChunkResolved).toBeNull();

    internals(client).handleMessage(Buffer.from(JSON.stringify({
      type: "canvas_event",
      event: "canvas_feedback_item",
      payload: { id: "fb_1" }
    })));
    internals(client).handleMessage(JSON.stringify({
      type: "canvas_event",
      event: "canvas_feedback_item",
      payload: { id: "fb_2" }
    }) as unknown as WebSocket.RawData);
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ event: "canvas_feedback_item" }));

    internals(client).handleMessage(Buffer.from(JSON.stringify({
      type: "canvas_pong",
      id: "ping-1"
    })));
    expect(pingResolved).toBe(true);
    expect(internals(client).missedPongs).toBe(0);

    clearTimeout(requestTimeout);
    clearTimeout(chunkTimeout);
    clearTimeout(nullTimeout);
    clearTimeout(emptyChunkTimeout);
    clearTimeout(invalidErrorTimeout);
    clearTimeout(zeroChunkTimeout);
    clearTimeout(pingTimeout);
    internals(client).pendingRequests.delete("req_invalid_error");
    internals(client).pendingRequests.delete("req_zero_chunk");
  });

  it("guards oversized requests, request timeouts, and send failures", async () => {
    vi.useFakeTimers();
    try {
      const oversizedClient = new CanvasClient(baseUrl, { autoReconnect: false, maxPayloadBytes: 80 });
      internals(oversizedClient).socket = new FakeSocket();
      await expect(oversizedClient.request("canvas.preview.render", {
        content: "x".repeat(512)
      }, "canvas_1")).rejects.toThrow("Canvas request payload exceeded max size");

      const timeoutClient = new CanvasClient(baseUrl, { autoReconnect: false });
      internals(timeoutClient).socket = new FakeSocket();
      const timeoutPromise = timeoutClient.request("canvas.preview.render", { ok: true }, "canvas_2", 5);
      const timeoutExpectation = expect(timeoutPromise).rejects.toThrow("Canvas request timed out");
      await vi.advanceTimersByTimeAsync(5);
      await timeoutExpectation;

      const failingClient = new CanvasClient(baseUrl, { autoReconnect: false });
      internals(failingClient).socket = new FakeSocket(() => {
        throw "socket send failed";
      });
      await expect(failingClient.request("canvas.preview.render", { ok: true }, "canvas_3", 5)).rejects.toThrow("Canvas send failed");

      const errorFailingClient = new CanvasClient(baseUrl, { autoReconnect: false });
      internals(errorFailingClient).socket = new FakeSocket(() => {
        throw new Error("socket send exploded");
      });
      await expect(errorFailingClient.request("canvas.preview.render", { ok: true }, "canvas_5", 5)).rejects.toThrow("socket send exploded");

      const autoConnectClient = new CanvasClient(baseUrl, { autoReconnect: false });
      const connectSpy = vi.spyOn(autoConnectClient, "connect").mockImplementation(async () => {
        const autoSocket = new FakeSocket((payload) => {
          const message = JSON.parse(payload) as Record<string, unknown>;
          if (message.type === "canvas_request") {
            queueMicrotask(() => {
              internals(autoConnectClient).handleMessage(Buffer.from(JSON.stringify({
                type: "canvas_response",
                requestId: message.requestId,
                payload: { ok: true }
              })));
            });
          }
        });
        internals(autoConnectClient).socket = autoSocket;
        return {
          type: "canvas_hello_ack",
          version: "1",
          maxPayloadBytes: 1024
        } as never;
      });
      await expect(autoConnectClient.request("canvas.preview.render", { ok: true }, "canvas_4", 5)).resolves.toEqual({ ok: true });
      expect(connectSpy).toHaveBeenCalledTimes(1);

      const disconnectedClient = new CanvasClient(baseUrl, { autoReconnect: false });
      expect(() => internals(disconnectedClient).send({ type: "canvas_ping" })).toThrow("Canvas socket not connected");
      expect(() => internals(disconnectedClient).sendRaw("{}")).toThrow("Canvas socket not connected");
    } finally {
      vi.useRealTimers();
    }
  });

  it("times out heartbeats and schedules reconnects when enabled", async () => {
    vi.useFakeTimers();
    try {
      const reconnectClient = new CanvasClient(baseUrl, {
        autoReconnect: true,
        reconnectBaseDelayMs: 5,
        reconnectMaxDelayMs: 5
      });
      const reconnectSocket = new FakeSocket();
      internals(reconnectClient).socket = reconnectSocket;
      const connectSpy = vi.spyOn(reconnectClient, "connect").mockResolvedValue({
        type: "canvas_hello_ack",
        version: "1",
        maxPayloadBytes: 1024
      } as never);

      internals(reconnectClient).handleClose({ code: 1006, reason: "lost" });
      await vi.advanceTimersByTimeAsync(5);
      expect(connectSpy).toHaveBeenCalled();

      const heartbeatClient = new CanvasClient(baseUrl, {
        autoReconnect: false,
        pingTimeoutMs: 5,
        maxMissedPongs: 0
      });
      const heartbeatSocket = new FakeSocket();
      internals(heartbeatClient).socket = heartbeatSocket;
      const heartbeatPromise = internals(heartbeatClient).sendPing();
      const heartbeatExpectation = expect(heartbeatPromise).rejects.toThrow("Canvas ping timed out");
      await vi.advanceTimersByTimeAsync(5);
      await heartbeatExpectation;
      expect(heartbeatSocket.closeCalls).toEqual([{ code: 1011, reason: "Canvas heartbeat timed out" }]);

      const tolerantHeartbeatClient = new CanvasClient(baseUrl, {
        autoReconnect: false,
        pingTimeoutMs: 5,
        maxMissedPongs: 5
      });
      const tolerantSocket = new FakeSocket();
      internals(tolerantHeartbeatClient).socket = tolerantSocket;
      const tolerantPromise = internals(tolerantHeartbeatClient).sendPing();
      const tolerantExpectation = expect(tolerantPromise).rejects.toThrow("Canvas ping timed out");
      await vi.advanceTimersByTimeAsync(5);
      await tolerantExpectation;
      expect(tolerantSocket.closeCalls).toEqual([]);

      const idlePingClient = new CanvasClient(baseUrl, { autoReconnect: false });
      await expect(internals(idlePingClient).sendPing()).resolves.toBeUndefined();
      const closedSocket = new FakeSocket();
      closedSocket.readyState = WebSocket.CLOSED;
      internals(idlePingClient).socket = closedSocket;
      await expect(internals(idlePingClient).sendPing()).resolves.toBeUndefined();

      const pingFailureClient = new CanvasClient(baseUrl, { autoReconnect: false });
      internals(pingFailureClient).socket = new FakeSocket(() => {
        throw "bad ping";
      });
      await expect(internals(pingFailureClient).sendPing()).rejects.toThrow("Canvas ping failed");

      const errorPingClient = new CanvasClient(baseUrl, { autoReconnect: false });
      internals(errorPingClient).socket = new FakeSocket(() => {
        throw new Error("bad ping error");
      });
      await expect(internals(errorPingClient).sendPing()).rejects.toThrow("bad ping error");

      const connectingClient = new CanvasClient(baseUrl, { autoReconnect: false });
      const connectingSocket = new FakeSocket();
      connectingSocket.readyState = WebSocket.CONNECTING;
      internals(connectingClient).socket = connectingSocket;
      connectingClient.disconnect();
      expect(connectingSocket.closeCalls).toEqual([{ code: 1000, reason: "Canvas disconnect" }]);

      const clearTimerClient = new CanvasClient(baseUrl, {
        autoReconnect: true,
        reconnectBaseDelayMs: 50,
        reconnectMaxDelayMs: 50
      });
      internals(clearTimerClient).handleClose({ code: 1006, reason: "retry" });
      clearTimerClient.disconnect();
      await vi.advanceTimersByTimeAsync(50);

      const heartbeatStartClient = new CanvasClient(baseUrl, {
        autoReconnect: false,
        pingIntervalMs: 50
      });
      const sendPingSpy = vi.spyOn(internals(heartbeatStartClient), "sendPing").mockResolvedValue(undefined);
      internals(heartbeatStartClient).startHeartbeat();
      const heartbeatTimer = internals(heartbeatStartClient).heartbeatTimer;
      internals(heartbeatStartClient).startHeartbeat();
      expect(internals(heartbeatStartClient).heartbeatTimer).toBe(heartbeatTimer);
      await vi.advanceTimersByTimeAsync(50);
      expect(sendPingSpy).toHaveBeenCalledTimes(1);
      heartbeatStartClient.disconnect();

      connectSpy.mockRestore();
      sendPingSpy.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });
});
