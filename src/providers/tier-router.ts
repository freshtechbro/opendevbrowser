import type { ProviderTier, ProviderTierMetadata } from "./types";

export interface TierRouterConfig {
  defaultTier: ProviderTier;
  enableHybrid: boolean;
  enableRestrictedSafe: boolean;
  hybridRiskThreshold?: number;
  restrictedSafeRecoveryIntervalMs?: number;
}

export interface TierRouterSignals {
  hybridEligible: boolean;
  preferredTier?: ProviderTier;
  forceRestrictedSafe?: boolean;
  challengePressure?: number;
  highFrictionTarget?: boolean;
  riskScore?: number;
  hybridHealthy?: boolean;
  policyRestrictedSafe?: boolean;
  latencyBudgetExceeded?: boolean;
  errorBudgetExceeded?: boolean;
  recoveryStableForMs?: number;
  policyAllowsRecovery?: boolean;
}

export interface TierRouteDecision {
  tier: ProviderTierMetadata;
  fallbackTier: "A";
}

const canSelectTier = (tier: ProviderTier, config: TierRouterConfig): boolean => {
  if (tier === "A") return true;
  if (tier === "B") return config.enableHybrid;
  return config.enableRestrictedSafe;
};

export const selectTierRoute = (
  config: TierRouterConfig,
  signals: TierRouterSignals
): TierRouteDecision => {
  const challengePressure = signals.challengePressure ?? 0;
  const hybridRiskThreshold = Math.max(0, Math.min(1, config.hybridRiskThreshold ?? 0.6));
  const riskScore = Math.max(0, Math.min(1, signals.riskScore ?? challengePressure));
  const hybridHealthy = signals.hybridHealthy ?? true;
  const policyRestrictedSafe = signals.policyRestrictedSafe ?? false;
  const latencyBudgetExceeded = signals.latencyBudgetExceeded ?? false;
  const errorBudgetExceeded = signals.errorBudgetExceeded ?? false;
  const policyAllowsRecovery = signals.policyAllowsRecovery ?? true;
  const recoveryStableForMs = Math.max(0, signals.recoveryStableForMs ?? 0);

  if (signals.preferredTier && canSelectTier(signals.preferredTier, config)) {
    return {
      tier: {
        selected: signals.preferredTier,
        reasonCode: "operator_override"
      },
      fallbackTier: "A"
    };
  }

  if (config.enableRestrictedSafe && policyRestrictedSafe) {
    return {
      tier: {
        selected: "C",
        reasonCode: "policy_restricted_safe"
      },
      fallbackTier: "A"
    };
  }

  if (config.enableRestrictedSafe && signals.forceRestrictedSafe) {
    return {
      tier: {
        selected: "C",
        reasonCode: "restricted_safe_forced"
      },
      fallbackTier: "A"
    };
  }

  if (config.enableRestrictedSafe && signals.highFrictionTarget) {
    return {
      tier: {
        selected: "C",
        reasonCode: "high_friction_target"
      },
      fallbackTier: "A"
    };
  }

  if (config.enableRestrictedSafe && challengePressure >= 0.5) {
    return {
      tier: {
        selected: "C",
        reasonCode: "challenge_pressure"
      },
      fallbackTier: "A"
    };
  }

  const resolveHybridTier = (
    reasonCode: "default_tier" | "hybrid_eligible"
  ): TierRouteDecision => {
    if (!hybridHealthy) {
      return {
        tier: {
          selected: "A",
          reasonCode: "hybrid_unhealthy"
        },
        fallbackTier: "A"
      };
    }
    if (riskScore > hybridRiskThreshold) {
      return {
        tier: {
          selected: "A",
          reasonCode: "hybrid_risk_threshold"
        },
        fallbackTier: "A"
      };
    }
    if (latencyBudgetExceeded) {
      return {
        tier: {
          selected: "A",
          reasonCode: "hybrid_latency_budget"
        },
        fallbackTier: "A"
      };
    }
    if (errorBudgetExceeded) {
      return {
        tier: {
          selected: "A",
          reasonCode: "hybrid_error_budget"
        },
        fallbackTier: "A"
      };
    }
    return {
      tier: {
        selected: "B",
        reasonCode
      },
      fallbackTier: "A"
    };
  };

  if (config.defaultTier === "C") {
    if (config.enableRestrictedSafe) {
      const recovered = policyAllowsRecovery
        && recoveryStableForMs >= Math.max(0, config.restrictedSafeRecoveryIntervalMs ?? 60000);
      if (recovered) {
        if (config.enableHybrid && signals.hybridEligible) {
          const route = resolveHybridTier("hybrid_eligible");
          if (route.tier.selected === "B") {
            return {
              tier: {
                selected: "B",
                reasonCode: "restricted_safe_recovered"
              },
              fallbackTier: "A"
            };
          }
        }
        return {
          tier: {
            selected: "A",
            reasonCode: "restricted_safe_recovered"
          },
          fallbackTier: "A"
        };
      }
      return {
        tier: {
          selected: "C",
          reasonCode: "default_tier"
        },
        fallbackTier: "A"
      };
    }
    return {
      tier: {
        selected: "A",
        reasonCode: "restricted_safe_disabled"
      },
      fallbackTier: "A"
    };
  }

  if (config.defaultTier === "B") {
    if (!config.enableHybrid) {
      return {
        tier: {
          selected: "A",
          reasonCode: "hybrid_disabled"
        },
        fallbackTier: "A"
      };
    }
    if (signals.hybridEligible) {
      return resolveHybridTier("default_tier");
    }
  }

  if (config.enableHybrid && signals.hybridEligible) {
    return resolveHybridTier("hybrid_eligible");
  }

  return {
    tier: {
      selected: "A",
      reasonCode: "default_tier"
    },
    fallbackTier: "A"
  };
};

export const shouldFallbackToTierA = (tier: ProviderTier): boolean => {
  return tier !== "A";
};

export const fallbackTierMetadata = (): ProviderTierMetadata => {
  return {
    selected: "A",
    reasonCode: "fallback_to_tier_a"
  };
};
