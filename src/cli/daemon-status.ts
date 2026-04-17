import type { RelayStatus } from "../relay/relay-server";
import type { OpenDevBrowserConfig } from "../config";
import { loadGlobalConfig } from "../config";
import {
  readDaemonMetadata,
  resolveDaemonFingerprint,
  writeDaemonMetadata,
  type DaemonState
} from "./daemon";
import { fetchWithTimeout } from "./utils/http";

export type DaemonStatusPayload = {
  ok: true;
  pid: number;
  fingerprint?: string;
  hub: { instanceId: string };
  relay: RelayStatus;
  binding: {
    bindingId: string;
    clientId: string;
    expiresAt: string;
    expiresInMs: number;
  } | null;
};

export type DaemonStatusFetchOptions = {
  timeoutMs?: number;
  retryAttempts?: number;
  retryDelayMs?: number;
};

type DaemonMetadataSeed = Pick<DaemonState, "port" | "token">
  & Partial<Omit<DaemonState, "port" | "token">>;

const sleep = async (delayMs: number): Promise<void> => {
  if (!(Number.isFinite(delayMs) && delayMs > 0)) {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, delayMs));
};

const resolveRetryAttempts = (retryAttempts?: number): number => {
  return typeof retryAttempts === "number" && Number.isFinite(retryAttempts) && retryAttempts > 1
    ? Math.floor(retryAttempts)
    : 1;
};

const resolveRetryDelayMs = (retryDelayMs?: number): number => {
  return typeof retryDelayMs === "number" && Number.isFinite(retryDelayMs) && retryDelayMs > 0
    ? retryDelayMs
    : 0;
};

export async function fetchDaemonStatus(
  port: number,
  token: string,
  options: DaemonStatusFetchOptions = {}
): Promise<DaemonStatusPayload | null> {
  const attempts = resolveRetryAttempts(options.retryAttempts);
  const retryDelayMs = resolveRetryDelayMs(options.retryDelayMs);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchWithTimeout(`http://127.0.0.1:${port}/status`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` }
      }, options.timeoutMs);
      if (response.ok) {
        return await response.json() as DaemonStatusPayload;
      }
    } catch {
      // retry below when configured
    }
    if (attempt < attempts) {
      await sleep(retryDelayMs);
    }
  }

  return null;
}

export async function fetchDaemonStatusFromMetadata(
  config?: OpenDevBrowserConfig,
  options: DaemonStatusFetchOptions = {}
): Promise<DaemonStatusPayload | null> {
  const resolvedConfig = config ?? loadGlobalConfig();
  const attempts = resolveRetryAttempts(options.retryAttempts);
  const retryDelayMs = resolveRetryDelayMs(options.retryDelayMs);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const metadata = readDaemonMetadata();
    if (metadata) {
      const status = await fetchDaemonStatus(metadata.port, metadata.token, { timeoutMs: options.timeoutMs });
      if (status?.ok) {
        persistDaemonStatusMetadata(metadata, status, resolvedConfig);
        return status;
      }
    }

    if (resolvedConfig.daemonPort > 0 && resolvedConfig.daemonToken) {
      const status = await fetchDaemonStatus(resolvedConfig.daemonPort, resolvedConfig.daemonToken, {
        timeoutMs: options.timeoutMs
      });
      if (status?.ok) {
        persistDaemonStatusMetadata({
          port: resolvedConfig.daemonPort,
          token: resolvedConfig.daemonToken,
          pid: status.pid,
          relayPort: status.relay.port ?? resolvedConfig.relayPort,
          startedAt: new Date().toISOString()
        }, status, resolvedConfig);
        return status;
      }
    }

    if (attempt < attempts) {
      await sleep(retryDelayMs);
    }
  }

  return null;
}

export function persistDaemonStatusMetadata(
  base: DaemonMetadataSeed,
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
    fingerprint: resolveDaemonFingerprint(status.fingerprint, base.fingerprint),
    hubInstanceId: status.hub.instanceId,
    relayInstanceId: status.relay.instanceId,
    relayEpoch: status.relay.epoch
  });
}
