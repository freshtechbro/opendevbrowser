import type { GuidanceContext, GuidanceReadiness } from "./types";

const MIN_READY_REFERENCE_SCORE = 50;
const MIN_READY_REFERENCE_CONFIDENCE = 0.5;

const hasProviderBlocker = (context: GuidanceContext): boolean => {
  if (context.providerUnavailable === true) return true;
  return context.reasonCode === "provider_unavailable" || context.reasonCode === "auth_required";
};

const hasDiagnosticOnlyEvidence = (context: GuidanceContext): boolean => {
  if (context.reasonCode === "diagnostic_only") return true;
  const reasons = context.evidence?.diagnosticOnlyReasons ?? [];
  if (reasons.length === 0) return false;
  return (context.evidence?.rankedReferenceCount ?? 0) === 0;
};

const hasNoReferences = (context: GuidanceContext): boolean => {
  return context.evidence?.referenceEvidenceRequired !== false && (context.evidence?.referenceCount ?? 0) === 0;
};

const hasNoRankedReferences = (context: GuidanceContext): boolean => {
  const referenceCount = context.evidence?.referenceCount ?? 0;
  if (referenceCount === 0) return false;
  return (context.evidence?.rankedReferenceCount ?? 0) === 0;
};

const hasRequiredCaptureFailure = (context: GuidanceContext): boolean => {
  if (context.evidence?.visualEvidenceRequired !== true) return false;
  const rankedReferenceCount = context.evidence.rankedReferenceCount ?? 0;
  const rankedEvidenceFailed = (context.evidence.failedCaptureCount ?? 0) > 0
    || (context.evidence.missingScreenshotCount ?? 0) > 0;
  if (rankedReferenceCount > 0) return rankedEvidenceFailed;
  return rankedEvidenceFailed
    || (context.evidence.allAttemptFailedCaptureCount ?? 0) > 0
    || (context.evidence.allAttemptMissingScreenshotCount ?? 0) > 0
    || (context.evidence.allAttemptVisualFailureCount ?? 0) > 0
    || (context.evidence.allAttemptMotionFailureCount ?? 0) > 0;
};

const positiveCount = (value: number | undefined): number => {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
};

const artifactReadyReferenceCount = (evidence: NonNullable<GuidanceContext["evidence"]>): number => (
  positiveCount(evidence.snapshotReadyReferenceCount)
  + positiveCount(evidence.motionReadyReferenceCount)
  + positiveCount(evidence.pinMediaReadyReferenceCount)
);

const hasMissingArtifactBackedAuthority = (context: GuidanceContext): boolean => {
  const evidence = context.evidence;
  if (!evidence || evidence.referenceEvidenceRequired === false) return false;
  const rankedReferenceCount = evidence.rankedReferenceCount!;
  if (typeof evidence.authoritativeReferenceCount !== "number") return true;
  return evidence.authoritativeReferenceCount < rankedReferenceCount
    || artifactReadyReferenceCount(evidence) < rankedReferenceCount;
};

const hasWeakTopReference = (context: GuidanceContext): boolean => {
  const rankedCount = context.evidence?.rankedReferenceCount ?? 0;
  if (rankedCount === 0) return false;
  const score = context.evidence?.topReferenceScore ?? 0;
  const confidence = context.evidence?.topReferenceConfidence ?? 0;
  return score < MIN_READY_REFERENCE_SCORE || confidence < MIN_READY_REFERENCE_CONFIDENCE;
};

const hasOffBriefTopReference = (context: GuidanceContext): boolean => {
  const rankedCount = context.evidence?.rankedReferenceCount ?? 0;
  return rankedCount > 0 && context.evidence?.topReferenceIntentMatched === false;
};

export const classifyGuidanceReadiness = (context: GuidanceContext): GuidanceReadiness => {
  if (context.reasonCode === "missing_input" || context.reasonCode === "missing_params") return "needs_input";
  if (context.reasonCode === "daemon_fingerprint_mismatch") return "blocked";
  if (hasProviderBlocker(context)) return "blocked";
  if (hasDiagnosticOnlyEvidence(context)) return "diagnostic_only";
  if (context.reasonCode === "artifact_authority_missing") return "needs_recovery";
  if (hasNoReferences(context)) return "needs_recovery";
  if (hasNoRankedReferences(context)) return "needs_recovery";
  if (hasRequiredCaptureFailure(context)) return "needs_recovery";
  if (hasOffBriefTopReference(context)) return "needs_recovery";
  if (hasWeakTopReference(context)) return "needs_recovery";
  if (hasMissingArtifactBackedAuthority(context)) return "needs_recovery";
  return "ready";
};

export const guidanceReadinessThresholds = {
  minReadyReferenceScore: MIN_READY_REFERENCE_SCORE,
  minReadyReferenceConfidence: MIN_READY_REFERENCE_CONFIDENCE
} as const;
