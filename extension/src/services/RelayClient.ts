import type { RelayCommand, RelayEvent, RelayHandshake, RelayResponse } from "../types.js";

type RelayHandlers = {
  onCommand: (command: RelayCommand) => void;
  onClose: () => void;
};

export class RelayClient {
  private url: string;
  private handlers: RelayHandlers;
  private socket: WebSocket | null = null;

  constructor(url: string, handlers: RelayHandlers) {
    this.url = url;
    this.handlers = handlers;
  }

  async connect(handshake: RelayHandshake): Promise<void> {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      return;
    }

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
      if (record.method === "forwardCDPCommand") {
        this.handlers.onCommand(record as RelayCommand);
      }
    });

    this.socket.addEventListener("close", () => {
      this.handlers.onClose();
    });

    this.send(handshake);
  }

  disconnect(): void {
    if (!this.socket) return;
    if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
      this.socket.close(1000, "Relay disconnect");
    }
    this.socket = null;
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

  private send(payload: unknown): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(payload));
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
