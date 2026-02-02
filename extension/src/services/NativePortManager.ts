import type { NativeTransportError, NativeTransportHealth, NativeTransportStatus } from "../types.js";

type NativePortHandlers = {
  onMessage?: (payload: unknown) => void;
  onDisconnect?: (error?: { code: NativeTransportError; message: string }) => void;
};

const DEFAULT_HOST = "com.opendevbrowser.native";

export class NativePortManager {
  private port: chrome.runtime.Port | null = null;
  private status: NativeTransportStatus = "disconnected";
  private lastError: { code: NativeTransportError; message: string } | null = null;
  private lastPongAt: number | null = null;
  private queue: unknown[] = [];
  private pendingPing: { id: string; resolve: () => void; reject: (error: Error) => void; timeoutId: number } | null = null;
  private handlers: NativePortHandlers;
  private hostName: string;
  private connectPromise: Promise<boolean> | null = null;

  constructor(handlers: NativePortHandlers = {}, hostName = DEFAULT_HOST) {
    this.handlers = handlers;
    this.hostName = hostName;
  }

  isConnected(): boolean {
    return this.status === "connected";
  }

  getHealth(): NativeTransportHealth {
    return {
      status: this.status,
      error: this.lastError?.code,
      detail: this.lastError?.message,
      lastPongAt: this.lastPongAt ?? undefined
    };
  }

  async connect(): Promise<boolean> {
    if (this.connectPromise) {
      return await this.connectPromise;
    }
    const run = (async () => {
      this.disconnect();
      let port: chrome.runtime.Port;
      try {
        port = chrome.runtime.connectNative(this.hostName);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.setError(classifyNativeError(message), message);
        return false;
      }
      this.port = port;
      this.status = "connected";
      this.lastError = null;
      port.onMessage.addListener((payload) => this.handleMessage(payload));
      port.onDisconnect.addListener(() => this.handleDisconnect());
      this.flushQueue();
      return true;
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
    if (this.port) {
      try {
        this.port.disconnect();
      } catch {
        // Ignore disconnect errors.
      }
    }
    this.port = null;
    this.status = "disconnected";
    this.clearPendingPing();
  }

  send(payload: unknown): void {
    if (this.port && this.status === "connected") {
      this.port.postMessage(payload);
      return;
    }
    this.queue.push(payload);
  }

  async ping(timeoutMs = 5000): Promise<void> {
    if (!this.port || this.status !== "connected") {
      throw new Error("Native port not connected");
    }
    const id = crypto.randomUUID();
    this.clearPendingPing();
    return await new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.setError("host_timeout", "Native host ping timed out");
        reject(new Error("Native host ping timed out"));
      }, timeoutMs);
      this.pendingPing = { id, resolve, reject, timeoutId };
      this.port?.postMessage({ type: "ping", id });
    });
  }

  private handleMessage(payload: unknown): void {
    if (!payload || typeof payload !== "object") {
      return;
    }
    const record = payload as Record<string, unknown>;
    if (record.type === "pong" && typeof record.id === "string") {
      if (this.pendingPing && this.pendingPing.id === record.id) {
        clearTimeout(this.pendingPing.timeoutId);
        const resolve = this.pendingPing.resolve;
        this.pendingPing = null;
        this.lastPongAt = Date.now();
        resolve();
      }
      return;
    }
    if (record.type === "error" && typeof record.code === "string" && typeof record.message === "string") {
      const code = mapNativeErrorCode(record.code);
      this.setError(code, record.message);
      return;
    }
    this.handlers.onMessage?.(payload);
  }

  private handleDisconnect(): void {
    const lastError = chrome.runtime.lastError;
    const message = lastError?.message ?? "Native host disconnected";
    this.setError(classifyNativeError(message), message);
    this.port = null;
    this.handlers.onDisconnect?.(this.lastError ?? undefined);
  }

  private flushQueue(): void {
    if (!this.port || this.status !== "connected") return;
    const queued = [...this.queue];
    this.queue = [];
    for (const payload of queued) {
      this.port.postMessage(payload);
    }
  }

  private clearPendingPing(): void {
    if (!this.pendingPing) return;
    clearTimeout(this.pendingPing.timeoutId);
    this.pendingPing = null;
  }

  private setError(code: NativeTransportError, message: string): void {
    this.status = code === "host_disconnect" ? "disconnected" : "error";
    this.lastError = { code, message };
  }
}

const classifyNativeError = (message: string): NativeTransportError => {
  const lowered = message.toLowerCase();
  if (lowered.includes("not found")) {
    return "host_not_installed";
  }
  if (lowered.includes("forbidden")) {
    return "host_forbidden";
  }
  if (lowered.includes("disconnect") || lowered.includes("disconnected") || lowered.includes("terminated")) {
    return "host_disconnect";
  }
  return "unknown";
};

const mapNativeErrorCode = (code: string): NativeTransportError => {
  if (code === "host_message_too_large") return "host_message_too_large";
  if (code === "host_timeout") return "host_timeout";
  if (code === "host_forbidden") return "host_forbidden";
  if (code === "host_not_installed") return "host_not_installed";
  if (code === "host_disconnect") return "host_disconnect";
  return "unknown";
};

export const __test__ = {
  classifyNativeError,
  mapNativeErrorCode
};
