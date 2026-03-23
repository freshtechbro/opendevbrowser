import type { ProvidersChallengeOrchestrationConfig } from "../config";
import type {
  ChallengeCapabilityMatrix,
  ChallengeEvidenceBundle,
  ChallengeInterpreterResult,
  ChallengePolicyGate,
  ChallengeStrategyDecision,
  ChallengeStrategyLane
} from "./types";

const buildDecision = (
  config: ProvidersChallengeOrchestrationConfig,
  lane: ChallengeStrategyLane,
  rationale: string,
  allowedActionFamilies: ChallengePolicyGate["allowedActions"],
  verificationLevel: ChallengeInterpreterResult["requiredVerification"],
  stopConditions: string[],
  governedLane?: ChallengeStrategyDecision["governedLane"]
): ChallengeStrategyDecision => ({
  lane,
  ...(governedLane ? { governedLane } : {}),
  rationale,
  attemptBudget: config.attemptBudget,
  noProgressLimit: config.noProgressLimit,
  verificationLevel,
  stopConditions,
  allowedActionFamilies: [...allowedActionFamilies]
});

export const selectChallengeStrategy = (args: {
  config: ProvidersChallengeOrchestrationConfig;
  bundle: ChallengeEvidenceBundle;
  interpretation: ChallengeInterpreterResult;
  capabilityMatrix: ChallengeCapabilityMatrix;
  gate: ChallengePolicyGate;
}): ChallengeStrategyDecision => {
  const { config, bundle, capabilityMatrix, gate, interpretation } = args;
  const registryCooldownActive = (bundle.registryPressure?.cooldownUntilMs ?? 0) > Date.now();
  const registryPressureElevated = (bundle.registryPressure?.activeChallenges ?? 0) > 0
    || (bundle.registryPressure?.recentChallengeRatio ?? 0) >= 0.5
    || (bundle.registryPressure?.recentRateLimitRatio ?? 0) >= 0.5;
  const stopConditions = [
    "manager_verification_clears_blocker",
    "policy_gate_denies_next_action",
    "human_boundary_detected",
    "no_progress_budget_exhausted"
  ];

  if (!config.enabled) {
    return buildDecision(
      config,
      "defer",
      "Challenge orchestration is disabled by config.",
      [],
      "light",
      ["orchestration_disabled"]
    );
  }

  if (capabilityMatrix.mustDefer) {
    return buildDecision(
      config,
      "defer",
      "Current policy or blocker state requires deferral before further automation.",
      gate.allowedActions,
      interpretation.requiredVerification,
      ["policy_blocked_or_clear_state"]
    );
  }

  if (
    registryCooldownActive
    && !capabilityMatrix.canReuseExistingSession
    && !capabilityMatrix.canReuseCookies
    && !capabilityMatrix.canNavigateToAuth
  ) {
    return buildDecision(
      config,
      "defer",
      "Registry cooldown is still active and no legitimate continuity or auth-navigation lane is currently available.",
      gate.allowedActions,
      interpretation.requiredVerification,
      ["registry_cooldown_active"]
    );
  }

  if (capabilityMatrix.canUseOwnedEnvironmentFixture) {
    return buildDecision(
      config,
      "owned_environment_fixture",
      "Owned-environment fixture detected and explicitly allowlisted.",
      gate.allowedActions,
      interpretation.requiredVerification,
      stopConditions,
      "owned_environment_fixture"
    );
  }

  if (capabilityMatrix.mustYield) {
    return buildDecision(
      config,
      "human_yield",
      `Human authority boundary reached: ${interpretation.humanBoundary}.`,
      gate.allowedActions,
      interpretation.requiredVerification,
      [...stopConditions, "human_authority_required"]
    );
  }

  if (
    capabilityMatrix.canNavigateToAuth
    || capabilityMatrix.canReuseExistingSession
    || capabilityMatrix.canReuseCookies
    || capabilityMatrix.canFillNonSecretFields
    || capabilityMatrix.canExploreClicks
  ) {
    return buildDecision(
      config,
      "generic_browser_autonomy",
      registryPressureElevated
        ? "Registry pressure is elevated, but legitimate browser continuity remains available for one bounded generic autonomy pass."
        : "Existing browser controls can attempt bounded auth navigation, session reuse, non-secret fill, or interaction exploration.",
      gate.allowedActions,
      interpretation.requiredVerification,
      registryPressureElevated
        ? [...stopConditions, "registry_pressure_elevated"]
        : stopConditions
    );
  }

  if (capabilityMatrix.canUseComputerUseBridge) {
    return buildDecision(
      config,
      "optional_computer_use_bridge",
      "DOM-native autonomy is exhausted, but the optional browser-scoped bridge is enabled.",
      gate.allowedActions,
      interpretation.requiredVerification,
      stopConditions
    );
  }

  if (capabilityMatrix.canUseSanctionedIdentity) {
    return buildDecision(
      config,
      "sanctioned_identity",
      "Sanctioned identity lane is enabled and generic browser autonomy is insufficient.",
      gate.allowedActions,
      interpretation.requiredVerification,
      stopConditions,
      "sanctioned_identity"
    );
  }

  if (capabilityMatrix.canUseServiceAdapter) {
    return buildDecision(
      config,
      "service_adapter",
      "Governed service-adapter lane is enabled as the last non-human option.",
      gate.allowedActions,
      interpretation.requiredVerification,
      stopConditions,
      "service_adapter"
    );
  }

  return buildDecision(
    config,
    "human_yield",
    "No legitimate autonomous lane remains after applying policy and continuity checks.",
    gate.allowedActions,
    interpretation.requiredVerification,
    [...stopConditions, "no_legitimate_lane_remaining"]
  );
};
