import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { readDaemonMetadata, getCacheRoot, writeDaemonMetadata } from "./daemon";
import { CliError, createDisconnectedError, EXIT_EXECUTION } from "./errors";
import { writeFileAtomic } from "../utils/fs";
import { loadGlobalConfig } from "../config";
import { fetchDaemonStatus, type DaemonStatusFetchOptions } from "./daemon-status";
import {
  fetchWithTimeoutContext,
  readResponseJsonWithTimeout,
  readResponseTextWithTimeout,
  type TimedFetchResponse
} from "./utils/http";

const CLIENT_ID_FILE = "client.json";
const DEFAULT_RENEW_AFTER_MS = 20_000;
const MIN_RENEW_AFTER_MS = 5_000;
const TRANSPORT_TIMEOUT_BUFFER_MS = 5_000;
const MAX_DERIVED_TRANSPORT_TIMEOUT_MS = 300_000;
const TRANSPORT_TIMEOUT_HINT_KEYS = ["timeoutMs", "waitTimeoutMs"] as const;
const DAEMON_STATUS_RETRY_OPTIONS: DaemonStatusFetchOptions = {
  retryAttempts: 5,
  retryDelayMs: 250
};

type DaemonResponse<T> = { ok?: boolean; data?: T; error?: string };

type BindingConfig = {
  ttlMs: number;
  renewIntervalMs: number;
  graceMs: number;
  waitMaxMs: number;
};

type BindingResponse = {
  bindingId: string;
  expiresAt: string;
  ttlMs?: number;
  renewAfterMs?: number;
};

type QueueResponse = {
  queued: true;
  position: number;
  waitUntil: string;
  waitMs?: number;
};

type RelayBindResponse = (BindingResponse | QueueResponse) & {
  hubInstanceId?: string;
  relayInstanceId?: string;
  relayPort?: number | null;
  bindingConfig?: BindingConfig;
};

type BindingState = {
  bindingId: string;
  expiresAtMs: number;
  renewAfterMs: number;
};

type CachedBindingState = {
  bindingId: string;
  expiresAt: string;
  renewAfterMs?: number;
};

type CachedClientState = {
  clientId: string;
  createdAt: string;
  binding?: CachedBindingState;
};

type CallOptions = {
  requireBinding?: boolean;
  timeoutMs?: number;
};

let cachedClientState: CachedClientState | null | undefined;

const getClientStateFilePath = (): string => {
  const cacheRoot = getCacheRoot();
  return join(cacheRoot, CLIENT_ID_FILE);
};

const readCachedClientState = (): CachedClientState | null => {
  if (cachedClientState !== undefined) {
    return cachedClientState;
  }

  const filePath = getClientStateFilePath();
  if (existsSync(filePath)) {
    try {
      const content = readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(content) as {
        clientId?: unknown;
        createdAt?: unknown;
        binding?: unknown;
      };
      if (typeof parsed.clientId === "string" && parsed.clientId.trim()) {
        cachedClientState = {
          clientId: parsed.clientId.trim(),
          createdAt: typeof parsed.createdAt === "string" && parsed.createdAt.trim()
            ? parsed.createdAt
            : new Date().toISOString(),
          ...(parsed.binding && typeof parsed.binding === "object"
            ? { binding: parsed.binding as CachedBindingState }
            : {})
        };
        return cachedClientState;
      }
    } catch {
      // fallthrough to regenerate
    }
  }

  cachedClientState = null;
  return cachedClientState;
};

const writeCachedClientState = (state: CachedClientState): void => {
  const filePath = getClientStateFilePath();
  writeFileAtomic(filePath, JSON.stringify(state, null, 2), { mode: 0o600 });
  cachedClientState = state;
};

const loadClientState = (): CachedClientState => {
  const existing = readCachedClientState();
  if (existing) {
    return existing;
  }

  const state = {
    clientId: randomUUID(),
    createdAt: new Date().toISOString()
  };
  writeCachedClientState(state);
  return state;
};

const parseBindingResponse = (data: BindingResponse): BindingState => {
  const expiresAtMs = Date.parse(data.expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    throw new Error("Invalid binding expiry timestamp");
  }
  const renewAfterMs = Math.max(
    MIN_RENEW_AFTER_MS,
    typeof data.renewAfterMs === "number" && Number.isFinite(data.renewAfterMs)
      ? data.renewAfterMs
      : DEFAULT_RENEW_AFTER_MS
  );
  return {
    bindingId: data.bindingId,
    expiresAtMs,
    renewAfterMs
  };
};

const serializeBindingState = (binding: BindingState): CachedBindingState => ({
  bindingId: binding.bindingId,
  expiresAt: new Date(binding.expiresAtMs).toISOString(),
  renewAfterMs: binding.renewAfterMs
});

const updateCachedBindingState = (clientId: string, binding: BindingState | null): void => {
  const current = loadClientState();
  const base: CachedClientState = current.clientId === clientId
    ? current
    : { clientId, createdAt: new Date().toISOString() };
  if (binding) {
    writeCachedClientState({
      ...base,
      binding: serializeBindingState(binding)
    });
    return;
  }
  writeCachedClientState({
    clientId: base.clientId,
    createdAt: base.createdAt
  });
};

const isBindingRequiredError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.startsWith("RELAY_BINDING_REQUIRED") || message.startsWith("RELAY_BINDING_INVALID");
};

const isLeaseInvalidError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.startsWith("RELAY_LEASE_INVALID");
};

const isTransportTimeoutError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.startsWith("Request timed out after ");
};

export class DaemonClient {
  private binding: BindingState | null = null;
  private renewTimer: NodeJS.Timeout | null = null;
  private readonly clientId: string;
  private readonly autoRenew: boolean;
  private bindingAcquiredInProcess = false;
  private sessionLeases = new Map<string, string>();

  constructor(options: { clientId?: string; autoRenew?: boolean } = {}) {
    const cachedState = loadClientState();
    this.clientId = options.clientId ?? cachedState.clientId;
    this.autoRenew = options.autoRenew ?? false;
    if (cachedState.clientId === this.clientId && cachedState.binding) {
      try {
        this.setBinding(parseBindingResponse(cachedState.binding), { acquiredInProcess: false });
      } catch {
        updateCachedBindingState(this.clientId, null);
      }
    }
  }

  async call<T>(name: string, params: Record<string, unknown> = {}, options: CallOptions = {}): Promise<T> {
    try {
      const result = await this.callWithBinding<T>(name, params, options);
      this.maybeTrackLease(name, params, result);
      return result;
    } catch (error) {
      const sessionId = typeof params.sessionId === "string" ? params.sessionId : undefined;
      if (sessionId && !("leaseId" in params) && isLeaseInvalidError(error) && this.sessionLeases.has(sessionId)) {
        this.sessionLeases.delete(sessionId);
        const result = await this.callWithBinding<T>(name, params, options);
        this.maybeTrackLease(name, params, result);
        return result;
      }
      if (!options.requireBinding && isBindingRequiredError(error)) {
        if (this.binding) {
          this.clearBinding();
        }
        await this.ensureBinding();
        const result = await this.callWithBinding<T>(name, params, { ...options, requireBinding: true });
        this.maybeTrackLease(name, params, result);
        return result;
      }
      throw error;
    }
  }

  async releaseBinding(): Promise<void> {
    if (!this.binding) return;
    if (!this.bindingAcquiredInProcess) {
      this.clearBinding({ persist: false });
      return;
    }
    const bindingId = this.binding.bindingId;
    try {
      await this.callRaw("relay.release", { clientId: this.clientId, bindingId });
    } finally {
      this.clearBinding();
    }
  }

  private async callWithBinding<T>(name: string, params: Record<string, unknown>, options: CallOptions): Promise<T> {
    const requireBinding = options.requireBinding ?? false;
    const bindingId = requireBinding ? await this.ensureBinding() : this.binding?.bindingId;
    const sessionId = typeof params.sessionId === "string" ? params.sessionId : undefined;
    const leaseId = sessionId ? this.sessionLeases.get(sessionId) : undefined;
    const payload = {
      ...params,
      clientId: this.clientId,
      ...(bindingId ? { bindingId } : {}),
      ...(leaseId ? { leaseId } : {})
    };
    return await this.callRaw<T>(name, payload, deriveTransportTimeoutMs(params, options.timeoutMs));
  }

  private maybeTrackLease<T>(name: string, params: Record<string, unknown>, result: T): void {
    if (name === "session.disconnect") {
      const sessionId = typeof params.sessionId === "string" ? params.sessionId : undefined;
      if (sessionId) {
        this.sessionLeases.delete(sessionId);
      }
      if (result && typeof result === "object" && (result as Record<string, unknown>).bindingReleased === true) {
        this.clearBinding();
      }
      return;
    }
    if (name !== "session.launch" && name !== "session.connect") return;
    if (!result || typeof result !== "object") return;
    const record = result as Record<string, unknown>;
    const sessionId = record.sessionId;
    const leaseId = record.leaseId;
    if (typeof sessionId === "string" && typeof leaseId === "string") {
      this.sessionLeases.set(sessionId, leaseId);
    }
  }

  private async ensureBinding(): Promise<string> {
    if (this.binding && Date.now() < this.binding.expiresAtMs - MIN_RENEW_AFTER_MS) {
      return this.binding.bindingId;
    }
    const data = await this.callRaw<RelayBindResponse>("relay.bind", { clientId: this.clientId });
    const state = await this.resolveBindingState(data);
    this.setBinding(state, { acquiredInProcess: true });
    return state.bindingId;
  }

  private async resolveBindingState(data: RelayBindResponse): Promise<BindingState> {
    if ("queued" in data && data.queued) {
      const waitMs = typeof data.waitMs === "number" && Number.isFinite(data.waitMs) ? data.waitMs : null;
      const timeoutMs = waitMs ? Math.max(1000, waitMs) : data.bindingConfig?.waitMaxMs;
      const waitResponse = await this.callRaw<RelayBindResponse>("relay.wait", {
        clientId: this.clientId,
        ...(timeoutMs ? { timeoutMs } : {})
      });
      if ("queued" in waitResponse && waitResponse.queued) {
        throw new Error("RELAY_WAIT_TIMEOUT: Timed out waiting for relay binding.");
      }
      return parseBindingResponse(waitResponse as BindingResponse);
    }
    return parseBindingResponse(data as BindingResponse);
  }

  private async renewBinding(): Promise<void> {
    if (!this.binding) return;
    const data = await this.callRaw<BindingResponse>("relay.renew", {
      clientId: this.clientId,
      bindingId: this.binding.bindingId
    });
    this.setBinding(parseBindingResponse(data), { acquiredInProcess: this.bindingAcquiredInProcess });
  }

  private setBinding(state: BindingState, options: { acquiredInProcess?: boolean } = {}): void {
    this.binding = state;
    if (options.acquiredInProcess !== undefined) {
      this.bindingAcquiredInProcess = options.acquiredInProcess;
    }
    updateCachedBindingState(this.clientId, state);
    if (this.autoRenew) {
      this.scheduleRenew(resolveRenewDelayMs(state));
    }
  }

  private scheduleRenew(delayMs: number): void {
    if (!this.autoRenew) return;
    this.clearRenewTimer();
    this.renewTimer = setTimeout(() => {
      this.renewTimer = null;
      this.renewBinding().catch(() => this.clearBinding());
    }, delayMs);
  }

  private clearBinding(options: { persist?: boolean } = {}): void {
    this.binding = null;
    this.bindingAcquiredInProcess = false;
    if (options.persist !== false) {
      updateCachedBindingState(this.clientId, null);
    }
    this.clearRenewTimer();
  }

  private clearRenewTimer(): void {
    if (this.renewTimer) {
      clearTimeout(this.renewTimer);
      this.renewTimer = null;
    }
  }

  private async callRaw<T>(name: string, params: Record<string, unknown>, timeoutMs?: number): Promise<T> {
    const connection = await resolveDaemonConnection();

    let timedResponse: TimedFetchResponse;
    try {
      timedResponse = await openDaemonCommand(connection.port, connection.token, name, params, timeoutMs);
    } catch (error) {
      if (isTransportTimeoutError(error)) {
        throw error;
      }
      timedResponse = await retryWithRefreshedConnection(name, params, timeoutMs);
    }

    try {
      if (!timedResponse.response.ok) {
        const message = await readDaemonErrorMessage(timedResponse);
        if (message.includes("Unauthorized") || timedResponse.response.status === 401) {
          timedResponse.dispose();
          timedResponse = await retryWithRefreshedConnection(name, params, timeoutMs);
          if (!timedResponse.response.ok) {
            throw new CliError(await readDaemonErrorMessage(timedResponse), EXIT_EXECUTION);
          }
        } else {
          throw new CliError(message, EXIT_EXECUTION);
        }
      }

      const payload = await readResponseJsonWithTimeout<DaemonResponse<T>>(
        timedResponse.response,
        timedResponse.signal,
        timedResponse.timeoutMs
      );
      if (!payload.ok) {
        throw new CliError(payload.error || "Daemon command failed.", EXIT_EXECUTION);
      }

      return payload.data as T;
    } finally {
      timedResponse.dispose();
    }
  }
}

const asPositiveNumber = (value: unknown): number | undefined => {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
};

const deriveTransportTimeoutMs = (
  params: Record<string, unknown>,
  explicitTimeoutMs?: number
): number | undefined => {
  const explicit = asPositiveNumber(explicitTimeoutMs);
  if (explicit !== undefined) {
    return explicit;
  }
  for (const key of TRANSPORT_TIMEOUT_HINT_KEYS) {
    const value = asPositiveNumber(params[key]);
    if (value !== undefined) {
      return Math.min(value + TRANSPORT_TIMEOUT_BUFFER_MS, MAX_DERIVED_TRANSPORT_TIMEOUT_MS);
    }
  }
  return undefined;
};

const resolveRenewDelayMs = (binding: BindingState): number => {
  const remainingMs = Math.max(0, binding.expiresAtMs - Date.now() - MIN_RENEW_AFTER_MS);
  return Math.max(0, Math.min(binding.renewAfterMs, remainingMs));
};

const cliClient = new DaemonClient({ autoRenew: false });

export async function callDaemon(command: string, params?: Record<string, unknown>, options?: CallOptions): Promise<unknown> {
  return cliClient.call(command, params ?? {}, options);
}

export const __test__ = {
  deriveTransportTimeoutMs,
  isTransportTimeoutError,
  resetCachedClientState: (): void => {
    cachedClientState = undefined;
  }
};

type DaemonConnection = {
  port: number;
  token: string;
};

const resolveDaemonConnection = async (): Promise<DaemonConnection> => {
  const metadata = readDaemonMetadata();
  if (metadata) {
    return { port: metadata.port, token: metadata.token };
  }

  const config = loadGlobalConfig();
  if (config.daemonPort > 0 && config.daemonToken) {
    const status = await fetchDaemonStatus(config.daemonPort, config.daemonToken, DAEMON_STATUS_RETRY_OPTIONS);
    if (status?.ok) {
      writeDaemonMetadata({
        port: config.daemonPort,
        token: config.daemonToken,
        pid: status.pid,
        relayPort: status.relay.port ?? config.relayPort,
        startedAt: new Date().toISOString(),
        hubInstanceId: status.hub.instanceId,
        relayInstanceId: status.relay.instanceId,
        relayEpoch: status.relay.epoch
      });
      return { port: config.daemonPort, token: config.daemonToken };
    }
  }

  throw createDisconnectedError("Daemon not running. Start with `opendevbrowser serve`.");
};

const retryWithRefreshedConnection = async (
  name: string,
  params: Record<string, unknown>,
  timeoutMs?: number
): Promise<TimedFetchResponse> => {
  const config = loadGlobalConfig();
  if (config.daemonPort <= 0 || !config.daemonToken) {
    throw createDisconnectedError("Daemon not running. Start with `opendevbrowser serve`.");
  }
  const status = await fetchDaemonStatus(config.daemonPort, config.daemonToken, DAEMON_STATUS_RETRY_OPTIONS);
  if (status?.ok) {
    writeDaemonMetadata({
      port: config.daemonPort,
      token: config.daemonToken,
      pid: status.pid,
      relayPort: status.relay.port ?? config.relayPort,
      startedAt: new Date().toISOString(),
      hubInstanceId: status.hub.instanceId,
      relayInstanceId: status.relay.instanceId,
      relayEpoch: status.relay.epoch
    });
    return await openDaemonCommand(config.daemonPort, config.daemonToken, name, params, timeoutMs);
  }
  throw createDisconnectedError("Daemon not running. Start with `opendevbrowser serve`.");
};

const openDaemonCommand = async (
  port: number,
  token: string,
  name: string,
  params: Record<string, unknown>,
  timeoutMs?: number
): Promise<TimedFetchResponse> => {
  return await fetchWithTimeoutContext(`http://127.0.0.1:${port}/command`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ name, params })
  }, timeoutMs);
};

const readDaemonErrorMessage = async (timedResponse: TimedFetchResponse): Promise<string> => {
  const text = await readResponseTextWithTimeout(
    timedResponse.response,
    timedResponse.signal,
    timedResponse.timeoutMs
  );
  let message = text || String(timedResponse.response.status);
  try {
    const parsed = JSON.parse(text) as Record<string, unknown> | null;
    if (parsed && typeof parsed === "object") {
      if (typeof parsed.error === "string" && parsed.error.trim()) {
        message = parsed.error;
      } else if (typeof parsed.message === "string" && parsed.message.trim()) {
        message = parsed.message;
      }
    }
  } catch {
    // Ignore JSON parse errors; fall back to raw text/status.
  }
  return message;
};
