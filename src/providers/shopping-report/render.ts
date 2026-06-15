import type {
  ShoppingBriefing,
  ShoppingDuplicateGroup,
  ShoppingMarketBaseline,
  ShoppingOfferAssessment,
  ShoppingReportOfferEvidence
} from "./types";

const formatMoney = (amount: number, currency: string): string => (
  Number.isFinite(amount) ? `${sanitizeMarkdownText(currency)} ${amount.toFixed(2)}` : `${sanitizeMarkdownText(currency)} unavailable`
);

const collapseText = (value: string): string => value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();

const sanitizeMarkdownText = (value: string): string => (
  collapseText(value).replace(/([\\`*_{}\[\]()#+!|>~])/g, "\\$1")
);

const bulletLines = (lines: readonly string[]): string[] => (
  lines.length > 0 ? lines.map((line) => `- ${sanitizeMarkdownText(line)}`) : ["- None reported."]
);

const renderCriteria = (briefing: ShoppingBriefing): string[] => (
  briefing.gate.criteria.map((criterion) => (
    `- ${criterion.label}: ${criterion.observed} (threshold: ${criterion.threshold}; ${criterion.passed ? "pass" : "constrain"})`
  ))
);

const renderGate = (briefing: ShoppingBriefing): string[] => [
  "## Buying Readiness Gate",
  `- Query: ${sanitizeMarkdownText(briefing.query)}`,
  `- Status: ${briefing.gate.status}`,
  `- Confidence: ${briefing.confidence}`,
  `- Summary: ${briefing.gate.summary}`,
  ...renderCriteria(briefing)
];

const evidencePriceLine = (evidence: ShoppingReportOfferEvidence): string => {
  if (!evidence.currencyMismatch) return formatMoney(evidence.totalPrice.amount, evidence.totalPrice.currency);
  return `item ${formatMoney(evidence.itemPrice.amount, evidence.itemPrice.currency)} plus shipping ${formatMoney(evidence.shippingPrice.amount, evidence.shippingPrice.currency)}; total unavailable due to currency mismatch`;
};

const evidenceAnchorLine = (assessment: ShoppingOfferAssessment): string | undefined => {
  if (!assessment.anchorDiscount) return undefined;
  const amount = formatMoney(assessment.anchorDiscount.amount, assessment.evidence.totalPrice.currency);
  return `anchor discount: ${amount} (${assessment.anchorDiscount.percent.toFixed(1)}%)`;
};

const visibleRecommendationLabel = (
  assessment: ShoppingOfferAssessment,
  gateStatus: ShoppingBriefing["gate"]["status"]
): string => {
  if (gateStatus === "pass") return assessment.recommendation;
  return assessment.recommendation === "recommended" ? "candidate" : assessment.recommendation;
};

const offerLine = (
  assessment: ShoppingOfferAssessment,
  gateStatus: ShoppingBriefing["gate"]["status"]
): string => {
  const evidence = assessment.evidence;
  const details = [
    evidencePriceLine(evidence),
    sanitizeMarkdownText(evidence.provider),
    `availability: ${evidence.availability}`,
    `freshness: ${evidence.freshness.status}`,
    `relevance: ${evidence.queryRelevance.status}`,
    evidenceAnchorLine(assessment)
  ].filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
  return `- ${assessment.rank}. [${visibleRecommendationLabel(assessment, gateStatus)}] provider-supplied title: ${sanitizeMarkdownText(evidence.title)} (${details.join("; ")})`;
};

const findDuplicateRoot = (parents: Map<string, string>, key: string): string => {
  const parent = parents.get(key);
  if (!parent || parent === key) return key;
  const root = findDuplicateRoot(parents, parent);
  parents.set(key, root);
  return root;
};

const unionDuplicateKeys = (parents: Map<string, string>, left: string, right: string): void => {
  const leftRoot = findDuplicateRoot(parents, left);
  const rightRoot = findDuplicateRoot(parents, right);
  if (leftRoot !== rightRoot) parents.set(rightRoot, leftRoot);
};

const duplicateCollapseKeys = (assessment: ShoppingOfferAssessment): string[] => (
  assessment.duplicateGroupIds.length > 0
    ? assessment.duplicateGroupIds
    : [`offer:${assessment.evidence.offerId}`]
);

const collapseDuplicateCandidates = (
  assessments: readonly ShoppingOfferAssessment[]
): ShoppingOfferAssessment[] => {
  const parents = new Map<string, string>();
  for (const assessment of assessments) {
    const keys = duplicateCollapseKeys(assessment);
    for (const key of keys) parents.set(key, parents.get(key) ?? key);
    const firstKey = keys[0];
    if (!firstKey) continue;
    for (const key of keys.slice(1)) unionDuplicateKeys(parents, firstKey, key);
  }

  const groups = new Set<string>();
  const collapsed: ShoppingOfferAssessment[] = [];
  for (const assessment of assessments.filter((entry) => entry.recommendation !== "excluded")) {
    const key = duplicateCollapseKeys(assessment)[0] ?? `offer:${assessment.evidence.offerId}`;
    const root = findDuplicateRoot(parents, key);
    if (groups.has(root)) continue;
    groups.add(root);
    collapsed.push(assessment);
  }
  return collapsed;
};

const renderBestCandidates = (briefing: ShoppingBriefing): string[] => {
  const visible = collapseDuplicateCandidates(briefing.assessments);
  if (visible.length === 0) {
    return ["## Best Candidate Offers", "- No candidate offers met the report gate."];
  }
  return ["## Best Candidate Offers", ...visible.slice(0, 5).map((assessment) => offerLine(assessment, briefing.gate.status))];
};

const computedBaselineLines = (baseline: ShoppingMarketBaseline): string[] => {
  const currency = baseline.currency ?? "";
  const average = baseline.averageTotal ?? 0;
  const median = baseline.medianTotal ?? 0;
  const lowest = baseline.lowestTotal ?? 0;
  return [
    `- Baseline: computed from ${baseline.sampleCount} same-currency ${sanitizeMarkdownText(currency)} offer(s).`,
    `- Average total: ${formatMoney(average, currency)}.`,
    `- Median total: ${formatMoney(median, currency)}.`,
    `- Lowest total: ${formatMoney(lowest, currency)}.`,
    `- Different-currency offers excluded from baseline: ${baseline.excludedDifferentCurrencyCount}.`,
    baseline.anchorEvidenceCount > 0
      ? `- Explicit anchor/list price evidence present for ${baseline.anchorEvidenceCount} same-currency offer(s).`
      : "- Anchor/list discount comparison unavailable because no explicit anchor/list price evidence was present."
  ];
};

const renderMarketBaseline = (baseline: ShoppingMarketBaseline): string[] => {
  if (baseline.status === "computed") {
    return ["## Market Baseline", ...computedBaselineLines(baseline)];
  }
  return [
    "## Market Baseline",
    `- Market baseline unavailable: ${baseline.reason}.`,
    `- Same-currency evidence required: at least ${baseline.minSample} offers with one currency.`,
    `- Largest same-currency sample observed: ${baseline.sampleCount}.`
  ];
};

const renderDuplicateGroup = (group: ShoppingDuplicateGroup): string => (
  `- ${group.reason}: ${sanitizeMarkdownText(group.title)} (${group.offerIds.length} offers across ${group.urls.length} URLs)`
);

const constrainedOfferLine = (assessment: ShoppingOfferAssessment): string => {
  const warnings = assessment.warnings.length > 0 ? assessment.warnings.join("; ") : assessment.reasons.join("; ");
  return `- [${assessment.recommendation}] ${sanitizeMarkdownText(assessment.evidence.title)}: ${sanitizeMarkdownText(warnings)}`;
};

const renderConstrainedOffers = (briefing: ShoppingBriefing): string[] => [
  "## Excluded or Constrained Offers",
  ...(
    briefing.constrainedOffers.length > 0
      ? briefing.constrainedOffers.map(constrainedOfferLine)
      : ["- No offers were excluded or constrained by the report gate."]
  )
];

const renderEvidenceOffer = (evidence: ShoppingReportOfferEvidence): string => (
  `- ${sanitizeMarkdownText(evidence.offerId)}: ${sanitizeMarkdownText(evidence.title)} (${sanitizeMarkdownText(evidence.provider)}, ${evidencePriceLine(evidence)}, freshness ${evidence.freshness.status}, availability ${evidence.availability})`
);

const diagnosticReason = (record: Record<string, unknown>): string => {
  const reason = record.reasonCode ?? record.reason_code ?? record.code ?? record.reason ?? record.provider;
  return typeof reason === "string" && reason.length > 0 ? reason : "unclassified";
};

const diagnosticReasons = (records: readonly Record<string, unknown>[]): string => (
  records.length > 0 ? records.map(diagnosticReason).map(sanitizeMarkdownText).join(", ") : "none"
);

const renderMeta = (briefing: ShoppingBriefing): string[] => [
  `- Providers: ${briefing.metaView.selectedProviders.length > 0 ? briefing.metaView.selectedProviders.map(sanitizeMarkdownText).join(", ") : "not reported"}`,
  `- Region authority: ${briefing.metaView.regionAuthority}`,
  `- Primary constraint: ${briefing.metaView.primaryConstraintSummary ? sanitizeMarkdownText(briefing.metaView.primaryConstraintSummary) : "none"}`,
  `- Failed providers: ${briefing.metaView.failedProviders.length > 0 ? briefing.metaView.failedProviders.map(sanitizeMarkdownText).join(", ") : "none"}`,
  `- Alerts: ${briefing.metaView.alerts.length} (${diagnosticReasons(briefing.metaView.alerts)})`,
  `- Failures: ${briefing.metaView.failures.length} (${diagnosticReasons(briefing.metaView.failures)})`,
  `- Offer filter diagnostics: ${briefing.metaView.offerFilterDiagnostics.length} (${diagnosticReasons(briefing.metaView.offerFilterDiagnostics)})`
];

const renderEvidenceAppendix = (briefing: ShoppingBriefing): string[] => [
  "## Evidence Appendix",
  "### Report Files",
  ...briefing.artifactFiles.map((fileName) => `- ${fileName}`),
  "",
  "### Offer Evidence",
  ...(briefing.evidence.length > 0 ? briefing.evidence.map(renderEvidenceOffer) : ["- No offer evidence was available."]),
  "",
  "### Duplicate Groups",
  ...(briefing.duplicateGroups.length > 0 ? briefing.duplicateGroups.map(renderDuplicateGroup) : ["- No duplicate pressure detected."]),
  "",
  "### Meta Summary",
  ...renderMeta(briefing)
];

export const renderShoppingBriefingMarkdown = (briefing: ShoppingBriefing): string => [
  "# Shopping Buying Brief",
  "",
  ...renderGate(briefing),
  "",
  "## Recommendation",
  ...bulletLines(briefing.recommendation),
  "",
  ...renderBestCandidates(briefing),
  "",
  ...renderMarketBaseline(briefing.marketBaseline),
  "",
  "## Warnings and Constraints",
  ...bulletLines(briefing.warnings),
  "",
  ...renderConstrainedOffers(briefing),
  "",
  ...renderEvidenceAppendix(briefing)
].join("\n");
