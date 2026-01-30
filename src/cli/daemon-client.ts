import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { readDaemonMetadata, getCacheRoot, writeDaemonMetadata } from "./daemon";
import { CliError, createDisconnectedError, EXIT_EXECUTION } from "./errors";
import { writeFileAtomic } from "../utils/fs";
import { loadGlobalConfig } from "../config";
import { fetchDaemonStatus } from "./daemon-status";
import { fetchWithTimeout } from "./utils/http";

const CLIENT_ID_FILE = "client.json";
const DEFAULT_RENEW_AFTER_MS = 20_000;
const MIN_RENEW_AFTER_MS = 5_000;

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

type CallOptions = {
  requireBinding?: boolean;
  timeoutMs?: number;
};

let cachedClientId: string | null = null;

const loadClientId = (): string => {
  if (cachedClientId) {
    return cachedClientId;
  }

  const cacheRoot = getCacheRoot();
  const filePath = join(cacheRoot, CLIENT_ID_FILE);
  if (existsSync(filePath)) {
    try {
      const content = readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(content) as { clientId?: unknown };
      if (typeof parsed.clientId === "string" && parsed.clientId.trim()) {
        cachedClientId = parsed.clientId.trim();
        return cachedClientId;
      }
    } catch {
      // fallthrough to regenerate
    }
  }

  const clientId = randomUUID();
  const payload = JSON.stringify({ clientId, createdAt: new Date().toISOString() }, null, 2);
  writeFileAtomic(filePath, payload, { mode: 0o600 });
  cachedClientId = clientId;
  return clientId;
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

const isBindingRequiredError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.startsWith("RELAY_BINDING_REQUIRED") || message.startsWith("RELAY_BINDING_INVALID");
};

export class DaemonClient {
  private binding: BindingState | null = null;
  private renewTimer: NodeJS.Timeout | null = null;
  private readonly clientId: string;
  private readonly autoRenew: boolean;

  constructor(options: { clientId?: string; autoRenew?: boolean } = {}) {
    this.clientId = options.clientId ?? loadClientId();
    this.autoRenew = options.autoRenew ?? false;
  }

  async call<T>(name: string, params: Record<string, unknown> = {}, options: CallOptions = {}): Promise<T> {
    try {
      return await this.callWithBinding<T>(name, params, options);
    } catch (error) {
      if (!options.requireBinding && isBindingRequiredError(error)) {
        await this.ensureBinding();
        return await this.callWithBinding<T>(name, params, { ...options, requireBinding: true });
      }
      throw error;
    }
  }

  async releaseBinding(): Promise<void> {
    if (!this.binding) return;
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
    const payload = {
      ...params,
      clientId: this.clientId,
      ...(bindingId ? { bindingId } : {})
    };
    return await this.callRaw<T>(name, payload, options.timeoutMs);
  }

  private async ensureBinding(): Promise<string> {
    if (this.binding && Date.now() < this.binding.expiresAtMs - MIN_RENEW_AFTER_MS) {
      return this.binding.bindingId;
    }
    const data = await this.callRaw<RelayBindResponse>("relay.bind", { clientId: this.clientId });
    const state = await this.resolveBindingState(data);
    this.setBinding(state);
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
    this.setBinding(parseBindingResponse(data));
  }

  private setBinding(state: BindingState): void {
    this.binding = state;
    if (this.autoRenew) {
      this.scheduleRenew(state.renewAfterMs);
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

  private clearBinding(): void {
    this.binding = null;
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

    let response: Response;
    try {
      response = await fetchWithTimeout(`http://127.0.0.1:${connection.port}/command`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${connection.token}`
        },
        body: JSON.stringify({ name, params })
      }, timeoutMs);
    } catch {
      response = await retryWithRefreshedConnection(name, params, timeoutMs);
    }

    if (!response.ok) {
      const text = await response.text();
      let message = text || String(response.status);
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
      if (message.includes("Unauthorized") || response.status === 401) {
        response = await retryWithRefreshedConnection(name, params);
        if (!response.ok) {
          throw new CliError(message, EXIT_EXECUTION);
        }
      } else {
        throw new CliError(message, EXIT_EXECUTION);
      }
    }

    const payload = await response.json() as DaemonResponse<T>;
    if (!payload.ok) {
      throw new CliError(payload.error || "Daemon command failed.", EXIT_EXECUTION);
    }

    return payload.data as T;
  }
}

const cliClient = new DaemonClient({ autoRenew: false });

export async function callDaemon(command: string, params?: Record<string, unknown>, options?: CallOptions): Promise<unknown> {
  return cliClient.call(command, params ?? {}, options);
}

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
    const status = await fetchDaemonStatus(config.daemonPort, config.daemonToken);
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
): Promise<Response> => {
  const config = loadGlobalConfig();
  if (config.daemonPort <= 0 || !config.daemonToken) {
    throw createDisconnectedError("Daemon not running. Start with `opendevbrowser serve`.");
  }
  const status = await fetchDaemonStatus(config.daemonPort, config.daemonToken);
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
    return await fetchWithTimeout(`http://127.0.0.1:${config.daemonPort}/command`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.daemonToken}`
      },
      body: JSON.stringify({ name, params })
    }, timeoutMs);
  }
  throw createDisconnectedError("Daemon not running. Start with `opendevbrowser serve`.");
};
