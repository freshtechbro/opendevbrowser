import type {
  ProductVideoPresentationCriterion,
  ProductVideoPresentationReasonCode,
  ProductVideoReadinessSummary
} from "./types";
import { PRODUCT_VIDEO_MIN_PASS_PROMOTED_CLAIMS, PRODUCT_VIDEO_MIN_PARTIAL_PROMOTED_CLAIMS } from "./rules";

export interface ProductVideoReadinessFacts {
  includeCopy: boolean;
  promotedClaimCount: number;
  visualAssetCount: number;
  marketplaceRejectedCount: number;
  unsupportedRejectedCount: number;
  finalMarketplaceLeakCount: number;
  selectedRecordChanged: boolean;
}

const criterion = (args: ProductVideoPresentationCriterion): ProductVideoPresentationCriterion => args;

const readinessStatus = (facts: ProductVideoReadinessFacts): ProductVideoReadinessSummary["status"] => {
  if (facts.promotedClaimCount < PRODUCT_VIDEO_MIN_PARTIAL_PROMOTED_CLAIMS || facts.finalMarketplaceLeakCount > 0) return "fail";
  if (!facts.includeCopy || facts.promotedClaimCount < PRODUCT_VIDEO_MIN_PASS_PROMOTED_CLAIMS || facts.visualAssetCount === 0) return "partial";
  return "pass";
};

const readinessWarnings = (facts: ProductVideoReadinessFacts): string[] => [
  ...(facts.marketplaceRejectedCount > 0 ? [`rejected ${facts.marketplaceRejectedCount} marketplace chrome candidate(s) from presentation output`] : []),
  ...(facts.unsupportedRejectedCount > 0 ? [`rejected ${facts.unsupportedRejectedCount} unsupported presentation claim candidate(s)`] : []),
  ...(facts.promotedClaimCount < PRODUCT_VIDEO_MIN_PASS_PROMOTED_CLAIMS
    ? [`fewer than ${PRODUCT_VIDEO_MIN_PASS_PROMOTED_CLAIMS} clean product benefit claims were promoted`]
    : []),
  ...(!facts.includeCopy ? ["creative copy was omitted because include_copy=false"] : []),
  ...(facts.visualAssetCount === 0 ? ["visual assets are missing from the presentation pack"] : []),
  ...(facts.finalMarketplaceLeakCount > 0 ? ["marketplace chrome appeared in generated presentation text"] : []),
  ...(facts.selectedRecordChanged ? ["presentation source record changed from the original primary record"] : [])
];

const uniqueReasonCodes = (codes: readonly ProductVideoPresentationReasonCode[]): ProductVideoPresentationReasonCode[] => (
  Array.from(new Set(codes))
);

const readinessReasonCodes = (facts: ProductVideoReadinessFacts): ProductVideoPresentationReasonCode[] => uniqueReasonCodes([
  ...(facts.marketplaceRejectedCount > 0 || facts.finalMarketplaceLeakCount > 0 ? ["marketplace_chrome_rejected" as const] : []),
  ...(facts.promotedClaimCount > 0 ? ["positive_spec_promoted" as const] : []),
  ...(facts.promotedClaimCount < PRODUCT_VIDEO_MIN_PASS_PROMOTED_CLAIMS ? ["insufficient_clean_feature_evidence" as const] : []),
  ...(!facts.includeCopy ? ["copy_omitted_by_request" as const] : []),
  ...(facts.visualAssetCount === 0 ? ["missing_visual_assets" as const] : []),
  ...(facts.unsupportedRejectedCount > 0 ? ["unsupported_claim_rejected" as const] : []),
  ...(facts.selectedRecordChanged ? ["selected_record_changed" as const] : []),
  ...(facts.includeCopy && (facts.promotedClaimCount === 0 || facts.finalMarketplaceLeakCount > 0) ? ["copy_generation_blocked" as const] : [])
]);

const readinessCriteria = (facts: ProductVideoReadinessFacts): ProductVideoPresentationCriterion[] => [
  criterion({
    label: "Clean benefit evidence",
    observed: `${facts.promotedClaimCount} promoted claim(s)`,
    threshold: `At least ${PRODUCT_VIDEO_MIN_PASS_PROMOTED_CLAIMS} promoted product benefit claims for pass`,
    passed: facts.promotedClaimCount >= PRODUCT_VIDEO_MIN_PASS_PROMOTED_CLAIMS
  }),
  criterion({
    label: "Marketplace chrome isolation",
    observed: `${facts.marketplaceRejectedCount} rejected candidate(s), ${facts.finalMarketplaceLeakCount} generated leak(s)`,
    threshold: "No marketplace, checkout, shipping, condition, seller, or returns text in generated output",
    passed: facts.finalMarketplaceLeakCount === 0
  }),
  criterion({
    label: "Copy generation",
    observed: facts.includeCopy ? "copy requested" : "copy omitted by request",
    threshold: "Copy is requested and clean evidence is available",
    passed: facts.includeCopy && facts.promotedClaimCount > 0 && facts.finalMarketplaceLeakCount === 0
  }),
  criterion({
    label: "Visual assets",
    observed: `${facts.visualAssetCount} image or screenshot asset(s)`,
    threshold: "At least 1 visual asset for presentation-ready output",
    passed: facts.visualAssetCount > 0
  }),
  criterion({
    label: "Unsupported claim rejection",
    observed: `${facts.unsupportedRejectedCount} unsupported candidate(s) rejected`,
    threshold: "Unsupported claims are excluded from generated output",
    passed: true
  })
];

export const evaluateProductVideoPresentationReadiness = (
  facts: ProductVideoReadinessFacts
): ProductVideoReadinessSummary => ({
  status: readinessStatus(facts),
  warnings: readinessWarnings(facts),
  reasonCodes: readinessReasonCodes(facts),
  criteria: readinessCriteria(facts)
});

export const evaluateProductVideoReadiness = evaluateProductVideoPresentationReadiness;
