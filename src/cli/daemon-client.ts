import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";
import {
  DAEMON_STOP_DEBUG_ENV,
  createDaemonStopHeaders,
  getCacheRoot,
  isCurrentDaemonFingerprint,
  readDaemonMetadata,
  resolveCurrentDaemonEntrypointPath
} from "./daemon";
import { CliError, createDisconnectedError, EXIT_EXECUTION } from "./errors";
import { writeFileAtomic } from "../utils/fs";
import { loadGlobalConfig } from "../config";
import {
  fetchDaemonStatus,
  persistDaemonStatusMetadata,
  type DaemonStatusFetchOptions,
  type DaemonStatusPayload
} from "./daemon-status";
import {
  fetchWithTimeout,
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
const DAEMON_CONFIG_PREFER_OPTIONS: DaemonStatusFetchOptions = {
  timeoutMs: 500,
  retryAttempts: 3,
  retryDelayMs: 250
};
const DAEMON_RESTART_STATUS_TIMEOUT_MS = 5_000;
const DAEMON_RECOVERY_READY_TIMEOUT_MS = 5_000;
const DAEMON_RESTART_READY_TIMEOUT_MS = 15_000;
const DAEMON_RESTART_POLL_DELAY_MS = 250;

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

const logDaemonStopDebug = (message: string, details?: Record<string, unknown>): void => {
  if (process.env[DAEMON_STOP_DEBUG_ENV] !== "1") {
    return;
  }
  const suffix = details ? ` ${JSON.stringify(details)}` : "";
  console.error(`[daemon-stop-debug] ${message}${suffix}`);
};

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
      if (isBindingRequiredError(error)) {
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
    const budget = createTimeoutBudget(timeoutMs);
    const connection = await resolveDaemonConnection(budget, {
      preferConfiguredRecovery: requiresConfiguredRecovery(name)
    });

    let timedResponse: TimedFetchResponse;
    try {
      timedResponse = await openDaemonCommand(
        connection.port,
        connection.token,
        name,
        params,
        readRemainingBudgetMs(budget)
      );
    } catch (error) {
      if (isTransportTimeoutError(error)) {
        throw error;
      }
      timedResponse = await retryWithRefreshedConnection(name, params, budget);
    }

    try {
      if (!timedResponse.response.ok) {
        const message = await readDaemonErrorMessage(timedResponse);
        if (message.includes("Unauthorized") || timedResponse.response.status === 401) {
          timedResponse.dispose();
          timedResponse = await retryWithRefreshedConnection(name, params, budget);
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

const createTransportTimeoutError = (timeoutMs: number): Error => {
  return new Error(`Request timed out after ${timeoutMs}ms`);
};

const createTimeoutBudget = (timeoutMs?: number): TimeoutBudget | null => {
  const resolved = asPositiveNumber(timeoutMs);
  return resolved === undefined
    ? null
    : { timeoutMs: resolved, deadlineMs: Date.now() + resolved };
};

const readRemainingBudgetMs = (budget: TimeoutBudget | null): number | undefined => {
  if (!budget) {
    return undefined;
  }
  const remainingMs = budget.deadlineMs - Date.now();
  if (remainingMs <= 0) {
    throw createTransportTimeoutError(budget.timeoutMs);
  }
  return remainingMs;
};

const capTimeoutToBudget = (
  timeoutMs: number,
  budget: TimeoutBudget | null
): number => {
  const remainingMs = readRemainingBudgetMs(budget);
  return remainingMs === undefined
    ? timeoutMs
    : Math.max(1, Math.min(timeoutMs, remainingMs));
};

const resolveReadyDeadlineMs = (
  readyTimeoutMs: number,
  budget: TimeoutBudget | null
): number => {
  const localDeadlineMs = Date.now() + readyTimeoutMs;
  return budget ? Math.min(localDeadlineMs, budget.deadlineMs) : localDeadlineMs;
};

const hasBudgetTimedOut = (
  budget: TimeoutBudget | null,
  deadlineMs: number
): boolean => {
  if (!budget) {
    return false;
  }
  return deadlineMs >= budget.deadlineMs && Date.now() >= budget.deadlineMs;
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
  resolveDaemonRestartCommand,
  resetCachedClientState: (): void => {
    cachedClientState = undefined;
  }
};

type DaemonConnection = {
  port: number;
  token: string;
};

type DaemonRestartCommand = {
  command: string;
  args: string[];
};

type TimeoutBudget = {
  timeoutMs: number;
  deadlineMs: number;
};

type ResolveDaemonConnectionOptions = {
  preferConfiguredRecovery?: boolean;
};

type ResolveDaemonRestartCommandOptions = {
  argv1?: string;
  execPath?: string;
  execArgv?: string[];
  moduleUrl?: string;
  entryExists?: (path: string) => boolean;
};

const TYPESCRIPT_ENTRY_RE = /\.[cm]?ts$/i;
const RESTART_LOADER_ARG_FLAGS = new Set(["--experimental-loader", "--import", "--loader", "--require", "-r"]);
const RESTART_TYPESCRIPT_CONTEXT_ARG_FLAGS = new Set(["--experimental-strip-types", "--experimental-transform-types"]);
const RESTART_DEBUG_ARG_FLAGS = new Set(["--inspect", "--inspect-brk", "--inspect-port", "--debug", "--debug-brk"]);

const isInlineRestartArg = (arg: string, flags: Set<string>): boolean => {
  for (const flag of flags) {
    if (arg.startsWith(`${flag}=`)) {
      return true;
    }
  }
  return false;
};

const isRestartLoaderArg = (arg: string): boolean => {
  return RESTART_LOADER_ARG_FLAGS.has(arg) || isInlineRestartArg(arg, RESTART_LOADER_ARG_FLAGS);
};

const isRestartTypeScriptContextArg = (arg: string): boolean => {
  return RESTART_TYPESCRIPT_CONTEXT_ARG_FLAGS.has(arg)
    || isInlineRestartArg(arg, RESTART_TYPESCRIPT_CONTEXT_ARG_FLAGS);
};

const isRestartDebugArg = (arg: string): boolean => {
  return RESTART_DEBUG_ARG_FLAGS.has(arg) || isInlineRestartArg(arg, RESTART_DEBUG_ARG_FLAGS);
};

const resolveRestartSplitArgValue = (
  arg: string,
  value: string | undefined
): string | null => {
  if (arg.includes("=")) return null;
  if (typeof value !== "string") return null;
  return value.startsWith("-") ? null : value;
};

const resolveRestartExecArgv = (entryPath: string, execArgv: string[]): string[] => {
  const preserved: string[] = [];
  let hasLoaderContext = false;
  for (let index = 0; index < execArgv.length; index += 1) {
    const arg = execArgv[index];
    if (!arg) {
      continue;
    }
    if (isRestartDebugArg(arg)) {
      const next = resolveRestartSplitArgValue(arg, execArgv[index + 1]);
      if (RESTART_DEBUG_ARG_FLAGS.has(arg) && next) {
        index += 1;
      }
      continue;
    }
    preserved.push(arg);
    if (isRestartLoaderArg(arg) || isRestartTypeScriptContextArg(arg)) {
      hasLoaderContext = true;
    }
    const value = resolveRestartSplitArgValue(arg, execArgv[index + 1]);
    if (!value) continue;
    preserved.push(value);
    index += 1;
  }
  return TYPESCRIPT_ENTRY_RE.test(entryPath) && !hasLoaderContext ? [] : preserved;
};

const fetchCurrentDaemonStatus = async (
  connection: DaemonConnection,
  options: DaemonStatusFetchOptions,
  budget: TimeoutBudget | null = null
): Promise<DaemonStatusPayload | null> => {
  const attempts = typeof options.retryAttempts === "number" && Number.isFinite(options.retryAttempts) && options.retryAttempts > 1
    ? Math.floor(options.retryAttempts)
    : 1;
  const retryDelayMs = typeof options.retryDelayMs === "number" && Number.isFinite(options.retryDelayMs) && options.retryDelayMs > 0
    ? options.retryDelayMs
    : 0;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const status = await fetchDaemonStatus(connection.port, connection.token, {
      timeoutMs: capTimeoutToBudget(options.timeoutMs ?? DAEMON_RESTART_STATUS_TIMEOUT_MS, budget)
    });
    if (status?.ok && isCurrentDaemonFingerprint(status.fingerprint)) {
      return status;
    }
    if (attempt < attempts) {
      await sleep(Math.min(retryDelayMs, readRemainingBudgetMs(budget) ?? retryDelayMs));
    }
  }

  return null;
};

const fetchAnyDaemonStatus = async (
  connection: DaemonConnection,
  options: DaemonStatusFetchOptions,
  budget: TimeoutBudget | null = null
): Promise<DaemonStatusPayload | null> => {
  const attempts = typeof options.retryAttempts === "number" && Number.isFinite(options.retryAttempts) && options.retryAttempts > 1
    ? Math.floor(options.retryAttempts)
    : 1;
  const retryDelayMs = typeof options.retryDelayMs === "number" && Number.isFinite(options.retryDelayMs) && options.retryDelayMs > 0
    ? options.retryDelayMs
    : 0;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const status = await fetchDaemonStatus(connection.port, connection.token, {
      timeoutMs: capTimeoutToBudget(options.timeoutMs ?? DAEMON_RESTART_STATUS_TIMEOUT_MS, budget)
    });
    if (status?.ok) {
      return status;
    }
    if (attempt < attempts) {
      await sleep(Math.min(retryDelayMs, readRemainingBudgetMs(budget) ?? retryDelayMs));
    }
  }

  return null;
};

const sleep = async (delayMs: number): Promise<void> => {
  if (!(Number.isFinite(delayMs) && delayMs > 0)) {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, delayMs));
};

const requiresConfiguredRecovery = (name: string): boolean => {
  return name === "canvas.execute";
};

const getConfiguredDaemonConnection = (): DaemonConnection | null => {
  const config = loadGlobalConfig();
  if (!(config.daemonPort > 0 && config.daemonToken)) {
    return null;
  }
  return { port: config.daemonPort, token: config.daemonToken };
};

const sameDaemonConnection = (left: DaemonConnection, right: DaemonConnection): boolean => {
  return left.port === right.port && left.token === right.token;
};

const persistResolvedDaemonStatus = (
  connection: DaemonConnection,
  status: DaemonStatusPayload
): void => {
  const config = loadGlobalConfig();
  persistDaemonStatusMetadata({
    port: connection.port,
    token: connection.token,
    startedAt: new Date().toISOString(),
    fingerprint: status.fingerprint
  }, status, config);
};

const persistCurrentConfiguredConnection = async (
  configuredConnection: DaemonConnection,
  status: DaemonStatusPayload,
  staleMetadata: { connection: DaemonConnection } | null
): Promise<DaemonConnection> => {
  if (staleMetadata && !sameDaemonConnection(staleMetadata.connection, configuredConnection)) {
    // Once the configured daemon has proven current, stale metadata cleanup must not block the caller.
    void stopDaemonConnection(staleMetadata.connection, null, "persistCurrentConfiguredConnection.staleMetadata").catch(() => undefined);
  }
  persistResolvedDaemonStatus(configuredConnection, status);
  return configuredConnection;
};

type DaemonShutdownOutcome = "stopped" | DaemonStatusPayload;
type DaemonStopOutcome = "stopped" | "fingerprint_rejected" | "unreachable";

const resolveConfiguredPreferenceOptions = (
  budget: TimeoutBudget | null
): DaemonStatusFetchOptions | null => {
  if (!budget) {
    return DAEMON_CONFIG_PREFER_OPTIONS;
  }
  const remainingMs = readRemainingBudgetMs(budget);
  if (remainingMs === undefined || remainingMs <= 1) {
    return null;
  }
  const timeoutMs = Math.min(DAEMON_CONFIG_PREFER_OPTIONS.timeoutMs ?? remainingMs, remainingMs);
  const retryDelayMs = Math.max(0, DAEMON_CONFIG_PREFER_OPTIONS.retryDelayMs ?? 0);
  const maxAttempts = Math.max(1, DAEMON_CONFIG_PREFER_OPTIONS.retryAttempts ?? 1);
  let retryAttempts = 1;
  while (retryAttempts < maxAttempts) {
    const nextAttempts = retryAttempts + 1;
    const nextWorstCaseMs = (nextAttempts * timeoutMs) + ((nextAttempts - 1) * retryDelayMs);
    if (nextWorstCaseMs > remainingMs) {
      break;
    }
    retryAttempts = nextAttempts;
  }
  return {
    timeoutMs,
    retryAttempts,
    retryDelayMs: retryAttempts > 1 ? retryDelayMs : 0
  };
};

const stopDaemonConnection = async (
  connection: DaemonConnection,
  budget: TimeoutBudget | null = null,
  reason = "unknown"
): Promise<DaemonStopOutcome> => {
  const stopTimeoutMs = capTimeoutToBudget(DAEMON_RESTART_STATUS_TIMEOUT_MS, budget);
  logDaemonStopDebug("client.stop.request", { reason, port: connection.port });
  try {
    const response = await fetchWithTimeout(`http://127.0.0.1:${connection.port}/stop`, {
      method: "POST",
      headers: createDaemonStopHeaders(connection.token, reason)
    }, stopTimeoutMs);
    if (response.status === 409) {
      logDaemonStopDebug("client.stop.fingerprintRejected", { reason, port: connection.port });
      return "fingerprint_rejected";
    }
    if (!response.ok) {
      logDaemonStopDebug("client.stop.rejected", { reason, port: connection.port, status: response.status });
      return "unreachable";
    }
    logDaemonStopDebug("client.stop.complete", { reason, port: connection.port });
    return "stopped";
  } catch {
    logDaemonStopDebug("client.stop.error", { reason, port: connection.port });
    return "unreachable";
  }
};

function resolveDaemonRestartCommand(
  options: ResolveDaemonRestartCommandOptions = {}
): DaemonRestartCommand {
  const execPath = options.execPath ?? process.execPath;
  const execArgv = options.execArgv ?? process.execArgv;
  const moduleUrl = options.moduleUrl ?? import.meta.url;
  const argv1 = options.argv1 ?? process.argv[1];
  const entryPath = resolveCurrentDaemonEntrypointPath({
    argv1,
    moduleUrl,
    entryExists: options.entryExists ?? existsSync
  });
  if (!(typeof argv1 === "string" && argv1.trim().length > 0)) {
    const modulePath = resolve(fileURLToPath(moduleUrl));
    if (entryPath === modulePath) {
      throw createDisconnectedError("Daemon restart requires a stable CLI entrypoint. Start with `opendevbrowser serve`.");
    }
  }
  const restartExecArgv = resolveRestartExecArgv(entryPath, execArgv);
  if (TYPESCRIPT_ENTRY_RE.test(entryPath) && restartExecArgv.length === 0) {
    throw createDisconnectedError("Daemon restart requires the original loader context. Start with `opendevbrowser serve`.");
  }
  return {
    command: execPath,
    args: [...restartExecArgv, entryPath]
  };
}

const restartDaemonConnection = async (connection: DaemonConnection): Promise<void> => {
  const restart = resolveDaemonRestartCommand();
  const child = spawn(restart.command, [
    ...restart.args,
    "serve",
    "--port",
    String(connection.port),
    "--token",
    connection.token,
    "--output-format",
    "json"
  ], {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
};

const waitForCurrentDaemonStatus = async (
  connection: DaemonConnection,
  readyTimeoutMs = DAEMON_RESTART_READY_TIMEOUT_MS,
  budget: TimeoutBudget | null = null
): Promise<DaemonStatusPayload | null> => {
  const deadline = resolveReadyDeadlineMs(readyTimeoutMs, budget);
  while (true) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      if (hasBudgetTimedOut(budget, deadline)) {
        throw createTransportTimeoutError(budget!.timeoutMs);
      }
      return null;
    }
    const status = await fetchDaemonStatus(connection.port, connection.token, {
      timeoutMs: Math.min(DAEMON_RESTART_STATUS_TIMEOUT_MS, remainingMs)
    });
    if (status?.ok && isCurrentDaemonFingerprint(status.fingerprint)) {
      return status;
    }
    if (Date.now() >= deadline) {
      return null;
    }
    await sleep(Math.min(DAEMON_RESTART_POLL_DELAY_MS, Math.max(0, deadline - Date.now())));
  }
};

const waitForDaemonShutdown = async (
  connection: DaemonConnection,
  readyTimeoutMs = DAEMON_RECOVERY_READY_TIMEOUT_MS,
  budget: TimeoutBudget | null = null
): Promise<DaemonShutdownOutcome | null> => {
  const deadline = resolveReadyDeadlineMs(readyTimeoutMs, budget);
  while (true) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      if (hasBudgetTimedOut(budget, deadline)) {
        throw createTransportTimeoutError(budget!.timeoutMs);
      }
      return null;
    }
    const status = await fetchDaemonStatus(connection.port, connection.token, {
      timeoutMs: Math.min(DAEMON_RESTART_STATUS_TIMEOUT_MS, remainingMs)
    });
    if (!status?.ok) {
      return "stopped";
    }
    if (isCurrentDaemonFingerprint(status.fingerprint)) {
      return status;
    }
    if (Date.now() >= deadline) {
      return null;
    }
    await sleep(Math.min(DAEMON_RESTART_POLL_DELAY_MS, Math.max(0, deadline - Date.now())));
  }
};

const resolveMetadataConnection = async (
  metadataConnection: DaemonConnection,
  configuredConnection: DaemonConnection,
  budget: TimeoutBudget | null = null
): Promise<{ connection: DaemonConnection; status: DaemonStatusPayload } | null> => {
  const status = await fetchAnyDaemonStatus(metadataConnection, DAEMON_STATUS_RETRY_OPTIONS, budget);
  if (!status?.ok) {
    return null;
  }
  if (isCurrentDaemonFingerprint(status.fingerprint)) {
    persistResolvedDaemonStatus(metadataConnection, status);
    return { connection: metadataConnection, status };
  }
  if (sameDaemonConnection(metadataConnection, configuredConnection)) {
    return null;
  }
  return { connection: metadataConnection, status };
};

const resolveFreshDaemonConnection = async (
  budget: TimeoutBudget | null = null,
  options: ResolveDaemonConnectionOptions = {}
): Promise<DaemonConnection> => {
  const configuredConnection = getConfiguredDaemonConnection();
  if (!configuredConnection) {
    throw createDisconnectedError("Daemon not running. Start with `opendevbrowser serve`.");
  }

  const configuredStatus = await fetchAnyDaemonStatus(configuredConnection, DAEMON_STATUS_RETRY_OPTIONS, budget);

  let currentConfiguredStatus =
    configuredStatus?.ok && isCurrentDaemonFingerprint(configuredStatus.fingerprint)
      ? configuredStatus
      : null;

  const metadata = readDaemonMetadata();
  const metadataConnection = metadata
    ? { port: metadata.port, token: metadata.token }
    : null;
  const staleMetadata = metadataConnection
    ? await resolveMetadataConnection(metadataConnection, configuredConnection, budget)
    : null;
  if (currentConfiguredStatus?.ok) {
    return await persistCurrentConfiguredConnection(configuredConnection, currentConfiguredStatus, staleMetadata);
  }
  if (options.preferConfiguredRecovery && staleMetadata) {
    currentConfiguredStatus = await waitForCurrentDaemonStatus(
      configuredConnection,
      DAEMON_RECOVERY_READY_TIMEOUT_MS,
      budget
    );
    if (currentConfiguredStatus?.ok) {
      return await persistCurrentConfiguredConnection(configuredConnection, currentConfiguredStatus, staleMetadata);
    }
    if (!configuredStatus?.ok) {
      throw createDisconnectedError("Daemon not running. Start with `opendevbrowser serve`.");
    }
  }
  if (
    !options.preferConfiguredRecovery
    && staleMetadata?.status.ok
    && isCurrentDaemonFingerprint(staleMetadata.status.fingerprint)
  ) {
    if (configuredStatus?.ok) {
      void stopDaemonConnection(configuredConnection, budget, "resolveFreshDaemonConnection.configuredCurrentMetadataPreferred").catch(() => undefined);
    }
    return staleMetadata.connection;
  }
  if (!configuredStatus?.ok && staleMetadata) {
    currentConfiguredStatus = await waitForCurrentDaemonStatus(
      configuredConnection,
      DAEMON_RECOVERY_READY_TIMEOUT_MS,
      budget
    );
    if (currentConfiguredStatus?.ok) {
      return await persistCurrentConfiguredConnection(configuredConnection, currentConfiguredStatus, staleMetadata);
    }
    throw createDisconnectedError("Daemon not running. Start with `opendevbrowser serve`.");
  }

  const staleConnections: Array<{ connection: DaemonConnection; status: DaemonStatusPayload }> = [];
  if (configuredStatus?.ok) {
    staleConnections.push({ connection: configuredConnection, status: configuredStatus });
  }
  if (staleConnections.length === 0) {
    const recoveringStatus = await waitForCurrentDaemonStatus(
      configuredConnection,
      DAEMON_RECOVERY_READY_TIMEOUT_MS,
      budget
    );
    if (recoveringStatus?.ok) {
      persistResolvedDaemonStatus(configuredConnection, recoveringStatus);
      return configuredConnection;
    }
    throw createDisconnectedError("Daemon not running. Start with `opendevbrowser serve`.");
  }
  for (const staleConnection of staleConnections) {
    const stopOutcome = await stopDaemonConnection(
      staleConnection.connection,
      budget,
      "resolveFreshDaemonConnection.staleConnections"
    );
    if (stopOutcome === "fingerprint_rejected") {
      throw createDisconnectedError(
        `Daemon on 127.0.0.1:${staleConnection.connection.port} pid=${staleConnection.status.pid} is protected by a different opendevbrowser build. Start with \`opendevbrowser serve\`.`
      );
    }
  }
  if (configuredStatus?.ok) {
    const shutdownOutcome = await waitForDaemonShutdown(configuredConnection, DAEMON_RECOVERY_READY_TIMEOUT_MS, budget);
    if (!shutdownOutcome) {
      throw createDisconnectedError("Daemon restart could not reclaim the configured port after fingerprint mismatch. Start with `opendevbrowser serve`.");
    }
    if (shutdownOutcome !== "stopped") {
      persistResolvedDaemonStatus(configuredConnection, shutdownOutcome);
      return configuredConnection;
    }
  }
  await restartDaemonConnection(configuredConnection);
  const refreshedStatus = await waitForCurrentDaemonStatus(configuredConnection, DAEMON_RESTART_READY_TIMEOUT_MS, budget);
  if (!refreshedStatus?.ok) {
    throw createDisconnectedError("Daemon restart failed after fingerprint mismatch. Start with `opendevbrowser serve`.");
  }
  persistResolvedDaemonStatus(configuredConnection, refreshedStatus);
  return configuredConnection;
};

const resolveDaemonConnection = async (
  budget: TimeoutBudget | null = null,
  options: ResolveDaemonConnectionOptions = {}
): Promise<DaemonConnection> => {
  const metadata = readDaemonMetadata();
  if (metadata && isCurrentDaemonFingerprint(metadata.fingerprint)) {
    const metadataConnection = { port: metadata.port, token: metadata.token };
    const configuredConnection = getConfiguredDaemonConnection();
    if (!configuredConnection || sameDaemonConnection(metadataConnection, configuredConnection)) {
      return metadataConnection;
    }
    const configuredOptions = resolveConfiguredPreferenceOptions(budget);
    if (!configuredOptions) {
      if (options.preferConfiguredRecovery) {
        return await resolveFreshDaemonConnection(budget, options);
      }
      return metadataConnection;
    }
    const configuredStatus = await fetchCurrentDaemonStatus(configuredConnection, configuredOptions, budget);
    if (configuredStatus?.ok) {
      return await persistCurrentConfiguredConnection(
        configuredConnection,
        configuredStatus,
        { connection: metadataConnection }
      );
    }
    if (options.preferConfiguredRecovery) {
      return await resolveFreshDaemonConnection(budget, options);
    }
    return metadataConnection;
  }
  return await resolveFreshDaemonConnection(budget, options);
};

const retryWithRefreshedConnection = async (
  name: string,
  params: Record<string, unknown>,
  budget: TimeoutBudget | null
): Promise<TimedFetchResponse> => {
  const connection = await resolveFreshDaemonConnection(budget, {
    preferConfiguredRecovery: requiresConfiguredRecovery(name)
  });
  return await openDaemonCommand(connection.port, connection.token, name, params, readRemainingBudgetMs(budget));
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
