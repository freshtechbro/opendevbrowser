import { describe, it, expect, afterEach, vi } from "vitest";
import { WebSocketServer, WebSocket } from "ws";
import type { AddressInfo } from "net";
import { OpsClient } from "../src/browser/ops-client";

type TestServer = {
  wss: WebSocketServer;
  url: string;
};

const createServer = async (handler: (socket: WebSocket, data: string) => void): Promise<TestServer> => {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise<void>((resolve) => wss.once("listening", resolve));
  wss.on("connection", (socket) => {
    socket.on("message", (data) => {
      const text = typeof data === "string" ? data : data.toString();
      handler(socket as WebSocket, text);
    });
  });
  const address = wss.address() as AddressInfo;
  return { wss, url: `ws://127.0.0.1:${address.port}` };
};

const send = (socket: WebSocket, payload: Record<string, unknown>): void => {
  socket.send(JSON.stringify(payload));
};

describe("OpsClient", () => {
  afterEach(async () => {
    // noop placeholder to keep vitest happy about open handles
  });

  it("handshakes and resolves ops responses", async () => {
    const server = await createServer((socket, raw) => {
      const message = JSON.parse(raw) as Record<string, unknown>;
      if (message.type === "ops_hello") {
        send(socket, { type: "ops_hello_ack", version: "1", clientId: "client-1", maxPayloadBytes: 1024, capabilities: [] });
      }
      if (message.type === "ops_request") {
        send(socket, { type: "ops_response", requestId: message.requestId, payload: { ok: true } });
      }
      if (message.type === "ops_ping") {
        send(socket, { type: "ops_pong", id: message.id });
      }
    });

    const client = new OpsClient(server.url, { pingIntervalMs: 100000 });
    const result = await client.request<{ ok: boolean }>("session.status", {});
    expect(result).toEqual({ ok: true });

    client.disconnect();
    await new Promise((resolve) => server.wss.close(() => resolve(null)));
  });

  it("shares a connect promise for concurrent callers", async () => {
    const server = await createServer((socket, raw) => {
      const message = JSON.parse(raw) as Record<string, unknown>;
      if (message.type === "ops_hello") {
        send(socket, { type: "ops_hello_ack", version: "1", clientId: "client-14", maxPayloadBytes: 1024, capabilities: [] });
      }
    });

    const client = new OpsClient(server.url, { pingIntervalMs: 100000 });
    const [ack1, ack2] = await Promise.all([client.connect(), client.connect()]);
    expect(ack1.clientId).toBe("client-14");
    expect(ack2.clientId).toBe("client-14");

    client.disconnect();
    await new Promise((resolve) => server.wss.close(() => resolve(null)));
  });

  it("keeps a replaced connect promise after connect resolves", async () => {
    const server = await createServer((socket, raw) => {
      const message = JSON.parse(raw) as Record<string, unknown>;
      if (message.type === "ops_hello") {
        send(socket, { type: "ops_hello_ack", version: "1", clientId: "client-15", maxPayloadBytes: 1024, capabilities: [] });
      }
    });

    const client = new OpsClient(server.url, { pingIntervalMs: 100000 });
    const connectPromise = client.connect();
    const replacement = Promise.resolve({ type: "ops_hello_ack", version: "1", clientId: "replacement", maxPayloadBytes: 1024, capabilities: [] });
    (client as unknown as { connectPromise: Promise<unknown> | null }).connectPromise = replacement;

    const ack = await connectPromise;
    expect(ack.clientId).toBe("client-15");
    expect((client as unknown as { connectPromise: Promise<unknown> | null }).connectPromise).toBe(replacement);

    (client as unknown as { connectPromise: Promise<unknown> | null }).connectPromise = null;
    client.disconnect();
    await new Promise((resolve) => server.wss.close(() => resolve(null)));
  });
  it("reassembles chunked responses", async () => {
    const payload = { ok: true, value: "chunked" };
    const serialized = JSON.stringify(payload);
    const midpoint = Math.ceil(serialized.length / 2);
    const chunks = [serialized.slice(0, midpoint), serialized.slice(midpoint)];

    const server = await createServer((socket, raw) => {
      const message = JSON.parse(raw) as Record<string, unknown>;
      if (message.type === "ops_hello") {
        send(socket, { type: "ops_hello_ack", version: "1", clientId: "client-2", maxPayloadBytes: 1024, capabilities: [] });
      }
      if (message.type === "ops_request") {
        send(socket, {
          type: "ops_response",
          requestId: message.requestId,
          payloadId: "payload-1",
          totalChunks: 2,
          chunked: true
        });
        send(socket, { type: "ops_chunk", requestId: message.requestId, payloadId: "payload-1", chunkIndex: 0, totalChunks: 2, data: chunks[0] });
        send(socket, { type: "ops_chunk", requestId: message.requestId, payloadId: "payload-1", chunkIndex: 1, totalChunks: 2, data: chunks[1] });
      }
    });

    const client = new OpsClient(server.url, { pingIntervalMs: 100000 });
    const result = await client.request<typeof payload>("session.status", {});
    expect(result).toEqual(payload);

    client.disconnect();
    await new Promise((resolve) => server.wss.close(() => resolve(null)));
  });

  it("resolves empty chunked payloads as null", () => {
    const client = new OpsClient("ws://127.0.0.1:0");
    const resolve = vi.fn();
    const timeoutId = setTimeout(() => {}, 1000);
    (client as unknown as { pendingRequests: Map<string, unknown> }).pendingRequests.set("req-empty", {
      resolve,
      reject: vi.fn(),
      timeoutId
    });
    (client as unknown as { pendingChunks: Map<string, unknown> }).pendingChunks.set("payload-empty", {
      requestId: "req-empty",
      totalChunks: 0,
      chunks: []
    });

    (client as unknown as { handleMessage: (data: Buffer) => void }).handleMessage(
      Buffer.from(JSON.stringify({ type: "ops_chunk", payloadId: "payload-empty", chunkIndex: 0, totalChunks: 0, data: "" }))
    );

    clearTimeout(timeoutId);
    expect(resolve).toHaveBeenCalledWith(null);
  });

  it("reuses an open socket on subsequent connects", async () => {
    let helloCount = 0;
    const server = await createServer((socket, raw) => {
      const message = JSON.parse(raw) as Record<string, unknown>;
      if (message.type === "ops_hello") {
        helloCount += 1;
        send(socket, { type: "ops_hello_ack", version: "1", clientId: "client-19", maxPayloadBytes: 1024, capabilities: [] });
      }
    });

    const client = new OpsClient(server.url, { pingIntervalMs: 100000 });
    await client.connect();
    await client.connect();

    expect(helloCount).toBe(2);

    client.disconnect();
    await new Promise((resolve) => server.wss.close(() => resolve(null)));
  });
  it("rejects ops_error responses", async () => {
    const server = await createServer((socket, raw) => {
      const message = JSON.parse(raw) as Record<string, unknown>;
      if (message.type === "ops_hello") {
        send(socket, { type: "ops_hello_ack", version: "1", clientId: "client-3", maxPayloadBytes: 1024, capabilities: [] });
      }
      if (message.type === "ops_request") {
        send(socket, {
          type: "ops_error",
          requestId: message.requestId,
          error: { code: "not_supported", message: "Nope", retryable: false }
        });
      }
    });

    const client = new OpsClient(server.url, { pingIntervalMs: 100000 });
    await expect(client.request("session.status", {})).rejects.toThrow("[not_supported] Nope");

    client.disconnect();
    await new Promise((resolve) => server.wss.close(() => resolve(null)));
  });

  it("times out when handshake ack is missing", async () => {
    const server = await createServer((_socket, _raw) => {
      // Intentionally ignore ops_hello.
    });

    const client = new OpsClient(server.url, { handshakeTimeoutMs: 50, pingIntervalMs: 100000 });
    await expect(client.connect()).rejects.toThrow("Ops handshake timeout");

    client.disconnect();
    await new Promise((resolve) => server.wss.close(() => resolve(null)));
  });

  it("rejects when ops_hello returns not_supported", async () => {
    const server = await createServer((socket, raw) => {
      const message = JSON.parse(raw) as Record<string, unknown>;
      if (message.type === "ops_hello") {
        send(socket, {
          type: "ops_error",
          requestId: "ops_hello",
          error: { code: "not_supported", message: "Unsupported ops protocol version.", retryable: false, details: { supported: ["1"] } }
        });
      }
    });

    const client = new OpsClient(server.url, { handshakeTimeoutMs: 200, pingIntervalMs: 100000 });
    await expect(client.connect()).rejects.toThrow("[not_supported] Unsupported ops protocol version.");

    client.disconnect();
    await new Promise((resolve) => server.wss.close(() => resolve(null)));
  });

  it("rejects when hello send fails", async () => {
    const server = await createServer((_socket, _raw) => {
      // no-op
    });

    const client = new OpsClient(server.url, { pingIntervalMs: 100000 });
    (client as unknown as { send: () => void }).send = () => {
      throw new Error("send-failed");
    };

    await expect(client.connect()).rejects.toThrow("send-failed");

    client.disconnect();
    await new Promise((resolve) => server.wss.close(() => resolve(null)));
  });

  it("rejects when hello send throws non-errors", async () => {
    const server = await createServer((_socket, _raw) => {
      // no-op
    });

    const client = new OpsClient(server.url, { pingIntervalMs: 100000 });
    (client as unknown as { send: () => void }).send = () => {
      throw "handshake-failed";
    };

    await expect(client.connect()).rejects.toThrow("Ops handshake failed");

    client.disconnect();
    await new Promise((resolve) => server.wss.close(() => resolve(null)));
  });

  it("rejects when socket fails to open", async () => {
    const client = new OpsClient("ws://127.0.0.1:1", { handshakeTimeoutMs: 50, pingIntervalMs: 100000 });
    await expect(client.connect()).rejects.toBeInstanceOf(Error);
    client.disconnect();
  });

  it("rejects when socket assignment fails", async () => {
    const server = await createServer((_socket, _raw) => {
      // no-op
    });
    const client = new OpsClient(server.url, { pingIntervalMs: 100000 });
    let createdSocket: WebSocket | null = null;
    Object.defineProperty(client, "socket", {
      get: () => null,
      set: (value) => {
        createdSocket = value as WebSocket;
      },
      configurable: true
    });

    await expect(client.connect()).rejects.toThrow("Ops socket not created");

    if (createdSocket) {
      createdSocket.on("error", () => {});
      if (createdSocket.readyState === WebSocket.CONNECTING) {
        createdSocket.close();
      } else if (createdSocket.readyState === WebSocket.OPEN) {
        createdSocket.terminate();
      }
    }
    await new Promise((resolve) => server.wss.close(() => resolve(null)));
  });

  it("rejects when socket closes before handshake ack", async () => {
    const server = await createServer((socket, raw) => {
      const message = JSON.parse(raw) as Record<string, unknown>;
      if (message.type === "ops_hello") {
        socket.close(1000, "bye");
      }
    });

    const client = new OpsClient(server.url, { handshakeTimeoutMs: 500, pingIntervalMs: 100000 });
    await expect(client.connect()).rejects.toThrow("Ops socket closed before handshake");

    client.disconnect();
    await new Promise((resolve) => server.wss.close(() => resolve(null)));
  });

  it("fails when sending without an open socket", () => {
    const client = new OpsClient("ws://127.0.0.1:0");
    expect(() => (client as unknown as { sendRaw: (payload: string) => void }).sendRaw("noop")).toThrow("Ops socket not connected");
  });

  it("disconnects safely when no socket exists", () => {
    const client = new OpsClient("ws://127.0.0.1:0");
    expect(() => client.disconnect()).not.toThrow();
  });

  it("closeSocket no-ops when socket is missing", () => {
    const client = new OpsClient("ws://127.0.0.1:0");
    expect(() =>
      (client as unknown as { closeSocket: (code: number, reason: string, allowReconnect: boolean) => void }).closeSocket(1000, "bye", false)
    ).not.toThrow();
  });

  it("no-ops ping when socket is not open", async () => {
    const client = new OpsClient("ws://127.0.0.1:0");
    await expect((client as unknown as { sendPing: () => Promise<void> }).sendPing()).resolves.toBeUndefined();
  });

  it("resolves pings when pong arrives", async () => {
    const server = await createServer((socket, raw) => {
      const message = JSON.parse(raw) as Record<string, unknown>;
      if (message.type === "ops_hello") {
        send(socket, { type: "ops_hello_ack", version: "1", clientId: "client-10", maxPayloadBytes: 1024, capabilities: [] });
      }
      if (message.type === "ops_ping") {
        send(socket, { type: "ops_pong", id: message.id });
      }
    });

    const client = new OpsClient(server.url, { pingIntervalMs: 100000, pingTimeoutMs: 50 });
    await client.connect();
    await expect((client as unknown as { sendPing: () => Promise<void> }).sendPing()).resolves.toBeUndefined();

    client.disconnect();
    await new Promise((resolve) => server.wss.close(() => resolve(null)));
  });

  it("closes the socket when heartbeat misses exceed the threshold", async () => {
    const server = await createServer((socket, raw) => {
      const message = JSON.parse(raw) as Record<string, unknown>;
      if (message.type === "ops_hello") {
        send(socket, { type: "ops_hello_ack", version: "1", clientId: "client-11", maxPayloadBytes: 1024, capabilities: [] });
      }
      // Ignore ops_ping to force timeout.
    });

    const client = new OpsClient(server.url, { pingIntervalMs: 10, pingTimeoutMs: 10, maxMissedPongs: 1 });
    const closeSpy = vi.spyOn(client as unknown as { closeSocket: (code: number, reason: string, allowReconnect: boolean) => void }, "closeSocket");
    await client.connect();

    await vi.waitFor(() => {
      expect(closeSpy).toHaveBeenCalledWith(1011, "Ops heartbeat missed", true);
    }, { timeout: 800, interval: 25 });

    client.disconnect();
    await new Promise((resolve) => server.wss.close(() => resolve(null)));
  });

  it("rejects when ping times out", async () => {
    const server = await createServer((socket, raw) => {
      const message = JSON.parse(raw) as Record<string, unknown>;
      if (message.type === "ops_hello") {
        send(socket, { type: "ops_hello_ack", version: "1", clientId: "client-4", maxPayloadBytes: 1024, capabilities: [] });
      }
      // Intentionally ignore ops_ping.
    });

    const client = new OpsClient(server.url, { pingIntervalMs: 100000, pingTimeoutMs: 50 });
    await client.connect();
    await expect((client as unknown as { sendPing: () => Promise<void> }).sendPing()).rejects.toThrow("Ops ping timed out");

    client.disconnect();
    await new Promise((resolve) => server.wss.close(() => resolve(null)));
  });

  it("rejects when ping send fails", async () => {
    const server = await createServer((socket, raw) => {
      const message = JSON.parse(raw) as Record<string, unknown>;
      if (message.type === "ops_hello") {
        send(socket, { type: "ops_hello_ack", version: "1", clientId: "client-12", maxPayloadBytes: 1024, capabilities: [] });
      }
    });

    const client = new OpsClient(server.url, { pingIntervalMs: 100000, pingTimeoutMs: 50 });
    await client.connect();
    (client as unknown as { send: () => void }).send = () => {
      throw new Error("send-failed");
    };

    await expect((client as unknown as { sendPing: () => Promise<void> }).sendPing()).rejects.toThrow("send-failed");

    client.disconnect();
    await new Promise((resolve) => server.wss.close(() => resolve(null)));
  });

  it("rejects when ping send throws non-errors", async () => {
    const server = await createServer((socket, raw) => {
      const message = JSON.parse(raw) as Record<string, unknown>;
      if (message.type === "ops_hello") {
        send(socket, { type: "ops_hello_ack", version: "1", clientId: "client-19", maxPayloadBytes: 1024, capabilities: [] });
      }
    });

    const client = new OpsClient(server.url, { pingIntervalMs: 100000, pingTimeoutMs: 50 });
    await client.connect();
    (client as unknown as { send: () => void }).send = () => {
      throw "ping-failed";
    };

    await expect((client as unknown as { sendPing: () => Promise<void> }).sendPing()).rejects.toThrow("Ops ping failed");

    client.disconnect();
    await new Promise((resolve) => server.wss.close(() => resolve(null)));
  });

  it("rejects when requests time out", async () => {
    const server = await createServer((socket, raw) => {
      const message = JSON.parse(raw) as Record<string, unknown>;
      if (message.type === "ops_hello") {
        send(socket, { type: "ops_hello_ack", version: "1", clientId: "client-15", maxPayloadBytes: 1024, capabilities: [] });
      }
      // Ignore ops_request to force timeout.
    });

    const client = new OpsClient(server.url, { pingIntervalMs: 100000 });
    await expect(client.request("session.status", {}, undefined, 20)).rejects.toThrow("Ops request timed out");

    client.disconnect();
    await new Promise((resolve) => server.wss.close(() => resolve(null)));
  });

  it("rejects when request sends throw non-errors", async () => {
    const server = await createServer((socket, raw) => {
      const message = JSON.parse(raw) as Record<string, unknown>;
      if (message.type === "ops_hello") {
        send(socket, { type: "ops_hello_ack", version: "1", clientId: "client-20", maxPayloadBytes: 1024, capabilities: [] });
      }
    });

    const client = new OpsClient(server.url, { pingIntervalMs: 100000 });
    await client.connect();
    (client as unknown as { sendRaw: () => void }).sendRaw = () => {
      throw "send-failed";
    };

    await expect(client.request("session.status", {})).rejects.toThrow("Ops send failed");

    client.disconnect();
    await new Promise((resolve) => server.wss.close(() => resolve(null)));
  });

  it("rejects pending requests on disconnect", async () => {
    const server = await createServer((socket, raw) => {
      const message = JSON.parse(raw) as Record<string, unknown>;
      if (message.type === "ops_hello") {
        send(socket, { type: "ops_hello_ack", version: "1", clientId: "client-18", maxPayloadBytes: 1024, capabilities: [] });
      }
    });

    const client = new OpsClient(server.url, { pingIntervalMs: 100000 });
    await client.connect();
    const requestPromise = client.request("session.status", {});
    client.disconnect();

    await expect(requestPromise).rejects.toThrow("Ops socket closed");

    await new Promise((resolve) => server.wss.close(() => resolve(null)));
  });

  it("ignores pongs without pending pings", () => {
    const client = new OpsClient("ws://127.0.0.1:0");
    (client as unknown as { handleMessage: (data: string) => void }).handleMessage(
      JSON.stringify({ type: "ops_pong", id: "ghost" })
    );
  });

  it("ignores ops events without a handler", () => {
    const client = new OpsClient("ws://127.0.0.1:0");
    expect(() =>
      (client as unknown as { handleMessage: (data: Buffer) => void }).handleMessage(
        Buffer.from(JSON.stringify({ type: "ops_event", event: "ready" }))
      )
    ).not.toThrow();
  });

  it("ignores chunk completion without pending requests", () => {
    const client = new OpsClient("ws://127.0.0.1:0");
    (client as unknown as { pendingChunks: Map<string, unknown>; handleMessage: (data: Buffer) => void }).pendingChunks.set("payload-x", {
      requestId: "missing",
      totalChunks: 1,
      chunks: []
    });
    (client as unknown as { handleMessage: (data: Buffer) => void }).handleMessage(
      Buffer.from(JSON.stringify({ type: "ops_chunk", payloadId: "payload-x", chunkIndex: 0, totalChunks: 1, data: "{}" }))
    );
  });

  it("normalizes non-error chunk parse failures", () => {
    const client = new OpsClient("ws://127.0.0.1:0");
    (client as unknown as { pendingChunks: Map<string, unknown>; pendingRequests: Map<string, { resolve: () => void; reject: (err: Error) => void; timeoutId: NodeJS.Timeout }>; handleMessage: (data: Buffer) => void })
      .pendingChunks.set("payload-y", {
        requestId: "req-1",
        totalChunks: 1,
        chunks: []
      });
    const reject = vi.fn();
    const timeoutId = setTimeout(() => {}, 1000);
    (client as unknown as { pendingRequests: Map<string, unknown> }).pendingRequests.set("req-1", { resolve: vi.fn(), reject, timeoutId });
    const originalParse = JSON.parse;
    let parseCalls = 0;
    JSON.parse = (value: string) => {
      parseCalls += 1;
      if (parseCalls === 1) {
        return originalParse(value);
      }
      throw "bad-json";
    };
    try {
      (client as unknown as { handleMessage: (data: Buffer) => void }).handleMessage(
        Buffer.from(JSON.stringify({ type: "ops_chunk", payloadId: "payload-y", chunkIndex: 0, totalChunks: 1, data: "bad" }))
      );
    } finally {
      JSON.parse = originalParse;
      clearTimeout(timeoutId);
    }
    expect(reject).toHaveBeenCalledWith(expect.any(Error));
  });

  it("rejects pending requests and pings on socket close", async () => {
    const server = await createServer((socket, raw) => {
      const message = JSON.parse(raw) as Record<string, unknown>;
      if (message.type === "ops_hello") {
        send(socket, { type: "ops_hello_ack", version: "1", clientId: "client-13", maxPayloadBytes: 1024, capabilities: [] });
      }
      if (message.type === "ops_ping") {
        socket.close(1000, "bye");
      }
    });

    const client = new OpsClient(server.url, { pingIntervalMs: 100000, pingTimeoutMs: 1000 });
    await client.connect();

    const requestPromise = client.request("session.status", {});
    const pingPromise = (client as unknown as { sendPing: () => Promise<void> }).sendPing();

    await expect(requestPromise).rejects.toThrow("Ops socket closed");
    await expect(pingPromise).rejects.toThrow("Ops socket closed");

    client.disconnect();
    await new Promise((resolve) => server.wss.close(() => resolve(null)));
  });

  it("rejects pending pings on disconnect", async () => {
    const server = await createServer((socket, raw) => {
      const message = JSON.parse(raw) as Record<string, unknown>;
      if (message.type === "ops_hello") {
        send(socket, { type: "ops_hello_ack", version: "1", clientId: "client-17", maxPayloadBytes: 1024, capabilities: [] });
      }
    });

    const client = new OpsClient(server.url, { pingIntervalMs: 100000, pingTimeoutMs: 1000 });
    await client.connect();
    const pingPromise = (client as unknown as { sendPing: () => Promise<void> }).sendPing();
    client.disconnect();

    await expect(pingPromise).rejects.toThrow("Ops socket closed");

    await new Promise((resolve) => server.wss.close(() => resolve(null)));
  });

  it("ignores responses without pending requests", async () => {
    const server = await createServer((socket, raw) => {
      const message = JSON.parse(raw) as Record<string, unknown>;
      if (message.type === "ops_hello") {
        send(socket, { type: "ops_hello_ack", version: "1", clientId: "client-16", maxPayloadBytes: 1024, capabilities: [] });
        send(socket, { type: "ops_response", requestId: "missing", payload: { ok: true } });
        send(socket, { type: "ops_chunk", requestId: "missing", payloadId: "payload-x", chunkIndex: 0, totalChunks: 1, data: "{}" });
        send(socket, { type: "ops_error", requestId: "missing", error: { code: "nope", message: "nope", retryable: false } });
      }
    });

    const client = new OpsClient(server.url, { pingIntervalMs: 100000 });
    await client.connect();
    await new Promise((resolve) => setTimeout(resolve, 10));

    client.disconnect();
    await new Promise((resolve) => server.wss.close(() => resolve(null)));
  });

  it("ignores invalid json payloads", async () => {
    const server = await createServer((socket, raw) => {
      const message = JSON.parse(raw) as Record<string, unknown>;
      if (message.type === "ops_hello") {
        send(socket, { type: "ops_hello_ack", version: "1", clientId: "client-6", maxPayloadBytes: 1024, capabilities: [] });
        socket.send("not-json");
      }
      if (message.type === "ops_request") {
        send(socket, { type: "ops_response", requestId: message.requestId, payload: { ok: true } });
      }
    });

    const client = new OpsClient(server.url, { pingIntervalMs: 100000 });
    const result = await client.request<{ ok: boolean }>("session.status", {});
    expect(result).toEqual({ ok: true });

    client.disconnect();
    await new Promise((resolve) => server.wss.close(() => resolve(null)));
  });

  it("forwards ops events to the event handler", async () => {
    const server = await createServer((socket, raw) => {
      const message = JSON.parse(raw) as Record<string, unknown>;
      if (message.type === "ops_hello") {
        send(socket, { type: "ops_hello_ack", version: "1", clientId: "client-7", maxPayloadBytes: 1024, capabilities: [] });
        send(socket, { type: "ops_event", event: "ops_session_created", payload: { tabId: 9 } });
      }
    });

    let eventPromiseResolver: (event: unknown) => void = () => {};
    const eventPromise = new Promise((resolve) => {
      eventPromiseResolver = resolve;
    });
    const client = new OpsClient(server.url, {
      pingIntervalMs: 100000,
      onEvent: (event) => eventPromiseResolver(event)
    });

    await client.connect();
    const event = await eventPromise;
    expect(event).toMatchObject({ type: "ops_event", event: "ops_session_created" });

    client.disconnect();
    await new Promise((resolve) => server.wss.close(() => resolve(null)));
  });

  it("rejects oversized request payloads", async () => {
    const server = await createServer((socket, raw) => {
      const message = JSON.parse(raw) as Record<string, unknown>;
      if (message.type === "ops_hello") {
        send(socket, { type: "ops_hello_ack", version: "1", clientId: "client-8", maxPayloadBytes: 10, capabilities: [] });
      }
    });

    const client = new OpsClient(server.url, { pingIntervalMs: 100000, maxPayloadBytes: 10 });
    await expect(client.request("session.status", { big: "x".repeat(200) })).rejects.toThrow("Ops request payload exceeded max size");

    client.disconnect();
    await new Promise((resolve) => server.wss.close(() => resolve(null)));
  });

  it("reschedules reconnect when a reconnect attempt fails", async () => {
    vi.useFakeTimers();
    const client = new OpsClient("ws://127.0.0.1:0", { pingIntervalMs: 100000 });
    const scheduleSpy = vi.spyOn(client as unknown as { scheduleReconnect: () => void }, "scheduleReconnect");
    vi.spyOn(client, "connect").mockRejectedValueOnce(new Error("connect-failed"));

    (client as unknown as { scheduleReconnect: () => void }).scheduleReconnect();
    await vi.runOnlyPendingTimersAsync();

    expect(scheduleSpy).toHaveBeenCalledTimes(2);

    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("does not close the socket until maxMissedPongs is reached", async () => {
    vi.useFakeTimers();
    const client = new OpsClient("ws://127.0.0.1:0", { pingIntervalMs: 50, pingTimeoutMs: 10, maxMissedPongs: 2 });
    const closeSpy = vi.spyOn(client as unknown as { closeSocket: (code: number, reason: string, allowReconnect: boolean) => void }, "closeSocket");
    (client as unknown as { sendPing: () => Promise<void> }).sendPing = vi.fn().mockRejectedValue(new Error("missed"));

    (client as unknown as { startHeartbeat: () => void }).startHeartbeat();
    await vi.runOnlyPendingTimersAsync();

    expect(closeSpy).not.toHaveBeenCalled();

    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("avoids scheduling multiple reconnect timers", () => {
    vi.useFakeTimers();
    const client = new OpsClient("ws://127.0.0.1:0", { pingIntervalMs: 100000 });
    const scheduleReconnect = client as unknown as { scheduleReconnect: () => void; reconnectTimer: NodeJS.Timeout | null };

    scheduleReconnect.scheduleReconnect();
    const firstTimer = scheduleReconnect.reconnectTimer;
    scheduleReconnect.scheduleReconnect();

    expect(scheduleReconnect.reconnectTimer).toBe(firstTimer);

    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("propagates send errors from requests", async () => {
    const server = await createServer((socket, raw) => {
      const message = JSON.parse(raw) as Record<string, unknown>;
      if (message.type === "ops_hello") {
        send(socket, { type: "ops_hello_ack", version: "1", clientId: "client-9", maxPayloadBytes: 1024, capabilities: [] });
      }
    });

    const client = new OpsClient(server.url, { pingIntervalMs: 100000 });
    await client.connect();
    (client as unknown as { sendRaw: () => void }).sendRaw = () => {
      throw new Error("send-failed");
    };

    await expect(client.request("session.status", {})).rejects.toThrow("send-failed");

    client.disconnect();
    await new Promise((resolve) => server.wss.close(() => resolve(null)));
  });

  it("rejects invalid chunk payloads", async () => {
    const server = await createServer((socket, raw) => {
      const message = JSON.parse(raw) as Record<string, unknown>;
      if (message.type === "ops_hello") {
        send(socket, { type: "ops_hello_ack", version: "1", clientId: "client-5", maxPayloadBytes: 1024, capabilities: [] });
      }
      if (message.type === "ops_request") {
        send(socket, {
          type: "ops_response",
          requestId: message.requestId,
          payloadId: "payload-bad",
          totalChunks: 1,
          chunked: true
        });
        send(socket, { type: "ops_chunk", requestId: message.requestId, payloadId: "payload-bad", chunkIndex: 0, totalChunks: 1, data: "not-json" });
      }
    });

    const client = new OpsClient(server.url, { pingIntervalMs: 100000 });
    await expect(client.request("session.status", {})).rejects.toBeInstanceOf(Error);

    client.disconnect();
    await new Promise((resolve) => server.wss.close(() => resolve(null)));
  });
});
