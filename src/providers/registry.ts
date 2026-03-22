import { createProviderError } from "./errors";
import type {
  BrowserFallbackDisposition,
  ProviderAdapter,
  ProviderCapabilities,
  ProviderError,
  ProviderHealth,
  ProviderOperation,
  ProviderReasonCode,
  ProviderSource
} from "./types";

type ProviderCooldownState = {
  reasonCode: ProviderReasonCode;
  cooldownUntilMs: number;
  updatedAt: string;
};

type ProviderAntiBotEventKind = "challenge" | "rate_limited" | "success" | "other";

type ProviderPreservedOutcome = {
  disposition: BrowserFallbackDisposition;
  reasonCode?: ProviderReasonCode;
  at: string;
};

type ProviderAntiBotState = {
  activeChallenges: number;
  lastChallengeAt?: string;
  lastResolvedAt?: string;
  cooldownByOperation: Partial<Record<ProviderOperation, ProviderCooldownState>>;
  recentEvents: ProviderAntiBotEventKind[];
  lastPreservedOutcome?: ProviderPreservedOutcome;
};

export interface ProviderAntiBotSnapshot {
  providerId: string;
  activeChallenges: number;
  lastChallengeAt?: string;
  lastResolvedAt?: string;
  recentChallengeRatio: number;
  recentRateLimitRatio: number;
  cooldownUntilMs: number;
  lastPreservedOutcome?: ProviderPreservedOutcome;
}

interface ProviderState {
  health: ProviderHealth;
  failures: number;
  circuitOpenUntil: number;
  lastError?: ProviderError;
  antiBot: ProviderAntiBotState;
}

const ANTI_BOT_WINDOW = 20;

const CHALLENGE_REASONS = new Set<ProviderReasonCode>([
  "challenge_detected",
  "auth_required",
  "token_required",
  "ip_blocked"
]);

const RATE_LIMIT_REASONS = new Set<ProviderReasonCode>([
  "rate_limited"
]);

const defaultAntiBotState = (): ProviderAntiBotState => ({
  activeChallenges: 0,
  cooldownByOperation: {},
  recentEvents: []
});

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
      circuitOpenUntil: 0,
      antiBot: defaultAntiBotState()
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
    existing.antiBot = defaultAntiBotState();
  }

  setAntiBotCooldown(
    providerId: string,
    operation: ProviderOperation,
    reasonCode: ProviderReasonCode,
    cooldownUntilMs: number,
    nowMs = Date.now()
  ): void {
    const antiBot = this.getState(providerId).antiBot;
    antiBot.cooldownByOperation[operation] = {
      reasonCode,
      cooldownUntilMs,
      updatedAt: new Date(nowMs).toISOString()
    };
  }

  clearAntiBotCooldown(
    providerId: string,
    operation: ProviderOperation
  ): void {
    delete this.getState(providerId).antiBot.cooldownByOperation[operation];
  }

  getAntiBotCooldown(
    providerId: string,
    operation: ProviderOperation,
    nowMs = Date.now()
  ): ProviderCooldownState | undefined {
    const antiBot = this.getState(providerId).antiBot;
    const cooldown = antiBot.cooldownByOperation[operation];
    if (!cooldown) {
      return undefined;
    }
    if (cooldown.cooldownUntilMs <= nowMs) {
      delete antiBot.cooldownByOperation[operation];
      return undefined;
    }
    return cooldown;
  }

  recordAntiBotOutcome(args: {
    providerId: string;
    success?: boolean;
    reasonCode?: ProviderReasonCode;
    disposition?: BrowserFallbackDisposition;
    nowMs?: number;
  }): void {
    const antiBot = this.getState(args.providerId).antiBot;
    const nowMs = args.nowMs ?? Date.now();
    const nowIso = new Date(nowMs).toISOString();

    if (args.success) {
      this.pushAntiBotEvent(antiBot, "success");
      if (antiBot.activeChallenges > 0) {
        antiBot.activeChallenges = 0;
        antiBot.lastResolvedAt = nowIso;
      }
      return;
    }

    const eventKind = this.classifyAntiBotEventKind(args.reasonCode);
    this.pushAntiBotEvent(antiBot, eventKind);

    if (args.disposition) {
      antiBot.lastPreservedOutcome = {
        disposition: args.disposition,
        ...(args.reasonCode ? { reasonCode: args.reasonCode } : {}),
        at: nowIso
      };
    }

    if (args.disposition === "challenge_preserved") {
      antiBot.activeChallenges = Math.max(1, antiBot.activeChallenges);
      antiBot.lastChallengeAt = nowIso;
      return;
    }

    if (eventKind === "challenge") {
      antiBot.lastChallengeAt = nowIso;
    }
  }

  getAntiBotSnapshot(
    providerId: string,
    nowMs = Date.now()
  ): ProviderAntiBotSnapshot {
    const antiBot = this.getState(providerId).antiBot;
    const activeCooldowns = Object.values(antiBot.cooldownByOperation)
      .filter((cooldown): cooldown is ProviderCooldownState => Boolean(cooldown))
      .filter((cooldown) => cooldown.cooldownUntilMs > nowMs);
    const eventCount = antiBot.recentEvents.length;
    const challengeCount = antiBot.recentEvents.filter((entry) => entry === "challenge").length;
    const rateLimitCount = antiBot.recentEvents.filter((entry) => entry === "rate_limited").length;

    return {
      providerId,
      activeChallenges: antiBot.activeChallenges,
      ...(antiBot.lastChallengeAt ? { lastChallengeAt: antiBot.lastChallengeAt } : {}),
      ...(antiBot.lastResolvedAt ? { lastResolvedAt: antiBot.lastResolvedAt } : {}),
      recentChallengeRatio: eventCount > 0 ? challengeCount / eventCount : 0,
      recentRateLimitRatio: eventCount > 0 ? rateLimitCount / eventCount : 0,
      cooldownUntilMs: activeCooldowns.reduce((max, cooldown) => Math.max(max, cooldown.cooldownUntilMs), 0),
      ...(antiBot.lastPreservedOutcome ? { lastPreservedOutcome: antiBot.lastPreservedOutcome } : {})
    };
  }

  listAntiBotSnapshots(nowMs = Date.now()): ProviderAntiBotSnapshot[] {
    return this.list().map((provider) => this.getAntiBotSnapshot(provider.id, nowMs));
  }

  getAntiBotPressure(providerId: string, nowMs = Date.now()): number {
    const snapshot = this.getAntiBotSnapshot(providerId, nowMs);
    return Math.max(
      snapshot.recentChallengeRatio,
      snapshot.recentRateLimitRatio,
      snapshot.activeChallenges > 0 ? 1 : 0,
      snapshot.cooldownUntilMs > nowMs ? 0.75 : 0
    );
  }

  private getState(providerId: string): ProviderState {
    const state = this.state.get(providerId);
    if (!state) {
      throw new Error(`Unknown provider state: ${providerId}`);
    }
    return state;
  }

  private classifyAntiBotEventKind(reasonCode?: ProviderReasonCode): ProviderAntiBotEventKind {
    if (!reasonCode) {
      return "other";
    }
    if (CHALLENGE_REASONS.has(reasonCode)) {
      return "challenge";
    }
    if (RATE_LIMIT_REASONS.has(reasonCode)) {
      return "rate_limited";
    }
    return "other";
  }

  private pushAntiBotEvent(state: ProviderAntiBotState, event: ProviderAntiBotEventKind): void {
    state.recentEvents.push(event);
    if (state.recentEvents.length > ANTI_BOT_WINDOW) {
      state.recentEvents.splice(0, state.recentEvents.length - ANTI_BOT_WINDOW);
    }
  }
}
