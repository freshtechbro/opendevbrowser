import { resolveSiteRecipeForProvider, resolveSiteRecipeForUrl } from "./recipes/site-registry";
import type { GuidanceContext } from "./types";

export type InspiredesignGuidanceQualitySource = {
  rankedReferenceCount: number;
  rankedReferenceUrls?: string[];
  rejectedReferenceCount: number;
  topReferenceScore?: number;
  topReferenceConfidence?: number;
  topReferenceIntentMatched?: boolean;
  diagnosticOnlyReasons: string[];
  missingScreenshotCount: number;
  allAttemptFailedCaptureCount?: number;
  allAttemptMissingScreenshotCount?: number;
  allAttemptVisualFailureCount?: number;
  allAttemptMotionFailureCount?: number;
};

export type InspiredesignReferenceUrlProvenance = {
  url: string;
  sources: string[];
  outcomes: string[];
};

export type InspiredesignGuidanceSource = {
  brief: string;
  query?: string;
  urls?: string[];
  requestedProviders: string[];
  browserMode?: string;
  cookiePolicy?: string;
  useCookies?: boolean;
  discovery: {
    requested: boolean;
    acceptedUrls: string[];
    failure?: string;
    failures: number;
    hardFailureReasonCodes?: string[];
  };
  metrics: {
    referenceCount: number;
    referenceEvidenceRequired?: boolean;
    failedCaptureCount: number;
    visualEvidenceRequired: boolean;
  };
  quality: InspiredesignGuidanceQualitySource;
  urlProvenance?: InspiredesignReferenceUrlProvenance[];
  primaryConstraint?: {
    reasonCode?: string;
    summary?: string;
  };
};

const HARD_PROVIDER_FAILURE_REASON_CODES = new Set([
  "auth_required",
  "challenge_detected",
  "policy_blocked",
  "rate_limited",
  "token_required"
]);

const normalizeComparableUrl = (value: string): string | null => {
  try {
    const url = new URL(value);
    url.protocol = "https:";
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    url.hash = "";
    url.search = "";
    return url.toString();
  } catch {
    return null;
  }
};

const hasAcceptedUserSuppliedSiteRecipeReferenceUrl = (source: InspiredesignGuidanceSource): boolean => {
  if (source.metrics.referenceCount === 0 || source.quality.rankedReferenceCount === 0) return false;
  const rankedReferenceUrls = new Set((source.quality.rankedReferenceUrls ?? [])
    .map(normalizeComparableUrl)
    .filter((url): url is string => typeof url === "string"));
  if (rankedReferenceUrls.size === 0) return false;
  const requestedSiteRecipeIds = new Set(source.requestedProviders
    .map((providerId) => resolveSiteRecipeForProvider(providerId)?.id)
    .filter((recipeId): recipeId is string => typeof recipeId === "string"));
  return (source.urls ?? []).some((url) => {
    const recipeId = resolveSiteRecipeForUrl(url)?.id;
    if (!recipeId) return false;
    if (requestedSiteRecipeIds.size > 0 && !requestedSiteRecipeIds.has(recipeId)) return false;
    const normalizedUrl = normalizeComparableUrl(url);
    return normalizedUrl !== null && rankedReferenceUrls.has(normalizedUrl);
  });
};

const hasHardProviderFailureSignal = (source: InspiredesignGuidanceSource): boolean => {
  if (hasAcceptedUserSuppliedSiteRecipeReferenceUrl(source)) return false;
  const discoveryHasHardFailure = (source.discovery.hardFailureReasonCodes ?? [])
    .some((reasonCode) => HARD_PROVIDER_FAILURE_REASON_CODES.has(reasonCode));
  const primaryConstraintHasHardFailure = source.primaryConstraint?.reasonCode
    ? HARD_PROVIDER_FAILURE_REASON_CODES.has(source.primaryConstraint.reasonCode)
    : false;
  return discoveryHasHardFailure || primaryConstraintHasHardFailure;
};

const hasProviderUnavailableSignal = (source: InspiredesignGuidanceSource): boolean => {
  if (hasHardProviderFailureSignal(source)) return true;
  if (source.metrics.referenceCount > 0 && source.quality.rankedReferenceCount > 0) return false;
  if (source.discovery.requested && source.discovery.acceptedUrls.length === 0 && source.discovery.failures > 0) return true;
  if (source.discovery.failure && source.discovery.acceptedUrls.length === 0) return true;
  return source.primaryConstraint?.reasonCode === "auth_required";
};

const hasWeakTopReference = (source: InspiredesignGuidanceSource): boolean => {
  if (source.quality.rankedReferenceCount === 0) return false;
  const score = source.quality.topReferenceScore ?? 0;
  const confidence = source.quality.topReferenceConfidence ?? 0;
  return score < 50 || confidence < 0.5;
};

const hasAllAttemptRequiredEvidenceFailure = (source: InspiredesignGuidanceSource): boolean => {
  if (source.quality.rankedReferenceCount > 0) {
    return source.metrics.failedCaptureCount > 0 || source.quality.missingScreenshotCount > 0;
  }
  const allAttemptFailedCaptureCount = source.quality.allAttemptFailedCaptureCount ?? source.metrics.failedCaptureCount;
  const allAttemptMissingScreenshotCount = source.quality.allAttemptMissingScreenshotCount ?? source.quality.missingScreenshotCount;
  return allAttemptFailedCaptureCount > 0
    || allAttemptMissingScreenshotCount > 0
    || (source.quality.allAttemptVisualFailureCount ?? 0) > 0
    || (source.quality.allAttemptMotionFailureCount ?? 0) > 0;
};

const reasonCodeForInspiredesign = (source: InspiredesignGuidanceSource): string => {
  if (hasProviderUnavailableSignal(source)) return "provider_unavailable";
  if (source.quality.diagnosticOnlyReasons.length > 0 && source.quality.rankedReferenceCount === 0) return "diagnostic_only";
  if (source.metrics.referenceCount === 0 && source.metrics.referenceEvidenceRequired !== false) return "zero_references";
  if (source.metrics.referenceCount > 0 && source.quality.rankedReferenceCount === 0) return "zero_ranked_references";
  if (source.metrics.visualEvidenceRequired && hasAllAttemptRequiredEvidenceFailure(source)) {
    return "failed_capture";
  }
  if (source.quality.topReferenceIntentMatched === false) return "off_brief_reference";
  if (hasWeakTopReference(source)) return "weak_reference";
  return "design_ready";
};

const dedupeInspiredesignReferenceUrls = (source: InspiredesignGuidanceSource): string[] => {
  const urls = [...(source.urls ?? []), ...source.discovery.acceptedUrls]
    .map((url) => url.trim())
    .filter((url) => url.length > 0);
  return [...new Set(urls)];
};

const resolveInspiredesignSiteRecipe = (source: InspiredesignGuidanceSource): string | undefined => {
  const providerRecipe = source.requestedProviders
    .map((providerId) => resolveSiteRecipeForProvider(providerId))
    .find((recipe) => recipe !== undefined);
  if (providerRecipe) return providerRecipe.id;
  const urlRecipe = (source.urls ?? [])
    .map((url) => resolveSiteRecipeForUrl(url))
    .find((recipe) => recipe !== undefined);
  return urlRecipe?.id;
};

export const createInspiredesignGuidanceContext = (
  source: InspiredesignGuidanceSource
): GuidanceContext => {
  const siteRecipeId = resolveInspiredesignSiteRecipe(source);
  const referenceUrls = dedupeInspiredesignReferenceUrls(source);
  return {
    workflow: "inspiredesign",
    reasonCode: reasonCodeForInspiredesign(source),
    requestedProviders: source.requestedProviders,
    ...(siteRecipeId ? { siteRecipeId } : {}),
    ...(source.query ? { query: source.query } : {}),
    ...(referenceUrls.length > 0 ? { referenceUrls } : {}),
    ...(source.browserMode ? { browserMode: source.browserMode } : {}),
    ...(source.cookiePolicy ? { cookiePolicy: source.cookiePolicy } : {}),
    ...(typeof source.useCookies === "boolean" ? { useCookies: source.useCookies } : {}),
    providerUnavailable: hasProviderUnavailableSignal(source),
    evidence: {
      referenceCount: source.metrics.referenceCount,
      referenceEvidenceRequired: source.metrics.referenceEvidenceRequired,
      failedCaptureCount: source.metrics.failedCaptureCount,
      visualEvidenceRequired: source.metrics.visualEvidenceRequired,
      rankedReferenceCount: source.quality.rankedReferenceCount,
      rejectedReferenceCount: source.quality.rejectedReferenceCount,
      missingScreenshotCount: source.quality.missingScreenshotCount,
      allAttemptFailedCaptureCount: source.quality.allAttemptFailedCaptureCount,
      allAttemptMissingScreenshotCount: source.quality.allAttemptMissingScreenshotCount,
      allAttemptVisualFailureCount: source.quality.allAttemptVisualFailureCount,
      allAttemptMotionFailureCount: source.quality.allAttemptMotionFailureCount,
      diagnosticOnlyReasons: source.quality.diagnosticOnlyReasons,
      ...(typeof source.quality.topReferenceScore === "number" ? { topReferenceScore: source.quality.topReferenceScore } : {}),
      ...(typeof source.quality.topReferenceConfidence === "number" ? { topReferenceConfidence: source.quality.topReferenceConfidence } : {}),
      ...(typeof source.quality.topReferenceIntentMatched === "boolean"
        ? { topReferenceIntentMatched: source.quality.topReferenceIntentMatched }
        : {})
    },
    details: {
      brief: source.brief,
      discoveryFailure: source.discovery.failure ?? "",
      hardFailureReasonCodes: source.discovery.hardFailureReasonCodes ?? [],
      referenceUrlProvenance: source.urlProvenance ?? [],
      primaryConstraintSummary: source.primaryConstraint?.summary ?? ""
    }
  };
};

export const createProviderWorkflowGuidanceContext = (reasonCode: string): GuidanceContext => ({
  workflow: "provider",
  reasonCode
});

export const createCanvasGuidanceContext = (reasonCode: string): GuidanceContext => ({
  workflow: "canvas",
  reasonCode
});

export const createDaemonGuidanceContext = (reasonCode: string): GuidanceContext => ({
  workflow: "daemon",
  reasonCode
});

export const createCliValidationGuidanceContext = (reasonCode: string): GuidanceContext => ({
  workflow: "cli",
  reasonCode
});
