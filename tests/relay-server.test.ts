import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WebSocket } from "ws";
import http from "http";
import type { IncomingMessage, ServerResponse } from "http";
import type { AddressInfo } from "net";
import { EventEmitter } from "events";
import { RelayServer } from "../src/relay/relay-server";
import { ANNOTATION_MANUAL_COMPLETION_TIMEOUT_MESSAGE } from "../src/annotate/timeout-messages";

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

const nextMessageWithTimeout = async (socket: WebSocket, timeoutMs = 4000): Promise<Record<string, unknown>> => {
  return await Promise.race([
    nextMessage(socket),
    new Promise<Record<string, unknown>>((_, reject) => {
      setTimeout(() => reject(new Error("Timed out waiting for socket message")), timeoutMs);
    })
  ]);
};

const waitForHandshakeAck = async (socket: WebSocket): Promise<Record<string, unknown>> => {
  const message = await nextMessage(socket);
  expect(message.type).toBe("handshakeAck");
  return message;
};

const waitForCondition = async (predicate: () => boolean, timeoutMs = 250): Promise<void> => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start >= timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
  }
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

  it("returns null ops and canvas urls when not running", () => {
    server = new RelayServer();
    expect(server.getOpsUrl()).toBeNull();
    expect(server.getCanvasUrl()).toBeNull();
  });

  it("returns ops url when running", async () => {
    server = new RelayServer();
    const started = await server.start(0);
    expect(server.getOpsUrl()).toBe(`${started.url}/ops`);
  });

  it("returns canvas url when running", async () => {
    server = new RelayServer();
    const started = await server.start(0);
    expect(server.getCanvasUrl()).toBe(`${started.url}/canvas`);
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
      authorizeHttpRequest: (pathname: string, origin: string | undefined, req: IncomingMessage, res: ServerResponse) => boolean;
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

    expect(internal.authorizeHttpRequest("/status", undefined, request, response)).toBe(false);
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
    expect(internal.authorizeHttpRequest("/status", undefined, limitedRequest, limitedResponse)).toBe(false);
    expect(limitedResponse.writeHead).toHaveBeenCalledWith(429, { "Content-Type": "application/json" });
  });

  it("bypasses generic http throttling for loopback /config requests without an origin", () => {
    server = new RelayServer();
    const internal = server as unknown as {
      authorizeHttpRequest: (pathname: string, origin: string | undefined, req: IncomingMessage, res: ServerResponse) => boolean;
      httpAttempts: Map<string, { count: number; resetAt: number }>;
    };
    const response = {
      setHeader: vi.fn(),
      writeHead: vi.fn(),
      end: vi.fn()
    } as unknown as ServerResponse;

    internal.httpAttempts.set("127.0.0.1", {
      count: (RelayServer as unknown as { MAX_HTTP_ATTEMPTS: number }).MAX_HTTP_ATTEMPTS,
      resetAt: Date.now() + 60_000
    });

    expect(internal.authorizeHttpRequest("/config", undefined, {
      headers: {},
      socket: { remoteAddress: "127.0.0.1" }
    } as IncomingMessage, response)).toBe(true);
    expect(response.writeHead).not.toHaveBeenCalled();
  });

  it("authorizes extension-origin and loopback http requests", () => {
    server = new RelayServer();
    const internal = server as unknown as {
      authorizeHttpRequest: (pathname: string, origin: string | undefined, req: IncomingMessage, res: ServerResponse) => boolean;
    };

    const extensionResponse = {
      setHeader: vi.fn(),
      writeHead: vi.fn(),
      end: vi.fn()
    } as unknown as ServerResponse;
    const extensionRequest = {
      headers: {},
      socket: { remoteAddress: "10.0.0.1" }
    } as unknown as IncomingMessage;
    expect(internal.authorizeHttpRequest("/status", EXTENSION_ORIGIN, extensionRequest, extensionResponse)).toBe(true);
    expect(extensionResponse.writeHead).not.toHaveBeenCalled();

    const loopbackResponse = {
      setHeader: vi.fn(),
      writeHead: vi.fn(),
      end: vi.fn()
    } as unknown as ServerResponse;
    const loopbackRequest = {
      headers: {},
      socket: { remoteAddress: "127.0.0.1" }
    } as unknown as IncomingMessage;
    expect(internal.authorizeHttpRequest("/status", undefined, loopbackRequest, loopbackResponse)).toBe(true);
    expect(loopbackResponse.writeHead).not.toHaveBeenCalled();
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

  it("allows null-origin config preflight requests", () => {
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

    internal.handleConfigPreflight("null", request, response);

    expect(response.setHeader).toHaveBeenCalledWith("Access-Control-Allow-Origin", "null");
    expect(response.writeHead).toHaveBeenCalledWith(204);
  });

  it("recognizes ops-owned target ids only for tracked numeric tab ids", () => {
    server = new RelayServer();
    const internal = server as unknown as {
      opsOwnedTabIds: Set<number>;
      isOpsOwnedTargetId: (targetId: string) => boolean;
    };
    internal.opsOwnedTabIds.add(12);

    expect(internal.isOpsOwnedTargetId("tab-12")).toBe(true);
    expect(internal.isOpsOwnedTargetId("tab-")).toBe(false);
    expect(internal.isOpsOwnedTargetId("tab-bad")).toBe(false);
    expect(internal.isOpsOwnedTargetId("page-12")).toBe(false);
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

  it("rejects upgrades when request metadata is missing", async () => {
    server = new RelayServer();
    await server.start(0);
    const internal = server as unknown as { server?: { emit: (event: string, ...args: unknown[]) => void } };
    const destroy = vi.fn();
    internal.server?.emit(
      "upgrade",
      { url: undefined, headers: {}, socket: { remoteAddress: undefined } },
      { destroy, write: vi.fn() },
      Buffer.from("")
    );
    expect(destroy).toHaveBeenCalled();
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

  it("rejects canvas upgrades when pairing is required and no token is provided", async () => {
    server = new RelayServer();
    server.setToken("secret");
    const started = await server.start(0);

    await expect(upgradeRequest({
      port: started.port,
      path: "/canvas"
    })).resolves.toBe(401);
  });

  it("rejects canvas upgrades from non-extension origins", async () => {
    server = new RelayServer();
    await server.start(0);
    const internal = server as unknown as { server?: { emit: (event: string, ...args: unknown[]) => void } };
    const write = vi.fn();
    const destroy = vi.fn();

    internal.server?.emit(
      "upgrade",
      {
        url: "/canvas",
        headers: { origin: "https://evil.com" },
        socket: { remoteAddress: "127.0.0.1" }
      },
      { write, destroy },
      Buffer.from("")
    );

    expect(write).toHaveBeenCalledWith("HTTP/1.1 403 Forbidden\r\n\r\n");
    expect(destroy).toHaveBeenCalled();
  });

  it("rejects canvas upgrades from non-loopback addresses without origin", async () => {
    server = new RelayServer();
    await server.start(0);
    const internal = server as unknown as { server?: { emit: (event: string, ...args: unknown[]) => void } };
    const write = vi.fn();
    const destroy = vi.fn();

    internal.server?.emit(
      "upgrade",
      {
        url: "/canvas",
        headers: {},
        socket: { remoteAddress: "10.0.0.1" }
      },
      { write, destroy },
      Buffer.from("")
    );

    expect(write).toHaveBeenCalledWith("HTTP/1.1 403 Forbidden\r\n\r\n");
    expect(destroy).toHaveBeenCalled();
  });

  it("allows chrome-extension origins on ops and canvas upgrades", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    await expect(upgradeRequest({
      port: started.port,
      path: "/ops",
      origin: EXTENSION_ORIGIN
    })).resolves.toBe(101);
    await expect(upgradeRequest({
      port: started.port,
      path: "/canvas",
      origin: EXTENSION_ORIGIN
    })).resolves.toBe(101);
  });

  it("returns canvas_unavailable when no extension is connected", async () => {
    server = new RelayServer();
    const started = await server.start(0);
    const canvas = await connect(`${started.url}/canvas`);

    canvas.send(JSON.stringify({
      type: "canvas_hello",
      version: "1"
    }));

    await expect(nextMessage(canvas)).resolves.toMatchObject({
      type: "canvas_error",
      error: { code: "canvas_unavailable" }
    });
    canvas.close();
  });

  it("returns canvas_unavailable when extension state is stale-closed", async () => {
    server = new RelayServer();
    const started = await server.start(0);
    const extension = await connect(`${started.url}/extension`);
    extension.send(JSON.stringify({ type: "handshake", payload: { tabId: 7 } }));
    await waitForHandshakeAck(extension);

    const internal = server as unknown as {
      extensionSocket: WebSocket | null;
      extensionHandshakeComplete: boolean;
    };
    internal.extensionSocket = { readyState: WebSocket.CLOSED, close: vi.fn() } as unknown as WebSocket;
    internal.extensionHandshakeComplete = true;

    const canvas = await connect(`${started.url}/canvas`);
    canvas.send(JSON.stringify({
      type: "canvas_hello",
      version: "1"
    }));

    await expect(nextMessage(canvas)).resolves.toMatchObject({
      type: "canvas_error",
      error: { code: "canvas_unavailable" }
    });

    canvas.close();
    extension.close();
  });

  it("forwards canvas hello/ack through the extension socket", async () => {
    server = new RelayServer();
    const started = await server.start(0);
    const extension = await connect(`${started.url}/extension`);
    extension.send(JSON.stringify({
      type: "handshake",
      payload: {
        tabId: 1,
        url: "https://example.com",
        title: "Example"
      }
    }));
    await waitForHandshakeAck(extension);

    const canvas = await connect(`${started.url}/canvas`);
    canvas.send(JSON.stringify({
      type: "canvas_hello",
      version: "1"
    }));

    const forwarded = await nextMessage(extension);
    expect(forwarded).toMatchObject({
      type: "canvas_hello",
      version: "1",
      clientId: expect.any(String)
    });

    extension.send(JSON.stringify({
      type: "canvas_hello_ack",
      version: "1",
      clientId: forwarded.clientId,
      maxPayloadBytes: 1024
    }));

    await expect(nextMessage(canvas)).resolves.toMatchObject({
      type: "canvas_hello_ack",
      version: "1",
      maxPayloadBytes: 1024
    });

    canvas.close();
    extension.close();
  });

  it("drops canvas hello acknowledgements for unknown clients", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    const extension = await connect(`${started.url}/extension`);
    const canvas = await connect(`${started.url}/canvas`);

    extension.send(JSON.stringify({ type: "handshake", payload: { tabId: 2 } }));
    await waitForHandshakeAck(extension);

    canvas.send(JSON.stringify({ type: "canvas_hello", version: "1" }));
    const forwarded = await nextMessage(extension);
    expect(forwarded.type).toBe("canvas_hello");

    extension.send(JSON.stringify({
      type: "canvas_hello_ack",
      version: "1",
      clientId: "missing-client",
      maxPayloadBytes: 1024
    }));

    expect(server.status().canvasConnected).toBe(true);
    canvas.close();
    extension.close();
  });

  it("ignores canvas extension messages without a client id", () => {
    const internal = new RelayServer() as unknown as {
      handleCanvasExtensionMessage: (message: Record<string, unknown>) => void;
      sendJson: (socket: unknown, message: unknown) => void;
      canvasClients: Map<string, unknown>;
    };

    const sendSpy = vi.spyOn(internal, "sendJson");
    internal.canvasClients.set("canvas-client-1", {});

    internal.handleCanvasExtensionMessage({
      type: "canvas_hello_ack",
      version: "1"
    });

    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("ignores canvas extension messages for unknown clients", () => {
    const internal = new RelayServer() as unknown as {
      handleCanvasExtensionMessage: (message: Record<string, unknown>) => void;
      sendJson: (socket: unknown, message: unknown) => void;
      canvasClients: Map<string, unknown>;
    };

    const sendSpy = vi.spyOn(internal, "sendJson");
    internal.canvasClients.set("canvas-client-1", {});

    internal.handleCanvasExtensionMessage({
      type: "canvas_hello_ack",
      version: "1",
      clientId: "missing-client"
    });

    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("rejects invalid canvas messages", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    const extension = await connect(`${started.url}/extension`);
    const canvas = await connect(`${started.url}/canvas`);

    extension.send(JSON.stringify({ type: "handshake", payload: { tabId: 26 } }));
    await waitForHandshakeAck(extension);

    canvas.send(JSON.stringify({ type: "canvas_bad_payload" }));
    const response = await nextMessage(canvas);
    expect(response.type).toBe("canvas_error");
    expect(response.error).toMatchObject({ code: "invalid_request" });

    canvas.close();
    extension.close();
  });

  it("ignores non-object canvas messages", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    const extension = await connect(`${started.url}/extension`);
    const canvas = await connect(`${started.url}/canvas`);

    extension.send(JSON.stringify({ type: "handshake", payload: { tabId: 27 } }));
    await waitForHandshakeAck(extension);

    canvas.send("null");
    await new Promise((resolve) => setTimeout(resolve, 10));

    canvas.close();
    extension.close();
  });

  it("rejects oversized canvas payloads", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    const extension = await connect(`${started.url}/extension`);
    const canvas = await connect(`${started.url}/canvas`);

    extension.send(JSON.stringify({ type: "handshake", payload: { tabId: 28 } }));
    await waitForHandshakeAck(extension);

    const relay = RelayServer as unknown as { MAX_CANVAS_PAYLOAD_BYTES: number };
    const originalLimit = relay.MAX_CANVAS_PAYLOAD_BYTES;
    relay.MAX_CANVAS_PAYLOAD_BYTES = 128;
    try {
      canvas.send(JSON.stringify({
        type: "canvas_request",
        requestId: "canvas-big",
        command: "canvas.preview.render",
        payload: { data: "x".repeat(256) }
      }));
      const response = await nextMessage(canvas);
      expect(response.type).toBe("canvas_error");
      expect(response.error).toMatchObject({
        code: "invalid_request",
        details: { maxPayloadBytes: 128 }
      });
    } finally {
      relay.MAX_CANVAS_PAYLOAD_BYTES = originalLimit;
    }

    canvas.close();
    extension.close();
  }, 15000);

  it("sends canvas_client_disconnected when canvas socket closes", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    const extension = await connect(`${started.url}/extension`);
    const canvas = await connect(`${started.url}/canvas`);

    extension.send(JSON.stringify({ type: "handshake", payload: { tabId: 29 } }));
    await waitForHandshakeAck(extension);

    canvas.close();
    const message = await nextMessage(extension);
    expect(message.type).toBe("canvas_event");
    expect(message.event).toBe("canvas_client_disconnected");

    extension.close();
  });

  it("sends canvas_client_disconnected when canvas socket errors", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    const extension = await connect(`${started.url}/extension`);
    await connect(`${started.url}/canvas`);

    extension.send(JSON.stringify({ type: "handshake", payload: { tabId: 30 } }));
    await waitForHandshakeAck(extension);

    const internal = server as unknown as { canvasClients: Map<string, WebSocket> };
    const serverSocket = internal.canvasClients.values().next().value as WebSocket | undefined;
    serverSocket?.emit("error", new Error("boom"));

    const message = await nextMessage(extension);
    expect(message.type).toBe("canvas_event");
    expect(message.event).toBe("canvas_client_disconnected");

    extension.close();
  });

  it("ignores canvas_hello_ack when no canvas clients are connected", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    const extension = await connect(`${started.url}/extension`);
    extension.send(JSON.stringify({ type: "handshake", payload: { tabId: 31 } }));
    await waitForHandshakeAck(extension);

    extension.send(JSON.stringify({
      type: "canvas_hello_ack",
      version: "1",
      clientId: "missing-client",
      maxPayloadBytes: 1024,
      capabilities: []
    }));

    expect(server.status().canvasConnected).toBe(false);
    extension.close();
  });

  it("rejects canvas upgrades with invalid tokens and accepts valid tokens", async () => {
    server = new RelayServer();
    const started = await server.start(0);
    server.setToken("secret");

    const invalid = await upgradeRequest({ port: started.port, path: "/canvas?token=bad" });
    const valid = await upgradeRequest({ port: started.port, path: "/canvas?token=secret" });

    expect(invalid).toBe(401);
    expect(valid).toBe(101);
  });

  it("rate limits canvas upgrades", async () => {
    server = new RelayServer();
    await server.start(0);
    const internal = server as unknown as {
      server?: { emit: (event: string, ...args: unknown[]) => void };
      handshakeAttempts: Map<string, { count: number; resetAt: number }>;
    };
    internal.handshakeAttempts.set("/canvas:127.0.0.1", {
      count: (RelayServer as unknown as { MAX_HANDSHAKE_ATTEMPTS: number }).MAX_HANDSHAKE_ATTEMPTS,
      resetAt: Date.now() + 60_000
    });
    const write = vi.fn();
    const destroy = vi.fn();
    internal.server?.emit(
      "upgrade",
      { url: "/canvas", headers: {}, socket: { remoteAddress: "127.0.0.1" } },
      { write, destroy },
      Buffer.from("")
    );
    expect(write).toHaveBeenCalledWith("HTTP/1.1 429 Too Many Requests\r\n\r\n");
    expect(destroy).toHaveBeenCalled();
  });

  it("rate limits ops upgrades", async () => {
    server = new RelayServer();
    await server.start(0);
    const internal = server as unknown as {
      server?: { emit: (event: string, ...args: unknown[]) => void };
      handshakeAttempts: Map<string, { count: number; resetAt: number }>;
    };
    internal.handshakeAttempts.set("/ops:127.0.0.1", {
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

  it("does not accumulate rate-limit debt across successful ops upgrades", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    for (let attempt = 0; attempt < 7; attempt += 1) {
      const ops = await connect(`${started.url}/ops`);
      ops.close();
      await waitForClose(ops);
    }
  });

  it("keeps /extension rate limits from spilling into /ops upgrades", async () => {
    server = new RelayServer();
    server.setToken("secret-token");
    const started = await server.start(0);
    const internal = server as unknown as {
      handshakeAttempts: Map<string, { count: number; resetAt: number }>;
    };
    internal.handshakeAttempts.set("/extension:127.0.0.1", {
      count: (RelayServer as unknown as { MAX_HANDSHAKE_ATTEMPTS: number }).MAX_HANDSHAKE_ATTEMPTS,
      resetAt: Date.now() + 60_000
    });

    const status = await upgradeRequest({ port: started.port, path: "/ops?token=secret-token" });
    expect(status).toBe(101);
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

  it("clears extension state and closes cdp when the extension socket errors", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    const extension = await connect(`${started.url}/extension`);
    const cdp = await connect(`${started.url}/cdp`);

    extension.send(JSON.stringify({ type: "handshake", payload: { tabId: 31 } }));
    await waitForHandshakeAck(extension);

    const internal = server as unknown as { extensionSocket: WebSocket | null };
    const extensionClosed = waitForClose(extension);
    const cdpClosed = waitForClose(cdp);
    internal.extensionSocket?.emit("error", new Error("boom"));

    await expect(extensionClosed).resolves.toBe(1011);
    await expect(cdpClosed).resolves.toBe(1011);
    expect(server.status().extensionConnected).toBe(false);
    expect(server.status().extensionHandshakeComplete).toBe(false);
  });

  it("closes ops clients when the extension socket disconnects", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    const extension = await connect(`${started.url}/extension`);
    const ops = await connect(`${started.url}/ops`);

    extension.send(JSON.stringify({ type: "handshake", payload: { tabId: 41 } }));
    await waitForHandshakeAck(extension);

    ops.send(JSON.stringify({ type: "ops_hello", version: "1", maxPayloadBytes: 1024 }));
    const forwardedHello = await nextMessage(extension);
    const clientId = String(forwardedHello.clientId);
    extension.send(JSON.stringify({
      type: "ops_hello_ack",
      version: "1",
      clientId,
      maxPayloadBytes: 1024,
      capabilities: []
    }));
    await nextMessage(ops);
    expect(server.status().opsConnected).toBe(true);

    const opsClosed = waitForClose(ops);
    extension.close();

    await expect(opsClosed).resolves.toBe(1011);
    expect(server.status().opsConnected).toBe(false);
  });

  it("closes ops clients when a replacement extension connects", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    const firstExtension = await connect(`${started.url}/extension`);
    const ops = await connect(`${started.url}/ops`);

    firstExtension.send(JSON.stringify({ type: "handshake", payload: { tabId: 42 } }));
    await waitForHandshakeAck(firstExtension);

    ops.send(JSON.stringify({ type: "ops_hello", version: "1", maxPayloadBytes: 1024 }));
    const forwardedHello = await nextMessage(firstExtension);
    const clientId = String(forwardedHello.clientId);
    firstExtension.send(JSON.stringify({
      type: "ops_hello_ack",
      version: "1",
      clientId,
      maxPayloadBytes: 1024,
      capabilities: []
    }));
    await nextMessage(ops);
    expect(server.status().opsConnected).toBe(true);

    const opsClosed = waitForClose(ops);
    const replacementExtension = await connect(`${started.url}/extension`);
    const replacementMessage = Promise.race([
      new Promise((resolve) => {
        replacementExtension.once("message", (data) => resolve(JSON.parse(data.toString())));
      }),
      new Promise((resolve) => setTimeout(() => resolve(null), 50))
    ]);

    await expect(opsClosed).resolves.toBe(1011);
    await expect(replacementMessage).resolves.toBeNull();
    expect(server.status().opsConnected).toBe(false);

    firstExtension.close();
    replacementExtension.close();
  });

  it("does not notify a replacement extension when an old cdp client closes during takeover cleanup", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    const firstExtension = await connect(`${started.url}/extension`);
    firstExtension.send(JSON.stringify({ type: "handshake", payload: { tabId: 42 } }));
    await waitForHandshakeAck(firstExtension);
    const cdp = await connect(`${started.url}/cdp`);
    const cdpClosed = waitForClose(cdp);
    const replacementExtension = await connect(`${started.url}/extension`);
    const replacementMessage = Promise.race([
      new Promise((resolve) => {
        replacementExtension.once("message", (data) => resolve(JSON.parse(data.toString())));
      }),
      new Promise((resolve) => setTimeout(() => resolve(null), 50))
    ]);

    await expect(cdpClosed).resolves.toBe(1011);
    await expect(replacementMessage).resolves.toBeNull();

    firstExtension.close();
    replacementExtension.close();
  });

  it("closes ops clients when status prunes a non-open extension socket", () => {
    server = new RelayServer();
    const close = vi.fn();
    const internal = server as unknown as {
      extensionSocket: WebSocket | null;
      extensionHandshakeComplete: boolean;
      opsClients: Map<string, { readyState: number; close: (code: number, reason: string) => void }>;
      readyOpsClients: Set<string>;
    };
    internal.extensionSocket = { readyState: WebSocket.CLOSING } as WebSocket;
    internal.extensionHandshakeComplete = true;
    internal.opsClients.set("ops-client", { readyState: WebSocket.OPEN, close });
    internal.readyOpsClients.add("ops-client");

    const status = server.status();

    expect(status.extensionConnected).toBe(false);
    expect(status.opsConnected).toBe(false);
    expect(close).toHaveBeenCalledWith(1011, "Extension disconnected.");
  });

  it("closes ops clients when readiness checks prune a non-open extension socket", () => {
    server = new RelayServer();
    const close = vi.fn();
    const internal = server as unknown as {
      extensionSocket: WebSocket | null;
      extensionHandshakeComplete: boolean;
      opsClients: Map<string, { readyState: number; close: (code: number, reason: string) => void }>;
      readyOpsClients: Set<string>;
      hasReadyExtensionSocket: () => boolean;
    };
    internal.extensionSocket = { readyState: WebSocket.CLOSING } as WebSocket;
    internal.extensionHandshakeComplete = true;
    internal.opsClients.set("ops-client", { readyState: WebSocket.OPEN, close });
    internal.readyOpsClients.add("ops-client");

    expect(internal.hasReadyExtensionSocket()).toBe(false);
    expect(internal.opsClients.has("ops-client")).toBe(false);
    expect(internal.readyOpsClients.has("ops-client")).toBe(false);
    expect(close).toHaveBeenCalledWith(1011, "Extension disconnected.");
  });

  it("closes the current ops client after reporting unavailable during extension loss", () => {
    server = new RelayServer();
    const sent: unknown[] = [];
    const close = vi.fn();
    const internal = server as unknown as {
      extensionSocket: WebSocket | null;
      extensionHandshakeComplete: boolean;
      opsClients: Map<string, WebSocket>;
      readyOpsClients: Set<string>;
      handleOpsClientMessage: (clientId: string, data: WebSocket.RawData) => void;
    };
    internal.extensionSocket = { readyState: WebSocket.CLOSING } as WebSocket;
    internal.extensionHandshakeComplete = true;
    internal.opsClients.set("ops-client", {
      readyState: WebSocket.OPEN,
      send: vi.fn((payload: string) => sent.push(JSON.parse(payload))),
      close
    } as unknown as WebSocket);
    internal.readyOpsClients.add("ops-client");

    internal.handleOpsClientMessage("ops-client", Buffer.from(JSON.stringify({
      type: "ops_request",
      requestId: "ops-request",
      payloadId: "payload-1",
      chunkIndex: 0,
      totalChunks: 1,
      data: "{}"
    })));

    expect(sent).toMatchObject([{ type: "ops_error", error: { code: "ops_unavailable" } }]);
    expect(internal.opsClients.has("ops-client")).toBe(false);
    expect(internal.readyOpsClients.has("ops-client")).toBe(false);
    expect(close).toHaveBeenCalledWith(1011, "Extension disconnected.");
  });

  it("closes the current canvas client after reporting unavailable during extension loss", () => {
    server = new RelayServer();
    const sent: unknown[] = [];
    const close = vi.fn();
    const internal = server as unknown as {
      extensionSocket: WebSocket | null;
      extensionHandshakeComplete: boolean;
      canvasClients: Map<string, WebSocket>;
      handleCanvasClientMessage: (clientId: string, data: WebSocket.RawData) => void;
    };
    internal.extensionSocket = { readyState: WebSocket.CLOSING } as WebSocket;
    internal.extensionHandshakeComplete = true;
    internal.canvasClients.set("canvas-client", {
      readyState: WebSocket.OPEN,
      send: vi.fn((payload: string) => sent.push(JSON.parse(payload))),
      close
    } as unknown as WebSocket);

    internal.handleCanvasClientMessage("canvas-client", Buffer.from(JSON.stringify({
      type: "canvas_request",
      requestId: "canvas-request",
      command: "document.snapshot"
    })));

    expect(sent).toMatchObject([{ type: "canvas_error", error: { code: "canvas_unavailable" } }]);
    expect(internal.canvasClients.has("canvas-client")).toBe(false);
    expect(close).toHaveBeenCalledWith(1011, "Extension disconnected.");
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

  it("supports in-process annotation requests through the relay", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    const extension = await connect(`${started.url}/extension`);
    extension.send(JSON.stringify({ type: "handshake", payload: { tabId: 78 } }));
    await waitForHandshakeAck(extension);

    const requestPromise = server.requestAnnotation({
      version: 1,
      requestId: "req-direct",
      command: "start",
      url: "https://example.com"
    });

    const forwarded = await nextMessage(extension);
    expect(forwarded.type).toBe("annotationCommand");
    expect(forwarded.payload).toEqual({
      version: 1,
      requestId: "req-direct",
      command: "start",
      url: "https://example.com"
    });

    extension.send(JSON.stringify({
      type: "annotationResponse",
      payload: {
        version: 1,
        requestId: "req-direct",
        status: "cancelled",
        error: { code: "cancelled", message: "Annotation cancelled." }
      }
    }));

    await expect(requestPromise).resolves.toMatchObject({
      requestId: "req-direct",
      status: "cancelled",
      error: { code: "cancelled" }
    });

    extension.close();
  });

  it("fails in-process annotation requests when the extension disconnects", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    const extension = await connect(`${started.url}/extension`);
    extension.send(JSON.stringify({ type: "handshake", payload: { tabId: 79 } }));
    await waitForHandshakeAck(extension);

    const requestPromise = server.requestAnnotation({
      version: 1,
      requestId: "req-direct-drop",
      command: "start"
    });

    await nextMessage(extension);
    extension.close();

    await expect(requestPromise).resolves.toMatchObject({
      requestId: "req-direct-drop",
      status: "error",
      error: { code: "relay_unavailable" }
    });
  });

  it("closes annotation clients when the extension disconnects", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    const extension = await connect(`${started.url}/extension`);
    const annotation = await connect(`${started.url}/annotation`);
    extension.send(JSON.stringify({ type: "handshake", payload: { tabId: 81 } }));
    await waitForHandshakeAck(extension);
    expect(server.status().annotationConnected).toBe(true);

    const annotationClosed = waitForClose(annotation);
    extension.close();

    await expect(annotationClosed).resolves.toBe(1011);
    expect(server.status().annotationConnected).toBe(false);
  });

  it("returns relay_unavailable for in-process annotation requests without a ready extension", async () => {
    server = new RelayServer();
    await server.start(0);

    await expect(server.requestAnnotation({
      version: 1,
      requestId: "req-direct-unavailable",
      command: "start"
    })).resolves.toMatchObject({
      requestId: "req-direct-unavailable",
      status: "error",
      error: { code: "relay_unavailable" }
    });
  });

  it("times out in-process annotation requests", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    const extension = await connect(`${started.url}/extension`);
    extension.send(JSON.stringify({ type: "handshake", payload: { tabId: 80 } }));
    await waitForHandshakeAck(extension);

    const requestPromise = server.requestAnnotation({
      version: 1,
      requestId: "req-direct-timeout",
      command: "start"
    }, 5);

    await nextMessage(extension);

    await expect(requestPromise).resolves.toMatchObject({
      requestId: "req-direct-timeout",
      status: "error",
      error: { code: "timeout" }
    });

    extension.close();
  });

  it("keeps manual-completion context for in-process annotation timeouts after a ready event", async () => {
    server = new RelayServer();
    const internal = server as RelayServer & {
      annotationDirectPending: Map<string, { readySeen: boolean }>;
    };
    const started = await server.start(0);

    const extension = await connect(`${started.url}/extension`);
    extension.send(JSON.stringify({ type: "handshake", payload: { tabId: 80 } }));
    await waitForHandshakeAck(extension);

    const requestPromise = server.requestAnnotation({
      version: 1,
      requestId: "req-direct-ready-timeout",
      command: "start"
    }, 50);

    await nextMessage(extension);
    extension.send(JSON.stringify({
      type: "annotationEvent",
      payload: {
        version: 1,
        requestId: "req-direct-ready-timeout",
        event: "ready",
        message: "Annotation session started."
      }
    }));
    await waitForCondition(() => internal.annotationDirectPending.get("req-direct-ready-timeout")?.readySeen === true);

    await expect(requestPromise).resolves.toMatchObject({
      requestId: "req-direct-ready-timeout",
      status: "error",
      error: {
        code: "timeout",
        message: ANNOTATION_MANUAL_COMPLETION_TIMEOUT_MESSAGE
      }
    });

    extension.close();
  });

  it("rejects duplicate in-process annotation request ids", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    const extension = await connect(`${started.url}/extension`);
    extension.send(JSON.stringify({ type: "handshake", payload: { tabId: 81 } }));
    await waitForHandshakeAck(extension);

    const firstRequest = server.requestAnnotation({
      version: 1,
      requestId: "req-direct-duplicate",
      command: "start"
    }, 1000);

    await nextMessage(extension);

    await expect(server.requestAnnotation({
      version: 1,
      requestId: "req-direct-duplicate",
      command: "start"
    })).resolves.toMatchObject({
      requestId: "req-direct-duplicate",
      status: "error",
      error: { code: "invalid_request" }
    });

    extension.close();
    await expect(firstRequest).resolves.toMatchObject({
      requestId: "req-direct-duplicate",
      status: "error",
      error: { code: "relay_unavailable" }
    });
  });

  it("fails pending in-process annotation requests when the relay stops", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    const extension = await connect(`${started.url}/extension`);
    extension.send(JSON.stringify({ type: "handshake", payload: { tabId: 82 } }));
    await waitForHandshakeAck(extension);

    const requestPromise = server.requestAnnotation({
      version: 1,
      requestId: "req-direct-stop",
      command: "start"
    }, 1000);

    await nextMessage(extension);
    server.stop();

    await expect(requestPromise).resolves.toMatchObject({
      requestId: "req-direct-stop",
      status: "error",
      error: {
        code: "relay_unavailable",
        message: "Relay stopped."
      }
    });
    server = null;
  });

  it("clears pending websocket annotation requests when the relay stops", () => {
    server = new RelayServer();
    const send = vi.fn();
    const close = vi.fn();
    const directResolve = vi.fn();
    const directTimeout = setTimeout(() => undefined, 1000);
    const internal = server as unknown as {
      annotationSocket: { readyState: number; send: (payload: string) => void; close: () => void } | null;
      annotationPending: Map<string, { createdAt: number; readySeen: boolean }>;
      annotationDirectPending: Map<string, { timeout: NodeJS.Timeout; resolve: (value: unknown) => void }>;
    };
    internal.annotationSocket = { readyState: WebSocket.OPEN, send, close };
    internal.annotationPending.set("req-stop-ws", { createdAt: Date.now(), readySeen: false });
    internal.annotationDirectPending.set("req-stop-direct", {
      timeout: directTimeout,
      resolve: directResolve
    });

    server.stop();

    expect(send).toHaveBeenCalledWith(expect.stringContaining("\"requestId\":\"req-stop-ws\""));
    expect(directResolve).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "req-stop-direct",
      status: "error",
      error: { code: "relay_unavailable", message: "Relay stopped." }
    }));
    expect(internal.annotationPending.size).toBe(0);
    expect(internal.annotationDirectPending.size).toBe(0);
    expect(close).toHaveBeenCalled();
  });

  it("accepts and forwards fetch_stored annotation commands", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    const extension = await connect(`${started.url}/extension`);
    const annotation = await connect(`${started.url}/annotation`);

    extension.send(JSON.stringify({ type: "handshake", payload: { tabId: 88 } }));
    await waitForHandshakeAck(extension);

    const commandPayload = {
      version: 1,
      requestId: "req-fetch",
      command: "fetch_stored",
      options: { includeScreenshots: false }
    };
    annotation.send(JSON.stringify({ type: "annotationCommand", payload: commandPayload }));

    const forwarded = await nextMessage(extension);
    expect(forwarded.type).toBe("annotationCommand");
    expect(forwarded.payload).toEqual(commandPayload);

    const responsePayload = {
      version: 1,
      requestId: "req-fetch",
      status: "error",
      error: { code: "payload_unavailable", message: "No payload" }
    };
    extension.send(JSON.stringify({ type: "annotationResponse", payload: responsePayload }));

    const response = await nextMessage(annotation);
    expect(response.type).toBe("annotationResponse");
    expect(response.payload).toEqual(responsePayload);

    annotation.close();
    extension.close();
  });

  it("handles store_agent_payload commands without requiring an extension handshake", async () => {
    server = new RelayServer();
    const started = await server.start(0);
    server.setStoreAgentPayloadHandler(async (command) => ({
      version: 1,
      requestId: command.requestId,
      status: "ok",
      receipt: {
        receiptId: "receipt-1",
        deliveryState: "delivered",
        storedFallback: false,
        createdAt: "2026-03-15T00:00:00.000Z",
        itemCount: 1,
        byteLength: 42,
        source: "popup_all",
        label: "Popup payload"
      }
    }));

    const annotation = await connect(`${started.url}/annotation`);
    annotation.send(JSON.stringify({
      type: "annotationCommand",
      payload: {
        version: 1,
        requestId: "req-store",
        command: "store_agent_payload",
        source: "popup_all",
        label: "Popup payload",
        payload: {
          url: "https://example.com",
          timestamp: "2026-03-15T00:00:00.000Z",
          screenshotMode: "none",
          annotations: []
        }
      }
    }));

    const response = await nextMessage(annotation);
    expect(response.type).toBe("annotationResponse");
    expect(response.payload).toMatchObject({
      requestId: "req-store",
      status: "ok",
      receipt: {
        receiptId: "receipt-1",
        deliveryState: "delivered"
      }
    });

    annotation.close();
  });

  it("surfaces store_agent_payload handler failures to annotation clients", async () => {
    server = new RelayServer();
    const started = await server.start(0);
    server.setStoreAgentPayloadHandler(async () => {
      throw new Error("enqueue failed");
    });

    const annotation = await connect(`${started.url}/annotation`);
    annotation.send(JSON.stringify({
      type: "annotationCommand",
      payload: {
        version: 1,
        requestId: "req-store-error",
        command: "store_agent_payload",
        source: "canvas_all",
        label: "Canvas payload",
        payload: {
          url: "https://example.com",
          timestamp: "2026-03-15T00:00:00.000Z",
          screenshotMode: "none",
          annotations: []
        }
      }
    }));

    const response = await nextMessage(annotation);
    expect(response.type).toBe("annotationResponse");
    expect(response.payload).toMatchObject({
      requestId: "req-store-error",
      status: "error",
      error: {
        code: "unknown",
        message: "enqueue failed"
      }
    });

    annotation.close();
  });

  it("covers config preflight and token helpers when origin and request url are missing", () => {
    server = new RelayServer();
    const internal = server as unknown as {
      getCdpTokenFromRequestUrl: (value?: string) => string | null;
      handleConfigPreflight: (origin: string | undefined, request: IncomingMessage, response: ServerResponse) => void;
    };
    const response = {
      setHeader: vi.fn(),
      writeHead: vi.fn(),
      end: vi.fn()
    } as unknown as ServerResponse;

    internal.handleConfigPreflight(undefined, { headers: {} } as IncomingMessage, response);

    expect(response.setHeader).not.toHaveBeenCalled();
    expect(response.writeHead).toHaveBeenCalledWith(204);
    expect(internal.getCdpTokenFromRequestUrl(undefined)).toBeNull();
  });

  it("rejects malformed store_agent_payload commands and normalizes non-Error inbox failures", async () => {
    server = new RelayServer();
    const started = await server.start(0);
    server.setStoreAgentPayloadHandler(async () => {
      throw "enqueue failed as string";
    });

    const annotation = await connect(`${started.url}/annotation`);
    const validPayload = {
      url: "https://example.com",
      timestamp: "2026-03-15T00:00:00.000Z",
      screenshotMode: "none",
      annotations: []
    };

    const invalidCommands = [
      {
        requestId: "req-invalid-stored-payload",
        command: "store_agent_payload",
        source: "canvas_all",
        label: "Canvas payload",
        payload: {
          url: 123,
          timestamp: "2026-03-15T00:00:00.000Z",
          screenshotMode: "none",
          annotations: []
        }
      },
      {
        requestId: "req-invalid-stored-source",
        command: "store_agent_payload",
        source: "bad-source",
        label: "Canvas payload",
        payload: validPayload
      },
      {
        requestId: "req-invalid-stored-label",
        command: "store_agent_payload",
        source: "canvas_all",
        label: 42,
        payload: validPayload
      }
    ];

    for (const payload of invalidCommands) {
      annotation.send(JSON.stringify({
        type: "annotationCommand",
        payload: {
          version: 1,
          ...payload
        }
      }));
      const response = await nextMessage(annotation);
      expect(response.payload).toMatchObject({
        requestId: payload.requestId,
        status: "error",
        error: { code: "invalid_request" }
      });
    }

    annotation.send(JSON.stringify({
      type: "annotationCommand",
      payload: {
        version: 1,
        requestId: "req-store-string-error",
        command: "store_agent_payload",
        source: "canvas_all",
        label: "Canvas payload",
        payload: validPayload
      }
    }));

    const response = await nextMessage(annotation);
    expect(response.payload).toMatchObject({
      requestId: "req-store-string-error",
      status: "error",
      error: {
        code: "unknown",
        message: "Agent inbox enqueue failed."
      }
    });

    annotation.close();
  });

  it("surfaces missing agent inbox handlers and annotation timeouts during direct command handling", async () => {
    server = new RelayServer();
    const internal = server as unknown as {
      annotationPending: Map<string, { createdAt: number; readySeen: boolean }>;
      extensionSocket: { send: (payload: string) => void } | null;
      hasReadyExtensionSocket: () => boolean;
      handleStoreAgentPayload: (command: { requestId: string }) => Promise<void>;
      handleAnnotationCommand: (message: Record<string, unknown>) => void;
      sendAnnotationError: (requestId: string, code: string, message: string) => void;
    };
    const sendError = vi.spyOn(internal, "sendAnnotationError").mockImplementation(() => undefined);

    await internal.handleStoreAgentPayload({ requestId: "req-store-missing" });
    expect(sendError).toHaveBeenCalledWith("req-store-missing", "relay_unavailable", "Agent inbox unavailable.");

    vi.useFakeTimers();
    try {
      vi.spyOn(internal, "hasReadyExtensionSocket").mockReturnValue(true);
      internal.extensionSocket = { send: vi.fn(), close: vi.fn() };

      internal.handleAnnotationCommand({
        type: "annotationCommand",
        payload: {
          version: 1,
          requestId: "req-timeout",
          command: "start"
        }
      });

      expect(internal.annotationPending.has("req-timeout")).toBe(true);
      await vi.advanceTimersByTimeAsync((RelayServer as unknown as { ANNOTATION_REQUEST_TIMEOUT_MS: number }).ANNOTATION_REQUEST_TIMEOUT_MS);
      expect(sendError).toHaveBeenCalledWith("req-timeout", "timeout", "Annotation request timed out.");
      expect(internal.annotationPending.has("req-timeout")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses the manual-completion timeout message after a ready event during direct command handling", async () => {
    server = new RelayServer();
    const internal = server as unknown as {
      annotationPending: Map<string, { createdAt: number; readySeen: boolean }>;
      extensionSocket: { send: (payload: string) => void } | null;
      hasReadyExtensionSocket: () => boolean;
      handleAnnotationCommand: (message: Record<string, unknown>) => void;
      forwardAnnotationEvent: (message: { type: "annotationEvent"; payload: unknown }) => void;
      sendAnnotationError: (requestId: string, code: string, message: string) => void;
    };
    const sendError = vi.spyOn(internal, "sendAnnotationError").mockImplementation(() => undefined);

    vi.useFakeTimers();
    try {
      vi.spyOn(internal, "hasReadyExtensionSocket").mockReturnValue(true);
      internal.extensionSocket = { send: vi.fn(), close: vi.fn() };

      internal.handleAnnotationCommand({
        type: "annotationCommand",
        payload: {
          version: 1,
          requestId: "req-ready-timeout",
          command: "start"
        }
      });

      internal.forwardAnnotationEvent({
        type: "annotationEvent",
        payload: {
          version: 1,
          requestId: "req-ready-timeout",
          event: "ready",
          message: "Annotation session started."
        }
      });

      await vi.advanceTimersByTimeAsync((RelayServer as unknown as { ANNOTATION_REQUEST_TIMEOUT_MS: number }).ANNOTATION_REQUEST_TIMEOUT_MS);
      expect(sendError).toHaveBeenCalledWith(
        "req-ready-timeout",
        "timeout",
        ANNOTATION_MANUAL_COMPLETION_TIMEOUT_MESSAGE
      );
      expect(internal.annotationPending.has("req-ready-timeout")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not emit annotation timeouts after a response settles the pending request", async () => {
    server = new RelayServer();
    const internal = server as unknown as {
      annotationPending: Map<string, { createdAt: number; readySeen: boolean }>;
      annotationSocket: WebSocket | null;
      extensionSocket: WebSocket | null;
      hasReadyExtensionSocket: () => boolean;
      handleAnnotationCommand: (message: Record<string, unknown>) => void;
      forwardAnnotationResponse: (message: { type: "annotationResponse"; payload: unknown }) => void;
      sendAnnotationError: (requestId: string, code: string, message: string) => void;
      sendJson: (socket: unknown, payload: unknown) => void;
    };
    const sendJson = vi.spyOn(internal, "sendJson").mockImplementation(() => undefined);
    const sendError = vi.spyOn(internal, "sendAnnotationError").mockImplementation(() => undefined);

    vi.useFakeTimers();
    try {
      vi.spyOn(internal, "hasReadyExtensionSocket").mockReturnValue(true);
      internal.extensionSocket = { readyState: WebSocket.OPEN, send: vi.fn(), close: vi.fn() } as unknown as WebSocket;
      internal.annotationSocket = { readyState: WebSocket.OPEN, send: vi.fn(), close: vi.fn() } as unknown as WebSocket;

      internal.handleAnnotationCommand({
        type: "annotationCommand",
        payload: {
          version: 1,
          requestId: "req-settled",
          command: "start"
        }
      });

      expect(internal.annotationPending.has("req-settled")).toBe(true);

      internal.forwardAnnotationResponse({
        type: "annotationResponse",
        payload: {
          version: 1,
          requestId: "req-settled",
          status: "ok",
          payload: {
            url: "https://example.com",
            timestamp: "2026-03-18T00:00:00.000Z",
            screenshotMode: "none",
            annotations: []
          }
        }
      });

      expect(internal.annotationPending.has("req-settled")).toBe(false);

      await vi.advanceTimersByTimeAsync((RelayServer as unknown as { ANNOTATION_REQUEST_TIMEOUT_MS: number }).ANNOTATION_REQUEST_TIMEOUT_MS);

      expect(sendJson).toHaveBeenCalledWith(internal.annotationSocket, expect.objectContaining({
        type: "annotationResponse"
      }));
      expect(sendError).not.toHaveBeenCalledWith("req-settled", "timeout", "Annotation request timed out.");
    } finally {
      vi.useRealTimers();
    }
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
    expect(server.status().opsConnected).toBe(true);

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

  it("fails silent ops hello handshakes explicitly and clears relay readiness", async () => {
    const relayServerCtor = RelayServer as unknown as { OPS_HELLO_ACK_TIMEOUT_MS: number };
    const originalTimeoutMs = relayServerCtor.OPS_HELLO_ACK_TIMEOUT_MS;
    relayServerCtor.OPS_HELLO_ACK_TIMEOUT_MS = 25;
    server = new RelayServer();
    try {
      const started = await server.start(0);

      const extension = await connect(`${started.url}/extension`);
      const ops = await connect(`${started.url}/ops`);

      extension.send(JSON.stringify({ type: "handshake", payload: { tabId: 33 } }));
      await waitForHandshakeAck(extension);

      ops.send(JSON.stringify({ type: "ops_hello", version: "1", maxPayloadBytes: 1024 }));
      const opsErrorPromise = nextMessageWithTimeout(ops, 1000);
      const opsClosePromise = waitForClose(ops);
      const forwardedHello = await nextMessage(extension);
      expect(forwardedHello.type).toBe("ops_hello");

      const statusResponse = await fetch(`http://127.0.0.1:${started.port}/status`);
      const statusData = await statusResponse.json();
      expect(statusData.opsConnected).toBe(false);

      const response = await opsErrorPromise;
      expect(response).toMatchObject({
        type: "ops_error",
        requestId: "ops_hello",
        error: {
          code: "ops_unavailable",
          message: "Extension did not acknowledge ops hello."
        }
      });
      expect((response.error as { details?: { reason?: string } }).details?.reason).toBe("ops_hello_timeout");
      expect(await opsClosePromise).toBe(1011);
      expect(server.status().opsConnected).toBe(false);

      extension.close();
    } finally {
      relayServerCtor.OPS_HELLO_ACK_TIMEOUT_MS = originalTimeoutMs;
    }
  });

  it("allows delayed ops hello acknowledgements from a waking extension worker", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    const extension = await connect(`${started.url}/extension`);
    const ops = await connect(`${started.url}/ops`);

    extension.send(JSON.stringify({ type: "handshake", payload: { tabId: 34 } }));
    await waitForHandshakeAck(extension);

    ops.send(JSON.stringify({ type: "ops_hello", version: "1", maxPayloadBytes: 1024 }));
    const forwardedHello = await nextMessage(extension);
    expect(forwardedHello.type).toBe("ops_hello");
    expect(typeof forwardedHello.clientId).toBe("string");

    await new Promise((resolve) => setTimeout(resolve, 2200));
    extension.send(JSON.stringify({
      type: "ops_hello_ack",
      version: "1",
      clientId: forwardedHello.clientId,
      maxPayloadBytes: 1024,
      capabilities: []
    }));

    const response = await nextMessageWithTimeout(ops, 2000);
    expect(response.type).toBe("ops_hello_ack");
    expect(server.status().opsConnected).toBe(true);

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

  it("covers http authorization denials and canvas helper no-op branches", () => {
    server = new RelayServer();
    const response = {
      writeHead: vi.fn(),
      end: vi.fn(),
      setHeader: vi.fn()
    } as unknown as ServerResponse;
    const internal = server as unknown as {
      httpAttempts: Map<string, { count: number; resetAt: number }>;
      authorizeHttpRequest: (pathname: string, origin: string | undefined, request: IncomingMessage, response: ServerResponse) => boolean;
      canvasClients: Map<string, { send: (payload: string) => void }>;
      extensionSocket: { send: (payload: string) => void } | null;
      handleCanvasExtensionMessage: (message: Record<string, unknown>) => void;
      notifyCanvasClientClosed: (clientId: string) => void;
      sendCanvasError: (
        clientId: string,
        error: { code: string; message: string },
        requestId?: string,
        canvasSessionId?: string
      ) => void;
      sendJson: (socket: unknown, payload: unknown) => void;
    };
    const maxHttpAttempts = (RelayServer as unknown as { MAX_HTTP_ATTEMPTS: number }).MAX_HTTP_ATTEMPTS;
    const sendJson = vi.spyOn(internal, "sendJson").mockImplementation(() => undefined);

    internal.httpAttempts.set("127.0.0.1", {
      count: maxHttpAttempts,
      resetAt: Date.now() + 60_000
    });
    expect(internal.authorizeHttpRequest("/status", undefined, {
      socket: { remoteAddress: "127.0.0.1" }
    } as IncomingMessage, response)).toBe(false);
    expect(response.writeHead).toHaveBeenCalledWith(429, { "Content-Type": "application/json" });

    vi.mocked(response.writeHead).mockClear();
    vi.mocked(response.end).mockClear();
    internal.httpAttempts.clear();
    expect(internal.authorizeHttpRequest("/status", "https://evil.example", {
      socket: { remoteAddress: "127.0.0.1" }
    } as IncomingMessage, response)).toBe(false);
    expect(response.writeHead).toHaveBeenCalledWith(403, { "Content-Type": "application/json" });

    vi.mocked(response.writeHead).mockClear();
    vi.mocked(response.end).mockClear();
    expect(internal.authorizeHttpRequest("/status", undefined, {
      socket: { remoteAddress: "10.0.0.10" }
    } as IncomingMessage, response)).toBe(false);
    expect(response.writeHead).toHaveBeenCalledWith(403, { "Content-Type": "application/json" });

    expect(internal.authorizeHttpRequest("/status", EXTENSION_ORIGIN, {
      socket: { remoteAddress: "10.0.0.10" }
    } as IncomingMessage, response)).toBe(true);

    internal.handleCanvasExtensionMessage({ type: "canvas_hello_ack" });
    internal.handleCanvasExtensionMessage({ type: "canvas_response" });
    internal.notifyCanvasClientClosed("missing-client");
    internal.sendCanvasError("missing-client", { code: "invalid_request", message: "bad request" });
    expect(sendJson).not.toHaveBeenCalled();

    internal.extensionSocket = { send: vi.fn(), close: vi.fn() };
    internal.canvasClients.set("canvas-client", { send: vi.fn(), close: vi.fn() });
    internal.notifyCanvasClientClosed("canvas-client");
    internal.sendCanvasError("canvas-client", { code: "invalid_request", message: "bad request" }, "req-canvas", "canvas-session");
    internal.handleCanvasExtensionMessage({ type: "canvas_response", clientId: "canvas-client" });
    expect(sendJson).toHaveBeenCalledTimes(3);
  });

  it("covers relay helper no-ops for closed sockets, missing clients, and malformed annotation payloads", () => {
    server = new RelayServer();
    const internal = server as unknown as {
      extensionSocket: WebSocket | null;
      annotationSocket: WebSocket | null;
      cdpSocket: WebSocket | null;
      extensionHandshakeComplete: boolean;
      opsClients: Map<string, WebSocket>;
      canvasClients: Map<string, WebSocket>;
      notifyExtensionCdpClientClosed: () => void;
      notifyOpsClientClosed: (clientId: string) => void;
      sendOpsError: (clientId: string, error: { code: string; message: string; retryable: boolean }, requestId?: string, opsSessionId?: string) => void;
      pruneClosedSockets: () => void;
      handleAnnotationCommand: (message: Record<string, unknown>) => void;
      handleAnnotationMessage: (data: WebSocket.RawData) => void;
      handleOpsClientMessage: (clientId: string, data: WebSocket.RawData) => void;
      handleCanvasClientMessage: (clientId: string, data: WebSocket.RawData) => void;
      closeOpsClient: (clientId: string, code: number, reason: string) => void;
      closeCanvasClient: (clientId: string, code: number, reason: string) => void;
      trackPendingOpsHelloAck: (clientId: string) => void;
      clearPendingOpsHelloAck: (clientId: string) => void;
      sendAnnotationError: (requestId: string, code: string, message: string) => void;
      sendJson: (socket: unknown, payload: unknown) => void;
    };
    const sendJson = vi.spyOn(internal, "sendJson").mockImplementation(() => undefined);
    const sendAnnotationError = vi.spyOn(internal, "sendAnnotationError").mockImplementation(() => undefined);

    internal.notifyExtensionCdpClientClosed();
    internal.notifyOpsClientClosed("missing-client");
    internal.sendOpsError("missing-client", {
      code: "invalid_request",
      message: "bad request",
      retryable: false
    });
    internal.closeOpsClient("missing-client", 1011, "missing");
    internal.closeCanvasClient("missing-client", 1011, "missing");
    expect(sendJson).not.toHaveBeenCalled();

    vi.useFakeTimers();
    try {
      internal.trackPendingOpsHelloAck("cleared-before-timeout");
      internal.clearPendingOpsHelloAck("cleared-before-timeout");
      vi.advanceTimersByTime((RelayServer as unknown as { OPS_HELLO_ACK_TIMEOUT_MS: number }).OPS_HELLO_ACK_TIMEOUT_MS);
    } finally {
      vi.useRealTimers();
    }
    expect(sendJson).not.toHaveBeenCalled();

    internal.extensionSocket = { readyState: WebSocket.CLOSED, send: vi.fn(), close: vi.fn() } as unknown as WebSocket;
    internal.annotationSocket = { readyState: WebSocket.CLOSING, send: vi.fn(), close: vi.fn() } as unknown as WebSocket;
    internal.cdpSocket = { readyState: WebSocket.CLOSED, send: vi.fn(), close: vi.fn() } as unknown as WebSocket;
    internal.opsClients.set("ops-open", { readyState: WebSocket.OPEN, send: vi.fn(), close: vi.fn() } as unknown as WebSocket);
    internal.opsClients.set("ops-closed", { readyState: WebSocket.CLOSED, send: vi.fn(), close: vi.fn() } as unknown as WebSocket);
    internal.canvasClients.set("canvas-closed", { readyState: WebSocket.CLOSING, send: vi.fn(), close: vi.fn() } as unknown as WebSocket);

    internal.notifyExtensionCdpClientClosed();
    internal.pruneClosedSockets();

    expect(internal.cdpSocket).toBeNull();
    expect(internal.annotationSocket).toBeNull();
    expect(internal.opsClients.has("ops-open")).toBe(true);
    expect(internal.opsClients.has("ops-closed")).toBe(false);
    expect(internal.canvasClients.has("canvas-closed")).toBe(false);

    internal.handleAnnotationCommand({ payload: null } as unknown as Record<string, unknown>);
    internal.handleAnnotationMessage(JSON.stringify({
      type: "annotationCommand",
      payload: "bad-payload"
    }) as unknown as WebSocket.RawData);
    expect(sendAnnotationError).toHaveBeenCalledWith("unknown", "invalid_request", "Invalid annotation command payload.");

    internal.extensionSocket = { readyState: WebSocket.OPEN, send: vi.fn(), close: vi.fn() } as unknown as WebSocket;
    internal.extensionHandshakeComplete = true;
    internal.opsClients.set("ops-client", { readyState: WebSocket.OPEN, send: vi.fn(), close: vi.fn() } as unknown as WebSocket);
    internal.canvasClients.set("canvas-client", { readyState: WebSocket.OPEN, send: vi.fn(), close: vi.fn() } as unknown as WebSocket);
    internal.handleOpsClientMessage("ops-client", JSON.stringify({
      type: "ops_request",
      requestId: "req-ops-session",
      command: "session.status",
      opsSessionId: "ops-session-1",
      payload: {}
    }) as unknown as WebSocket.RawData);
    internal.handleCanvasClientMessage("canvas-client", JSON.stringify({
      type: "canvas_request",
      requestId: "req-canvas-session",
      command: "canvas.status",
      canvasSessionId: "canvas-session-1",
      payload: {}
    }) as unknown as WebSocket.RawData);
    expect(sendJson.mock.calls.map(([, payload]) => payload)).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "ops_request", opsSessionId: "ops-session-1" }),
      expect.objectContaining({ type: "canvas_request", canvasSessionId: "canvas-session-1" })
    ]));
  });

  it("preserves ops and canvas session ids on relay-unavailable errors", () => {
    server = new RelayServer();
    const internal = server as unknown as {
      extensionSocket: WebSocket | null;
      extensionHandshakeComplete: boolean;
      opsClients: Map<string, WebSocket>;
      canvasClients: Map<string, WebSocket>;
      handleOpsClientMessage: (clientId: string, data: WebSocket.RawData) => void;
      handleCanvasClientMessage: (clientId: string, data: WebSocket.RawData) => void;
      sendJson: (socket: unknown, payload: unknown) => void;
    };
    const sendJson = vi.spyOn(internal, "sendJson").mockImplementation(() => undefined);

    internal.extensionSocket = null;
    internal.extensionHandshakeComplete = false;
    internal.opsClients.set("ops-client", { readyState: WebSocket.OPEN, send: vi.fn(), close: vi.fn() } as unknown as WebSocket);
    internal.canvasClients.set("canvas-client", { readyState: WebSocket.OPEN, send: vi.fn(), close: vi.fn() } as unknown as WebSocket);

    internal.handleOpsClientMessage("ops-client", JSON.stringify({
      type: "ops_request",
      requestId: "req-ops-missing",
      command: "session.status",
      opsSessionId: "ops-session-missing",
      payload: {}
    }) as unknown as WebSocket.RawData);
    internal.handleCanvasClientMessage("canvas-client", JSON.stringify({
      type: "canvas_request",
      requestId: "req-canvas-missing",
      command: "canvas.status",
      canvasSessionId: "canvas-session-missing",
      payload: {}
    }) as unknown as WebSocket.RawData);

    expect(sendJson.mock.calls.map(([, payload]) => payload)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "ops_error",
        requestId: "req-ops-missing",
        opsSessionId: "ops-session-missing"
      }),
      expect.objectContaining({
        type: "canvas_error",
        requestId: "req-canvas-missing",
        canvasSessionId: "canvas-session-missing"
      })
    ]));
  });

  it("forwards string-id relay responses back to the cdp client", () => {
    server = new RelayServer();
    const internal = server as unknown as {
      cdpSocket: WebSocket | null;
      handleExtensionMessage: (data: WebSocket.RawData) => void;
      sendJson: (socket: unknown, payload: unknown) => void;
    };
    const sendJson = vi.spyOn(internal, "sendJson").mockImplementation(() => undefined);

    internal.cdpSocket = { readyState: WebSocket.OPEN, send: vi.fn(), close: vi.fn() } as unknown as WebSocket;
    internal.handleExtensionMessage(JSON.stringify({
      id: "relay-response",
      sessionId: "session-123"
    }) as unknown as WebSocket.RawData);

    expect(sendJson).toHaveBeenCalledWith(internal.cdpSocket, {
      id: "relay-response",
      sessionId: "session-123"
    });
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

    const relay = RelayServer as unknown as { MAX_OPS_PAYLOAD_BYTES: number };
    const originalLimit = relay.MAX_OPS_PAYLOAD_BYTES;
    relay.MAX_OPS_PAYLOAD_BYTES = 128;
    try {
      ops.send(JSON.stringify({
        type: "ops_request",
        requestId: "req-big",
        command: "session.status",
        payload: { data: "x".repeat(256) }
      }));
      const response = await nextMessage(ops);
      expect(response.type).toBe("ops_error");
      expect(response.error).toMatchObject({
        code: "invalid_request",
        details: { maxPayloadBytes: 128 }
      });
    } finally {
      relay.MAX_OPS_PAYLOAD_BYTES = originalLimit;
    }

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

  it("returns ops_unavailable when extension state is stale-closed", async () => {
    server = new RelayServer();
    const started = await server.start(0);
    const extension = await connect(`${started.url}/extension`);
    extension.send(JSON.stringify({ type: "handshake", payload: { tabId: 32 } }));
    await waitForHandshakeAck(extension);

    const internal = server as unknown as {
      extensionSocket: WebSocket | null;
      extensionHandshakeComplete: boolean;
    };
    internal.extensionSocket = { readyState: WebSocket.CLOSED, close: vi.fn() } as unknown as WebSocket;
    internal.extensionHandshakeComplete = true;

    const ops = await connect(`${started.url}/ops`);
    ops.send(JSON.stringify({
      type: "ops_hello",
      version: "1",
      maxPayloadBytes: 1024
    }));

    const response = await nextMessage(ops);
    expect(response.type).toBe("ops_error");
    expect(response.error).toMatchObject({ code: "ops_unavailable" });

    ops.close();
    extension.close();
  });

  it("prunes stale extension, ops, and canvas sockets from relay status", async () => {
    server = new RelayServer();
    await server.start(0);
    const internal = server as unknown as {
      extensionSocket: WebSocket | null;
      extensionHandshakeComplete: boolean;
      extensionInfo: { tabId: number } | null;
      opsClients: Map<string, WebSocket>;
      canvasClients: Map<string, WebSocket>;
    };

    internal.extensionSocket = { readyState: WebSocket.CLOSED, close: vi.fn() } as unknown as WebSocket;
    internal.extensionHandshakeComplete = true;
    internal.extensionInfo = { tabId: 99 };
    internal.opsClients.set("stale-ops", { readyState: WebSocket.CLOSING, close: vi.fn() } as unknown as WebSocket);
    internal.canvasClients.set("stale-canvas", { readyState: WebSocket.CLOSED, close: vi.fn() } as unknown as WebSocket);

    const status = server.status();
    expect(status.extensionConnected).toBe(false);
    expect(status.extensionHandshakeComplete).toBe(false);
    expect(status.opsConnected).toBe(false);
    expect(status.canvasConnected).toBe(false);
    expect(status.health.reason).toBe("extension_disconnected");
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

  it("keeps cdp attach blocked while an ops session is released for reclaim", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    const extension = await connect(`${started.url}/extension`);
    const cdp = await connect(`${started.url}/cdp`);

    extension.send(JSON.stringify({ type: "handshake", payload: { tabId: 45 } }));
    await waitForHandshakeAck(extension);

    extension.send(JSON.stringify({
      type: "ops_event",
      event: "ops_session_created",
      payload: { tabId: 777 }
    }));

    cdp.send(JSON.stringify({ id: 4, method: "Target.attachToTarget", params: { targetId: "tab-777" } }));
    const blocked = await nextMessage(cdp);
    expect(blocked.error).toEqual({ message: "cdp_attach_blocked: target is owned by an ops session" });

    extension.send(JSON.stringify({
      type: "ops_event",
      event: "ops_session_released",
      payload: { tabId: 777 }
    }));

    cdp.send(JSON.stringify({ id: 5, method: "Target.attachToTarget", params: { targetId: "tab-777" } }));
    const releasedResponse = await nextMessage(cdp);
    expect(releasedResponse.error).toEqual({ message: "cdp_attach_blocked: target is owned by an ops session" });
    expect(server.status().opsOwnedTargetCount).toBe(1);

    extension.send(JSON.stringify({
      type: "ops_event",
      event: "ops_session_reclaimed",
      payload: { tabId: 777 }
    }));

    cdp.send(JSON.stringify({ id: 6, method: "Target.attachToTarget", params: { targetId: "tab-777" } }));
    const reblocked = await nextMessage(cdp);
    expect(reblocked.error).toEqual({ message: "cdp_attach_blocked: target is owned by an ops session" });

    extension.send(JSON.stringify({
      type: "ops_event",
      event: "ops_session_expired",
      payload: { tabId: 777 }
    }));

    const forwardedPromise = nextMessage(extension);
    cdp.send(JSON.stringify({ id: 7, method: "Target.attachToTarget", params: { targetId: "tab-777" } }));
    const forwarded = await forwardedPromise;
    expect(forwarded.method).toBe("forwardCDPCommand");
    extension.send(JSON.stringify({ id: 7, result: { sessionId: "s-expired" } }));
    const expiredResponse = await nextMessage(cdp);
    expect(expiredResponse.result).toEqual({ sessionId: "s-expired" });

    cdp.close();
    extension.close();
  });

  it("forwards cdp attach when targetId is not a tracked string tab id", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    const extension = await connect(`${started.url}/extension`);
    const cdp = await connect(`${started.url}/cdp`);

    extension.send(JSON.stringify({ type: "handshake", payload: { tabId: 44 } }));
    await waitForHandshakeAck(extension);

    const forwardedPromise = nextMessage(extension);
    cdp.send(JSON.stringify({ id: 3, method: "Target.attachToTarget", params: { targetId: 123 } }));
    const forwarded = await forwardedPromise;
    expect(forwarded).toMatchObject({
      method: "forwardCDPCommand",
      params: {
        method: "Target.attachToTarget",
        params: { targetId: 123 }
      }
    });

    extension.send(JSON.stringify({ id: 3, result: { sessionId: "s-attach-numeric" } }));
    const response = await nextMessage(cdp);
    expect(response.result).toEqual({ sessionId: "s-attach-numeric" });

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
    expect(await closedPromise).toBe(1000);

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

    expect(await cdp2Closed).toBe(1008);

    cdp1.close();
    await cdpClosed;
    extension2.close();
  });

  it("allows a replacement CDP client when the previous socket is already closing", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    const internal = server as unknown as { cdpSocket: WebSocket | null };
    internal.cdpSocket = { readyState: WebSocket.CLOSING } as WebSocket;

    const cdp = await connect(`${started.url}/cdp`);
    expect(server.status().cdpConnected).toBe(true);

    cdp.close();
    await waitForClose(cdp);
  });

  it("releases the active CDP slot when the socket errors", async () => {
    server = new RelayServer();
    const started = await server.start(0);

    const cdp = await connect(`${started.url}/cdp`);
    const internal = server as unknown as { cdpSocket: WebSocket | null };
    expect(server.status().cdpConnected).toBe(true);

    internal.cdpSocket?.emit("error", new Error("boom"));
    expect(server.status().cdpConnected).toBe(false);

    cdp.close();
    await waitForClose(cdp);
  });

  it("closes errored CDP sockets when they are open or connecting", async () => {
    server = new RelayServer();
    await server.start(0);
    const internal = server as unknown as {
      cdpWss: { emit: (event: string, ...args: unknown[]) => void } | null;
      extensionSocket: WebSocket | null;
      extensionHandshakeComplete: boolean;
      cdpSocket: WebSocket | null;
    };

    internal.extensionSocket = { readyState: WebSocket.OPEN, send: vi.fn(), close: vi.fn() } as unknown as WebSocket;
    internal.extensionHandshakeComplete = true;

    for (const readyState of [WebSocket.OPEN, WebSocket.CONNECTING]) {
      const socket = Object.assign(new EventEmitter(), {
        readyState,
        send: vi.fn(),
        close: vi.fn()
      }) as unknown as WebSocket;
      internal.cdpWss?.emit("connection", socket, {} as IncomingMessage);
      socket.emit("error", new Error(`boom-${readyState}`));
      expect(socket.close).toHaveBeenCalledWith(1011, "CDP client error");
      expect(internal.cdpSocket).toBeNull();
    }
  });

  it("does not close errored CDP sockets when they are already closed", async () => {
    server = new RelayServer();
    await server.start(0);
    const internal = server as unknown as {
      cdpWss: { emit: (event: string, ...args: unknown[]) => void } | null;
      cdpSocket: WebSocket | null;
    };

    const socket = Object.assign(new EventEmitter(), {
      readyState: WebSocket.CLOSED,
      send: vi.fn(),
      close: vi.fn()
    }) as unknown as WebSocket;

    internal.cdpWss?.emit("connection", socket, {} as IncomingMessage);
    socket.emit("error", new Error("boom-closed"));

    expect(socket.close).not.toHaveBeenCalled();
    expect(internal.cdpSocket).toBeNull();
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

    it("serves main and discovery /config under exhausted loopback http throttle", async () => {
      server = new RelayServer({ discoveryPort: 0 });
      server.setToken("secret");
      const started = await server.start(0);
      const discoveryPort = server.getDiscoveryPort();
      expect(discoveryPort).toBeTruthy();

      const internal = server as unknown as {
        httpAttempts: Map<string, { count: number; resetAt: number }>;
      };
      internal.httpAttempts.set("127.0.0.1", {
        count: (RelayServer as unknown as { MAX_HTTP_ATTEMPTS: number }).MAX_HTTP_ATTEMPTS,
        resetAt: Date.now() + 60_000
      });

      const mainResponse = await fetch(`http://127.0.0.1:${started.port}/config`);
      expect(mainResponse.status).toBe(200);
      const mainData = await mainResponse.json();
      expect(mainData.relayPort).toBe(started.port);
      expect(mainData.discoveryPort).toBe(discoveryPort);

      const discoveryResponse = await fetch(`http://127.0.0.1:${discoveryPort}/config`);
      expect(discoveryResponse.status).toBe(200);
      const discoveryData = await discoveryResponse.json();
      expect(discoveryData.relayPort).toBe(started.port);
      expect(discoveryData.discoveryPort).toBe(discoveryPort);
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

    it("warns when discovery startup fails with a non-Error value", async () => {
      server = new RelayServer({ discoveryPort: 0 });
      const internal = server as unknown as {
        startDiscoveryServer: () => Promise<void>;
      };
      const startDiscoveryServer = vi.spyOn(internal, "startDiscoveryServer").mockRejectedValue("boom-string");

      await server.start(0);

      const warn = warnSpy;
      if (!warn) {
        throw new Error("warnSpy missing");
      }
      expect(startDiscoveryServer).toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("boom-string"));
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

    it("reports dirty health when ops-owned targets remain", async () => {
      server = new RelayServer();
      const started = await server.start(0);

      const extension = await connect(`${started.url}/extension`);
      extension.send(JSON.stringify({ type: "handshake", payload: { tabId: 1 } }));
      await waitForHandshakeAck(extension);
      extension.send(JSON.stringify({
        type: "ops_event",
        clientId: "client-1",
        opsSessionId: "ops-1",
        event: "ops_session_created",
        payload: { tabId: 77, targetId: "tab-77" }
      }));

      const response = await fetch(`http://127.0.0.1:${started.port}/status`);
      const data = await response.json();
      expect(data.health).toMatchObject({
        ok: false,
        reason: "relay_dirty",
        opsOwnedTargetCount: 1
      });

      extension.close();
    });

    it("keeps idle ready ops clients healthy when no ops-owned targets remain", async () => {
      server = new RelayServer();
      const started = await server.start(0);

      const extension = await connect(`${started.url}/extension`);
      extension.send(JSON.stringify({ type: "handshake", payload: { tabId: 1 } }));
      await waitForHandshakeAck(extension);

      const ops = await connect(`${started.url}/ops`);
      ops.send(JSON.stringify({ type: "ops_hello", version: "1", maxPayloadBytes: 1024 }));
      const forwardedHello = await nextMessage(extension);
      const clientId = String(forwardedHello.clientId);
      extension.send(JSON.stringify({
        type: "ops_hello_ack",
        version: "1",
        clientId,
        maxPayloadBytes: 1024,
        capabilities: []
      }));
      await nextMessage(ops);

      const response = await fetch(`http://127.0.0.1:${started.port}/status`);
      const data = await response.json();
      expect(data.health).toMatchObject({
        ok: true,
        reason: "ok",
        opsConnected: true,
        opsOwnedTargetCount: 0
      });

      ops.close();
      extension.close();
    });

    it.each([
      ["cdp", "cdpConnected"],
      ["annotation", "annotationConnected"],
      ["canvas", "canvasConnected"]
    ] as const)("reports dirty health while a %s client is active", async (path, key) => {
      server = new RelayServer();
      const started = await server.start(0);

      const extension = await connect(`${started.url}/extension`);
      extension.send(JSON.stringify({ type: "handshake", payload: { tabId: 1 } }));
      await waitForHandshakeAck(extension);
      const client = await connect(`${started.url}/${path}`);

      const response = await fetch(`http://127.0.0.1:${started.port}/status`);
      const data = await response.json();
      expect(data.health).toMatchObject({
        ok: false,
        reason: "relay_dirty",
        [key]: true
      });

      client.close();
      extension.close();
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

    it("allows chrome-extension origins on /cdp and /annotation", async () => {
      server = new RelayServer();
      const started = await server.start(0);

      await expect(upgradeRequest({
        port: started.port,
        path: "/cdp",
        origin: EXTENSION_ORIGIN
      })).resolves.toBe(101);
      await expect(upgradeRequest({
        port: started.port,
        path: "/annotation",
        origin: EXTENSION_ORIGIN
      })).resolves.toBe(101);
    });

    it("rejects protected upgrades when normalized origin is blocked but raw origin is missing", async () => {
      server = new RelayServer();
      await server.start(0);

      const internal = server as unknown as {
        server?: { emit: (event: string, ...args: unknown[]) => void };
        normalizeOrigin: (origin: string | undefined) => string | undefined;
      };
      vi.spyOn(internal, "normalizeOrigin").mockReturnValue("https://evil.com");

      for (const path of ["/cdp", "/annotation", "/ops", "/canvas"]) {
        const socket = { write: vi.fn(), destroy: vi.fn() };
        internal.server?.emit("upgrade", {
          url: path,
          headers: {},
          socket: { remoteAddress: "127.0.0.1" }
        }, socket, Buffer.from(""));
        expect(socket.write).toHaveBeenCalledWith(expect.stringContaining("403"));
        expect(socket.destroy).toHaveBeenCalled();
      }
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
      internal.handshakeAttempts.set("/cdp:127.0.0.1", {
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
      internal.handshakeAttempts.set("/annotation:127.0.0.1", {
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

    it("rejects /extension upgrades when origin is missing", async () => {
      server = new RelayServer();
      await server.start(0);

      const internal = server as unknown as { server?: { emit: (event: string, ...args: unknown[]) => void } };
      const socket = { write: vi.fn(), destroy: vi.fn() };
      const request = { url: "/extension", headers: {}, socket: { remoteAddress: undefined } };
      internal.server?.emit("upgrade", request, socket, Buffer.from(""));

      expect(socket.write).toHaveBeenCalledWith(expect.stringContaining("403"));
      expect(socket.destroy).toHaveBeenCalled();
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

    it("does not rate limit repeated successful extension reconnects", async () => {
      server = new RelayServer();
      server.setToken("secret-token");
      const started = await server.start(0);

      for (let i = 0; i < 7; i++) {
        const ext = await connect(`${started.url}/extension`);
        ext.send(JSON.stringify({
          type: "handshake",
          payload: { tabId: i + 1, pairingToken: "secret-token" }
        }));
        await waitForHandshakeAck(ext);
        ext.close();
        await waitForClose(ext);
      }

      const status = await upgradeRequest({
        port: started.port,
        path: "/extension",
        origin: EXTENSION_ORIGIN
      });

      expect(status).toBe(101);
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

  it("covers direct ops, canvas, and annotation helper branches for malformed payloads and missing client routing", () => {
    server = new RelayServer();
    const internal = server as unknown as {
      extensionSocket: { send: (payload: string) => void } | null;
      annotationSocket: { send: (payload: string) => void } | null;
      extensionHandshakeComplete: boolean;
      opsClients: Map<string, { send: (payload: string) => void }>;
      canvasClients: Map<string, { send: (payload: string) => void }>;
      handleOpsClientMessage: (clientId: string, data: WebSocket.RawData) => void;
      handleCanvasClientMessage: (clientId: string, data: WebSocket.RawData) => void;
      handleAnnotationMessage: (data: WebSocket.RawData) => void;
      handleOpsExtensionMessage: (message: Record<string, unknown>) => void;
      handleCanvasExtensionMessage: (message: Record<string, unknown>) => void;
      forwardAnnotationResponse: (message: { type: "annotationResponse"; payload: unknown }) => void;
      forwardAnnotationEvent: (message: { type: "annotationEvent"; payload: unknown }) => void;
      sendAnnotationError: (requestId: string, code: string, message: string) => void;
      sendJson: (socket: unknown, payload: unknown) => void;
    };
    const sendJson = vi.spyOn(internal, "sendJson").mockImplementation(() => undefined);
    const sendAnnotationError = vi.spyOn(internal, "sendAnnotationError").mockImplementation(() => undefined);

      internal.extensionSocket = { readyState: WebSocket.OPEN, send: vi.fn(), close: vi.fn() } as unknown as WebSocket;
      internal.annotationSocket = { readyState: WebSocket.OPEN, send: vi.fn(), close: vi.fn() } as unknown as WebSocket;
      internal.extensionHandshakeComplete = true;
      internal.opsClients.set("ops-client", { readyState: WebSocket.OPEN, send: vi.fn(), close: vi.fn() } as unknown as WebSocket);
      internal.canvasClients.set("canvas-client", { readyState: WebSocket.OPEN, send: vi.fn(), close: vi.fn() } as unknown as WebSocket);

      internal.handleOpsClientMessage("ops-client", Buffer.from("{"));
      internal.handleCanvasClientMessage("canvas-client", Buffer.from("{"));
      expect(sendJson).not.toHaveBeenCalled();

      internal.handleOpsClientMessage("ops-client", JSON.stringify({
        type: "ops_ping",
        id: "ops-ping-string"
      }) as unknown as WebSocket.RawData);
      internal.handleCanvasClientMessage("canvas-client", JSON.stringify({
        type: "canvas_ping",
        id: "canvas-ping-string"
      }) as unknown as WebSocket.RawData);
      internal.handleOpsClientMessage("ops-client", Buffer.from(JSON.stringify({
        type: "ops_ping",
        id: "ops-ping"
      })));
      internal.handleCanvasClientMessage("canvas-client", Buffer.from(JSON.stringify({
        type: "canvas_ping",
        id: "canvas-ping"
      })));
      internal.handleOpsClientMessage("ops-client", Buffer.from(JSON.stringify({
        type: "ops_ping",
        id: 42
      })));
      internal.handleCanvasClientMessage("canvas-client", Buffer.from(JSON.stringify({
        type: "canvas_ping",
        id: 42
      })));
      internal.handleOpsExtensionMessage({
        type: "ops_error",
        clientId: "ops-client",
        requestId: 42,
        opsSessionId: 9,
        error: { code: "invalid_request", message: "bad request" }
      } as unknown as Record<string, unknown>);
      internal.handleCanvasExtensionMessage({
        type: "canvas_error",
        clientId: "canvas-client",
        requestId: 42,
        canvasSessionId: 9,
        error: { code: "invalid_request", message: "bad request" }
      } as unknown as Record<string, unknown>);
      internal.handleOpsExtensionMessage({
        type: "ops_event",
        clientId: "missing-client",
        event: "ops_session_created",
        payload: { tabId: "bad-id" }
      });
      internal.handleOpsExtensionMessage({
        type: "ops_event",
        clientId: "ops-client",
        event: "ops_session_created",
        payload: null
      } as unknown as Record<string, unknown>);
      internal.handleCanvasExtensionMessage({
        type: "canvas_hello_ack",
        clientId: "missing-client",
        version: "1"
      });
      internal.handleAnnotationMessage(JSON.stringify({
        type: "annotationCommand",
        payload: {
          version: 1,
          requestId: "req-store-null",
          command: "store_agent_payload",
          payload: null
        }
      }) as unknown as WebSocket.RawData);
      internal.forwardAnnotationResponse({
        type: "annotationResponse",
        payload: null
      });
      internal.forwardAnnotationEvent({
        type: "annotationEvent",
        payload: null
      });

      expect(sendJson.mock.calls.map(([, payload]) => payload)).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: "ops_ping",
          id: "ops-ping-string",
          clientId: "ops-client"
        }),
        expect.objectContaining({
          type: "canvas_ping",
          id: "canvas-ping-string",
          clientId: "canvas-client"
        }),
        expect.objectContaining({
          type: "ops_ping",
          id: "ops-ping",
          clientId: "ops-client"
        }),
        expect.objectContaining({
          type: "canvas_ping",
          id: "canvas-ping",
          clientId: "canvas-client"
        }),
        expect.objectContaining({
          type: "ops_error",
          requestId: "unknown",
          clientId: "ops-client"
        }),
        expect.objectContaining({
          type: "ops_error",
          requestId: "unknown",
          clientId: "ops-client"
        }),
        expect.objectContaining({
          type: "canvas_error",
          requestId: "unknown",
          clientId: "canvas-client"
        }),
        expect.objectContaining({
          type: "canvas_error",
          requestId: "unknown",
          clientId: "canvas-client"
        })
      ]));
      expect(sendAnnotationError).toHaveBeenCalledWith("req-store-null", "invalid_request", "Invalid annotation command payload.");
      expect(sendAnnotationError).toHaveBeenCalledWith("unknown", "invalid_request", "Invalid annotation response payload.");
    });

    it("returns 404 when main and discovery requests have no url path", async () => {
      server = new RelayServer({ discoveryPort: 0 });
      await server.start(0);

      const response = {
        setHeader: vi.fn(),
        writeHead: vi.fn(),
        end: vi.fn()
      } as unknown as ServerResponse;
      const discoveryResponse = {
        setHeader: vi.fn(),
        writeHead: vi.fn(),
        end: vi.fn()
      } as unknown as ServerResponse;
      const internal = server as unknown as {
        server: http.Server;
        discoveryServer: http.Server | null;
      };

      internal.server.emit("request", {
        url: undefined,
        method: "GET",
        headers: {},
        socket: { remoteAddress: "127.0.0.1" }
      } as IncomingMessage, response);
      internal.discoveryServer?.emit("request", {
        url: undefined,
        method: "GET",
        headers: {},
        socket: { remoteAddress: "127.0.0.1" }
      } as IncomingMessage, discoveryResponse);

      expect(response.writeHead).toHaveBeenCalledWith(404);
      expect(discoveryResponse.writeHead).toHaveBeenCalledWith(404);
    });

    it("ignores stale ops and canvas socket error callbacks after client replacement", async () => {
      server = new RelayServer();
      const started = await server.start(0);

      const opsClient = await connect(`${started.url}/ops`);
      const canvasClient = await connect(`${started.url}/canvas`);

      const internal = server as unknown as {
        opsClients: Map<string, WebSocket>;
        canvasClients: Map<string, WebSocket>;
        notifyOpsClientClosed: (clientId: string) => void;
        notifyCanvasClientClosed: (clientId: string) => void;
      };
      const notifyOpsClientClosed = vi.spyOn(internal, "notifyOpsClientClosed");
      const notifyCanvasClientClosed = vi.spyOn(internal, "notifyCanvasClientClosed");
      const [opsClientId, opsSocket] = [...internal.opsClients.entries()][0] ?? [];
      const [canvasClientId, canvasSocket] = [...internal.canvasClients.entries()][0] ?? [];

      if (!opsClientId || !opsSocket || !canvasClientId || !canvasSocket) {
        throw new Error("Expected ops and canvas relay sockets");
      }

      internal.opsClients.set(opsClientId, { send: vi.fn(), close: vi.fn() } as unknown as WebSocket);
      internal.canvasClients.set(canvasClientId, { send: vi.fn(), close: vi.fn() } as unknown as WebSocket);
      opsSocket.emit("error", new Error("stale ops socket"));
      canvasSocket.emit("error", new Error("stale canvas socket"));

      expect(notifyOpsClientClosed).not.toHaveBeenCalled();
      expect(notifyCanvasClientClosed).not.toHaveBeenCalled();

      opsClient.close();
      canvasClient.close();
    });

    it("covers config and status helpers before the relay is fully running", () => {
      server = new RelayServer();
      const response = {
        setHeader: vi.fn(),
        writeHead: vi.fn(),
        end: vi.fn()
      } as unknown as ServerResponse;
      const internal = server as unknown as {
        authorizeHttpRequest: (pathname: string, origin: string | undefined, request: IncomingMessage, response: ServerResponse) => boolean;
        handleConfigRequest: (request: IncomingMessage, origin: string | undefined, response: ServerResponse) => void;
        handleStatusRequest: (request: IncomingMessage, origin: string | undefined, response: ServerResponse) => void;
      };
      const request = {
        headers: {},
        socket: { remoteAddress: "127.0.0.1" }
      } as unknown as IncomingMessage;

      expect(internal.authorizeHttpRequest("/status", undefined, {
        headers: {},
        socket: {}
      } as IncomingMessage, response)).toBe(false);
      expect(response.writeHead).toHaveBeenCalledWith(403, { "Content-Type": "application/json" });

      vi.mocked(response.writeHead).mockClear();
      vi.mocked(response.end).mockClear();
      internal.handleConfigRequest(request, undefined, response);
      expect(response.writeHead).toHaveBeenCalledWith(503, { "Content-Type": "application/json" });

      vi.mocked(response.writeHead).mockClear();
      vi.mocked(response.end).mockClear();
      internal.handleStatusRequest(request, undefined, response);
      const statusBody = JSON.parse(String(vi.mocked(response.end).mock.calls[0]?.[0] ?? "{}")) as Record<string, unknown>;
      expect(statusBody.running).toBe(false);
      expect(statusBody.port).toBeUndefined();
      });
    });

  it("expires stale handshake-rate-limit windows", () => {
    server = new RelayServer();
    const internal = server as unknown as {
      handshakeAttempts: Map<string, { count: number; resetAt: number }>;
      isHandshakeRateLimited: (ip: string, path: string) => boolean;
    };

    internal.handshakeAttempts.set("/ops:127.0.0.1", {
      count: (RelayServer as unknown as { MAX_HANDSHAKE_ATTEMPTS: number }).MAX_HANDSHAKE_ATTEMPTS,
      resetAt: Date.now() - 1
    });

    expect(internal.isHandshakeRateLimited("127.0.0.1", "/ops")).toBe(false);
    expect(internal.handshakeAttempts.has("/ops:127.0.0.1")).toBe(false);
  });

  it("tracks ops hello acknowledgements only when a client id is present", () => {
    server = new RelayServer();
    const internal = server as unknown as {
      pendingOpsHelloAcks: Map<string, ReturnType<typeof setTimeout>>;
      readyOpsClients: Set<string>;
      handleOpsExtensionMessage: (message: Record<string, unknown>) => void;
    };

    vi.useFakeTimers();
    try {
      internal.pendingOpsHelloAcks.set("ops-client", setTimeout(() => undefined, 1000));

      internal.handleOpsExtensionMessage({
        type: "ops_hello_ack",
        clientId: "ops-client"
      });

      expect(internal.readyOpsClients.has("ops-client")).toBe(true);
      expect(internal.pendingOpsHelloAcks.has("ops-client")).toBe(false);

      internal.readyOpsClients.clear();
      internal.handleOpsExtensionMessage({
        type: "ops_hello_ack"
      });

      expect(internal.readyOpsClients.size).toBe(0);
    } finally {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  it("clears ready ops state only for hello errors with a client id", () => {
    server = new RelayServer();
    const internal = server as unknown as {
      pendingOpsHelloAcks: Map<string, ReturnType<typeof setTimeout>>;
      readyOpsClients: Set<string>;
      handleOpsExtensionMessage: (message: Record<string, unknown>) => void;
      clearPendingOpsHelloAck: (clientId: string) => void;
    };

    vi.useFakeTimers();
    try {
      internal.pendingOpsHelloAcks.set("ops-client", setTimeout(() => undefined, 1000));
      internal.readyOpsClients.add("ops-client");

      internal.handleOpsExtensionMessage({
        type: "ops_error",
        requestId: "ops_hello",
        clientId: "ops-client"
      });

      expect(internal.pendingOpsHelloAcks.has("ops-client")).toBe(false);
      expect(internal.readyOpsClients.has("ops-client")).toBe(false);

      internal.pendingOpsHelloAcks.set("ops-client", setTimeout(() => undefined, 1000));
      internal.readyOpsClients.add("ops-client");

      internal.handleOpsExtensionMessage({
        type: "ops_error",
        requestId: "ops_hello"
      });

      expect(internal.pendingOpsHelloAcks.has("ops-client")).toBe(true);
      expect(internal.readyOpsClients.has("ops-client")).toBe(true);
      internal.clearPendingOpsHelloAck("ops-client");
    } finally {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  it("does not emit ops hello timeout side effects after the pending ack is cleared", () => {
    server = new RelayServer();
    const client = {
      readyState: WebSocket.OPEN,
      close: vi.fn(),
      send: vi.fn()
    } as unknown as WebSocket;
    const internal = server as unknown as {
      opsClients: Map<string, WebSocket>;
      trackPendingOpsHelloAck: (clientId: string) => void;
      clearPendingOpsHelloAck: (clientId: string) => void;
      sendOpsError: (clientId: string, error: unknown, requestId?: string) => void;
    };
    const sendOpsError = vi.spyOn(internal, "sendOpsError").mockImplementation(() => undefined);

    vi.useFakeTimers();
    try {
      internal.opsClients.set("ops-client", client);
      internal.trackPendingOpsHelloAck("ops-client");
      internal.clearPendingOpsHelloAck("ops-client");

      vi.advanceTimersByTime((RelayServer as unknown as { OPS_HELLO_ACK_TIMEOUT_MS: number }).OPS_HELLO_ACK_TIMEOUT_MS);

      expect(sendOpsError).not.toHaveBeenCalled();
      expect(client.close).not.toHaveBeenCalled();
    } finally {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  it("keeps relay ops hello timeout within the default client handshake budget", () => {
    expect((RelayServer as unknown as { OPS_HELLO_ACK_TIMEOUT_MS: number }).OPS_HELLO_ACK_TIMEOUT_MS)
      .toBeLessThan(12000);
  });

  it("closes open ops clients when the hello acknowledgement times out", () => {
    server = new RelayServer();
    const client = {
      readyState: WebSocket.OPEN,
      close: vi.fn(),
      send: vi.fn()
    } as unknown as WebSocket;
    const internal = server as unknown as {
      opsClients: Map<string, WebSocket>;
      readyOpsClients: Set<string>;
      pendingOpsHelloAcks: Map<string, ReturnType<typeof setTimeout>>;
      trackPendingOpsHelloAck: (clientId: string) => void;
      sendOpsError: (clientId: string, error: unknown, requestId?: string) => void;
    };
    const sendOpsError = vi.spyOn(internal, "sendOpsError").mockImplementation(() => undefined);

    vi.useFakeTimers();
    try {
      internal.opsClients.set("ops-client", client);
      internal.readyOpsClients.add("ops-client");
      internal.trackPendingOpsHelloAck("ops-client");

      vi.advanceTimersByTime((RelayServer as unknown as { OPS_HELLO_ACK_TIMEOUT_MS: number }).OPS_HELLO_ACK_TIMEOUT_MS);

      expect(sendOpsError).toHaveBeenCalledWith(
        "ops-client",
        expect.objectContaining({
          code: "ops_unavailable",
          details: { reason: "ops_hello_timeout" }
        }),
        "ops_hello"
      );
      expect(client.close).toHaveBeenCalledWith(1011, "ops_hello_timeout");
      expect(internal.pendingOpsHelloAcks.has("ops-client")).toBe(false);
      expect(internal.readyOpsClients.has("ops-client")).toBe(false);
    } finally {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  it("does not close non-open ops clients when the hello acknowledgement times out", () => {
    server = new RelayServer();
    const client = {
      readyState: WebSocket.CLOSING,
      close: vi.fn(),
      send: vi.fn()
    } as unknown as WebSocket;
    const internal = server as unknown as {
      opsClients: Map<string, WebSocket>;
      readyOpsClients: Set<string>;
      pendingOpsHelloAcks: Map<string, ReturnType<typeof setTimeout>>;
      trackPendingOpsHelloAck: (clientId: string) => void;
      sendOpsError: (clientId: string, error: unknown, requestId?: string) => void;
    };
    const sendOpsError = vi.spyOn(internal, "sendOpsError").mockImplementation(() => undefined);

    vi.useFakeTimers();
    try {
      internal.opsClients.set("ops-client", client);
      internal.readyOpsClients.add("ops-client");
      internal.trackPendingOpsHelloAck("ops-client");

      vi.advanceTimersByTime((RelayServer as unknown as { OPS_HELLO_ACK_TIMEOUT_MS: number }).OPS_HELLO_ACK_TIMEOUT_MS);

      expect(sendOpsError).toHaveBeenCalledWith(
        "ops-client",
        expect.objectContaining({
          code: "ops_unavailable",
          details: { reason: "ops_hello_timeout" }
        }),
        "ops_hello"
      );
      expect(client.close).not.toHaveBeenCalled();
      expect(internal.pendingOpsHelloAcks.has("ops-client")).toBe(false);
      expect(internal.readyOpsClients.has("ops-client")).toBe(false);
    } finally {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });
});
