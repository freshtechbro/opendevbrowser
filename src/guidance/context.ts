import { resolveSiteRecipeForProvider, resolveSiteRecipeForUrl } from "./recipes/site-registry";
import type { GuidanceContext } from "./types";

export type InspiredesignGuidanceQualitySource = {
  rankedReferenceCount: number;
  rejectedReferenceCount: number;
  topReferenceScore?: number;
  topReferenceConfidence?: number;
  topReferenceIntentMatched?: boolean;
  diagnosticOnlyReasons: string[];
  missingScreenshotCount: number;
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
  };
  metrics: {
    referenceCount: number;
    referenceEvidenceRequired?: boolean;
    failedCaptureCount: number;
    visualEvidenceRequired: boolean;
  };
  quality: InspiredesignGuidanceQualitySource;
  primaryConstraint?: {
    reasonCode?: string;
    summary?: string;
  };
};

const hasProviderUnavailableSignal = (source: InspiredesignGuidanceSource): boolean => {
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

const reasonCodeForInspiredesign = (source: InspiredesignGuidanceSource): string => {
  if (hasProviderUnavailableSignal(source)) return "provider_unavailable";
  if (source.quality.diagnosticOnlyReasons.length > 0 && source.quality.rankedReferenceCount === 0) return "diagnostic_only";
  if (source.metrics.referenceCount === 0 && source.metrics.referenceEvidenceRequired !== false) return "zero_references";
  if (source.metrics.referenceCount > 0 && source.quality.rankedReferenceCount === 0) return "zero_ranked_references";
  if (
    source.metrics.visualEvidenceRequired
    && (source.metrics.failedCaptureCount > 0 || source.quality.missingScreenshotCount > 0)
  ) {
    return "failed_capture";
  }
  if (source.quality.topReferenceIntentMatched === false) return "off_brief_reference";
  if (hasWeakTopReference(source)) return "weak_reference";
  return "design_ready";
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
  return {
    workflow: "inspiredesign",
    reasonCode: reasonCodeForInspiredesign(source),
    requestedProviders: source.requestedProviders,
    ...(siteRecipeId ? { siteRecipeId } : {}),
    ...(source.query ? { query: source.query } : {}),
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
