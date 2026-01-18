import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { readDaemonMetadata, getCacheRoot } from "./daemon";
import { CliError, createDisconnectedError, EXIT_EXECUTION } from "./errors";
import { writeFileAtomic } from "../utils/fs";

const CLIENT_ID_FILE = "client.json";
const DEFAULT_RENEW_AFTER_MS = 20_000;
const MIN_RENEW_AFTER_MS = 5_000;

type DaemonResponse<T> = { ok?: boolean; data?: T; error?: string };

type BindingResponse = {
  bindingId: string;
  expiresAt: string;
  ttlMs?: number;
  renewAfterMs?: number;
};

type BindingState = {
  bindingId: string;
  expiresAtMs: number;
  renewAfterMs: number;
};

type CallOptions = {
  requireBinding?: boolean;
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
  return message.startsWith("RELAY_BINDING_REQUIRED");
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
      return await this.callWithBinding<T>(name, params, options.requireBinding ?? false);
    } catch (error) {
      if (!options.requireBinding && isBindingRequiredError(error)) {
        await this.ensureBinding();
        return await this.callWithBinding<T>(name, params, true);
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

  private async callWithBinding<T>(name: string, params: Record<string, unknown>, requireBinding: boolean): Promise<T> {
    const bindingId = requireBinding ? await this.ensureBinding() : this.binding?.bindingId;
    const payload = {
      ...params,
      clientId: this.clientId,
      ...(bindingId ? { bindingId } : {})
    };
    return await this.callRaw<T>(name, payload);
  }

  private async ensureBinding(): Promise<string> {
    if (this.binding && Date.now() < this.binding.expiresAtMs - MIN_RENEW_AFTER_MS) {
      return this.binding.bindingId;
    }
    const data = await this.callRaw<BindingResponse>("relay.bind", { clientId: this.clientId });
    const state = parseBindingResponse(data);
    this.setBinding(state);
    return state.bindingId;
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

  private async callRaw<T>(name: string, params: Record<string, unknown>): Promise<T> {
    const metadata = readDaemonMetadata();
    if (!metadata) {
      throw createDisconnectedError("Daemon not running. Start with `opendevbrowser serve`.");
    }

    let response: Response;
    try {
      response = await fetch(`http://127.0.0.1:${metadata.port}/command`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${metadata.token}`
        },
        body: JSON.stringify({ name, params })
      });
    } catch {
      throw createDisconnectedError("Daemon not running. Start with `opendevbrowser serve`.");
    }

    if (!response.ok) {
      const message = await response.text();
      throw new CliError(`Daemon error: ${message || response.status}`, EXIT_EXECUTION);
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
