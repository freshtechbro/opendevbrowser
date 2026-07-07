import { canonicalizeUrl } from "./web/crawler";
import type { ResearchRecord } from "./enrichment";
import { buildResearchBriefing, renderResearchBriefingMarkdown } from "./research-report";
import {
  buildShoppingBriefing,
  renderShoppingBriefingMarkdown,
  type ShoppingBriefing,
  type ShoppingOfferAssessment
} from "./shopping-report";
import {
  formatInspiredesignCaptureAttemptSummary,
  type InspiredesignFollowthrough,
  type InspiredesignImplementationPlan,
  type InspiredesignMotionEvidenceJson,
  type InspiredesignPinMediaEvidenceJson,
  type InspiredesignScreenshotIndexEntry,
  type InspiredesignVisualEvidenceJson
} from "../inspiredesign/contract";
import type { InspiredesignReferencePatternBoard } from "../inspiredesign/reference-pattern-board";
import {
  redactDiagnosticPinterestPinMediaEvidence,
  type InspiredesignPinterestPinMediaIndexEntry
} from "../inspiredesign/pinterest-pin-media-evidence";
import type { CanvasDesignGovernance, CanvasGenerationPlan } from "../canvas/types";
import {
  INSPIREDESIGN_HANDOFF_FILES,
  type InspiredesignArtifactGuide,
  type InspiredesignContractSectionGuide
} from "../inspiredesign/handoff";
import {
  hasActiveInspiredesignCanvasDoNotProceedBlocker,
  countInspiredesignArtifactBackedEvidenceAuthorities,
  isInspiredesignAuthoritativeRankedReference,
  isInspiredesignPinterestPinReferenceUrl,
  resolveInspiredesignFinalEvidenceAuthority
} from "../inspiredesign/product-readiness";
import { buildInspiredesignSuccessHandoff } from "./workflow-handoff";
import type { NextStepGuidance } from "../guidance/types";
import type {
  InspiredesignMediaAnalysis
} from "../inspiredesign/media-analysis";

export type RenderMode = "compact" | "json" | "md" | "context" | "path";

type RenderedInspiredesignArtifactGuide = Partial<InspiredesignArtifactGuide>;
type RenderedInspiredesignFollowthrough = Omit<InspiredesignFollowthrough, "artifactGuide"> & {
  artifactAuthority: "product_ready" | "diagnostic_only";
  evidenceAuthority: "snapshot_ready" | "motion_ready" | "pin_media_ready" | "ranked_reference" | "diagnostic_only";
  productSuccess: boolean;
  artifactGuide: RenderedInspiredesignArtifactGuide;
};
type InspiredesignGuideEntry = InspiredesignContractSectionGuide[string];
type InspiredesignAuthorityFields = {
	ready: boolean;
  artifactAuthority: "product_ready" | "diagnostic_only";
  evidenceAuthority: "snapshot_ready" | "motion_ready" | "pin_media_ready" | "ranked_reference" | "diagnostic_only";
  productSuccess: boolean;
  diagnosticWarning?: string;
};

const PIN_MEDIA_INDEX_RUNTIME_ONLY_FIELDS = [
  "status",
  "tempPath",
  "rejectionReasons"
] as const;

const redactRenderedPinMediaEvidence = (
  entries: readonly InspiredesignPinMediaEvidenceJson[]
): InspiredesignPinMediaEvidenceJson[] => entries.map((entry) => ({
  ...entry,
  pinMedia: redactDiagnosticPinterestPinMediaEvidence(entry.pinMedia)
}));

const hasPinMediaIndexRuntimeOnlyFields = (entry: InspiredesignPinterestPinMediaIndexEntry): boolean => {
  const record = entry as Record<string, unknown>;
  return PIN_MEDIA_INDEX_RUNTIME_ONLY_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(record, field));
};

const projectRenderedPinMediaIndexEntry = (
  entry: InspiredesignPinterestPinMediaIndexEntry
): InspiredesignPinterestPinMediaIndexEntry | undefined => {
  if (hasPinMediaIndexRuntimeOnlyFields(entry)) return undefined;
  if (!Array.isArray(entry.warnings)) return undefined;
  if (!entry.firstPartyProvenance || typeof entry.firstPartyProvenance !== "object") return undefined;
  if (Array.isArray(entry.firstPartyProvenance)) return undefined;
  return {
    referenceId: entry.referenceId,
    url: entry.url,
    sourceUrl: entry.sourceUrl,
    mediaUrl: entry.mediaUrl,
    pinterestPageQuality: entry.pinterestPageQuality,
    path: entry.path,
    sha256: entry.sha256,
    bytes: entry.bytes,
    width: entry.width,
    height: entry.height,
    contentType: entry.contentType,
    kind: entry.kind,
    authority: "design_evidence",
    capturedAt: entry.capturedAt,
    ...(entry.candidateSelector ? { candidateSelector: entry.candidateSelector } : {}),
    ...(entry.candidateRole ? { candidateRole: entry.candidateRole } : {}),
    ...(entry.candidateAlt ? { candidateAlt: entry.candidateAlt } : {}),
    warnings: entry.warnings.filter((warning): warning is string => typeof warning === "string"),
    firstPartyProvenance: { ...entry.firstPartyProvenance }
  };
};

const projectRenderedPinMediaIndex = (
  entries: readonly InspiredesignPinterestPinMediaIndexEntry[]
): InspiredesignPinterestPinMediaIndexEntry[] => (
  entries.flatMap((entry) => {
    const projected = projectRenderedPinMediaIndexEntry(entry);
    return projected ? [projected] : [];
  })
);

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

const RESEARCH_RENDER_FILE_NAMES = [
  "summary.md",
  "report.md",
  "records.json",
  "context.json",
  "meta.json"
] as const;

const RESEARCH_BUNDLE_FILE_NAMES = [
  ...RESEARCH_RENDER_FILE_NAMES,
  "bundle-manifest.json"
] as const;

const plainObject = (value: unknown): Record<string, unknown> => (
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
);

const researchTitle = (record: ResearchRecord): string => record.title ?? record.url ?? record.provider;

const CANVAS_CONTINUATION_BLOCKED_COMMAND = "Unavailable until harvest readiness is ready with authoritative visual, motion, or pin-media evidence.";
const CANVAS_PLAN_OMITTED_GUIDANCE = "Canvas plan request omitted until harvest readiness is ready with authoritative visual, motion, or pin-media evidence.";
const CANVAS_PLAN_PACKET_DIAGNOSTIC_DELIVERABLE = "Diagnostic `canvasPlanRequest` preview; do not submit to Canvas until next-step guidance is ready";
const CANVAS_PLAN_READY_DELIVERABLE = "Ready-to-fill `canvasPlanRequest` JSON for `canvas.plan.set`";
const DIAGNOSTIC_ARTIFACT_WARNING = "> **Diagnostic-only artifact.** This harvest is not product-ready. Treat this file as troubleshooting context, not authoritative design input.";
const INSPIREDESIGN_RENDERER_READINESS_COUNT_KEYS = [
	"rankedReferenceCount",
	"authoritativeReferenceCount",
	"snapshotReadyReferenceCount",
	"motionReadyReferenceCount",
	"pinMediaReadyReferenceCount"
] as const;

const readRendererReadinessCount = (value: unknown): number | undefined => (
	typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined
);

const hasRendererReadinessCount = (meta: Record<string, unknown>): boolean => (
	INSPIREDESIGN_RENDERER_READINESS_COUNT_KEYS.some((key) => Object.prototype.hasOwnProperty.call(meta, key))
);

type InspiredesignRendererReadinessCountKey = typeof INSPIREDESIGN_RENDERER_READINESS_COUNT_KEYS[number];

type InspiredesignRendererReadinessCounts = Record<InspiredesignRendererReadinessCountKey, number>;

const selectRendererAuthorityReferences = (args: {
  referencePatternBoard: InspiredesignReferencePatternBoard | undefined;
  rankedReferences: InspiredesignReferencePatternBoard["references"];
}): InspiredesignReferencePatternBoard["references"] => (
  args.referencePatternBoard && args.rankedReferences.length > 0
    ? args.rankedReferences
    : args.referencePatternBoard?.references ?? []
);

const readCompleteRendererReadinessCounts = (
	meta: Record<string, unknown>
): InspiredesignRendererReadinessCounts | undefined => {
	const rankedReferenceCount = readRendererReadinessCount(meta.rankedReferenceCount);
	const authoritativeReferenceCount = readRendererReadinessCount(meta.authoritativeReferenceCount);
	const snapshotReadyReferenceCount = readRendererReadinessCount(meta.snapshotReadyReferenceCount);
	const motionReadyReferenceCount = readRendererReadinessCount(meta.motionReadyReferenceCount);
	const pinMediaReadyReferenceCount = readRendererReadinessCount(meta.pinMediaReadyReferenceCount);
	if (
		rankedReferenceCount === undefined
		|| authoritativeReferenceCount === undefined
		|| snapshotReadyReferenceCount === undefined
		|| motionReadyReferenceCount === undefined
		|| pinMediaReadyReferenceCount === undefined
	) return undefined;
	return {
		rankedReferenceCount,
		authoritativeReferenceCount,
		snapshotReadyReferenceCount,
		motionReadyReferenceCount,
		pinMediaReadyReferenceCount
	};
};

const computeRendererReadinessCounts = (args: {
	referencePatternBoard: InspiredesignReferencePatternBoard | undefined;
	rankedReferences: InspiredesignReferencePatternBoard["references"];
	screenshotIndex: readonly InspiredesignScreenshotIndexEntry[];
	motionEvidence: readonly InspiredesignMotionEvidenceJson[];
	pinMediaIndex: readonly InspiredesignPinterestPinMediaIndexEntry[];
}): InspiredesignRendererReadinessCounts => {
	const rankedReferences = selectRendererAuthorityReferences(args);
	const authorityCounts = countInspiredesignArtifactBackedEvidenceAuthorities({
		rankedReferences,
		screenshots: args.screenshotIndex,
		motions: args.motionEvidence,
		pinMedia: args.pinMediaIndex
	});
	const authoritativeReferenceCount = authorityCounts.snapshotReadyReferenceCount
		+ authorityCounts.motionReadyReferenceCount
		+ authorityCounts.pinMediaReadyReferenceCount;
	return {
		rankedReferenceCount: rankedReferences.length,
		authoritativeReferenceCount,
		...authorityCounts
	};
};

const rendererReadinessCountsMatch = (
	explicitCounts: InspiredesignRendererReadinessCounts,
	computedCounts: InspiredesignRendererReadinessCounts
): boolean => (
	INSPIREDESIGN_RENDERER_READINESS_COUNT_KEYS.every((key) => explicitCounts[key] === computedCounts[key])
);

const hasCoherentRendererReadinessCounts = (args: {
	meta: Record<string, unknown>;
	referencePatternBoard: InspiredesignReferencePatternBoard | undefined;
	rankedReferences: InspiredesignReferencePatternBoard["references"];
	screenshotIndex: readonly InspiredesignScreenshotIndexEntry[];
	motionEvidence: readonly InspiredesignMotionEvidenceJson[];
	pinMediaIndex: readonly InspiredesignPinterestPinMediaIndexEntry[];
}): boolean => {
	if (!hasRendererReadinessCount(args.meta)) return true;
	const explicitCounts = readCompleteRendererReadinessCounts(args.meta);
	if (!explicitCounts) return false;
	return rendererReadinessCountsMatch(explicitCounts, computeRendererReadinessCounts(args));
};

const evidenceAuthorityForProductReadyArtifacts = (args: {
  productSuccess: boolean;
	referencePatternBoard: InspiredesignReferencePatternBoard | undefined;
  rankedReferences: InspiredesignReferencePatternBoard["references"];
  screenshotIndex: readonly InspiredesignScreenshotIndexEntry[];
  motionEvidence: readonly InspiredesignMotionEvidenceJson[];
  pinMediaIndex: readonly InspiredesignPinterestPinMediaIndexEntry[];
}): InspiredesignAuthorityFields["evidenceAuthority"] => {
	const rankedReferences = selectRendererAuthorityReferences(args);
	const authorityCounts = countInspiredesignArtifactBackedEvidenceAuthorities({
		rankedReferences,
		screenshots: args.screenshotIndex,
		motions: args.motionEvidence,
		pinMedia: args.pinMediaIndex
	});
	return resolveInspiredesignFinalEvidenceAuthority({
		productSuccess: args.productSuccess,
		...authorityCounts
	});
};

const referenceClaimsPinMediaAuthority = (
	reference: InspiredesignReferencePatternBoard["references"][number]
): boolean => (
	reference.evidenceAuthority === "pin_media_ready"
	|| (Array.isArray(reference.capturedVia) && reference.capturedVia.includes("pin_media_ready"))
);

const hasPinterestPinMediaReadyAuthority = (
	reference: InspiredesignReferencePatternBoard["references"][number],
	pinMediaIndex: readonly InspiredesignPinterestPinMediaIndexEntry[]
): boolean => (
	referenceClaimsPinMediaAuthority(reference)
	&& isInspiredesignAuthoritativeRankedReference({ ...reference, evidenceAuthority: "pin_media_ready" }, {
	pinMedia: pinMediaIndex
	})
);

const canContinueInspiredesignInCanvas = (
  guidance: NextStepGuidance | undefined,
  referencePatternBoard: InspiredesignReferencePatternBoard | undefined,
  rankedReferences: InspiredesignReferencePatternBoard["references"],
  screenshotIndex: readonly InspiredesignScreenshotIndexEntry[],
  motionEvidence: readonly InspiredesignMotionEvidenceJson[],
  pinMediaIndex: readonly InspiredesignPinterestPinMediaIndexEntry[],
  missingScreenshotCount?: number,
  pinterestEvidenceRequired = false
): boolean => {
  if (guidance?.readiness !== "ready") return false;
  const references = selectRendererAuthorityReferences({ referencePatternBoard, rankedReferences });
  if (references.length === 0) return false;
  if (hasActiveInspiredesignCanvasDoNotProceedBlocker(
    guidance.doNotProceedIf,
    references.length,
    missingScreenshotCount
  )) return false;
  const hasPinterestReference = references.some((reference) => (
    isInspiredesignPinterestPinReferenceUrl(reference.url)
  ));
  if (pinterestEvidenceRequired && !hasPinterestReference) return false;
	return references.every((reference) => {
	if (isInspiredesignPinterestPinReferenceUrl(reference.url)) {
		return hasPinterestPinMediaReadyAuthority(reference, pinMediaIndex);
	}
	return isInspiredesignAuthoritativeRankedReference(reference, {
      screenshots: screenshotIndex,
      motions: motionEvidence,
      pinMedia: pinMediaIndex
	});
	});
};

const missingRequiredVisualReferenceCount = (args: {
	referencePatternBoard: InspiredesignReferencePatternBoard | undefined;
	rankedReferences: InspiredesignReferencePatternBoard["references"];
	screenshotIndex: readonly InspiredesignScreenshotIndexEntry[];
	motionEvidence: readonly InspiredesignMotionEvidenceJson[];
	pinMediaIndex: readonly InspiredesignPinterestPinMediaIndexEntry[];
}): number => {
	const references = selectRendererAuthorityReferences(args);
	return references.filter((reference) => (
		!isInspiredesignAuthoritativeRankedReference(reference, {
			screenshots: args.screenshotIndex,
			motions: args.motionEvidence,
			pinMedia: args.pinMediaIndex
		})
	)).length;
};

const scrubCanvasPlanReference = (value: string): string => (
  value.includes(INSPIREDESIGN_HANDOFF_FILES.canvasPlanRequest)
    ? CANVAS_PLAN_OMITTED_GUIDANCE
    : value
);

const scrubGuideEntryCanvasReferences = (entry: InspiredesignGuideEntry): InspiredesignGuideEntry => ({
  ...entry,
  expectedContents: entry.expectedContents.map(scrubCanvasPlanReference),
  howToUse: entry.howToUse.map(scrubCanvasPlanReference),
  mustNot: entry.mustNot.map(scrubCanvasPlanReference)
});

const scrubArtifactGuideCanvasReferences = (
  guide: RenderedInspiredesignArtifactGuide
): RenderedInspiredesignArtifactGuide => {
  const scrubbed: RenderedInspiredesignArtifactGuide = {};
  for (const [key, entry] of Object.entries(guide)) {
    if (entry) {
      scrubbed[key as keyof InspiredesignArtifactGuide] = scrubGuideEntryCanvasReferences(entry);
    }
  }
  return scrubbed;
};

const scrubContractSectionGuideCanvasReferences = (
  guide: InspiredesignContractSectionGuide
): InspiredesignContractSectionGuide => {
  const scrubbed: InspiredesignContractSectionGuide = {};
  for (const [key, entry] of Object.entries(guide)) {
    scrubbed[key] = scrubGuideEntryCanvasReferences(entry);
  }
  return scrubbed;
};

const blockInspiredesignCanvasArtifactGuide = (
  handoff: InspiredesignFollowthrough
): RenderedInspiredesignArtifactGuide => {
  const artifactGuide: RenderedInspiredesignArtifactGuide = { ...handoff.artifactGuide };
  delete artifactGuide[INSPIREDESIGN_HANDOFF_FILES.canvasPlanRequest];
  return artifactGuide;
};

const blockInspiredesignNotReadyArtifacts = (
  handoff: RenderedInspiredesignFollowthrough
): RenderedInspiredesignFollowthrough => {
  const referenceSynthesis = plainObject(handoff.implementationContext.referenceSynthesis);
  const blockedArtifacts: ReadonlySet<string> = new Set([
    INSPIREDESIGN_HANDOFF_FILES.canvasPlanRequest,
    INSPIREDESIGN_HANDOFF_FILES.prototypeGuidance
  ]);
  const requiredArtifacts = isStringArray(referenceSynthesis.requiredArtifacts)
    ? referenceSynthesis.requiredArtifacts.filter((artifact) => !blockedArtifacts.has(artifact))
    : [];
  const artifactGuide: RenderedInspiredesignArtifactGuide = { ...handoff.artifactGuide };
  delete artifactGuide[INSPIREDESIGN_HANDOFF_FILES.canvasPlanRequest];
  delete artifactGuide[INSPIREDESIGN_HANDOFF_FILES.prototypeGuidance];
  return {
    ...handoff,
    artifactGuide: scrubArtifactGuideCanvasReferences(artifactGuide),
    contractSectionGuide: scrubContractSectionGuideCanvasReferences(handoff.contractSectionGuide),
    implementationContext: {
      ...handoff.implementationContext,
      referenceSynthesis: {
        ...referenceSynthesis,
        requiredArtifacts
      }
    }
  };
};

const markDiagnosticMarkdown = (markdown: string): string => (
  markdown.startsWith(DIAGNOSTIC_ARTIFACT_WARNING)
    ? markdown
    : `${DIAGNOSTIC_ARTIFACT_WARNING}\n\n${markdown}`
);

const markInspiredesignJsonArtifactAuthority = <T extends Record<string, unknown>>(
  artifact: T,
  fields: InspiredesignAuthorityFields
): T & InspiredesignAuthorityFields => ({
  ...artifact,
  ...fields
});

const buildDiagnosticInspiredesignAuthorityFields = (): InspiredesignAuthorityFields => ({
	ready: false,
	artifactAuthority: "diagnostic_only",
	evidenceAuthority: "diagnostic_only",
	productSuccess: false,
	diagnosticWarning: DIAGNOSTIC_ARTIFACT_WARNING
});

const replaceCanvasPlanDeliverableInDesignMarkdown = (markdown: string, replacement: string): string => (
  markdown
    .replaceAll(
      `\n- ${CANVAS_PLAN_PACKET_DIAGNOSTIC_DELIVERABLE}`,
      `\n- ${replacement}`
    )
    .replaceAll(
      `\n- ${CANVAS_PLAN_READY_DELIVERABLE}`,
      `\n- ${replacement}`
    )
);

const blockPrototypeGuidanceInDesignMarkdown = (
  markdown: string,
  prototypeGuidanceMarkdown: string | null
): string => {
  const withoutCanvasDeliverable = replaceCanvasPlanDeliverableInDesignMarkdown(
    markdown,
    CANVAS_PLAN_OMITTED_GUIDANCE
  );
  const withoutPrototypeDeliverable = withoutCanvasDeliverable.replace(
    /\n- Prototype guidance Markdown for the first HTML pass/g,
    ""
  );
  if (!prototypeGuidanceMarkdown) return withoutPrototypeDeliverable;
  return withoutPrototypeDeliverable.replace(
    prototypeGuidanceMarkdown,
    "# 6. Optional Prototype Plan\n\n- Prototype guidance omitted because next-step guidance is not ready."
  );
};

const promoteCanvasContinuationInDesignMarkdown = (markdown: string): string => (
  replaceCanvasPlanDeliverableInDesignMarkdown(markdown, CANVAS_PLAN_READY_DELIVERABLE)
);

const buildMissingInspiredesignGuidanceHandoff = (): {
  followthroughSummary: string;
  suggestedNextAction: string;
  suggestedSteps: Array<{ reason: string; command?: string }>;
} => {
  const summary = "Canvas continuation unavailable until product-ready authority fields and manifest-backed evidence agree.";
  return {
    followthroughSummary: summary,
    suggestedNextAction: summary,
    suggestedSteps: [{
      reason: "Inspect top-level ready, productSuccess, artifactAuthority, evidenceAuthority, and manifest-backed evidence before using Canvas artifacts."
    }]
  };
};

const buildBlockedInspiredesignCanvasHandoff = (): {
  followthroughSummary: string;
  suggestedNextAction: string;
  suggestedSteps: Array<{ reason: string; command?: string }>;
} => {
  const summary = "Canvas continuation unavailable until ranked references include authoritative visual, motion, or pin-media evidence.";
  return {
    followthroughSummary: summary,
    suggestedNextAction: summary,
    suggestedSteps: [{
      reason: "Recover authoritative screenshot, screencast, or pin-media artifacts before using Canvas artifacts.",
      command: CANVAS_CONTINUATION_BLOCKED_COMMAND
    }]
  };
};

const deadEndSearchFailures = (failures: unknown): Record<string, unknown>[] => {
  if (!Array.isArray(failures)) return [];
  return failures.filter((failure): failure is Record<string, unknown> => {
    const record = plainObject(failure);
    const error = plainObject(record.error);
    const details = plainObject(error.details);
    return details.fallbackOutputReason === "research_dead_end_shell";
  });
};

const deadEndSearchFailureCount = (meta: Record<string, unknown>): number => (
  deadEndSearchFailures(meta.failures).length
);

const rejectedCandidatesFromMeta = (meta: Record<string, unknown>): Record<string, unknown>[] => (
  Array.isArray(meta.rejected_candidates)
    ? meta.rejected_candidates.map(plainObject).filter((candidate) => Object.keys(candidate).length > 0)
    : []
);

const rejectedCandidateCount = (meta: Record<string, unknown>): number => {
  const metrics = plainObject(meta.metrics);
  if (typeof metrics.rejected_candidate_count === "number") {
    return metrics.rejected_candidate_count;
  }
  const sanitized = typeof metrics.sanitized_records === "number" ? metrics.sanitized_records : 0;
  return sanitized + deadEndSearchFailureCount(meta);
};

const researchSearchDirectionLines = (meta: Record<string, unknown>): string[] => {
  const selection = plainObject(meta.selection);
  const sources = Array.isArray(selection.resolved_sources)
    ? selection.resolved_sources.map(String).join(", ")
    : "not recorded";
  return [
    "## Search Direction",
    `- Source families searched: ${sources}`,
    "- Direction: Follow accepted destination pages from provider/search output before synthesis."
  ];
};

const researchSourceFamilies = (meta: Record<string, unknown>): string[] => {
  const sources = plainObject(meta.selection).resolved_sources;
  return Array.isArray(sources) ? sources.map(String) : [];
};

const researchCandidateTriageSchema = (): Record<string, unknown> => ({
  url: "",
  rank: 0,
  engine: "",
  query: "",
  source_family: "",
  title: "",
  status: "pending|accepted|rejected",
  blocker_notes: "",
  rejection_reason: "",
  replacement_url: "",
  retrieval_notes: "",
  extraction_status: "pending|fetched|blocked|shell|stale|irrelevant"
});

const researchSynthesisFeedbackText = (records: ResearchRecord[], meta: Record<string, unknown>): string => {
  const rejected = rejectedCandidateCount(meta);
  return records.length === 0 || rejected > records.length
    ? "Continue with remaining public destination candidates or narrow the query; use auth/cookies only when a selected evidence page itself requires authorized access."
    : "Synthesize only the accepted destination evidence and cite records.json for full source text.";
};

const researchContextPayload = (args: {
  topic: string;
  lines: string[];
  records: ResearchRecord[];
  meta: Record<string, unknown>;
}): Record<string, unknown> => ({
  topic: args.topic,
  timebox: plainObject(args.meta.timebox),
  source_families: researchSourceFamilies(args.meta),
  evidence_gate: {
    status: "pending_review",
    reviewed_artifacts: []
  },
  artifact_files: RESEARCH_BUNDLE_FILE_NAMES,
  source_ledger: args.records.map((record) => ({
    title: researchTitle(record),
    url: record.url,
    source_family: record.source,
    provider: record.provider
  })),
  search_direction_notes: researchSearchDirectionLines(args.meta),
  candidate_triage_schema: researchCandidateTriageSchema(),
  highlights: args.lines,
  records: args.records,
  candidate_triage: {
    accepted_destination_records: args.records.length,
    rejected_shell_or_dead_end_candidates: rejectedCandidateCount(args.meta)
  },
  rejected_candidates: rejectedCandidatesFromMeta(args.meta),
  deep_dive_pages: args.records.map((record) => ({
    title: researchTitle(record),
    url: record.url,
    provider: record.provider,
    source: record.source,
    retrievalPath: record.attributes.retrievalPath
  })),
  iteration_log: researchSearchDirectionLines(args.meta),
  synthesis_feedback: researchSynthesisFeedbackText(args.records, args.meta),
  meta: args.meta
});

const buildResearchReport = (args: {
  topic: string;
  records: ResearchRecord[];
  meta: Record<string, unknown>;
}): string => renderResearchBriefingMarkdown(buildResearchBriefing({
  topic: args.topic,
  records: args.records,
  meta: args.meta,
  artifactFiles: RESEARCH_BUNDLE_FILE_NAMES
}));

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
  const contextPayload = researchContextPayload({
    topic: args.topic,
    lines,
    records: args.records,
    meta: args.meta
  });

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
        markdown: report,
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

const csvCell = (value: string): string => {
  const normalized = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return `"${normalized.replace(/"/g, "\"\"")}"`;
};

const comparisonTotalStatus = (args: {
  validPrice: boolean;
  validShipping: boolean;
  currenciesMatch: boolean;
}): string => {
  if (!args.validPrice || !args.validShipping) return "invalid_price";
  return args.currenciesMatch ? "computed" : "currency_mismatch";
};

const toComparisonCsv = (offers: ShoppingOffer[]): string => {
  const header = [
    "provider",
    "title",
    "price",
    "shipping",
    "deal_score",
    "availability",
    "url",
    "price_currency",
    "shipping_currency",
    "total",
    "total_currency",
    "total_status",
    "currency_warning"
  ].join(",");
  const rows = offers.map((offer) => {
    const priceCurrency = offer.price.currency.toUpperCase();
    const shippingCurrency = offer.shipping.currency.toUpperCase();
    const currenciesMatch = priceCurrency === shippingCurrency;
    const validPrice = Number.isFinite(offer.price.amount) && offer.price.amount > 0;
    const validShipping = Number.isFinite(offer.shipping.amount) && offer.shipping.amount >= 0;
    const totalComputable = currenciesMatch && validPrice && validShipping;
    const total = totalComputable ? (offer.price.amount + offer.shipping.amount).toFixed(2) : "";
    const totalCurrency = totalComputable ? priceCurrency : "";
    const totalStatus = comparisonTotalStatus({ validPrice, validShipping, currenciesMatch });
    const currencyWarning = currenciesMatch ? "" : "item and shipping currencies differ";
    return [
      csvCell(offer.provider),
      csvCell(offer.title),
      Number.isFinite(offer.price.amount) ? offer.price.amount.toFixed(2) : "",
      Number.isFinite(offer.shipping.amount) ? offer.shipping.amount.toFixed(2) : "",
      offer.deal_score.toFixed(4),
      csvCell(offer.availability),
      csvCell(canonicalizeUrl(offer.url)),
      csvCell(priceCurrency),
      csvCell(shippingCurrency),
      total,
      csvCell(totalCurrency),
      csvCell(totalStatus),
      csvCell(currencyWarning)
    ].join(",");
  });
  return [header, ...rows].join("\n");
};

const collapseShoppingText = (value: string): string => value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();

const sanitizeShoppingText = (value: string): string => (
  collapseShoppingText(value).replace(/([\\`*_{}\[\]()#+!|>~])/g, "\\$1")
);

const SHOPPING_FRESHNESS_WARNING_PREFIXES = ["price freshness "] as const;
const SHOPPING_AVAILABILITY_WARNING_PREFIXES = ["unknown availability", "out-of-stock"] as const;
const SHOPPING_RELEVANCE_WARNING_PREFIXES = ["weak relevance:", "suspicious title:"] as const;
const SHOPPING_DUPLICATE_WARNING_PREFIXES = ["duplicate pressure"] as const;
const SHOPPING_MARKET_WARNING_PREFIXES = [
  "currency coverage incomplete",
  "market baseline unavailable",
  "mixed-currency market baseline unavailable"
] as const;

const shoppingTopCandidate = (briefing: ShoppingBriefing): ShoppingOfferAssessment | undefined => {
  if (briefing.gate.status === "fail") return undefined;
  if (briefing.marketBaseline.status === "unavailable" && briefing.marketBaseline.excludedDifferentCurrencyCount > 0) {
    return undefined;
  }
  return briefing.assessments.find((assessment) => assessment.recommendation === "recommended")
    ?? briefing.assessments.find((assessment) => assessment.recommendation === "candidate")
    ?? briefing.assessments.find((assessment) => assessment.recommendation === "constrained");
};

const shoppingVisibleRecommendation = (
  briefing: ShoppingBriefing,
  assessment: ShoppingOfferAssessment
): string => {
  if (briefing.gate.status === "pass") return assessment.recommendation;
  return assessment.recommendation === "recommended" ? "candidate" : assessment.recommendation;
};

const shoppingCandidateSummary = (briefing: ShoppingBriefing, assessment: ShoppingOfferAssessment): string => {
  const evidence = assessment.evidence;
  const price = evidence.currencyMismatch
    ? `item ${sanitizeShoppingText(evidence.itemPrice.currency)} ${evidence.itemPrice.amount.toFixed(2)} plus shipping ${sanitizeShoppingText(evidence.shippingPrice.currency)} ${evidence.shippingPrice.amount.toFixed(2)}, total unavailable`
    : `${sanitizeShoppingText(evidence.totalPrice.currency)} ${evidence.totalPrice.amount.toFixed(2)}`;
  return `provider-supplied title: ${sanitizeShoppingText(evidence.title)} (${sanitizeShoppingText(evidence.provider)}, ${price}, ${shoppingVisibleRecommendation(briefing, assessment)})`;
};

const shoppingCountConstraint = (count: number, label: string): string | undefined => (
  count > 0 ? `${label}: ${count}` : undefined
);

const shoppingMetaConstraint = (briefing: ShoppingBriefing): string | undefined => [
  briefing.metaView.primaryConstraintSummary,
  briefing.metaView.regionAuthority === "advisory" ? "requested region is advisory, not authoritative" : undefined,
  shoppingCountConstraint(briefing.metaView.failures.length, "workflow failures"),
  shoppingCountConstraint(briefing.metaView.alerts.length, "workflow alerts"),
  briefing.metaView.failedProviders.length > 0 ? `failed providers: ${briefing.metaView.failedProviders.join(", ")}` : undefined,
  shoppingCountConstraint(briefing.metaView.offerFilterDiagnostics.length, "offer filter diagnostics")
].find((constraint): constraint is string => typeof constraint === "string" && constraint.length > 0);

const firstShoppingWarningWithPrefix = (
  warnings: readonly string[],
  prefixes: readonly string[]
): string | undefined => warnings.find((warning) => prefixes.some((prefix) => warning.startsWith(prefix)));

const shoppingOrderedWarningConstraint = (warnings: readonly string[]): string | undefined => {
  const groups = [
    SHOPPING_FRESHNESS_WARNING_PREFIXES,
    SHOPPING_AVAILABILITY_WARNING_PREFIXES,
    SHOPPING_RELEVANCE_WARNING_PREFIXES,
    SHOPPING_DUPLICATE_WARNING_PREFIXES,
    SHOPPING_MARKET_WARNING_PREFIXES
  ];
  for (const group of groups) {
    const warning = firstShoppingWarningWithPrefix(warnings, group);
    if (warning) return warning;
  }
  return warnings.find((warning) => warning.startsWith("buyer limitation")) ?? warnings[0];
};

const shoppingKeyConstraint = (briefing: ShoppingBriefing): string => {
  const metaConstraint = shoppingMetaConstraint(briefing);
  if (metaConstraint) return sanitizeShoppingText(metaConstraint);
  const warningConstraint = shoppingOrderedWarningConstraint(briefing.warnings);
  if (warningConstraint) return sanitizeShoppingText(warningConstraint);
  if (briefing.marketBaseline.status === "unavailable") return sanitizeShoppingText(briefing.marketBaseline.reason);
  return "No major report constraint surfaced.";
};

const shoppingBriefingGuidanceLines = (briefing: ShoppingBriefing): string[] => {
  const lines = [
    `Buying readiness: ${briefing.gate.status} (${briefing.confidence} confidence). ${briefing.gate.summary}`,
    `Recommendation: ${sanitizeShoppingText(briefing.recommendation[0] ?? briefing.gate.summary)}`
  ];
  const candidate = shoppingTopCandidate(briefing);
  if (candidate) lines.push(`Top candidate evidence: ${shoppingCandidateSummary(briefing, candidate)}`);
  const constraintLabel = briefing.metaView.primaryConstraintSummary ? "Primary constraint" : "Key constraint";
  lines.push(`${constraintLabel}: ${shoppingKeyConstraint(briefing)}`);
  return lines;
};

export const renderShopping = (args: {
  mode: RenderMode;
  query: string;
  offers: ShoppingOffer[];
  meta: Record<string, unknown>;
  freshnessReferenceIso?: string;
}): {
  response: Record<string, unknown>;
  files: Array<{ path: string; content: string | Record<string, unknown> }>;
} => {
  const briefing = buildShoppingBriefing({
    query: args.query,
    offers: args.offers,
    meta: args.meta,
    ...(args.freshnessReferenceIso ? { freshnessReferenceIso: args.freshnessReferenceIso } : {})
  });
  const markdown = renderShoppingBriefingMarkdown(briefing);
  const guidanceLines = shoppingBriefingGuidanceLines(briefing);
  const comparisonCsv = toComparisonCsv(args.offers);
  const buyingReadiness = briefing.gate;
  const contextPayload = {
    query: args.query,
    buyingReadiness,
    highlights: guidanceLines,
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
        buyingReadiness,
        summary: guidanceLines.join("\n"),
        meta: args.meta
      },
      files
    };
  }
  if (args.mode === "json") {
    return {
      response: {
        mode: args.mode,
        buyingReadiness,
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
        buyingReadiness,
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
        buyingReadiness,
        context: contextPayload,
        meta: args.meta
      },
      files
    };
  }

  return {
    response: {
      mode: "path",
      buyingReadiness,
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
  visualEvidence?: InspiredesignVisualEvidenceJson[];
  screenshotIndex?: InspiredesignScreenshotIndexEntry[];
  motionEvidence?: InspiredesignMotionEvidenceJson[];
  pinMediaEvidence?: InspiredesignPinMediaEvidenceJson[];
  pinMediaIndex?: InspiredesignPinterestPinMediaIndexEntry[];
  mediaAnalysis?: InspiredesignMediaAnalysis;
  authorityScreenshotIndex?: InspiredesignScreenshotIndexEntry[];
  authorityMotionEvidence?: InspiredesignMotionEvidenceJson[];
  authorityPinMediaIndex?: InspiredesignPinterestPinMediaIndexEntry[];
  rankedReferences?: InspiredesignReferencePatternBoard["references"];
  referencePatternBoard?: InspiredesignReferencePatternBoard;
  metaPromptMarkdown?: string;
  nextStepGuidance?: NextStepGuidance;
  meta: Record<string, unknown>;
}): {
  response: Record<string, unknown>;
  files: Array<{ path: string; content: string | Record<string, unknown> }>;
} => {
  const captureAttemptReport = inspiredesignCaptureAttemptReportFromMeta(args.meta);
  const captureAttemptSummary = inspiredesignCaptureAttemptSummaryFromMeta(args.meta);
  const visualEvidence = args.visualEvidence ?? [];
  const screenshotIndex = args.screenshotIndex ?? [];
  const motionEvidence = args.motionEvidence ?? [];
  const pinMediaEvidence = redactRenderedPinMediaEvidence(args.pinMediaEvidence ?? []);
  const pinMediaIndex = projectRenderedPinMediaIndex(args.pinMediaIndex ?? []);
  const mediaAnalysis = args.mediaAnalysis;
  const authorityScreenshotIndex = args.authorityScreenshotIndex ?? screenshotIndex;
  const authorityMotionEvidence = args.authorityMotionEvidence ?? motionEvidence;
  const authorityPinMediaIndex = args.authorityPinMediaIndex
    ? projectRenderedPinMediaIndex(args.authorityPinMediaIndex)
    : [];
  const rankedReferences = args.rankedReferences ?? [];
  const rankedReferencesArtifact = args.referencePatternBoard
    ? {
      qualitySummary: args.referencePatternBoard.qualitySummary,
      references: args.referencePatternBoard.references,
      rejectedReferences: args.referencePatternBoard.rejectedReferences,
      synthesis: args.referencePatternBoard.synthesis
    }
    : {
      references: rankedReferences,
      rejectedReferences: []
    };
  const metaPromptMarkdown = args.metaPromptMarkdown ?? "";
  const summary = buildInspiredesignSummary({
    brief: args.brief,
    referenceCount: args.urls.length,
    profile: args.generationPlan.visualDirection.profile,
    meta: args.meta
  });
  const followthroughSummary = prependPrimaryConstraint(args.designAgentHandoff.summary, args.meta);
  const selection = typeof args.meta.selection === "object" && args.meta.selection !== null && !Array.isArray(args.meta.selection)
    ? args.meta.selection as Record<string, unknown>
    : {};
  const requiredVisualEvidenceMissingCount = selection.visual_evidence === "required"
    ? missingRequiredVisualReferenceCount({
      referencePatternBoard: args.referencePatternBoard,
      rankedReferences,
      screenshotIndex: authorityScreenshotIndex,
      motionEvidence: authorityMotionEvidence,
      pinMediaIndex: authorityPinMediaIndex
    })
    : 0;
  const computedCanContinueInCanvas = canContinueInspiredesignInCanvas(
	    args.nextStepGuidance,
	    args.referencePatternBoard,
	    rankedReferences,
	    authorityScreenshotIndex,
	    authorityMotionEvidence,
    authorityPinMediaIndex,
    requiredVisualEvidenceMissingCount,
    args.meta.pinterestEvidenceRequired === true
  );
	const rendererReadinessCountsAreCoherent = hasCoherentRendererReadinessCounts({
		meta: args.meta,
		referencePatternBoard: args.referencePatternBoard,
		rankedReferences,
		screenshotIndex: authorityScreenshotIndex,
		motionEvidence: authorityMotionEvidence,
		pinMediaIndex: authorityPinMediaIndex
	});
  const hasWorkflowProductReadiness = typeof args.meta.productSuccess === "boolean";
	const baseCanContinueInCanvas = hasWorkflowProductReadiness
	? args.meta.productSuccess === true && rendererReadinessCountsAreCoherent && computedCanContinueInCanvas
	: rendererReadinessCountsAreCoherent && computedCanContinueInCanvas;
	const baseArtifactAuthority = baseCanContinueInCanvas ? "product_ready" : "diagnostic_only";
	const baseProductSuccess = baseArtifactAuthority === "product_ready";
	const baseEvidenceAuthority = evidenceAuthorityForProductReadyArtifacts({
	productSuccess: baseProductSuccess,
	referencePatternBoard: args.referencePatternBoard,
    rankedReferences,
    screenshotIndex: authorityScreenshotIndex,
    motionEvidence: authorityMotionEvidence,
    pinMediaIndex: authorityPinMediaIndex
  });
	const baseAuthorityFields: InspiredesignAuthorityFields = {
		ready: baseProductSuccess,
		artifactAuthority: baseArtifactAuthority,
		evidenceAuthority: baseEvidenceAuthority,
		productSuccess: baseProductSuccess,
	...(!baseProductSuccess ? { diagnosticWarning: DIAGNOSTIC_ARTIFACT_WARNING } : {})
  };
	const authorityFields: InspiredesignAuthorityFields = baseAuthorityFields;
	const canContinueInCanvas = authorityFields.productSuccess;
	const { artifactAuthority, evidenceAuthority, productSuccess, ready } = authorityFields;
  const mediaAnalysisArtifact = mediaAnalysis
    ? mediaAnalysis
    : undefined;
  const metaWithAuthority = {
    ...args.meta,
    ...authorityFields
  };
  const renderedPinMediaIndex = authorityPinMediaIndex;
  const evidenceArtifact = markInspiredesignJsonArtifactAuthority({
    ...args.evidence,
    pinMediaIndex: renderedPinMediaIndex
  }, authorityFields);
  const rankedReferencesWithAuthority = markInspiredesignJsonArtifactAuthority(
    rankedReferencesArtifact,
    authorityFields
  );
  const prototypeGuidanceMarkdown = canContinueInCanvas ? args.prototypeGuidanceMarkdown : null;
  const designMarkdown = canContinueInCanvas
    ? promoteCanvasContinuationInDesignMarkdown(args.designMarkdown)
    : markDiagnosticMarkdown(blockPrototypeGuidanceInDesignMarkdown(args.designMarkdown, args.prototypeGuidanceMarkdown));
  const advancedBriefMarkdown = canContinueInCanvas ? args.advancedBriefMarkdown : markDiagnosticMarkdown(args.advancedBriefMarkdown);
  const implementationPlanMarkdown = canContinueInCanvas
    ? args.implementationPlanMarkdown
    : markDiagnosticMarkdown(args.implementationPlanMarkdown);
  const metaPromptMarkdownWithAuthority = canContinueInCanvas ? metaPromptMarkdown : markDiagnosticMarkdown(metaPromptMarkdown);
  const commandExamples = {
    ...args.designAgentHandoff.commandExamples,
    continueInCanvas: canContinueInCanvas
      ? args.designAgentHandoff.commandExamples.continueInCanvas
      : CANVAS_CONTINUATION_BLOCKED_COMMAND
  };
  const renderedWorkflowHandoff = buildInspiredesignSuccessHandoff({
    summary: followthroughSummary,
    nextStep: args.designAgentHandoff.nextStep,
    commandExamples,
    deepCaptureRecommendation: args.designAgentHandoff.deepCaptureRecommendation,
    ...(args.nextStepGuidance ? { nextStepGuidance: args.nextStepGuidance } : {})
  });
  let handoff = buildMissingInspiredesignGuidanceHandoff();
  if (args.nextStepGuidance) {
    handoff = canContinueInCanvas || args.nextStepGuidance.readiness !== "ready"
      ? renderedWorkflowHandoff
      : {
        ...renderedWorkflowHandoff,
        ...buildBlockedInspiredesignCanvasHandoff()
      };
  }
  const blockedCanvasArtifactGuide: RenderedInspiredesignArtifactGuide = canContinueInCanvas
    ? args.designAgentHandoff.artifactGuide
    : blockInspiredesignCanvasArtifactGuide(args.designAgentHandoff);
  const renderedDesignAgentHandoffBase: RenderedInspiredesignFollowthrough = {
    ...args.designAgentHandoff,
    artifactAuthority,
    evidenceAuthority,
    productSuccess,
    ...handoff,
    summary: handoff.followthroughSummary,
    nextStep: handoff.suggestedNextAction,
    artifactGuide: blockedCanvasArtifactGuide,
    commandExamples
  };
  const renderedDesignAgentHandoff = canContinueInCanvas
    ? renderedDesignAgentHandoffBase
    : blockInspiredesignNotReadyArtifacts(renderedDesignAgentHandoffBase);
	const contextPayload = {
		brief: args.brief,
		ready,
		artifactAuthority,
		evidenceAuthority,
		productSuccess,
    advancedBriefMarkdown,
    urls: args.urls,
    designContract: markInspiredesignJsonArtifactAuthority(args.designContract, authorityFields),
    ...(canContinueInCanvas ? { canvasPlanRequest: args.canvasPlanRequest } : {}),
    designAgentHandoff: renderedDesignAgentHandoff,
    ...(args.nextStepGuidance ? { nextStepGuidance: args.nextStepGuidance } : {}),
    generationPlan: markInspiredesignJsonArtifactAuthority(args.generationPlan, authorityFields),
    implementationPlan: markInspiredesignJsonArtifactAuthority(args.implementationPlan, authorityFields),
    designMarkdown,
    implementationPlanMarkdown,
    prototypeGuidanceMarkdown,
    evidence: evidenceArtifact,
    visualEvidence,
    screenshotIndex,
    motionEvidence,
    pinMediaEvidence,
    pinMediaIndex: renderedPinMediaIndex,
    ...(mediaAnalysisArtifact ? { mediaAnalysis: mediaAnalysisArtifact } : {}),
    rankedReferences,
    metaPromptMarkdown: metaPromptMarkdownWithAuthority,
    meta: metaWithAuthority
  };
  const files: Array<{ path: string; content: string | Record<string, unknown> }> = [
    { path: INSPIREDESIGN_HANDOFF_FILES.designMarkdown, content: designMarkdown },
    { path: INSPIREDESIGN_HANDOFF_FILES.advancedBrief, content: advancedBriefMarkdown },
    {
      path: INSPIREDESIGN_HANDOFF_FILES.designContract,
      content: markInspiredesignJsonArtifactAuthority(args.designContract, authorityFields)
    },
    {
      path: INSPIREDESIGN_HANDOFF_FILES.designAgentHandoff,
      content: renderedDesignAgentHandoff
    },
    {
      path: INSPIREDESIGN_HANDOFF_FILES.generationPlan,
      content: markInspiredesignJsonArtifactAuthority(args.generationPlan, authorityFields)
    },
    { path: INSPIREDESIGN_HANDOFF_FILES.implementationPlanMarkdown, content: implementationPlanMarkdown },
    {
      path: INSPIREDESIGN_HANDOFF_FILES.implementationPlan,
      content: markInspiredesignJsonArtifactAuthority(args.implementationPlan, authorityFields)
    },
    { path: INSPIREDESIGN_HANDOFF_FILES.evidence, content: evidenceArtifact },
    { path: INSPIREDESIGN_HANDOFF_FILES.visualEvidence, content: { visualEvidence } },
    { path: INSPIREDESIGN_HANDOFF_FILES.screenshotIndex, content: { screenshots: screenshotIndex } },
    { path: INSPIREDESIGN_HANDOFF_FILES.motionEvidence, content: { motionEvidence } },
    { path: INSPIREDESIGN_HANDOFF_FILES.pinMediaEvidence, content: { pinMediaEvidence } },
    { path: INSPIREDESIGN_HANDOFF_FILES.pinMediaIndex, content: { pinMediaIndex: renderedPinMediaIndex } },
    ...(mediaAnalysisArtifact ? [{ path: INSPIREDESIGN_HANDOFF_FILES.mediaAnalysis, content: mediaAnalysisArtifact }] : []),
    { path: INSPIREDESIGN_HANDOFF_FILES.rankedReferences, content: rankedReferencesWithAuthority },
    { path: INSPIREDESIGN_HANDOFF_FILES.metaPrompt, content: metaPromptMarkdownWithAuthority }
  ];
  if (prototypeGuidanceMarkdown) {
    files.push({ path: INSPIREDESIGN_HANDOFF_FILES.prototypeGuidance, content: prototypeGuidanceMarkdown });
  }
  if (canContinueInCanvas) {
    files.push({ path: INSPIREDESIGN_HANDOFF_FILES.canvasPlanRequest, content: args.canvasPlanRequest });
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
				ready,
				artifactAuthority,
				productSuccess,
        evidenceAuthority,
        ...captureAttemptFields,
        meta: metaWithAuthority
      },
      files
    };
  }
  if (args.mode === "json") {
    return {
      response: {
        mode: args.mode,
        brief: args.brief,
        advancedBriefMarkdown,
        urls: args.urls,
        ...(canContinueInCanvas ? { canvasPlanRequest: args.canvasPlanRequest } : {}),
        designAgentHandoff: renderedDesignAgentHandoff,
        ...(args.nextStepGuidance ? { nextStepGuidance: args.nextStepGuidance } : {}),
        designContract: markInspiredesignJsonArtifactAuthority(args.designContract, authorityFields),
        generationPlan: markInspiredesignJsonArtifactAuthority(args.generationPlan, authorityFields),
        implementationPlan: markInspiredesignJsonArtifactAuthority(args.implementationPlan, authorityFields),
				prototypeGuidanceMarkdown,
				ready,
				artifactAuthority,
				productSuccess,
        evidenceAuthority,
        evidence: evidenceArtifact,
        visualEvidence,
        screenshotIndex,
        motionEvidence,
        pinMediaEvidence,
        pinMediaIndex: renderedPinMediaIndex,
        ...(mediaAnalysisArtifact ? { mediaAnalysis: mediaAnalysisArtifact } : {}),
        rankedReferences,
        metaPromptMarkdown: metaPromptMarkdownWithAuthority,
        ...handoff,
        ...captureAttemptFields,
        meta: metaWithAuthority
      },
      files
    };
  }
  if (args.mode === "md") {
    return {
      response: {
        mode: args.mode,
        markdown: designMarkdown,
        implementationPlanMarkdown,
				prototypeGuidanceMarkdown,
				ready,
				artifactAuthority,
				productSuccess,
        evidenceAuthority,
        ...handoff,
        ...captureAttemptFields,
        meta: metaWithAuthority
      },
      files
    };
  }
  if (args.mode === "context") {
    return {
      response: {
				mode: args.mode,
				ready,
				artifactAuthority,
				productSuccess,
        evidenceAuthority,
        context: contextPayload,
        ...handoff,
        ...captureAttemptFields,
        meta: metaWithAuthority
      },
      files
    };
  }

  return {
    response: {
			mode: "path",
			...handoff,
			ready,
			artifactAuthority,
      productSuccess,
      evidenceAuthority,
      ...captureAttemptFields,
      meta: metaWithAuthority
    },
    files
  };
};
