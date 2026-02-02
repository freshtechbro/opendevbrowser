import { createServer, type IncomingMessage, type ServerResponse } from "http";
import type { AddressInfo } from "net";
import { timingSafeEqual, randomUUID } from "crypto";
import { WebSocket, WebSocketServer } from "ws";
import {
  AnnotationErrorCode,
  AnnotationResponse,
  MAX_OPS_PAYLOAD_BYTES,
  OPS_PROTOCOL_VERSION,
  OpsChunk,
  OpsEnvelope,
  OpsError,
  OpsErrorCode,
  OpsErrorResponse,
  OpsEvent,
  OpsHello,
  OpsHelloAck,
  OpsPing,
  OpsPong,
  OpsRequest,
  OpsResponse,
  RelayAnnotationCommand,
  RelayAnnotationEvent,
  RelayAnnotationResponse,
  RelayCommand,
  RelayEvent,
  RelayHandshake,
  RelayHandshakeAck,
  RelayHandshakeError,
  RelayHealthCheck,
  RelayHealthResponse,
  RelayHealthStatus,
  RelayPing,
  RelayPong,
  RelayResponse
} from "./protocol";

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
  annotationConnected: boolean;
  opsConnected: boolean;
  pairingRequired: boolean;
  instanceId: string;
  extension?: ExtensionInfo;
  epoch: number;
  lastHandshakeError?: RelayHandshakeError;
  health: RelayHealthStatus;
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
  private annotationWss: WebSocketServer | null = null;
  private opsWss: WebSocketServer | null = null;
  private extensionSocket: WebSocket | null = null;
  private cdpSocket: WebSocket | null = null;
  private annotationSocket: WebSocket | null = null;
  private opsClients = new Map<string, WebSocket>();
  private opsOwnedTabIds = new Set<number>();
  private extensionInfo: ExtensionInfo | null = null;
  private extensionHandshakeComplete = false;
  private pairingToken: string | null = null;
  private lastHandshakeError: RelayHandshakeError | null = null;
  private configuredDiscoveryPort: number;
  private discoveryPort: number | null = null;
  private handshakeAttempts = new Map<string, { count: number; resetAt: number }>();
  private httpAttempts = new Map<string, { count: number; resetAt: number }>();
  private cdpAllowlist: Set<string> | null = null;
  private annotationPending = new Map<string, { createdAt: number }>();
  private static readonly MAX_HANDSHAKE_ATTEMPTS = 5;
  private static readonly RATE_LIMIT_WINDOW_MS = 60_000;
  private static readonly MAX_HTTP_ATTEMPTS = 60;
  private static readonly MAX_ANNOTATION_PAYLOAD_BYTES = 12 * 1024 * 1024;
  private static readonly ANNOTATION_REQUEST_TIMEOUT_MS = 120_000;

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
    this.annotationWss = new WebSocketServer({ noServer: true });
    this.opsWss = new WebSocketServer({ noServer: true });

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
          this.opsOwnedTabIds.clear();
          this.failPendingAnnotations("relay_unavailable", "Extension disconnected.");
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

    this.annotationWss.on("connection", (socket: WebSocket) => {
      if (this.annotationSocket) {
        socket.close(1008, "Only one annotation client supported");
        return;
      }
      this.annotationSocket = socket;
      socket.on("message", (data: WebSocket.RawData) => {
        this.handleAnnotationMessage(data);
      });
      socket.on("close", () => {
        if (this.annotationSocket === socket) {
          this.annotationSocket = null;
          this.annotationPending.clear();
        }
      });
    });

    this.opsWss.on("connection", (socket: WebSocket, _request: IncomingMessage) => {
      const clientId = randomUUID();
      this.opsClients.set(clientId, socket);
      socket.on("message", (data: WebSocket.RawData) => {
        this.handleOpsClientMessage(clientId, data);
      });
      socket.on("close", () => {
        if (this.opsClients.get(clientId) === socket) {
          this.opsClients.delete(clientId);
          this.notifyOpsClientClosed(clientId);
        }
      });
      socket.on("error", () => {
        if (this.opsClients.get(clientId) === socket) {
          this.opsClients.delete(clientId);
          this.notifyOpsClientClosed(clientId);
        }
      });
      void _request;
    });

    this.server.on("request", (request: IncomingMessage, response) => {
      const pathname = new URL(request.url ?? "", "http://127.0.0.1").pathname;
      const origin = request.headers.origin;
      
      if (pathname === CONFIG_PATH && request.method === "OPTIONS") {
        this.handleConfigPreflight(origin, request, response);
        return;
      }
      
      if (pathname === CONFIG_PATH && request.method === "GET") {
        this.handleConfigRequest(request, origin, response);
        return;
      }

      if (pathname === STATUS_PATH && request.method === "OPTIONS") {
        this.handleConfigPreflight(origin, request, response);
        return;
      }

      if (pathname === STATUS_PATH && request.method === "GET") {
        this.handleStatusRequest(request, origin, response);
        return;
      }
      
      if (pathname === PAIR_PATH && request.method === "OPTIONS") {
        if (origin && (origin.startsWith("chrome-extension://") || this.isNullOrigin(origin))) {
          this.applyCorsOrigin(origin, response);
          response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
          response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
          this.applyPrivateNetworkPreflight(request, response);
        }
        response.writeHead(204);
        response.end();
        return;
      }
      
      if (pathname === PAIR_PATH && request.method === "GET") {
        if (!this.authorizeHttpRequest(origin, request, response)) {
          return;
        }

        this.applyCorsOrigin(origin, response);
        this.applyPrivateNetworkResponse(origin, response);

        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ token: this.pairingToken, instanceId: this.instanceId, epoch: this.epoch }));
        return;
      }
      
      response.writeHead(404);
      response.end();
    });

    this.server.on("upgrade", (request: IncomingMessage, socket, head) => {
      const rawOrigin = request.headers.origin;
      const origin = this.normalizeOrigin(rawOrigin);
      const ip = request.socket.remoteAddress ?? "unknown";
      const pathname = new URL(request.url ?? "", "http://127.0.0.1").pathname;

      if (pathname === "/extension") {
        if (!this.isExtensionOrigin(origin)) {
          this.logSecurityEvent("origin_blocked", { origin: rawOrigin ?? "", ip, path: pathname });
          socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
          socket.destroy();
          return;
        }
        if (this.isRateLimited(ip)) {
          this.logSecurityEvent("rate_limited", { ip, path: pathname });
          socket.write("HTTP/1.1 429 Too Many Requests\r\n\r\n");
          socket.destroy();
          return;
        }
        this.extensionWss?.handleUpgrade(request, socket, head, (ws: WebSocket) => {
          this.extensionWss?.emit("connection", ws, request);
        });
        return;
      }

      if (pathname === "/cdp") {
        if (this.isRateLimited(ip)) {
          this.logSecurityEvent("rate_limited", { ip, path: pathname });
          socket.write("HTTP/1.1 429 Too Many Requests\r\n\r\n");
          socket.destroy();
          return;
        }
        if (origin && !this.isExtensionOrigin(origin)) {
          this.logSecurityEvent("origin_blocked", { origin: rawOrigin ?? "", ip, path: pathname });
          socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
          socket.destroy();
          return;
        }
        if (!origin && !this.isLoopbackAddress(ip)) {
          this.logSecurityEvent("origin_blocked", { origin: rawOrigin ?? "", ip, path: pathname });
          socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
          socket.destroy();
          return;
        }
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

      if (pathname === "/annotation") {
        if (this.isRateLimited(ip)) {
          this.logSecurityEvent("rate_limited", { ip, path: pathname });
          socket.write("HTTP/1.1 429 Too Many Requests\r\n\r\n");
          socket.destroy();
          return;
        }
        if (origin && !this.isExtensionOrigin(origin)) {
          this.logSecurityEvent("origin_blocked", { origin: rawOrigin ?? "", ip, path: pathname });
          socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
          socket.destroy();
          return;
        }
        if (!origin && !this.isLoopbackAddress(ip)) {
          this.logSecurityEvent("origin_blocked", { origin: rawOrigin ?? "", ip, path: pathname });
          socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
          socket.destroy();
          return;
        }
        const token = this.getCdpTokenFromRequestUrl(request.url);
        if (!this.isTokenValid(token)) {
          this.logSecurityEvent("annotation_unauthorized", { ip });
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
          socket.destroy();
          return;
        }
        this.annotationWss?.handleUpgrade(request, socket, head, (ws: WebSocket) => {
          this.annotationWss?.emit("connection", ws, request);
        });
        return;
      }

      if (pathname === "/ops") {
        if (this.isRateLimited(ip)) {
          this.logSecurityEvent("rate_limited", { ip, path: pathname });
          socket.write("HTTP/1.1 429 Too Many Requests\r\n\r\n");
          socket.destroy();
          return;
        }
        if (origin && !this.isExtensionOrigin(origin)) {
          this.logSecurityEvent("origin_blocked", { origin: rawOrigin ?? "", ip, path: pathname });
          socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
          socket.destroy();
          return;
        }
        if (!origin && !this.isLoopbackAddress(ip)) {
          this.logSecurityEvent("origin_blocked", { origin: rawOrigin ?? "", ip, path: pathname });
          socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
          socket.destroy();
          return;
        }
        const token = this.getCdpTokenFromRequestUrl(request.url);
        if (!this.isTokenValid(token)) {
          this.logSecurityEvent("ops_unauthorized", { ip });
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
          socket.destroy();
          return;
        }
        this.opsWss?.handleUpgrade(request, socket, head, (ws: WebSocket) => {
          this.opsWss?.emit("connection", ws, request);
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

    if (this.annotationSocket) {
      this.annotationSocket.close(1000, "Relay stopped");
      this.annotationSocket = null;
    }

    for (const socket of this.opsClients.values()) {
      socket.close(1000, "Relay stopped");
    }
    this.opsClients.clear();
    this.opsOwnedTabIds.clear();

    this.extensionWss?.close();
    this.cdpWss?.close();
    this.annotationWss?.close();
    this.opsWss?.close();
    this.server?.close();

    this.extensionWss = null;
    this.cdpWss = null;
    this.annotationWss = null;
    this.opsWss = null;
    this.server = null;
  }

  status(): RelayStatus {
    const health = this.buildHealthStatus();
    return {
      running: this.running,
      url: this.baseUrl || undefined,
      port: this.port ?? undefined,
      extensionConnected: Boolean(this.extensionSocket),
      extensionHandshakeComplete: this.extensionHandshakeComplete,
      cdpConnected: Boolean(this.cdpSocket),
      annotationConnected: Boolean(this.annotationSocket),
      opsConnected: this.opsClients.size > 0,
      pairingRequired: Boolean(this.pairingToken),
      instanceId: this.instanceId,
      extension: this.extensionInfo ?? undefined,
      epoch: this.epoch,
      lastHandshakeError: this.lastHandshakeError ?? undefined,
      health
    };
  }

  getCdpUrl(): string | null {
    return this.baseUrl ? `${this.baseUrl}/cdp` : null;
  }

  getAnnotationUrl(): string | null {
    return this.baseUrl ? `${this.baseUrl}/annotation` : null;
  }

  getOpsUrl(): string | null {
    return this.baseUrl ? `${this.baseUrl}/ops` : null;
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

  private isExtensionOrigin(origin: string | undefined): boolean {
    return Boolean(origin && origin.startsWith("chrome-extension://"));
  }

  private isNullOrigin(origin: string | undefined): boolean {
    return origin === "null";
  }

  private applyPrivateNetworkPreflight(request: IncomingMessage, response: ServerResponse): void {
    const pna = request.headers["access-control-request-private-network"];
    if (typeof pna === "string" && pna.toLowerCase() === "true") {
      response.setHeader("Access-Control-Allow-Private-Network", "true");
    }
  }

  private applyPrivateNetworkResponse(origin: string | undefined, response: ServerResponse): void {
    if (origin && (this.isExtensionOrigin(origin) || this.isNullOrigin(origin))) {
      response.setHeader("Access-Control-Allow-Private-Network", "true");
    }
  }

  private applyCorsOrigin(origin: string | undefined, response: ServerResponse): void {
    if (origin && this.isExtensionOrigin(origin)) {
      response.setHeader("Access-Control-Allow-Origin", origin);
      return;
    }
    if (this.isNullOrigin(origin)) {
      response.setHeader("Access-Control-Allow-Origin", "null");
    }
  }

  private normalizeOrigin(origin: string | undefined): string | undefined {
    if (!origin || origin === "null") {
      return undefined;
    }
    return origin;
  }

  private isLoopbackAddress(ip: string): boolean {
    if (!ip) return false;
    return ip === "127.0.0.1"
      || ip === "::1"
      || ip.startsWith("::ffff:127.");
  }

  private isHttpRateLimited(ip: string): boolean {
    const now = Date.now();
    const record = this.httpAttempts.get(ip);

    if (!record || now > record.resetAt) {
      this.httpAttempts.set(ip, { count: 1, resetAt: now + RelayServer.RATE_LIMIT_WINDOW_MS });
      return false;
    }

    record.count++;
    return record.count > RelayServer.MAX_HTTP_ATTEMPTS;
  }

  private authorizeHttpRequest(origin: string | undefined, request: IncomingMessage, response: ServerResponse): boolean {
    const normalizedOrigin = this.normalizeOrigin(origin);
    const ip = request.socket.remoteAddress ?? "unknown";

    if (this.isHttpRateLimited(ip)) {
      this.logSecurityEvent("http_rate_limited", { ip });
      response.writeHead(429, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "Too Many Requests" }));
      return false;
    }

    if (normalizedOrigin) {
      if (!this.isExtensionOrigin(normalizedOrigin)) {
        response.writeHead(403, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "Forbidden: extension origin required" }));
        return false;
      }
      return true;
    }

    if (!this.isLoopbackAddress(ip)) {
      response.writeHead(403, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "Forbidden: local requests only" }));
      return false;
    }

    return true;
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

  private handleConfigPreflight(origin: string | undefined, request: IncomingMessage, response: ServerResponse): void {
    if (origin && (this.isExtensionOrigin(origin) || this.isNullOrigin(origin))) {
      this.applyCorsOrigin(origin, response);
      response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      this.applyPrivateNetworkPreflight(request, response);
    }
    response.writeHead(204);
    response.end();
  }

  private handleConfigRequest(request: IncomingMessage, origin: string | undefined, response: ServerResponse): void {
    if (!this.authorizeHttpRequest(origin, request, response)) {
      return;
    }

    this.applyCorsOrigin(origin, response);
    this.applyPrivateNetworkResponse(origin, response);

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

  private handleStatusRequest(request: IncomingMessage, origin: string | undefined, response: ServerResponse): void {
    if (!this.authorizeHttpRequest(origin, request, response)) {
      return;
    }

    this.applyCorsOrigin(origin, response);
    this.applyPrivateNetworkResponse(origin, response);

    response.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    });
    const health = this.buildHealthStatus();
    response.end(JSON.stringify({
      instanceId: this.instanceId,
      running: this.running,
      port: this.port ?? undefined,
      extensionConnected: Boolean(this.extensionSocket),
      extensionHandshakeComplete: this.extensionHandshakeComplete,
      cdpConnected: Boolean(this.cdpSocket),
      annotationConnected: Boolean(this.annotationSocket),
      opsConnected: this.opsClients.size > 0,
      pairingRequired: Boolean(this.pairingToken),
      health,
      lastHandshakeError: this.lastHandshakeError ?? undefined
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
        this.handleConfigPreflight(origin, request, response);
        return;
      }

      if (pathname === CONFIG_PATH && request.method === "GET") {
        this.handleConfigRequest(request, origin, response);
        return;
      }

      if (pathname === STATUS_PATH && request.method === "OPTIONS") {
        this.handleConfigPreflight(origin, request, response);
        return;
      }

      if (pathname === STATUS_PATH && request.method === "GET") {
        this.handleStatusRequest(request, origin, response);
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

  private isOpsOwnedTargetId(targetId: string): boolean {
    if (!targetId.startsWith("tab-")) return false;
    const raw = targetId.slice(4);
    if (!raw) return false;
    const tabId = Number(raw);
    if (!Number.isFinite(tabId)) return false;
    return this.opsOwnedTabIds.has(tabId);
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

    if (method === "Target.attachToTarget" && isRecord(message.params)) {
      const targetId = typeof message.params.targetId === "string" ? message.params.targetId : "";
      if (this.isOpsOwnedTargetId(targetId)) {
        this.sendJson(this.cdpSocket, {
          id,
          error: { message: "cdp_attach_blocked: target is owned by an ops session" }
        } satisfies RelayResponse);
        return;
      }
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

  private handleAnnotationMessage(data: WebSocket.RawData): void {
    const message = parseJson(data);
    if (!isRecord(message)) {
      return;
    }

    if (isHealthCheck(message)) {
      this.sendJson(this.annotationSocket, this.buildHealthResponse(message));
      return;
    }
    if (isPing(message)) {
      this.sendJson(this.annotationSocket, this.buildPong(message));
      return;
    }

    if (isRelayAnnotationCommand(message)) {
      this.handleAnnotationCommand(message);
      return;
    }
  }

  private handleExtensionMessage(data: WebSocket.RawData): void {
    const message = parseJson(data);
    if (!isRecord(message)) {
      return;
    }

    if (isHandshake(message)) {
      if (!this.isPairingTokenValid(message)) {
        const hasToken = typeof message.payload.pairingToken === "string" && message.payload.pairingToken.length > 0;
        const code: RelayHandshakeError["code"] = hasToken ? "pairing_invalid" : "pairing_missing";
        this.lastHandshakeError = {
          code,
          message: hasToken ? "Invalid pairing token" : "Missing pairing token",
          at: Date.now()
        };
        this.logSecurityEvent("handshake_failed", { reason: hasToken ? "invalid_token" : "missing_token", tabId: message.payload.tabId });
        this.extensionInfo = null;
        this.extensionSocket?.close(1008, "Invalid pairing token");
        return;
      }
      if (this.extensionSocket) {
        this.extensionHandshakeComplete = true;
      }
      this.lastHandshakeError = null;
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

    if (isRelayAnnotationResponse(message)) {
      this.forwardAnnotationResponse(message);
      return;
    }

    if (isRelayAnnotationEvent(message)) {
      this.forwardAnnotationEvent(message);
      return;
    }

    if (isOpsEnvelope(message)) {
      this.handleOpsExtensionMessage(message);
      return;
    }

    if (isHealthCheck(message)) {
      this.sendJson(this.extensionSocket, this.buildHealthResponse(message));
      return;
    }
    if (isPing(message)) {
      this.sendJson(this.extensionSocket, this.buildPong(message));
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

  private handleAnnotationCommand(message: RelayAnnotationCommand): void {
    const payload = message.payload as unknown;
    if (!isAnnotationCommand(payload)) {
      const requestId = isRecord(payload) && typeof payload.requestId === "string"
        ? payload.requestId
        : "unknown";
      this.sendAnnotationError(requestId, "invalid_request", "Invalid annotation command payload.");
      return;
    }

    const command = payload;
    if (!this.extensionSocket || !this.extensionHandshakeComplete) {
      this.sendAnnotationError(command.requestId, "relay_unavailable", "Extension not connected to relay.");
      return;
    }

    this.annotationPending.set(command.requestId, { createdAt: Date.now() });
    this.sendJson(this.extensionSocket, message);

    setTimeout(() => {
      if (!this.annotationPending.has(command.requestId)) return;
      this.annotationPending.delete(command.requestId);
      this.sendAnnotationError(command.requestId, "timeout", "Annotation request timed out.");
    }, RelayServer.ANNOTATION_REQUEST_TIMEOUT_MS);
  }

  private handleOpsClientMessage(clientId: string, data: WebSocket.RawData): void {
    const message = parseJson(data);
    if (!isRecord(message)) {
      return;
    }

    if (!this.extensionSocket || !this.extensionHandshakeComplete) {
      this.sendOpsError(clientId, {
        code: "ops_unavailable",
        message: "Extension not connected to relay.",
        retryable: true
      }, getOpsRequestId(message), getOpsSessionId(message));
      return;
    }

    if (isOpsHello(message) || isOpsRequest(message) || isOpsPing(message)) {
      const sizeBytes = Buffer.byteLength(JSON.stringify(message));
      if (sizeBytes > MAX_OPS_PAYLOAD_BYTES) {
        this.sendOpsError(clientId, {
          code: "invalid_request",
          message: "Ops payload exceeded relay limits.",
          retryable: false,
          details: { maxPayloadBytes: MAX_OPS_PAYLOAD_BYTES }
        }, getOpsRequestId(message), getOpsSessionId(message));
        return;
      }

      this.sendJson(this.extensionSocket, { ...message, clientId } satisfies OpsEnvelope);
      return;
    }

    this.sendOpsError(clientId, {
      code: "invalid_request",
      message: "Invalid ops message.",
      retryable: false
    }, getOpsRequestId(message), getOpsSessionId(message));
  }

  private handleOpsExtensionMessage(message: OpsEnvelope): void {
    if (message.type === "ops_event") {
      const tabId = extractOpsTabId(message.payload);
      if (typeof tabId === "number") {
        if (message.event === "ops_session_created") {
          this.opsOwnedTabIds.add(tabId);
        }
        if (message.event === "ops_session_closed" || message.event === "ops_session_expired" || message.event === "ops_tab_closed") {
          this.opsOwnedTabIds.delete(tabId);
        }
      }
    }

    if (message.type === "ops_hello_ack" && this.opsClients.size === 0) {
      return;
    }

    const clientId = message.clientId;
    if (!clientId) {
      return;
    }
    const client = this.opsClients.get(clientId);
    if (!client) {
      return;
    }
    this.sendJson(client, message);
  }

  private notifyOpsClientClosed(clientId: string): void {
    if (!this.extensionSocket) return;
    const event: OpsEvent = {
      type: "ops_event",
      clientId,
      event: "ops_client_disconnected",
      payload: { at: Date.now() }
    };
    this.sendJson(this.extensionSocket, event);
  }

  private sendOpsError(clientId: string, error: OpsError, requestId?: string, opsSessionId?: string): void {
    const client = this.opsClients.get(clientId);
    if (!client) return;
    const payload: OpsErrorResponse = {
      type: "ops_error",
      requestId: requestId ?? "unknown",
      clientId,
      opsSessionId,
      error
    };
    this.sendJson(client, payload);
  }

  private forwardAnnotationResponse(message: RelayAnnotationResponse): void {
    const payload = message.payload as unknown;
    if (!isAnnotationResponse(payload)) {
      const requestId = isRecord(payload) && typeof payload.requestId === "string"
        ? payload.requestId
        : "unknown";
      this.sendAnnotationError(requestId, "invalid_request", "Invalid annotation response payload.");
      return;
    }

    const requestId = payload.requestId;
    if (!this.annotationPending.has(requestId)) {
      return;
    }

    const sizeBytes = Buffer.byteLength(JSON.stringify(message));
    if (sizeBytes > RelayServer.MAX_ANNOTATION_PAYLOAD_BYTES) {
      this.annotationPending.delete(requestId);
      this.sendAnnotationError(requestId, "payload_too_large", "Annotation payload exceeded relay limits.");
      return;
    }

    this.annotationPending.delete(requestId);
    this.sendJson(this.annotationSocket, message);
  }

  private forwardAnnotationEvent(message: RelayAnnotationEvent): void {
    if (!isAnnotationEvent(message.payload)) {
      return;
    }
    const requestId = message.payload.requestId;
    if (!this.annotationPending.has(requestId)) {
      return;
    }
    const sizeBytes = Buffer.byteLength(JSON.stringify(message));
    if (sizeBytes > RelayServer.MAX_ANNOTATION_PAYLOAD_BYTES) {
      return;
    }
    this.sendJson(this.annotationSocket, message);
  }

  private sendAnnotationError(requestId: string, code: AnnotationErrorCode, message: string): void {
    const payload: AnnotationResponse = {
      version: 1,
      requestId,
      status: "error",
      error: { code, message }
    };
    const response: RelayAnnotationResponse = {
      type: "annotationResponse",
      payload
    };
    this.sendJson(this.annotationSocket, response);
  }

  private failPendingAnnotations(code: AnnotationErrorCode, message: string): void {
    for (const requestId of this.annotationPending.keys()) {
      this.sendAnnotationError(requestId, code, message);
    }
    this.annotationPending.clear();
  }

  private buildHealthStatus(): RelayHealthStatus {
    const opsConnected = this.opsClients.size > 0;
    if (!this.running) {
      return {
        ok: false,
        reason: "relay_down",
        detail: "Relay not running",
        extensionConnected: false,
        extensionHandshakeComplete: false,
        cdpConnected: Boolean(this.cdpSocket),
        annotationConnected: Boolean(this.annotationSocket),
        opsConnected,
        pairingRequired: Boolean(this.pairingToken),
        lastHandshakeError: this.lastHandshakeError ?? undefined
      };
    }

    if (this.lastHandshakeError?.code === "pairing_invalid") {
      return {
        ok: false,
        reason: "pairing_invalid",
        detail: this.lastHandshakeError.message,
        extensionConnected: Boolean(this.extensionSocket),
        extensionHandshakeComplete: this.extensionHandshakeComplete,
        cdpConnected: Boolean(this.cdpSocket),
        annotationConnected: Boolean(this.annotationSocket),
        opsConnected,
        pairingRequired: Boolean(this.pairingToken),
        lastHandshakeError: this.lastHandshakeError
      };
    }

    if (this.lastHandshakeError?.code === "pairing_missing") {
      return {
        ok: false,
        reason: "pairing_required",
        detail: this.lastHandshakeError.message,
        extensionConnected: Boolean(this.extensionSocket),
        extensionHandshakeComplete: this.extensionHandshakeComplete,
        cdpConnected: Boolean(this.cdpSocket),
        annotationConnected: Boolean(this.annotationSocket),
        opsConnected,
        pairingRequired: Boolean(this.pairingToken),
        lastHandshakeError: this.lastHandshakeError
      };
    }

    if (!this.extensionSocket) {
      return {
        ok: false,
        reason: "extension_disconnected",
        detail: "Extension not connected",
        extensionConnected: false,
        extensionHandshakeComplete: false,
        cdpConnected: Boolean(this.cdpSocket),
        annotationConnected: Boolean(this.annotationSocket),
        opsConnected,
        pairingRequired: Boolean(this.pairingToken),
        lastHandshakeError: this.lastHandshakeError ?? undefined
      };
    }

    if (!this.extensionHandshakeComplete) {
      return {
        ok: false,
        reason: "handshake_incomplete",
        detail: "Extension handshake pending",
        extensionConnected: true,
        extensionHandshakeComplete: false,
        cdpConnected: Boolean(this.cdpSocket),
        annotationConnected: Boolean(this.annotationSocket),
        opsConnected,
        pairingRequired: Boolean(this.pairingToken),
        lastHandshakeError: this.lastHandshakeError ?? undefined
      };
    }

    return {
      ok: true,
      reason: "ok",
      extensionConnected: true,
      extensionHandshakeComplete: true,
      cdpConnected: Boolean(this.cdpSocket),
      annotationConnected: Boolean(this.annotationSocket),
      opsConnected,
      pairingRequired: Boolean(this.pairingToken),
      lastHandshakeError: this.lastHandshakeError ?? undefined
    };
  }

  private buildHealthResponse(request: RelayHealthCheck): RelayHealthResponse {
    return {
      type: "healthCheckResult",
      id: request.id,
      payload: this.buildHealthStatus()
    };
  }

  private buildPong(request: RelayPing): RelayPong {
    return {
      type: "pong",
      id: request.id,
      payload: this.buildHealthStatus()
    };
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

    if (typeof received !== "string") {
      return false;
    }

    const expected = this.pairingToken;
    const expectedBuf = Buffer.from(expected, "utf-8");
    const receivedBuf = Buffer.from(received, "utf-8");

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

const isHealthCheck = (value: Record<string, unknown>): value is RelayHealthCheck => {
  return value.type === "healthCheck" && typeof value.id === "string";
};

const isPing = (value: Record<string, unknown>): value is RelayPing => {
  return value.type === "ping" && typeof value.id === "string";
};

const isRelayAnnotationCommand = (value: Record<string, unknown>): value is RelayAnnotationCommand => {
  return value.type === "annotationCommand" && isRecord(value.payload);
};

const isRelayAnnotationResponse = (value: Record<string, unknown>): value is RelayAnnotationResponse => {
  return value.type === "annotationResponse" && isRecord(value.payload);
};

const isRelayAnnotationEvent = (value: Record<string, unknown>): value is RelayAnnotationEvent => {
  return value.type === "annotationEvent" && isRecord(value.payload);
};

const isOpsHello = (value: Record<string, unknown>): value is OpsHello => {
  return value.type === "ops_hello" && typeof value.version === "string";
};

const isOpsPing = (value: Record<string, unknown>): value is OpsPing => {
  return value.type === "ops_ping" && typeof value.id === "string";
};

const isOpsRequest = (value: Record<string, unknown>): value is OpsRequest => {
  return value.type === "ops_request" && typeof value.requestId === "string" && typeof value.command === "string";
};

const isOpsEnvelope = (value: Record<string, unknown>): value is OpsEnvelope => {
  const type = value.type;
  return typeof type === "string" && type.startsWith("ops_");
};

const getOpsRequestId = (value: Record<string, unknown>): string | undefined => {
  return typeof value.requestId === "string" ? value.requestId : undefined;
};

const getOpsSessionId = (value: Record<string, unknown>): string | undefined => {
  return typeof value.opsSessionId === "string" ? value.opsSessionId : undefined;
};

const extractOpsTabId = (payload: unknown): number | undefined => {
  if (!isRecord(payload)) return undefined;
  const tabId = payload.tabId;
  return typeof tabId === "number" ? tabId : undefined;
};

const isAnnotationCommand = (value: unknown): value is RelayAnnotationCommand["payload"] => {
  if (!isRecord(value)) return false;
  if (value.version !== 1) return false;
  if (typeof value.requestId !== "string") return false;
  if (value.command !== "start" && value.command !== "cancel") return false;
  if (value.options && !isRecord(value.options)) return false;
  return true;
};

const isAnnotationResponse = (value: unknown): value is RelayAnnotationResponse["payload"] => {
  if (!isRecord(value)) return false;
  if (value.version !== 1) return false;
  if (typeof value.requestId !== "string") return false;
  if (value.status !== "ok" && value.status !== "cancelled" && value.status !== "error") return false;
  if (value.error && !isRecord(value.error)) return false;
  return true;
};

const isAnnotationEvent = (value: unknown): value is RelayAnnotationEvent["payload"] => {
  if (!isRecord(value)) return false;
  if (value.version !== 1) return false;
  if (typeof value.requestId !== "string") return false;
  if (value.event !== "progress" && value.event !== "ready" && value.event !== "warning") return false;
  return true;
};
