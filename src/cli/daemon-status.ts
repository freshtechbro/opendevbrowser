import type { RelayStatus } from "../relay/relay-server";
import type { OpenDevBrowserConfig } from "../config";
import { loadGlobalConfig } from "../config";
import {
  readDaemonMetadata,
  isCurrentDaemonFingerprint,
  resolveDaemonFingerprint,
  writeDaemonMetadata,
  type DaemonState
} from "./daemon";
import { fetchWithTimeoutContext, readResponseJsonWithTimeout } from "./utils/http";
import { DEFAULT_DAEMON_STATUS_FETCH_OPTIONS } from "./daemon-status-policy";

export type DaemonStatusPayload = {
  ok: true;
  pid: number;
  fingerprint?: string;
  fingerprintCurrent?: boolean;
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

const DEFAULT_DAEMON_STATUS_TIMEOUT_MS = DEFAULT_DAEMON_STATUS_FETCH_OPTIONS.timeoutMs;

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

const resolveStatusTimeoutMs = (timeoutMs?: number): number => {
  return typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : DEFAULT_DAEMON_STATUS_TIMEOUT_MS;
};

const withFingerprintCurrent = (status: DaemonStatusPayload): DaemonStatusPayload => ({
  ...status,
  fingerprintCurrent: isCurrentDaemonFingerprint(status.fingerprint)
});

const readRemainingBudgetMs = (deadlineMs: number): number => {
  return Math.max(0, deadlineMs - Date.now());
};

const readSeedTimeoutMs = (remainingBudgetMs: number, remainingSeedCount: number): number => {
  if (remainingSeedCount <= 1) {
    return remainingBudgetMs;
  }
  return Math.max(1, Math.floor(remainingBudgetMs / remainingSeedCount));
};

const resolveDaemonStatusSeeds = (
  metadata: DaemonState | null,
  config: OpenDevBrowserConfig
): DaemonMetadataSeed[] => {
  const seeds: DaemonMetadataSeed[] = [];
  const seen = new Set<string>();
  const addSeed = (seed: DaemonMetadataSeed | null): void => {
    if (!seed) {
      return;
    }
    const key = `${seed.port}:${seed.token}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    seeds.push(seed);
  };

  addSeed(
    config.daemonPort > 0 && config.daemonToken
      ? {
          port: config.daemonPort,
          token: config.daemonToken,
          relayPort: config.relayPort
        }
      : null
  );
  addSeed(metadata);
  return seeds;
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
      const timedResponse = await fetchWithTimeoutContext(`http://127.0.0.1:${port}/status`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` }
      }, options.timeoutMs);
      try {
        if (timedResponse.response.ok) {
          const status = await readResponseJsonWithTimeout<DaemonStatusPayload>(
            timedResponse.response,
            timedResponse.signal,
            timedResponse.timeoutMs
          );
          return withFingerprintCurrent(status);
        }
      } finally {
        timedResponse.dispose();
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
  const deadlineMs = Date.now() + resolveStatusTimeoutMs(options.timeoutMs);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const metadata = readDaemonMetadata();
    const seeds = resolveDaemonStatusSeeds(metadata, resolvedConfig);
    for (let seedIndex = 0; seedIndex < seeds.length; seedIndex += 1) {
      const seed = seeds[seedIndex];
      if (!seed) {
        continue;
      }
      const remainingBudgetMs = readRemainingBudgetMs(deadlineMs);
      if (remainingBudgetMs <= 0) {
        return null;
      }
      const timeoutMs = readSeedTimeoutMs(remainingBudgetMs, seeds.length - seedIndex);
      const status = await fetchDaemonStatus(seed.port, seed.token, {
        timeoutMs
      });
      if (status?.ok) {
        persistDaemonStatusMetadata(seed, status, resolvedConfig);
        return status;
      }
    }

    if (attempt < attempts) {
      const remainingBudgetMs = readRemainingBudgetMs(deadlineMs);
      if (remainingBudgetMs <= 0) {
        break;
      }
      await sleep(Math.min(retryDelayMs, remainingBudgetMs));
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
