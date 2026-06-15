import { evaluateShoppingReadinessGate } from "./gate";
import {
  DEFAULT_MARKET_BASELINE_MIN_SAMPLE,
  DEFAULT_SHOPPING_ARTIFACT_FILES,
  DEFAULT_STALE_PRICE_AFTER_DAYS,
  anchorDiscountForOffer,
  buildDuplicateGroups,
  buildMarketBaseline,
  buildShoppingOfferEvidence,
  buildShoppingReportMetaView
} from "./rules";
import type {
  ShoppingBriefing,
  ShoppingBriefingInput,
  ShoppingConfidenceLabel,
  ShoppingDuplicateGroup,
  ShoppingOfferAssessment,
  ShoppingMarketBaseline,
  ShoppingOfferRecommendation,
  ShoppingReportOfferEvidence
} from "./types";

const duplicateIdsForOffer = (
  offerId: string,
  groups: readonly ShoppingDuplicateGroup[]
): string[] => groups.filter((group) => group.offerIds.includes(offerId)).map((group) => group.groupId);

const availabilityWarnings = (evidence: ShoppingReportOfferEvidence): string[] => {
  if (evidence.availability === "unknown") return ["unknown availability limits buying confidence"];
  if (evidence.availability === "out_of_stock") return ["out-of-stock offer cannot be promoted"];
  return [];
};

const freshnessWarnings = (evidence: ShoppingReportOfferEvidence): string[] => {
  if (evidence.freshness.status === "observed") return [];
  return [`price freshness ${evidence.freshness.status}: ${evidence.freshness.label}`];
};

const qualityWarnings = (evidence: ShoppingReportOfferEvidence): string[] => [
  ...evidence.queryRelevance.reasons.map((reason) => `weak relevance: ${reason}`),
  ...evidence.titleQuality.reasons.map((reason) => `suspicious title: ${reason}`),
  ...(evidence.priceTrust === "untrusted" ? ["price source is marked untrusted"] : []),
  ...(evidence.priceTrust === "unknown" ? ["price trust was not reported"] : []),
  ...evidence.priceValidity.reasons.map((reason) => `invalid price: ${reason}`),
  ...(evidence.currencyMismatch ? ["item and shipping currencies differ; total price is unavailable"] : [])
];

const marketWarnings = (
  marketBaseline: ShoppingMarketBaseline
): string[] => (
  marketBaseline.status === "unavailable" && marketBaseline.excludedDifferentCurrencyCount > 0
    ? ["mixed-currency market baseline unavailable; compare candidates by currency before buying"]
    : []
);

const recommendationForWarnings = (args: {
  evidence: ShoppingReportOfferEvidence;
  warnings: readonly string[];
  duplicateGroupIds: readonly string[];
  inMarketBaseline: boolean;
}): ShoppingOfferRecommendation => {
  if (args.evidence.priceValidity.status === "invalid") return "excluded";
  if (args.evidence.availability === "out_of_stock") return "excluded";
  if (args.evidence.queryRelevance.status === "weak") return "excluded";
  if (args.evidence.titleQuality.status === "suspicious") return "excluded";
  if (args.warnings.length > 0 || args.duplicateGroupIds.length > 0) return "constrained";
  return args.inMarketBaseline ? "recommended" : "candidate";
};

const assessOffer = (args: {
  evidence: ShoppingReportOfferEvidence;
  duplicateGroups: readonly ShoppingDuplicateGroup[];
  marketBaseline: ShoppingMarketBaseline;
  rank: number;
}): ShoppingOfferAssessment => {
  const duplicateGroupIds = duplicateIdsForOffer(args.evidence.offerId, args.duplicateGroups);
  const duplicateWarnings = duplicateGroupIds.length > 0 ? ["duplicate pressure: same product or title appears in multiple URLs"] : [];
  const inMarketBaseline = args.marketBaseline.offerIds.includes(args.evidence.offerId);
  const warnings = [
    ...availabilityWarnings(args.evidence),
    ...freshnessWarnings(args.evidence),
    ...qualityWarnings(args.evidence),
    ...duplicateWarnings,
    ...marketWarnings(args.marketBaseline)
  ];
  const recommendation = recommendationForWarnings({
    evidence: args.evidence,
    warnings,
    duplicateGroupIds,
    inMarketBaseline
  });
  return {
    evidence: args.evidence,
    rank: args.rank,
    recommendation,
    reasons: recommendationReasons(recommendation, args.evidence),
    warnings,
    duplicateGroupIds,
    inMarketBaseline,
    qualityScore: qualityScoreForAssessment(args.evidence, warnings, inMarketBaseline),
    ...(anchorDiscountForOffer(args.evidence) ? { anchorDiscount: anchorDiscountForOffer(args.evidence) } : {})
  };
};

const qualityScoreForAssessment = (
  evidence: ShoppingReportOfferEvidence,
  warnings: readonly string[],
  inMarketBaseline: boolean
): number => {
  let score = evidence.dealScore * 100;
  if (inMarketBaseline) score += 50;
  if (evidence.freshness.status === "observed") score += 20;
  if (evidence.queryRelevance.status === "strong") score += 20;
  if (evidence.availability === "in_stock") score += 10;
  if (evidence.availability === "limited") score += 5;
  if (evidence.priceTrust === "trusted") score += 10;
  const totalPenalty = Number.isFinite(evidence.totalPrice.amount) ? evidence.totalPrice.amount / 100 : 1000;
  return score - warnings.length * 25 - totalPenalty;
};

const recommendationTierScore = (recommendation: ShoppingOfferRecommendation): number => {
  if (recommendation === "recommended") return 0;
  if (recommendation === "candidate") return 1;
  if (recommendation === "constrained") return 2;
  return 3;
};

const sortAssessments = (assessments: readonly ShoppingOfferAssessment[]): ShoppingOfferAssessment[] => (
  [...assessments]
    .sort((left, right) => {
      const tierDelta = recommendationTierScore(left.recommendation) - recommendationTierScore(right.recommendation);
      if (tierDelta !== 0) return tierDelta;
      const qualityDelta = right.qualityScore - left.qualityScore;
      if (qualityDelta !== 0) return qualityDelta;
      const leftTotal = Number.isFinite(left.evidence.totalPrice.amount) ? left.evidence.totalPrice.amount : Number.MAX_SAFE_INTEGER;
      const rightTotal = Number.isFinite(right.evidence.totalPrice.amount) ? right.evidence.totalPrice.amount : Number.MAX_SAFE_INTEGER;
      const totalDelta = leftTotal - rightTotal;
      if (totalDelta !== 0) return totalDelta;
      return left.rank - right.rank;
    })
    .map((assessment, index) => ({ ...assessment, rank: index + 1 }))
);

const recommendationReasons = (
  recommendation: ShoppingOfferRecommendation,
  evidence: ShoppingReportOfferEvidence
): string[] => {
  if (recommendation === "recommended") return ["fresh observed price, usable title, relevant query fit, available stock, and same-currency baseline membership"];
  if (recommendation === "candidate") return ["candidate evidence is usable but market baseline is not strong enough for higher confidence"];
  if (recommendation === "constrained") return ["candidate is constrained by warnings listed below"];
  if (evidence.priceValidity.status === "invalid") return ["excluded because price evidence is invalid"];
  if (evidence.availability === "out_of_stock") return ["excluded because availability is out of stock"];
  if (evidence.queryRelevance.status === "weak") return ["excluded because query relevance is weak"];
  return ["excluded because title quality is suspicious"];
};

const uniqueLines = (lines: readonly string[]): string[] => Array.from(new Set(lines));

const baselineWarnings = (baseline: ShoppingMarketBaseline): string[] => {
  if (baseline.status !== "computed") {
    return [
      "market baseline unavailable because same-currency evidence is insufficient",
      ...(baseline.excludedDifferentCurrencyCount > 0
        ? [`currency coverage incomplete: ${baseline.excludedDifferentCurrencyCount} eligible different-currency offer(s) could not be compared in one market baseline`]
        : [])
    ];
  }
  if (baseline.excludedDifferentCurrencyCount > 0) {
    return [`currency coverage incomplete: ${baseline.excludedDifferentCurrencyCount} eligible different-currency offer(s) excluded from ${baseline.currency ?? "the"} baseline`];
  }
  return [];
};

const duplicateWarnings = (groups: readonly ShoppingDuplicateGroup[]): string[] => (
  groups.length > 0 ? [`duplicate pressure detected across ${groups.length} group(s)`] : []
);

const buyerLimitations = (assessments: readonly ShoppingOfferAssessment[]): string[] => (
  uniqueLines(
    assessments
      .filter((assessment) => assessment.recommendation !== "excluded")
      .flatMap((assessment) => assessment.evidence.buyerLimitations.map((limitation) => `buyer limitation: ${limitation}`))
  )
);

const diagnosticReason = (record: Record<string, unknown>): string => {
  const reason = record.reasonCode ?? record.reason_code ?? record.code ?? record.reason ?? record.provider;
  return typeof reason === "string" && reason.length > 0 ? reason : "unclassified";
};

const diagnosticSummary = (records: readonly Record<string, unknown>[]): string => records.map(diagnosticReason).join(", ");

const metaWarnings = (metaView: ShoppingBriefing["metaView"]): string[] => {
  const warnings: string[] = [];
  if (metaView.primaryConstraintSummary) warnings.push(`primary constraint: ${metaView.primaryConstraintSummary}`);
  if (metaView.failedProviders.length > 0) warnings.push(`failed providers: ${metaView.failedProviders.join(", ")}`);
  if (metaView.alerts.length > 0) warnings.push(`workflow alerts: ${diagnosticSummary(metaView.alerts)}`);
  if (metaView.failures.length > 0) warnings.push(`workflow failures: ${diagnosticSummary(metaView.failures)}`);
  if (metaView.offerFilterDiagnostics.length > 0) {
    warnings.push(`offer filter diagnostics: ${diagnosticSummary(metaView.offerFilterDiagnostics)}`);
  }
  if (metaView.regionAuthority === "advisory") warnings.push("requested region is advisory, not authoritative");
  return warnings;
};

const recommendationLines = (args: {
  gateStatus: ShoppingBriefing["gate"]["status"];
  assessments: readonly ShoppingOfferAssessment[];
  marketBaseline: ShoppingMarketBaseline;
}): string[] => {
  if (args.gateStatus === "fail") {
    return ["No confident purchase recommendation is available from the current evidence."];
  }
  if (args.marketBaseline.status === "unavailable" && args.marketBaseline.excludedDifferentCurrencyCount > 0) {
    return ["Use the Best Candidate Offers section as currency-separated evidence only; the current run cannot compare mixed-currency totals in one market baseline."];
  }
  if (args.gateStatus === "partial") {
    const candidate = args.assessments.find((assessment) => assessment.recommendation !== "excluded");
    return candidate
      ? ["Use the Best Candidate Offers section as a constrained shortlist only; visible blockers are listed with each offer."]
      : ["Use raw offers for investigation only because all visible offers are constrained."];
  }
  const top = args.assessments.find((assessment) => assessment.recommendation === "recommended");
  return top
    ? ["A bounded recommendation is available; review the top recommended entry in Best Candidate Offers before buying."]
    : ["Evidence supports bounded guidance, but no single candidate outranks the shortlist."];
};

const confidenceForGate = (gateStatus: ShoppingBriefing["gate"]["status"]): ShoppingConfidenceLabel => {
  if (gateStatus === "pass") return "high";
  if (gateStatus === "partial") return "medium";
  return "low";
};

const gateAwareAssessments = (
  gateStatus: ShoppingBriefing["gate"]["status"],
  assessments: readonly ShoppingOfferAssessment[]
): ShoppingOfferAssessment[] => {
  if (gateStatus === "pass") return [...assessments];
  return assessments.map((assessment) => (
    assessment.recommendation === "recommended"
      ? {
        ...assessment,
        recommendation: "candidate",
        reasons: ["candidate evidence is usable, but the overall buying readiness gate did not pass"]
      }
      : assessment
  ));
};

export const buildShoppingBriefing = (input: ShoppingBriefingInput): ShoppingBriefing => {
  const staleAfterDays = input.freshnessStaleAfterDays ?? DEFAULT_STALE_PRICE_AFTER_DAYS;
  const minSample = input.marketBaselineMinSample ?? DEFAULT_MARKET_BASELINE_MIN_SAMPLE;
  const metaView = buildShoppingReportMetaView(input.meta);
  const evidence = input.offers.map((offer) => buildShoppingOfferEvidence({
    query: input.query,
    offer,
    referenceIso: input.freshnessReferenceIso,
    staleAfterDays
  }));
  const duplicateGroups = buildDuplicateGroups(evidence);
  const marketBaseline = buildMarketBaseline(evidence, minSample);
  const assessments = sortAssessments(evidence.map((entry, index) => assessOffer({
    evidence: entry,
    duplicateGroups,
    marketBaseline,
    rank: index + 1
  })));
  const gate = evaluateShoppingReadinessGate({
    assessments,
    duplicateGroupCount: duplicateGroups.length,
    marketBaseline,
    metaView
  });
  const finalAssessments = gateAwareAssessments(gate.status, assessments);
  const warnings = uniqueLines([
    ...finalAssessments.flatMap((assessment) => assessment.warnings),
    ...baselineWarnings(marketBaseline),
    ...duplicateWarnings(duplicateGroups),
    ...buyerLimitations(finalAssessments),
    ...metaWarnings(metaView)
  ]);
  return {
    query: input.query.trim(),
    artifactFiles: [...(input.artifactFiles ?? DEFAULT_SHOPPING_ARTIFACT_FILES)],
    metaView,
    gate,
    confidence: confidenceForGate(gate.status),
    assessments: finalAssessments,
    duplicateGroups,
    marketBaseline,
    recommendation: recommendationLines({ gateStatus: gate.status, assessments: finalAssessments, marketBaseline }),
    warnings,
    constrainedOffers: finalAssessments.filter((assessment) => assessment.recommendation === "constrained" || assessment.recommendation === "excluded"),
    evidence
  };
};
