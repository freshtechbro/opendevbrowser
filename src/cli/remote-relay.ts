import type { RelayLike } from "../relay/relay-types";
import type { RelayStatus } from "../relay/relay-server";
import { DaemonClient } from "./daemon-client";

const emptyStatus: RelayStatus = {
  running: false,
  extensionConnected: false,
  extensionHandshakeComplete: false,
  cdpConnected: false,
  annotationConnected: false,
  opsConnected: false,
  pairingRequired: false,
  instanceId: "",
  epoch: 0,
  health: {
    ok: false,
    reason: "relay_down",
    extensionConnected: false,
    extensionHandshakeComplete: false,
    cdpConnected: false,
    annotationConnected: false,
    opsConnected: false,
    pairingRequired: false
  }
};

export class RemoteRelay implements RelayLike {
  private client: DaemonClient;
  private lastStatus: RelayStatus = emptyStatus;
  private lastCdpUrl: string | null = null;
  private lastAnnotationUrl: string | null = null;
  private lastOpsUrl: string | null = null;

  constructor(client: DaemonClient) {
    this.client = client;
  }

  async refresh(): Promise<void> {
    try {
      const status = await this.client.call<RelayStatus>("relay.status");
      this.lastStatus = status;
      const cdpUrl = await this.client.call<string | null>("relay.cdpUrl");
      this.lastCdpUrl = typeof cdpUrl === "string" ? cdpUrl : null;
      const annotationUrl = await this.client.call<string | null>("relay.annotationUrl");
      this.lastAnnotationUrl = typeof annotationUrl === "string" ? annotationUrl : null;
      const opsUrl = await this.client.call<string | null>("relay.opsUrl");
      this.lastOpsUrl = typeof opsUrl === "string" ? opsUrl : null;
    } catch {
      this.lastStatus = emptyStatus;
      this.lastCdpUrl = null;
      this.lastAnnotationUrl = null;
      this.lastOpsUrl = null;
    }
  }

  status(): RelayStatus {
    return this.lastStatus;
  }

  getCdpUrl(): string | null {
    return this.lastCdpUrl;
  }

  getAnnotationUrl(): string | null {
    return this.lastAnnotationUrl;
  }

  getOpsUrl(): string | null {
    return this.lastOpsUrl;
  }
}
