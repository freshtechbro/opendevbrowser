import type { ConnectionStatus, RelayHandshake } from "../types.js";
import { DEFAULT_PAIRING_ENABLED, DEFAULT_PAIRING_TOKEN, DEFAULT_RELAY_PORT } from "../relay-settings.js";
import { RelayClient } from "./RelayClient.js";
import { CDPRouter } from "./CDPRouter.js";
import { TabManager } from "./TabManager.js";

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

const RESTRICTED_PROTOCOLS = new Set([
  "chrome:",
  "chrome-extension:",
  "chrome-search:",
  "chrome-untrusted:",
  "devtools:",
  "chrome-devtools:",
  "edge:",
  "brave:"
]);

const isWebStoreUrl = (url: URL): boolean => {
  if (url.hostname === "chromewebstore.google.com") {
    return true;
  }
  if (url.hostname === "chrome.google.com" && url.pathname.startsWith("/webstore")) {
    return true;
  }
  return false;
};

const getRestrictionMessage = (url: URL): string | null => {
  if (RESTRICTED_PROTOCOLS.has(url.protocol)) {
    return "Active tab uses a restricted URL scheme. Focus a normal http(s) tab and retry.";
  }
  if (isWebStoreUrl(url)) {
    return "Chrome Web Store tabs cannot be debugged. Open a normal tab and retry.";
  }
  return null;
};

const summarizeProtocol = (rawUrl: string): string => {
  try {
    return new URL(rawUrl).protocol.replace(":", "");
  } catch {
    return "unknown";
  }
};

const logInfo = (message: string): void => {
  console.info(`[opendevbrowser] ${message}`);
};

const logWarn = (message: string): void => {
  console.warn(`[opendevbrowser] ${message}`);
};

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
  private reconnectDelayMs = 500;
  private pairingToken: string | null = DEFAULT_PAIRING_TOKEN;
  private pairingEnabled = DEFAULT_PAIRING_ENABLED;
  private relayPort = DEFAULT_RELAY_PORT;
  private relayInstanceId: string | null = null;
  private relayEpoch: number | null = null;
  private relayConfirmedPort: number | null = null;
  private readonly maxReconnectDelayMs = 5000;

  constructor() {
    this.loadSettings().catch(() => {});
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

  getLastError(): ConnectionErrorInfo | null {
    return this.lastError;
  }

  clearLastError(): void {
    this.lastError = null;
  }

  async connect(): Promise<void> {
    if (this.status === "connected") {
      return;
    }

    try {
      this.clearLastError();
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
  }

  async disconnect(): Promise<void> {
    if (this.disconnecting) return;
    this.disconnecting = true;
    this.shouldReconnect = false;
    this.clearReconnectTimer();
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

  private async attachToActiveTab(): Promise<void> {
    const tab = await this.tabs.getActiveTab();
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
      throw new ConnectionError("tab_url_missing", "Active tab URL is unavailable. Reload the tab and retry.");
    }

    let parsedUrl: URL | null = null;
    try {
      parsedUrl = new URL(tab.url);
    } catch {
      parsedUrl = null;
    }

    if (!parsedUrl) {
      logWarn("Active tab URL is invalid.");
      throw new ConnectionError(
        "tab_url_restricted",
        "Active tab URL is unsupported. Focus a normal http(s) tab and retry."
      );
    }

    const restrictionMessage = getRestrictionMessage(parsedUrl);
    if (restrictionMessage) {
      logWarn(`Active tab blocked: ${summarizeProtocol(tab.url)} scheme.`);
      throw new ConnectionError("tab_url_restricted", restrictionMessage);
    }

    logInfo("Active tab resolved.");
    try {
      await this.cdp.attach(tab.id);
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
      id: tab.id,
      url: tab.url ?? undefined,
      title: tab.title ?? undefined,
      groupId: typeof tab.groupId === "number" ? tab.groupId : undefined
    };
  }

  private async connectRelay(): Promise<void> {
    if (!this.trackedTab) {
      throw new ConnectionError("relay_connect_failed", "Relay connection failed. Start the plugin and retry.");
    }

    const relay = new RelayClient(this.buildRelayUrl(), {
      onCommand: (command) => {
        this.cdp.handleCommand(command).catch(() => {
          this.disconnect().catch(() => {});
        });
      },
      onClose: (detail) => {
        this.handleRelayClose(detail);
      }
    });

    this.relay = relay;
    this.cdp.setCallbacks({
      onEvent: (event) => this.relay?.sendEvent(event),
      onResponse: (response) => this.relay?.sendResponse(response),
      onDetach: () => {
        this.disconnect().catch(() => {});
      },
      onPrimaryTabChange: (tabId) => {
        this.handlePrimaryTabChange(tabId).catch(() => {});
      }
    });

    try {
      const ack = await relay.connect(this.buildHandshake());
      this.relayInstanceId = ack.payload.instanceId;
      this.relayEpoch = typeof ack.payload.epoch === "number" && Number.isFinite(ack.payload.epoch)
        ? ack.payload.epoch
        : null;
      this.persistRelayIdentity(ack.payload.relayPort, this.relayInstanceId, this.relayEpoch);
      logInfo("Relay WebSocket connected.");
      this.setStatus("connected");
      this.reconnectAttempts = 0;
      this.reconnectDelayMs = 500;
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unknown error";
      logWarn(`Relay WebSocket connect failed. ${detail}`);
      if (this.relay === relay) {
        this.relay = null;
      }
      throw new ConnectionError("relay_connect_failed", "Relay connection failed. Start the plugin and retry.");
    }
  }

  private handleRelayClose(detail?: { code?: number; reason?: string }): void {
    this.relay = null;
    if (detail && (detail.code === 1008 || detail.reason?.includes("Invalid pairing token"))) {
      this.clearStoredPairingToken();
    }
    if (!this.shouldReconnect || !this.trackedTab) {
      return;
    }
    this.setStatus("disconnected");
    this.relayInstanceId = null;
    this.relayConfirmedPort = null;
    this.relayEpoch = null;
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
      this.reconnectRelay().catch(() => {
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
      this.disconnect().catch(() => {});
      return;
    }
    await this.refreshTrackedTab(primaryId);
    if (!this.trackedTab) {
      this.disconnect().catch(() => {});
      return;
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
      this.refreshRelay().catch(() => {});
    }
  };

  private handleTabRemoved = (tabId: number) => {
    if (!this.trackedTab || this.trackedTab.id !== tabId) {
      return;
    }
    if (this.cdp.getAttachedTabIds().length <= 1) {
      this.disconnect().catch(() => {});
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
      this.relay.sendHandshake(this.buildHandshake());
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

  private clearStoredPairingToken(): void {
    this.pairingToken = null;
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
    this.relay.sendHandshake(this.buildHandshake());
  }
}
