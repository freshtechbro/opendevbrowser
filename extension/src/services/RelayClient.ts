import type {
  RelayAnnotationCommand,
  RelayAnnotationEvent,
  RelayAnnotationResponse,
  RelayCommand,
  RelayEvent,
  RelayHandshake,
  RelayHandshakeAck,
  RelayHealthResponse,
  RelayHealthStatus,
  RelayPing,
  RelayPong,
  RelayResponse,
  OpsEnvelope
} from "../types.js";
import { logError } from "../logging.js";

type RelayHandlers = {
  onCommand: (command: RelayCommand) => void;
  onAnnotationCommand?: (command: RelayAnnotationCommand) => void;
  onOpsMessage?: (message: OpsEnvelope) => void;
  onClose: (detail?: { code?: number; reason?: string }) => void;
};

export class RelayClient {
  private url: string;
  private handlers: RelayHandlers;
  private socket: WebSocket | null = null;
  private pendingHandshakeAckResolve: ((ack: RelayHandshakeAck) => void) | null = null;
  private pendingHandshakeAckReject: ((error: Error) => void) | null = null;
  private pendingHandshakeAckTimeoutId: number | null = null;
  private lastHandshakeAck: RelayHandshakeAck | null = null;
  private connectPromise: Promise<RelayHandshakeAck> | null = null;
  private pendingHealthChecks = new Map<string, { resolve: (value: RelayHealthStatus) => void; reject: (error: Error) => void; timeoutId: number }>();
  private pendingPings = new Map<string, { resolve: (value: RelayHealthStatus) => void; reject: (error: Error) => void; timeoutId: number }>();

  constructor(url: string, handlers: RelayHandlers) {
    this.url = url;
    this.handlers = handlers;
  }

  async connect(handshake: RelayHandshake): Promise<RelayHandshakeAck> {
    if (this.connectPromise) {
      return await this.connectPromise;
    }
    const run = (async () => {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        if (this.lastHandshakeAck) {
          return this.lastHandshakeAck;
        }
      } else {
        this.socket = new WebSocket(this.url);

        await new Promise<void>((resolve, reject) => {
          if (!this.socket) {
            reject(new Error("Relay socket not created"));
            return;
          }
          this.socket.addEventListener("open", () => resolve(), { once: true });
          this.socket.addEventListener("error", () => reject(new Error("Relay socket error")), {
            once: true
          });
        });

        this.socket.addEventListener("message", (event) => {
          const message = parseJson(event.data);
          if (!message || typeof message !== "object") return;
          const record = message as Record<string, unknown>;
          if (record.type === "handshakeAck") {
            if (!isValidHandshakeAck(record)) {
              if (this.pendingHandshakeAckReject) {
                const reject = this.pendingHandshakeAckReject;
                this.clearHandshakeAckWait();
                if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                  this.socket.close(1002, "Invalid handshake acknowledgment");
                }
                reject(new Error("Relay handshake acknowledgement invalid"));
              }
              return;
            }
            const ack = record;
            this.lastHandshakeAck = ack;
            if (this.pendingHandshakeAckResolve) {
              const resolve = this.pendingHandshakeAckResolve;
              this.clearHandshakeAckWait();
              resolve(ack);
            }
            return;
          }
          if (record.type === "healthCheckResult") {
            if (!isValidHealthResponse(record)) {
              return;
            }
            const pending = this.pendingHealthChecks.get(record.id);
            if (pending) {
              clearTimeout(pending.timeoutId);
              this.pendingHealthChecks.delete(record.id);
              pending.resolve(record.payload);
            }
            return;
          }
          if (record.type === "pong") {
            if (!isValidPong(record)) {
              return;
            }
            const pending = this.pendingPings.get(record.id);
            if (pending) {
              clearTimeout(pending.timeoutId);
              this.pendingPings.delete(record.id);
              pending.resolve(record.payload);
            }
            return;
          }
          if (record.method === "forwardCDPCommand") {
            this.handlers.onCommand(record as RelayCommand);
            return;
          }
          if (record.type === "annotationCommand") {
            this.handlers.onAnnotationCommand?.(record as RelayAnnotationCommand);
            return;
          }
          if (isOpsEnvelope(record)) {
            this.handlers.onOpsMessage?.(record as OpsEnvelope);
            return;
          }
        });

        this.socket.addEventListener("close", (event) => {
          if (this.pendingHandshakeAckReject) {
            const reject = this.pendingHandshakeAckReject;
            this.clearHandshakeAckWait();
            reject(new Error("Relay socket closed before handshake acknowledgment"));
          }
          this.lastHandshakeAck = null;
          for (const pending of this.pendingHealthChecks.values()) {
            clearTimeout(pending.timeoutId);
            pending.reject(new Error("Relay socket closed"));
          }
          this.pendingHealthChecks.clear();
          for (const pending of this.pendingPings.values()) {
            clearTimeout(pending.timeoutId);
            pending.reject(new Error("Relay socket closed"));
          }
          this.pendingPings.clear();
          this.handlers.onClose({ code: event.code, reason: event.reason });
        });
      }

      const ackPromise = new Promise<RelayHandshakeAck>((resolve, reject) => {
        this.clearHandshakeAckWait();
        this.pendingHandshakeAckResolve = resolve;
        this.pendingHandshakeAckReject = reject;
        this.pendingHandshakeAckTimeoutId = setTimeout(() => {
          this.clearHandshakeAckWait();
          if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.close(1000, "Handshake ack timeout");
          }
          reject(new Error("Relay handshake not acknowledged"));
        }, 2000);
      });

      try {
        this.send(handshake);
      } catch (error) {
        this.clearHandshakeAckWait();
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
          this.socket.close(1000, "Handshake send failed");
        }
        throw error;
      }
      return await ackPromise;
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
    if (!this.socket) return;
    if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
      this.socket.close(1000, "Relay disconnect");
    }
    this.socket = null;
    this.lastHandshakeAck = null;
    this.clearHandshakeAckWait();
  }

  sendResponse(response: RelayResponse): void {
    this.send(response);
  }

  sendEvent(event: RelayEvent): void {
    this.send(event);
  }

  sendHandshake(handshake: RelayHandshake): void {
    this.send(handshake);
  }

  sendAnnotationResponse(response: RelayAnnotationResponse): void {
    this.send(response);
  }

  sendAnnotationEvent(event: RelayAnnotationEvent): void {
    this.send(event);
  }

  sendOpsMessage(message: OpsEnvelope): void {
    this.send(message);
  }

  async sendHealthCheck(timeoutMs = 1500): Promise<RelayHealthStatus> {
    return await this.sendPing(timeoutMs);
  }

  async sendPing(timeoutMs = 1500): Promise<RelayHealthStatus> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Relay socket not connected");
    }
    const id = crypto.randomUUID();
    const request: RelayPing = { type: "ping", id };
    return await new Promise<RelayHealthStatus>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingPings.delete(id);
        reject(new Error("Relay ping timed out"));
      }, timeoutMs);
      this.pendingPings.set(id, { resolve, reject, timeoutId });
      try {
        this.send(request);
      } catch (error) {
        clearTimeout(timeoutId);
        this.pendingPings.delete(id);
        reject(error instanceof Error ? error : new Error("Relay ping failed"));
      }
    });
  }

  isConnected(): boolean {
    return Boolean(this.socket && this.socket.readyState === WebSocket.OPEN);
  }

  getLastHandshakeAck(): RelayHandshakeAck | null {
    return this.lastHandshakeAck;
  }

  private send(payload: unknown): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Relay socket not connected");
    }
    this.socket.send(JSON.stringify(payload));
  }

  private clearHandshakeAckWait(): void {
    if (this.pendingHandshakeAckTimeoutId !== null) {
      clearTimeout(this.pendingHandshakeAckTimeoutId);
    }
    this.pendingHandshakeAckTimeoutId = null;
    this.pendingHandshakeAckResolve = null;
    this.pendingHandshakeAckReject = null;
  }
}

const parseJson = (data: unknown): unknown => {
  if (typeof data !== "string") return null;
  try {
    return JSON.parse(data);
  } catch (error) {
    logError("relay.parse_json", error, { code: "relay_parse_failed" });
    return null;
  }
};

const isValidHandshakeAck = (value: Record<string, unknown>): value is RelayHandshakeAck => {
  if (value.type !== "handshakeAck") return false;
  const payload = value.payload;
  if (!payload || typeof payload !== "object") return false;
  const record = payload as Record<string, unknown>;
  return typeof record.instanceId === "string" && typeof record.relayPort === "number";
};

const isValidHealthResponse = (value: Record<string, unknown>): value is RelayHealthResponse => {
  if (value.type !== "healthCheckResult") return false;
  if (typeof value.id !== "string") return false;
  const payload = value.payload;
  if (!payload || typeof payload !== "object") return false;
  const record = payload as Record<string, unknown>;
  return typeof record.reason === "string";
};

const isValidPong = (value: Record<string, unknown>): value is RelayPong => {
  if (value.type !== "pong") return false;
  if (typeof value.id !== "string") return false;
  const payload = value.payload;
  if (!payload || typeof payload !== "object") return false;
  const record = payload as Record<string, unknown>;
  return typeof record.reason === "string";
};

const isOpsEnvelope = (value: Record<string, unknown>): value is OpsEnvelope => {
  return typeof value.type === "string" && value.type.startsWith("ops_");
};
