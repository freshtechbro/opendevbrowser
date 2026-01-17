import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WebSocket } from "ws";
import http from "http";
import type { ServerResponse } from "http";
import type { AddressInfo } from "net";
import { RelayServer } from "../src/relay/relay-server";

const getAvailablePort = async (): Promise<number> => {
  const tempServer = http.createServer();
  await new Promise<void>((resolve) => {
    tempServer.listen(0, "127.0.0.1", () => resolve());
  });
  const address = tempServer.address() as AddressInfo;
  await new Promise<void>((resolve) => tempServer.close(() => resolve()));
  return address.port;
};

const connect = async (url: string, timeoutMs = 3000): Promise<WebSocket> => {
  const socket = new WebSocket(url);
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

  it("rejects unknown upgrade paths", async () => {
    server = new RelayServer();
    const started = await server.start(0);
    const internal = server as unknown as { server?: { emit: (event: string, ...args: unknown[]) => void } };
    const destroy = vi.fn();
    internal.server?.emit("upgrade", { url: "/unknown", headers: {}, socket: { remoteAddress: "127.0.0.1" } }, { destroy, write: vi.fn() }, Buffer.from(""));
    expect(destroy).toHaveBeenCalled();
    expect(started.url).toContain("ws://127.0.0.1:");
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

    it("allows /pair without an Origin header", async () => {
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
      const data = await response.json();
      expect(data.relayPort).toBe(started.port);
      expect(data.pairingRequired).toBe(true);
      expect(typeof data.instanceId).toBe("string");
      expect("discoveryPort" in data).toBe(true);
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
        handleConfigRequest: (origin: string | undefined, res: ServerResponse) => void;
      };
      internal.handleConfigRequest(extensionOrigin, response);

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

    it("allows config requests without an Origin header", async () => {
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
          "Access-Control-Request-Method": "GET"
        }
      });
      expect(response.status).toBe(204);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(extensionOrigin);
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
    it("returns token-free relay status", async () => {
      server = new RelayServer();
      server.setToken("secret");
      const started = await server.start(0);

      const response = await fetch(`http://127.0.0.1:${started.port}/status`);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(typeof data.instanceId).toBe("string");
      expect(data.extensionConnected).toBe(false);
      expect(data.extensionHandshakeComplete).toBe(false);
      expect(data.pairingRequired).toBe(true);
      expect("token" in data).toBe(false);
      expect("pairingToken" in data).toBe(false);
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
