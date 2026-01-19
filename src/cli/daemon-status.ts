import type { RelayStatus } from "../relay/relay-server";
import type { OpenDevBrowserConfig } from "../config";
import { loadGlobalConfig } from "../config";
import { readDaemonMetadata, writeDaemonMetadata, type DaemonState } from "./daemon";

export type DaemonStatusPayload = {
  ok: true;
  pid: number;
  hub: { instanceId: string };
  relay: RelayStatus;
  binding: {
    bindingId: string;
    clientId: string;
    expiresAt: string;
    expiresInMs: number;
  } | null;
};

export async function fetchDaemonStatus(port: number, token: string): Promise<DaemonStatusPayload | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/status`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) return null;
    return await response.json() as DaemonStatusPayload;
  } catch {
    return null;
  }
}

export async function fetchDaemonStatusFromMetadata(config?: OpenDevBrowserConfig): Promise<DaemonStatusPayload | null> {
  const metadata = readDaemonMetadata();
  if (metadata) {
    const status = await fetchDaemonStatus(metadata.port, metadata.token);
    if (status?.ok) {
      persistDaemonMetadata(metadata, status, config);
      return status;
    }
  }

  const resolvedConfig = config ?? loadGlobalConfig();
  if (resolvedConfig.daemonPort > 0 && resolvedConfig.daemonToken) {
    const status = await fetchDaemonStatus(resolvedConfig.daemonPort, resolvedConfig.daemonToken);
    if (status?.ok) {
      persistDaemonMetadata({
        port: resolvedConfig.daemonPort,
        token: resolvedConfig.daemonToken,
        pid: status.pid,
        relayPort: status.relay.port ?? resolvedConfig.relayPort,
        startedAt: new Date().toISOString()
      }, status, resolvedConfig);
      return status;
    }
  }
  return null;
}

function persistDaemonMetadata(
  base: DaemonState,
  status: DaemonStatusPayload,
  config?: OpenDevBrowserConfig
): void {
  const resolvedConfig = config ?? loadGlobalConfig();
  writeDaemonMetadata({
    port: base.port,
    token: base.token,
    pid: status.pid,
    relayPort: status.relay.port ?? resolvedConfig.relayPort,
    startedAt: base.startedAt ?? new Date().toISOString(),
    hubInstanceId: status.hub.instanceId,
    relayInstanceId: status.relay.instanceId,
    relayEpoch: status.relay.epoch
  });
}
