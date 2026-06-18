export { buildProductVideoPresentation } from "./synthesis";
export { evaluateProductVideoPresentationReadiness, evaluateProductVideoReadiness } from "./gate";
export { countPublicProductVideoIdentityViolations, countPublicProductVideoTextViolations } from "./rules";
export { renderProductVideoCopyMarkdown, renderProductVideoFeaturesMarkdown } from "./render";
export type {
  ProductVideoCandidateSource,
  ProductVideoCandidateSummary,
  ProductVideoEvidenceReference,
  ProductVideoJsonValue,
  ProductVideoPresentation,
  ProductVideoPresentationCriterion,
  ProductVideoPresentationInput,
  ProductVideoPresentationMetadata,
  ProductVideoPresentationReasonCode,
  ProductVideoPresentationSourceRecord,
  ProductVideoPriceEvidence,
  ProductVideoPromotedClaim,
  ProductVideoReadinessStatus,
  ProductVideoReadinessSummary,
  ProductVideoRejectedCandidate,
  ProductVideoSpecMap,
  ProductVideoSpecValue,
  ProductVideoSupportedSpecKey
} from "./types";
