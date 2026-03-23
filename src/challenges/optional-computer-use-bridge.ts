import type { ProvidersChallengeOrchestrationConfig } from "../config";
import type { ChallengeActionStep, ChallengeEvidenceBundle, ComputerUseBridgeResult } from "./types";

const buildSuggestions = (bundle: ChallengeEvidenceBundle, maxSuggestions: number): ChallengeActionStep[] => {
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
      reason: "Optional bridge suggested a browser-scoped click follow-up from canonical evidence."
    }));
};

export const suggestComputerUseActions = (args: {
  config: ProvidersChallengeOrchestrationConfig;
  bundle: ChallengeEvidenceBundle;
}): ComputerUseBridgeResult => {
  if (!args.config.optionalComputerUseBridge.enabled) {
    return {
      status: "disabled",
      reason: "Optional computer-use bridge is disabled by policy.",
      suggestedSteps: []
    };
  }

  const suggestedSteps = buildSuggestions(args.bundle, args.config.optionalComputerUseBridge.maxSuggestions);
  if (suggestedSteps.length === 0) {
    return {
      status: "unsupported",
      reason: "Canonical evidence did not expose any safe browser-scoped bridge actions.",
      suggestedSteps: []
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
