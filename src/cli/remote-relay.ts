import type { RelayLike } from "../relay/relay-types";
import type { RelayStatus } from "../relay/relay-server";
import { DaemonClient } from "./daemon-client";

const emptyStatus: RelayStatus = {
  running: false,
  extensionConnected: false,
  extensionHandshakeComplete: false,
  cdpConnected: false,
  pairingRequired: false,
  instanceId: "",
  epoch: 0
};

export class RemoteRelay implements RelayLike {
  private client: DaemonClient;
  private lastStatus: RelayStatus = emptyStatus;
  private lastCdpUrl: string | null = null;

  constructor(client: DaemonClient) {
    this.client = client;
  }

  async refresh(): Promise<void> {
    try {
      const status = await this.client.call<RelayStatus>("relay.status");
      this.lastStatus = status;
      const cdpUrl = await this.client.call<string | null>("relay.cdpUrl");
      this.lastCdpUrl = typeof cdpUrl === "string" ? cdpUrl : null;
    } catch {
      this.lastStatus = emptyStatus;
      this.lastCdpUrl = null;
    }
  }

  status(): RelayStatus {
    return this.lastStatus;
  }

  getCdpUrl(): string | null {
    return this.lastCdpUrl;
  }
}
