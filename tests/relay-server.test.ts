import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WebSocket } from "ws";
import http from "http";
import type { IncomingMessage, ServerResponse } from "http";
import type { AddressInfo } from "net";
import { RelayServer } from "../src/relay/relay-server";
import { MAX_OPS_PAYLOAD_BYTES } from "../src/relay/protocol";

const getAvailablePort = async (): Promise<number> => {
  const tempServer = http.createServer();
  await new Promise<void>((resolve) => {
    tempServer.listen(0, "127.0.0.1", () => resolve());
  });
  const address = tempServer.address() as AddressInfo;
  await new Promise<void>((resolve) => tempServer.close(() => resolve()));
  return address.port;
};

const EXTENSION_ORIGIN = "chrome-extension://abcdefghijklmnop";

const connect = async (url: string, timeoutMs = 3000, origin?: string): Promise<WebSocket> => {
  const headers = origin ? { Origin: origin } : (url.endsWith("/extension") ? { Origin: EXTENSION_ORIGIN } : undefined);
  const socket = headers ? new WebSocket(url, { headers }) : new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out connecting to ${url}`));
    }, timeoutMs);
    socket.once("open", () => {
      clearTimeout(timeout);
      resolve();
    });
    socket.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
  return socket;
};

const upgradeRequest = async (options: { port: number; path: string; origin?: string }): Promise<number> => {
  return await new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      "Connection": "Upgrade",
      "Upgrade": "websocket",
      "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
      "Sec-WebSocket-Version": "13"
    };
    if (options.origin) {
      headers.Origin = options.origin;
    }
    const req = http.request({
      hostname: "127.0.0.1",
      port: options.port,
      path: options.path,
      method: "GET",
      headers
    });

    req.on("response", (response) => {
      resolve(response.statusCode ?? 0);
    });
    req.on("upgrade", (_response, socket) => {
      socket.destroy();
      resolve(101);
    });
    req.on("error", reject);
    req.end();
  });
};

const waitForClose = (socket: WebSocket, timeoutMs = 4000): Promise<number> => {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Timed out waiting for socket close"));
    }, timeoutMs);
    socket.once("close", (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
    socket.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
};

const nextMessage = async (socket: WebSocket): Promise<Record<string, unknown>> => {
  const data = await new Promise<unknown>((resolve) => {
    socket.once("message", resolve);
  });
  const text = typeof data === "string" ? data : String(data);
  return JSON.parse(text) as Record<string, unknown>;
};

const waitForHandshakeAck = async (socket: WebSocket): Promise<Record<string, unknown>> => {
  const message = await nextMessage(socket);
  expect(message.type).toBe("handshakeAck");
  return message;
};

describe("RelayServer", () => {
  let server: RelayServer | null = null;
  let warnSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    if (server) {
      server.stop();
      server = null;
    }
    warnSpy?.mockRestore();
    warnSpy = null;
  });

  it("starts and stops", async () => {
    server = new RelayServer();
    const status1 = server.status();
    expect(status1.running).toBe(false);

    const started = await server.start(0);
    expect(started.url).toContain("ws://127.0.0.1:");
    expect(started.port).toBeGreaterThan(0);
    expect(server.getCdpUrl()).toBe(`${started.url}/cdp`);
    const startedAgain = await server.start(9999);
    expect(startedAgain.url).toBe(started.url);

    const status2 = server.status();
    expect(status2.running).toBe(true);

    server.stop();
    const status3 = server.status();
    expect(status3.running).toBe(false);
  });

  it("returns null annotation url when not running", () => {
    server = new RelayServer();
    expect(server.getAnnotationUrl()).toBeNull();
  });

  it("returns annotation url when running", async () => {
    server = new RelayServer();
    const started = await server.start(0);
    expect(server.getAnnotationUrl()).toBe(`${started.url}/annotation`);
  });

  it("returns ops url when running", async () => {
    server = new RelayServer();
    const started = await server.start(0);
    expect(server.getOpsUrl()).toBe(`${started.url}/ops`);
  });

  it("treats empty loopback addresses as non-loopback", () => {
    const internal = new RelayServer() as unknown as { isLoopbackAddress: (ip: string) => boolean };
    expect(internal.isLoopbackAddress("")).toBe(false);
  });

  it("returns null cdp url before start", () => {
    server = new RelayServer();
    expect(server.getCdpUrl()).toBeNull();
  });

  it("parses loopback helpers", () => {
    server = new RelayServer();
    const internal = server as unknown as {
      isLoopbackAddress: (value: string) => boolean;
      getCdpTokenFromRequestUrl: (value?: string) => string | null;
    };

    expect(internal.isLoopbackAddress("127.0.0.1")).toBe(true);
    expect(internal.isLoopbackAddress("::1")).toBe(true);
    expect(internal.isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
    expect(internal.isLoopbackAddress("10.0.0.1")).toBe(false);

    expect(internal.getCdpTokenFromRequestUrl("http://127.0.0.1/cdp?token=abc")).toBe("abc");
    expect(internal.getCdpTokenFromRequestUrl("http://[::")).toBeNull();
  });

  it("rejects non-loopback http requests and rate limits", () => {
    server = new RelayServer();
    const internal = server as unknown as {
      authorizeHttpRequest: (origin: string | undefined, req: IncomingMessage, res: ServerResponse) => boolean;
      httpAttempts: Map<string, { count: number; resetAt: number }>;
    };
    const response = {
      setHeader: vi.fn(),
      writeHead: vi.fn(),
      end: vi.fn()
    } as unknown as ServerResponse;
    const request = {
      headers: {},
      socket: { remoteAddress: "10.0.0.1" }
    } as unknown as IncomingMessage;

    expect(internal.authorizeHttpRequest(undefined, request, response)).toBe(false);
    expect(response.writeHead).toHaveBeenCalledWith(403, { "Content-Type": "application/json" });

    const limitedResponse = {
      setHeader: vi.fn(),
      writeHead: vi.fn(),
      end: vi.fn()
    } as unknown as ServerResponse;
    internal.httpAttempts.set("127.0.0.1", {
      count: (RelayServer as unknown as { MAX_HTTP_ATTEMPTS: number }).MAX_HTTP_ATTEMPTS,
      resetAt: Date.now() + 60_000
    });
    const limitedRequest = {
      headers: {},
      socket: { remoteAddress: "127.0.0.1" }
    } as unknown as IncomingMessage;
    expect(internal.authorizeHttpRequest(undefined, limitedRequest, limitedResponse)).toBe(false);
    expect(limitedResponse.writeHead).toHaveBeenCalledWith(429, { "Content-Type": "application/json" });
  });

  it("sets CORS headers for config preflight helper", () => {
    server = new RelayServer();
    const internal = server as unknown as {
      handleConfigPreflight: (origin: string | undefined, req: IncomingMessage, res: ServerResponse) => void;
    };
    const request = {
      headers: {
        "access-control-request-private-network": "true"
      }
    } as unknown as IncomingMessage;
    const response = {
      setHeader: vi.fn(),
      writeHead: vi.fn(),
      end: vi.fn()
    } as unknown as ServerResponse;
    internal.handleConfigPreflight(EXTENSION_ORIGIN, request, response);
    expect(response.setHeader).toHaveBeenCalledWith("Access-Control-Allow-Origin", EXTENSION_ORIGIN);
    expect(response.writeHead).toHaveBeenCalledWith(204);
  });

  it("rejects unknown upgrade paths", async () => {
    server = new RelayServer();
    const started = await server.start(0);
    const internal = server as unknown as { server?: { emit: (event: string, ...args: unknown[]) => void } };
    const destroy = vi.fn();
    internal.server?.emit("upgrade", { url: "/unknown", headers: {}, socket: { remoteAddress: "127.0.0.1" } }, { destroy, write: vi.fn() }, Buffer.from(""));
    expect(destroy).toHaveBeenCalled();
    expect(started.url).toContain("ws://127.0.0.1:");
  });

  it("rejects ops upgrades from non-loopback without origin", async () => {
    server = new RelayServer();
    await server.start(0);
    const internal = server as unknown as { server?: { emit: (event: string, ...args: unknown[]) => void } };
    const write = vi.fn();
    const destroy = vi.fn();
    internal.server?.emit(
      "upgrade",
      { url: "/ops", headers: {}, socket: { remoteAddress: "10.0.0.1" } },
      { write, destroy },
      Buffer.from("")
    );
    expect(write).toHaveBeenCalledWith("HTTP/1.1 403 Forbidden\r\n\r\n");
    expect(destroy).toHaveBeenCalled();
  });

  it("rate limits ops upgrades", async () => {
    server = new RelayServer();
    await server.start(0);
    const internal = server as unknown as {
      server?: { emit: (event: string, ...args: unknown[]) => void };
      handshakeAttempts: Map<string, { count: number; resetAt: number }>;
    };
    internal.handshakeAttempts.set("127.0.0.1", {
      count: (RelayServer as unknown as { MAX_HANDSHAKE_ATTEMPTS: number }).MAX_HANDSHAKE_ATTEMPTS,
      resetAt: Date.now() + 60_000
    });
    const write = vi.fn();
    const destroy = vi.fn();
    internal.server?.emit(
      "upgrade",
      { url: "/ops", headers: {}, socket: { remoteAddress: "127.0.0.1" } },
      { write, destroy },
      Buffer.from("")
    );
    expect(write).toHaveBeenCalledWith("HTTP/1.1 429 Too Many Requests\r\n\r\n");
    expect(destroy).toHaveBeenCalled();
  });

  it("blocks ops upgrades for non-extension origins", async () => {
    server = new RelayServer();
    await server.start(0);
    const internal = server as unknown as { server?: { emit: (event: string, ...args: unknown[]) => void } };
    const write = vi.fn();
    const destroy = vi.fn();
    internal.server?.emit(
      "upgrade",
      { url: "/ops", headers: { origin: "https://example.com" }, socket: { remoteAddress: "127.0.0.1" } },
      { write, destroy },
      Buffer.from("")
    );
    expect(write).toHaveBeenCalledWith("HTTP/1.1 403 Forbidden\r\n\r\n");
    expect(destroy).toHaveBeenCalled();
  });

  it("rejects ops upgrades with invalid tokens", async () => {
    server = new RelayServer();
    const started = await server.start(0);
    server.setToken("secret");

    const status = await upgradeRequest({ port: started.port, path: "/ops?token=bad" });
    expect(status).toBe(401);
  });

  it("forwards commands, responses, and events", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    const extension = await connect(`${started.url}/extension`);
    const cdp = await connect(`${started.url}/cdp`);

    extension.send(JSON.stringify({ type: "handshake", payload: { tabId: 7, url: "https://example.com", title: "Example" } }));
    await waitForHandshakeAck(extension);
    expect(server.status().extension?.tabId).toBe(7);

    const commandPromise = nextMessage(extension);
    cdp.send(JSON.stringify({ id: 1, method: "Browser.getVersion", params: {} }));
    const command = await commandPromise;
    expect(command.method).toBe("forwardCDPCommand");

    extension.send(JSON.stringify({ id: 1, result: { product: "Chrome" }, sessionId: "s1" }));
    const response = await nextMessage(cdp);
    expect(response.id).toBe(1);
    expect(response.result).toEqual({ product: "Chrome" });
    expect(response.sessionId).toBe("s1");

    extension.send(JSON.stringify({ method: "forwardCDPEvent", params: { method: "Runtime.consoleAPICalled", params: { type: "log" }, sessionId: "s2" } }));
    const event = await nextMessage(cdp);
    expect(event.method).toBe("Runtime.consoleAPICalled");
    expect(event.sessionId).toBe("s2");

    extension.close();
    cdp.close();
  });

  it("forwards sessionId from CDP commands", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    const extension = await connect(`${started.url}/extension`);
    const cdp = await connect(`${started.url}/cdp`);

    extension.send(JSON.stringify({ type: "handshake", payload: { tabId: 7 } }));
    await waitForHandshakeAck(extension);

    const commandPromise = nextMessage(extension);
    cdp.send(JSON.stringify({ id: 2, method: "Runtime.evaluate", params: {}, sessionId: "sess-1" }));
    const command = await commandPromise;
    const params = command.params as Record<string, unknown> | undefined;
    expect(params?.sessionId).toBe("sess-1");

    extension.close();
    cdp.close();
  });

  it("forwards string ids and error responses", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    const extension = await connect(`${started.url}/extension`);
    const cdp = await connect(`${started.url}/cdp`);

    extension.send(JSON.stringify({ type: "handshake", payload: { tabId: 3 } }));
    await waitForHandshakeAck(extension);

    const responsePromise = nextMessage(cdp);
    extension.send(JSON.stringify({ id: "req-1", error: { message: "boom" } }));
    const response = await responsePromise;
    expect(response.id).toBe("req-1");
    expect(response.error).toEqual({ message: "boom" });

    extension.close();
    cdp.close();
  });

  it("parses buffer messages and forwards results", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    const extension = await connect(`${started.url}/extension`);
    const cdp = await connect(`${started.url}/cdp`);

    extension.send(JSON.stringify({ type: "handshake", payload: { tabId: 5 } }));
    await waitForHandshakeAck(extension);

    const responsePromise = nextMessage(cdp);
    extension.send(Buffer.from(JSON.stringify({ id: "buf-1", result: { ok: true } })));
    const response = await responsePromise;
    expect(response.id).toBe("buf-1");
    expect(response.result).toEqual({ ok: true });

    extension.close();
    cdp.close();
  });

  it("routes annotation commands, events, and responses", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    const extension = await connect(`${started.url}/extension`);
    const annotation = await connect(`${started.url}/annotation`);

    extension.send(JSON.stringify({ type: "handshake", payload: { tabId: 77 } }));
    await waitForHandshakeAck(extension);

    const commandPayload = {
      version: 1,
      requestId: "req-1",
      command: "start",
      url: "https://example.com"
    };
    annotation.send(JSON.stringify({ type: "annotationCommand", payload: commandPayload }));
    const forwarded = await nextMessage(extension);
    expect(forwarded.type).toBe("annotationCommand");
    expect(forwarded.payload).toEqual(commandPayload);

    const eventPayload = {
      version: 1,
      requestId: "req-1",
      event: "progress",
      message: "Working"
    };
    extension.send(JSON.stringify({ type: "annotationEvent", payload: eventPayload }));
    const event = await nextMessage(annotation);
    expect(event.type).toBe("annotationEvent");
    expect(event.payload).toEqual(eventPayload);

    const responsePayload = {
      version: 1,
      requestId: "req-1",
      status: "ok",
      payload: {
        url: "https://example.com",
        timestamp: "2026-01-31T00:00:00.000Z",
        screenshotMode: "none",
        annotations: []
      }
    };
    extension.send(JSON.stringify({ type: "annotationResponse", payload: responsePayload }));
    const response = await nextMessage(annotation);
    expect(response.type).toBe("annotationResponse");
    expect(response.payload).toEqual(responsePayload);

    annotation.close();
    extension.close();
  });

  it("returns relay_unavailable for annotation commands without a handshake", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    const annotation = await connect(`${started.url}/annotation`);
    annotation.send(JSON.stringify({
      type: "annotationCommand",
      payload: { version: 1, requestId: "req-missing", command: "start" }
    }));
    const response = await nextMessage(annotation);
    expect(response.type).toBe("annotationResponse");
    expect(response.payload).toMatchObject({
      status: "error",
      error: { code: "relay_unavailable" }
    });

    annotation.close();
  });

  it("rejects invalid annotation commands", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    const annotation = await connect(`${started.url}/annotation`);
    annotation.send(JSON.stringify({
      type: "annotationCommand",
      payload: { requestId: "bad" }
    }));

    const response = await nextMessage(annotation);
    expect(response.type).toBe("annotationResponse");
    expect(response.payload).toMatchObject({
      status: "error",
      error: { code: "invalid_request" }
    });

    annotation.close();
  });

  it("rejects annotation commands with invalid version", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    const annotation = await connect(`${started.url}/annotation`);
    annotation.send(JSON.stringify({
      type: "annotationCommand",
      payload: { version: 2, requestId: "req-bad-version", command: "start" }
    }));

    const response = await nextMessage(annotation);
    expect(response.type).toBe("annotationResponse");
    expect(response.payload).toMatchObject({
      requestId: "req-bad-version",
      status: "error",
      error: { code: "invalid_request" }
    });

    annotation.close();
  });

  it("rejects annotation commands with invalid requestId, command, and options", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    const annotation = await connect(`${started.url}/annotation`);

    annotation.send(JSON.stringify({
      type: "annotationCommand",
      payload: { version: 1, requestId: 123, command: "start" }
    }));
    let response = await nextMessage(annotation);
    expect(response.type).toBe("annotationResponse");
    expect(response.payload).toMatchObject({
      requestId: "unknown",
      status: "error",
      error: { code: "invalid_request" }
    });

    annotation.send(JSON.stringify({
      type: "annotationCommand",
      payload: { version: 1, requestId: "req-invalid-command", command: "noop" }
    }));
    response = await nextMessage(annotation);
    expect(response.payload).toMatchObject({
      requestId: "req-invalid-command",
      status: "error",
      error: { code: "invalid_request" }
    });

    annotation.send(JSON.stringify({
      type: "annotationCommand",
      payload: { version: 1, requestId: "req-invalid-options", command: "start", options: "bad" }
    }));
    response = await nextMessage(annotation);
    expect(response.payload).toMatchObject({
      requestId: "req-invalid-options",
      status: "error",
      error: { code: "invalid_request" }
    });

    annotation.close();
  });

  it("routes ops hello and responses between client and extension", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    const extension = await connect(`${started.url}/extension`);
    const ops = await connect(`${started.url}/ops`);

    extension.send(JSON.stringify({ type: "handshake", payload: { tabId: 11 } }));
    await waitForHandshakeAck(extension);

    ops.send(JSON.stringify({ type: "ops_hello", version: "1", maxPayloadBytes: 1024 }));
    const forwardedHello = await nextMessage(extension);
    expect(forwardedHello.type).toBe("ops_hello");
    expect(typeof forwardedHello.clientId).toBe("string");

    const clientId = String(forwardedHello.clientId);
    extension.send(JSON.stringify({
      type: "ops_hello_ack",
      version: "1",
      clientId,
      maxPayloadBytes: 1024,
      capabilities: []
    }));
    const helloAck = await nextMessage(ops);
    expect(helloAck.type).toBe("ops_hello_ack");
    expect(helloAck.clientId).toBe(clientId);

    ops.send(JSON.stringify({
      type: "ops_request",
      requestId: "req-ops",
      command: "session.status",
      opsSessionId: "sess-1",
      payload: {}
    }));
    const forwardedRequest = await nextMessage(extension);
    expect(forwardedRequest.type).toBe("ops_request");
    expect(forwardedRequest.clientId).toBe(clientId);

    extension.send(JSON.stringify({
      type: "ops_response",
      requestId: "req-ops",
      clientId,
      opsSessionId: "sess-1",
      payload: { ok: true }
    }));
    const response = await nextMessage(ops);
    expect(response.type).toBe("ops_response");
    expect(response.payload).toEqual({ ok: true });

    ops.close();
    extension.close();
  });

  it("returns invalid_request for malformed ops payloads", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    const extension = await connect(`${started.url}/extension`);
    const ops = await connect(`${started.url}/ops`);

    extension.send(JSON.stringify({ type: "handshake", payload: { tabId: 21 } }));
    await waitForHandshakeAck(extension);

    ops.send(JSON.stringify({ type: "ops_bad_payload" }));
    const response = await nextMessage(ops);
    expect(response.type).toBe("ops_error");
    expect(response.error).toMatchObject({ code: "invalid_request" });

    ops.close();
    extension.close();
  });

  it("ignores non-object ops messages", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    const extension = await connect(`${started.url}/extension`);
    const ops = await connect(`${started.url}/ops`);

    extension.send(JSON.stringify({ type: "handshake", payload: { tabId: 25 } }));
    await waitForHandshakeAck(extension);

    ops.send("null");
    await new Promise((resolve) => setTimeout(resolve, 10));

    ops.close();
    extension.close();
  });

  it("rejects oversized ops payloads", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    const extension = await connect(`${started.url}/extension`);
    const ops = await connect(`${started.url}/ops`);

    extension.send(JSON.stringify({ type: "handshake", payload: { tabId: 22 } }));
    await waitForHandshakeAck(extension);

    const oversized = "x".repeat(MAX_OPS_PAYLOAD_BYTES);
    ops.send(JSON.stringify({
      type: "ops_request",
      requestId: "req-big",
      command: "session.status",
      payload: { data: oversized }
    }));
    const response = await nextMessage(ops);
    expect(response.type).toBe("ops_error");
    expect(response.error).toMatchObject({ code: "invalid_request" });

    ops.close();
    extension.close();
  }, 15000);

  it("sends ops_client_disconnected when ops socket closes", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    const extension = await connect(`${started.url}/extension`);
    const ops = await connect(`${started.url}/ops`);

    extension.send(JSON.stringify({ type: "handshake", payload: { tabId: 23 } }));
    await waitForHandshakeAck(extension);

    ops.close();
    const message = await nextMessage(extension);
    expect(message.type).toBe("ops_event");
    expect(message.event).toBe("ops_client_disconnected");

    extension.close();
  });

  it("sends ops_client_disconnected when ops socket errors", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    const extension = await connect(`${started.url}/extension`);
    await connect(`${started.url}/ops`);

    extension.send(JSON.stringify({ type: "handshake", payload: { tabId: 27 } }));
    await waitForHandshakeAck(extension);

    const internal = server as unknown as { opsClients: Map<string, WebSocket> };
    const serverSocket = internal.opsClients.values().next().value as WebSocket | undefined;
    serverSocket?.emit("error", new Error("boom"));

    const message = await nextMessage(extension);
    expect(message.type).toBe("ops_event");
    expect(message.event).toBe("ops_client_disconnected");

    extension.close();
  });

  it("ignores ops_hello_ack when no ops clients are connected", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    const extension = await connect(`${started.url}/extension`);
    extension.send(JSON.stringify({ type: "handshake", payload: { tabId: 24 } }));
    await waitForHandshakeAck(extension);

    extension.send(JSON.stringify({
      type: "ops_hello_ack",
      version: "1",
      clientId: "missing-client",
      maxPayloadBytes: 1024,
      capabilities: []
    }));

    expect(server.status().opsConnected).toBe(false);
    extension.close();
  });

  it("drops ops responses for unknown clients", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    const extension = await connect(`${started.url}/extension`);
    extension.send(JSON.stringify({ type: "handshake", payload: { tabId: 26 } }));
    await waitForHandshakeAck(extension);

    extension.send(JSON.stringify({
      type: "ops_response",
      requestId: "req-missing",
      clientId: "missing-client",
      payload: { ok: true }
    }));

    expect(server.status().opsConnected).toBe(false);
    extension.close();
  });

  it("returns ops_unavailable when extension is missing", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    const ops = await connect(`${started.url}/ops`);
    ops.send(JSON.stringify({
      type: "ops_request",
      requestId: "req-missing",
      command: "session.status",
      payload: {}
    }));

    const response = await nextMessage(ops);
    expect(response.type).toBe("ops_error");
    expect(response.error).toMatchObject({ code: "ops_unavailable" });

    ops.close();
  });

  it("blocks cdp attach to ops-owned targets", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    const extension = await connect(`${started.url}/extension`);
    const cdp = await connect(`${started.url}/cdp`);

    extension.send(JSON.stringify({ type: "handshake", payload: { tabId: 42 } }));
    await waitForHandshakeAck(extension);

    extension.send(JSON.stringify({
      type: "ops_event",
      event: "ops_session_created",
      payload: { tabId: 123 }
    }));

    cdp.send(JSON.stringify({ id: 1, method: "Target.attachToTarget", params: { targetId: "tab-123" } }));
    const response = await nextMessage(cdp);
    expect(response.error).toEqual({ message: "cdp_attach_blocked: target is owned by an ops session" });

    cdp.close();
    extension.close();
  });

  it("allows cdp attach after ops session closes", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    const extension = await connect(`${started.url}/extension`);
    const cdp = await connect(`${started.url}/cdp`);

    extension.send(JSON.stringify({ type: "handshake", payload: { tabId: 43 } }));
    await waitForHandshakeAck(extension);

    extension.send(JSON.stringify({
      type: "ops_event",
      event: "ops_session_created",
      payload: { tabId: 555 }
    }));

    extension.send(JSON.stringify({
      type: "ops_event",
      event: "ops_session_closed",
      payload: { tabId: 555 }
    }));

    const forwardedPromise = nextMessage(extension);
    cdp.send(JSON.stringify({ id: 2, method: "Target.attachToTarget", params: { targetId: "tab-555" } }));
    const forwarded = await forwardedPromise;
    expect(forwarded.method).toBe("forwardCDPCommand");

    extension.send(JSON.stringify({ id: 2, result: { sessionId: "s-attach" } }));
    const response = await nextMessage(cdp);
    expect(response.result).toEqual({ sessionId: "s-attach" });

    cdp.close();
    extension.close();
  });

  it("times out pending annotations", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    const extension = await connect(`${started.url}/extension`);
    const annotation = await connect(`${started.url}/annotation`);

    extension.send(JSON.stringify({ type: "handshake", payload: { tabId: 88 } }));
    await waitForHandshakeAck(extension);

    const relay = RelayServer as unknown as { ANNOTATION_REQUEST_TIMEOUT_MS: number };
    const originalTimeout = relay.ANNOTATION_REQUEST_TIMEOUT_MS;
    relay.ANNOTATION_REQUEST_TIMEOUT_MS = 5;
    try {
      annotation.send(JSON.stringify({
        type: "annotationCommand",
        payload: { version: 1, requestId: "req-timeout", command: "start" }
      }));
      const response = await nextMessage(annotation);
      expect(response.type).toBe("annotationResponse");
      expect(response.payload).toMatchObject({
        status: "error",
        error: { code: "timeout" }
      });
    } finally {
      relay.ANNOTATION_REQUEST_TIMEOUT_MS = originalTimeout;
    }

    annotation.close();
    extension.close();
  });

  it("rejects annotation responses with non-string request ids", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    const extension = await connect(`${started.url}/extension`);
    const annotation = await connect(`${started.url}/annotation`);

    extension.send(JSON.stringify({ type: "handshake", payload: { tabId: 99 } }));
    await waitForHandshakeAck(extension);

    annotation.send(JSON.stringify({
      type: "annotationCommand",
      payload: { version: 1, requestId: "req-1", command: "start" }
    }));
    await nextMessage(extension); // forwarded command

    extension.send(JSON.stringify({
      type: "annotationResponse",
      payload: { version: 1, requestId: 123, status: "ok" }
    }));

    const response = await nextMessage(annotation);
    expect(response.payload).toMatchObject({
      requestId: "unknown",
      status: "error",
      error: { code: "invalid_request" }
    });

    annotation.close();
    extension.close();
  });

  it("rejects annotation responses with invalid status and error shapes", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    const extension = await connect(`${started.url}/extension`);
    const annotation = await connect(`${started.url}/annotation`);

    extension.send(JSON.stringify({ type: "handshake", payload: { tabId: 90 } }));
    await waitForHandshakeAck(extension);

    annotation.send(JSON.stringify({
      type: "annotationCommand",
      payload: { version: 1, requestId: "req-invalid-status", command: "start" }
    }));
    await nextMessage(extension);

    extension.send(JSON.stringify({
      type: "annotationResponse",
      payload: {
        version: 1,
        requestId: "req-invalid-status",
        status: "wat"
      }
    }));

    let response = await nextMessage(annotation);
    expect(response.payload).toMatchObject({
      requestId: "req-invalid-status",
      status: "error",
      error: { code: "invalid_request" }
    });

    annotation.send(JSON.stringify({
      type: "annotationCommand",
      payload: { version: 1, requestId: "req-invalid-error", command: "start" }
    }));
    await nextMessage(extension);

    extension.send(JSON.stringify({
      type: "annotationResponse",
      payload: {
        version: 1,
        requestId: "req-invalid-error",
        status: "error",
        error: "bad"
      }
    }));

    response = await nextMessage(annotation);
    expect(response.payload).toMatchObject({
      requestId: "req-invalid-error",
      status: "error",
      error: { code: "invalid_request" }
    });

    annotation.close();
    extension.close();
  });

  it("rejects invalid annotation responses", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    const extension = await connect(`${started.url}/extension`);
    const annotation = await connect(`${started.url}/annotation`);

    extension.send(JSON.stringify({ type: "handshake", payload: { tabId: 89 } }));
    await waitForHandshakeAck(extension);

    annotation.send(JSON.stringify({
      type: "annotationCommand",
      payload: { version: 1, requestId: "req-invalid", command: "start" }
    }));
    await nextMessage(extension);

    extension.send(JSON.stringify({
      type: "annotationResponse",
      payload: { requestId: "req-invalid" }
    }));

    const response = await nextMessage(annotation);
    expect(response.type).toBe("annotationResponse");
    expect(response.payload).toMatchObject({
      status: "error",
      error: { code: "invalid_request" }
    });

    annotation.close();
    extension.close();
  });

  it("responds to annotation health checks", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    const annotation = await connect(`${started.url}/annotation`);
    annotation.send(JSON.stringify({ type: "healthCheck", id: "annotation-hc" }));

    const response = await nextMessage(annotation);
    expect(response.type).toBe("healthCheckResult");
    expect(response.id).toBe("annotation-hc");

    annotation.close();
  });

  it("responds to annotation health checks sent as buffers", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    const annotation = await connect(`${started.url}/annotation`);
    annotation.send(Buffer.from(JSON.stringify({ type: "healthCheck", id: "buf-1" })));

    const response = await nextMessage(annotation);
    expect(response.type).toBe("healthCheckResult");
    expect(response.id).toBe("buf-1");

    annotation.close();
  });

  it("responds to annotation ping with pong", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    const annotation = await connect(`${started.url}/annotation`);
    annotation.send(JSON.stringify({ type: "ping", id: "annotation-ping" }));

    const response = await nextMessage(annotation);
    expect(response.type).toBe("pong");
    expect(response.id).toBe("annotation-ping");

    annotation.close();
  });

  it("rejects additional annotation clients and clears on close", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    const annotation1 = await connect(`${started.url}/annotation`);
    const annotation2 = await connect(`${started.url}/annotation`);
    const closed2 = await waitForClose(annotation2);
    expect(closed2).toBe(1008);

    annotation1.close();
    await waitForClose(annotation1);

    const annotation3 = await connect(`${started.url}/annotation`);
    annotation3.close();
  });

  it("ignores non-json annotation messages", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    const annotation = await connect(`${started.url}/annotation`);
    const messageSpy = vi.fn();
    annotation.on("message", messageSpy);

    annotation.send("not-json");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(messageSpy).not.toHaveBeenCalled();

    annotation.close();
  });

  it("ignores annotation responses for unknown request ids", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    const extension = await connect(`${started.url}/extension`);
    const annotation = await connect(`${started.url}/annotation`);

    extension.send(JSON.stringify({ type: "handshake", payload: { tabId: 94 } }));
    await waitForHandshakeAck(extension);

    const messageSpy = vi.fn();
    annotation.on("message", messageSpy);

    extension.send(JSON.stringify({
      type: "annotationResponse",
      payload: {
        version: 1,
        requestId: "req-missing",
        status: "ok",
        payload: {
          url: "https://example.com",
          timestamp: "2026-01-31T00:00:00Z",
          screenshotMode: "none",
          annotations: []
        }
      }
    }));

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(messageSpy).not.toHaveBeenCalled();

    annotation.close();
    extension.close();
  });

  it("ignores invalid annotation events", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    const extension = await connect(`${started.url}/extension`);
    const annotation = await connect(`${started.url}/annotation`);

    extension.send(JSON.stringify({ type: "handshake", payload: { tabId: 95 } }));
    await waitForHandshakeAck(extension);

    const messageSpy = vi.fn();
    annotation.on("message", messageSpy);

    extension.send(JSON.stringify({
      type: "annotationEvent",
      payload: { event: "progress", message: "No request id" }
    }));

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(messageSpy).not.toHaveBeenCalled();

    annotation.close();
    extension.close();
  });

  it("drops annotation events failing payload guards", () => {
    const internal = new RelayServer() as unknown as {
      forwardAnnotationEvent: (message: { type: string; payload: unknown }) => void;
    };

    internal.forwardAnnotationEvent({ type: "annotationEvent", payload: null });
    internal.forwardAnnotationEvent({
      type: "annotationEvent",
      payload: { version: 1, requestId: 123, event: "progress" }
    });
    internal.forwardAnnotationEvent({
      type: "annotationEvent",
      payload: { version: 1, requestId: "req", event: "unknown" }
    });
  });

  it("drops annotation events for unknown request ids", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    const extension = await connect(`${started.url}/extension`);
    const annotation = await connect(`${started.url}/annotation`);

    extension.send(JSON.stringify({ type: "handshake", payload: { tabId: 92 } }));
    await waitForHandshakeAck(extension);

    const messageSpy = vi.fn();
    annotation.on("message", messageSpy);

    extension.send(JSON.stringify({
      type: "annotationEvent",
      payload: { version: 1, requestId: "req-missing", event: "progress", message: "Working" }
    }));

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(messageSpy).not.toHaveBeenCalled();

    annotation.close();
    extension.close();
  });

  it("drops oversized annotation events", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    const extension = await connect(`${started.url}/extension`);
    const annotation = await connect(`${started.url}/annotation`);

    extension.send(JSON.stringify({ type: "handshake", payload: { tabId: 93 } }));
    await waitForHandshakeAck(extension);

    annotation.send(JSON.stringify({
      type: "annotationCommand",
      payload: { version: 1, requestId: "req-event", command: "start" }
    }));
    await nextMessage(extension);

    const relay = RelayServer as unknown as { MAX_ANNOTATION_PAYLOAD_BYTES: number };
    const originalLimit = relay.MAX_ANNOTATION_PAYLOAD_BYTES;
    relay.MAX_ANNOTATION_PAYLOAD_BYTES = 64;
    try {
      const messageSpy = vi.fn();
      annotation.on("message", messageSpy);

      extension.send(JSON.stringify({
        type: "annotationEvent",
        payload: {
          version: 1,
          requestId: "req-event",
          event: "progress",
          message: "x".repeat(256)
        }
      }));

      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(messageSpy).not.toHaveBeenCalled();
    } finally {
      relay.MAX_ANNOTATION_PAYLOAD_BYTES = originalLimit;
    }

    annotation.close();
    extension.close();
  });

  it("rejects oversized annotation responses", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    const extension = await connect(`${started.url}/extension`);
    const annotation = await connect(`${started.url}/annotation`);

    extension.send(JSON.stringify({ type: "handshake", payload: { tabId: 90 } }));
    await waitForHandshakeAck(extension);

    annotation.send(JSON.stringify({
      type: "annotationCommand",
      payload: { version: 1, requestId: "req-large", command: "start" }
    }));
    await nextMessage(extension);

    const relay = RelayServer as unknown as { MAX_ANNOTATION_PAYLOAD_BYTES: number };
    const originalLimit = relay.MAX_ANNOTATION_PAYLOAD_BYTES;
    relay.MAX_ANNOTATION_PAYLOAD_BYTES = 128;
    extension.send(JSON.stringify({
      type: "annotationResponse",
      payload: {
        version: 1,
        requestId: "req-large",
        status: "ok",
        payload: {
          url: "https://example.com",
          timestamp: "2026-01-31T00:00:00Z",
          screenshotMode: "none",
          context: "x".repeat(256),
          annotations: []
        }
      }
    }));

    const response = await nextMessage(annotation);
    expect(response.type).toBe("annotationResponse");
    expect(response.payload).toMatchObject({
      status: "error",
      error: { code: "payload_too_large" }
    });
    relay.MAX_ANNOTATION_PAYLOAD_BYTES = originalLimit;

    annotation.close();
    extension.close();
  });

  it("fails pending annotations when the extension disconnects", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    const extension = await connect(`${started.url}/extension`);
    const annotation = await connect(`${started.url}/annotation`);

    extension.send(JSON.stringify({ type: "handshake", payload: { tabId: 91 } }));
    await waitForHandshakeAck(extension);

    annotation.send(JSON.stringify({
      type: "annotationCommand",
      payload: { version: 1, requestId: "req-drop", command: "start" }
    }));
    await nextMessage(extension);

    extension.close();

    const response = await nextMessage(annotation);
    expect(response.type).toBe("annotationResponse");
    expect(response.payload).toMatchObject({
      status: "error",
      error: { code: "relay_unavailable" }
    });

    annotation.close();
  });

  it("handles buffer extension messages without a socket", async () => {
    server = new RelayServer();
    const internal = server as unknown as { handleExtensionMessage: (data: WebSocket.RawData) => void };
    internal.handleExtensionMessage(Buffer.from(JSON.stringify({ type: "handshake", payload: { tabId: 11 } })));
    expect(server.status().extension?.tabId).toBe(11);
  });

  it("replaces extension connections and rejects extra CDP clients", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    const extension1 = await connect(`${started.url}/extension`);
    const closedPromise = waitForClose(extension1);
    const extension2 = await connect(`${started.url}/extension`);

    const cdp1 = await connect(`${started.url}/cdp`);
    const cdpClosed = waitForClose(cdp1);
    // Create cdp2 but register close handler BEFORE connection completes
    // This ensures we catch the server's close(1008) before it happens
    const cdp2 = new WebSocket(`${started.url}/cdp`);
    const cdp2Closed = waitForClose(cdp2);
    // Wait for cdp2 to fully connect (open event) before proceeding
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("cdp2 connection timeout")), 1000);
      cdp2.once("open", () => {
        clearTimeout(timeout);
        resolve();
      });
      cdp2.once("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    expect(await closedPromise).toBe(1000);
    expect(await cdp2Closed).toBe(1008);

    cdp1.close();
    await cdpClosed;
    extension2.close();
  });

  it("closes CDP clients when extension disconnects", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    const extension = await connect(`${started.url}/extension`);
    const cdp = await connect(`${started.url}/cdp`);
    const cdpClosed = new Promise<number>((resolve) => {
      cdp.once("close", (code) => resolve(code));
    });

    extension.close();
    expect(await cdpClosed).toBe(1011);
  });

  it("ignores malformed relay messages", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    const extension = await connect(`${started.url}/extension`);
    const cdp = await connect(`${started.url}/cdp`);

    extension.send(Buffer.from("not-json"));
    cdp.send(Buffer.from("not-json"));
    cdp.send(JSON.stringify({ id: 1 }));
    extension.send(JSON.stringify({ id: 2, error: { message: "boom" } }));

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(server.status().running).toBe(true);

    extension.close();
    cdp.close();
  });

  it("drops events when CDP is disconnected", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    const extension = await connect(`${started.url}/extension`);
    extension.send(JSON.stringify({ method: "forwardCDPEvent", params: { method: "Runtime.consoleAPICalled" } }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(server.status().cdpConnected).toBe(false);
    extension.close();
  });

  it("responds with error when extension is missing", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    const cdp = await connect(`${started.url}/cdp`);
    cdp.send(JSON.stringify({ id: 9, method: "Browser.getVersion", params: {} }));
    const response = await nextMessage(cdp);
    expect(response.id).toBe(9);
    expect(response.error).toEqual({ message: "Extension not connected to relay" });
    cdp.close();
  });

  it("rejects invalid pairing tokens", async () => {
    server = new RelayServer();
    server.setToken("secret");
    const started = await server.start(0);

    const extension = await connect(`${started.url}/extension`);
    const closed = new Promise<number>((resolve) => {
      extension.once("close", (code) => resolve(code));
    });
    extension.send(JSON.stringify({ type: "handshake", payload: { tabId: 1, pairingToken: "wrong" } }));
    expect(await closed).toBe(1008);
  });

  it("rejects missing pairing tokens when required", async () => {
    server = new RelayServer();
    server.setToken("secret");
    const started = await server.start(0);

    const extension = await connect(`${started.url}/extension`);
    const closed = waitForClose(extension);
    extension.send(JSON.stringify({ type: "handshake", payload: { tabId: 99 } }));
    expect(await closed).toBe(1008);
  });

  it("accepts valid pairing tokens", async () => {
    server = new RelayServer();
    server.setToken("secret");
    const started = await server.start(0);

    const extension = await connect(`${started.url}/extension`);
    extension.send(JSON.stringify({ type: "handshake", payload: { tabId: 42, pairingToken: "secret" } }));
    await waitForHandshakeAck(extension);
    expect(server.status().extension?.tabId).toBe(42);
    extension.close();
  });

  it("sends handshake acknowledgements with relay identity", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    const extension = await connect(`${started.url}/extension`);
    extension.send(JSON.stringify({ type: "handshake", payload: { tabId: 99 } }));
    const ack = await waitForHandshakeAck(extension);
    const payload = ack.payload as Record<string, unknown>;
    expect(typeof payload.instanceId).toBe("string");
    expect(payload.relayPort).toBe(started.port);
    expect(payload.pairingRequired).toBe(false);
    extension.close();
  });

  it("throws when server has no address", async () => {
    vi.resetModules();
    vi.doMock("http", async () => {
      const { EventEmitter } = await import("events");
      return {
        createServer: () => {
          const emitter = new EventEmitter();
          return {
            on: emitter.on.bind(emitter),
            once: emitter.once.bind(emitter),
            listen: (_port: number, _host: string, cb: () => void) => cb(),
            address: () => null,
            close: () => undefined
          };
        }
      };
    });

    const { RelayServer: MockRelayServer } = await import("../src/relay/relay-server");
    const mockServer = new MockRelayServer();
    await expect(mockServer.start(0)).rejects.toThrow("Relay server did not expose a port");
    vi.doUnmock("http");
  });

  describe("Pairing Endpoint", () => {
    it("returns token via /pair endpoint when token is set", async () => {
      server = new RelayServer();
      server.setToken("my-secret-token");
      const started = await server.start(0);

      const response = await fetch(`http://127.0.0.1:${started.port}/pair`, {
        headers: { "Origin": "chrome-extension://abcdefghijklmnop" }
      });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.token).toBe("my-secret-token");
      expect(typeof data.instanceId).toBe("string");
    });

    it("handles /pair preflight for extension origins", async () => {
      server = new RelayServer();
      const started = await server.start(0);

      const response = await fetch(`http://127.0.0.1:${started.port}/pair`, {
        method: "OPTIONS",
        headers: {
          "Origin": EXTENSION_ORIGIN,
          "Access-Control-Request-Method": "GET",
          "Access-Control-Request-Private-Network": "true"
        }
      });
      expect(response.status).toBe(204);
      expect(response.headers.get("access-control-allow-origin")).toBe(EXTENSION_ORIGIN);
      expect(response.headers.get("access-control-allow-private-network")).toBe("true");
    });

    it("does not set CORS headers for /pair preflight from non-extension origins", async () => {
      server = new RelayServer();
      const started = await server.start(0);

      const response = await fetch(`http://127.0.0.1:${started.port}/pair`, {
        method: "OPTIONS",
        headers: {
          "Origin": "https://evil.com",
          "Access-Control-Request-Method": "GET"
        }
      });

      expect(response.status).toBe(204);
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
    });

    it("allows /pair without an Origin header when token is set", async () => {
      server = new RelayServer();
      server.setToken("secret");
      const started = await server.start(0);

      const response = await fetch(`http://127.0.0.1:${started.port}/pair`);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.token).toBe("secret");
    });

    it("rejects /pair from non-extension origins", async () => {
      server = new RelayServer();
      server.setToken("secret");
      const started = await server.start(0);

      const response = await fetch(`http://127.0.0.1:${started.port}/pair`, {
        headers: { "Origin": "https://evil.com" }
      });
      expect(response.status).toBe(403);
    });

    it("allows /pair from chrome-extension origins", async () => {
      server = new RelayServer();
      server.setToken("secret");
      const started = await server.start(0);

      const response = await fetch(`http://127.0.0.1:${started.port}/pair`, {
        headers: { "Origin": "chrome-extension://abcdefghijklmnop" }
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("Access-Control-Allow-Private-Network")).toBe("true");
      const data = await response.json();
      expect(data.token).toBe("secret");
    });

    it("allows /pair from null origins on loopback", async () => {
      server = new RelayServer();
      server.setToken("secret");
      const started = await server.start(0);

      const response = await fetch(`http://127.0.0.1:${started.port}/pair`, {
        headers: { "Origin": "null" }
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("null");
      const data = await response.json();
      expect(data.token).toBe("secret");
    });

    it("handles CORS preflight for /pair", async () => {
      server = new RelayServer();
      const started = await server.start(0);

      const response = await fetch(`http://127.0.0.1:${started.port}/pair`, {
        method: "OPTIONS",
        headers: {
          "Origin": "chrome-extension://abcdefghijklmnop",
          "Access-Control-Request-Method": "GET"
        }
      });
      expect(response.status).toBe(204);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("chrome-extension://abcdefghijklmnop");
      expect(response.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");
    });

    it("returns 404 for unknown HTTP paths", async () => {
      server = new RelayServer();
      const started = await server.start(0);

      const response = await fetch(`http://127.0.0.1:${started.port}/unknown/path`);
      expect(response.status).toBe(404);
    });
  });

  describe("Config Endpoint", () => {
    const extensionOrigin = "chrome-extension://abcdefghijklmnop";

    it("returns relay config for extension origins", async () => {
      server = new RelayServer({ discoveryPort: 0 });
      server.setToken("secret");
      const started = await server.start(0);

      const response = await fetch(`http://127.0.0.1:${started.port}/config`, {
        headers: { "Origin": extensionOrigin }
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("Access-Control-Allow-Private-Network")).toBe("true");
      const data = await response.json();
      expect(data.relayPort).toBe(started.port);
      expect(data.pairingRequired).toBe(true);
      expect(typeof data.instanceId).toBe("string");
      expect("discoveryPort" in data).toBe(true);
    });

    it("allows null origins on loopback", async () => {
      server = new RelayServer({ discoveryPort: 0 });
      server.setToken("secret");
      const started = await server.start(0);

      const response = await fetch(`http://127.0.0.1:${started.port}/config`, {
        headers: { "Origin": "null" }
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("null");
      const data = await response.json();
      expect(data.relayPort).toBe(started.port);
      expect(data.pairingRequired).toBe(true);
    });

    it("returns pairingRequired false when no token is set", async () => {
      server = new RelayServer({ discoveryPort: 0 });
      const started = await server.start(0);

      const response = await fetch(`http://127.0.0.1:${started.port}/config`, {
        headers: { "Origin": extensionOrigin }
      });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.pairingRequired).toBe(false);
    });

    it("returns 503 when relay is not running", async () => {
      server = new RelayServer({ discoveryPort: 0 });
      const response = {
        setHeader: vi.fn(),
        writeHead: vi.fn(),
        end: vi.fn()
      } as unknown as ServerResponse;

      const internal = server as unknown as {
        handleConfigRequest: (req: IncomingMessage, origin: string | undefined, res: ServerResponse) => void;
      };
      const request = {
        headers: { origin: extensionOrigin },
        socket: { remoteAddress: "127.0.0.1" }
      } as unknown as IncomingMessage;
      internal.handleConfigRequest(request, extensionOrigin, response);

      expect(response.writeHead).toHaveBeenCalledWith(503, { "Content-Type": "application/json" });
      expect(response.end).toHaveBeenCalledWith(JSON.stringify({ error: "Relay not running" }));
    });

    it("rejects non-extension origins", async () => {
      server = new RelayServer({ discoveryPort: 0 });
      const started = await server.start(0);

      const response = await fetch(`http://127.0.0.1:${started.port}/config`, {
        headers: { "Origin": "https://evil.com" }
      });
      expect(response.status).toBe(403);
    });

    it("allows loopback config requests without an Origin header when token is set", async () => {
      server = new RelayServer({ discoveryPort: 0 });
      server.setToken("secret");
      const started = await server.start(0);

      const response = await fetch(`http://127.0.0.1:${started.port}/config`);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.relayPort).toBe(started.port);
      expect(data.pairingRequired).toBe(true);
    });

    it("handles CORS preflight for /config", async () => {
      server = new RelayServer({ discoveryPort: 0 });
      const started = await server.start(0);

      const response = await fetch(`http://127.0.0.1:${started.port}/config`, {
        method: "OPTIONS",
        headers: {
          "Origin": extensionOrigin,
          "Access-Control-Request-Method": "GET",
          "Access-Control-Request-Private-Network": "true"
        }
      });
      expect(response.status).toBe(204);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(extensionOrigin);
      expect(response.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");
      expect(response.headers.get("Access-Control-Allow-Private-Network")).toBe("true");
    });

    it("serves discovery config on a dedicated discovery server", async () => {
      server = new RelayServer({ discoveryPort: 0 });
      server.setToken("secret");
      await server.start(0);
      const discoveryPort = server.getDiscoveryPort();
      expect(discoveryPort).toBeTruthy();

      const response = await fetch(`http://127.0.0.1:${discoveryPort}/config`, {
        headers: { "Origin": extensionOrigin }
      });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(typeof data.relayPort).toBe("number");
    });

    it("handles CORS preflight on the discovery server", async () => {
      server = new RelayServer({ discoveryPort: 0 });
      await server.start(0);
      const discoveryPort = server.getDiscoveryPort();
      expect(discoveryPort).toBeTruthy();

      const response = await fetch(`http://127.0.0.1:${discoveryPort}/config`, {
        method: "OPTIONS",
        headers: {
          "Origin": extensionOrigin,
          "Access-Control-Request-Method": "GET"
        }
      });
      expect(response.status).toBe(204);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(extensionOrigin);
    });

    it("no-ops discovery start when relay is not running", async () => {
      server = new RelayServer({ discoveryPort: 0 });
      const internal = server as unknown as { startDiscoveryServer: () => Promise<void> };
      await internal.startDiscoveryServer();
      expect(server.getDiscoveryPort()).toBeNull();
    });

    it("no-ops discovery start when discovery server already exists", async () => {
      server = new RelayServer({ discoveryPort: 0 });
      await server.start(0);
      const internal = server as unknown as { startDiscoveryServer: () => Promise<void> };
      await internal.startDiscoveryServer();
      expect(server.getDiscoveryPort()).toBeTruthy();
    });

    it("returns 404 for unknown discovery paths", async () => {
      server = new RelayServer({ discoveryPort: 0 });
      await server.start(0);
      const discoveryPort = server.getDiscoveryPort();
      expect(discoveryPort).toBeTruthy();

      const response = await fetch(`http://127.0.0.1:${discoveryPort}/unknown`, {
        headers: { "Origin": extensionOrigin }
      });
      expect(response.status).toBe(404);
    });

    it("warns when discovery server has no address", async () => {
      vi.resetModules();
      vi.doMock("http", async () => {
        const { EventEmitter } = await import("events");
        let callCount = 0;
        return {
          createServer: () => {
            callCount += 1;
            const emitter = new EventEmitter();
            return {
              on: emitter.on.bind(emitter),
              once: emitter.once.bind(emitter),
              listen: (_port: number, _host: string, cb: () => void) => cb(),
              address: () => (callCount === 1 ? ({ port: 1234 } as AddressInfo) : null),
              close: () => undefined
            };
          }
        };
      });

      const { RelayServer: MockRelayServer } = await import("../src/relay/relay-server");
      const mockServer = new MockRelayServer({ discoveryPort: 0 });
      await mockServer.start(0);
      const warn = warnSpy;
      if (!warn) {
        throw new Error("warnSpy missing");
      }
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("Discovery server failed to start"));
      mockServer.stop();
      vi.doUnmock("http");
    });

    it("skips discovery server when relay port matches discovery port", async () => {
      const port = await getAvailablePort();
      server = new RelayServer({ discoveryPort: port });
      const started = await server.start(port);
      expect(started.port).toBe(port);
      expect(server.getDiscoveryPort()).toBe(port);
    });
  });

  describe("Status Endpoint", () => {
    it("responds to extension health checks", async () => {
      server = new RelayServer();
      const started = await server.start(0);

      const extension = await connect(`${started.url}/extension`);
      extension.send(JSON.stringify({ type: "healthCheck", id: "hc-1" }));

      const response = await nextMessage(extension);
      expect(response.type).toBe("healthCheckResult");
      expect(response.id).toBe("hc-1");
      expect(response.payload).toMatchObject({
        ok: false,
        reason: "handshake_incomplete",
        extensionConnected: true,
        extensionHandshakeComplete: false
      });

      extension.close();
    });

    it("responds to extension ping with pong", async () => {
      server = new RelayServer();
      const started = await server.start(0);

      const extension = await connect(`${started.url}/extension`);
      extension.send(JSON.stringify({ type: "ping", id: "ping-1" }));

      const response = await nextMessage(extension);
      expect(response.type).toBe("pong");
      expect(response.id).toBe("ping-1");
      expect(response.payload).toMatchObject({ reason: "handshake_incomplete" });

      extension.close();
    });

    it("returns token-free relay status", async () => {
      server = new RelayServer();
      server.setToken("secret");
      const started = await server.start(0);

      const response = await fetch(`http://127.0.0.1:${started.port}/status`, {
        headers: { Authorization: "Bearer secret" }
      });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(typeof data.instanceId).toBe("string");
      expect(data.extensionConnected).toBe(false);
      expect(data.extensionHandshakeComplete).toBe(false);
      expect(data.pairingRequired).toBe(true);
      expect("token" in data).toBe(false);
      expect("pairingToken" in data).toBe(false);
    });

    it("exposes lastHandshakeError and clears it after success", async () => {
      server = new RelayServer();
      server.setToken("secret");
      const started = await server.start(0);

      const extension = await connect(`${started.url}/extension`);
      const closed = waitForClose(extension);
      extension.send(JSON.stringify({ type: "handshake", payload: { tabId: 1 } }));
      await closed;

      let response = await fetch(`http://127.0.0.1:${started.port}/status`);
      let data = await response.json();
      expect(data.lastHandshakeError?.code).toBe("pairing_missing");
      expect(data.health?.reason).toBe("pairing_required");

      const extension2 = await connect(`${started.url}/extension`);
      extension2.send(JSON.stringify({ type: "handshake", payload: { tabId: 1, pairingToken: "secret" } }));
      await waitForHandshakeAck(extension2);

      response = await fetch(`http://127.0.0.1:${started.port}/status`);
      data = await response.json();
      expect(data.lastHandshakeError).toBeUndefined();
      expect(data.health?.ok).toBe(true);

      extension2.close();
    });

    it("reports pairing_invalid when the handshake token is wrong", async () => {
      server = new RelayServer();
      server.setToken("secret");
      const started = await server.start(0);

      const extension = await connect(`${started.url}/extension`);
      const closed = waitForClose(extension);
      extension.send(JSON.stringify({ type: "handshake", payload: { tabId: 2, pairingToken: "wrong" } }));
      await closed;

      const response = await fetch(`http://127.0.0.1:${started.port}/status`);
      const data = await response.json();
      expect(data.lastHandshakeError?.code).toBe("pairing_invalid");
      expect(data.health?.reason).toBe("pairing_invalid");
    });

    it("serves status on the discovery server when enabled", async () => {
      server = new RelayServer({ discoveryPort: 0 });
      await server.start(0);
      const discoveryPort = server.getDiscoveryPort();
      expect(discoveryPort).toBeTruthy();

      const response = await fetch(`http://127.0.0.1:${discoveryPort}/status`);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(typeof data.instanceId).toBe("string");
    });

    it("rejects status requests from non-extension origins", async () => {
      server = new RelayServer();
      const started = await server.start(0);

      const response = await fetch(`http://127.0.0.1:${started.port}/status`, {
        headers: { "Origin": "https://evil.com" }
      });
      expect(response.status).toBe(403);
    });

    it("sets CORS headers for extension-origin status requests", async () => {
      server = new RelayServer();
      const started = await server.start(0);

      const response = await fetch(`http://127.0.0.1:${started.port}/status`, {
        headers: { "Origin": "chrome-extension://abcdefghijklmnop" }
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("chrome-extension://abcdefghijklmnop");
    });

    it("handles status preflight on the main server", async () => {
      server = new RelayServer();
      const started = await server.start(0);

      const response = await fetch(`http://127.0.0.1:${started.port}/status`, {
        method: "OPTIONS",
        headers: {
          "Origin": "chrome-extension://abcdefghijklmnop",
          "Access-Control-Request-Method": "GET",
          "Access-Control-Request-Private-Network": "true"
        }
      });
      expect(response.status).toBe(204);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("chrome-extension://abcdefghijklmnop");
      expect(response.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");
      expect(response.headers.get("Access-Control-Allow-Private-Network")).toBe("true");
    });

    it("handles status preflight on the discovery server", async () => {
      server = new RelayServer({ discoveryPort: 0 });
      await server.start(0);
      const discoveryPort = server.getDiscoveryPort();
      expect(discoveryPort).toBeTruthy();

      const response = await fetch(`http://127.0.0.1:${discoveryPort}/status`, {
        method: "OPTIONS",
        headers: {
          "Origin": "chrome-extension://abcdefghijklmnop",
          "Access-Control-Request-Method": "GET"
        }
      });
      expect(response.status).toBe(204);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("chrome-extension://abcdefghijklmnop");
      expect(response.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");
    });
  });

  describe("Security Features", () => {
    it("uses timing-safe token comparison", async () => {
      server = new RelayServer();
      server.setToken("correct-token-value");
      const started = await server.start(0);

      const ext1 = await connect(`${started.url}/extension`);
      const closed1 = waitForClose(ext1);
      ext1.send(JSON.stringify({ type: "handshake", payload: { tabId: 1, pairingToken: "wrong-token-value1" } }));
      expect(await closed1).toBe(1008);

      const ext2 = await connect(`${started.url}/extension`);
      const closed2 = waitForClose(ext2);
      ext2.send(JSON.stringify({ type: "handshake", payload: { tabId: 1, pairingToken: "correct-token-valu" } }));
      expect(await closed2).toBe(1008);

      const ext3 = await connect(`${started.url}/extension`);
      ext3.send(JSON.stringify({ type: "handshake", payload: { tabId: 1, pairingToken: "correct-token-value" } }));
      await waitForHandshakeAck(ext3);
      expect(server.status().extension?.tabId).toBe(1);
      ext3.close();
    });

    it("requires token for /cdp when pairing is enabled", async () => {
      server = new RelayServer();
      server.setToken("secret-token");
      const started = await server.start(0);

      const missing = await upgradeRequest({ port: started.port, path: "/cdp" });
      expect(missing).toBe(401);

      const invalid = await upgradeRequest({ port: started.port, path: "/cdp?token=wrong" });
      expect(invalid).toBe(401);

      const valid = await upgradeRequest({ port: started.port, path: "/cdp?token=secret-token" });
      expect(valid).toBe(101);
    });

    it("requires token for /annotation when pairing is enabled", async () => {
      server = new RelayServer();
      server.setToken("secret-token");
      const started = await server.start(0);

      const missing = await upgradeRequest({ port: started.port, path: "/annotation" });
      expect(missing).toBe(401);

      const invalid = await upgradeRequest({ port: started.port, path: "/annotation?token=wrong" });
      expect(invalid).toBe(401);

      const valid = await upgradeRequest({ port: started.port, path: "/annotation?token=secret-token" });
      expect(valid).toBe(101);
    });

    it("rejects /cdp upgrades from non-extension origins", async () => {
      server = new RelayServer();
      const started = await server.start(0);

      const response = await upgradeRequest({ port: started.port, path: "/cdp", origin: "https://evil.com" });
      expect(response).toBe(403);
    });

    it("rejects /annotation upgrades from non-extension origins", async () => {
      server = new RelayServer();
      const started = await server.start(0);

      const response = await upgradeRequest({ port: started.port, path: "/annotation", origin: "https://evil.com" });
      expect(response).toBe(403);
    });

    it("rejects /cdp upgrades from non-loopback without origin", async () => {
      server = new RelayServer();
      await server.start(0);

      const internal = server as unknown as { server?: { emit: (event: string, ...args: unknown[]) => void } };
      const socket = { write: vi.fn(), destroy: vi.fn() };
      const request = { url: "/cdp", headers: {}, socket: { remoteAddress: "10.0.0.1" } };
      internal.server?.emit("upgrade", request, socket, Buffer.from(""));

      expect(socket.write).toHaveBeenCalledWith(expect.stringContaining("403"));
      expect(socket.destroy).toHaveBeenCalled();
    });

    it("rate limits repeated /cdp upgrades", async () => {
      server = new RelayServer();
      await server.start(0);

      const internal = server as unknown as {
        server?: { emit: (event: string, ...args: unknown[]) => void };
        handshakeAttempts: Map<string, { count: number; resetAt: number }>;
      };
      internal.handshakeAttempts.set("127.0.0.1", {
        count: (RelayServer as unknown as { MAX_HANDSHAKE_ATTEMPTS: number }).MAX_HANDSHAKE_ATTEMPTS,
        resetAt: Date.now() + 60_000
      });

      const socket = { write: vi.fn(), destroy: vi.fn() };
      const request = { url: "/cdp", headers: {}, socket: { remoteAddress: "127.0.0.1" } };
      internal.server?.emit("upgrade", request, socket, Buffer.from(""));

      expect(socket.write).toHaveBeenCalledWith(expect.stringContaining("429"));
      expect(socket.destroy).toHaveBeenCalled();
    });

    it("rejects /annotation upgrades from non-loopback without origin", async () => {
      server = new RelayServer();
      await server.start(0);

      const internal = server as unknown as { server?: { emit: (event: string, ...args: unknown[]) => void } };
      const socket = { write: vi.fn(), destroy: vi.fn() };
      const request = { url: "/annotation", headers: {}, socket: { remoteAddress: "10.0.0.2" } };
      internal.server?.emit("upgrade", request, socket, Buffer.from(""));

      expect(socket.write).toHaveBeenCalledWith(expect.stringContaining("403"));
      expect(socket.destroy).toHaveBeenCalled();
    });

    it("rate limits repeated /annotation upgrades", async () => {
      server = new RelayServer();
      await server.start(0);

      const internal = server as unknown as {
        server?: { emit: (event: string, ...args: unknown[]) => void };
        handshakeAttempts: Map<string, { count: number; resetAt: number }>;
      };
      internal.handshakeAttempts.set("127.0.0.1", {
        count: (RelayServer as unknown as { MAX_HANDSHAKE_ATTEMPTS: number }).MAX_HANDSHAKE_ATTEMPTS,
        resetAt: Date.now() + 60_000
      });

      const socket = { write: vi.fn(), destroy: vi.fn() };
      const request = { url: "/annotation", headers: {}, socket: { remoteAddress: "127.0.0.1" } };
      internal.server?.emit("upgrade", request, socket, Buffer.from(""));

      expect(socket.write).toHaveBeenCalledWith(expect.stringContaining("429"));
      expect(socket.destroy).toHaveBeenCalled();
    });

    it("blocks web page origins (CSWSH prevention)", async () => {
      server = new RelayServer();
      const started = await server.start(0);

      const req = http.request({
        hostname: "127.0.0.1",
        port: started.port,
        path: "/extension",
        method: "GET",
        headers: {
          "Connection": "Upgrade",
          "Upgrade": "websocket",
          "Origin": "https://evil.com",
          "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
          "Sec-WebSocket-Version": "13"
        }
      });

      const response = await new Promise<http.IncomingMessage>((resolve) => {
        req.on("response", resolve);
        req.end();
      });

      expect(response.statusCode).toBe(403);
    });

    it("allows chrome-extension origins", async () => {
      server = new RelayServer();
      const started = await server.start(0);

      const req = http.request({
        hostname: "127.0.0.1",
        port: started.port,
        path: "/extension",
        method: "GET",
        headers: {
          "Connection": "Upgrade",
          "Upgrade": "websocket",
          "Origin": "chrome-extension://abcdefghijklmnop",
          "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
          "Sec-WebSocket-Version": "13"
        }
      });

      const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
        req.on("response", resolve);
        req.on("upgrade", () => resolve({ statusCode: 101 } as http.IncomingMessage));
        req.on("error", reject);
        req.end();
      });

      expect(response.statusCode).toBe(101);
    });

    it("rate limits handshake attempts", async () => {
      server = new RelayServer();
      server.setToken("secret-token");
      const started = await server.start(0);

      for (let i = 0; i < 5; i++) {
        const ext = await connect(`${started.url}/extension`);
        ext.send(JSON.stringify({ type: "handshake", payload: { tabId: 1, pairingToken: "wrong" } }));
        await waitForClose(ext);
      }

      const req = http.request({
        hostname: "127.0.0.1",
        port: started.port,
        path: "/extension",
        method: "GET",
        headers: {
          "Connection": "Upgrade",
          "Upgrade": "websocket",
          "Origin": "chrome-extension://abcdefghijklmnop",
          "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
          "Sec-WebSocket-Version": "13"
        }
      });

      const response = await new Promise<http.IncomingMessage>((resolve) => {
        req.on("response", resolve);
        req.end();
      });

      expect(response.statusCode).toBe(429);
    });

    it("enforces CDP command allowlist when set", async () => {
      server = new RelayServer();
      server.setCdpAllowlist(["Page.navigate", "Runtime.evaluate"]);
      const started = await server.start(0);

      const extension = await connect(`${started.url}/extension`);
      const cdp = await connect(`${started.url}/cdp`);

      extension.send(JSON.stringify({ type: "handshake", payload: { tabId: 7 } }));
      await waitForHandshakeAck(extension);

      cdp.send(JSON.stringify({ id: 1, method: "Browser.getVersion", params: {} }));
      const response = await nextMessage(cdp);
      expect(response.id).toBe(1);
      expect(response.error).toBeDefined();
      expect((response.error as { message: string }).message).toContain("not in allowlist");

      extension.close();
      cdp.close();
    });

    it("allows all commands when allowlist is empty", async () => {
      server = new RelayServer();
      server.setCdpAllowlist([]);
      const started = await server.start(0);

      const extension = await connect(`${started.url}/extension`);
      const cdp = await connect(`${started.url}/cdp`);

      extension.send(JSON.stringify({ type: "handshake", payload: { tabId: 7 } }));
      await waitForHandshakeAck(extension);

      const commandPromise = nextMessage(extension);
      cdp.send(JSON.stringify({ id: 1, method: "Browser.getVersion", params: {} }));
      const command = await commandPromise;
      expect(command.method).toBe("forwardCDPCommand");

      extension.close();
      cdp.close();
    });
  });
});
