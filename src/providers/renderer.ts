import { canonicalizeUrl } from "./web/crawler";
import type { ResearchRecord } from "./enrichment";
import {
  formatInspiredesignCaptureAttemptSummary,
  type InspiredesignFollowthrough,
  type InspiredesignImplementationPlan
} from "../inspiredesign/contract";
import type { CanvasDesignGovernance, CanvasGenerationPlan } from "../canvas/types";
import {
  INSPIREDESIGN_HANDOFF_FILES
} from "../inspiredesign/handoff";
import { buildInspiredesignSuccessHandoff } from "./workflow-handoff";

export type RenderMode = "compact" | "json" | "md" | "context" | "path";

export interface ShoppingOffer {
  offer_id: string;
  product_id: string;
  provider: string;
  url: string;
  title: string;
  price: {
    amount: number;
    currency: string;
    retrieved_at: string;
  };
  shipping: {
    amount: number;
    currency: string;
    notes: string;
  };
  availability: "in_stock" | "limited" | "out_of_stock" | "unknown";
  rating: number;
  reviews_count: number;
  deal_score: number;
  attributes: Record<string, unknown>;
}

const toCurrency = (value: number): string => `$${value.toFixed(2)}`;

const primaryConstraintSummaryFromMeta = (meta: Record<string, unknown>): string | null => {
  const summary = meta.primaryConstraintSummary;
  return typeof summary === "string" && summary.trim().length > 0
    ? summary.trim()
    : null;
};

const isStringArray = (value: unknown): value is string[] => (
  Array.isArray(value) && value.every((item) => typeof item === "string")
);

const inspiredesignCaptureAttemptReportFromMeta = (
  meta: Record<string, unknown>
): { worked: string[]; didNotWork: string[] } | null => {
  const report = meta.captureAttemptReport;
  if (typeof report !== "object" || report === null || Array.isArray(report)) {
    return null;
  }
  const candidate = report as Record<string, unknown>;
  if (!isStringArray(candidate.worked) || !isStringArray(candidate.didNotWork)) {
    return null;
  }
  return {
    worked: candidate.worked,
    didNotWork: candidate.didNotWork
  };
};

const inspiredesignCaptureAttemptSummaryFromMeta = (meta: Record<string, unknown>): string | null => {
  const summary = meta.captureAttemptSummary;
  if (typeof summary === "string" && summary.trim().length > 0) {
    return summary.trim();
  }
  const report = inspiredesignCaptureAttemptReportFromMeta(meta);
  return report ? formatInspiredesignCaptureAttemptSummary(report) : null;
};

const prependPrimaryConstraint = (text: string, meta: Record<string, unknown>): string => {
  const summary = primaryConstraintSummaryFromMeta(meta);
  return summary ? `Primary constraint: ${summary} ${text}` : text;
};

const buildInspiredesignSummary = (args: {
  brief: string;
  referenceCount: number;
  profile: string;
  meta: Record<string, unknown>;
}): string => {
  const lines = [
    `Brief: ${args.brief}`,
    `References: ${args.referenceCount}`,
    `Profile: ${args.profile}`
  ];
  const summary = primaryConstraintSummaryFromMeta(args.meta);
  if (summary) {
    lines.push(`Primary constraint: ${summary}`);
  }
  const captureSummary = inspiredesignCaptureAttemptSummaryFromMeta(args.meta);
  if (captureSummary) {
    lines.push(`Capture: ${captureSummary}`);
  }
  return lines.join("\n");
};

const compactResearchLines = (records: ResearchRecord[], meta: Record<string, unknown>): string[] => {
  if (records.length === 0) {
    const summary = primaryConstraintSummaryFromMeta(meta);
    return summary
      ? [
        "No usable research findings were available.",
        `Primary constraint: ${summary}`
      ]
      : ["No usable research findings were available."];
  }
  return records.slice(0, 10).map((record, index) => {
    const title = record.title ?? record.url ?? record.provider;
    const engagement = record.engagement.likes + record.engagement.comments + record.engagement.upvotes;
    return `${index + 1}. ${title} (${record.source}; ${record.provider}) score=${record.confidence.toFixed(2)} engagement=${engagement}`;
  });
};

const RESEARCH_REPORT_LIMITS = {
  findings: 10,
  sources: 20,
  failures: 10,
  excerptCharacters: 240,
  failureMessageCharacters: 240
} as const;
const RESEARCH_REPORT_FILE_NAMES = [
  "summary.md",
  "report.md",
  "records.json",
  "context.json",
  "meta.json"
] as const;

const plainObject = (value: unknown): Record<string, unknown> => (
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
);

const researchTitle = (record: ResearchRecord): string => record.title ?? record.url ?? record.provider;

const normalizedInlineText = (content: string | undefined): string => content?.replace(/\s+/g, " ").trim() ?? "";

const boundedInlineText = (args: {
  content: string | undefined;
  fallback: string;
  limit: number;
  target: string;
}): string => {
  const normalized = normalizedInlineText(args.content);
  if (!normalized) {
    return args.fallback;
  }
  if (normalized.length <= args.limit) {
    return normalized;
  }
  return `${normalized.slice(0, args.limit)} [truncated; see ${args.target}]`;
};

const researchExcerpt = (content: string | undefined): string => (
  boundedInlineText({
    content,
    fallback: "No content excerpt was available.",
    limit: RESEARCH_REPORT_LIMITS.excerptCharacters,
    target: "records.json for full content"
  })
);

const researchFailureMessage = (content: string | undefined): string => (
  boundedInlineText({
    content,
    fallback: "provider failure",
    limit: RESEARCH_REPORT_LIMITS.failureMessageCharacters,
    target: "meta.json"
  })
);

const limitedCount = (total: number, limit: number): number => Math.min(total, limit);

const omissionLine = (args: {
  total: number;
  limit: number;
  singular: string;
  plural: string;
  target: string;
}): string[] => {
  const omitted = args.total - limitedCount(args.total, args.limit);
  if (omitted <= 0) {
    return [];
  }
  const noun = omitted === 1 ? args.singular : args.plural;
  return [`- ${omitted} more ${noun} omitted from this report; see ${args.target} for the complete dataset.`];
};

const researchFindingsLines = (records: ResearchRecord[]): string[] => (
  records.length === 0
    ? ["- No usable findings were available."]
    : [
      ...records.slice(0, RESEARCH_REPORT_LIMITS.findings).flatMap((record, index) => [
        `### ${index + 1}. ${researchTitle(record)}`,
        `- Source: ${record.source}`,
        `- Provider: ${record.provider}`,
        `- URL: ${record.url ?? "not provided"}`,
        `- Published: ${record.timestamp}`,
        `- Confidence: ${record.confidence.toFixed(2)}`,
        `- Evidence: ${researchExcerpt(record.content)}`
      ]),
      ...omissionLine({
        total: records.length,
        limit: RESEARCH_REPORT_LIMITS.findings,
        singular: "finding",
        plural: "findings",
        target: "records.json"
      })
    ]
);

const researchSourcesLines = (records: ResearchRecord[]): string[] => (
  records.length === 0
    ? ["- No sources available."]
    : [
      ...records
      .slice(0, RESEARCH_REPORT_LIMITS.sources)
      .map((record) => `- ${researchTitle(record)}: ${record.url ?? "URL not provided"}`),
      ...omissionLine({
        total: records.length,
        limit: RESEARCH_REPORT_LIMITS.sources,
        singular: "source",
        plural: "sources",
        target: "records.json"
      })
    ]
);

const researchReasonLine = (metrics: Record<string, unknown>): string[] => {
  const reasons = Object.entries(plainObject(metrics.sanitized_reason_distribution))
    .map(([reason, count]) => `${reason}: ${String(count)}`);
  return reasons.length === 0 ? [] : [`- Sanitized record reasons: ${reasons.join(", ")}`];
};

const researchFailureSummary = (failure: unknown): string => {
  const record = plainObject(failure);
  const error = plainObject(record.error);
  const provider = typeof record.provider === "string" ? record.provider : "unknown";
  const source = typeof record.source === "string" ? record.source : "unknown";
  const reason = typeof error.reasonCode === "string" ? `${error.reasonCode}: ` : "";
  const message = researchFailureMessage(typeof error.message === "string" ? error.message : undefined);
  return `${provider} (${source}): ${reason}${message}`;
};

const researchFailureLines = (failures: unknown): string[] => {
  if (!Array.isArray(failures) || failures.length === 0) {
    return [];
  }
  const summaries = failures.slice(0, RESEARCH_REPORT_LIMITS.failures).map(researchFailureSummary);
  const omitted = failures.length - summaries.length;
  const noun = omitted === 1 ? "failure" : "failures";
  const suffix = omitted > 0
    ? `; ${omitted} more provider ${noun} omitted from this report; see meta.json`
    : "";
  return [`- Provider failures: ${summaries.join("; ")}${suffix}`];
};

const researchGapLines = (meta: Record<string, unknown>): string[] => {
  const metrics = plainObject(meta.metrics);
  const details = [
    typeof metrics.final_records === "number" ? `- Final records reported by workflow: ${metrics.final_records}` : "",
    typeof metrics.sanitized_records === "number" ? `- Sanitized records excluded: ${metrics.sanitized_records}` : "",
    ...researchReasonLine(metrics),
    ...researchFailureLines(meta.failures)
  ].filter(Boolean);
  const constraint = primaryConstraintSummaryFromMeta(meta);
  const fallback = "- No provider limitations or sanitization gaps were reported.";
  const gapDetails = details.length > 0 || constraint ? details : [fallback];
  return [
    "## Confidence and Gaps",
    ...(constraint ? [`- Primary constraint: ${constraint}`] : []),
    ...gapDetails
  ];
};

const researchArtifactFileLines = (): string[] => [
  "## Report Files",
  ...RESEARCH_REPORT_FILE_NAMES.map((fileName) => `- ${fileName}`)
];

const buildResearchReport = (args: {
  topic: string;
  records: ResearchRecord[];
  meta: Record<string, unknown>;
}): string => [
  "# Research Report",
  "",
  "## Executive Summary",
  `- Topic: ${args.topic}`,
  `- Usable findings: ${args.records.length}`,
  `- Findings shown in report: ${limitedCount(args.records.length, RESEARCH_REPORT_LIMITS.findings)}`,
  `- Sources shown in report: ${limitedCount(args.records.length, RESEARCH_REPORT_LIMITS.sources)}`,
  "- Final output: Usable records are persisted in records.json.",
  "- Diagnostics: Run metadata, failures, and constraints are persisted in meta.json; this report summarizes the bounded inline subset.",
  "",
  ...researchArtifactFileLines(),
  "",
  "## Findings",
  ...researchFindingsLines(args.records),
  "",
  ...researchGapLines(args.meta),
  "",
  "## Sources",
  ...researchSourcesLines(args.records)
].join("\n");

export const renderResearch = (args: {
  mode: RenderMode;
  topic: string;
  records: ResearchRecord[];
  meta: Record<string, unknown>;
}): {
  response: Record<string, unknown>;
  files: Array<{ path: string; content: string | Record<string, unknown> }>;
} => {
  const lines = compactResearchLines(args.records, args.meta);
  const summary = lines.join("\n");
  const report = buildResearchReport(args);
  const markdown = [
    `# Research: ${args.topic}`,
    "",
    ...lines,
    "",
    "## Metadata",
    "```json",
    JSON.stringify(args.meta, null, 2),
    "```"
  ].join("\n");
  const contextPayload = {
    topic: args.topic,
    highlights: lines,
    records: args.records,
    meta: args.meta
  };

  const files = [
    { path: "summary.md", content: markdown },
    { path: "report.md", content: report },
    { path: "records.json", content: { records: args.records } },
    { path: "context.json", content: contextPayload },
    { path: "meta.json", content: args.meta }
  ];

  if (args.mode === "compact") {
    return {
      response: {
        mode: args.mode,
        summary,
        meta: args.meta
      },
      files
    };
  }
  if (args.mode === "json") {
    return {
      response: {
        mode: args.mode,
        records: args.records,
        meta: args.meta
      },
      files
    };
  }
  if (args.mode === "md") {
    return {
      response: {
        mode: args.mode,
        markdown,
        meta: args.meta
      },
      files
    };
  }

  if (args.mode === "context") {
    return {
      response: {
        mode: args.mode,
        context: contextPayload,
        meta: args.meta
      },
      files
    };
  }

  return {
    response: {
      mode: "path",
      meta: args.meta
    },
    files
  };
};

const toComparisonCsv = (offers: ShoppingOffer[]): string => {
  const header = ["provider", "title", "price", "shipping", "deal_score", "availability", "url"].join(",");
  const rows = offers.map((offer) => {
    return [
      offer.provider,
      JSON.stringify(offer.title),
      offer.price.amount.toFixed(2),
      offer.shipping.amount.toFixed(2),
      offer.deal_score.toFixed(4),
      offer.availability,
      canonicalizeUrl(offer.url)
    ].join(",");
  });
  return [header, ...rows].join("\n");
};

const compactShoppingLines = (offers: ShoppingOffer[], meta: Record<string, unknown>): string[] => {
  if (offers.length === 0) {
    const summary = primaryConstraintSummaryFromMeta(meta);
    return summary
      ? [
        "No offers available from the selected providers.",
        `Primary constraint: ${summary}`
      ]
      : ["No offers available from the selected providers."];
  }
  return offers.slice(0, 10).map((offer, index) => {
    const total = offer.price.amount + offer.shipping.amount;
    return `${index + 1}. ${offer.title} - ${toCurrency(total)} (${offer.provider}, deal=${offer.deal_score.toFixed(2)})`;
  });
};

export const renderShopping = (args: {
  mode: RenderMode;
  query: string;
  offers: ShoppingOffer[];
  meta: Record<string, unknown>;
}): {
  response: Record<string, unknown>;
  files: Array<{ path: string; content: string | Record<string, unknown> }>;
} => {
  const lines = compactShoppingLines(args.offers, args.meta);
  const markdown = [
    `# Shopping: ${args.query}`,
    "",
    ...lines,
    "",
    "## Metadata",
    "```json",
    JSON.stringify(args.meta, null, 2),
    "```"
  ].join("\n");

  const comparisonCsv = toComparisonCsv(args.offers);
  const contextPayload = {
    query: args.query,
    highlights: lines,
    offers: args.offers,
    meta: args.meta
  };

  const files = [
    { path: "deals.md", content: markdown },
    { path: "offers.json", content: { offers: args.offers } },
    { path: "comparison.csv", content: comparisonCsv },
    { path: "meta.json", content: args.meta },
    { path: "deals-context.json", content: contextPayload }
  ];

  if (args.mode === "compact") {
    return {
      response: {
        mode: args.mode,
        summary: lines.join("\n"),
        meta: args.meta
      },
      files
    };
  }
  if (args.mode === "json") {
    return {
      response: {
        mode: args.mode,
        offers: args.offers,
        meta: args.meta
      },
      files
    };
  }
  if (args.mode === "md") {
    return {
      response: {
        mode: args.mode,
        markdown,
        meta: args.meta
      },
      files
    };
  }
  if (args.mode === "context") {
    return {
      response: {
        mode: args.mode,
        context: contextPayload,
        meta: args.meta
      },
      files
    };
  }

  return {
    response: {
      mode: "path",
      meta: args.meta
    },
    files
  };
};

export const renderInspiredesign = (args: {
  mode: RenderMode;
  brief: string;
  advancedBriefMarkdown: string;
  urls: string[];
  designContract: CanvasDesignGovernance;
  canvasPlanRequest: Record<string, unknown>;
  designAgentHandoff: InspiredesignFollowthrough;
  generationPlan: CanvasGenerationPlan;
  implementationPlan: InspiredesignImplementationPlan;
  designMarkdown: string;
  implementationPlanMarkdown: string;
  prototypeGuidanceMarkdown: string | null;
  evidence: Record<string, unknown>;
  meta: Record<string, unknown>;
}): {
  response: Record<string, unknown>;
  files: Array<{ path: string; content: string | Record<string, unknown> }>;
} => {
  const captureAttemptReport = inspiredesignCaptureAttemptReportFromMeta(args.meta);
  const captureAttemptSummary = inspiredesignCaptureAttemptSummaryFromMeta(args.meta);
  const summary = buildInspiredesignSummary({
    brief: args.brief,
    referenceCount: args.urls.length,
    profile: args.generationPlan.visualDirection.profile,
    meta: args.meta
  });
  const followthroughSummary = prependPrimaryConstraint(args.designAgentHandoff.summary, args.meta);
  const contextPayload = {
    brief: args.brief,
    advancedBriefMarkdown: args.advancedBriefMarkdown,
    urls: args.urls,
    designContract: args.designContract,
    canvasPlanRequest: args.canvasPlanRequest,
    designAgentHandoff: args.designAgentHandoff,
    generationPlan: args.generationPlan,
    implementationPlan: args.implementationPlan,
    designMarkdown: args.designMarkdown,
    implementationPlanMarkdown: args.implementationPlanMarkdown,
    prototypeGuidanceMarkdown: args.prototypeGuidanceMarkdown,
    evidence: args.evidence,
    meta: args.meta
  };
  const handoff = buildInspiredesignSuccessHandoff({
    summary: followthroughSummary,
    nextStep: args.designAgentHandoff.nextStep,
    commandExamples: args.designAgentHandoff.commandExamples,
    deepCaptureRecommendation: args.designAgentHandoff.deepCaptureRecommendation
  });
  const files: Array<{ path: string; content: string | Record<string, unknown> }> = [
    { path: INSPIREDESIGN_HANDOFF_FILES.designMarkdown, content: args.designMarkdown },
    { path: INSPIREDESIGN_HANDOFF_FILES.advancedBrief, content: args.advancedBriefMarkdown },
    { path: INSPIREDESIGN_HANDOFF_FILES.designContract, content: args.designContract },
    { path: INSPIREDESIGN_HANDOFF_FILES.canvasPlanRequest, content: args.canvasPlanRequest },
    { path: INSPIREDESIGN_HANDOFF_FILES.designAgentHandoff, content: args.designAgentHandoff },
    { path: INSPIREDESIGN_HANDOFF_FILES.generationPlan, content: args.generationPlan },
    { path: INSPIREDESIGN_HANDOFF_FILES.implementationPlanMarkdown, content: args.implementationPlanMarkdown },
    { path: INSPIREDESIGN_HANDOFF_FILES.implementationPlan, content: args.implementationPlan },
    { path: INSPIREDESIGN_HANDOFF_FILES.evidence, content: args.evidence }
  ];
  if (args.prototypeGuidanceMarkdown) {
    files.push({ path: INSPIREDESIGN_HANDOFF_FILES.prototypeGuidance, content: args.prototypeGuidanceMarkdown });
  }
  const captureAttemptFields = {
    ...(captureAttemptSummary ? { captureAttemptSummary } : {}),
    ...(captureAttemptReport ? { captureAttemptReport } : {})
  };

  if (args.mode === "compact") {
    return {
      response: {
        mode: args.mode,
        summary,
        ...handoff,
        ...captureAttemptFields,
        meta: args.meta
      },
      files
    };
  }
  if (args.mode === "json") {
    return {
      response: {
        mode: args.mode,
        brief: args.brief,
        advancedBriefMarkdown: args.advancedBriefMarkdown,
        urls: args.urls,
        canvasPlanRequest: args.canvasPlanRequest,
        designAgentHandoff: args.designAgentHandoff,
        designContract: args.designContract,
        generationPlan: args.generationPlan,
        implementationPlan: args.implementationPlan,
        prototypeGuidanceMarkdown: args.prototypeGuidanceMarkdown,
        evidence: args.evidence,
        ...handoff,
        ...captureAttemptFields,
        meta: args.meta
      },
      files
    };
  }
  if (args.mode === "md") {
    return {
      response: {
        mode: args.mode,
        markdown: args.designMarkdown,
        implementationPlanMarkdown: args.implementationPlanMarkdown,
        prototypeGuidanceMarkdown: args.prototypeGuidanceMarkdown,
        ...handoff,
        ...captureAttemptFields,
        meta: args.meta
      },
      files
    };
  }
  if (args.mode === "context") {
    return {
      response: {
        mode: args.mode,
        context: contextPayload,
        ...handoff,
        ...captureAttemptFields,
        meta: args.meta
      },
      files
    };
  }

  return {
    response: {
      mode: "path",
      ...handoff,
      ...captureAttemptFields,
      meta: args.meta
    },
    files
  };
};
