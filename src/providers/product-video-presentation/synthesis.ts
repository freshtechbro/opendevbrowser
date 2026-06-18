import { evaluateProductVideoPresentationReadiness } from "./gate";
import {
  collectProductVideoEvidence,
  countPublicProductVideoIdentityViolations,
  countPublicProductVideoTextViolations,
  normalizeProductVideoText,
  publicProductVideoIdentityViolationReason,
  promoteProductVideoSpec
} from "./rules";
import {
  buildProductVideoCopyText,
  renderProductVideoCopyMarkdown,
  renderProductVideoFeaturesMarkdown
} from "./render";
import type {
  ProductVideoCandidateSummary,
  ProductVideoPresentation,
  ProductVideoPresentationInput,
  ProductVideoPromotedClaim
} from "./types";

const DEFAULT_PRESENTATION_TITLE = "Product";
const URL_TITLE_RE = /^https?:\/\/\S+$/i;
const MARKETPLACE_TITLE_CAVEAT_PATTERNS = [
  /\s*(?:[-,:;|]|\u2013|\u2014)\s*\*?\s*no\s+(?:usb\s+)?(?:dongle|receiver)\s*\*?(?=\s*(?:$|[-,:;|.!?)]|\u2013|\u2014))/giu,
  /\s*[\[(]\s*\*?\s*no\s+(?:usb\s+)?(?:dongle|receiver)\s*\*?\s*[\])]\s*/giu,
  /(?:^|\s+)\*?\s*no\s+(?:usb\s+)?(?:dongle|receiver)\s*\*?(?=\s*(?:$|[.!?]))/giu
] as const;
const TITLE_BOUNDARY_SEPARATOR_RE = /^[\s*,;:|*-]+|[\s*,;:|*-]+$/gu;

const visualAssetCount = (input: ProductVideoPresentationInput): number => (
  (input.images?.length ?? 0) + (input.screenshots?.length ?? 0)
);

const selectedRecordChanged = (input: ProductVideoPresentationInput): boolean => (
  Boolean(input.selectedRecordId && input.originalPrimaryRecordId && input.selectedRecordId !== input.originalPrimaryRecordId)
);

const stripMarketplaceTitleCaveats = (value: string): string => {
  let candidate = value;
  for (const pattern of MARKETPLACE_TITLE_CAVEAT_PATTERNS) {
    candidate = candidate.replace(pattern, " ");
  }
  return normalizeProductVideoText(candidate)
    .replace(/\s+([,;:.!?])/gu, "$1")
    .replace(TITLE_BOUNDARY_SEPARATOR_RE, "")
    .trim();
};

const cleanTitleCandidate = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  const normalized = stripMarketplaceTitleCaveats(normalizeProductVideoText(value));
  return normalized && !URL_TITLE_RE.test(normalized) && !publicProductVideoIdentityViolationReason(normalized) ? normalized : undefined;
};

const cleanBrandCandidate = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  const normalized = normalizeProductVideoText(value);
  return normalized && !publicProductVideoIdentityViolationReason(normalized) ? normalized : undefined;
};

const cleanPresentationTitle = (input: ProductVideoPresentationInput): string | undefined => (
  cleanTitleCandidate(input.title)
  ?? cleanTitleCandidate(input.sourceRecord?.title)
);

const evidenceReferences = (
  promotedClaims: readonly ProductVideoPromotedClaim[]
) => promotedClaims.flatMap((claim) => claim.evidenceReferences);

const promotedSpecKeyCount = (promotedClaims: readonly ProductVideoPromotedClaim[]): number => (
  new Set(promotedClaims.map((claim) => claim.specKey)).size
);

const countFinalPublicTextViolations = (args: {
  title: string;
  brand?: string;
  copy: string;
  features: readonly string[];
}) => {
  const counts = countPublicProductVideoTextViolations([args.copy, ...args.features]);
  const identityCounts = countPublicProductVideoIdentityViolations([args.title, ...(args.brand ? [args.brand] : [])]);
  counts.marketplace += identityCounts.marketplace;
  counts.siteChrome += identityCounts.siteChrome;
  counts.unsupported += identityCounts.unsupported;
  counts.rawFragment += identityCounts.rawFragment;
  return counts;
};

const cleanCandidateSummary = (
  summary: ProductVideoCandidateSummary
): ProductVideoCandidateSummary => {
  const title = cleanTitleCandidate(summary.title);
  return {
    ...(summary.recordId ? { recordId: summary.recordId } : {}),
    ...(summary.provider ? { provider: summary.provider } : {}),
    ...(title ? { title } : {}),
    cleanSpecCount: summary.cleanSpecCount,
    rejectedCandidateCount: summary.rejectedCandidateCount
  };
};

const defaultCandidateSummaries = (
  input: ProductVideoPresentationInput,
  cleanSpecCount: number,
  rejectedCandidateCount: number
): ProductVideoCandidateSummary[] => {
  if (input.candidateSummaries) return input.candidateSummaries.map(cleanCandidateSummary);
  if (!input.sourceRecord) return [];
  const title = cleanTitleCandidate(input.sourceRecord.title);
  return [{
    recordId: input.sourceRecord.id,
    provider: input.sourceRecord.provider,
    ...(title ? { title } : {}),
    cleanSpecCount,
    rejectedCandidateCount
  }];
};

export const buildProductVideoPresentation = (input: ProductVideoPresentationInput): ProductVideoPresentation => {
  const evidence = collectProductVideoEvidence(input);
  const promotedClaims = evidence.specs.map(promoteProductVideoSpec);
  const cleanTitle = cleanPresentationTitle(input);
  const title = cleanTitle ?? DEFAULT_PRESENTATION_TITLE;
  const brand = cleanBrandCandidate(input.brand);
  const prospectiveFeatures = promotedClaims.map((claim) => claim.claim);
  const prospectiveCopy = buildProductVideoCopyText({ title, includeCopy: input.includeCopy, promotedClaims });
  const finalLeakCounts = countFinalPublicTextViolations({
    title,
    ...(brand ? { brand } : {}),
    copy: prospectiveCopy,
    features: prospectiveFeatures
  });
  const readiness = evaluateProductVideoPresentationReadiness({
    includeCopy: input.includeCopy,
    promotedClaimCount: promotedClaims.length,
    promotedSpecKeyCount: promotedSpecKeyCount(promotedClaims),
    visualAssetCount: visualAssetCount(input),
    marketplaceRejectedCount: evidence.marketplaceRejectedCount,
    siteChromeRejectedCount: evidence.siteChromeRejectedCount,
    unsupportedRejectedCount: evidence.unsupportedRejectedCount,
    rawFragmentRejectedCount: evidence.rawFragmentRejectedCount,
    finalMarketplaceLeakCount: finalLeakCounts.marketplace,
    finalSiteChromeLeakCount: finalLeakCounts.siteChrome,
    finalUnsupportedClaimLeakCount: finalLeakCounts.unsupported,
    finalRawFragmentLeakCount: finalLeakCounts.rawFragment,
    selectedRecordChanged: selectedRecordChanged(input),
    titleFallbackUsed: !cleanTitle
  });
  const features = readiness.status === "fail" ? [] : prospectiveFeatures;
  const copy = readiness.status === "fail" ? "" : prospectiveCopy;
  return {
    title,
    ...(brand ? { brand } : {}),
    ...(input.provider ? { provider: input.provider } : {}),
    ...(input.productUrl ? { productUrl: input.productUrl } : {}),
    ...(input.price ? { price: input.price } : {}),
    copy,
    features,
    copyMarkdown: renderProductVideoCopyMarkdown({ title, copy, includeCopy: input.includeCopy, readiness }),
    featuresMarkdown: renderProductVideoFeaturesMarkdown({ features, readiness }),
    presentationReadiness: readiness,
    productVideoReadiness: readiness,
    promotedClaims,
    rejectedCandidates: evidence.rejectedCandidates,
    evidenceReferences: evidenceReferences(promotedClaims),
    candidateSummaries: defaultCandidateSummaries(input, evidence.specs.length, evidence.rejectedCandidates.length)
  };
};
