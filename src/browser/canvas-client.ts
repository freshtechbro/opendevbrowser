import { randomUUID } from "crypto";
import { WebSocket } from "ws";
import {
  CANVAS_PROTOCOL_VERSION,
  MAX_CANVAS_PAYLOAD_BYTES,
  type CanvasChunk,
  type CanvasError,
  type CanvasErrorResponse,
  type CanvasEvent,
  type CanvasHello,
  type CanvasHelloAck,
  type CanvasPing,
  type CanvasPong,
  type CanvasRequest,
  type CanvasResponse
} from "../relay/protocol";

export type CanvasClientOptions = {
  handshakeTimeoutMs?: number;
  pingIntervalMs?: number;
  pingTimeoutMs?: number;
  maxPayloadBytes?: number;
  autoReconnect?: boolean;
  reconnectBaseDelayMs?: number;
  reconnectMaxDelayMs?: number;
  maxMissedPongs?: number;
  onEvent?: (event: CanvasEvent) => void;
  onClose?: (detail?: { code?: number; reason?: string }) => void;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeoutId: NodeJS.Timeout;
};

type PendingChunk = {
  totalChunks: number;
  chunks: string[];
};

type PendingPing = {
  resolve: () => void;
  reject: (error: Error) => void;
  timeoutId: NodeJS.Timeout;
};

export class CanvasClient {
  private readonly url: string;
  private socket: WebSocket | null = null;
  private lastHelloAck: CanvasHelloAck | null = null;
  private connectPromise: Promise<CanvasHelloAck> | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private pendingChunks = new Map<string, PendingChunk>();
  private pendingPings = new Map<string, PendingPing>();
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private readonly handshakeTimeoutMs: number;
  private readonly pingIntervalMs: number;
  private readonly pingTimeoutMs: number;
  private readonly maxPayloadBytes: number;
  private readonly onEvent?: (event: CanvasEvent) => void;
  private readonly onClose?: (detail?: { code?: number; reason?: string }) => void;
  private autoReconnect: boolean;
  private readonly reconnectBaseDelayMs: number;
  private readonly reconnectMaxDelayMs: number;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private shouldReconnectOnClose = true;
  private missedPongs = 0;
  private readonly maxMissedPongs: number;

  constructor(url: string, options: CanvasClientOptions = {}) {
    this.url = url;
    this.handshakeTimeoutMs = options.handshakeTimeoutMs ?? 3000;
    this.pingIntervalMs = options.pingIntervalMs ?? 25000;
    this.pingTimeoutMs = options.pingTimeoutMs ?? 2000;
    this.maxPayloadBytes = options.maxPayloadBytes ?? MAX_CANVAS_PAYLOAD_BYTES;
    this.autoReconnect = options.autoReconnect ?? true;
    this.reconnectBaseDelayMs = options.reconnectBaseDelayMs ?? 500;
    this.reconnectMaxDelayMs = options.reconnectMaxDelayMs ?? 10000;
    this.maxMissedPongs = options.maxMissedPongs ?? 2;
    this.onEvent = options.onEvent;
    this.onClose = options.onClose;
  }

  async connect(): Promise<CanvasHelloAck> {
    if (this.connectPromise) {
      return await this.connectPromise;
    }
    const run = (async () => {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
        this.clearReconnectTimer();
        this.socket = new WebSocket(this.url);
        await new Promise<void>((resolve, reject) => {
          /* c8 ignore next -- socket is assigned immediately above unless the constructor throws */
          if (!this.socket) {
            reject(new Error("Canvas socket not created"));
            return;
          }
          const timeoutId = setTimeout(() => {
            cleanup();
            try {
              this.socket?.close(1000, "Canvas handshake timeout");
            } catch {
              // ignore
            }
            reject(new Error("Canvas handshake timeout"));
          }, this.handshakeTimeoutMs);
          const onOpen = () => {
            cleanup();
            resolve();
          };
          const onError = (error: Error) => {
            cleanup();
            reject(error);
          };
          const onClose = () => {
            cleanup();
            reject(new Error("Canvas socket closed before handshake"));
          };
          const cleanup = () => {
            clearTimeout(timeoutId);
            this.socket?.removeListener("open", onOpen);
            this.socket?.removeListener("error", onError);
            this.socket?.removeListener("close", onClose);
          };
          timeoutId.unref?.();
          this.socket.once("open", onOpen);
          this.socket.once("error", onError);
          this.socket.once("close", onClose);
        });

        this.socket.on("message", (data) => {
          this.handleMessage(data);
        });
        this.socket.on("close", (code, reason) => {
          this.handleClose({ code, reason: reason.toString() });
        });
      }

      const hello: CanvasHello = {
        type: "canvas_hello",
        version: CANVAS_PROTOCOL_VERSION,
        maxPayloadBytes: this.maxPayloadBytes
      };

      const ack = await new Promise<CanvasHelloAck>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timeoutId);
          this.socket?.removeListener("canvas_hello_ack", onAck as unknown as (...args: unknown[]) => void);
          this.socket?.removeListener("canvas_hello_error", onError as unknown as (...args: unknown[]) => void);
          this.socket?.removeListener("close", onClose);
        };
        const timeoutId = setTimeout(() => {
          cleanup();
          try {
            this.socket?.close(1000, "Canvas handshake timeout");
          } catch {
            // ignore
          }
          reject(new Error("Canvas handshake timeout"));
        }, this.handshakeTimeoutMs);
        const onAck = (message: CanvasHelloAck) => {
          cleanup();
          resolve(message);
        };
        const onError = (message: CanvasErrorResponse) => {
          cleanup();
          reject(buildCanvasError(message.error));
        };
        const onClose = () => {
          cleanup();
          reject(new Error("Canvas socket closed before handshake"));
        };
        timeoutId.unref?.();
        this.socket?.once("canvas_hello_ack", onAck as unknown as (...args: unknown[]) => void);
        this.socket?.once("canvas_hello_error", onError as unknown as (...args: unknown[]) => void);
        this.socket?.once("close", onClose);
        try {
          this.send(hello);
        } catch (error) {
          cleanup();
          reject(error instanceof Error ? error : new Error("Canvas handshake failed"));
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
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      try {
        this.socket.close(1000, "Canvas disconnect");
      } catch {
        // ignore
      }
    }
    this.socket = null;
    this.lastHelloAck = null;
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error("Canvas socket closed"));
    }
    this.pendingRequests.clear();
    this.pendingChunks.clear();
  }

  async request<T>(
    command: string,
    payload?: unknown,
    canvasSessionId?: string,
    timeoutMs = 30000,
    leaseId?: string
  ): Promise<T> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      await this.connect();
    }
    const requestId = randomUUID();
    const request: CanvasRequest = {
      type: "canvas_request",
      requestId,
      canvasSessionId,
      leaseId,
      command,
      payload
    };
    const serialized = JSON.stringify(request);
    if (Buffer.byteLength(serialized) > this.maxPayloadBytes) {
      throw new Error("Canvas request payload exceeded max size");
    }
    return await new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error("Canvas request timed out"));
      }, timeoutMs);
      timeoutId.unref?.();
      this.pendingRequests.set(requestId, { resolve: (value) => resolve(value as T), reject, timeoutId });
      try {
        this.sendRaw(serialized);
      } catch (error) {
        clearTimeout(timeoutId);
        this.pendingRequests.delete(requestId);
        reject(error instanceof Error ? error : new Error("Canvas send failed"));
      }
    });
  }

  private handleMessage(data: WebSocket.RawData): void {
    const message = parseJson(data);
    if (!message || typeof message !== "object") {
      return;
    }
    const record = message as Record<string, unknown>;
    switch (record.type) {
      case "canvas_hello_ack":
        this.socket?.emit("canvas_hello_ack", record);
        return;
      case "canvas_error": {
        const requestId = typeof record.requestId === "string" ? record.requestId : "unknown";
        if (requestId === "canvas_hello") {
          this.socket?.emit("canvas_hello_error", record);
          return;
        }
        const pending = this.pendingRequests.get(requestId);
        if (pending && isCanvasErrorResponse(record)) {
          clearTimeout(pending.timeoutId);
          this.pendingRequests.delete(requestId);
          pending.reject(buildCanvasError(record.error));
        }
        return;
      }
      case "canvas_response": {
        if (!isCanvasResponse(record)) return;
        const pending = this.pendingRequests.get(record.requestId);
        if (!pending) return;
        if (record.chunked) {
          this.pendingChunks.set(record.requestId, {
            totalChunks: record.totalChunks ?? 0,
            chunks: new Array(record.totalChunks ?? 0).fill("")
          });
          return;
        }
        clearTimeout(pending.timeoutId);
        this.pendingRequests.delete(record.requestId);
        pending.resolve(record.payload ?? null);
        return;
      }
      case "canvas_chunk": {
        if (!isCanvasChunk(record)) return;
        const pending = this.pendingRequests.get(record.requestId);
        const chunkState = this.pendingChunks.get(record.requestId);
        if (!pending || !chunkState) return;
        chunkState.chunks[record.chunkIndex] = record.data;
        const received = chunkState.chunks.filter((chunk) => chunk.length > 0).length;
        if (received === chunkState.totalChunks) {
          clearTimeout(pending.timeoutId);
          this.pendingRequests.delete(record.requestId);
          this.pendingChunks.delete(record.requestId);
          const raw = chunkState.chunks.join("");
          /* c8 ignore next -- completion only happens after all chunks are non-empty */
          pending.resolve(raw ? JSON.parse(raw) : null);
        }
        return;
      }
      case "canvas_event":
        if (isCanvasEvent(record)) {
          this.onEvent?.(record);
        }
        return;
      case "canvas_pong": {
        const id = typeof record.id === "string" ? record.id : "";
        const pending = this.pendingPings.get(id);
        if (!pending) return;
        clearTimeout(pending.timeoutId);
        this.pendingPings.delete(id);
        this.missedPongs = 0;
        pending.resolve();
      }
    }
  }

  private handleClose(detail?: { code?: number; reason?: string }): void {
    this.stopHeartbeat();
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error("Canvas socket closed"));
    }
    this.pendingRequests.clear();
    this.pendingChunks.clear();
    for (const pending of this.pendingPings.values()) {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error("Canvas socket closed"));
    }
    this.pendingPings.clear();
    this.lastHelloAck = null;
    this.socket = null;
    this.onClose?.(detail);
    if (!this.autoReconnect || !this.shouldReconnectOnClose) {
      return;
    }
    const delay = Math.min(this.reconnectBaseDelayMs * (2 ** this.reconnectAttempts), this.reconnectMaxDelayMs);
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect().catch(() => {});
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      void this.sendPing().catch(() => {});
    }, this.pingIntervalMs);
    this.heartbeatTimer.unref?.();
  }

  private stopHeartbeat(): void {
    if (!this.heartbeatTimer) return;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private async sendPing(): Promise<void> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    const id = randomUUID();
    const ping: CanvasPing = { type: "canvas_ping", id };
    await new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingPings.delete(id);
        this.missedPongs += 1;
        if (this.missedPongs > this.maxMissedPongs && this.socket) {
          this.socket.close(1011, "Canvas heartbeat timed out");
        }
        reject(new Error("Canvas ping timed out"));
      }, this.pingTimeoutMs);
      timeoutId.unref?.();
      this.pendingPings.set(id, { resolve, reject, timeoutId });
      try {
        this.send(ping);
      } catch (error) {
        clearTimeout(timeoutId);
        this.pendingPings.delete(id);
        reject(error instanceof Error ? error : new Error("Canvas ping failed"));
      }
    });
  }

  private send(payload: unknown): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Canvas socket not connected");
    }
    this.socket.send(JSON.stringify(payload));
  }

  private sendRaw(payload: string): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Canvas socket not connected");
    }
    this.socket.send(payload);
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }
}

const parseJson = (data: WebSocket.RawData): unknown => {
  try {
    return JSON.parse(typeof data === "string" ? data : data.toString());
  } catch {
    return null;
  }
};

const buildCanvasError = (error: CanvasError): Error => {
  const result = new Error(`[${error.code}] ${error.message}`);
  Object.assign(result, { code: error.code, details: error.details });
  return result;
};

const isCanvasErrorResponse = (value: Record<string, unknown>): value is CanvasErrorResponse => {
  return value.type === "canvas_error" && isRecord(value.error);
};

const isCanvasResponse = (value: Record<string, unknown>): value is CanvasResponse => {
  return value.type === "canvas_response" && typeof value.requestId === "string";
};

const isCanvasChunk = (value: Record<string, unknown>): value is CanvasChunk => {
  return value.type === "canvas_chunk"
    && typeof value.requestId === "string"
    && typeof value.chunkIndex === "number"
    && typeof value.totalChunks === "number"
    && typeof value.data === "string";
};

const isCanvasEvent = (value: Record<string, unknown>): value is CanvasEvent => {
  return value.type === "canvas_event" && typeof value.event === "string";
};

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
