import type {
  ChallengeActionStep,
  ChallengeAutomationHelperEligibility,
  ChallengeEvidenceBundle,
  ComputerUseBridgeResult
} from "./types";

export const OPTIONAL_BRIDGE_SUGGESTION_REASON = "Optional bridge suggested a browser-scoped click follow-up from canonical evidence.";

export const buildComputerUseSuggestions = (
  bundle: ChallengeEvidenceBundle,
  maxSuggestions: number
): ChallengeActionStep[] => {
  const refs = [
    ...bundle.continuity.loginRefs,
    ...bundle.continuity.sessionReuseRefs,
    ...bundle.continuity.humanVerificationRefs,
    ...bundle.continuity.checkpointRefs
  ];
  return refs
    .slice(0, maxSuggestions)
    .map((ref) => ({
      kind: "click",
      ref,
      reason: OPTIONAL_BRIDGE_SUGGESTION_REASON
    }));
};

export const suggestComputerUseActions = (args: {
  helperEligibility: ChallengeAutomationHelperEligibility;
  bundle: ChallengeEvidenceBundle;
  maxSuggestions: number;
}): ComputerUseBridgeResult => {
  if (!args.helperEligibility.allowed) {
    return {
      status: "disabled",
      reason: args.helperEligibility.reason,
      suggestedSteps: [],
      standDownReason: args.helperEligibility.standDownReason
    };
  }

  const suggestedSteps = buildComputerUseSuggestions(args.bundle, args.maxSuggestions);
  if (suggestedSteps.length === 0) {
    return {
      status: "unsupported",
      reason: "Canonical evidence did not expose any safe browser-scoped bridge actions.",
      suggestedSteps: [],
      standDownReason: "helper_no_safe_actions"
    };
  }

  return {
    status: "suggested",
    reason: "Bridge returned bounded browser-scoped suggestions from canonical evidence.",
    suggestedSteps,
    auditMetadata: {
      suggestions: suggestedSteps.length,
      source: "canonical_evidence"
    }
  };
};
