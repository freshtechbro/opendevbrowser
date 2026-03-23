import type { ProvidersChallengeOrchestrationConfig } from "../config";
import type {
  ChallengeActionFamily,
  ChallengeHumanBoundary,
  ChallengeInterpreterResult,
  ChallengePolicyGate
} from "./types";

const ALL_ACTIONS: ChallengeActionFamily[] = [
  "wait",
  "auth_navigation",
  "session_reuse",
  "cookie_reuse",
  "element_discovery",
  "click_path",
  "non_secret_form_fill",
  "dropdown",
  "scroll",
  "hover",
  "press",
  "pointer",
  "drag",
  "verification",
  "debug_trace"
];

const DEFAULT_HANDOFF_TRIGGERS: ChallengeHumanBoundary[] = [
  "secret_entry",
  "mfa",
  "explicit_consent",
  "policy_blocked",
  "unsupported_third_party",
  "exhausted_no_progress"
];

export const buildChallengePolicyGate = (
  config: ProvidersChallengeOrchestrationConfig,
  interpretation: ChallengeInterpreterResult
): ChallengePolicyGate => {
  if (!config.enabled) {
    return {
      allowedActions: [],
      forbiddenActions: [...ALL_ACTIONS],
      handoffTriggers: [...DEFAULT_HANDOFF_TRIGGERS],
      governedLanes: [],
      optionalComputerUseBridge: false
    };
  }

  const allowed = new Set<ChallengeActionFamily>(["wait", "verification", "debug_trace"]);
  if (config.allowAuthNavigation) {
    allowed.add("auth_navigation");
  }
  if (config.allowSessionReuse) {
    allowed.add("session_reuse");
  }
  if (config.allowCookieReuse) {
    allowed.add("cookie_reuse");
  }
  if (config.allowNonSecretFormFill) {
    allowed.add("non_secret_form_fill");
    allowed.add("dropdown");
  }
  if (config.allowInteractionExploration) {
    allowed.add("element_discovery");
    allowed.add("click_path");
    allowed.add("scroll");
    allowed.add("hover");
    allowed.add("press");
    allowed.add("pointer");
    allowed.add("drag");
  }

  if (interpretation.humanBoundary === "secret_entry" || interpretation.humanBoundary === "mfa") {
    allowed.delete("non_secret_form_fill");
  }

  const governedLanes: ChallengePolicyGate["governedLanes"] = [];
  if (config.governed.allowOwnedEnvironmentFixtures) {
    governedLanes.push("owned_environment_fixture");
  }
  if (config.governed.allowSanctionedIdentity) {
    governedLanes.push("sanctioned_identity");
  }
  if (config.governed.allowServiceAdapters) {
    governedLanes.push("service_adapter");
  }

  return {
    allowedActions: ALL_ACTIONS.filter((action) => allowed.has(action)),
    forbiddenActions: ALL_ACTIONS.filter((action) => !allowed.has(action)),
    handoffTriggers: [...DEFAULT_HANDOFF_TRIGGERS],
    governedLanes,
    optionalComputerUseBridge: config.optionalComputerUseBridge.enabled
  };
};
