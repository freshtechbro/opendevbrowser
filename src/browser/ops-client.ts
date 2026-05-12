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

export type OpsRequestTimeoutDetails = {
  command: string;
  timeoutMs: number;
  requestId: string;
  opsSessionId?: string;
  leaseId?: string;
  stage?: string;
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

export class OpsRequestTimeoutError extends Error {
  readonly details: OpsRequestTimeoutDetails;

  constructor(details: OpsRequestTimeoutDetails, cause?: unknown) {
    super("Ops request timed out", typeof cause === "undefined" ? undefined : { cause });
    this.name = "OpsRequestTimeoutError";
    this.details = details;
  }
}

export const isOpsRequestTimeoutError = (value: unknown): value is OpsRequestTimeoutError => {
  return value instanceof OpsRequestTimeoutError
    || (
      value instanceof Error
      && value.name === "OpsRequestTimeoutError"
      && typeof (value as { details?: { command?: unknown; timeoutMs?: unknown; requestId?: unknown } }).details?.command === "string"
      && typeof (value as { details?: { timeoutMs?: unknown } }).details?.timeoutMs === "number"
      && typeof (value as { details?: { requestId?: unknown } }).details?.requestId === "string"
    );
};

export const withOpsRequestTimeoutDetails = (
  error: unknown,
  details: Partial<OpsRequestTimeoutDetails>
): unknown => {
  if (!isOpsRequestTimeoutError(error)) {
    return error;
  }

  return new OpsRequestTimeoutError(
    {
      ...error.details,
      ...details
    },
    error.cause
  );
};

export class OpsClient {
  private static readonly DISCONNECT_GRACE_MS = 1000;
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
  private disconnectPromise: Promise<void> | null = null;

  constructor(url: string, options: OpsClientOptions = {}) {
    this.url = url;
    this.handshakeTimeoutMs = options.handshakeTimeoutMs ?? 12000;
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
        if (this.socket) {
          this.rejectPendingTransportWork("Ops socket replaced");
        }
        const socket = new WebSocket(this.url);
        this.socket = socket;
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
            socket.removeListener("open", onOpen);
            socket.removeListener("error", onError);
          };
          socket.once("open", onOpen);
          socket.once("error", onError);
        });

        socket.on("message", (data) => {
          if (this.socket !== socket) return;
          this.handleMessage(data, socket);
        });
        socket.on("close", (code, reason) => {
          this.handleClose(socket, { code, reason: reason.toString() });
        });
        socket.on("error", () => {
          // Errors are surfaced via close or pending requests.
        });
      }
      const activeSocket = this.socket;
      if (!activeSocket || activeSocket.readyState !== WebSocket.OPEN) {
        throw new Error("Ops socket not open");
      }

      const hello: OpsHello = {
        type: "ops_hello",
        version: OPS_PROTOCOL_VERSION,
        maxPayloadBytes: this.maxPayloadBytes
      };

      const ack = await new Promise<OpsHelloAck>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          cleanupHelloAck();
          reject(new Error("Ops handshake timeout"));
        }, this.handshakeTimeoutMs);
        const cleanupHelloAck = this.waitForHelloAck(activeSocket, (message: OpsHelloAck) => {
          clearTimeout(timeoutId);
          resolve(message);
        }, (error: Error) => {
          clearTimeout(timeoutId);
          reject(error);
        });
        try {
          this.send(hello);
        } catch (error) {
          clearTimeout(timeoutId);
          cleanupHelloAck();
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

  async disconnect(): Promise<void> {
    if (this.disconnectPromise) {
      await this.disconnectPromise;
      return;
    }

    this.autoReconnect = false;
    this.shouldReconnectOnClose = false;
    this.clearReconnectTimer();
    this.stopHeartbeat();
    const socket = this.socket;
    this.socket = null;
    this.lastHelloAck = null;
    this.rejectPendingTransportWork("Ops socket closed");
    if (!socket || socket.readyState === WebSocket.CLOSED) {
      return;
    }

    this.disconnectPromise = new Promise((resolve) => {
      let settled = false;
      const finalize = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        socket.removeListener("close", onClose);
        socket.removeListener("error", onError);
        this.disconnectPromise = null;
        resolve();
      };
      const onClose = () => {
        finalize();
      };
      const onError = () => {
        finalize();
      };
      const timeoutId = setTimeout(() => {
        try {
          socket.terminate();
        } catch {
          // ignore
        }
        finalize();
      }, OpsClient.DISCONNECT_GRACE_MS);

      socket.once("close", onClose);
      socket.once("error", onError);
      try {
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
          socket.close(1000, "Ops disconnect");
        } else {
          finalize();
        }
      } catch {
        finalize();
      }
    });
    await this.disconnectPromise;
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
        reject(new OpsRequestTimeoutError({
          command,
          timeoutMs,
          requestId,
          ...(typeof opsSessionId === "string" ? { opsSessionId } : {}),
          ...(typeof leaseId === "string" ? { leaseId } : {})
        }));
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

  private waitForHelloAck(
    socketOrHandler: WebSocket | ((message: OpsHelloAck) => void),
    handlerOrReject: ((message: OpsHelloAck) => void) | ((error: Error) => void),
    maybeReject?: (error: Error) => void
  ): () => void {
    const socket = typeof socketOrHandler === "function" ? this.socket : socketOrHandler;
    const handler = typeof socketOrHandler === "function"
      ? socketOrHandler
      : handlerOrReject as (message: OpsHelloAck) => void;
    const reject = typeof socketOrHandler === "function"
      ? handlerOrReject as (error: Error) => void
      : maybeReject;
    if (!socket || !reject) {
      return () => undefined;
    }
    let settled = false;
    const cleanup = () => {
      socket.off("ops_hello_ack", onAck as unknown as (...args: unknown[]) => void);
      socket.off("ops_hello_error", onError as unknown as (...args: unknown[]) => void);
      socket.off("close", onClose);
    };
    const settle = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      callback();
    };
    const onAck = (message: OpsHelloAck) => {
      settle(() => handler(message));
    };
    const onError = (message: OpsErrorResponse) => {
      const error = buildOpsError(message.error);
      settle(() => reject(error));
    };
    const onClose = () => {
      settle(() => reject(new Error("Ops socket closed before handshake")));
    };
    socket.once("ops_hello_ack", onAck as unknown as (...args: unknown[]) => void);
    socket.once("ops_hello_error", onError as unknown as (...args: unknown[]) => void);
    socket.once("close", onClose);
    return () => {
      settled = true;
      cleanup();
    };
  }

  private handleMessage(data: WebSocket.RawData, socket = this.socket): void {
    const message = parseJson(data);
    if (!message || typeof message !== "object") {
      return;
    }
    const record = message as Record<string, unknown>;
    const type = record.type;

    if (type === "ops_hello_ack" && isOpsHelloAck(record)) {
      socket?.emit("ops_hello_ack", record);
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
        socket?.emit("ops_hello_error", record);
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

  private handleClose(socket: WebSocket, detail?: { code?: number; reason?: string }): void {
    if (this.socket !== socket) {
      return;
    }
    this.socket = null;
    this.stopHeartbeat();
    this.lastHelloAck = null;
    this.rejectPendingTransportWork("Ops socket closed");
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

  private rejectPendingTransportWork(reason: string): void {
    const error = new Error(reason);
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeoutId);
      pending.reject(error);
    }
    this.pendingRequests.clear();
    this.pendingChunks.clear();
    for (const ping of this.pendingPings.values()) {
      clearTimeout(ping.timeoutId);
      ping.reject(error);
    }
    this.pendingPings.clear();
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
