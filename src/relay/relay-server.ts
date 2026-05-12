import { createServer, type IncomingMessage, type ServerResponse } from "http";
import type { AddressInfo } from "net";
import { timingSafeEqual, randomUUID } from "crypto";
import { WebSocket, WebSocketServer } from "ws";
import { getAnnotationTimeoutMessage } from "../annotate/timeout-messages";
import {
  AnnotationCommand,
  AnnotationErrorCode,
  AnnotationResponse,
  CanvasEnvelope,
  CanvasError,
  CanvasErrorResponse,
  CanvasEvent,
  CanvasHello,
  CanvasPing,
  CanvasRequest,
  MAX_OPS_PAYLOAD_BYTES,
  MAX_CANVAS_PAYLOAD_BYTES,
  OpsEnvelope,
  OpsError,
  OpsErrorResponse,
  OpsEvent,
  OpsHello,
  OpsPing,
  OpsRequest,
  RelayAnnotationCommand,
  RelayAnnotationEvent,
  RelayAnnotationResponse,
  RelayCdpControl,
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
  opsOwnedTargetCount: number;
  canvasConnected: boolean;
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
  private canvasWss: WebSocketServer | null = null;
  private extensionSocket: WebSocket | null = null;
  private extensionSocketIp: string | null = null;
  private cdpSocket: WebSocket | null = null;
  private annotationSocket: WebSocket | null = null;
  private opsClients = new Map<string, WebSocket>();
  private readyOpsClients = new Set<string>();
  private pendingOpsHelloAcks = new Map<string, NodeJS.Timeout>();
  private canvasClients = new Map<string, WebSocket>();
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
  private annotationPending = new Map<string, { createdAt: number; readySeen: boolean }>();
  private annotationDirectPending = new Map<string, {
    resolve: (response: AnnotationResponse) => void;
    timeout: NodeJS.Timeout;
    readySeen: boolean;
  }>();
  private storeAgentPayloadHandler: ((command: AnnotationCommand) => Promise<AnnotationResponse>) | null = null;
  private static readonly MAX_HANDSHAKE_ATTEMPTS = 5;
  private static readonly RATE_LIMIT_WINDOW_MS = 60_000;
  private static readonly MAX_HTTP_ATTEMPTS = 60;
  private static readonly OPS_HELLO_ACK_TIMEOUT_MS = 10000;
  private static readonly MAX_ANNOTATION_PAYLOAD_BYTES = 12 * 1024 * 1024;
  private static readonly MAX_OPS_PAYLOAD_BYTES = MAX_OPS_PAYLOAD_BYTES;
  private static readonly MAX_CANVAS_PAYLOAD_BYTES = MAX_CANVAS_PAYLOAD_BYTES;
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
    this.canvasWss = new WebSocketServer({ noServer: true });

    this.extensionWss.on("connection", (socket: WebSocket, request: IncomingMessage) => {
      if (this.extensionSocket) {
        const previousSocket = this.extensionSocket;
        this.clearExtensionState("Extension replaced.");
        previousSocket.close(1000, "Replaced by a new extension client");
      }
      this.extensionSocket = socket;
      this.extensionSocketIp = request.socket.remoteAddress ?? "unknown";
      this.extensionInfo = null;
      this.extensionHandshakeComplete = false;
      const releaseExtensionSocket = () => {
        if (this.extensionSocket === socket) {
          this.clearExtensionState("Extension disconnected.");
        }
      };
      socket.on("message", (data: WebSocket.RawData) => {
        this.handleExtensionMessage(data);
      });
      socket.on("close", () => {
        releaseExtensionSocket();
      });
      socket.on("error", () => {
        releaseExtensionSocket();
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
          try {
            socket.close(1011, "Extension client error");
          } catch {
            // Best-effort close after a socket-level failure.
          }
        }
      });
    });

    this.cdpWss.on("connection", (socket: WebSocket) => {
      if (this.cdpSocket && this.cdpSocket.readyState !== WebSocket.OPEN) {
        this.cdpSocket = null;
      }
      if (this.cdpSocket) {
        socket.close(1008, "Only one CDP client supported");
        return;
      }
      this.cdpSocket = socket;
      const releaseCdpSocket = () => {
        if (this.cdpSocket === socket) {
          this.cdpSocket = null;
          this.notifyExtensionCdpClientClosed();
        }
      };
      socket.on("message", (data: WebSocket.RawData) => {
        this.handleCdpMessage(data);
      });
      socket.on("close", () => {
        releaseCdpSocket();
      });
      socket.on("error", () => {
        releaseCdpSocket();
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
          try {
            socket.close(1011, "CDP client error");
          } catch {
            // Best-effort close after a socket-level failure.
          }
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
          this.readyOpsClients.delete(clientId);
          this.clearPendingOpsHelloAck(clientId);
          this.notifyOpsClientClosed(clientId);
        }
      });
      socket.on("error", () => {
        if (this.opsClients.get(clientId) === socket) {
          this.opsClients.delete(clientId);
          this.readyOpsClients.delete(clientId);
          this.clearPendingOpsHelloAck(clientId);
          this.notifyOpsClientClosed(clientId);
        }
      });
      void _request;
    });

    this.canvasWss.on("connection", (socket: WebSocket, _request: IncomingMessage) => {
      const clientId = randomUUID();
      this.canvasClients.set(clientId, socket);
      socket.on("message", (data: WebSocket.RawData) => {
        this.handleCanvasClientMessage(clientId, data);
      });
      socket.on("close", () => {
        if (this.canvasClients.get(clientId) === socket) {
          this.canvasClients.delete(clientId);
          this.notifyCanvasClientClosed(clientId);
        }
      });
      socket.on("error", () => {
        if (this.canvasClients.get(clientId) === socket) {
          this.canvasClients.delete(clientId);
          this.notifyCanvasClientClosed(clientId);
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
        if (!this.authorizeHttpRequest(PAIR_PATH, origin, request, response)) {
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
        if (this.isHandshakeRateLimited(ip, pathname)) {
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
        if (this.isRateLimited(ip, pathname)) {
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
        this.clearHandshakeFailures(ip, pathname);
        this.cdpWss?.handleUpgrade(request, socket, head, (ws: WebSocket) => {
          this.cdpWss?.emit("connection", ws, request);
        });
        return;
      }

      if (pathname === "/annotation") {
        if (this.isRateLimited(ip, pathname)) {
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
        this.clearHandshakeFailures(ip, pathname);
        this.annotationWss?.handleUpgrade(request, socket, head, (ws: WebSocket) => {
          this.annotationWss?.emit("connection", ws, request);
        });
        return;
      }

      if (pathname === "/ops") {
        if (this.isRateLimited(ip, pathname)) {
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
        this.clearHandshakeFailures(ip, pathname);
        this.opsWss?.handleUpgrade(request, socket, head, (ws: WebSocket) => {
          this.opsWss?.emit("connection", ws, request);
        });
        return;
      }

      if (pathname === "/canvas") {
        if (this.isRateLimited(ip, pathname)) {
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
          this.logSecurityEvent("canvas_unauthorized", { ip });
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
          socket.destroy();
          return;
        }
        this.clearHandshakeFailures(ip, pathname);
        this.canvasWss?.handleUpgrade(request, socket, head, (ws: WebSocket) => {
          this.canvasWss?.emit("connection", ws, request);
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
    this.failPendingAnnotations("relay_unavailable", "Relay stopped.");

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
    this.readyOpsClients.clear();
    this.clearPendingOpsHelloAcks();
    for (const socket of this.canvasClients.values()) {
      socket.close(1000, "Relay stopped");
    }
    this.canvasClients.clear();
    this.opsOwnedTabIds.clear();

    this.extensionWss?.close();
    this.cdpWss?.close();
    this.annotationWss?.close();
    this.opsWss?.close();
    this.canvasWss?.close();
    this.server?.close();

    this.extensionWss = null;
    this.cdpWss = null;
    this.annotationWss = null;
    this.opsWss = null;
    this.canvasWss = null;
    this.server = null;
  }

  status(): RelayStatus {
    const connections = this.getConnectionSnapshot();
    const health = this.buildHealthStatus(connections);
    return {
      running: this.running,
      url: this.baseUrl || undefined,
      port: this.port ?? undefined,
      extensionConnected: connections.extensionConnected,
      extensionHandshakeComplete: connections.extensionHandshakeComplete,
      cdpConnected: connections.cdpConnected,
      annotationConnected: connections.annotationConnected,
      opsConnected: connections.opsConnected,
      opsOwnedTargetCount: connections.opsOwnedTargetCount,
      canvasConnected: connections.canvasConnected,
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

  async requestAnnotation(command: AnnotationCommand, timeoutMs = RelayServer.ANNOTATION_REQUEST_TIMEOUT_MS): Promise<AnnotationResponse> {
    if (!this.hasReadyExtensionSocket()) {
      return {
        version: 1,
        requestId: command.requestId,
        status: "error",
        error: { code: "relay_unavailable", message: "Extension not connected to relay." }
      };
    }

    if (this.annotationDirectPending.has(command.requestId)) {
      return {
        version: 1,
        requestId: command.requestId,
        status: "error",
        error: { code: "invalid_request", message: "Duplicate annotation requestId." }
      };
    }

    return await new Promise<AnnotationResponse>((resolve) => {
      const pending = {
        resolve,
        timeout: null as unknown as NodeJS.Timeout,
        readySeen: false
      };
      const timeout = setTimeout(() => {
        this.annotationDirectPending.delete(command.requestId);
        resolve({
          version: 1,
          requestId: command.requestId,
          status: "error",
          error: { code: "timeout", message: getAnnotationTimeoutMessage(pending.readySeen) }
        });
      }, timeoutMs);
      pending.timeout = timeout;
      this.annotationDirectPending.set(command.requestId, pending);
      this.sendJson(this.extensionSocket, {
        type: "annotationCommand",
        payload: command
      } satisfies RelayAnnotationCommand);
    });
  }

  getOpsUrl(): string | null {
    return this.baseUrl ? `${this.baseUrl}/ops` : null;
  }

  getCanvasUrl(): string | null {
    return this.baseUrl ? `${this.baseUrl}/canvas` : null;
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

  setStoreAgentPayloadHandler(
    handler: ((command: AnnotationCommand) => Promise<AnnotationResponse>) | null
  ): void {
    this.storeAgentPayloadHandler = handler;
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

  private shouldBypassHttpRateLimit(pathname: string, origin: string | undefined, ip: string): boolean {
    return pathname === CONFIG_PATH && origin === undefined && this.isLoopbackAddress(ip);
  }

  private authorizeHttpRequest(pathname: string, origin: string | undefined, request: IncomingMessage, response: ServerResponse): boolean {
    const normalizedOrigin = this.normalizeOrigin(origin);
    const ip = request.socket.remoteAddress ?? "unknown";

    if (!this.shouldBypassHttpRateLimit(pathname, origin, ip) && this.isHttpRateLimited(ip)) {
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
    if (!this.authorizeHttpRequest(CONFIG_PATH, origin, request, response)) {
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
    if (!this.authorizeHttpRequest(STATUS_PATH, origin, request, response)) {
      return;
    }

    this.applyCorsOrigin(origin, response);
    this.applyPrivateNetworkResponse(origin, response);

    response.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    });
    const status = this.status();
    response.end(JSON.stringify({
      instanceId: status.instanceId,
      running: status.running,
      port: status.port ?? undefined,
      extensionConnected: status.extensionConnected,
      extensionHandshakeComplete: status.extensionHandshakeComplete,
      cdpConnected: status.cdpConnected,
      annotationConnected: status.annotationConnected,
      opsConnected: status.opsConnected,
      opsOwnedTargetCount: status.opsOwnedTargetCount,
      canvasConnected: status.canvasConnected,
      pairingRequired: status.pairingRequired,
      health: status.health,
      lastHandshakeError: status.lastHandshakeError
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

  private isHandshakeRateLimited(ip: string, path: string): boolean {
    const now = Date.now();
    const key = `${path}:${ip}`;
    const record = this.handshakeAttempts.get(key);
    if (!record) {
      return false;
    }
    if (now > record.resetAt) {
      this.handshakeAttempts.delete(key);
      return false;
    }
    return record.count >= RelayServer.MAX_HANDSHAKE_ATTEMPTS;
  }

  private recordHandshakeFailure(ip: string, path: string): void {
    const now = Date.now();
    const key = `${path}:${ip}`;
    const record = this.handshakeAttempts.get(key);
    if (!record || now > record.resetAt) {
      this.handshakeAttempts.set(key, { count: 1, resetAt: now + RelayServer.RATE_LIMIT_WINDOW_MS });
      return;
    }
    record.count++;
  }

  private clearHandshakeFailures(ip: string, path: string): void {
    this.handshakeAttempts.delete(`${path}:${ip}`);
  }

  private isRateLimited(ip: string, path: string): boolean {
    const now = Date.now();
    const key = `${path}:${ip}`;
    const record = this.handshakeAttempts.get(key);

    if (!record || now > record.resetAt) {
      this.handshakeAttempts.set(key, { count: 1, resetAt: now + RelayServer.RATE_LIMIT_WINDOW_MS });
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

  private notifyExtensionCdpClientClosed(): void {
    if (!this.extensionSocket || this.extensionSocket.readyState !== WebSocket.OPEN) {
      return;
    }
    this.sendJson(this.extensionSocket, {
      type: "cdp_control",
      action: "client_closed"
    } satisfies RelayCdpControl);
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
        if (this.extensionSocketIp) {
          this.recordHandshakeFailure(this.extensionSocketIp, "/extension");
        }
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
      if (this.extensionSocketIp) {
        this.clearHandshakeFailures(this.extensionSocketIp, "/extension");
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

    if (isCanvasEnvelope(message)) {
      this.handleCanvasExtensionMessage(message);
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
    if (command.command === "store_agent_payload") {
      void this.handleStoreAgentPayload(command);
      return;
    }

    if (!this.hasReadyExtensionSocket()) {
      this.sendAnnotationError(command.requestId, "relay_unavailable", "Extension not connected to relay.");
      return;
    }

    this.annotationPending.set(command.requestId, { createdAt: Date.now(), readySeen: false });
    this.sendJson(this.extensionSocket, message);

    setTimeout(() => {
      const pending = this.annotationPending.get(command.requestId);
      if (!pending) return;
      this.annotationPending.delete(command.requestId);
      this.sendAnnotationError(
        command.requestId,
        "timeout",
        getAnnotationTimeoutMessage(pending.readySeen)
      );
    }, RelayServer.ANNOTATION_REQUEST_TIMEOUT_MS);
  }

  private async handleStoreAgentPayload(command: AnnotationCommand): Promise<void> {
    if (!this.storeAgentPayloadHandler) {
      this.sendAnnotationError(command.requestId, "relay_unavailable", "Agent inbox unavailable.");
      return;
    }
    try {
      const response = await this.storeAgentPayloadHandler(command);
      this.sendJson(this.annotationSocket, {
        type: "annotationResponse",
        payload: response
      } satisfies RelayAnnotationResponse);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Agent inbox enqueue failed.";
      this.sendAnnotationError(command.requestId, "unknown", detail);
    }
  }

  private handleOpsClientMessage(clientId: string, data: WebSocket.RawData): void {
    const message = parseJson(data);
    if (!isRecord(message)) {
      return;
    }

    if (!this.hasReadyExtensionSocket({ opsClientId: clientId })) {
      this.sendOpsError(clientId, {
        code: "ops_unavailable",
        message: "Extension not connected to relay.",
        retryable: true
      }, getOpsRequestId(message), getOpsSessionId(message));
      this.closeOpsClient(clientId, 1011, "Extension disconnected.");
      return;
    }

    if (isOpsHello(message) || isOpsRequest(message) || isOpsPing(message)) {
      const sizeBytes = Buffer.byteLength(JSON.stringify(message));
      if (sizeBytes > RelayServer.MAX_OPS_PAYLOAD_BYTES) {
        this.sendOpsError(clientId, {
          code: "invalid_request",
          message: "Ops payload exceeded relay limits.",
          retryable: false,
          details: { maxPayloadBytes: RelayServer.MAX_OPS_PAYLOAD_BYTES }
        }, getOpsRequestId(message), getOpsSessionId(message));
        return;
      }

      if (isOpsHello(message)) {
        this.readyOpsClients.delete(clientId);
        this.trackPendingOpsHelloAck(clientId);
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

  private handleCanvasClientMessage(clientId: string, data: WebSocket.RawData): void {
    const message = parseJson(data);
    if (!isRecord(message)) {
      return;
    }

    if (!this.hasReadyExtensionSocket({ canvasClientId: clientId })) {
      this.sendCanvasError(clientId, {
        code: "canvas_unavailable",
        message: "Extension not connected to relay.",
        retryable: true
      }, getCanvasRequestId(message), getCanvasSessionId(message));
      this.closeCanvasClient(clientId, 1011, "Extension disconnected.");
      return;
    }

    if (isCanvasHello(message) || isCanvasRequest(message) || isCanvasPing(message)) {
      const sizeBytes = Buffer.byteLength(JSON.stringify(message));
      if (sizeBytes > RelayServer.MAX_CANVAS_PAYLOAD_BYTES) {
        this.sendCanvasError(clientId, {
          code: "invalid_request",
          message: "Canvas payload exceeded relay limits.",
          retryable: false,
          details: { maxPayloadBytes: RelayServer.MAX_CANVAS_PAYLOAD_BYTES }
        }, getCanvasRequestId(message), getCanvasSessionId(message));
        return;
      }

      this.sendJson(this.extensionSocket, { ...message, clientId } satisfies CanvasEnvelope);
      return;
    }

    this.sendCanvasError(clientId, {
      code: "invalid_request",
      message: "Invalid canvas message.",
      retryable: false
    }, getCanvasRequestId(message), getCanvasSessionId(message));
  }

  private handleOpsExtensionMessage(message: OpsEnvelope): void {
    if (message.type === "ops_hello_ack") {
      const clientId = typeof message.clientId === "string" ? message.clientId : null;
      if (clientId) {
        this.clearPendingOpsHelloAck(clientId);
        this.readyOpsClients.add(clientId);
      }
    }

    if (message.type === "ops_error" && message.requestId === "ops_hello") {
      const clientId = typeof message.clientId === "string" ? message.clientId : null;
      if (clientId) {
        this.clearPendingOpsHelloAck(clientId);
        this.readyOpsClients.delete(clientId);
      }
    }

    if (message.type === "ops_event") {
      const tabId = extractOpsTabId(message.payload);
      if (typeof tabId === "number") {
        if (message.event === "ops_session_created" || message.event === "ops_session_reclaimed") {
          this.opsOwnedTabIds.add(tabId);
        }
        if (
          message.event === "ops_session_closed"
          || message.event === "ops_session_expired"
          || message.event === "ops_tab_closed"
        ) {
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

  private handleCanvasExtensionMessage(message: CanvasEnvelope): void {
    if (message.type === "canvas_hello_ack" && this.canvasClients.size === 0) {
      return;
    }
    const clientId = message.clientId;
    if (!clientId) {
      return;
    }
    const client = this.canvasClients.get(clientId);
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

  private notifyCanvasClientClosed(clientId: string): void {
    if (!this.extensionSocket) return;
    const event: CanvasEvent = {
      type: "canvas_event",
      clientId,
      event: "canvas_client_disconnected",
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

  private sendCanvasError(clientId: string, error: CanvasError, requestId?: string, canvasSessionId?: string): void {
    const client = this.canvasClients.get(clientId);
    if (!client) return;
    const payload: CanvasErrorResponse = {
      type: "canvas_error",
      requestId: requestId ?? "unknown",
      clientId,
      canvasSessionId,
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
    const directPending = this.annotationDirectPending.get(requestId);
    if (directPending) {
      clearTimeout(directPending.timeout);
      this.annotationDirectPending.delete(requestId);
      directPending.resolve(payload);
    }
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
    if (message.payload.event === "ready") {
      const directPending = this.annotationDirectPending.get(requestId);
      if (directPending) {
        directPending.readySeen = true;
      }
      const pending = this.annotationPending.get(requestId);
      if (pending) {
        pending.readySeen = true;
      }
    }
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
    for (const [requestId, pending] of this.annotationDirectPending.entries()) {
      clearTimeout(pending.timeout);
      pending.resolve({
        version: 1,
        requestId,
        status: "error",
        error: { code, message }
      });
    }
    this.annotationDirectPending.clear();
  }

  private getConnectionSnapshot(): {
    extensionConnected: boolean;
    extensionHandshakeComplete: boolean;
    cdpConnected: boolean;
    annotationConnected: boolean;
    opsConnected: boolean;
    opsOwnedTargetCount: number;
    canvasConnected: boolean;
  } {
    this.pruneClosedSockets(true);
    const extensionConnected = this.isSocketOpen(this.extensionSocket);
    return {
      extensionConnected,
      extensionHandshakeComplete: extensionConnected && this.extensionHandshakeComplete,
      cdpConnected: this.isSocketOpen(this.cdpSocket),
      annotationConnected: this.isSocketOpen(this.annotationSocket),
      opsConnected: this.readyOpsClients.size > 0,
      opsOwnedTargetCount: this.opsOwnedTabIds.size,
      canvasConnected: this.canvasClients.size > 0
    };
  }

  private buildHealthStatus(snapshot = this.getConnectionSnapshot()): RelayHealthStatus {
    const {
      extensionConnected,
      extensionHandshakeComplete,
      cdpConnected,
      annotationConnected,
      opsConnected,
      opsOwnedTargetCount,
      canvasConnected
    } = snapshot;
    if (!this.running) {
      return {
        ok: false,
        reason: "relay_down",
        detail: "Relay not running",
        extensionConnected: false,
        extensionHandshakeComplete: false,
        cdpConnected,
        annotationConnected,
        opsConnected,
        opsOwnedTargetCount,
        canvasConnected,
        pairingRequired: Boolean(this.pairingToken),
        lastHandshakeError: this.lastHandshakeError ?? undefined
      };
    }

    if (this.lastHandshakeError?.code === "pairing_invalid") {
      return {
        ok: false,
        reason: "pairing_invalid",
        detail: this.lastHandshakeError.message,
        extensionConnected,
        extensionHandshakeComplete,
        cdpConnected,
        annotationConnected,
        opsConnected,
        opsOwnedTargetCount,
        canvasConnected,
        pairingRequired: Boolean(this.pairingToken),
        lastHandshakeError: this.lastHandshakeError
      };
    }

    if (this.lastHandshakeError?.code === "pairing_missing") {
      return {
        ok: false,
        reason: "pairing_required",
        detail: this.lastHandshakeError.message,
        extensionConnected,
        extensionHandshakeComplete,
        cdpConnected,
        annotationConnected,
        opsConnected,
        opsOwnedTargetCount,
        canvasConnected,
        pairingRequired: Boolean(this.pairingToken),
        lastHandshakeError: this.lastHandshakeError
      };
    }

    if (!extensionConnected) {
      return {
        ok: false,
        reason: "extension_disconnected",
        detail: "Extension not connected",
        extensionConnected: false,
        extensionHandshakeComplete: false,
        cdpConnected,
        annotationConnected,
        opsConnected,
        opsOwnedTargetCount,
        canvasConnected,
        pairingRequired: Boolean(this.pairingToken),
        lastHandshakeError: this.lastHandshakeError ?? undefined
      };
    }

    if (!extensionHandshakeComplete) {
      return {
        ok: false,
        reason: "handshake_incomplete",
        detail: "Extension handshake pending",
        extensionConnected: true,
        extensionHandshakeComplete: false,
        cdpConnected,
        annotationConnected,
        opsConnected,
        opsOwnedTargetCount,
        canvasConnected,
        pairingRequired: Boolean(this.pairingToken),
        lastHandshakeError: this.lastHandshakeError ?? undefined
      };
    }

    if (cdpConnected || annotationConnected || canvasConnected || opsOwnedTargetCount > 0) {
      return {
        ok: false,
        reason: "relay_dirty",
        detail: "Relay has active scenario clients or ops-owned targets",
        extensionConnected: true,
        extensionHandshakeComplete: true,
        cdpConnected,
        annotationConnected,
        opsConnected,
        opsOwnedTargetCount,
        canvasConnected,
        pairingRequired: Boolean(this.pairingToken),
        lastHandshakeError: this.lastHandshakeError ?? undefined
      };
    }

    return {
      ok: true,
      reason: "ok",
      extensionConnected: true,
      extensionHandshakeComplete: true,
      cdpConnected,
      annotationConnected,
      opsConnected,
      opsOwnedTargetCount,
      canvasConnected,
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

  private pruneClosedSockets(
    closeDependentClients = false,
    exemptClients: { opsClientId?: string; canvasClientId?: string } = {}
  ): void {
    if (this.extensionSocket && !this.isSocketOpen(this.extensionSocket)) {
      if (closeDependentClients) {
        this.clearExtensionState("Extension disconnected.", exemptClients);
      } else {
        this.extensionSocket = null;
        this.extensionInfo = null;
        this.extensionHandshakeComplete = false;
        this.opsOwnedTabIds.clear();
      }
    }
    if (this.cdpSocket && !this.isSocketOpen(this.cdpSocket)) {
      this.cdpSocket = null;
    }
    if (this.annotationSocket && !this.isSocketOpen(this.annotationSocket)) {
      this.annotationSocket = null;
    }
    this.pruneClosedClientMap(this.opsClients);
    this.pruneClosedClientMap(this.canvasClients);
  }

  private pruneClosedClientMap(clients: Map<string, WebSocket>): void {
    for (const [clientId, socket] of clients.entries()) {
      if (!this.isSocketOpen(socket)) {
        clients.delete(clientId);
        if (clients === this.opsClients) {
          this.readyOpsClients.delete(clientId);
          this.clearPendingOpsHelloAck(clientId);
        }
      }
    }
  }

  private trackPendingOpsHelloAck(clientId: string): void {
    this.clearPendingOpsHelloAck(clientId);
    const timeout = setTimeout(() => {
      if (!this.pendingOpsHelloAcks.has(clientId)) {
        return;
      }
      this.pendingOpsHelloAcks.delete(clientId);
      this.readyOpsClients.delete(clientId);
      this.sendOpsError(clientId, {
        code: "ops_unavailable",
        message: "Extension did not acknowledge ops hello.",
        retryable: true,
        details: { reason: "ops_hello_timeout" }
      }, "ops_hello");
      const client = this.opsClients.get(clientId);
      if (client && this.isSocketOpen(client)) {
        client.close(1011, "ops_hello_timeout");
      }
    }, RelayServer.OPS_HELLO_ACK_TIMEOUT_MS);
    this.pendingOpsHelloAcks.set(clientId, timeout);
  }

  private clearPendingOpsHelloAck(clientId: string): void {
    const timeout = this.pendingOpsHelloAcks.get(clientId);
    if (!timeout) {
      return;
    }
    clearTimeout(timeout);
    this.pendingOpsHelloAcks.delete(clientId);
  }

  private clearPendingOpsHelloAcks(): void {
    for (const timeout of this.pendingOpsHelloAcks.values()) {
      clearTimeout(timeout);
    }
    this.pendingOpsHelloAcks.clear();
  }

  private closeOpsClients(code: number, reason: string, exemptClientId?: string): void {
    for (const [clientId, client] of this.opsClients.entries()) {
      if (clientId === exemptClientId) {
        continue;
      }
      this.closeOpsClient(clientId, code, reason, client);
    }
  }

  private closeCanvasClients(code: number, reason: string, exemptClientId?: string): void {
    for (const [clientId, client] of this.canvasClients.entries()) {
      if (clientId === exemptClientId) {
        continue;
      }
      this.closeCanvasClient(clientId, code, reason, client);
    }
  }

  private closeOpsClient(clientId: string, code: number, reason: string, client = this.opsClients.get(clientId)): void {
    if (!client) {
      this.readyOpsClients.delete(clientId);
      this.clearPendingOpsHelloAck(clientId);
      return;
    }
    this.opsClients.delete(clientId);
    this.readyOpsClients.delete(clientId);
    this.clearPendingOpsHelloAck(clientId);
    client.close(code, reason);
  }

  private closeCanvasClient(clientId: string, code: number, reason: string, client = this.canvasClients.get(clientId)): void {
    if (!client) {
      return;
    }
    this.canvasClients.delete(clientId);
    client.close(code, reason);
  }

  private clearExtensionState(
    reason: string,
    exemptClients: { opsClientId?: string; canvasClientId?: string } = {}
  ): void {
    this.extensionSocket = null;
    this.extensionSocketIp = null;
    this.extensionInfo = null;
    this.extensionHandshakeComplete = false;
    this.opsOwnedTabIds.clear();
    this.failPendingAnnotations("relay_unavailable", reason);
    const annotationSocket = this.annotationSocket;
    this.annotationSocket = null;
    if (annotationSocket) {
      annotationSocket.close(1011, reason);
    }
    this.closeOpsClients(1011, reason, exemptClients.opsClientId);
    this.closeCanvasClients(1011, reason, exemptClients.canvasClientId);
    const cdpSocket = this.cdpSocket;
    this.cdpSocket = null;
    if (cdpSocket) {
      cdpSocket.close(1011, reason);
    }
  }

  private isSocketOpen(socket: WebSocket | null): socket is WebSocket {
    return Boolean(socket && socket.readyState === WebSocket.OPEN);
  }

  private hasReadyExtensionSocket(exemptClients: { opsClientId?: string; canvasClientId?: string } = {}): boolean {
    this.pruneClosedSockets(true, exemptClients);
    return Boolean(this.extensionSocket && this.extensionHandshakeComplete);
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

const isCanvasHello = (value: Record<string, unknown>): value is CanvasHello => {
  return value.type === "canvas_hello" && typeof value.version === "string";
};

const isCanvasPing = (value: Record<string, unknown>): value is CanvasPing => {
  return value.type === "canvas_ping" && typeof value.id === "string";
};

const isCanvasRequest = (value: Record<string, unknown>): value is CanvasRequest => {
  return value.type === "canvas_request" && typeof value.requestId === "string" && typeof value.command === "string";
};

const isCanvasEnvelope = (value: Record<string, unknown>): value is CanvasEnvelope => {
  const type = value.type;
  return typeof type === "string" && type.startsWith("canvas_");
};

const getOpsRequestId = (value: Record<string, unknown>): string | undefined => {
  return typeof value.requestId === "string" ? value.requestId : undefined;
};

const getOpsSessionId = (value: Record<string, unknown>): string | undefined => {
  return typeof value.opsSessionId === "string" ? value.opsSessionId : undefined;
};

const getCanvasRequestId = (value: Record<string, unknown>): string | undefined => {
  return typeof value.requestId === "string" ? value.requestId : undefined;
};

const getCanvasSessionId = (value: Record<string, unknown>): string | undefined => {
  return typeof value.canvasSessionId === "string" ? value.canvasSessionId : undefined;
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
  if (
    value.command !== "start"
    && value.command !== "cancel"
    && value.command !== "fetch_stored"
    && value.command !== "store_agent_payload"
  ) {
    return false;
  }
  if (value.options && !isRecord(value.options)) return false;
  if (value.command === "store_agent_payload") {
    if (!isAnnotationPayload(value.payload)) return false;
    if (value.source !== undefined && !isAnnotationDispatchSource(value.source)) return false;
    if (value.label !== undefined && typeof value.label !== "string") return false;
  }
  return true;
};

const isAnnotationDispatchSource = (value: unknown): value is AnnotationCommand["source"] => {
  return value === "annotate_item"
    || value === "annotate_all"
    || value === "popup_item"
    || value === "popup_all"
    || value === "canvas_item"
    || value === "canvas_all";
};

const isAnnotationPayload = (value: unknown): value is AnnotationCommand["payload"] => {
  if (!isRecord(value)) return false;
  return typeof value.url === "string"
    && typeof value.timestamp === "string"
    && typeof value.screenshotMode === "string"
    && Array.isArray(value.annotations);
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
