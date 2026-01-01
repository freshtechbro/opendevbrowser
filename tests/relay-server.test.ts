import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WebSocket } from "ws";
import http from "http";
import { RelayServer } from "../src/relay/relay-server";

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
    await new Promise((resolve) => setTimeout(resolve, 10));
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

  it("accepts valid pairing tokens", async () => {
    server = new RelayServer();
    server.setToken("secret");
    const started = await server.start(0);

    const extension = await connect(`${started.url}/extension`);
    extension.send(JSON.stringify({ type: "handshake", payload: { tabId: 42, pairingToken: "secret" } }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(server.status().extension?.tabId).toBe(42);
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

      const response = await fetch(`http://127.0.0.1:${started.port}/pair`);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.token).toBe("my-secret-token");
    });

    it("rejects /pair from non-localhost origins", async () => {
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
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(server.status().extension?.tabId).toBe(1);
      ext3.close();
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
      await new Promise((resolve) => setTimeout(resolve, 10));

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
      await new Promise((resolve) => setTimeout(resolve, 10));

      const commandPromise = nextMessage(extension);
      cdp.send(JSON.stringify({ id: 1, method: "Browser.getVersion", params: {} }));
      const command = await commandPromise;
      expect(command.method).toBe("forwardCDPCommand");

      extension.close();
      cdp.close();
    });
  });
});
