import type {
  ShoppingBriefingCriterion,
  ShoppingMarketBaseline,
  ShoppingOfferAssessment,
  ShoppingReadinessGate,
  ShoppingReportMetaView
} from "./types";

interface ShoppingGateFacts {
  totalOffers: number;
  usableOffers: number;
  recommendedOffers: number;
  duplicateGroups: number;
  unknownAvailability: number;
  outOfStock: number;
  weakRelevance: number;
  suspiciousTitles: number;
  staleFreshness: number;
  inferredFreshness: number;
  missingFreshness: number;
  futureFreshness: number;
  untrustedPriceTrust: number;
  unknownPriceTrust: number;
  currencyMismatches: number;
  recommendedOutsideBaseline: number;
  differentCurrencyBaselineExclusions: number;
  visibleOutsideBaselineCurrency: number;
  baselineComputed: boolean;
  alerts: number;
  failures: number;
  failedProviders: number;
  filterDiagnostics: number;
  primaryConstraint: boolean;
  advisoryRegion: boolean;
}

const criterion = (args: {
  label: string;
  observed: string;
  threshold: string;
  passed: boolean;
}): ShoppingBriefingCriterion => args;

const countAssessments = (
  assessments: readonly ShoppingOfferAssessment[],
  predicate: (assessment: ShoppingOfferAssessment) => boolean
): number => assessments.filter(predicate).length;

const gateFacts = (args: {
  assessments: readonly ShoppingOfferAssessment[];
  duplicateGroupCount: number;
  marketBaseline: ShoppingMarketBaseline;
  metaView: ShoppingReportMetaView;
}): ShoppingGateFacts => ({
  totalOffers: args.assessments.length,
  usableOffers: countAssessments(args.assessments, (entry) => entry.recommendation !== "excluded"),
  recommendedOffers: countAssessments(args.assessments, (entry) => entry.recommendation === "recommended"),
  duplicateGroups: args.duplicateGroupCount,
  unknownAvailability: countAssessments(args.assessments, (entry) => entry.evidence.availability === "unknown"),
  outOfStock: countAssessments(args.assessments, (entry) => entry.evidence.availability === "out_of_stock"),
  weakRelevance: countAssessments(args.assessments, (entry) => entry.evidence.queryRelevance.status === "weak"),
  suspiciousTitles: countAssessments(args.assessments, (entry) => entry.evidence.titleQuality.status === "suspicious"),
  staleFreshness: countAssessments(args.assessments, (entry) => entry.evidence.freshness.status === "stale"),
  inferredFreshness: countAssessments(args.assessments, (entry) => entry.evidence.freshness.status === "inferred"),
  missingFreshness: countAssessments(args.assessments, (entry) => entry.evidence.freshness.status === "missing"),
  futureFreshness: countAssessments(args.assessments, (entry) => entry.evidence.freshness.status === "future"),
  untrustedPriceTrust: countAssessments(args.assessments, (entry) => entry.evidence.priceTrust === "untrusted"),
  unknownPriceTrust: countAssessments(args.assessments, (entry) => entry.evidence.priceTrust === "unknown"),
  currencyMismatches: countAssessments(args.assessments, (entry) => entry.evidence.currencyMismatch),
  recommendedOutsideBaseline: countAssessments(args.assessments, (entry) => (
    entry.recommendation === "recommended" && !entry.inMarketBaseline
  )),
  differentCurrencyBaselineExclusions: args.marketBaseline.excludedDifferentCurrencyCount,
  visibleOutsideBaselineCurrency: countAssessments(args.assessments, (entry) => (
    args.marketBaseline.status === "computed"
      && entry.recommendation !== "excluded"
      && entry.evidence.totalPrice.currency !== args.marketBaseline.currency
  )),
  baselineComputed: args.marketBaseline.status === "computed",
  alerts: args.metaView.alerts.length,
  failures: args.metaView.failures.length,
  failedProviders: args.metaView.failedProviders.length,
  filterDiagnostics: args.metaView.offerFilterDiagnostics.length,
  primaryConstraint: args.metaView.primaryConstraintSummary !== undefined,
  advisoryRegion: args.metaView.regionAuthority === "advisory"
});

const statusForFacts = (facts: ShoppingGateFacts): ShoppingReadinessGate["status"] => {
  if (facts.totalOffers === 0 || facts.usableOffers === 0) return "fail";
  if (facts.recommendedOffers === 0) return "partial";
  const pass = facts.duplicateGroups === 0
    && facts.unknownAvailability === 0
    && facts.outOfStock === 0
    && facts.weakRelevance === 0
    && facts.suspiciousTitles === 0
    && facts.staleFreshness === 0
    && facts.inferredFreshness === 0
    && facts.missingFreshness === 0
    && facts.futureFreshness === 0
    && facts.untrustedPriceTrust === 0
    && facts.unknownPriceTrust === 0
    && facts.currencyMismatches === 0
    && facts.recommendedOutsideBaseline === 0
    && facts.differentCurrencyBaselineExclusions === 0
    && facts.visibleOutsideBaselineCurrency === 0
    && facts.baselineComputed
    && facts.alerts === 0
    && facts.failures === 0
    && facts.failedProviders === 0
    && facts.filterDiagnostics === 0
    && !facts.primaryConstraint
    && !facts.advisoryRegion;
  return pass ? "pass" : "partial";
};

const gateSummary = (facts: ShoppingGateFacts, status: ShoppingReadinessGate["status"]): string => {
  if (status === "fail") {
    return "No confident purchase recommendation is allowed from the current evidence.";
  }
  if (status === "partial") {
    return "Offers are usable as a constrained shortlist, but confidence is limited by evidence gaps.";
  }
  return "Evidence supports bounded buying guidance for the current shortlist.";
};

const gateCriteria = (facts: ShoppingGateFacts): ShoppingBriefingCriterion[] => [
  criterion({
    label: "Usable offers",
    observed: `${facts.usableOffers} of ${facts.totalOffers}`,
    threshold: "At least 1 usable offer",
    passed: facts.usableOffers > 0
  }),
  criterion({
    label: "Availability",
    observed: `${facts.unknownAvailability} unknown, ${facts.outOfStock} out of stock`,
    threshold: "No unknown or out-of-stock offer in the current evidence set",
    passed: facts.unknownAvailability === 0 && facts.outOfStock === 0
  }),
  criterion({
    label: "Freshness",
    observed: `${facts.staleFreshness} stale, ${facts.inferredFreshness} inferred, ${facts.missingFreshness} missing, ${facts.futureFreshness} future`,
    threshold: "All candidate price timestamps observed and fresh",
    passed: facts.staleFreshness === 0
      && facts.inferredFreshness === 0
      && facts.missingFreshness === 0
      && facts.futureFreshness === 0
  }),
  criterion({
    label: "Query and title quality",
    observed: `${facts.weakRelevance} weak relevance, ${facts.suspiciousTitles} suspicious title`,
    threshold: "No weak relevance or suspicious title in the current evidence set",
    passed: facts.weakRelevance === 0 && facts.suspiciousTitles === 0
  }),
  criterion({
    label: "Price trust and currency consistency",
    observed: `${facts.untrustedPriceTrust} untrusted, ${facts.unknownPriceTrust} unknown, ${facts.currencyMismatches} currency mismatch`,
    threshold: "All candidate prices are trusted and item/shipping currencies match",
    passed: facts.untrustedPriceTrust === 0 && facts.unknownPriceTrust === 0 && facts.currencyMismatches === 0
  }),
  criterion({
    label: "Duplicate pressure",
    observed: `${facts.duplicateGroups} duplicate group(s)`,
    threshold: "No duplicate pressure in the shortlist",
    passed: facts.duplicateGroups === 0
  }),
  criterion({
    label: "Market baseline",
    observed: facts.baselineComputed
      ? `computed, ${facts.recommendedOutsideBaseline} recommendation(s) outside baseline, ${facts.differentCurrencyBaselineExclusions} different-currency eligible exclusion(s), ${facts.visibleOutsideBaselineCurrency} visible outside baseline currency`
      : "market baseline unavailable",
    threshold: "Same-currency sample large enough with no visible or eligible different-currency coverage gap",
    passed: facts.baselineComputed
      && facts.recommendedOutsideBaseline === 0
      && facts.differentCurrencyBaselineExclusions === 0
      && facts.visibleOutsideBaselineCurrency === 0
  }),
  criterion({
    label: "Workflow diagnostics",
    observed: `${facts.alerts} alert(s), ${facts.failures} failure(s), ${facts.failedProviders} failed provider(s), ${facts.filterDiagnostics} filter diagnostic(s)`,
    threshold: "No workflow alerts, provider failures, filter diagnostics, or primary constraints",
    passed: facts.alerts === 0
      && facts.failures === 0
      && facts.failedProviders === 0
      && facts.filterDiagnostics === 0
      && !facts.primaryConstraint
  }),
  criterion({
    label: "Region authority",
    observed: facts.advisoryRegion ? "advisory" : "authoritative or not requested",
    threshold: "Requested region is authoritative when present",
    passed: !facts.advisoryRegion
  })
];

export const evaluateShoppingReadinessGate = (args: {
  assessments: readonly ShoppingOfferAssessment[];
  duplicateGroupCount: number;
  marketBaseline: ShoppingMarketBaseline;
  metaView: ShoppingReportMetaView;
}): ShoppingReadinessGate => {
  const facts = gateFacts(args);
  const status = statusForFacts(facts);
  return {
    status,
    summary: gateSummary(facts, status),
    criteria: gateCriteria(facts)
  };
};
