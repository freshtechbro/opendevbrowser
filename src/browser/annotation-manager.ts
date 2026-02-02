import { randomUUID } from "crypto";
import { WebSocket } from "ws";
import type { OpenDevBrowserConfig } from "../config";
import { resolveDirectAnnotateAssets, runDirectAnnotate } from "../annotate/direct-annotator";
import type { RelayLike } from "../relay/relay-types";
import { resolveRelayEndpoint } from "../relay/relay-endpoints";
import type { BrowserManagerLike } from "./manager-types";
import type {
  AnnotationCommand,
  AnnotationResponse,
  AnnotationScreenshotMode,
  AnnotationTransport,
  RelayAnnotationCommand,
  RelayAnnotationEvent,
  RelayAnnotationResponse
} from "../relay/protocol";

export type AnnotationRequestOptions = {
  sessionId?: string;
  targetId?: string;
  tabId?: number;
  transport?: AnnotationTransport;
  url?: string;
  screenshotMode?: AnnotationScreenshotMode;
  debug?: boolean;
  context?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export class AnnotationManager {
  private relay: RelayLike | undefined;
  private config: OpenDevBrowserConfig;
  private manager?: BrowserManagerLike;

  constructor(relay: RelayLike | undefined, config: OpenDevBrowserConfig, manager?: BrowserManagerLike) {
    this.relay = relay;
    this.config = config;
    this.manager = manager;
  }

  setRelay(relay: RelayLike | undefined): void {
    this.relay = relay;
  }

  setBrowserManager(manager?: BrowserManagerLike): void {
    this.manager = manager;
  }

  async requestAnnotation(options: AnnotationRequestOptions): Promise<AnnotationResponse> {
    const transport = options.transport ?? "auto";

    if (transport === "relay") {
      return this.requestRelay(options, true);
    }

    if (transport === "direct") {
      return this.requestDirect(options);
    }

    if (options.sessionId) {
      const directResult = await this.requestDirect(options);
      if (directResult.status === "ok" || directResult.status === "cancelled") {
        return directResult;
      }
      if (directResult.error?.code === "direct_unavailable" || directResult.error?.code === "direct_failed") {
        const canFallback = await this.canFallbackToRelay(options.sessionId);
        if (canFallback) {
          return this.requestRelay(options, true);
        }
      }
      return directResult;
    }

    return this.requestRelay(options, false);
  }

  private async canFallbackToRelay(sessionId: string): Promise<boolean> {
    if (!this.manager) {
      return false;
    }
    try {
      const status = await this.manager.status(sessionId);
      if (status.mode !== "extension") {
        return false;
      }
    } catch {
      return false;
    }
    return Boolean(this.getRelayEndpoint());
  }

  private getRelayEndpoint(): string | null {
    return this.relay?.getAnnotationUrl?.()
      ?? (this.config.relayPort > 0 ? `ws://127.0.0.1:${this.config.relayPort}/annotation` : null);
  }

  private async requestDirect(options: AnnotationRequestOptions): Promise<AnnotationResponse> {
    const requestId = randomUUID();
    if (!options.sessionId) {
      return {
        version: 1,
        requestId,
        status: "error",
        error: { code: "direct_unavailable", message: "Direct annotate requires sessionId." }
      };
    }

    if (!this.manager) {
      return {
        version: 1,
        requestId,
        status: "error",
        error: { code: "direct_unavailable", message: "Direct annotate unavailable for this session." }
      };
    }

    const assetsResult = resolveDirectAnnotateAssets();
    if (!assetsResult.assets) {
      return {
        version: 1,
        requestId,
        status: "error",
        error: { code: "direct_unavailable", message: assetsResult.error ?? "Direct annotate unavailable." }
      };
    }

    try {
      return await runDirectAnnotate(this.manager, assetsResult.assets, {
        sessionId: options.sessionId,
        targetId: options.targetId,
        url: options.url,
        screenshotMode: options.screenshotMode,
        debug: options.debug,
        context: options.context,
        timeoutMs: options.timeoutMs,
        signal: options.signal
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Direct annotate failed.";
      return {
        version: 1,
        requestId,
        status: "error",
        error: { code: "direct_failed", message: detail }
      };
    }
  }

  private async requestRelay(options: AnnotationRequestOptions, requireExtension: boolean): Promise<AnnotationResponse> {
    const requestId = randomUUID();
    const timeoutMs = options.timeoutMs ?? 120_000;

    const baseEndpoint = this.getRelayEndpoint();
    if (!baseEndpoint) {
      return {
        version: 1,
        requestId,
        status: "error",
        error: { code: "relay_unavailable", message: "Annotation relay unavailable. Start the daemon and retry." }
      };
    }

    if (requireExtension && options.sessionId && this.manager) {
      try {
        const status = await this.manager.status(options.sessionId);
        if (status.mode !== "extension") {
          return {
            version: 1,
            requestId,
            status: "error",
            error: { code: "invalid_request", message: "Relay annotations require extension mode." }
          };
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Annotation session unavailable.";
        return {
          version: 1,
          requestId,
          status: "error",
          error: { code: "invalid_request", message: detail }
        };
      }
    }

    const { connectEndpoint } = await resolveRelayEndpoint({
      wsEndpoint: baseEndpoint,
      path: "annotation",
      config: this.config
    });

    const socket = new WebSocket(connectEndpoint);
    try {
      await waitForSocketOpen(socket, 3000);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Relay unavailable";
      socket.removeAllListeners();
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close(1000, "Annotation socket open failed");
      }
      return {
        version: 1,
        requestId,
        status: "error",
        error: { code: "relay_unavailable", message: detail }
      };
    }

    const command: AnnotationCommand = {
      version: 1,
      requestId,
      command: "start",
      url: options.url,
      tabId: options.tabId,
      options: {
        screenshotMode: options.screenshotMode,
        debug: options.debug,
        context: options.context
      }
    };

    const relayCommand: RelayAnnotationCommand = {
      type: "annotationCommand",
      payload: command
    };

    const cleanup = () => {
      socket.removeAllListeners();
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close(1000, "Annotation complete");
      }
    };

    const responsePromise = new Promise<AnnotationResponse>((resolve, reject) => {
      socket.on("message", (data) => {
        const message = parseJson(data);
        if (!message || typeof message !== "object") return;
        const record = message as Record<string, unknown>;
        if (record.type === "annotationResponse") {
          const response = record as RelayAnnotationResponse;
          if (response.payload?.requestId === requestId) {
            resolve(response.payload);
          }
        } else if (record.type === "annotationEvent") {
          const event = record as RelayAnnotationEvent;
          if (event.payload?.requestId === requestId) {
            return;
          }
        }
      });
      socket.on("error", (error) => reject(error));
      socket.on("close", () => reject(new Error("Relay closed annotation socket")));
    });

    const timeoutPromise = new Promise<AnnotationResponse>((resolve) => {
      const id = setTimeout(() => {
        clearTimeout(id);
        resolve({
          version: 1,
          requestId,
          status: "error",
          error: { code: "timeout", message: "Annotation request timed out." }
        });
      }, timeoutMs);
    });

    const abortPromise = new Promise<AnnotationResponse>((resolve) => {
      if (!options.signal) return;
      if (options.signal.aborted) {
        resolve({
          version: 1,
          requestId,
          status: "cancelled",
          error: { code: "cancelled", message: "Annotation request cancelled." }
        });
        return;
      }
      const onAbort = () => {
        resolve({
          version: 1,
          requestId,
          status: "cancelled",
          error: { code: "cancelled", message: "Annotation request cancelled." }
        });
      };
      options.signal.addEventListener("abort", onAbort, { once: true });
    });

    socket.send(JSON.stringify(relayCommand));

    try {
      const result = await Promise.race([responsePromise, timeoutPromise, abortPromise]);
      if (result.status !== "ok") {
        sendCancel(socket, requestId);
      }
      return result;
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Relay unavailable";
      return {
        version: 1,
        requestId,
        status: "error",
        error: { code: "relay_unavailable", message: detail }
      };
    } finally {
      cleanup();
    }
  }
}

const waitForSocketOpen = (socket: WebSocket, timeoutMs: number): Promise<void> => {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Annotation socket open timed out"));
    }, timeoutMs);
    socket.once("open", () => {
      clearTimeout(timeout);
      resolve();
    });
    socket.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
};

const sendCancel = (socket: WebSocket, requestId: string): void => {
  if (socket.readyState !== WebSocket.OPEN) return;
  const command: AnnotationCommand = {
    version: 1,
    requestId,
    command: "cancel"
  };
  const relayCommand: RelayAnnotationCommand = {
    type: "annotationCommand",
    payload: command
  };
  socket.send(JSON.stringify(relayCommand));
};

const parseJson = (data: WebSocket.RawData): unknown => {
  const text = typeof data === "string" ? data : data.toString();
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
