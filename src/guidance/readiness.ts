import type { GuidanceContext, GuidanceReadiness } from "./types";

const MIN_READY_REFERENCE_SCORE = 50;
const MIN_READY_REFERENCE_CONFIDENCE = 0.5;

const hasProviderBlocker = (context: GuidanceContext): boolean => {
  if (context.providerUnavailable === true) return true;
  return context.reasonCode === "provider_unavailable" || context.reasonCode === "auth_required";
};

const hasDiagnosticOnlyEvidence = (context: GuidanceContext): boolean => {
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
  return (context.evidence.failedCaptureCount ?? 0) > 0 || (context.evidence.missingScreenshotCount ?? 0) > 0;
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
  if (hasNoReferences(context)) return "needs_recovery";
  if (hasNoRankedReferences(context)) return "needs_recovery";
  if (hasRequiredCaptureFailure(context)) return "needs_recovery";
  if (hasOffBriefTopReference(context)) return "needs_recovery";
  if (hasWeakTopReference(context)) return "needs_recovery";
  return "ready";
};

export const guidanceReadinessThresholds = {
  minReadyReferenceScore: MIN_READY_REFERENCE_SCORE,
  minReadyReferenceConfidence: MIN_READY_REFERENCE_CONFIDENCE
} as const;
