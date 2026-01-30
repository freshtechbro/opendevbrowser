import type { RelayCommand, RelayEvent, RelayHandshake, RelayHandshakeAck, RelayResponse } from "../types.js";

type RelayHandlers = {
  onCommand: (command: RelayCommand) => void;
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
          if (record.method === "forwardCDPCommand") {
            this.handlers.onCommand(record as RelayCommand);
          }
        });

        this.socket.addEventListener("close", (event) => {
          if (this.pendingHandshakeAckReject) {
            const reject = this.pendingHandshakeAckReject;
            this.clearHandshakeAckWait();
            reject(new Error("Relay socket closed before handshake acknowledgment"));
          }
          this.lastHandshakeAck = null;
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

      this.send(handshake);
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

  isConnected(): boolean {
    return Boolean(this.socket && this.socket.readyState === WebSocket.OPEN);
  }

  getLastHandshakeAck(): RelayHandshakeAck | null {
    return this.lastHandshakeAck;
  }

  private send(payload: unknown): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
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
  } catch {
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
