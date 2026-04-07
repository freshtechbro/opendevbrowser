import type { ChallengeEvidenceBundle, ChallengeHumanBoundary, ChallengeInterpreterResult, HumanYieldPacket } from "./types";

export const shouldYieldToHuman = (args: {
  interpretation: ChallengeInterpreterResult;
  noProgressExhausted: boolean;
}): { yield: boolean; reason: ChallengeHumanBoundary } => {
  if (args.noProgressExhausted) {
    return {
      yield: true,
      reason: "exhausted_no_progress"
    };
  }
  return {
    yield: args.interpretation.humanBoundary !== "none",
    reason: args.interpretation.humanBoundary
  };
};

export const buildHumanYieldPacket = (args: {
  bundle: ChallengeEvidenceBundle;
  interpretation: ChallengeInterpreterResult;
  sessionId: string;
  targetId?: string | null;
  reason: ChallengeHumanBoundary;
  verification?: {
    status: "clear" | "still_blocked" | "progress" | "yield_required" | "deferred";
    reason: string;
  };
}): HumanYieldPacket => {
  const challengeId = args.bundle.challengeId ?? `challenge-${Date.now()}`;
  const targetHints = [
    ...args.bundle.continuity.loginRefs,
    ...args.bundle.continuity.sessionReuseRefs,
    ...args.bundle.continuity.humanVerificationRefs,
    ...args.bundle.continuity.checkpointRefs
  ];
  return {
    challengeId,
    classification: args.interpretation.classification,
    reason: args.reason,
    sessionId: args.sessionId,
    targetId: args.targetId ?? args.bundle.activeTargetId,
    ownerSurface: args.bundle.challenge?.ownerSurface ?? args.bundle.ownerSurface,
    url: args.bundle.url,
    title: args.bundle.title,
    requiredHumanStep: args.reason === "mfa"
      ? "Complete MFA or passkey verification, then continue."
      : args.reason === "secret_entry"
        ? "Enter the required secret-bearing credentials, then continue."
        : args.reason === "unsupported_third_party"
          ? "Complete the unsupported third-party challenge manually, then continue."
          : "Review the page state and continue when ready.",
    targetHints,
    expectedPostAuthCheckpoint: args.interpretation.likelyCheckpoint,
    preserveUntil: args.bundle.challenge?.preserveUntil,
    verifyUntil: args.bundle.challenge?.verifyUntil,
    traceRequestId: args.bundle.diagnostics.traceRequestId,
    ...(args.verification ? {
      lastVerificationStatus: args.verification.status,
      lastVerificationReason: args.verification.reason
    } : {}),
    evidenceSummary: args.interpretation.summary,
    reclaimHint: "Resume the preserved session and re-run verification after the human step completes.",
    resumeRule: "Re-run manager-owned verification after the human step completes before resuming automation."
  };
};
