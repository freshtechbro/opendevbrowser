import type { JsonValue, NormalizedRecord } from "../types";

export type ProductVideoReadinessStatus = "pass" | "partial" | "fail";

export type ProductVideoPresentationReasonCode =
  | "marketplace_chrome_rejected"
  | "positive_spec_promoted"
  | "insufficient_clean_feature_evidence"
  | "copy_omitted_by_request"
  | "missing_visual_assets"
  | "unsupported_claim_rejected"
  | "raw_fragment_rejected"
  | "selected_record_changed"
  | "copy_generation_blocked";

export type ProductVideoSupportedSpecKey = "type" | "maximum_dpi" | "connectivity" | "features";

export type ProductVideoPresentationSourceRecord = Pick<
  NormalizedRecord,
  "id" | "provider" | "url" | "title" | "content" | "attributes"
>;

export type ProductVideoCandidateSource =
  | "source_content"
  | "source_attribute"
  | "metadata_description"
  | "metadata_feature"
  | "feature_candidate"
  | "copy_candidate";

export interface ProductVideoPriceEvidence {
  amount: number;
  currency: string;
  formatted?: string;
}

export type ProductVideoSpecValue = string | number | readonly string[];
export type ProductVideoSpecMap = Readonly<Record<string, ProductVideoSpecValue>>;

export interface ProductVideoPresentationMetadata {
  description?: string;
  features?: readonly string[];
  specs?: ProductVideoSpecMap;
}

export interface ProductVideoCandidateSummary {
  recordId?: string;
  provider?: string;
  title?: string;
  cleanSpecCount: number;
  rejectedCandidateCount: number;
}

export interface ProductVideoPresentationInput {
  title: string;
  brand?: string;
  provider?: string;
  productUrl?: string;
  price?: ProductVideoPriceEvidence;
  includeCopy: boolean;
  images?: readonly string[];
  screenshots?: readonly string[];
  sourceRecord?: ProductVideoPresentationSourceRecord;
  metadata?: ProductVideoPresentationMetadata;
  featureCandidates?: readonly string[];
  copyCandidates?: readonly string[];
  selectedRecordId?: string;
  originalPrimaryRecordId?: string;
  candidateSummaries?: readonly ProductVideoCandidateSummary[];
}

export interface ProductVideoPresentationCriterion {
  label: string;
  observed: string;
  threshold: string;
  passed: boolean;
}

export interface ProductVideoReadinessSummary {
  status: ProductVideoReadinessStatus;
  warnings: string[];
  reasonCodes: ProductVideoPresentationReasonCode[];
  criteria: ProductVideoPresentationCriterion[];
}

export interface ProductVideoEvidenceReference {
  recordId?: string;
  provider?: string;
  source: ProductVideoCandidateSource;
  path: string;
  label: string;
  excerpt: string;
}

export interface ProductVideoPromotedClaim {
  claim: string;
  specKey: ProductVideoSupportedSpecKey;
  specLabel: string;
  specValue: string;
  reasonCode: "positive_spec_promoted";
  evidenceReferences: ProductVideoEvidenceReference[];
}

export interface ProductVideoRejectedCandidate {
  candidate: string;
  source: ProductVideoCandidateSource;
  reasonCode: ProductVideoPresentationReasonCode;
  reason: string;
  evidenceReferences: ProductVideoEvidenceReference[];
}

export interface ProductVideoPresentation {
  title: string;
  brand?: string;
  provider?: string;
  productUrl?: string;
  price?: ProductVideoPriceEvidence;
  copy: string;
  features: string[];
  copyMarkdown: string;
  featuresMarkdown: string;
  presentationReadiness: ProductVideoReadinessSummary;
  productVideoReadiness: ProductVideoReadinessSummary;
  promotedClaims: ProductVideoPromotedClaim[];
  rejectedCandidates: ProductVideoRejectedCandidate[];
  evidenceReferences: ProductVideoEvidenceReference[];
  candidateSummaries: ProductVideoCandidateSummary[];
}

export type ProductVideoJsonValue = JsonValue;
