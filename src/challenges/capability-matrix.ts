import type { ChallengeCapabilityMatrix, ChallengeEvidenceBundle, ChallengeInterpreterResult, ChallengePolicyGate } from "./types";

export const buildCapabilityMatrix = (
  bundle: ChallengeEvidenceBundle,
  interpretation: ChallengeInterpreterResult,
  gate: ChallengePolicyGate
): ChallengeCapabilityMatrix => {
  const hasActionables = bundle.actionables.length > 0;
  const helperActionRefs = [
    ...bundle.continuity.loginRefs,
    ...bundle.continuity.sessionReuseRefs,
    ...bundle.continuity.humanVerificationRefs,
    ...bundle.continuity.checkpointRefs
  ];
  const authLaneRelevant = interpretation.classification === "auth_required"
    || interpretation.classification === "existing_session_reuse"
    || bundle.continuity.likelyLoginPage
    || bundle.continuity.likelySessionPicker;
  const canNavigateToAuth = gate.allowedActions.includes("auth_navigation")
    && authLaneRelevant
    && (bundle.continuity.loginRefs.length > 0 || typeof bundle.url === "string");
  const canReuseExistingSession = gate.allowedActions.includes("session_reuse")
    && (
      bundle.continuity.hasPreservedSession
      || bundle.continuity.attachedSession
      || bundle.continuity.sessionReuseRefs.length > 0
    );
  const canReuseCookies = gate.allowedActions.includes("cookie_reuse")
    && authLaneRelevant
    && (bundle.continuity.canReuseExistingCookies || bundle.continuity.canImportCookies);
  const canFillNonSecretFields = gate.allowedActions.includes("non_secret_form_fill")
    && bundle.continuity.hasNonSecretTaskData
    && bundle.continuity.nonSecretFieldRefs.length > 0;
  const canExploreClicks = gate.allowedActions.includes("click_path")
    && (
      hasActionables
      || bundle.continuity.loginRefs.length > 0
      || bundle.continuity.sessionReuseRefs.length > 0
      || bundle.continuity.checkpointRefs.length > 0
    );
  const mustYield = interpretation.humanBoundary === "secret_entry"
    || interpretation.humanBoundary === "mfa"
    || interpretation.humanBoundary === "explicit_consent"
    || interpretation.humanBoundary === "exhausted_no_progress";
  const mustDefer = interpretation.humanBoundary === "policy_blocked"
    || (!bundle.blocker && bundle.blockerState === "clear");
  let helperEligibility = gate.helperEligibility ?? (
    gate.optionalComputerUseBridge
      ? {
        allowed: true,
        reason: "Optional helper bridge remains eligible after policy resolution."
      }
      : {
        allowed: false,
        reason: "Optional computer-use bridge is disabled by policy.",
        standDownReason: "helper_disabled_by_policy"
      }
  );
  if (helperEligibility.allowed && interpretation.humanBoundary !== "none") {
    helperEligibility = {
      allowed: false,
      reason: `Helper bridge is blocked by human boundary: ${interpretation.humanBoundary}.`,
      standDownReason: "helper_blocked_by_human_boundary"
    };
  } else if (helperEligibility.allowed && helperActionRefs.length === 0) {
    helperEligibility = {
      allowed: false,
      reason: "Canonical evidence did not expose any safe browser-scoped helper actions.",
      standDownReason: "helper_no_safe_actions"
    };
  }

  return {
    canNavigateToAuth,
    canReuseExistingSession,
    canReuseCookies,
    canFillNonSecretFields,
    canExploreClicks,
    canUseOwnedEnvironmentFixture: interpretation.classification === "owned_environment_test_challenge"
      && gate.governedLanes.includes("owned_environment_fixture"),
    canUseSanctionedIdentity: gate.governedLanes.includes("sanctioned_identity"),
    canUseServiceAdapter: gate.governedLanes.includes("service_adapter"),
    canUseComputerUseBridge: helperEligibility.allowed,
    helperEligibility,
    mustYield,
    mustDefer
  };
};
