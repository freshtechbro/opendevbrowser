import { createServer, type IncomingMessage, type ServerResponse } from "http";
import type { AddressInfo } from "net";
import { timingSafeEqual, randomUUID } from "crypto";
import { WebSocket, WebSocketServer } from "ws";
import type { RelayCommand, RelayEvent, RelayHandshake, RelayHandshakeAck, RelayResponse } from "./protocol";

const DEFAULT_DISCOVERY_PORT = 8787;
const CONFIG_PATH = "/config";
const PAIR_PATH = "/pair";
const STATUS_PATH = "/status";
const CDP_TOKEN_QUERY_KEY = "token";

type ExtensionInfo = {
  tabId: number;
  url?: string;
  title?: string;
  groupId?: number;
};

export type RelayStatus = {
  running: boolean;
  url?: string;
  port?: number;
  extensionConnected: boolean;
  extensionHandshakeComplete: boolean;
  cdpConnected: boolean;
  pairingRequired: boolean;
  instanceId: string;
  extension?: ExtensionInfo;
  epoch: number;
};

type RelayServerOptions = {
  discoveryPort?: number;
};

export class RelayServer {
  private readonly instanceId = randomUUID();
  private readonly epoch = Date.now();
  private running = false;
  private baseUrl: string | null = null;
  private port: number | null = null;
  private server: ReturnType<typeof createServer> | null = null;
  private discoveryServer: ReturnType<typeof createServer> | null = null;
  private extensionWss: WebSocketServer | null = null;
  private cdpWss: WebSocketServer | null = null;
  private extensionSocket: WebSocket | null = null;
  private cdpSocket: WebSocket | null = null;
  private extensionInfo: ExtensionInfo | null = null;
  private extensionHandshakeComplete = false;
  private pairingToken: string | null = null;
  private configuredDiscoveryPort: number;
  private discoveryPort: number | null = null;
  private handshakeAttempts = new Map<string, { count: number; resetAt: number }>();
  private cdpAllowlist: Set<string> | null = null;
  private static readonly MAX_HANDSHAKE_ATTEMPTS = 5;
  private static readonly RATE_LIMIT_WINDOW_MS = 60_000;

  constructor(options: RelayServerOptions = {}) {
    this.configuredDiscoveryPort = options.discoveryPort ?? DEFAULT_DISCOVERY_PORT;
  }

  async start(port = 8787): Promise<{ url: string; port: number }> {
    if (this.running && this.baseUrl && this.port !== null) {
      return { url: this.baseUrl, port: this.port };
    }

    this.server = createServer();
    this.extensionWss = new WebSocketServer({ noServer: true });
    this.cdpWss = new WebSocketServer({ noServer: true });

    this.extensionWss.on("connection", (socket: WebSocket) => {
      if (this.extensionSocket) {
        this.extensionSocket.close(1000, "Replaced by a new extension client");
      }
      this.extensionSocket = socket;
      this.extensionInfo = null;
      this.extensionHandshakeComplete = false;
      socket.on("message", (data: WebSocket.RawData) => {
        this.handleExtensionMessage(data);
      });
      socket.on("close", () => {
        if (this.extensionSocket === socket) {
          this.extensionSocket = null;
          this.extensionInfo = null;
          this.extensionHandshakeComplete = false;
        }
        if (this.cdpSocket) {
          this.cdpSocket.close(1011, "Extension disconnected");
        }
      });
    });

    this.cdpWss.on("connection", (socket: WebSocket) => {
      if (this.cdpSocket) {
        socket.close(1008, "Only one CDP client supported");
        return;
      }
      this.cdpSocket = socket;
      socket.on("message", (data: WebSocket.RawData) => {
        this.handleCdpMessage(data);
      });
      socket.on("close", () => {
        if (this.cdpSocket === socket) {
          this.cdpSocket = null;
        }
      });
    });

    this.server.on("request", (request: IncomingMessage, response) => {
      const pathname = new URL(request.url ?? "", "http://127.0.0.1").pathname;
      const origin = request.headers.origin;
      
      if (pathname === CONFIG_PATH && request.method === "OPTIONS") {
        this.handleConfigPreflight(origin, response);
        return;
      }
      
      if (pathname === CONFIG_PATH && request.method === "GET") {
        this.handleConfigRequest(origin, response);
        return;
      }

      if (pathname === STATUS_PATH && request.method === "OPTIONS") {
        this.handleConfigPreflight(origin, response);
        return;
      }

      if (pathname === STATUS_PATH && request.method === "GET") {
        this.handleStatusRequest(origin, response);
        return;
      }
      
      if (pathname === PAIR_PATH && request.method === "OPTIONS") {
        if (origin && origin.startsWith("chrome-extension://")) {
          response.setHeader("Access-Control-Allow-Origin", origin);
          response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
          response.setHeader("Access-Control-Allow-Headers", "Content-Type");
        }
        response.writeHead(204);
        response.end();
        return;
      }
      
      if (pathname === PAIR_PATH && request.method === "GET") {
        if (origin && !this.isExtensionOrigin(origin)) {
          response.writeHead(403, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ error: "Forbidden: extension origin required" }));
          return;
        }
        
        if (origin) {
        response.setHeader("Access-Control-Allow-Origin", origin);
        }
        
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ token: this.pairingToken, instanceId: this.instanceId, epoch: this.epoch }));
        return;
      }
      
      response.writeHead(404);
      response.end();
    });

    this.server.on("upgrade", (request: IncomingMessage, socket, head) => {
      const origin = request.headers.origin;
      const ip = request.socket.remoteAddress ?? "unknown";

      if (!this.isAllowedOrigin(origin)) {
        this.logSecurityEvent("origin_blocked", { origin, ip });
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }

      if (this.isRateLimited(ip)) {
        this.logSecurityEvent("rate_limited", { ip });
        socket.write("HTTP/1.1 429 Too Many Requests\r\n\r\n");
        socket.destroy();
        return;
      }

      const pathname = new URL(request.url ?? "", "http://127.0.0.1").pathname;
      if (pathname === "/extension") {
        this.extensionWss?.handleUpgrade(request, socket, head, (ws: WebSocket) => {
          this.extensionWss?.emit("connection", ws, request);
        });
        return;
      }
      if (pathname === "/cdp") {
        const token = this.getCdpTokenFromRequestUrl(request.url);
        if (!this.isTokenValid(token)) {
          this.logSecurityEvent("cdp_unauthorized", { ip });
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
          socket.destroy();
          return;
        }
        this.cdpWss?.handleUpgrade(request, socket, head, (ws: WebSocket) => {
          this.cdpWss?.emit("connection", ws, request);
        });
        return;
      }
      socket.destroy();
    });

    await new Promise<void>((resolve, reject) => {
      this.server?.once("error", reject);
      this.server?.listen(port, "127.0.0.1", () => {
        resolve();
      });
    });

    const address = this.server.address() as AddressInfo | null;
    if (!address) {
      throw new Error("Relay server did not expose a port");
    }

    this.port = address.port;
    this.baseUrl = `ws://127.0.0.1:${address.port}`;
    this.running = true;

    try {
      await this.startDiscoveryServer();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[opendevbrowser] Discovery server failed to start: ${message}`);
      this.stopDiscoveryServer();
    }

    return { url: this.baseUrl, port: address.port };
  }

  stop(): void {
    this.running = false;
    this.baseUrl = null;
    this.port = null;
    this.extensionInfo = null;
    this.extensionHandshakeComplete = false;
    this.stopDiscoveryServer();

    if (this.extensionSocket) {
      this.extensionSocket.close(1000, "Relay stopped");
      this.extensionSocket = null;
    }

    if (this.cdpSocket) {
      this.cdpSocket.close(1000, "Relay stopped");
      this.cdpSocket = null;
    }

    this.extensionWss?.close();
    this.cdpWss?.close();
    this.server?.close();

    this.extensionWss = null;
    this.cdpWss = null;
    this.server = null;
  }

  status(): RelayStatus {
    return {
      running: this.running,
      url: this.baseUrl || undefined,
      port: this.port ?? undefined,
      extensionConnected: Boolean(this.extensionSocket),
      extensionHandshakeComplete: this.extensionHandshakeComplete,
      cdpConnected: Boolean(this.cdpSocket),
      pairingRequired: Boolean(this.pairingToken),
      instanceId: this.instanceId,
      extension: this.extensionInfo ?? undefined,
      epoch: this.epoch
    };
  }

  getCdpUrl(): string | null {
    return this.baseUrl ? `${this.baseUrl}/cdp` : null;
  }

  getDiscoveryPort(): number | null {
    if (this.port !== null && this.port === this.configuredDiscoveryPort) {
      return this.port;
    }
    return this.discoveryPort;
  }

  setToken(token?: string | false | null): void {
    const trimmed = typeof token === "string" ? token.trim() : "";
    this.pairingToken = trimmed.length ? trimmed : null;
  }

  setCdpAllowlist(methods: string[] | undefined): void {
    if (!methods || methods.length === 0) {
      this.cdpAllowlist = null;
      return;
    }
    this.cdpAllowlist = new Set(methods);
  }

  private isAllowedOrigin(origin: string | undefined): boolean {
    if (!origin) {
      return true;
    }
    if (origin === "null") {
      return true;
    }
    if (origin.startsWith("chrome-extension://")) {
      return true;
    }
    return false;
  }

  private isExtensionOrigin(origin: string | undefined): boolean {
    return Boolean(origin && origin.startsWith("chrome-extension://"));
  }

  private getCdpTokenFromRequestUrl(requestUrl: string | undefined): string | null {
    try {
      const url = new URL(requestUrl ?? "", "http://127.0.0.1");
      const token = url.searchParams.get(CDP_TOKEN_QUERY_KEY);
      if (!token || token.trim().length === 0) {
        return null;
      }
      return token;
    } catch {
      return null;
    }
  }

  private handleConfigPreflight(origin: string | undefined, response: ServerResponse): void {
    if (origin && this.isExtensionOrigin(origin)) {
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    }
    response.writeHead(204);
    response.end();
  }

  private handleConfigRequest(origin: string | undefined, response: ServerResponse): void {
    if (origin && !this.isExtensionOrigin(origin)) {
      response.writeHead(403, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "Forbidden: extension origin required" }));
      return;
    }

    if (origin) {
      response.setHeader("Access-Control-Allow-Origin", origin);
    }

    if (this.port === null) {
      response.writeHead(503, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "Relay not running" }));
      return;
    }

    response.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    });
    response.end(JSON.stringify({
      relayPort: this.port,
      pairingRequired: Boolean(this.pairingToken),
      instanceId: this.instanceId,
      epoch: this.epoch,
      discoveryPort: this.getDiscoveryPort()
    }));
  }

  private handleStatusRequest(origin: string | undefined, response: ServerResponse): void {
    if (origin && !this.isExtensionOrigin(origin)) {
      response.writeHead(403, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "Forbidden: extension origin required" }));
      return;
    }

    if (origin) {
      response.setHeader("Access-Control-Allow-Origin", origin);
    }

    response.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    });
    response.end(JSON.stringify({
      instanceId: this.instanceId,
      running: this.running,
      port: this.port ?? undefined,
      extensionConnected: Boolean(this.extensionSocket),
      extensionHandshakeComplete: this.extensionHandshakeComplete,
      cdpConnected: Boolean(this.cdpSocket),
      pairingRequired: Boolean(this.pairingToken)
    }));
  }

  private async startDiscoveryServer(): Promise<void> {
    if (this.port === null || this.discoveryServer) {
      return;
    }

    if (this.configuredDiscoveryPort > 0 && this.configuredDiscoveryPort === this.port) {
      return;
    }

    this.discoveryServer = createServer((request: IncomingMessage, response) => {
      const pathname = new URL(request.url ?? "", "http://127.0.0.1").pathname;
      const origin = request.headers.origin;

      if (pathname === CONFIG_PATH && request.method === "OPTIONS") {
        this.handleConfigPreflight(origin, response);
        return;
      }

      if (pathname === CONFIG_PATH && request.method === "GET") {
        this.handleConfigRequest(origin, response);
        return;
      }

      if (pathname === STATUS_PATH && request.method === "OPTIONS") {
        this.handleConfigPreflight(origin, response);
        return;
      }

      if (pathname === STATUS_PATH && request.method === "GET") {
        this.handleStatusRequest(origin, response);
        return;
      }

      response.writeHead(404);
      response.end();
    });

    await new Promise<void>((resolve, reject) => {
      this.discoveryServer?.once("error", reject);
      this.discoveryServer?.listen(this.configuredDiscoveryPort, "127.0.0.1", () => {
        resolve();
      });
    });

    const address = this.discoveryServer.address() as AddressInfo | null;
    if (!address) {
      throw new Error("Discovery server did not expose a port");
    }

    this.discoveryPort = address.port;
  }

  private stopDiscoveryServer(): void {
    if (this.discoveryServer) {
      this.discoveryServer.close();
      this.discoveryServer = null;
    }
    this.discoveryPort = null;
  }

  private isRateLimited(ip: string): boolean {
    const now = Date.now();
    const record = this.handshakeAttempts.get(ip);

    if (!record || now > record.resetAt) {
      this.handshakeAttempts.set(ip, { count: 1, resetAt: now + RelayServer.RATE_LIMIT_WINDOW_MS });
      return false;
    }

    record.count++;
    return record.count > RelayServer.MAX_HANDSHAKE_ATTEMPTS;
  }

  private isCommandAllowed(method: string): boolean {
    if (!this.cdpAllowlist) return true;
    return this.cdpAllowlist.has(method);
  }

  private logSecurityEvent(event: string, details: Record<string, unknown>): void {
    const safeDetails = { ...details };
    delete safeDetails.token;
    delete safeDetails.pairingToken;
    console.warn(`[security] ${event}`, JSON.stringify(safeDetails));
  }

  private handleCdpMessage(data: WebSocket.RawData): void {
    const message = parseJson(data);
    if (!isRecord(message)) {
      return;
    }

    const id = message.id;
    const method = message.method;
    if ((typeof id !== "string" && typeof id !== "number") || typeof method !== "string") {
      return;
    }

    if (!this.extensionSocket) {
      this.sendJson(this.cdpSocket, {
        id,
        error: { message: "Extension not connected to relay" }
      } satisfies RelayResponse);
      return;
    }

    if (!this.isCommandAllowed(method)) {
      this.logSecurityEvent("command_blocked", { method });
      this.sendJson(this.cdpSocket, {
        id,
        error: { message: `CDP command '${method}' not in allowlist` }
      } satisfies RelayResponse);
      return;
    }

    const relayCommand: RelayCommand = {
      id,
      method: "forwardCDPCommand",
      params: {
        method,
        params: message.params,
        sessionId: typeof message.sessionId === "string" ? message.sessionId : undefined
      }
    };

    this.sendJson(this.extensionSocket, relayCommand);
  }

  private handleExtensionMessage(data: WebSocket.RawData): void {
    const message = parseJson(data);
    if (!isRecord(message)) {
      return;
    }

    if (isHandshake(message)) {
      if (!this.isPairingTokenValid(message)) {
        this.logSecurityEvent("handshake_failed", { reason: "invalid_token", tabId: message.payload.tabId });
        this.extensionInfo = null;
        this.extensionSocket?.close(1008, "Invalid pairing token");
        return;
      }
      if (this.extensionSocket) {
        this.extensionHandshakeComplete = true;
      }
      this.extensionInfo = {
        tabId: message.payload.tabId,
        url: message.payload.url,
        title: message.payload.title,
        groupId: message.payload.groupId
      };
      if (this.extensionSocket && this.port !== null) {
        const ack: RelayHandshakeAck = {
          type: "handshakeAck",
          payload: {
            instanceId: this.instanceId,
            relayPort: this.port,
            pairingRequired: Boolean(this.pairingToken),
            epoch: this.epoch
          }
        };
        this.sendJson(this.extensionSocket, ack);
      }
      return;
    }

    if (message.method === "forwardCDPEvent" && isRecord(message.params)) {
      const params = message.params as RelayEvent["params"];
      const event: Record<string, unknown> = {
        method: params.method,
        params: params.params ?? {}
      };
      if (params.sessionId) {
        event.sessionId = params.sessionId;
      }
      this.sendJson(this.cdpSocket, event);
      return;
    }

    if (typeof message.id === "string" || typeof message.id === "number") {
      const response: Record<string, unknown> = { id: message.id };
      if (typeof message.result !== "undefined") {
        response.result = message.result;
      }
      if (message.error) {
        response.error = message.error;
      }
      if (typeof message.sessionId === "string") {
        response.sessionId = message.sessionId;
      }
      this.sendJson(this.cdpSocket, response);
    }
  }

  private sendJson(socket: WebSocket | null, payload: unknown): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    socket.send(JSON.stringify(payload));
  }

  private isPairingTokenValid(handshake: RelayHandshake): boolean {
    return this.isTokenValid(handshake.payload.pairingToken);
  }

  private isTokenValid(received: string | undefined | null): boolean {
    if (!this.pairingToken) {
      return true;
    }

    const expected = this.pairingToken;
    const value = received ?? "";

    const expectedBuf = Buffer.from(expected, "utf-8");
    const receivedBuf = Buffer.from(value, "utf-8");

    if (expectedBuf.length !== receivedBuf.length) {
      timingSafeEqual(expectedBuf, expectedBuf);
      return false;
    }

    return timingSafeEqual(expectedBuf, receivedBuf);
  }
}

const parseJson = (data: WebSocket.RawData): unknown => {
  const text = typeof data === "string" ? data : data.toString();
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const isHandshake = (value: Record<string, unknown>): value is RelayHandshake => {
  if (value.type !== "handshake" || !isRecord(value.payload)) {
    return false;
  }
  return typeof value.payload.tabId === "number";
};
