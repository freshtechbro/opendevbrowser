import { createServer, type IncomingMessage } from "http";
import type { AddressInfo } from "net";
import { WebSocket, WebSocketServer } from "ws";
import type { RelayCommand, RelayEvent, RelayHandshake, RelayResponse } from "./protocol";

type ExtensionInfo = {
  tabId: number;
  url?: string;
  title?: string;
  groupId?: number;
};

export class RelayServer {
  private running = false;
  private baseUrl: string | null = null;
  private port: number | null = null;
  private server: ReturnType<typeof createServer> | null = null;
  private extensionWss: WebSocketServer | null = null;
  private cdpWss: WebSocketServer | null = null;
  private extensionSocket: WebSocket | null = null;
  private cdpSocket: WebSocket | null = null;
  private extensionInfo: ExtensionInfo | null = null;
  private pairingToken: string | null = null;

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
      socket.on("message", (data: WebSocket.RawData) => {
        this.handleExtensionMessage(data);
      });
      socket.on("close", () => {
        if (this.extensionSocket === socket) {
          this.extensionSocket = null;
          this.extensionInfo = null;
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

    this.server.on("upgrade", (request: IncomingMessage, socket, head) => {
      const pathname = new URL(request.url ?? "", "http://127.0.0.1").pathname;
      if (pathname === "/extension") {
        this.extensionWss?.handleUpgrade(request, socket, head, (ws: WebSocket) => {
          this.extensionWss?.emit("connection", ws, request);
        });
        return;
      }
      if (pathname === "/cdp") {
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

    return { url: this.baseUrl, port: address.port };
  }

  stop(): void {
    this.running = false;
    this.baseUrl = null;
    this.port = null;
    this.extensionInfo = null;

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

  status(): {
    running: boolean;
    url?: string;
    port?: number;
    extensionConnected: boolean;
    cdpConnected: boolean;
    extension?: ExtensionInfo;
  } {
    return {
      running: this.running,
      url: this.baseUrl || undefined,
      port: this.port ?? undefined,
      extensionConnected: Boolean(this.extensionSocket),
      cdpConnected: Boolean(this.cdpSocket),
      extension: this.extensionInfo ?? undefined
    };
  }

  getCdpUrl(): string | null {
    return this.baseUrl ? `${this.baseUrl}/cdp` : null;
  }

  setToken(token?: string | false | null): void {
    const trimmed = typeof token === "string" ? token.trim() : "";
    this.pairingToken = trimmed.length ? trimmed : null;
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
        this.extensionInfo = null;
        this.extensionSocket?.close(1008, "Invalid pairing token");
        return;
      }
      this.extensionInfo = {
        tabId: message.payload.tabId,
        url: message.payload.url,
        title: message.payload.title,
        groupId: message.payload.groupId
      };
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
    if (!this.pairingToken) {
      return true;
    }
    return handshake.payload.pairingToken === this.pairingToken;
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
