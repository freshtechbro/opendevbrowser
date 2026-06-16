import type { ProductVideoPromotedClaim, ProductVideoReadinessSummary } from "./types";

const MAX_COPY_BENEFIT_CLAIMS = 3;

const collapseText = (value: string): string => value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();

export const sanitizeProductVideoMarkdownText = (value: string): string => (
  collapseText(value).replace(/([\\`*_{}\[\]()#+!|>~])/g, "\\$1")
);

const bulletLines = (lines: readonly string[]): string[] => (
  lines.length > 0 ? lines.map((line) => `- ${sanitizeProductVideoMarkdownText(line)}`) : ["- None reported."]
);

const renderCriteria = (readiness: ProductVideoReadinessSummary): string[] => (
  readiness.criteria.map((criterion) => (
    `- ${criterion.label}: ${criterion.observed} (threshold: ${criterion.threshold}; ${criterion.passed ? "pass" : "constrain"})`
  ))
);

const renderReadiness = (readiness: ProductVideoReadinessSummary): string[] => [
  "## Presentation Readiness",
  `- Status: ${readiness.status}`,
  `- Reason codes: ${readiness.reasonCodes.length > 0 ? readiness.reasonCodes.join(", ") : "none"}`,
  ...renderCriteria(readiness),
  "",
  "## Warnings",
  ...bulletLines(readiness.warnings)
];

const copyBlockedNote = (includeCopy: boolean): string => (
  includeCopy
    ? "Presentation copy is blocked because clean product-benefit evidence was not sufficient."
    : "Presentation copy was omitted because include_copy=false. Generate or supply copy before production use."
);

export const buildProductVideoCopyText = (args: {
  title: string;
  includeCopy: boolean;
  promotedClaims: readonly ProductVideoPromotedClaim[];
}): string => {
  if (!args.includeCopy || args.promotedClaims.length === 0) return "";
  const benefits = args.promotedClaims.slice(0, MAX_COPY_BENEFIT_CLAIMS).map((claim) => claim.claim).join(" ");
  return `${args.title} combines captured product details into a concise presentation. ${benefits}`;
};

export const renderProductVideoCopyMarkdown = (args: {
  title: string;
  copy: string;
  includeCopy: boolean;
  readiness: ProductVideoReadinessSummary;
}): string => {
  const copyLines = args.copy
    ? [sanitizeProductVideoMarkdownText(args.copy)]
    : [sanitizeProductVideoMarkdownText(copyBlockedNote(args.includeCopy))];
  return [
    "# Product Copy",
    "",
    `Product: ${sanitizeProductVideoMarkdownText(args.title)}`,
    "",
    ...copyLines,
    "",
    ...renderReadiness(args.readiness)
  ].join("\n");
};

export const renderProductVideoFeaturesMarkdown = (args: {
  features: readonly string[];
  readiness: ProductVideoReadinessSummary;
}): string => {
  const featureLines = args.features.length > 0
    ? bulletLines(args.features)
    : ["- Presentation features are blocked because clean product-benefit evidence was not found."];
  return [
    "# Product Features",
    "",
    ...featureLines,
    "",
    ...renderReadiness(args.readiness)
  ].join("\n");
};
