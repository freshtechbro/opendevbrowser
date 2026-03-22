import { randomUUID } from "crypto";
import { WebSocket } from "ws";
import type { AgentInbox } from "../annotate/agent-inbox";
import { getAnnotationTimeoutMessage } from "../annotate/timeout-messages";
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
  stored?: boolean;
  includeScreenshots?: boolean;
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
  private agentInbox?: AgentInbox;

  constructor(
    relay: RelayLike | undefined,
    config: OpenDevBrowserConfig,
    manager?: BrowserManagerLike,
    agentInbox?: AgentInbox
  ) {
    this.relay = relay;
    this.config = config;
    this.manager = manager;
    this.agentInbox = agentInbox;
  }

  setRelay(relay: RelayLike | undefined): void {
    this.relay = relay;
  }

  setBrowserManager(manager?: BrowserManagerLike): void {
    this.manager = manager;
  }

  setAgentInbox(agentInbox?: AgentInbox): void {
    this.agentInbox = agentInbox;
  }

  async requestAnnotation(options: AnnotationRequestOptions): Promise<AnnotationResponse> {
    if (options.stored) {
      return this.requestStored(options);
    }
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

  private async requestStored(options: AnnotationRequestOptions): Promise<AnnotationResponse> {
    const requestId = randomUUID();
    const sharedPayload = this.agentInbox?.latestPayload();
    if (sharedPayload) {
      return {
        version: 1,
        requestId,
        status: "ok",
        payload: sharedPayload
      };
    }
    if (options.transport === "direct") {
      return {
        version: 1,
        requestId,
        status: "error",
        error: { code: "invalid_request", message: "Stored annotations require relay transport." }
      };
    }
    return this.requestRelay(
      {
        ...options,
        transport: "relay"
      },
      true,
      "fetch_stored"
    );
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

  private async requestRelay(
    options: AnnotationRequestOptions,
    requireExtension: boolean,
    commandName: AnnotationCommand["command"] = "start"
  ): Promise<AnnotationResponse> {
    const requestId = randomUUID();
    const timeoutMs = options.timeoutMs ?? 120_000;
    let resolvedTabId = options.tabId;

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
        if (commandName === "start" && typeof resolvedTabId !== "number") {
          resolvedTabId = parseExtensionTabId(options.targetId) ?? parseExtensionTabId(status.activeTargetId);
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

    const command: AnnotationCommand = {
      version: 1,
      requestId,
      command: commandName,
      url: options.url,
      tabId: resolvedTabId,
      options: {
        screenshotMode: options.screenshotMode,
        debug: options.debug,
        context: options.context,
        includeScreenshots: options.includeScreenshots
      }
    };

    if (this.relay?.requestAnnotation) {
      return await this.relay.requestAnnotation(command, timeoutMs);
    }

    const baseEndpoint = this.getRelayEndpoint();
    if (!baseEndpoint) {
      return {
        version: 1,
        requestId,
        status: "error",
        error: { code: "relay_unavailable", message: "Annotation relay unavailable. Start the daemon and retry." }
      };
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

    const relayCommand: RelayAnnotationCommand = {
      type: "annotationCommand",
      payload: command
    };

    let terminalResponse: AnnotationResponse | null = null;
    let readySeen = false;

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
            terminalResponse = response.payload;
            resolve(response.payload);
          }
        } else if (record.type === "annotationEvent") {
          const event = record as RelayAnnotationEvent;
          if (event.payload?.requestId === requestId) {
            if (event.payload.event === "ready") {
              readySeen = true;
            }
            return;
          }
        }
      });
      socket.on("error", (error) => reject(error));
      socket.on("close", () => {
        if (terminalResponse) {
          resolve(terminalResponse);
          return;
        }
        if (commandName === "start" && readySeen) {
          resolve({
            version: 1,
            requestId,
            status: "cancelled",
            error: { code: "cancelled", message: "Annotation cancelled." }
          });
          return;
        }
        reject(new Error("Relay closed annotation socket"));
      });
    });

    let timedOut = false;
    const timeoutPromise = new Promise<AnnotationResponse>((resolve) => {
      const id = setTimeout(() => {
        clearTimeout(id);
        timedOut = true;
        resolve({
          version: 1,
          requestId,
          status: "error",
          error: { code: "timeout", message: getAnnotationTimeoutMessage(readySeen) }
        });
      }, timeoutMs);
    });

    let locallyAborted = false;
    const abortPromise = new Promise<AnnotationResponse>((resolve) => {
      if (!options.signal) return;
      if (options.signal.aborted) {
        locallyAborted = true;
        resolve({
          version: 1,
          requestId,
          status: "cancelled",
          error: { code: "cancelled", message: "Annotation request cancelled." }
        });
        return;
      }
      const onAbort = () => {
        locallyAborted = true;
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
      const shouldCancel = commandName === "start" && (locallyAborted || timedOut);
      if (shouldCancel) {
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

const parseExtensionTabId = (targetId: string | null | undefined): number | undefined => {
  if (!targetId?.startsWith("tab-")) {
    return undefined;
  }
  const value = Number(targetId.slice(4));
  return Number.isInteger(value) ? value : undefined;
};

const parseJson = (data: WebSocket.RawData): unknown => {
  const text = typeof data === "string" ? data : data.toString();
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
