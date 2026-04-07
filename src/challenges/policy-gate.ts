import type { ProvidersChallengeOrchestrationConfig } from "../config";
import type {
  ChallengeAutomationHelperEligibility,
  ChallengeAutomationMode,
  ChallengeActionFamily,
  ChallengeHumanBoundary,
  ChallengeInterpreterResult,
  ChallengePolicyGate,
  ResolvedChallengeAutomationPolicy
} from "./types";

const ALL_ACTIONS: ChallengeActionFamily[] = [
  "wait",
  "auth_navigation",
  "session_reuse",
  "cookie_reuse",
  "element_discovery",
  "click_path",
  "click_and_hold",
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

const buildResolvedPolicy = (
  mode: ChallengeAutomationMode,
  source: ResolvedChallengeAutomationPolicy["source"]
): ResolvedChallengeAutomationPolicy => {
  if (mode === "off") {
    return {
      mode,
      source,
      standDownReason: "challenge_automation_off"
    };
  }
  if (mode === "browser") {
    return {
      mode,
      source,
      standDownReason: "helper_disabled_for_browser_mode"
    };
  }
  return { mode, source };
};

export const resolveChallengeAutomationPolicy = (args: {
  runMode?: ChallengeAutomationMode;
  sessionMode?: ChallengeAutomationMode;
  configMode: ChallengeAutomationMode;
}): ResolvedChallengeAutomationPolicy => {
  if (args.runMode) {
    return buildResolvedPolicy(args.runMode, "run");
  }
  if (args.sessionMode) {
    return buildResolvedPolicy(args.sessionMode, "session");
  }
  return buildResolvedPolicy(args.configMode, "config");
};

const resolveHelperEligibility = (
  config: ProvidersChallengeOrchestrationConfig,
  policy: ResolvedChallengeAutomationPolicy
): ChallengeAutomationHelperEligibility => {
  if (policy.mode === "off") {
    return {
      allowed: false,
      reason: "Challenge automation mode is off; detection and reporting remain active.",
      standDownReason: "challenge_automation_off"
    };
  }
  if (policy.mode === "browser") {
    return {
      allowed: false,
      reason: "Browser mode keeps the optional helper bridge disabled.",
      standDownReason: "helper_disabled_for_browser_mode"
    };
  }
  if (!config.optionalComputerUseBridge.enabled) {
    return {
      allowed: false,
      reason: "Optional computer-use bridge is disabled by policy.",
      standDownReason: "helper_disabled_by_policy"
    };
  }
  return {
    allowed: true,
    reason: "Optional helper bridge remains eligible after mode resolution."
  };
};

export const buildChallengePolicyGate = (
  config: ProvidersChallengeOrchestrationConfig,
  interpretation: ChallengeInterpreterResult,
  resolvedPolicy = resolveChallengeAutomationPolicy({
    configMode: config.mode
  })
): ChallengePolicyGate => {
  const helperEligibility = resolveHelperEligibility(config, resolvedPolicy);
  if (resolvedPolicy.mode === "off") {
    return {
      resolvedPolicy,
      allowedActions: [],
      forbiddenActions: [...ALL_ACTIONS],
      handoffTriggers: [...DEFAULT_HANDOFF_TRIGGERS],
      governedLanes: [],
      optionalComputerUseBridge: false,
      helperEligibility
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
    allowed.add("click_and_hold");
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
    resolvedPolicy,
    allowedActions: ALL_ACTIONS.filter((action) => allowed.has(action)),
    forbiddenActions: ALL_ACTIONS.filter((action) => !allowed.has(action)),
    handoffTriggers: [...DEFAULT_HANDOFF_TRIGGERS],
    governedLanes,
    optionalComputerUseBridge: helperEligibility.allowed,
    helperEligibility
  };
};
