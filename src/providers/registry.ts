import { createProviderError } from "./errors";
import type { ProviderAdapter, ProviderCapabilities, ProviderError, ProviderHealth, ProviderSource } from "./types";

interface ProviderState {
  health: ProviderHealth;
  failures: number;
  circuitOpenUntil: number;
  lastError?: ProviderError;
}

const defaultHealth = (): ProviderHealth => ({
  status: "healthy",
  updatedAt: new Date().toISOString()
});

export class ProviderRegistry {
  private readonly providers = new Map<string, ProviderAdapter>();
  private readonly state = new Map<string, ProviderState>();

  register(provider: ProviderAdapter): void {
    if (this.providers.has(provider.id)) {
      throw new Error(`Provider already registered: ${provider.id}`);
    }

    this.providers.set(provider.id, provider);
    this.state.set(provider.id, {
      health: defaultHealth(),
      failures: 0,
      circuitOpenUntil: 0
    });
  }

  get(providerId: string): ProviderAdapter {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new Error(`Unknown provider: ${providerId}`);
    }
    return provider;
  }

  list(): ProviderAdapter[] {
    return [...this.providers.values()];
  }

  listBySource(source: ProviderSource): ProviderAdapter[] {
    return this.list().filter((provider) => provider.source === source);
  }

  capabilities(): ProviderCapabilities[] {
    return this.list().map((provider) => provider.capabilities());
  }

  setHealth(providerId: string, health: ProviderHealth): void {
    const existing = this.getState(providerId);
    existing.health = {
      ...health,
      updatedAt: health.updatedAt || new Date().toISOString()
    };
  }

  getHealth(providerId: string): ProviderHealth {
    return this.getState(providerId).health;
  }

  markSuccess(providerId: string, latencyMs: number): void {
    const existing = this.getState(providerId);
    existing.failures = 0;
    existing.circuitOpenUntil = 0;
    existing.lastError = undefined;
    existing.health = {
      status: "healthy",
      updatedAt: new Date().toISOString(),
      latencyMs
    };
  }

  markFailure(
    providerId: string,
    error: ProviderError,
    circuit: { failureThreshold: number; cooldownMs: number }
  ): void {
    const existing = this.getState(providerId);
    existing.failures += 1;
    existing.lastError = error;

    const now = Date.now();
    const threshold = Math.max(1, circuit.failureThreshold);
    if (existing.failures >= threshold) {
      existing.circuitOpenUntil = now + Math.max(0, circuit.cooldownMs);
      existing.health = {
        status: "unhealthy",
        updatedAt: new Date(now).toISOString(),
        reason: error.message
      };
      return;
    }

    existing.health = {
      status: "degraded",
      updatedAt: new Date(now).toISOString(),
      reason: error.message
    };
  }

  isCircuitOpen(providerId: string, nowMs = Date.now()): boolean {
    const existing = this.getState(providerId);
    if (existing.circuitOpenUntil <= 0) return false;
    if (existing.circuitOpenUntil > nowMs) return true;

    existing.circuitOpenUntil = 0;
    if (existing.health.status === "unhealthy") {
      existing.health = {
        status: "degraded",
        updatedAt: new Date(nowMs).toISOString(),
        reason: "Circuit cooldown elapsed"
      };
    }
    return false;
  }

  getCircuitError(providerId: string): ProviderError {
    const existing = this.getState(providerId);
    return createProviderError("circuit_open", "Provider circuit is open", {
      provider: providerId,
      retryable: true,
      details: {
        openUntil: existing.circuitOpenUntil,
        failures: existing.failures,
        lastErrorCode: existing.lastError?.code ?? null
      }
    });
  }

  reset(providerId: string): void {
    const existing = this.getState(providerId);
    existing.failures = 0;
    existing.circuitOpenUntil = 0;
    existing.lastError = undefined;
    existing.health = defaultHealth();
  }

  private getState(providerId: string): ProviderState {
    const state = this.state.get(providerId);
    if (!state) {
      throw new Error(`Unknown provider state: ${providerId}`);
    }
    return state;
  }
}
