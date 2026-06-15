import type { ShoppingOffer } from "../renderer";

export type ShoppingReadinessGateStatus = "pass" | "partial" | "fail";
export type ShoppingConfidenceLabel = "high" | "medium" | "low";
export type ShoppingFreshnessStatus = "observed" | "inferred" | "missing" | "stale" | "future";
export type ShoppingQueryRelevanceStatus = "strong" | "adequate" | "weak";
export type ShoppingTitleQualityStatus = "usable" | "suspicious";
export type ShoppingOfferRecommendation = "recommended" | "candidate" | "constrained" | "excluded";
export type ShoppingRegionAuthority = "authoritative" | "advisory" | "missing";
export type ShoppingMarketBaselineStatus = "computed" | "unavailable";

export interface ShoppingBriefingInput {
  query: string;
  offers: ShoppingOffer[];
  meta: Record<string, unknown>;
  artifactFiles?: readonly string[];
  freshnessReferenceIso?: string;
  freshnessStaleAfterDays?: number;
  marketBaselineMinSample?: number;
}

export interface ShoppingBriefingCriterion {
  label: string;
  observed: string;
  threshold: string;
  passed: boolean;
}

export interface ShoppingReadinessGate {
  status: ShoppingReadinessGateStatus;
  summary: string;
  criteria: ShoppingBriefingCriterion[];
}

export interface ShoppingReportMetaView {
  primaryConstraintSummary?: string;
  selectedProviders: string[];
  requestedRegion?: string;
  regionAuthority: ShoppingRegionAuthority;
  totalOffers?: number;
  candidateOffers?: number;
  failedProviders: string[];
  alerts: Array<Record<string, unknown>>;
  failures: Array<Record<string, unknown>>;
  offerFilterDiagnostics: Array<Record<string, unknown>>;
  malformedMetadata: string[];
}

export interface ShoppingMoneyEvidence {
  amount: number;
  currency: string;
}

export interface ShoppingFreshnessEvidence {
  status: ShoppingFreshnessStatus;
  label: string;
  source: string;
  retrievedAt?: string;
  ageDays?: number;
}

export interface ShoppingQueryRelevance {
  status: ShoppingQueryRelevanceStatus;
  score: number;
  matchedTokens: string[];
  missingTokens: string[];
  reasons: string[];
}

export interface ShoppingTitleQuality {
  status: ShoppingTitleQualityStatus;
  reasons: string[];
}

export interface ShoppingPriceValidity {
  status: "valid" | "invalid";
  reasons: string[];
}

export interface ShoppingReportOfferEvidence {
  offer: ShoppingOffer;
  offerId: string;
  productId: string;
  provider: string;
  title: string;
  url: string;
  canonicalUrl: string;
  totalPrice: ShoppingMoneyEvidence;
  itemPrice: ShoppingMoneyEvidence;
  shippingPrice: ShoppingMoneyEvidence;
  currencyMismatch: boolean;
  availability: ShoppingOffer["availability"];
  rating: number;
  reviewsCount: number;
  dealScore: number;
  retrievalPath?: string;
  priceSource?: string;
  priceTrust: "trusted" | "untrusted" | "unknown";
  brand?: string;
  anchorPrice?: ShoppingMoneyEvidence;
  freshness: ShoppingFreshnessEvidence;
  queryRelevance: ShoppingQueryRelevance;
  titleQuality: ShoppingTitleQuality;
  priceValidity: ShoppingPriceValidity;
  buyerLimitations: string[];
}

export interface ShoppingDuplicateGroup {
  groupId: string;
  reason: "same_url" | "same_title" | "same_product";
  title: string;
  offerIds: string[];
  urls: string[];
}

export interface ShoppingOfferAssessment {
  evidence: ShoppingReportOfferEvidence;
  rank: number;
  recommendation: ShoppingOfferRecommendation;
  reasons: string[];
  warnings: string[];
  duplicateGroupIds: string[];
  inMarketBaseline: boolean;
  qualityScore: number;
  anchorDiscount?: {
    amount: number;
    percent: number;
  };
}

export interface ShoppingMarketBaseline {
  status: ShoppingMarketBaselineStatus;
  reason: string;
  minSample: number;
  currency?: string;
  sampleCount: number;
  averageTotal?: number;
  medianTotal?: number;
  lowestTotal?: number;
  offerIds: string[];
  excludedDifferentCurrencyCount: number;
  anchorEvidenceCount: number;
}

export interface ShoppingBriefing {
  query: string;
  artifactFiles: string[];
  metaView: ShoppingReportMetaView;
  gate: ShoppingReadinessGate;
  confidence: ShoppingConfidenceLabel;
  assessments: ShoppingOfferAssessment[];
  duplicateGroups: ShoppingDuplicateGroup[];
  marketBaseline: ShoppingMarketBaseline;
  recommendation: string[];
  warnings: string[];
  constrainedOffers: ShoppingOfferAssessment[];
  evidence: ShoppingReportOfferEvidence[];
}
