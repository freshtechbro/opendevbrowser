import { canonicalizeUrl } from "./web/crawler";
import type { ResearchRecord } from "./enrichment";
import {
  formatInspiredesignCaptureAttemptSummary,
  type InspiredesignFollowthrough,
  type InspiredesignImplementationPlan
} from "./inspiredesign-contract";
import type { CanvasDesignGovernance, CanvasGenerationPlan } from "../canvas/types";
import {
  INSPIREDESIGN_HANDOFF_FILES,
  INSPIREDESIGN_HANDOFF_GUIDANCE
} from "../inspiredesign/handoff";

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
        "No records matched the requested timebox.",
        `Primary constraint: ${summary}`
      ]
      : ["No records matched the requested timebox."];
  }
  return records.slice(0, 10).map((record, index) => {
    const title = record.title ?? record.url ?? record.provider;
    const engagement = record.engagement.likes + record.engagement.comments + record.engagement.upvotes;
    return `${index + 1}. ${title} (${record.source}/${record.provider}) score=${record.confidence.toFixed(2)} engagement=${engagement}`;
  });
};

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
  const suggestedSteps = [
    {
      reason: INSPIREDESIGN_HANDOFF_GUIDANCE.reviewAdvancedBrief
    },
    {
      reason: "Load the baseline workflow runbook before implementation.",
      command: args.designAgentHandoff.commandExamples.loadBestPractices
    },
    {
      reason: "Load the Canvas contract lane before patching.",
      command: args.designAgentHandoff.commandExamples.loadDesignAgent
    },
    {
      reason: INSPIREDESIGN_HANDOFF_GUIDANCE.prepareCanvasPlanRequest,
      command: args.designAgentHandoff.commandExamples.continueInCanvas
    },
    {
      reason: args.designAgentHandoff.deepCaptureRecommendation
    }
  ];
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
        followthroughSummary,
        suggestedNextAction: args.designAgentHandoff.nextStep,
        suggestedSteps,
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
        followthroughSummary,
        suggestedNextAction: args.designAgentHandoff.nextStep,
        suggestedSteps,
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
        followthroughSummary,
        suggestedNextAction: args.designAgentHandoff.nextStep,
        suggestedSteps,
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
        followthroughSummary,
        suggestedNextAction: args.designAgentHandoff.nextStep,
        suggestedSteps,
        ...captureAttemptFields,
        meta: args.meta
      },
      files
    };
  }

  return {
    response: {
      mode: "path",
      followthroughSummary,
      suggestedNextAction: args.designAgentHandoff.nextStep,
      suggestedSteps,
      ...captureAttemptFields,
      meta: args.meta
    },
    files
  };
};
