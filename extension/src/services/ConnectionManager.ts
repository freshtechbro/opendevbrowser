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

export class ConnectionManager {
  private status: ConnectionStatus = "disconnected";
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
  private readonly maxReconnectAttempts = 5;
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

  async connect(): Promise<void> {
    if (this.status === "connected") {
      return;
    }

    try {
      this.shouldReconnect = true;
      this.reconnectAttempts = 0;
      await this.loadSettings();
      await this.attachToActiveTab();
      await this.connectRelay();
    } catch {
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
      if (this.trackedTab !== null) {
        await this.cdp.detach();
        this.trackedTab = null;
      }
    } finally {
      this.disconnecting = false;
      this.setStatus("disconnected");
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
      throw new Error("No active tab available");
    }

    await this.cdp.attach(tab.id);
    this.trackedTab = {
      id: tab.id,
      url: tab.url ?? undefined,
      title: tab.title ?? undefined,
      groupId: typeof tab.groupId === "number" ? tab.groupId : undefined
    };
  }

  private async connectRelay(): Promise<void> {
    if (!this.trackedTab) {
      throw new Error("No tracked tab for relay connection");
    }

    const relay = new RelayClient(this.buildRelayUrl(), {
      onCommand: (command) => {
        this.cdp.handleCommand(command).catch(() => {
          this.disconnect().catch(() => {});
        });
      },
      onClose: () => {
        this.handleRelayClose();
      }
    });

    this.relay = relay;
    this.cdp.setCallbacks({
      onEvent: (event) => this.relay?.sendEvent(event),
      onResponse: (response) => this.relay?.sendResponse(response),
      onDetach: () => {
        this.disconnect().catch(() => {});
      }
    });

    try {
      await relay.connect(this.buildHandshake());
      this.setStatus("connected");
      this.reconnectAttempts = 0;
      this.reconnectDelayMs = 500;
    } catch (error) {
      if (this.relay === relay) {
        this.relay = null;
      }
      throw error;
    }
  }

  private handleRelayClose(): void {
    this.relay = null;
    if (!this.shouldReconnect || !this.trackedTab) {
      return;
    }
    this.setStatus("disconnected");
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) {
      return;
    }
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.disconnect().catch(() => {});
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
    if (!this.trackedTab || !this.shouldReconnect) {
      return;
    }
    const attachedId = this.cdp.getAttachedTabId();
    if (attachedId !== this.trackedTab.id) {
      this.disconnect().catch(() => {});
      return;
    }
    const tab = await this.tabs.getTab(this.trackedTab.id);
    if (!tab) {
      this.disconnect().catch(() => {});
      return;
    }
    this.trackedTab = {
      id: tab.id ?? this.trackedTab.id,
      url: tab.url ?? this.trackedTab.url,
      title: tab.title ?? this.trackedTab.title,
      groupId: typeof tab.groupId === "number" ? tab.groupId : this.trackedTab.groupId
    };
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
    if (this.trackedTab && this.trackedTab.id === tabId) {
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
