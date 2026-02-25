import type {
  ConnectionStatus,
  RelayAnnotationCommand,
  RelayAnnotationEvent,
  RelayAnnotationResponse,
  RelayHandshake,
  RelayHandshakeAck,
  RelayHealthStatus,
  OpsEnvelope
} from "../types.js";
import { DEFAULT_PAIRING_ENABLED, DEFAULT_PAIRING_TOKEN, DEFAULT_RELAY_PORT } from "../relay-settings.js";
import { RelayClient } from "./RelayClient.js";
import { CDPRouter } from "./CDPRouter.js";
import { TabManager } from "./TabManager.js";
import { logError } from "../logging.js";
import { getRestrictionMessage } from "./url-restrictions.js";

type TrackedTab = {
  id: number;
  url?: string;
  title?: string;
  groupId?: number;
};

type ConnectionErrorCode =
  | "no_active_tab"
  | "tab_url_missing"
  | "tab_url_restricted"
  | "debugger_attach_failed"
  | "relay_connect_failed"
  | "unknown";

type ConnectionErrorInfo = {
  code: ConnectionErrorCode;
  message: string;
};

class ConnectionError extends Error {
  code: ConnectionErrorCode;

  constructor(code: ConnectionErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

const summarizeProtocol = (rawUrl?: string | null): string => {
  if (!rawUrl) {
    return "unknown";
  }
  try {
    return new URL(rawUrl).protocol.replace(":", "");
  } catch (error) {
    logError("connection.summarize_protocol", error, { code: "url_parse_failed" });
    return "unknown";
  }
};

const logInfo = (message: string): void => {
  console.info(`[opendevbrowser] ${message}`);
};

const logWarn = (message: string): void => {
  console.warn(`[opendevbrowser] ${message}`);
};

const RECONNECT_INITIAL_DELAY_MS = 12_000;
const RECONNECT_MAX_DELAY_MS = 30_000;

export class ConnectionManager {
  private status: ConnectionStatus = "disconnected";
  private lastError: ConnectionErrorInfo | null = null;
  private listeners = new Set<(status: ConnectionStatus) => void>();
  private relay: RelayClient | null = null;
  private cdp = new CDPRouter();
  private tabs = new TabManager();
  private trackedTab: TrackedTab | null = null;
  private disconnecting = false;
  private shouldReconnect = false;
  private reconnectTimer: number | null = null;
  private reconnectAttempts = 0;
  private reconnectDelayMs = RECONNECT_INITIAL_DELAY_MS;
  private pairingToken: string | null = DEFAULT_PAIRING_TOKEN;
  private pairingEnabled = DEFAULT_PAIRING_ENABLED;
  private relayPort = DEFAULT_RELAY_PORT;
  private relayInstanceId: string | null = null;
  private relayEpoch: number | null = null;
  private relayConfirmedPort: number | null = null;
  private relayNotice: string | null = null;
  private readonly maxReconnectDelayMs = RECONNECT_MAX_DELAY_MS;
  private connectPromise: Promise<void> | null = null;
  private annotationHandler: ((command: RelayAnnotationCommand) => void) | null = null;
  private opsHandler: ((message: OpsEnvelope) => void) | null = null;
  private heartbeatTimer: number | null = null;
  private heartbeatInFlight = false;
  private readonly heartbeatIntervalMs = 25_000;
  private readonly heartbeatTimeoutMs = 2_000;

  constructor() {
    this.loadSettings().catch((error) => {
      logError("connection.load_settings", error, { code: "storage_load_failed" });
    });
    chrome.storage.onChanged.addListener(this.handleStorageChange);
    chrome.tabs.onRemoved.addListener(this.handleTabRemoved);
    chrome.tabs.onUpdated.addListener(this.handleTabUpdated);
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  getRelayIdentity(): { instanceId: string | null; relayPort: number | null } {
    return {
      instanceId: this.relayInstanceId,
      relayPort: this.relayConfirmedPort
    };
  }

  getRelayNotice(): string | null {
    return this.relayNotice;
  }

  getLastError(): ConnectionErrorInfo | null {
    return this.lastError;
  }

  clearLastError(): void {
    this.lastError = null;
  }

  onAnnotationCommand(handler: (command: RelayAnnotationCommand) => void): void {
    this.annotationHandler = handler;
  }

  onOpsMessage(handler: (message: OpsEnvelope) => void): void {
    this.opsHandler = handler;
  }

  sendAnnotationResponse(response: RelayAnnotationResponse): void {
    if (!this.relay) return;
    try {
      this.relay.sendAnnotationResponse(response);
    } catch (error) {
      logError("relay.send_annotation_response", error, { code: "relay_send_failed" });
    }
  }

  sendAnnotationEvent(event: RelayAnnotationEvent): void {
    if (!this.relay) return;
    try {
      this.relay.sendAnnotationEvent(event);
    } catch (error) {
      logError("relay.send_annotation_event", error, { code: "relay_send_failed" });
    }
  }

  sendOpsMessage(message: OpsEnvelope): void {
    if (!this.relay) return;
    try {
      this.relay.sendOpsMessage(message);
    } catch (error) {
      logError("relay.send_ops_message", error, { code: "relay_send_failed" });
    }
  }

  getCdpRouter(): CDPRouter {
    return this.cdp;
  }

  async relayHealthCheck(): Promise<RelayHealthStatus | null> {
    if (!this.relay || !this.relay.isConnected()) {
      return null;
    }
    try {
      return await this.relay.sendHealthCheck();
    } catch (error) {
      logError("relay.health_check", error, { code: "relay_health_failed" });
      return null;
    }
  }

  async connect(): Promise<void> {
    if (this.connectPromise) {
      return await this.connectPromise;
    }

    const run = (async () => {
      if (this.status === "connected") {
        return;
      }

      try {
        this.clearLastError();
        this.relayNotice = null;
        this.shouldReconnect = true;
        this.reconnectAttempts = 0;
        await this.loadSettings();
        await this.attachToActiveTab();
        await this.connectRelay();
        this.clearLastError();
      } catch (error) {
        const info = this.normalizeError(error);
        this.setLastError(info);
        const detail = error instanceof Error ? error.message : "Unknown error";
        logWarn(`Connect failed (${info.code}). ${detail}`);
        await this.disconnect();
      }
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
    if (this.disconnecting) return;
    this.disconnecting = true;
    this.shouldReconnect = false;
    this.clearReconnectTimer();
    this.stopHeartbeat();
    try {
      if (this.relay) {
        this.relay.disconnect();
        this.relay = null;
      }
      await this.cdp.detachAll();
      this.trackedTab = null;
    } finally {
      this.disconnecting = false;
      this.setStatus("disconnected");
      this.relayInstanceId = null;
      this.relayConfirmedPort = null;
      this.relayEpoch = null;
      this.relayNotice = null;
    }
  }

  onStatus(listener: (status: ConnectionStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    for (const listener of this.listeners) {
      listener(status);
    }
  }

  private safeRelaySend(action: () => void, context: string): void {
    try {
      action();
    } catch (error) {
      logError(context, error, { code: "relay_send_failed" });
    }
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      return;
    }
    this.heartbeatTimer = setInterval(() => {
      this.runHeartbeat().catch((error) => {
        logError("relay.heartbeat", error, { code: "relay_heartbeat_failed" });
      });
    }, this.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.heartbeatInFlight = false;
  }

  private async runHeartbeat(): Promise<void> {
    if (!this.relay || !this.relay.isConnected()) {
      return;
    }
    if (this.heartbeatInFlight) {
      return;
    }
    this.heartbeatInFlight = true;
    try {
      await this.relay.sendPing(this.heartbeatTimeoutMs);
    } catch (error) {
      logError("relay.heartbeat", error, { code: "relay_heartbeat_failed" });
      if (this.shouldReconnect && !this.disconnecting) {
        this.relay.disconnect();
      }
    } finally {
      this.heartbeatInFlight = false;
    }
  }

  private async attachToActiveTab(): Promise<void> {
    let tab = await this.tabs.getActiveTab();
    if (!tab || typeof tab.id !== "number") {
      this.trackedTab = null;
      this.setStatus("disconnected");
      logWarn("Active tab not found.");
      throw new ConnectionError(
        "no_active_tab",
        "No active browser tab found. Focus a normal tab (not the popup) and retry."
      );
    }

    if (!tab.url) {
      logWarn("Active tab URL missing.");
      const fallbackId = await this.tabs.getFirstHttpTabId();
      if (fallbackId && fallbackId !== tab.id) {
        const fallbackTab = await this.tabs.getTab(fallbackId);
        if (fallbackTab && typeof fallbackTab.id === "number" && fallbackTab.url) {
          logInfo("Falling back to first http(s) tab.");
          tab = fallbackTab;
        }
      }
      if (!tab.url) {
        throw new ConnectionError("tab_url_missing", "Active tab URL is unavailable. Reload the tab and retry.");
      }
    }

    let parsedUrl: URL | null = null;
    try {
      parsedUrl = new URL(tab.url);
    } catch (error) {
      logError("connection.parse_tab_url", error, { code: "tab_url_parse_failed" });
      parsedUrl = null;
    }

    if (!parsedUrl) {
      logWarn("Active tab URL is invalid.");
      const fallbackId = await this.tabs.getFirstHttpTabId();
      if (fallbackId && fallbackId !== tab.id) {
        const fallbackTab = await this.tabs.getTab(fallbackId);
        if (fallbackTab && typeof fallbackTab.id === "number" && fallbackTab.url) {
          logInfo("Falling back to first http(s) tab.");
          try {
            parsedUrl = new URL(fallbackTab.url);
            tab = fallbackTab;
          } catch {
            parsedUrl = null;
          }
        }
      }
      if (!parsedUrl) {
        throw new ConnectionError(
          "tab_url_restricted",
          "Active tab URL is unsupported. Focus a normal http(s) tab and retry."
        );
      }
    }

    const restrictionMessage = getRestrictionMessage(parsedUrl);
    if (restrictionMessage) {
      logWarn(`Active tab blocked: ${summarizeProtocol(tab.url)} scheme.`);
      const fallbackId = await this.tabs.getFirstHttpTabId();
      if (fallbackId && fallbackId !== tab.id) {
        const fallbackTab = await this.tabs.getTab(fallbackId);
        if (fallbackTab && typeof fallbackTab.id === "number" && fallbackTab.url) {
          try {
            const fallbackUrl = new URL(fallbackTab.url);
            const fallbackRestriction = getRestrictionMessage(fallbackUrl);
            if (!fallbackRestriction) {
              logInfo("Falling back to first http(s) tab.");
              tab = fallbackTab;
              parsedUrl = fallbackUrl;
            }
          } catch {
            // Ignore invalid fallback URL.
          }
        }
      }
      if (restrictionMessage && getRestrictionMessage(parsedUrl)) {
        throw new ConnectionError("tab_url_restricted", restrictionMessage);
      }
    }

    const tabId = tab.id;
    if (typeof tabId !== "number") {
      this.trackedTab = null;
      this.setStatus("disconnected");
      throw new ConnectionError(
        "no_active_tab",
        "No active browser tab found. Focus a normal tab (not the popup) and retry."
      );
    }

    logInfo("Active tab resolved.");
    try {
      await this.cdp.attach(tabId);
      logInfo("Debugger attached.");
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unknown error";
      logWarn(`Debugger attach failed. ${detail}`);
      const message = detail.includes("Chrome 125+")
        ? detail
        : "Debugger attach failed. Close DevTools for the tab and retry.";
      throw new ConnectionError(
        "debugger_attach_failed",
        message
      );
    }
    this.trackedTab = {
      id: tabId,
      url: tab.url ?? undefined,
      title: tab.title ?? undefined,
      groupId: typeof tab.groupId === "number" ? tab.groupId : undefined
    };
  }

  private async connectRelay(): Promise<void> {
    if (!this.trackedTab) {
      throw new ConnectionError("relay_connect_failed", "Relay connection failed. Start the daemon and retry.");
    }

    const relay = new RelayClient(this.buildRelayUrl(), {
      onCommand: (command) => {
        this.cdp.handleCommand(command).catch((error) => {
          logError("cdp.handle_command", error, { code: "cdp_command_failed" });
          this.handleCdpDetach({ reason: "cdp_command_failed" });
        });
      },
      onAnnotationCommand: (command) => {
        this.annotationHandler?.(command);
      },
      onOpsMessage: (message) => {
        this.opsHandler?.(message);
      },
      onClose: (detail) => {
        this.handleRelayClose(detail);
      }
    });

    this.relay = relay;
    this.cdp.setCallbacks({
      onEvent: (event) => {
        this.safeRelaySend(() => this.relay?.sendEvent(event), "relay.send_event");
      },
      onResponse: (response) => {
        this.safeRelaySend(() => this.relay?.sendResponse(response), "relay.send_response");
      },
      onDetach: (detail) => {
        this.handleCdpDetach(detail);
      },
      onPrimaryTabChange: (tabId) => {
        this.handlePrimaryTabChange(tabId).catch((error) => {
          logError("connection.primary_tab_change", error, { code: "primary_tab_change_failed" });
        });
      }
    });

    try {
      const ack = await relay.connect(this.buildHandshake());
      const relayEpoch = typeof ack.payload.epoch === "number" && Number.isFinite(ack.payload.epoch)
        ? ack.payload.epoch
        : null;
      const mismatch = await this.reconcileRelayIdentity(ack);
      this.relayInstanceId = ack.payload.instanceId;
      this.relayEpoch = relayEpoch;
      this.persistRelayPort(ack.payload.relayPort);
      if (!mismatch) {
        this.persistRelayIdentity(ack.payload.relayPort, this.relayInstanceId, this.relayEpoch);
      }
      logInfo("Relay WebSocket connected.");
      this.setStatus("connected");
      this.startHeartbeat();
      this.reconnectAttempts = 0;
      this.reconnectDelayMs = RECONNECT_INITIAL_DELAY_MS;
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unknown error";
      logWarn(`Relay WebSocket connect failed. ${detail}`);
      if (this.relay === relay) {
        this.relay = null;
      }
      throw new ConnectionError("relay_connect_failed", "Relay connection failed. Start the daemon and retry.");
    }
  }

  private handleRelayClose(detail?: { code?: number; reason?: string }): void {
    this.stopHeartbeat();
    this.relay = null;
    if (detail && (detail.code === 1008 || detail.reason?.includes("Invalid pairing token"))) {
      this.clearStoredPairingToken();
    }
    if (!this.shouldReconnect) {
      return;
    }
    this.setStatus("disconnected");
    this.relayInstanceId = null;
    this.relayConfirmedPort = null;
    this.relayEpoch = null;
    this.scheduleReconnect();
  }

  private handleCdpDetach(detail?: { tabId?: number; reason?: string }): void {
    const reason = detail?.reason ? ` (${detail.reason})` : "";
    logWarn(`CDP detached${reason}.`);
    if (this.disconnecting) {
      return;
    }
    if (!this.shouldReconnect) {
      this.disconnect().catch((error) => {
        logError("connection.cdp_detach_disconnect", error, { code: "disconnect_failed" });
      });
      return;
    }
    if (this.cdp.getAttachedTabIds().length > 0) {
      return;
    }
    this.setStatus("disconnected");
    if (this.relay?.isConnected()) {
      this.relay.disconnect();
      return;
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) {
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectAttempts += 1;
      this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, this.maxReconnectDelayMs);
      this.reconnectRelay().catch((error) => {
        logError("connection.reconnect", error, { code: "relay_reconnect_failed" });
        this.scheduleReconnect();
      });
    }, this.reconnectDelayMs);
  }

  private async reconnectRelay(): Promise<void> {
    if (!this.shouldReconnect) {
      return;
    }
    const primaryId = this.cdp.getPrimaryTabId();
    if (!primaryId) {
      await this.attachToActiveTab();
    } else {
      await this.refreshTrackedTab(primaryId);
    }
    if (!this.trackedTab) {
      throw new Error("Reconnect failed: no tracked tab available");
    }
    await this.connectRelay();
  }

  private buildHandshake(): RelayHandshake {
    if (!this.trackedTab) {
      throw new Error("No tracked tab for handshake");
    }
    const payload: RelayHandshake["payload"] = {
      tabId: this.trackedTab.id,
      url: this.trackedTab.url,
      title: this.trackedTab.title,
      groupId: this.trackedTab.groupId
    };
    if (this.pairingEnabled && this.pairingToken) {
      payload.pairingToken = this.pairingToken;
    }
    return {
      type: "handshake",
      payload
    };
  }

  private handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
    if (area !== "local") {
      return;
    }

    if (changes.pairingToken) {
      this.updatePairingToken(changes.pairingToken.newValue);
      this.refreshHandshake();
    }

    if (changes.pairingEnabled) {
      this.updatePairingEnabled(changes.pairingEnabled.newValue);
      this.ensurePairingTokenDefault();
      this.refreshHandshake();
    }

    if (changes.relayPort) {
      this.updateRelayPort(changes.relayPort.newValue);
      this.refreshRelay().catch((error) => {
        logError("connection.refresh_relay", error, { code: "relay_refresh_failed" });
      });
    }
  };

  private handleTabRemoved = (tabId: number) => {
    if (!this.trackedTab || this.trackedTab.id !== tabId) {
      return;
    }
    if (this.cdp.getAttachedTabIds().length <= 1) {
      this.disconnect().catch((error) => {
        logError("connection.tab_removed_disconnect", error, { code: "disconnect_failed" });
      });
    }
  };

  private handleTabUpdated = (_tabId: number, _changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
    if (!this.trackedTab || tab.id !== this.trackedTab.id) {
      return;
    }
    this.trackedTab = {
      id: tab.id,
      url: tab.url ?? this.trackedTab.url,
      title: tab.title ?? this.trackedTab.title,
      groupId: typeof tab.groupId === "number" ? tab.groupId : this.trackedTab.groupId
    };
    if (this.relay?.isConnected()) {
      this.safeRelaySend(() => this.relay?.sendHandshake(this.buildHandshake()), "relay.send_handshake");
    }
  };

  private async loadSettings(): Promise<void> {
    const data = await new Promise<Record<string, unknown>>((resolve) => {
      chrome.storage.local.get(["pairingToken", "pairingEnabled", "relayPort"], (items) => {
        resolve(items);
      });
    });
    this.updatePairingEnabled(data.pairingEnabled);
    this.updatePairingToken(data.pairingToken);
    this.updateRelayPort(data.relayPort);
    this.ensurePairingTokenDefault();
  }

  private setLastError(error: ConnectionErrorInfo | null): void {
    this.lastError = error;
  }

  private normalizeError(error: unknown): ConnectionErrorInfo {
    if (error instanceof ConnectionError) {
      return { code: error.code, message: error.message };
    }
    return {
      code: "unknown",
      message: "Connection failed. Focus a normal tab and retry."
    };
  }

  private updatePairingToken(value: unknown): void {
    if (typeof value === "string" && value.trim().length > 0) {
      this.pairingToken = value.trim();
      return;
    }
    this.pairingToken = null;
  }

  private updatePairingEnabled(value: unknown): void {
    if (typeof value === "boolean") {
      this.pairingEnabled = value;
      return;
    }
    this.pairingEnabled = DEFAULT_PAIRING_ENABLED;
  }

  private ensurePairingTokenDefault(): void {
    if (!this.pairingEnabled || this.pairingToken) {
      return;
    }
    this.pairingToken = DEFAULT_PAIRING_TOKEN;
    chrome.storage.local.set({ pairingToken: DEFAULT_PAIRING_TOKEN });
  }

  private clearStoredPairingToken(clearMemory = true): void {
    if (clearMemory) {
      this.pairingToken = null;
    }
    chrome.storage.local.set({ pairingToken: null, tokenEpoch: null });
  }

  private updateRelayPort(value: unknown): void {
    if (typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 65535) {
      this.relayPort = value;
      return;
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) {
        this.relayPort = parsed;
        return;
      }
    }
    this.relayPort = DEFAULT_RELAY_PORT;
  }

  private persistRelayPort(value: number): void {
    if (!Number.isInteger(value) || value <= 0 || value > 65535) {
      return;
    }
    this.relayPort = value;
    this.relayConfirmedPort = value;
    chrome.storage.local.set({ relayPort: value });
  }

  private persistRelayIdentity(port: number, instanceId: string | null, epoch: number | null): void {
    this.persistRelayPort(port);
    chrome.storage.local.set({
      relayInstanceId: instanceId,
      relayEpoch: epoch
    });
  }

  private clearStoredRelayIdentity(): void {
    chrome.storage.local.set({
      relayInstanceId: null,
      relayEpoch: null
    });
  }

  private async reconcileRelayIdentity(ack: RelayHandshakeAck): Promise<boolean> {
    const stored = await new Promise<Record<string, unknown>>((resolve) => {
      chrome.storage.local.get(["relayInstanceId", "relayEpoch"], (items) => resolve(items));
    });
    const storedInstanceId = typeof stored.relayInstanceId === "string" ? stored.relayInstanceId : null;
    const storedEpoch = typeof stored.relayEpoch === "number" && Number.isFinite(stored.relayEpoch)
      ? stored.relayEpoch
      : null;
    const ackEpoch = typeof ack.payload.epoch === "number" && Number.isFinite(ack.payload.epoch)
      ? ack.payload.epoch
      : null;

    const instanceMismatch = Boolean(storedInstanceId && storedInstanceId !== ack.payload.instanceId);
    const epochMismatch = storedEpoch !== null && ackEpoch !== null && storedEpoch !== ackEpoch;

    if (instanceMismatch || epochMismatch) {
      this.clearStoredRelayIdentity();
      this.clearStoredPairingToken(false);
      this.relayNotice = instanceMismatch
        ? "Relay instance changed. Re-pair and reconnect."
        : "Relay restarted. Re-pair and reconnect.";
      this.safeRelaySend(() => this.relay?.sendHandshake(this.buildHandshake()), "relay.rehandshake");
      return true;
    }

    this.relayNotice = null;
    return false;
  }

  /**
   * Chrome automatically sends Origin: chrome-extension://EXTENSION_ID
   * for WebSocket connections from extensions. The relay server validates
   * this to prevent CSWSH attacks from web pages.
   */
  private buildRelayUrl(): string {
    return `ws://127.0.0.1:${this.relayPort}/extension`;
  }

  private async refreshRelay(): Promise<void> {
    if (this.status !== "connected") return;
    await this.disconnect();
    await this.connect();
  }

  private async handlePrimaryTabChange(tabId: number | null): Promise<void> {
    if (!tabId) {
      this.trackedTab = null;
      if (this.relay?.isConnected()) {
        this.relay.disconnect();
      }
      return;
    }
    await this.refreshTrackedTab(tabId);
    this.refreshHandshake();
  }

  private async refreshTrackedTab(tabId: number): Promise<void> {
    const tab = await this.tabs.getTab(tabId);
    if (!tab || typeof tab.id !== "number") {
      this.trackedTab = null;
      return;
    }
    this.trackedTab = {
      id: tab.id,
      url: tab.url ?? this.trackedTab?.url,
      title: tab.title ?? this.trackedTab?.title,
      groupId: typeof tab.groupId === "number" ? tab.groupId : this.trackedTab?.groupId
    };
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private refreshHandshake(): void {
    if (!this.trackedTab || !this.relay?.isConnected()) {
      return;
    }
    this.safeRelaySend(() => this.relay?.sendHandshake(this.buildHandshake()), "relay.send_handshake");
  }
}
