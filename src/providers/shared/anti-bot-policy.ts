import type { ProviderOperation, ProviderReasonCode } from "../types";

export interface AntiBotPolicyConfig {
  enabled: boolean;
  cooldownMs: number;
  maxChallengeRetries: number;
  proxyHint?: string;
  sessionHint?: string;
  allowBrowserEscalation: boolean;
}

export interface AntiBotPreflightContext {
  providerId: string;
  operation: ProviderOperation;
  nowMs?: number;
}

export interface AntiBotPreflightResult {
  allow: boolean;
  reasonCode?: ProviderReasonCode;
  retryAfterMs?: number;
  retryGuidance?: string;
  proxyHint?: string;
  sessionHint?: string;
  escalationIntent: boolean;
}

export interface AntiBotPostflightContext {
  providerId: string;
  operation: ProviderOperation;
  success: boolean;
  reasonCode?: ProviderReasonCode;
  retryable: boolean;
  attempt: number;
  maxAttempts: number;
  nowMs?: number;
}

export interface AntiBotPostflightResult {
  allowRetry: boolean;
  reasonCode?: ProviderReasonCode;
  retryAfterMs?: number;
  escalationIntent: boolean;
  proxyHint?: string;
  sessionHint?: string;
}

type ProviderCooldownState = {
  reasonCode: ProviderReasonCode;
  cooldownUntilMs: number;
  updatedAt: string;
};

const clampInt = (value: number | undefined, fallback: number, min: number, max: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const rounded = Math.floor(value);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
};

export const DEFAULT_ANTI_BOT_POLICY_CONFIG: AntiBotPolicyConfig = {
  enabled: true,
  cooldownMs: 30000,
  maxChallengeRetries: 1,
  allowBrowserEscalation: false
};

const COOLDOWN_REASONS = new Set<ProviderReasonCode>([
  "ip_blocked",
  "token_required",
  "auth_required",
  "challenge_detected",
  "rate_limited"
]);

const ESCALATION_REASONS = new Set<ProviderReasonCode>([
  "ip_blocked",
  "token_required",
  "auth_required",
  "challenge_detected"
]);

const toKey = (providerId: string, operation: ProviderOperation): string => `${providerId}:${operation}`;

export const resolveAntiBotPolicyConfig = (
  config: Partial<AntiBotPolicyConfig> | undefined
): AntiBotPolicyConfig => ({
  enabled: config?.enabled ?? DEFAULT_ANTI_BOT_POLICY_CONFIG.enabled,
  cooldownMs: clampInt(config?.cooldownMs, DEFAULT_ANTI_BOT_POLICY_CONFIG.cooldownMs, 0, 300000),
  maxChallengeRetries: clampInt(
    config?.maxChallengeRetries,
    DEFAULT_ANTI_BOT_POLICY_CONFIG.maxChallengeRetries,
    0,
    10
  ),
  ...(config?.proxyHint ? { proxyHint: config.proxyHint.trim() } : {}),
  ...(config?.sessionHint ? { sessionHint: config.sessionHint.trim() } : {}),
  allowBrowserEscalation: config?.allowBrowserEscalation ?? DEFAULT_ANTI_BOT_POLICY_CONFIG.allowBrowserEscalation
});

export class AntiBotPolicyEngine {
  private readonly config: AntiBotPolicyConfig;
  private readonly cooldownByScope = new Map<string, ProviderCooldownState>();

  constructor(config: Partial<AntiBotPolicyConfig> | undefined = {}) {
    this.config = resolveAntiBotPolicyConfig(config);
  }

  preflight(context: AntiBotPreflightContext): AntiBotPreflightResult {
    if (!this.config.enabled) {
      return {
        allow: true,
        escalationIntent: false
      };
    }

    const key = toKey(context.providerId, context.operation);
    const nowMs = context.nowMs ?? Date.now();
    const cooldown = this.cooldownByScope.get(key);
    if (cooldown && cooldown.cooldownUntilMs > nowMs) {
      const retryAfterMs = cooldown.cooldownUntilMs - nowMs;
      return {
        allow: false,
        reasonCode: cooldown.reasonCode,
        retryAfterMs,
        retryGuidance: "cooldown_active",
        ...(this.config.proxyHint ? { proxyHint: this.config.proxyHint } : {}),
        ...(this.config.sessionHint ? { sessionHint: this.config.sessionHint } : {}),
        escalationIntent: this.config.allowBrowserEscalation && ESCALATION_REASONS.has(cooldown.reasonCode)
      };
    }

    if (cooldown && cooldown.cooldownUntilMs <= nowMs) {
      this.cooldownByScope.delete(key);
    }

    return {
      allow: true,
      escalationIntent: false
    };
  }

  postflight(context: AntiBotPostflightContext): AntiBotPostflightResult {
    if (!this.config.enabled) {
      return {
        allowRetry: context.retryable && context.attempt < context.maxAttempts,
        escalationIntent: false
      };
    }

    const key = toKey(context.providerId, context.operation);
    if (context.success) {
      this.cooldownByScope.delete(key);
      return {
        allowRetry: false,
        escalationIntent: false
      };
    }

    const reasonCode = context.reasonCode;
    const nowMs = context.nowMs ?? Date.now();
    if (reasonCode && COOLDOWN_REASONS.has(reasonCode) && this.config.cooldownMs > 0) {
      this.cooldownByScope.set(key, {
        reasonCode,
        cooldownUntilMs: nowMs + this.config.cooldownMs,
        updatedAt: new Date(nowMs).toISOString()
      });
    }

    const canRetryByAttempt = context.attempt < context.maxAttempts;
    const challengeRetryBudgetExceeded = reasonCode === "challenge_detected"
      && context.attempt > this.config.maxChallengeRetries + 1;
    const allowRetry = context.retryable && canRetryByAttempt && !challengeRetryBudgetExceeded;

    return {
      allowRetry,
      ...(reasonCode ? { reasonCode } : {}),
      ...(reasonCode && COOLDOWN_REASONS.has(reasonCode) && this.config.cooldownMs > 0
        ? { retryAfterMs: this.config.cooldownMs }
        : {}),
      ...(this.config.proxyHint ? { proxyHint: this.config.proxyHint } : {}),
      ...(this.config.sessionHint ? { sessionHint: this.config.sessionHint } : {}),
      escalationIntent: Boolean(
        reasonCode
        && this.config.allowBrowserEscalation
        && ESCALATION_REASONS.has(reasonCode)
      )
    };
  }
}
