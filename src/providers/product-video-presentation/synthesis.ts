import { evaluateProductVideoPresentationReadiness } from "./gate";
import {
  collectProductVideoEvidence,
  isMarketplaceChromeText,
  normalizeProductVideoText,
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

const visualAssetCount = (input: ProductVideoPresentationInput): number => (
  (input.images?.length ?? 0) + (input.screenshots?.length ?? 0)
);

const selectedRecordChanged = (input: ProductVideoPresentationInput): boolean => (
  Boolean(input.selectedRecordId && input.originalPrimaryRecordId && input.selectedRecordId !== input.originalPrimaryRecordId)
);

const cleanTitleCandidate = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  const normalized = normalizeProductVideoText(value);
  return normalized && !isMarketplaceChromeText(normalized) ? normalized : undefined;
};

const presentationTitle = (input: ProductVideoPresentationInput): string => (
  cleanTitleCandidate(input.title)
  ?? cleanTitleCandidate(input.sourceRecord?.title)
  ?? cleanTitleCandidate(input.productUrl)
  ?? DEFAULT_PRESENTATION_TITLE
);

const generatedLeakCount = (
  title: string,
  promotedClaims: readonly ProductVideoPromotedClaim[]
): number => [title, ...promotedClaims.map((claim) => claim.claim)].filter(isMarketplaceChromeText).length;

const evidenceReferences = (
  promotedClaims: readonly ProductVideoPromotedClaim[]
) => promotedClaims.flatMap((claim) => claim.evidenceReferences);

const defaultCandidateSummaries = (
  input: ProductVideoPresentationInput,
  cleanSpecCount: number,
  rejectedCandidateCount: number
): ProductVideoCandidateSummary[] => {
  if (input.candidateSummaries) return [...input.candidateSummaries];
  if (!input.sourceRecord) return [];
  return [{
    recordId: input.sourceRecord.id,
    provider: input.sourceRecord.provider,
    ...(input.sourceRecord.title ? { title: input.sourceRecord.title } : {}),
    cleanSpecCount,
    rejectedCandidateCount
  }];
};

export const buildProductVideoPresentation = (input: ProductVideoPresentationInput): ProductVideoPresentation => {
  const evidence = collectProductVideoEvidence(input);
  const promotedClaims = evidence.specs.map(promoteProductVideoSpec);
  const title = presentationTitle(input);
  const readiness = evaluateProductVideoPresentationReadiness({
    includeCopy: input.includeCopy,
    promotedClaimCount: promotedClaims.length,
    visualAssetCount: visualAssetCount(input),
    marketplaceRejectedCount: evidence.marketplaceRejectedCount,
    unsupportedRejectedCount: evidence.unsupportedRejectedCount,
    finalMarketplaceLeakCount: generatedLeakCount(title, promotedClaims),
    selectedRecordChanged: selectedRecordChanged(input)
  });
  const outputClaims = readiness.status === "fail" ? [] : promotedClaims;
  const features = outputClaims.map((claim) => claim.claim);
  const copy = readiness.status === "fail" ? "" : buildProductVideoCopyText({ title, includeCopy: input.includeCopy, promotedClaims: outputClaims });
  return {
    title,
    ...(input.brand ? { brand: input.brand } : {}),
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
