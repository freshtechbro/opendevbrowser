import type { OpenDevBrowserConfig } from "../config";
import { ensureLocalEndpoint } from "../utils/endpoint-validation";

export type RelayEndpointResult = {
  connectEndpoint: string;
  reportedEndpoint: string;
  relayPort: number;
  pairingRequired: boolean;
  instanceId?: string;
  epoch?: number;
};

export async function resolveRelayEndpoint(options: {
  wsEndpoint: string;
  path: string;
  config: OpenDevBrowserConfig;
}): Promise<RelayEndpointResult> {
  const baseUrl = new URL(options.wsEndpoint);
  baseUrl.search = "";
  baseUrl.hash = "";

  const httpProtocol = baseUrl.protocol === "wss:" ? "https:" : "http:";
  const configBase = new URL(`${httpProtocol}//${baseUrl.hostname}:${baseUrl.port}`);
  const configUrl = new URL("/config", configBase);
  ensureLocalEndpoint(configUrl.toString(), options.config.security.allowNonLocalCdp);

  const relayToken = typeof options.config.relayToken === "string" ? options.config.relayToken.trim() : "";
  const headers: Record<string, string> = { Accept: "application/json" };
  if (relayToken) {
    headers.Authorization = `Bearer ${relayToken}`;
  }

  const configResponse = await fetch(configUrl.toString(), { headers });
  if (!configResponse.ok) {
    throw new Error("Failed to fetch relay config. Ensure the relay is running and reachable.");
  }
  const config = await configResponse.json() as {
    relayPort?: number;
    pairingRequired?: boolean;
    instanceId?: string;
    epoch?: number;
  };
  const relayPort = typeof config.relayPort === "number" ? config.relayPort : null;
  if (!relayPort || relayPort <= 0 || relayPort > 65535) {
    throw new Error("Relay config missing relayPort. Ensure the relay is running.");
  }

  const relayWsBase = new URL(`${baseUrl.protocol}//${baseUrl.hostname}:${relayPort}/${options.path}`);
  const reportedEndpoint = sanitizeWsEndpoint(relayWsBase.toString());
  const pairingRequired = Boolean(config.pairingRequired);
  if (!pairingRequired) {
    return {
      connectEndpoint: relayWsBase.toString(),
      reportedEndpoint,
      relayPort,
      pairingRequired,
      instanceId: config.instanceId,
      epoch: config.epoch
    };
  }

  const pairBase = new URL(`${httpProtocol}//${baseUrl.hostname}:${relayPort}`);
  const pairUrl = new URL("/pair", pairBase);
  ensureLocalEndpoint(pairUrl.toString(), options.config.security.allowNonLocalCdp);

  const pairResponse = await fetch(pairUrl.toString(), { headers });
  if (!pairResponse.ok) {
    throw new Error("Failed to fetch relay pairing token. Ensure the relay is running.");
  }
  const pairData = await pairResponse.json() as { token?: string; instanceId?: string; epoch?: number };
  if (config.instanceId && typeof pairData.instanceId === "string" && pairData.instanceId !== config.instanceId) {
    throw new Error("Relay pairing mismatch detected. Restart the plugin and retry.");
  }
  if (!pairData.token || typeof pairData.token !== "string") {
    throw new Error("Relay pairing token missing from /pair response.");
  }

  const connectUrl = new URL(relayWsBase.toString());
  connectUrl.searchParams.set("token", pairData.token);
  return {
    connectEndpoint: connectUrl.toString(),
    reportedEndpoint,
    relayPort,
    pairingRequired,
    instanceId: config.instanceId,
    epoch: config.epoch
  };
}

export function sanitizeWsEndpoint(wsEndpoint: string): string {
  try {
    const url = new URL(wsEndpoint);
    url.searchParams.delete("token");
    url.searchParams.delete("pairingToken");
    url.hash = "";
    return url.toString();
  } catch {
    return wsEndpoint;
  }
}
