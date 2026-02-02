import { randomUUID } from "crypto";
import { WebSocket } from "ws";
import {
  MAX_OPS_PAYLOAD_BYTES,
  OPS_PROTOCOL_VERSION,
  type OpsChunk,
  type OpsError,
  type OpsErrorResponse,
  type OpsEvent,
  type OpsHello,
  type OpsHelloAck,
  type OpsPing,
  type OpsPong,
  type OpsRequest,
  type OpsResponse
} from "../relay/protocol";

export type OpsClientOptions = {
  handshakeTimeoutMs?: number;
  pingIntervalMs?: number;
  pingTimeoutMs?: number;
  maxPayloadBytes?: number;
  autoReconnect?: boolean;
  reconnectBaseDelayMs?: number;
  reconnectMaxDelayMs?: number;
  maxMissedPongs?: number;
  onEvent?: (event: OpsEvent) => void;
  onClose?: (detail?: { code?: number; reason?: string }) => void;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeoutId: NodeJS.Timeout;
};

type PendingChunk = {
  requestId: string;
  totalChunks: number;
  chunks: string[];
};

type PendingPing = {
  resolve: () => void;
  reject: (error: Error) => void;
  timeoutId: NodeJS.Timeout;
};

export class OpsClient {
  private url: string;
  private socket: WebSocket | null = null;
  private lastHelloAck: OpsHelloAck | null = null;
  private connectPromise: Promise<OpsHelloAck> | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private pendingChunks = new Map<string, PendingChunk>();
  private pendingPings = new Map<string, PendingPing>();
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private handshakeTimeoutMs: number;
  private pingIntervalMs: number;
  private pingTimeoutMs: number;
  private maxPayloadBytes: number;
  private onEvent?: (event: OpsEvent) => void;
  private onClose?: (detail?: { code?: number; reason?: string }) => void;
  private autoReconnect: boolean;
  private reconnectBaseDelayMs: number;
  private reconnectMaxDelayMs: number;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private shouldReconnectOnClose = true;
  private missedPongs = 0;
  private maxMissedPongs: number;

  constructor(url: string, options: OpsClientOptions = {}) {
    this.url = url;
    this.handshakeTimeoutMs = options.handshakeTimeoutMs ?? 3000;
    this.pingIntervalMs = options.pingIntervalMs ?? 25000;
    this.pingTimeoutMs = options.pingTimeoutMs ?? 2000;
    this.maxPayloadBytes = options.maxPayloadBytes ?? MAX_OPS_PAYLOAD_BYTES;
    this.autoReconnect = options.autoReconnect ?? true;
    this.reconnectBaseDelayMs = options.reconnectBaseDelayMs ?? 500;
    this.reconnectMaxDelayMs = options.reconnectMaxDelayMs ?? 10000;
    this.maxMissedPongs = options.maxMissedPongs ?? 2;
    this.onEvent = options.onEvent;
    this.onClose = options.onClose;
  }

  async connect(): Promise<OpsHelloAck> {
    if (this.connectPromise) {
      return await this.connectPromise;
    }

    const run = (async () => {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
        this.clearReconnectTimer();
        this.socket = new WebSocket(this.url);
        await new Promise<void>((resolve, reject) => {
          /* c8 ignore next */
          if (!this.socket) {
            reject(new Error("Ops socket not created"));
            return;
          }
          const onOpen = () => {
            cleanup();
            resolve();
          };
          const onError = (error: Error) => {
            cleanup();
            reject(error);
          };
          const cleanup = () => {
            this.socket?.removeListener("open", onOpen);
            this.socket?.removeListener("error", onError);
          };
          this.socket.once("open", onOpen);
          this.socket.once("error", onError);
        });

        this.socket.on("message", (data) => {
          this.handleMessage(data);
        });
        this.socket.on("close", (code, reason) => {
          this.handleClose({ code, reason: reason.toString() });
        });
        this.socket.on("error", () => {
          // Errors are surfaced via close or pending requests.
        });
      }

      const hello: OpsHello = {
        type: "ops_hello",
        version: OPS_PROTOCOL_VERSION,
        maxPayloadBytes: this.maxPayloadBytes
      };

      const ack = await new Promise<OpsHelloAck>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error("Ops handshake timeout"));
        }, this.handshakeTimeoutMs);
        const handler = (message: OpsHelloAck) => {
          clearTimeout(timeoutId);
          resolve(message);
        };
        this.waitForHelloAck(handler, reject);
        try {
          this.send(hello);
        } catch (error) {
          clearTimeout(timeoutId);
          reject(error instanceof Error ? error : new Error("Ops handshake failed"));
        }
      });

      this.lastHelloAck = ack;
      this.reconnectAttempts = 0;
      this.missedPongs = 0;
      this.startHeartbeat();
      return ack;
    })();

    this.connectPromise = run;
    try {
      return await run;
    } finally {
      if (this.connectPromise === run) {
        this.connectPromise = null;
      }
    }
  }

  disconnect(): void {
    this.autoReconnect = false;
    this.shouldReconnectOnClose = false;
    this.clearReconnectTimer();
    this.stopHeartbeat();
    if (this.socket) {
      try {
        if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
          this.socket.close(1000, "Ops disconnect");
        }
      } catch {
        // ignore
      }
    }
    this.socket = null;
    this.lastHelloAck = null;
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error("Ops socket closed"));
    }
    this.pendingRequests.clear();
    this.pendingChunks.clear();
    for (const ping of this.pendingPings.values()) {
      clearTimeout(ping.timeoutId);
      ping.reject(new Error("Ops socket closed"));
    }
    this.pendingPings.clear();
  }

  async request<T>(command: string, payload?: unknown, opsSessionId?: string, timeoutMs = 30000, leaseId?: string): Promise<T> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      await this.connect();
    }

    const requestId = randomUUID();
    const request: OpsRequest = {
      type: "ops_request",
      requestId,
      opsSessionId,
      leaseId,
      command,
      payload
    };

    const serialized = JSON.stringify(request);
    if (Buffer.byteLength(serialized) > this.maxPayloadBytes) {
      throw new Error("Ops request payload exceeded max size");
    }

    return await new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error("Ops request timed out"));
      }, timeoutMs);
      const resolvePending = (value: unknown) => resolve(value as T);
      this.pendingRequests.set(requestId, { resolve: resolvePending, reject, timeoutId });
      try {
        this.sendRaw(serialized);
      } catch (error) {
        clearTimeout(timeoutId);
        this.pendingRequests.delete(requestId);
        reject(error instanceof Error ? error : new Error("Ops send failed"));
      }
    });
  }

  private waitForHelloAck(handler: (message: OpsHelloAck) => void, reject: (error: Error) => void): void {
    const onAck = (message: OpsHelloAck) => {
      this.socket?.off("close", onClose);
      this.socket?.off("ops_hello_error", onError);
      handler(message);
    };
    const onError = (message: OpsErrorResponse) => {
      this.socket?.off("close", onClose);
      const error = buildOpsError(message.error);
      reject(error);
    };
    const onClose = () => {
      reject(new Error("Ops socket closed before handshake"));
    };
    this.socket?.once("ops_hello_ack", onAck as unknown as (...args: unknown[]) => void);
    this.socket?.once("ops_hello_error", onError as unknown as (...args: unknown[]) => void);
    this.socket?.once("close", onClose);
  }

  private handleMessage(data: WebSocket.RawData): void {
    const message = parseJson(data);
    if (!message || typeof message !== "object") {
      return;
    }
    const record = message as Record<string, unknown>;
    const type = record.type;

    if (type === "ops_hello_ack" && isOpsHelloAck(record)) {
      this.socket?.emit("ops_hello_ack", record);
      return;
    }

    if (type === "ops_pong" && isOpsPong(record)) {
      const pending = this.pendingPings.get(record.id);
      if (pending) {
        clearTimeout(pending.timeoutId);
        this.pendingPings.delete(record.id);
        pending.resolve();
        this.missedPongs = 0;
      }
      return;
    }

    if (type === "ops_response" && isOpsResponse(record)) {
      const pending = this.pendingRequests.get(record.requestId);
      if (!pending) return;
      if (record.chunked && record.payloadId && typeof record.totalChunks === "number") {
        this.pendingChunks.set(record.payloadId, {
          requestId: record.requestId,
          totalChunks: record.totalChunks,
          chunks: []
        });
        return;
      }
      clearTimeout(pending.timeoutId);
      this.pendingRequests.delete(record.requestId);
      pending.resolve(record.payload as unknown);
      return;
    }

    if (type === "ops_chunk" && isOpsChunk(record)) {
      const pendingChunk = this.pendingChunks.get(record.payloadId);
      if (!pendingChunk) return;
      pendingChunk.chunks[record.chunkIndex] = record.data;
      const received = pendingChunk.chunks.filter(Boolean).length;
      if (received >= pendingChunk.totalChunks) {
        this.pendingChunks.delete(record.payloadId);
        const pending = this.pendingRequests.get(pendingChunk.requestId);
        if (!pending) return;
        clearTimeout(pending.timeoutId);
        this.pendingRequests.delete(pendingChunk.requestId);
        try {
          const merged = pendingChunk.chunks.join("");
          const payload = merged ? JSON.parse(merged) : null;
          pending.resolve(payload as unknown);
        } catch (error) {
          pending.reject(error instanceof Error ? error : new Error("Ops chunk parse failed"));
        }
      }
      return;
    }

    if (type === "ops_error" && isOpsErrorResponse(record)) {
      if (record.requestId === "ops_hello") {
        this.socket?.emit("ops_hello_error", record);
        return;
      }
      const pending = this.pendingRequests.get(record.requestId);
      if (!pending) return;
      clearTimeout(pending.timeoutId);
      this.pendingRequests.delete(record.requestId);
      pending.reject(buildOpsError(record.error));
      return;
    }

    if (type === "ops_event" && isOpsEvent(record)) {
      this.onEvent?.(record);
      return;
    }
  }

  private handleClose(detail?: { code?: number; reason?: string }): void {
    this.stopHeartbeat();
    this.lastHelloAck = null;
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error("Ops socket closed"));
    }
    this.pendingRequests.clear();
    this.pendingChunks.clear();
    for (const ping of this.pendingPings.values()) {
      clearTimeout(ping.timeoutId);
      ping.reject(new Error("Ops socket closed"));
    }
    this.pendingPings.clear();
    this.onClose?.(detail);
    if (this.autoReconnect && this.shouldReconnectOnClose) {
      this.scheduleReconnect();
    }
    this.shouldReconnectOnClose = true;
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      this.sendPing().catch(() => {
        this.missedPongs += 1;
        if (this.missedPongs >= this.maxMissedPongs) {
          this.closeSocket(1011, "Ops heartbeat missed", true);
        }
      });
    }, this.pingIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private async sendPing(): Promise<void> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    const id = randomUUID();
    const ping: OpsPing = { type: "ops_ping", id };
    return await new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingPings.delete(id);
        reject(new Error("Ops ping timed out"));
      }, this.pingTimeoutMs);
      this.pendingPings.set(id, { resolve, reject, timeoutId });
      try {
        this.send(ping);
      } catch (error) {
        clearTimeout(timeoutId);
        this.pendingPings.delete(id);
        reject(error instanceof Error ? error : new Error("Ops ping failed"));
      }
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const attempt = this.reconnectAttempts;
    const base = Math.min(this.reconnectMaxDelayMs, this.reconnectBaseDelayMs * Math.pow(2, attempt));
    const jitter = Math.floor(base * (Math.random() * 0.4 - 0.2));
    const delay = Math.max(200, base + jitter);
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => {
        this.scheduleReconnect();
      });
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private closeSocket(code: number, reason: string, allowReconnect: boolean): void {
    this.shouldReconnectOnClose = allowReconnect;
    this.stopHeartbeat();
    if (this.socket) {
      try {
        this.socket.close(code, reason);
      } catch {
        // ignore
      }
    }
  }

  private send(payload: unknown): void {
    const serialized = JSON.stringify(payload);
    this.sendRaw(serialized);
  }

  private sendRaw(payload: string): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Ops socket not connected");
    }
    this.socket.send(payload);
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

const isOpsHelloAck = (value: Record<string, unknown>): value is OpsHelloAck => {
  return value.type === "ops_hello_ack" && typeof value.version === "string";
};

const isOpsPong = (value: Record<string, unknown>): value is OpsPong => {
  return value.type === "ops_pong" && typeof value.id === "string";
};

const isOpsResponse = (value: Record<string, unknown>): value is OpsResponse => {
  return value.type === "ops_response" && typeof value.requestId === "string";
};

const isOpsChunk = (value: Record<string, unknown>): value is OpsChunk => {
  return value.type === "ops_chunk" && typeof value.payloadId === "string" && typeof value.chunkIndex === "number";
};

const isOpsErrorResponse = (value: Record<string, unknown>): value is OpsErrorResponse => {
  return value.type === "ops_error" && typeof value.requestId === "string" && typeof value.error === "object";
};

const isOpsEvent = (value: Record<string, unknown>): value is OpsEvent => {
  return value.type === "ops_event" && typeof value.event === "string";
};

const buildOpsError = (error: OpsError): Error => {
  const message = `[${error.code}] ${error.message}`;
  const err = new Error(message);
  (err as Error & { code?: string }).code = error.code;
  return err;
};
