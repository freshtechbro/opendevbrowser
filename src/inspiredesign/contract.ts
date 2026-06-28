import { createHash } from "crypto";
import { normalizePinterestReferenceUrl } from "../guidance/recipes/pinterest";
import generationPlanTemplateJson from "../../skills/opendevbrowser-design-agent/assets/templates/canvas-generation-plan.design.v1.json";
import designContractTemplateJson from "../../skills/opendevbrowser-design-agent/assets/templates/design-contract.v1.json";
import type {
  CanvasAsset,
  CanvasComponentInventoryItem,
  CanvasDesignGovernance,
  CanvasGenerationPlan,
  CanvasNavigationModel,
  CanvasThemeStrategy,
  CanvasVisualDirectionProfile
} from "../canvas/types";
import {
  INSPIREDESIGN_ARTIFACT_GUIDE,
  INSPIREDESIGN_CONTRACT_SECTION_GUIDE,
  INSPIREDESIGN_HANDOFF_COMMANDS,
  INSPIREDESIGN_HANDOFF_GUIDANCE,
  INSPIREDESIGN_HANDOFF_RECOMMENDED_SKILLS,
  INSPIREDESIGN_HANDOFF_FILES,
  buildInspiredesignFollowthroughSummary,
  buildInspiredesignNextStep,
  type InspiredesignArtifactGuide,
  type InspiredesignContractSectionGuide
} from "./handoff";
import {
  INSPIREDESIGN_BRIEF_COMMON_RULES,
  INSPIREDESIGN_BRIEF_OUTPUT_REQUIREMENTS,
  cloneInspiredesignBriefFormat,
  type InspiredesignBriefExpansion,
  type InspiredesignBriefFormat
} from "./brief-expansion";
import {
  buildInspiredesignDesignVectors,
  buildInspiredesignDesignReferencePatternBoard,
  buildInspiredesignReferencePatternBoard,
  getInspiredesignReferenceSignals,
  isInspiredesignDesignReference,
  hasInspiredesignUsableReferenceEvidence,
  type InspiredesignDesignVectors,
  type InspiredesignReferencePatternBoard
} from "./reference-pattern-board";
import { buildInspiredesignMetaPrompt } from "./meta-prompt";
import {
  persistInspiredesignVisualEvidence,
  type InspiredesignPersistedVisualEvidence,
  type InspiredesignVisualEvidenceRuntimeMetadata
} from "./visual-evidence";
import {
  persistInspiredesignMotionEvidence,
  type InspiredesignMotionEvidenceRuntimeMetadata,
  type InspiredesignPersistedMotionEvidence
} from "./motion-evidence";
import {
  buildInspiredesignPinterestPinMediaIndexEntry,
  persistInspiredesignPinterestPinMediaEvidence,
  redactDiagnosticPinterestPinMediaEvidence,
  type InspiredesignPersistedPinterestPinMediaEvidence,
  type InspiredesignPinterestPinMediaIndexEntry,
  type InspiredesignPinterestPinMediaRuntimeMetadata
} from "./pinterest-pin-media-evidence";
import {
  INSPIREDESIGN_MEDIA_ANALYSIS_ARTIFACT_FILE,
  INSPIREDESIGN_MEDIA_ANALYSIS_DETERMINISTIC_GENERATED_AT,
  INSPIREDESIGN_MEDIA_ANALYSIS_NON_GOALS,
  INSPIREDESIGN_MEDIA_ANALYSIS_VERSION,
  type InspiredesignMediaAnalysis,
  type InspiredesignMediaAnalysisReference,
  type InspiredesignMediaKind
} from "./media-analysis";
import type { JsonValue } from "../providers/types";

type JsonRecord = Record<string, JsonValue>;
type FetchStatus = "captured" | "failed" | "skipped";
type CaptureStatus = "off" | "captured" | "failed";

export type InspiredesignCaptureAttemptStatus = "captured" | "failed" | "skipped";

export type InspiredesignCaptureAttemptEvidence = {
  status: InspiredesignCaptureAttemptStatus;
  detail?: string;
};

export const INSPIREDESIGN_CAPTURE_ATTEMPT_KEYS = ["snapshot", "clone", "dom"] as const;

export type InspiredesignCaptureAttemptKey = typeof INSPIREDESIGN_CAPTURE_ATTEMPT_KEYS[number];

export type InspiredesignCaptureAttempts = {
  snapshot: InspiredesignCaptureAttemptEvidence;
  clone: InspiredesignCaptureAttemptEvidence;
  dom: InspiredesignCaptureAttemptEvidence;
};

type DesignContractTemplate = {
  intent: JsonRecord;
  designLanguage: JsonRecord;
  contentModel: JsonRecord;
  navigationModel: JsonRecord;
  asyncModel: JsonRecord;
  layoutSystem: JsonRecord;
  typographySystem: JsonRecord;
  motionSystem: JsonRecord;
  performanceModel: JsonRecord;
  responsiveSystem: JsonRecord;
  accessibilityPolicy: JsonRecord;
};

type CanvasPlanRequestTemplate = {
  requestId: string;
  canvasSessionId: string;
  leaseId: string;
  documentId: string;
  generationPlan: CanvasGenerationPlan & {
    designVectors?: JsonRecord;
  };
};

type InspiredesignSemanticColorTokens = {
  primary: string;
  accent: string;
  accentSurface: string;
  background: string;
  surface: string;
  border: string;
  text: string;
  mutedText: string;
  success: string;
  warning: string;
  danger: string;
};

export type InspiredesignColorModeTokens = {
  light: InspiredesignSemanticColorTokens;
  dark: InspiredesignSemanticColorTokens;
};

type ProfileConfig = {
  direction: string;
  visualPersonality: string;
  brandTone: string;
  hierarchyPrinciples: string[];
  interactionPhilosophy: string;
  navigationModel: CanvasNavigationModel;
  layoutApproach: string;
  pagePatterns: string[];
  componentSequence: string[];
  colors: InspiredesignSemanticColorTokens;
};

export type InspiredesignCaptureEvidence = {
  title?: string;
  snapshot?: {
    content: string;
    refCount: number;
    warnings: string[];
  };
  dom?: {
    outerHTML: string;
    truncated: boolean;
  };
  clone?: {
    componentPreview: string;
    cssPreview: string;
    warnings: string[];
  };
  visual?: InspiredesignVisualEvidenceRuntimeMetadata | InspiredesignPersistedVisualEvidence;
  motion?: InspiredesignMotionEvidenceRuntimeMetadata | InspiredesignPersistedMotionEvidence;
  pinMedia?: InspiredesignPinterestPinMediaRuntimeMetadata | InspiredesignPersistedPinterestPinMediaEvidence;
  attempts?: InspiredesignCaptureAttempts;
};

type CaptureAttemptSummaryReport = {
  worked: string[];
  didNotWork: string[];
};

const MALFORMED_CAPTURE_ATTEMPT_DETAIL = "Capture attempt metadata missing or malformed.";
const NORMALIZED_CAPTURE_ATTEMPT_DETAIL = "Captured artifact was empty after normalization.";

const isJsonRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const isInspiredesignCaptureAttemptStatus = (
  value: unknown
): value is InspiredesignCaptureAttemptStatus => {
  return value === "captured" || value === "failed" || value === "skipped";
};

const hasUsableCaptureText = (value: string | undefined): boolean => {
  return typeof value === "string" && value.trim().length > 0;
};

const hasUsableInspiredesignSnapshot = (
  capture: InspiredesignCaptureEvidence | null | undefined
): boolean => {
  return hasUsableCaptureText(capture?.snapshot?.content);
};

const hasUsableInspiredesignDom = (
  capture: InspiredesignCaptureEvidence | null | undefined
): boolean => {
  return hasUsableCaptureText(capture?.dom?.outerHTML);
};

const hasUsableInspiredesignClone = (
  capture: InspiredesignCaptureEvidence | null | undefined
): boolean => {
  return hasUsableCaptureText(capture?.clone?.componentPreview)
    || hasUsableCaptureText(capture?.clone?.cssPreview);
};

const hasUsableInspiredesignCaptureArtifact = (
  capture: InspiredesignCaptureEvidence,
  key: InspiredesignCaptureAttemptKey
): boolean => {
  switch (key) {
    case "snapshot":
      return hasUsableInspiredesignSnapshot(capture);
    case "clone":
      return hasUsableInspiredesignClone(capture);
    case "dom":
      return hasUsableInspiredesignDom(capture);
  }
};

const reconcileInspiredesignCaptureAttemptEvidence = (
  attempt: InspiredesignCaptureAttemptEvidence,
  artifactPresent: boolean
): InspiredesignCaptureAttemptEvidence => {
  if (attempt.status !== "captured" || artifactPresent) {
    return attempt;
  }
  return {
    status: "failed",
    detail: NORMALIZED_CAPTURE_ATTEMPT_DETAIL
  };
};

const reconcileInspiredesignCaptureAttempts = (
  capture: InspiredesignCaptureEvidence,
  attempts: InspiredesignCaptureAttempts | undefined
): InspiredesignCaptureAttempts | undefined => {
  if (!attempts) {
    return undefined;
  }
  return {
    snapshot: reconcileInspiredesignCaptureAttemptEvidence(
      attempts.snapshot,
      hasUsableInspiredesignCaptureArtifact(capture, "snapshot")
    ),
    clone: reconcileInspiredesignCaptureAttemptEvidence(
      attempts.clone,
      hasUsableInspiredesignCaptureArtifact(capture, "clone")
    ),
    dom: reconcileInspiredesignCaptureAttemptEvidence(
      attempts.dom,
      hasUsableInspiredesignCaptureArtifact(capture, "dom")
    )
  };
};

export const hasInspiredesignCaptureArtifacts = (
  capture: InspiredesignCaptureEvidence | null | undefined
): capture is InspiredesignCaptureEvidence => {
  return hasUsableInspiredesignSnapshot(capture)
    || hasUsableInspiredesignDom(capture)
    || hasUsableInspiredesignClone(capture);
};

export const normalizeInspiredesignCaptureAttemptEvidence = (
  value: unknown,
  fallbackDetail = MALFORMED_CAPTURE_ATTEMPT_DETAIL
): InspiredesignCaptureAttemptEvidence => {
  if (!isJsonRecord(value) || !isInspiredesignCaptureAttemptStatus(value.status)) {
    return {
      status: "skipped",
      detail: fallbackDetail
    };
  }
  return {
    status: value.status,
    ...(typeof value.detail === "string" && value.detail.trim().length > 0
      ? { detail: value.detail.trim() }
      : {})
  };
};

export const normalizeInspiredesignCaptureAttempts = (
  value: unknown
): InspiredesignCaptureAttempts | undefined => {
  if (!isJsonRecord(value)) {
    return undefined;
  }
  return {
    snapshot: normalizeInspiredesignCaptureAttemptEvidence(value.snapshot),
    clone: normalizeInspiredesignCaptureAttemptEvidence(value.clone),
    dom: normalizeInspiredesignCaptureAttemptEvidence(value.dom)
  };
};

export const normalizeInspiredesignCaptureEvidence = (
  capture: InspiredesignCaptureEvidence | null | undefined
): InspiredesignCaptureEvidence | null | undefined => {
  if (!capture) {
    return capture;
  }
  const normalizedBase: InspiredesignCaptureEvidence = {
    ...(capture.title ? { title: capture.title } : {}),
    ...(hasUsableInspiredesignSnapshot(capture) && capture.snapshot ? { snapshot: capture.snapshot } : {}),
    ...(hasUsableInspiredesignDom(capture) && capture.dom ? { dom: capture.dom } : {}),
    ...(hasUsableInspiredesignClone(capture) && capture.clone ? { clone: capture.clone } : {}),
    ...(capture.visual ? { visual: persistInspiredesignVisualEvidence(capture.visual) } : {}),
    ...(capture.motion ? { motion: persistInspiredesignMotionEvidence(capture.motion) } : {}),
    ...(capture.pinMedia ? { pinMedia: persistInspiredesignPinterestPinMediaEvidence(capture.pinMedia) } : {})
  };
  const attempts = reconcileInspiredesignCaptureAttempts(
    normalizedBase,
    normalizeInspiredesignCaptureAttempts(capture.attempts)
  );
  return {
    ...normalizedBase,
    ...(attempts ? { attempts } : {})
  };
};

export const formatInspiredesignCaptureAttemptSummary = (
  report: CaptureAttemptSummaryReport
): string => {
  const worked = report.worked.length > 0 ? report.worked.join(", ") : "none";
  const didNotWork = report.didNotWork.length > 0 ? report.didNotWork.join(", ") : "none";
  return `worked=${worked}; did_not_work=${didNotWork}`;
};

export type InspiredesignReferenceEvidence = {
  id: string;
  url: string;
  title?: string;
  excerpt?: string;
  fetchStatus: FetchStatus;
  captureStatus: CaptureStatus;
  fetchFailure?: string;
  captureFailure?: string;
  capture?: InspiredesignCaptureEvidence | null;
};

export type InspiredesignTokenStrategy = {
  colors: InspiredesignColorModeTokens;
  typography: Record<string, string>;
  spacing: Record<string, string>;
  radius: Record<string, string>;
  shadow: Record<string, string>;
  motion: Record<string, string>;
  zIndex: Record<string, number>;
  breakpoints: Record<string, string>;
};

export type InspiredesignImplementationPlan = {
  architectureRecommendation: string;
  tokenStrategy: InspiredesignTokenStrategy;
  referenceImplementationNotes: string[];
  componentBuildPlan: Array<{
    name: string;
    purpose: string;
    states: string[];
    implementationNote: string;
  }>;
  pageAssemblyPlan: string[];
  stateAndInteractionPlan: string[];
  accessibilityChecklist: string[];
  responsiveChecklist: string[];
  risksAndAmbiguities: string[];
  buildSequence: string[];
};

type InspiredesignGenerationPlan = CanvasGenerationPlan & {
  referencePatternBoard: InspiredesignReferencePatternBoard;
  designVectors: InspiredesignDesignVectors;
  targetAnalysis: InspiredesignTargetAnalysis;
  interactionMoments: string[];
  materialEffects: string[];
};

export type InspiredesignVisualEvidenceJson = {
  referenceId: string;
  url: string;
  visual: InspiredesignPersistedVisualEvidence;
};

export type InspiredesignScreenshotIndexEntry = {
  referenceId: string;
  url: string;
  sourceUrl?: string;
  pinterestPageQuality?: InspiredesignPersistedVisualEvidence["pinterestPageQuality"];
  path: string;
  sha256: string;
  bytes: number;
  kind: InspiredesignPersistedVisualEvidence["kind"];
  fullPage: boolean;
  capturedAt: string;
  warnings: string[];
  failure?: string;
};

export type InspiredesignMotionEvidenceJson = {
  referenceId: string;
  url: string;
  motion: InspiredesignPersistedMotionEvidence;
};

export type InspiredesignPinMediaEvidenceJson = {
  referenceId: string;
  url: string;
  pinMedia: InspiredesignPersistedPinterestPinMediaEvidence;
};

export type InspiredesignPacket = {
  advancedBriefMarkdown: string;
  designContract: CanvasDesignGovernance;
  generationPlan: InspiredesignGenerationPlan;
  canvasPlanRequest: CanvasPlanRequestTemplate;
  followthrough: InspiredesignFollowthrough;
  designMarkdown: string;
  implementationPlan: InspiredesignImplementationPlan;
  implementationPlanMarkdown: string;
  prototypeGuidanceMarkdown: string | null;
  evidence: JsonRecord;
  visualEvidence: InspiredesignVisualEvidenceJson[];
  screenshotIndex: InspiredesignScreenshotIndexEntry[];
  motionEvidence: InspiredesignMotionEvidenceJson[];
  pinMediaEvidence: InspiredesignPinMediaEvidenceJson[];
  pinMediaIndex: InspiredesignPinterestPinMediaIndexEntry[];
  mediaAnalysis: InspiredesignMediaAnalysis;
  rankedReferences: InspiredesignReferencePatternBoard["references"];
  referencePatternBoard: InspiredesignReferencePatternBoard;
  metaPromptMarkdown: string;
};

export type InspiredesignContractScope = {
  emittedContract: "CanvasDesignGovernance";
  emittedGovernanceBlocks: string[];
  omittedTemplateBlocks: Array<"navigationModel" | "asyncModel" | "performanceModel">;
  note: string;
};

export type InspiredesignImplementationContext = {
  navigationModel: JsonRecord;
  asyncModel: JsonRecord;
  performanceModel: JsonRecord;
  tokenStrategy: InspiredesignTokenStrategy;
  implementationPlan: InspiredesignImplementationPlan;
  referenceSynthesis: JsonRecord;
  referencePatternBoard: InspiredesignReferencePatternBoard;
  designVectors: InspiredesignDesignVectors;
  targetAnalysis: InspiredesignTargetAnalysis;
};

type InspiredesignTargetKind = "page" | "component" | "asset";

type InspiredesignEvidenceBuckets = {
  anatomy: string[];
  propsSlots: string[];
  stateMatrix: string[];
  tokens: string[];
  assets: string[];
  accessibility: string[];
  motion: string[];
  previewFixtures: string[];
};

type InspiredesignComponentInventoryEvidence = Pick<
  CanvasComponentInventoryItem,
  "id" | "name" | "componentName" | "description" | "sourceFamily" | "origin"
> & {
  variants: CanvasComponentInventoryItem["variants"];
  props: CanvasComponentInventoryItem["props"];
  slots: CanvasComponentInventoryItem["slots"];
  events: CanvasComponentInventoryItem["events"];
  content: CanvasComponentInventoryItem["content"];
  metadata: JsonRecord;
};

type InspiredesignAssetEvidence = Pick<
  CanvasAsset,
  "id" | "sourceType" | "kind" | "url" | "status"
> & {
  provenanceNotes: string[];
  usageNotes: string[];
  metadata: JsonRecord;
};

type InspiredesignTargetAnalysis = {
  primaryKind: InspiredesignTargetKind;
  kinds: InspiredesignTargetKind[];
  confidence: number;
  triggeringSignals: string[];
  evidenceBuckets: InspiredesignEvidenceBuckets;
  page?: {
    canvasType: "CanvasPage";
    assemblyFocus: string[];
    implementationNotes: string[];
  };
  component?: {
    canvasType: "CanvasComponentInventoryItem";
    inventoryItems: InspiredesignComponentInventoryEvidence[];
    prototypeGuidance: string[];
  };
  asset?: {
    canvasType: "CanvasAsset";
    assets: InspiredesignAssetEvidence[];
    prototypeGuidance: string[];
  };
};

export type InspiredesignFollowthrough = {
  summary: string;
  nextStep: string;
  nextStepGuidance?: Record<string, JsonValue>;
  artifactGuide: InspiredesignArtifactGuide;
  contractSectionGuide: InspiredesignContractSectionGuide;
  briefExpansion: {
    templateVersion: string;
    file: string;
    format: InspiredesignBriefFormat;
  };
  recommendedSkills: string[];
  commandExamples: {
    loadBestPractices: string;
    loadDesignAgent: string;
    loadMotionDesign: string;
    continueInCanvas: string;
  };
  deepCaptureRecommendation: string;
  contractScope: InspiredesignContractScope;
  implementationContext: InspiredesignImplementationContext;
};

export type BuildInspiredesignPacketInput = {
  brief: string;
  briefExpansion: InspiredesignBriefExpansion;
  urls: string[];
  references: InspiredesignReferenceEvidence[];
  mediaAnalysis?: InspiredesignMediaAnalysis;
  includePrototypeGuidance?: boolean;
  referenceEvidenceRequired?: boolean;
};

const buildEmptyInspiredesignMediaAnalysis = (): InspiredesignMediaAnalysis => ({
  version: INSPIREDESIGN_MEDIA_ANALYSIS_VERSION,
  generatedAt: INSPIREDESIGN_MEDIA_ANALYSIS_DETERMINISTIC_GENERATED_AT,
  nonGoals: [...INSPIREDESIGN_MEDIA_ANALYSIS_NON_GOALS],
  references: []
});

const BASE_CONTRACT_TEMPLATE: DesignContractTemplate = designContractTemplateJson;
const BASE_PLAN_REQUEST_TEMPLATE = generationPlanTemplateJson as Omit<CanvasPlanRequestTemplate, "generationPlan"> & {
  generationPlan: CanvasGenerationPlan;
};
const BASE_GENERATION_PLAN: CanvasGenerationPlan = BASE_PLAN_REQUEST_TEMPLATE.generationPlan;

const PROFILE_CONFIG: Record<CanvasVisualDirectionProfile, ProfileConfig> = {
  "clean-room": {
    direction: "clean-room execution",
    visualPersonality: "disciplined, quiet, system-first",
    brandTone: "neutral and exacting",
    hierarchyPrinciples: ["Keep one message per section.", "Use spacing, not ornament, to separate priority."],
    interactionPhilosophy: "Minimal motion, zero ambiguity, strong focus affordances.",
    navigationModel: "contextual",
    layoutApproach: "modular-grid",
    pagePatterns: ["Single-message hero", "Dense decision panel", "Clean spec sheet"],
    componentSequence: ["Buttons", "Inputs", "Decision cards", "Structured tables"],
    colors: {
      primary: "#0F172A",
      accent: "#0F766E",
      accentSurface: "#E6FFFB",
      background: "#F8FAFC",
      surface: "#FFFFFF",
      border: "#CBD5E1",
      text: "#0F172A",
      mutedText: "#475569",
      success: "#15803D",
      warning: "#B45309",
      danger: "#B91C1C"
    }
  },
  "cinematic-minimal": {
    direction: "cinematic restraint",
    visualPersonality: "dramatic, sparse, image-led",
    brandTone: "premium and deliberate",
    hierarchyPrinciples: ["Let the visual plane carry atmosphere.", "Keep copy short and decisive."],
    interactionPhilosophy: "Use motion for presence, not explanation.",
    navigationModel: "immersive",
    layoutApproach: "full-bleed-hero",
    pagePatterns: ["Full-bleed hero", "Editorial feature strip", "High-contrast CTA block"],
    componentSequence: ["Hero shell", "CTA buttons", "Image-led sections", "Minimal footer"],
    colors: {
      primary: "#111827",
      accent: "#C2410C",
      accentSurface: "#FFF7ED",
      background: "#F8F5F0",
      surface: "#FFFFFF",
      border: "#D6D3D1",
      text: "#111827",
      mutedText: "#57534E",
      success: "#15803D",
      warning: "#B45309",
      danger: "#B91C1C"
    }
  },
  "product-story": {
    direction: "product-led clarity",
    visualPersonality: "confident, editorial, product-first",
    brandTone: "clear and ambitious",
    hierarchyPrinciples: ["Lead with value before proof.", "Keep action close to the message it completes."],
    interactionPhilosophy: "Short, decisive motion with obvious focus states.",
    navigationModel: "global-header",
    layoutApproach: "hero-led-grid",
    pagePatterns: ["Hero with anchored CTA", "Feature narrative strip", "Proof and conversion band"],
    componentSequence: ["Hero", "Buttons", "Cards", "Feature sections", "Footer"],
    colors: {
      primary: "#0B6BFF",
      accent: "#F97316",
      accentSurface: "#FFF7ED",
      background: "#F5F7FB",
      surface: "#FFFFFF",
      border: "#D7E3F4",
      text: "#111827",
      mutedText: "#475569",
      success: "#15803D",
      warning: "#B45309",
      danger: "#B91C1C"
    }
  },
  "commerce-system": {
    direction: "trust-driven commerce",
    visualPersonality: "decisive, reassuring, conversion-aware",
    brandTone: "credible and practical",
    hierarchyPrinciples: ["Keep purchasing signals scannable.", "Surface trust proof before commitment moments."],
    interactionPhilosophy: "Fast feedback, strong affordances, no ambiguous states.",
    navigationModel: "global-header",
    layoutApproach: "commerce-grid",
    pagePatterns: ["Merchandising hero", "Offer comparison band", "Decision-support detail section"],
    componentSequence: ["Hero", "Offer cards", "Buttons", "Trust badges", "Comparison table"],
    colors: {
      primary: "#0F766E",
      accent: "#D97706",
      accentSurface: "#FFFBEB",
      background: "#F8FAFC",
      surface: "#FFFFFF",
      border: "#D1D5DB",
      text: "#111827",
      mutedText: "#4B5563",
      success: "#15803D",
      warning: "#B45309",
      danger: "#B91C1C"
    }
  },
  "control-room": {
    direction: "high-signal control room",
    visualPersonality: "dense, sharp, operational",
    brandTone: "authoritative and fast",
    hierarchyPrinciples: ["Use structure to reduce scanning cost.", "Separate primary metrics from diagnostics."],
    interactionPhilosophy: "Fast updates, explicit states, motion only when it clarifies change.",
    navigationModel: "sidebar",
    layoutApproach: "panel-grid",
    pagePatterns: ["Metric summary rail", "Split-pane workspace", "Diagnostic detail panel"],
    componentSequence: ["Sidebar", "Stat blocks", "Tables", "Filters", "Panels"],
    colors: {
      primary: "#155EEF",
      accent: "#0F766E",
      accentSurface: "#ECFDF3",
      background: "#F8FAFC",
      surface: "#FFFFFF",
      border: "#CBD5E1",
      text: "#0F172A",
      mutedText: "#475569",
      success: "#15803D",
      warning: "#B45309",
      danger: "#B91C1C"
    }
  },
  "ops-control": {
    direction: "operational precision",
    visualPersonality: "structured, dense, high-confidence",
    brandTone: "decisive and exact",
    hierarchyPrinciples: ["Pin the primary metric and action path.", "Separate overview from detail panes."],
    interactionPhilosophy: "Low-latency controls, strong state contrast, keyboard-friendly flows.",
    navigationModel: "sidebar",
    layoutApproach: "workspace-shell",
    pagePatterns: ["KPI overview bar", "Filterable data shell", "Detail drawer or inspector"],
    componentSequence: ["Sidebar", "Toolbar", "Data table", "Filters", "Detail panel"],
    colors: {
      primary: "#155EEF",
      accent: "#0891B2",
      accentSurface: "#ECFEFF",
      background: "#F8FAFC",
      surface: "#FFFFFF",
      border: "#CBD5E1",
      text: "#0F172A",
      mutedText: "#475569",
      success: "#15803D",
      warning: "#B45309",
      danger: "#B91C1C"
    }
  },
  "auth-focused": {
    direction: "trust-forward entry flow",
    visualPersonality: "calm, direct, reassuring",
    brandTone: "safe and premium",
    hierarchyPrinciples: ["One job per screen.", "Trust and recovery paths must be visible without clutter."],
    interactionPhilosophy: "Low-friction focus flow with immediate validation feedback.",
    navigationModel: "contextual",
    layoutApproach: "two-panel-auth",
    pagePatterns: ["Auth split layout", "Trust panel", "Recovery and help strip"],
    componentSequence: ["Auth form", "Inputs", "Buttons", "Alerts", "Trust panel"],
    colors: {
      primary: "#1D4ED8",
      accent: "#0F766E",
      accentSurface: "#ECFDF5",
      background: "#F8FAFC",
      surface: "#FFFFFF",
      border: "#D1D5DB",
      text: "#111827",
      mutedText: "#4B5563",
      success: "#15803D",
      warning: "#B45309",
      danger: "#B91C1C"
    }
  },
  "settings-system": {
    direction: "calm settings system",
    visualPersonality: "ordered, practical, quietly premium",
    brandTone: "confident and low-friction",
    hierarchyPrinciples: ["Group related decisions tightly.", "Keep destructive actions isolated and explicit."],
    interactionPhilosophy: "Prefer clear toggles and inline explanations over hidden complexity.",
    navigationModel: "tabbed",
    layoutApproach: "settings-grid",
    pagePatterns: ["Sectioned settings page", "Inline form groups", "Preference summary rail"],
    componentSequence: ["Tabs", "Forms", "Inputs", "Alerts", "Confirmation modal"],
    colors: {
      primary: "#1D4ED8",
      accent: "#0F766E",
      accentSurface: "#ECFDF5",
      background: "#F8FAFC",
      surface: "#FFFFFF",
      border: "#D1D5DB",
      text: "#111827",
      mutedText: "#475569",
      success: "#15803D",
      warning: "#B45309",
      danger: "#B91C1C"
    }
  },
  "documentation": {
    direction: "text-light knowledge story",
    visualPersonality: "legible, calm, visually led",
    brandTone: "expert, concise, and accessible",
    hierarchyPrinciples: ["Make scanning effortless.", "Use visual proof before long explanatory text."],
    interactionPhilosophy: "Light motion, clear wayfinding, strong anchor visibility.",
    navigationModel: "sidebar",
    layoutApproach: "knowledge-story-shell",
    pagePatterns: ["Insight overview", "Visual proof band", "Action path"],
    componentSequence: ["Navigation", "Search", "Anchored headings", "Proof bands", "Callouts"],
    colors: {
      primary: "#1D4ED8",
      accent: "#0F766E",
      accentSurface: "#ECFDF5",
      background: "#F8FAFC",
      surface: "#FFFFFF",
      border: "#CBD5E1",
      text: "#0F172A",
      mutedText: "#475569",
      success: "#15803D",
      warning: "#B45309",
      danger: "#B91C1C"
    }
  }
};

const trimText = (value: string): string => {
  return value.trim().replace(/\s+/g, " ");
};

const clipText = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
};

type InspiredesignReferenceSynthesis = {
  lines: string[];
  summary: string;
};

const REFERENCE_SUMMARY_CLIP_LENGTH = 220;
const GENERATION_PLAN_REFERENCE_CLIP_LENGTH = 600;

const buildReferenceSynthesis = (
  references: InspiredesignReferenceEvidence[],
  pinMediaIndex?: readonly InspiredesignPinterestPinMediaIndexEntry[]
): InspiredesignReferenceSynthesis => {
  const lines = references
    .filter((reference) => hasInspiredesignUsableReferenceEvidence(reference, pinMediaIndex))
    .map((reference, index) => {
      const signals = getInspiredesignReferenceSignals(reference);
      if (signals.length === 0) return "";
      const title = reference.title?.trim();
      const signalLabel = signals.find((signal) => !isGenericSourceTitle(signal));
      const label = title && !isGenericSourceTitle(title) ? title : signalLabel ?? reference.url;
      return `Source ${index + 1} ${label}: ${signals.join(" | ")}`;
    })
    .filter((line) => line.length > 0);
  return {
    lines,
    summary: lines.length > 0
      ? lines.map((line) => clipText(line, REFERENCE_SUMMARY_CLIP_LENGTH)).join(" ")
      : "No live reference cues were captured."
  };
};

const renderReferenceFirstAdvancedBrief = (
  briefExpansion: InspiredesignBriefExpansion,
  board: InspiredesignReferencePatternBoard,
  vectors: InspiredesignDesignVectors,
  references: InspiredesignReferenceEvidence[]
): string => {
  if (board.references.length === 0 || vectors.sourcePriority !== "reference-evidence-first") {
    if (references.length > 0) {
      return [
        "Reference evidence unavailable:",
        "URL references were attempted, but no ready-quality creative evidence was captured. Treat this as a capture or intent gap, not a design direction.",
        "",
        formatBulletList([
          `${references.length} attempted reference(s) are retained in diagnostic artifacts only.`,
          "Do not use rejected or not-ready reference URLs, names, screenshots, or metadata as creative direction."
        ]),
        "",
        briefExpansion.advancedBrief
      ].join("\n");
    }
    return briefExpansion.advancedBrief;
  }
  return [
    "Reference pattern board:",
    "URL reference evidence is the creative source of truth when references are supplied.",
    "",
    "Reference evidence analysis:",
    formatBulletList(board.references.map((reference) => (
      `${reference.name}: ${reference.layoutRecipe}`
    ))),
    "",
    "Design vectors:",
    formatBulletList([
      `directionLabel: ${vectors.directionLabel}`,
      `surfaceIntent: ${vectors.surfaceIntent}`,
      `premiumPosture: ${vectors.premiumPosture.join(" ")}`,
      `motionPosture: ${vectors.motionPosture.join(" ")}`,
      `sectionArchitecture: ${vectors.sectionArchitecture.join(" ")}`,
      `interactionMoments: ${vectors.interactionMoments.join(" ")}`,
      `materialEffects: ${vectors.materialEffects.join(" ")}`,
      `advancedMotionAdvisory: ${vectors.advancedMotionAdvisory.join(" ")}`
    ]),
    "",
    "Fixed format guardrails:",
    "Selected prompt format supplies route defaults and guardrails, not the creative source of truth.",
    "",
    briefExpansion.advancedBrief
  ].join("\n");
};

const renderEvidenceDerivedAdvancedBrief = (
  briefExpansion: InspiredesignBriefExpansion,
  format: InspiredesignBriefFormat
): string => [
  `Selected prompt format: ${format.label}`,
  "",
  "Source brief:",
  briefExpansion.sourceBrief,
  "",
  "Prompt objective:",
  `Use the reference evidence and source brief to define a ${format.archetype}.`,
  "",
  "Business focus:",
  formatBulletList(format.businessFocus),
  "",
  "Keywords:",
  formatBulletList(format.keywords),
  "",
  "Route defaults:",
  formatBulletList([
    `profile: ${format.route.profile}`,
    `theme strategy: ${format.route.themeStrategy}`,
    `navigation model: ${format.route.navigationModel}`,
    `layout approach: ${format.route.layoutApproach}`
  ]),
  "",
  "Design direction:",
  formatBulletList([
    `archetype: ${format.archetype}`,
    `layout archetype: ${format.layoutArchetype}`,
    `typography system: ${format.typographySystem}`,
    `surface treatment: ${format.surfaceTreatment}`,
    `shape language: ${format.shapeLanguage}`,
    `component grammar: ${format.componentGrammar}`,
    `motion grammar: ${format.motionGrammar}`,
    `palette intent: ${format.paletteIntent}`,
    `visual density: ${format.visualDensity}`,
    `design variance: ${format.designVariance}`
  ]),
  "",
  "Responsive collapse rules:",
  formatBulletList(format.responsiveCollapseRules),
  "",
  "Focus areas:",
  formatBulletList(format.focusAreas ?? []),
  "",
  "Execution rules:",
  formatBulletList([...INSPIREDESIGN_BRIEF_COMMON_RULES, ...format.guardrails]),
  "",
  "Anti-patterns:",
  formatBulletList(format.antiPatterns),
  "",
  "Return:",
  formatBulletList([...INSPIREDESIGN_BRIEF_OUTPUT_REQUIREMENTS, ...format.deliverables]),
  "",
  "Best fit use cases:",
  formatBulletList(format.bestFor)
].join("\n");

const cloneTemplate = <T>(value: T): T => structuredClone(value);

const referenceFingerprint = (value: string): string => {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
};

const summarizeBrief = (brief: string): string => {
	const normalized = trimText(brief);
	const sentence = normalized.split(/[.!?]/).map((part) => part.trim()).find(Boolean);
	return clipText(sentence ?? normalized, 140);
};

const resolveIntentAudience = (brief: string, format: InspiredesignBriefFormat): string => {
	const normalizedBrief = brief.toLowerCase();
	if (/\b(?:photography|photographer|portrait|photo studio|studio photography|digital photography|cinematic gallery)\b/.test(normalizedBrief)) {
		return "prospective photography studio clients and booking leads";
	}
	if (/\b(?:landing page|website|site|portfolio|booking|public)\b/.test(normalizedBrief)) {
		const focus = format.businessFocus[0] ?? "brand";
		return `prospective ${focus} customers and conversion-focused visitors`;
	}
	if (/\b(?:docs|documentation|developer|api)\b/.test(normalizedBrief)) {
		return "developers, evaluators, and implementation stakeholders";
	}
	return "prospective customers and decision makers";
};

const buildSupportingMessages = (references: InspiredesignReferenceEvidence[]): string[] => {
	const messages = references
		.map((reference) => getInspiredesignReferenceSignals(reference)[0])
		.filter((value): value is string => typeof value === "string")
		.map((value) => clipText(trimText(value), 72))
		.filter((value) => value.length > 0);
	return messages.slice(0, 3);
};

const summarizeDesignVectors = (designVectors: InspiredesignDesignVectors): string => [
  `direction: ${designVectors.directionLabel}`,
  `sections: ${designVectors.sectionArchitecture.join(" ")}`,
  `motion: ${designVectors.motionPosture.slice(0, 1).join(" ")}`,
  `interactions: ${designVectors.interactionMoments.slice(0, 1).join(" ")}`,
  `materials: ${designVectors.materialEffects.slice(0, 1).join(" ")}`,
  `advancedMotion: ${designVectors.advancedMotionAdvisory.slice(0, 1).join(" ")}`
].join(" ");

const MEDIA_DERIVED_SUMMARY_MARKERS = [
  "Media-analysis",
  "Media-derived",
  "Quantized",
  "OCR-free",
  "sampled",
  "percent dark coverage",
  "Static source only",
  "Layout heuristic",
  "Readable exact text"
] as const;

const MEDIA_DERIVED_SUMMARY_LIMIT = 5;
const CANVAS_FORBIDDEN_GENERATION_PLAN_KEYS = new Set([
  "mediaAnalysis",
  "mediaAnalysisSource",
  "mediaArtifactPath",
  "mediaPath",
  "mediaUrl",
  "sourceUrl",
  "url",
  "hash",
  "sha256",
  "bboxNorm",
  "boxes",
  "frames",
  "facts",
  "claimLevels",
  "limitations"
]);
const CANVAS_PIN_MEDIA_ARTIFACT_PATH_PATTERN =
  /pin-media-evidence\/[A-Za-z0-9._-]+\/(?:main|poster|video)\.(?:avif|gif|jpe?g|mp4|png|webp)/gi;
const CANVAS_PINTEREST_MEDIA_URL_PATTERN =
  /https:\/\/(?:www\.pinterest\.com\/pin\/\d+\/?|i\.pinimg\.com|v\d*(?:-[a-z]+)?\.pinimg\.com)[^\s"'<>)]*/gi;
const CANVAS_PINTEREST_HOST_PATTERN =
  /\b(?:[a-z0-9-]+\.)*pinterest\.com\/[^\s"'<>)}\]]*|\bpin\.it\/[^\s"'<>)}\]]*|\b(?:i|v\d*(?:-[a-z]+)?)\.pinimg\.com\/[^\s"'<>)}\]]*/gi;
const CANVAS_SOURCE_URL_PATTERN = /\b(?:https?:)?\/\/[^\s"'<>)}\]]*/gi;
const CANVAS_BARE_SOURCE_HOST_PATTERN =
  /(?<![@\w.-])(?:www\.)?(?:[a-z0-9-]+\.)+(?:design|studio|com|app|art|dev|net|org|ai|io|it|uk|co)(?:\/[^\s"'<>)}\]]*)?(?=$|[\s"'<>)}\],.;:!?])/gi;
const CANVAS_SHA256_PATTERN = /\b[a-f0-9]{64}\b/gi;
const MEASURED_MEDIA_ANALYSIS_CLAIM_LEVELS: ReadonlySet<InspiredesignMediaAnalysisReference["claimLevels"][number]> = new Set([
  "pixel_stats",
  "palette_quantized",
  "layout_heuristic",
  "typography_structure",
  "text_region_layout",
  "motion_sampled"
]);

const CANVAS_MEDIA_ANALYSIS_TEXT_PATTERNS = [
  /claim\s*levels?/i,
  /claimLevels/i,
  /\bmetadata_only\b/i,
  /\bpixel_stats\b/i,
  /\bpalette_quantized\b/i,
  /\blayout_heuristic\b/i,
  /\btypography_structure\b/i,
  /\btext_region_layout\b/i,
  /\bmotion_sampled\b/i,
  /media-derived/i,
  /media analysis/i,
  /quantized/i,
  /ocr-free/i,
  /sampled/i,
  /percent/i,
  /static source only/i,
  /layout heuristic/i,
  /readable exact text/i,
  /exact readable text/i,
  /mean luminance/i,
  /\bfacts?\b/i,
  /\blimitations?\b/i
] as const;
const CANVAS_TOKEN_NOTE_PATTERN = /(#[0-9a-f]{6})\s+as\s+([a-z][a-z ]*?)(?=\s+at\b|[.;,]|$)/i;

const isMediaDerivedSummary = (value: string): boolean => (
  MEDIA_DERIVED_SUMMARY_MARKERS.some((marker) => value.includes(marker))
);

const hasCanvasMediaAnalysisText = (value: string): boolean => (
  CANVAS_MEDIA_ANALYSIS_TEXT_PATTERNS.some((pattern) => pattern.test(value))
);

const summarizeCanvasTokenNote = (value: string): string | null => {
  const match = value.match(CANVAS_TOKEN_NOTE_PATTERN);
  const hex = match?.[1];
  const role = match?.[2]?.trim().replace(/\s+/g, " ");
  if (!hex || !role) return null;
  return `Reference-derived token note: ${hex.toUpperCase()} as ${role}.`;
};

const describeCanvasCoverage = (value: string): string => {
  const coverage = Number.parseFloat(value);
  if (!Number.isFinite(coverage)) return "measured coverage";
  if (coverage >= 50) return "dominant coverage";
  if (coverage >= 20) return "supporting coverage";
  return "accent coverage";
};

const scrubCanvasMediaDerivedSummary = (value: string): string => (
  value
    .replace(/Media-derived facts from [^:]+:/gi, "Reference evidence cues:")
    .replace(/media-analysis\.json/gi, "reference evidence")
    .replace(/media-analysis/gi, "reference evidence")
    .replace(/media analysis/gi, "reference evidence")
    .replace(/media-derived/gi, "reference-derived")
    .replace(/\bQuantized palette led by\b/gi, "Palette led by")
    .replace(/\bLayout heuristic reads as\b/gi, "Layout reads as")
    .replace(/\bOCR-free typography structure detected\b/gi, "Typography structure detected")
    .replace(/\bOCR-free typography hierarchy\b/gi, "Typography hierarchy")
    .replace(/\bOCR-free text-region geometry\b/gi, "text-region geometry")
    .replace(/\bReadable exact text extraction was not performed, so exact copy strings are unavailable\./gi, "Avoid inferring exact copy strings from image evidence.")
    .replace(/\bExact readable text extraction was not performed\./gi, "Exact copy strings were not inferred.")
    .replace(/\bExact readable text was not extracted\./gi, "Exact copy strings were not inferred.")
    .replace(/\bexact readable text\b/gi, "exact text")
    .replace(/\breadable exact text\b/gi, "exact text")
    .replace(/\bStatic source only,\s*/gi, "Static source, ")
    .replace(/\bsampled from\s+\d+\s+frames?\s+at\s+([a-z-]+)\s+cadence\b/gi, "$1 cadence derived from saved video evidence")
    .replace(/\bSampled motion cadence is\s+([a-z-]+)\s+with average frame delta\s+[0-9.]+\.?/gi, "Motion cadence reads as $1.")
    .replace(/\b(\d+(?:\.\d+)?)\s+percent\s+dark\s+coverage\b/gi, (_match, coverage: string) => `dark ${describeCanvasCoverage(coverage)}`)
    .replace(/\b(\d+(?:\.\d+)?)\s+percent\s+bright\s+coverage\b/gi, (_match, coverage: string) => `bright ${describeCanvasCoverage(coverage)}`)
    .replace(/\b\d+(?:\.\d+)?\s+percent\s+low-activity canvas\b/gi, "low-activity canvas")
    .replace(/\s+at\s+\d+(?:\.\d+)?\s+percent\s+coverage\b/gi, "")
    .replace(/\bclaimLevels?\b/gi, "evidence basis")
    .replace(/\bmetadata_only\b/gi, "reference metadata")
    .replace(/\bpixel_stats\b/gi, "measured tone")
    .replace(/\bpalette_quantized\b/gi, "measured palette")
    .replace(/\blayout_heuristic\b/gi, "layout composition")
    .replace(/\btypography_structure\b/gi, "typography hierarchy")
    .replace(/\btext_region_layout\b/gi, "text-region layout")
    .replace(/\bmotion_sampled\b/gi, "motion cadence")
    .replace(/\bquantized\b/gi, "measured")
    .replace(/\bocr-free\b/gi, "measured")
    .replace(/\bsampled\b/gi, "derived")
    .replace(/\bmean luminance\s+[0-9.]+\b/gi, "measured luminance")
    .replace(/\bfacts?\b/gi, "cues")
    .replace(/\blimitations?\b/gi, "constraints")
    .replace(/\s{2,}/g, " ")
    .trim()
);

const scrubCanvasSummaryString = (value: string): string => {
  const scrubbed = value
    .replace(CANVAS_PIN_MEDIA_ARTIFACT_PATH_PATTERN, "saved Pinterest pin media artifact")
    .replace(CANVAS_PINTEREST_MEDIA_URL_PATTERN, "Pinterest media reference")
    .replace(CANVAS_SOURCE_URL_PATTERN, "source reference")
    .replace(CANVAS_PINTEREST_HOST_PATTERN, "Pinterest source reference")
    .replace(CANVAS_BARE_SOURCE_HOST_PATTERN, "source reference")
    .replace(CANVAS_SHA256_PATTERN, "media hash")
    .replace(/media-analysis\.json summaries when present/gi, "reference summaries when present")
    .replace(/media-analysis/gi, "reference guidance");
  const tokenNote = summarizeCanvasTokenNote(scrubbed);
  if (tokenNote) return tokenNote;
  if (!hasCanvasMediaAnalysisText(scrubbed)) return scrubbed;
  return scrubCanvasMediaDerivedSummary(scrubbed);
};

const scrubCanvasGenerationPlanValue = (value: JsonValue): JsonValue => {
  if (typeof value === "string") return scrubCanvasSummaryString(value);
  if (typeof value !== "object" || value === null) return value;
  if (Array.isArray(value)) return value.map((entry) => scrubCanvasGenerationPlanValue(entry));
  const record: JsonRecord = {};
  for (const [key, nested] of Object.entries(value)) {
    if (CANVAS_FORBIDDEN_GENERATION_PLAN_KEYS.has(key)) continue;
    record[key] = scrubCanvasGenerationPlanValue(nested);
  }
  return record;
};

const hasMeasuredMediaAnalysisDesignFacts = (
  reference: InspiredesignMediaAnalysisReference
): boolean => reference.claimLevels.some((claimLevel) => MEASURED_MEDIA_ANALYSIS_CLAIM_LEVELS.has(claimLevel));

const summarizeMediaDerivedDesignVectors = (designVectors: InspiredesignDesignVectors): string => {
  const summaries = [
    ...designVectors.premiumPosture,
    ...designVectors.compositionModel,
    ...designVectors.typographyPosture,
    ...designVectors.imageryPosture,
    ...designVectors.motionPosture,
    ...designVectors.interactionMoments,
    ...designVectors.materialEffects
  ].filter(isMediaDerivedSummary).slice(0, MEDIA_DERIVED_SUMMARY_LIMIT);
  if (summaries.length === 0) return "";
  return `Media-derived facts from ${INSPIREDESIGN_MEDIA_ANALYSIS_ARTIFACT_FILE}: ${summaries.join(" ")}`;
};

type InspiredesignMeasuredColorRoles = {
  background?: string;
  surface?: string;
  text?: string;
  mutedText?: string;
  accent?: string;
};

const TOKEN_NOTE_COLOR_ROLE_PATTERN = /(#[0-9a-f]{6})\s+as\s+([a-z][a-z ]*?)(?=\s+at\b|[.;,]|$)/i;

const normalizeMeasuredColorRole = (role: string): keyof InspiredesignMeasuredColorRoles | null => {
  const normalized = role.trim().toLowerCase().replace(/\s+/g, " ");
  if (normalized === "background") return "background";
  if (normalized === "surface") return "surface";
  if (normalized === "accent") return "accent";
  if (normalized === "foreground" || normalized === "text") return "text";
  if (normalized === "muted foreground" || normalized === "muted text") return "mutedText";
  return null;
};

const normalizeHexColor = (value: string): string => value.toUpperCase();

const extractMeasuredColorRoles = (
  designVectors: InspiredesignDesignVectors
): InspiredesignMeasuredColorRoles => {
  const roles: InspiredesignMeasuredColorRoles = {};
  for (const note of designVectors.materialEffects) {
    const match = note.match(TOKEN_NOTE_COLOR_ROLE_PATTERN);
    const hex = match?.[1];
    const rawRole = match?.[2];
    if (!hex || !rawRole) continue;
    const role = normalizeMeasuredColorRole(rawRole);
    if (role && !roles[role]) roles[role] = normalizeHexColor(hex);
  }
  return roles;
};

const hasMeasuredColorRoles = (roles: InspiredesignMeasuredColorRoles): boolean => (
  Boolean(roles.background || roles.surface || roles.text || roles.mutedText || roles.accent)
);

const hasMeasuredColorTokenEvidence = (designVectors: InspiredesignDesignVectors): boolean => (
  hasMeasuredColorRoles(extractMeasuredColorRoles(designVectors))
);

const HEX_COLOR_LENGTH = 7;
const HEX_RADIX = 16;
const COLOR_CHANNEL_MAX = 255;
const WCAG_LOW_CHANNEL_THRESHOLD = 0.03928;
const WCAG_LOW_CHANNEL_DIVISOR = 12.92;
const WCAG_CHANNEL_OFFSET = 0.055;
const WCAG_CHANNEL_SCALE = 1.055;
const WCAG_CHANNEL_GAMMA = 2.4;
const WCAG_RED_WEIGHT = 0.2126;
const WCAG_GREEN_WEIGHT = 0.7152;
const WCAG_BLUE_WEIGHT = 0.0722;
const WCAG_LUMINANCE_OFFSET = 0.05;
const WCAG_BODY_TEXT_CONTRAST_RATIO = 4.5;
const HEX_CHANNEL_STARTS = [1, 3, 5] as const;
const DARK_MODE_ACCESSIBLE_FALLBACKS = {
  primary: "#93C5FD",
  accent: "#FDBA74",
  text: "#FFFFFF",
  mutedText: "#D1D5DB",
  success: "#86EFAC",
  warning: "#FBBF24",
  danger: "#FCA5A5"
} as const;

const isHexColor = (value: string | undefined): value is string => (
  typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
);

const hexChannelToLinear = (hex: string, start: number): number => {
  const channel = Number.parseInt(hex.slice(start, start + 2), HEX_RADIX) / COLOR_CHANNEL_MAX;
  if (channel <= WCAG_LOW_CHANNEL_THRESHOLD) return channel / WCAG_LOW_CHANNEL_DIVISOR;
  return Math.pow((channel + WCAG_CHANNEL_OFFSET) / WCAG_CHANNEL_SCALE, WCAG_CHANNEL_GAMMA);
};

const relativeLuminance = (hex: string): number => {
  if (!isHexColor(hex) || hex.length !== HEX_COLOR_LENGTH) return 0;
  const red = hexChannelToLinear(hex, 1);
  const green = hexChannelToLinear(hex, 3);
  const blue = hexChannelToLinear(hex, 5);
  return (red * WCAG_RED_WEIGHT) + (green * WCAG_GREEN_WEIGHT) + (blue * WCAG_BLUE_WEIGHT);
};

const contrastRatio = (foreground: string, background: string): number => {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + WCAG_LUMINANCE_OFFSET) / (darker + WCAG_LUMINANCE_OFFSET);
};

const hasBodyTextContrast = (foreground: string | undefined, backgrounds: string[]): foreground is string => (
  isHexColor(foreground)
  && backgrounds.every((background) => (
    isHexColor(background) && contrastRatio(foreground, background) >= WCAG_BODY_TEXT_CONTRAST_RATIO
  ))
);

const chooseContrastSafeColor = (
  candidates: Array<string | undefined>,
  backgrounds: string[],
  fallback: string
): string => (
  candidates.find((candidate) => hasBodyTextContrast(candidate, backgrounds)) ?? fallback
);

const hasMeasuredColorEvidence = (measured: InspiredesignMeasuredColorRoles): boolean => (
  Boolean(measured.background || measured.surface || measured.text || measured.mutedText || measured.accent)
);

const chooseMeasuredLightBackground = (
  measured: InspiredesignMeasuredColorRoles,
  profileColors: ProfileConfig["colors"]
): string => (
  [measured.text, measured.surface, profileColors.background]
    .find((candidate) => isHexColor(candidate) && relativeLuminance(candidate) >= 0.5) ?? profileColors.background
);

const chooseMeasuredLightSurface = (
  measured: InspiredesignMeasuredColorRoles,
  profileColors: ProfileConfig["colors"],
  lightBackground: string
): string => (
  [measured.surface, profileColors.surface, measured.text]
    .find((candidate) => isHexColor(candidate) && hasBodyTextContrast(lightBackground, [candidate])) ?? profileColors.surface
);

const buildColorModeTokens = (
  profile: CanvasVisualDirectionProfile,
  designVectors: InspiredesignDesignVectors
): InspiredesignColorModeTokens => {
  const profileColors = PROFILE_CONFIG[profile].colors;
  const measured = extractMeasuredColorRoles(designVectors);
  const useMeasuredColors = hasMeasuredColorEvidence(measured);
  const lightBackground = useMeasuredColors
    ? chooseMeasuredLightBackground(measured, profileColors)
    : profileColors.background;
  const lightSurface = useMeasuredColors
    ? chooseMeasuredLightSurface(measured, profileColors, lightBackground)
    : profileColors.surface;
  const lightContrastBackgrounds = [lightBackground, lightSurface];
  const darkBackground = measured.background ?? profileColors.primary;
  const sharedAccent = measured.accent ?? profileColors.accent;
  const sharedMutedText = measured.mutedText ?? profileColors.mutedText;
  const darkSurfaceCandidate = measured.surface ?? measured.background ?? profileColors.text;
  const darkTextCandidate = chooseContrastSafeColor(
    [measured.text, profileColors.surface, DARK_MODE_ACCESSIBLE_FALLBACKS.text],
    [darkBackground],
    DARK_MODE_ACCESSIBLE_FALLBACKS.text
  );
  const darkMutedTextCandidate = chooseContrastSafeColor(
    [measured.mutedText, profileColors.mutedText, DARK_MODE_ACCESSIBLE_FALLBACKS.mutedText],
    [darkBackground],
    DARK_MODE_ACCESSIBLE_FALLBACKS.mutedText
  );
  const darkSurface = hasBodyTextContrast(darkTextCandidate, [darkSurfaceCandidate])
    && hasBodyTextContrast(darkMutedTextCandidate, [darkSurfaceCandidate])
    ? darkSurfaceCandidate
    : profileColors.text;
  const darkContrastBackgrounds = [darkBackground, darkSurface];
  return {
    light: {
      ...profileColors,
      primary: useMeasuredColors
        ? chooseContrastSafeColor(
          [measured.background, measured.accent, profileColors.primary],
          lightContrastBackgrounds,
          profileColors.primary
        )
        : profileColors.primary,
      accent: useMeasuredColors
        ? chooseContrastSafeColor(
          [measured.mutedText, measured.accent, profileColors.accent],
          lightContrastBackgrounds,
          profileColors.accent
        )
        : sharedAccent,
      accentSurface: useMeasuredColors ? (measured.surface ?? measured.text ?? profileColors.accentSurface) : profileColors.accentSurface,
      background: lightBackground,
      surface: lightSurface,
      border: measured.mutedText ?? profileColors.border,
      text: useMeasuredColors
        ? chooseContrastSafeColor([measured.background, profileColors.text], lightContrastBackgrounds, profileColors.text)
        : profileColors.text,
      mutedText: useMeasuredColors
        ? chooseContrastSafeColor([measured.mutedText, measured.background, profileColors.mutedText], lightContrastBackgrounds, profileColors.mutedText)
        : sharedMutedText
    },
    dark: {
      ...profileColors,
      primary: chooseContrastSafeColor(
        [measured.accent, profileColors.primary, profileColors.accent, DARK_MODE_ACCESSIBLE_FALLBACKS.primary],
        darkContrastBackgrounds,
        DARK_MODE_ACCESSIBLE_FALLBACKS.primary
      ),
      accent: chooseContrastSafeColor(
        [measured.accent, profileColors.accent, DARK_MODE_ACCESSIBLE_FALLBACKS.accent],
        darkContrastBackgrounds,
        DARK_MODE_ACCESSIBLE_FALLBACKS.accent
      ),
      accentSurface: measured.surface ?? profileColors.accentSurface,
      background: darkBackground,
      surface: darkSurface,
      border: measured.mutedText ?? profileColors.border,
      text: chooseContrastSafeColor(
        [measured.text, profileColors.surface, DARK_MODE_ACCESSIBLE_FALLBACKS.text],
        darkContrastBackgrounds,
        DARK_MODE_ACCESSIBLE_FALLBACKS.text
      ),
      mutedText: chooseContrastSafeColor(
        [measured.mutedText, profileColors.mutedText, DARK_MODE_ACCESSIBLE_FALLBACKS.mutedText],
        darkContrastBackgrounds,
        DARK_MODE_ACCESSIBLE_FALLBACKS.mutedText
      ),
      success: chooseContrastSafeColor(
        [profileColors.success, DARK_MODE_ACCESSIBLE_FALLBACKS.success],
        darkContrastBackgrounds,
        DARK_MODE_ACCESSIBLE_FALLBACKS.success
      ),
      warning: chooseContrastSafeColor(
        [profileColors.warning, DARK_MODE_ACCESSIBLE_FALLBACKS.warning],
        darkContrastBackgrounds,
        DARK_MODE_ACCESSIBLE_FALLBACKS.warning
      ),
      danger: chooseContrastSafeColor(
        [profileColors.danger, DARK_MODE_ACCESSIBLE_FALLBACKS.danger],
        darkContrastBackgrounds,
        DARK_MODE_ACCESSIBLE_FALLBACKS.danger
      )
    }
  };
};

const resolveThemeStrategy = (
  routeThemeStrategy: CanvasThemeStrategy,
  designVectors: InspiredesignDesignVectors
): CanvasThemeStrategy => (
  routeThemeStrategy === "single-theme" && hasMeasuredColorTokenEvidence(designVectors)
    ? "light-dark-parity"
    : routeThemeStrategy
);

const mediaAnalysisLookupKey = (referenceId: string, mediaPath: string): string => `${referenceId}\u0000${mediaPath}`;

const buildMediaAnalysisReferenceLookup = (
  mediaAnalysis: InspiredesignMediaAnalysis
): Map<string, InspiredesignMediaAnalysisReference[]> => {
  const lookup = new Map<string, InspiredesignMediaAnalysisReference[]>();
  for (const reference of mediaAnalysis.references) {
    if (reference.authority === "design_evidence" && reference.referenceId.trim().length > 0 && reference.mediaPath.trim().length > 0) {
      const key = mediaAnalysisLookupKey(reference.referenceId, reference.mediaPath);
      lookup.set(key, [...(lookup.get(key) ?? []), reference]);
    }
  }
  return lookup;
};

const normalizePinterestSourceUrlForMediaAnalysis = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  const normalized = normalizePinterestReferenceUrl(value);
  if (!normalized) return undefined;
  try {
    const url = new URL(normalized);
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments[0] === "pin") url.hostname = "www.pinterest.com";
    return url.toString().replace(/\/$/, "");
  } catch {
    return normalized.replace(/\/$/, "");
  }
};

const normalizeMediaUrlForMediaAnalysis = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  try {
    return new URL(value).href;
  } catch {
    return undefined;
  }
};

const mediaAnalysisSourceUrlMatches = (
  pinMedia: InspiredesignPersistedPinterestPinMediaEvidence,
  mediaReference: InspiredesignMediaAnalysisReference
): boolean => {
  const pinMediaSourceUrl = pinMedia.firstPartyProvenance.canonicalSourceUrl ?? pinMedia.sourceUrl;
  const persistedSourceUrl = normalizePinterestSourceUrlForMediaAnalysis(pinMediaSourceUrl);
  const mediaSourceUrl = normalizePinterestSourceUrlForMediaAnalysis(mediaReference.sourceUrl);
  return Boolean(persistedSourceUrl && mediaSourceUrl && persistedSourceUrl === mediaSourceUrl);
};

const mediaAnalysisMediaUrlMatches = (
  pinMedia: InspiredesignPersistedPinterestPinMediaEvidence,
  mediaReference: InspiredesignMediaAnalysisReference
): boolean => {
  const persistedMediaUrl = normalizeMediaUrlForMediaAnalysis(pinMedia.mediaUrl);
  const mediaUrl = normalizeMediaUrlForMediaAnalysis(mediaReference.mediaUrl);
  return Boolean(persistedMediaUrl && mediaUrl && persistedMediaUrl === mediaUrl);
};

const expectedMediaAnalysisKindForPinMedia = (
  pinMedia: Pick<InspiredesignPersistedPinterestPinMediaEvidence, "kind" | "contentType">
): InspiredesignMediaKind => {
  if (pinMedia.contentType === "image/gif") return "gif";
  return pinMedia.kind;
};

const pinMediaDimensionsMatchMediaAnalysis = (
  pinMedia: InspiredesignPersistedPinterestPinMediaEvidence,
  mediaReference: InspiredesignMediaAnalysisReference
): boolean => (
  typeof pinMedia.width === "number"
  && typeof pinMedia.height === "number"
  && mediaReference.dimensions?.width === pinMedia.width
  && mediaReference.dimensions.height === pinMedia.height
);

const pinMediaMatchesMediaAnalysisReference = (
  pinMedia: InspiredesignPersistedPinterestPinMediaEvidence,
  mediaReference: InspiredesignMediaAnalysisReference
): boolean => (
  mediaReference.authority === "design_evidence"
  && mediaReference.referenceId === pinMedia.referenceId
  && mediaReference.mediaPath === pinMedia.path
  && mediaReference.hash === pinMedia.sha256
  && mediaReference.kind === expectedMediaAnalysisKindForPinMedia(pinMedia)
  && mediaReference.contentType === pinMedia.contentType
  && mediaReference.bytes === pinMedia.bytes
  && pinMediaDimensionsMatchMediaAnalysis(pinMedia, mediaReference)
  && mediaAnalysisSourceUrlMatches(pinMedia, mediaReference)
  && mediaAnalysisMediaUrlMatches(pinMedia, mediaReference)
);

const persistedPinMediaPathForReference = (reference: InspiredesignReferenceEvidence): string | undefined => {
  const pinMedia = normalizeInspiredesignCaptureEvidence(reference.capture)?.pinMedia;
  if (pinMedia?.status !== "captured") return undefined;
  return persistInspiredesignPinterestPinMediaEvidence(pinMedia).path;
};

const mediaAnalysisReferencesForDesignReference = (
  reference: InspiredesignReferenceEvidence,
  lookup: Map<string, InspiredesignMediaAnalysisReference[]>
): readonly InspiredesignMediaAnalysisReference[] | undefined => {
  const mediaPath = persistedPinMediaPathForReference(reference);
  return mediaPath ? lookup.get(mediaAnalysisLookupKey(reference.id, mediaPath)) : undefined;
};

const getTrustedMediaAnalysisForDesignReference = (
  reference: InspiredesignReferenceEvidence,
  mediaReferences: readonly InspiredesignMediaAnalysisReference[] | undefined
): InspiredesignMediaAnalysisReference | undefined => {
  if (!mediaReferences || mediaReferences.length === 0) return undefined;
  const pinMedia = normalizeInspiredesignCaptureEvidence(reference.capture)?.pinMedia;
  if (pinMedia?.status !== "captured") return undefined;
  const persistedPinMedia = persistInspiredesignPinterestPinMediaEvidence(pinMedia);
  if (persistedPinMedia.authority !== "design_evidence") return undefined;
  return mediaReferences.find((mediaReference) => pinMediaMatchesMediaAnalysisReference(persistedPinMedia, mediaReference));
};

const summarizeMediaAnalysisReference = (
  reference: InspiredesignMediaAnalysisReference
): string => {
  if (!hasMeasuredMediaAnalysisDesignFacts(reference)) {
    return clipText([
      `media path ${reference.mediaPath}`,
      "metadata-only media analysis",
      "palette, layout, typography, and motion facts were not extracted",
      "exact readable text was not extracted"
    ].join("; "), REFERENCE_SUMMARY_CLIP_LENGTH);
  }
  const guidance = reference.designGuidance;
  return clipText([
    `media path ${reference.mediaPath}`,
    `layout ${guidance.layoutRecipe}`,
    `tokens ${guidance.tokenNotes.slice(0, 2).join("; ")}`,
    `tone ${guidance.imageryPosture}`,
    `typography ${guidance.typographyPosture}`,
    `motion ${guidance.motionPosture}`,
    "exact readable text was not extracted"
  ].filter((entry) => entry.trim().length > 0).join("; "), REFERENCE_SUMMARY_CLIP_LENGTH);
};

const isReferenceFirstPublicLanding = (designVectors: InspiredesignDesignVectors): boolean => {
  return designVectors.sourcePriority === "reference-evidence-first"
    && designVectors.surfaceIntent.toLowerCase().includes("public landing page");
};

const REFERENCE_LED_PUBLIC_LANDING_STALE_MARKERS = [
  "admin shell",
  "builder platforms",
  "creative software",
  "creative-tool",
  "dashboard",
  "design tooling",
  "inspector",
  "lab-white",
  "modular docks",
  "prompt input",
  "prompt panels",
  "sidebar",
  "specimen",
  "stage shell",
  "workspace"
] as const;

const mergeReferenceLedFormatEntries = (
  sourceEntries: readonly string[],
  defaultEntries: readonly string[]
): string[] => {
  const filtered = sourceEntries.filter((entry) => {
    const lower = entry.toLowerCase();
    return !REFERENCE_LED_PUBLIC_LANDING_STALE_MARKERS.some((marker) => lower.includes(marker));
  });
  return [...new Set([...filtered, ...defaultEntries].map(trimText).filter(Boolean))];
};

const buildEvidenceDerivedFormat = (
  format: InspiredesignBriefFormat,
  designVectors: InspiredesignDesignVectors
): InspiredesignBriefFormat => {
  const clone = cloneInspiredesignBriefFormat(format);
  if (!isReferenceFirstPublicLanding(designVectors)) return clone;
  return {
    ...clone,
    id: "reference-led-public-landing-page",
    label: "Reference-led public landing page",
    bestFor: [
      "brand and product landing pages",
      "portfolio and service studio surfaces",
      "reference-led campaign pages"
    ],
    businessFocus: [
      "public landing-page storytelling",
      "portfolio and service conversion",
      "brand trust and proof surfaces"
    ],
    keywords: [
      "landing page",
      "homepage",
      "portfolio",
      "gallery",
      "services",
      "booking",
      "case studies",
      "hero",
      "cta",
      "brand story"
    ],
    archetype: "reference-led public landing page",
    layoutArchetype: "full-bleed hero with narrative section cadence",
    typographySystem: "evidence-led display hierarchy with restrained body copy and readable implementation tokens",
    surfaceTreatment: "reference-derived media planes, disciplined contrast, and conversion-focused section rhythm",
    shapeLanguage: "hero-led sections, proof bands, media frames, and CTA surfaces shaped by captured references",
    componentGrammar: "hero composition, proof bands, narrative pathways, service or story sections, conversion CTA, and footer",
    motionGrammar: "reference-led hero reveal, scroll reveal, CTA feedback, and reduced-motion-safe continuity",
    paletteIntent: "derive light and dark semantic tokens from captured reference palettes with accessible contrast",
    visualDensity: "reference-calibrated",
    designVariance: "reference-led variation",
    focusAreas: [
      "hero composition",
      "media and portfolio treatment",
      "proof and trust sequence",
      "conversion CTA hierarchy",
      "section cadence",
      "responsive image behavior",
      "motion restraint"
    ],
    responsiveCollapseRules: mergeReferenceLedFormatEntries(clone.responsiveCollapseRules, [
      "Collapse full-bleed media and narrative copy into one dominant mobile story before shrinking image legibility.",
      "Keep portfolio, booking, and primary CTA paths visible on narrow screens without introducing app-shell chrome."
    ]),
    guardrails: mergeReferenceLedFormatEntries(clone.guardrails, [
      "Treat the selected format as route scaffolding only; captured references and the source brief provide creative direction.",
      "Keep public-page hierarchy, media treatment, and conversion flow ahead of tool-shell or dashboard conventions."
    ]),
    antiPatterns: mergeReferenceLedFormatEntries(clone.antiPatterns, [
      "No dashboard chrome.",
      "No inspector panels.",
      "No generic tool-lab copy.",
      "No feature-card hero."
    ]),
    deliverables: mergeReferenceLedFormatEntries(clone.deliverables, [
      "Return a reusable public landing-page contract grounded in captured reference evidence and the source brief.",
      "Define hero doctrine, portfolio or proof sequencing, CTA hierarchy, token strategy, and reduced-motion behavior."
    ]),
    route: {
      ...clone.route,
      profile: "product-story",
      themeStrategy: "light-dark-parity",
      navigationModel: "global-header",
      layoutApproach: "reference-led-landing-page"
    }
  };
};

const TARGET_KIND_ORDER: InspiredesignTargetKind[] = ["page", "component", "asset"];

type TargetSignalBucket = {
  intent: string[];
  supporting: string[];
  incidental: string[];
};

type TargetEligibility = {
  kind: InspiredesignTargetKind;
  eligible: boolean;
  confidence: number;
  triggeringSignals: string[];
};

type TargetDecisionReason =
  | "no_non_page_gate"
  | "non_page_did_not_beat_page"
  | "page_first_brief_target"
  | "page_tie_break"
  | "non_page_selected";

type TargetDecision = {
  primaryKind: InspiredesignTargetKind;
  reason: TargetDecisionReason;
};

const TARGET_CONFIDENCE = {
  defaultPage: 0.55,
  pageIntentStep: 0.05,
  nonPageBase: 0.55,
  intentStep: 0.08,
  supportingStep: 0.05,
  maxPage: 0.7,
  maxNonPage: 0.95
} as const;

const TARGET_SIGNAL_PROFILES: Record<InspiredesignTargetKind, TargetSignalBucket> = {
  page: {
    intent: ["page", "landing page", "website", "homepage", "dashboard", "workspace", "screen", "flow", "surface", "microsite"],
    supporting: ["section", "sections", "navigation", "footer", "hero section", "conversion flow"],
    incidental: ["card", "cards", "button", "buttons", "image", "images", "media", "hero", "cta", "background"]
  },
  component: {
    intent: ["component", "component family", "reusable component", "component prototype", "hero component", "card component", "storybook"],
    supporting: ["prop", "props", "slot", "slots", "variant", "variants", "state matrix", "hover", "focus", "disabled", "loading", "error", "fixture", "fixtures", "arg", "args"],
    incidental: ["card", "cards", "button", "buttons", "form", "modal", "drawer", "navbar", "hero", "input", "tabs", "cta"]
  },
  asset: {
    intent: ["asset", "asset pack", "visual asset", "icon pack", "logo pack", "illustration set", "artwork set"],
    supporting: ["responsive variant", "responsive variants", "responsive artwork", "provenance", "usage rules", "alt text", "replacement rules", "tokenized usage", "source asset", "source assets"],
    incidental: ["icon", "icons", "illustration", "illustrations", "logo", "logos", "media", "image", "images", "background", "texture", "sprite", "artwork"]
  }
};

const buildTargetCorpus = (
  brief: string,
  references: InspiredesignReferenceEvidence[],
  synthesis: InspiredesignReferenceSynthesis,
  pinMediaIndex?: readonly InspiredesignPinterestPinMediaIndexEntry[]
): string => [
  brief,
  synthesis.lines.join(" "),
  ...references
    .filter((reference) => hasInspiredesignUsableReferenceEvidence(reference, pinMediaIndex))
    .flatMap((reference) => getInspiredesignReferenceSignals(reference))
].join(" ").toLowerCase();

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const matchesTargetSignal = (corpus: string, signal: string): boolean => {
  const pattern = escapeRegex(signal.toLowerCase()).replace(/\s+/g, "\\s+");
  return new RegExp(`(^|[^a-z0-9])${pattern}([^a-z0-9]|$)`).test(corpus);
};

const findTargetSignalIndex = (corpus: string, signal: string): number | null => {
  const pattern = escapeRegex(signal.toLowerCase()).replace(/\s+/g, "\\s+");
  return new RegExp(`(^|[^a-z0-9])${pattern}([^a-z0-9]|$)`).exec(corpus)?.index ?? null;
};

const findFirstBriefTargetKind = (brief: string): InspiredesignTargetKind | null => {
  const corpus = brief.toLowerCase();
  const hits = TARGET_KIND_ORDER.flatMap((kind) => (
    TARGET_SIGNAL_PROFILES[kind].intent
      .map((signal) => findTargetSignalIndex(corpus, signal))
      .filter((index): index is number => index !== null)
      .map((index) => ({ kind, index }))
  ));
  return hits.sort((left, right) => left.index - right.index)[0]?.kind ?? null;
};

const collectTargetSignals = (corpus: string): Record<InspiredesignTargetKind, TargetSignalBucket> => {
  const collect = (kind: InspiredesignTargetKind): TargetSignalBucket => {
    const profile = TARGET_SIGNAL_PROFILES[kind];
    return {
      intent: profile.intent.filter((signal) => matchesTargetSignal(corpus, signal)),
      supporting: profile.supporting.filter((signal) => matchesTargetSignal(corpus, signal)),
      incidental: profile.incidental.filter((signal) => matchesTargetSignal(corpus, signal))
    };
  };
  return {
    page: collect("page"),
    component: collect("component"),
    asset: collect("asset")
  };
};

const clampTargetConfidence = (value: number, max: number): number => Math.min(max, Number(value.toFixed(2)));

const buildPageConfidence = (signals: TargetSignalBucket): number => {
  return clampTargetConfidence(
    TARGET_CONFIDENCE.defaultPage + (signals.intent.length * TARGET_CONFIDENCE.pageIntentStep),
    TARGET_CONFIDENCE.maxPage
  );
};

const buildTargetEligibility = (
  kind: InspiredesignTargetKind,
  briefSignals: TargetSignalBucket,
  supportSignals: TargetSignalBucket
): TargetEligibility => {
  const eligible = briefSignals.intent.length > 0 && supportSignals.supporting.length > 0;
  const confidence = eligible
    ? clampTargetConfidence(
      TARGET_CONFIDENCE.nonPageBase
        + (briefSignals.intent.length * TARGET_CONFIDENCE.intentStep)
        + (supportSignals.supporting.length * TARGET_CONFIDENCE.supportingStep),
      TARGET_CONFIDENCE.maxNonPage
    )
    : 0;
  return {
    kind,
    eligible,
    confidence,
    triggeringSignals: [
      ...briefSignals.intent.map((signal) => `${kind} intent: ${signal}`),
      ...supportSignals.supporting.map((signal) => `${kind} support: ${signal}`)
    ]
  };
};

const choosePrimaryTargetKind = (
  pageConfidence: number,
  pageSignals: TargetSignalBucket,
  firstBriefTargetKind: InspiredesignTargetKind | null,
  component: TargetEligibility,
  asset: TargetEligibility
): TargetDecision => {
  const eligibleTargets = [component, asset].filter((target) => target.eligible);
  if (eligibleTargets.length === 0) return { primaryKind: "page", reason: "no_non_page_gate" };
  if (firstBriefTargetKind === "page" && pageSignals.intent.length > 0) {
    return { primaryKind: "page", reason: "page_first_brief_target" };
  }
  const [first, second] = eligibleTargets.sort((left, right) => right.confidence - left.confidence);
  if (!first || first.confidence <= pageConfidence) {
    return { primaryKind: "page", reason: "non_page_did_not_beat_page" };
  }
  if (second && first.confidence === second.confidence && pageSignals.intent.length > 0) {
    return { primaryKind: "page", reason: "page_tie_break" };
  }
  return { primaryKind: first.kind, reason: "non_page_selected" };
};

const chooseTargetKinds = (
  primaryKind: InspiredesignTargetKind,
  component: TargetEligibility,
  asset: TargetEligibility
): InspiredesignTargetKind[] => {
  if (primaryKind === "page") return ["page"];
  const eligible = new Set([component, asset].filter((target) => target.eligible).map((target) => target.kind));
  const secondaryKinds = TARGET_KIND_ORDER.filter((kind) => kind !== primaryKind && eligible.has(kind));
  return [primaryKind, ...secondaryKinds];
};

const buildTriggeringSignals = (
  decision: TargetDecision,
  signals: Record<InspiredesignTargetKind, TargetSignalBucket>,
  component: TargetEligibility,
  asset: TargetEligibility
): string[] => {
  const pageSignals = signals.page.intent.map((signal) => `page intent: ${signal}`);
  const eligibleTargets = [component, asset].filter((target) => target.eligible);
  const targetIntents = eligibleTargets
    .flatMap((target) => target.triggeringSignals.filter((signal) => signal.includes(" intent: ")));
  const targetSupport = eligibleTargets
    .flatMap((target) => target.triggeringSignals.filter((signal) => signal.includes(" support: ")));
  const defaultSignal = decision.primaryKind === "page" ? [buildPageDecisionSignal(decision.reason)] : [];
  return [...pageSignals, ...targetIntents, ...targetSupport, ...defaultSignal].slice(0, 12);
};

const buildPageDecisionSignal = (reason: TargetDecisionReason): string => {
  if (reason === "no_non_page_gate") return "page default: non-page targets did not clear brief intent plus support gates";
  if (reason === "non_page_did_not_beat_page") return "page default: non-page targets did not beat page confidence";
  if (reason === "page_first_brief_target") return "page default: page was the first explicit target in the brief";
  if (reason === "page_tie_break") return "page default: page intent won a tied non-page confidence score";
  return "page default: page selected";
};

const getTargetConfidence = (
  primaryKind: InspiredesignTargetKind,
  pageConfidence: number,
  component: TargetEligibility,
  asset: TargetEligibility
): number => {
  if (primaryKind === "component") return component.confidence;
  if (primaryKind === "asset") return asset.confidence;
  return pageConfidence;
};

const buildTargetEvidenceBuckets = (
  primaryKind: InspiredesignTargetKind,
  format: InspiredesignBriefFormat,
  designVectors: InspiredesignDesignVectors
): InspiredesignEvidenceBuckets => ({
  anatomy: [`Map ${primaryKind} anatomy before styling: root, content hierarchy, interaction zones, and supporting regions.`],
  propsSlots: [`Define props/slots from ${format.componentGrammar}; separate data props, content slots, and visual variant controls.`],
  stateMatrix: ["Cover default, hover, focus, active, disabled, loading, empty, error, success, and selected where relevant."],
  tokens: [`Resolve typography, color, spacing, radius, shadow, motion, and z-index through semantic tokens for ${format.paletteIntent}.`],
  assets: [`Inventory source assets, derived assets, usage rights, responsive variants, and replacement notes for ${primaryKind} prototypes.`],
  accessibility: ["Validate keyboard order, visible focus, accessible names, ARIA pattern fit, contrast, and WCAG 2.2 states."],
  motion: [`Use ${format.motionGrammar}; include reduced-motion alternatives for ${designVectors.motionPosture.join(" ") || "all transitions"}.`],
  previewFixtures: [`Build isolated preview fixtures for ${primaryKind} default, responsive, reduced-motion, and failure states.`]
});

const buildComponentTargetAnalysis = (
  briefHash: string,
  format: InspiredesignBriefFormat
): InspiredesignTargetAnalysis["component"] => ({
  canvasType: "CanvasComponentInventoryItem",
  inventoryItems: [{
    id: `component_${briefHash}`,
    name: `${format.label} Component`,
    componentName: `${format.route.profile.replace(/-/g, "")}PrototypeComponent`,
    description: `Reusable component prototype derived from ${format.componentGrammar}.`,
    sourceFamily: "framework_component",
    origin: "code_sync",
    variants: [{
      id: "default",
      name: "Default",
      selector: { interaction: "default" },
      description: "Default preview fixture.",
      metadata: {}
    }],
    props: [
      { name: "variant", type: "string", required: false, description: "Visual variant key.", metadata: {} },
      { name: "state", type: "string", required: false, description: "Interaction state fixture.", metadata: {} }
    ],
    slots: [
      { name: "media", description: "Optional visual or icon slot.", allowedKinds: ["asset", "image", "icon"], metadata: {} },
      { name: "content", description: "Primary text or rich content slot.", allowedKinds: ["text", "rich-text"], metadata: {} }
    ],
    events: [{ name: "onPrimaryAction", description: "Primary interaction callback.", payloadShape: {}, metadata: {} }],
    content: { acceptsText: true, acceptsRichText: true, slotNames: ["media", "content"], metadata: {} },
    metadata: { targetKind: "component" }
  }],
  prototypeGuidance: [
    "Component prototype target: document anatomy, props/slots, variant rules, and interaction state fixtures before page composition.",
    "Use Storybook-style args and interaction checks when converting this guidance into executable component previews."
  ]
});

const buildAssetTargetAnalysis = (briefHash: string): InspiredesignTargetAnalysis["asset"] => ({
  canvasType: "CanvasAsset",
  assets: [{
    id: `asset_${briefHash}`,
    sourceType: "page-derived",
    kind: "visual-asset",
    url: null,
    status: "needs-production-source",
    provenanceNotes: ["Derived from brief/reference evidence; recreate rather than copy proprietary source assets."],
    usageNotes: ["Define responsive variants, token usage, alt text, and replacement rules before implementation."],
    metadata: { targetKind: "asset" }
  }],
  prototypeGuidance: [
    "Asset prototype target: catalog provenance, variants, token usage, responsive behavior, and replacement rules.",
    "Pair each visual asset with preview fixtures for default, high contrast, and reduced-motion contexts when relevant."
  ]
});

const buildPageTargetAnalysis = (
  format: InspiredesignBriefFormat,
  designVectors: InspiredesignDesignVectors
): InspiredesignTargetAnalysis["page"] => ({
  canvasType: "CanvasPage",
  assemblyFocus: [
    format.layoutArchetype,
    ...designVectors.sectionArchitecture
  ],
  implementationNotes: [
    "Page prototype target: validate section order, navigation model, CTA visibility, responsive collapse, and reduced-motion behavior.",
    "Use component primitives before page-specific wrappers."
  ]
});

const buildTargetAnalysis = (
  brief: string,
  format: InspiredesignBriefFormat,
  references: InspiredesignReferenceEvidence[],
  synthesis: InspiredesignReferenceSynthesis,
  designVectors: InspiredesignDesignVectors
): InspiredesignTargetAnalysis => {
  const briefSignals = collectTargetSignals(brief.toLowerCase());
  const supportSignals = collectTargetSignals(buildTargetCorpus(brief, references, synthesis));
  const pageConfidence = buildPageConfidence(briefSignals.page);
  const component = buildTargetEligibility("component", briefSignals.component, supportSignals.component);
  const asset = buildTargetEligibility("asset", briefSignals.asset, supportSignals.asset);
  const decision = choosePrimaryTargetKind(
    pageConfidence,
    briefSignals.page,
    findFirstBriefTargetKind(brief),
    component,
    asset
  );
  const primaryKind = decision.primaryKind;
  const kinds = chooseTargetKinds(primaryKind, component, asset);
  const briefHash = referenceFingerprint(brief);
  return {
    primaryKind,
    kinds,
    confidence: getTargetConfidence(primaryKind, pageConfidence, component, asset),
    triggeringSignals: buildTriggeringSignals(decision, briefSignals, component, asset),
    evidenceBuckets: buildTargetEvidenceBuckets(primaryKind, format, designVectors),
    ...(kinds.includes("page") ? { page: buildPageTargetAnalysis(format, designVectors) } : {}),
    ...(kinds.includes("component") ? { component: buildComponentTargetAnalysis(briefHash, format) } : {}),
    ...(kinds.includes("asset") ? { asset: buildAssetTargetAnalysis(briefHash) } : {})
  };
};

type BuildGenerationPlanInput = {
  brief: string;
  format: InspiredesignBriefFormat;
  synthesis: InspiredesignReferenceSynthesis;
  referencePatternBoard: InspiredesignReferencePatternBoard;
  designVectors: InspiredesignDesignVectors;
  targetAnalysis: InspiredesignTargetAnalysis;
};

const buildGenerationPlan = ({
  brief,
  format,
  synthesis,
  referencePatternBoard,
  designVectors,
  targetAnalysis
}: BuildGenerationPlanInput): InspiredesignGenerationPlan => {
  const plan = cloneTemplate(BASE_GENERATION_PLAN);
  const profile = format.route.profile;
  const vectorSummary = summarizeDesignVectors(designVectors);
  const mediaSummary = summarizeMediaDerivedDesignVectors(designVectors);
  plan.targetOutcome.summary = clipText(
    [
      summarizeBrief(brief),
      `Reference cues: ${synthesis.summary}`,
      vectorSummary
    ].filter((summary) => summary.length > 0).join(" "),
    GENERATION_PLAN_REFERENCE_CLIP_LENGTH
  );
  plan.visualDirection.profile = profile;
  plan.visualDirection.themeStrategy = resolveThemeStrategy(format.route.themeStrategy, designVectors);
  plan.layoutStrategy.approach = format.route.layoutApproach;
  plan.layoutStrategy.navigationModel = format.route.navigationModel;
  plan.contentStrategy.source = clipText(
    [
      `${INSPIREDESIGN_HANDOFF_FILES.evidence}, ${INSPIREDESIGN_HANDOFF_FILES.advancedBrief}, ${INSPIREDESIGN_HANDOFF_FILES.designMarkdown}.`,
      `Use reference pattern board and design vectors from evidence/handoff artifacts plus ${INSPIREDESIGN_MEDIA_ANALYSIS_ARTIFACT_FILE} summaries when present.`,
      synthesis.summary,
      mediaSummary,
      vectorSummary
    ].filter((summary) => summary.length > 0).join(" "),
    GENERATION_PLAN_REFERENCE_CLIP_LENGTH
  );
  plan.componentStrategy.mode = clipText(
    [
      `reuse-first, adapted from captured references: ${synthesis.summary}.`,
      "Include hero entrance reveal, section scroll reveal, CTA/focus feedback, microinteractions, hover effects, evidence-gated cursor effects, material depth, parallax constraints, glass/translucency policy, and prefers-reduced-motion behavior.",
      "Capture desktop and mobile browser proof for responsive layout, reduced-motion behavior, focus states, and primary CTA visibility."
    ].filter((summary) => summary.length > 0).join(" "),
    GENERATION_PLAN_REFERENCE_CLIP_LENGTH
  );
  plan.componentStrategy.interactionStates = ["default", "hover", "focus", "disabled", "loading"];
  plan.validationTargets.requiredThemes = plan.visualDirection.themeStrategy === "single-theme"
    ? ["light"]
    : ["light", "dark"];
  return {
    ...plan,
    referencePatternBoard,
    designVectors,
    targetAnalysis,
    interactionMoments: [...designVectors.interactionMoments],
    materialEffects: [...designVectors.materialEffects]
  };
};

const buildIntentBlock = (
  brief: string,
  urls: string[],
  references: InspiredesignReferenceEvidence[],
  format: InspiredesignBriefFormat
): JsonRecord => {
  const intent = cloneTemplate(BASE_CONTRACT_TEMPLATE.intent);
	return {
		...intent,
		audience: resolveIntentAudience(brief, format),
		task: summarizeBrief(brief),
		brief,
		briefHash: referenceFingerprint(brief),
    selectedFormat: format.label,
    businessFocus: [...format.businessFocus],
    keywords: [...format.keywords],
    referenceCount: references.length,
    referenceUrls: urls,
    evidenceStatus: {
      fetched: references.filter((reference) => reference.fetchStatus === "captured").length,
      captured: references.filter((reference) => reference.captureStatus === "captured").length
    }
  };
};

const buildDesignLanguageBlock = (
  profile: CanvasVisualDirectionProfile,
  format: InspiredesignBriefFormat,
  designVectors: InspiredesignDesignVectors
): JsonRecord => {
  const block = cloneTemplate(BASE_CONTRACT_TEMPLATE.designLanguage);
  const config = PROFILE_CONFIG[profile];
  return {
    ...block,
    direction: config.direction,
    visualPersonality: config.visualPersonality,
    brandTone: config.brandTone,
    archetype: format.archetype,
    surfaceTreatment: format.surfaceTreatment,
    shapeLanguage: format.shapeLanguage,
    paletteIntent: format.paletteIntent,
    visualDensity: format.visualDensity,
    designVariance: format.designVariance,
    mediaDerivedDirection: designVectors.directionLabel,
    mediaDerivedPosture: designVectors.premiumPosture,
    mediaDerivedImagery: designVectors.imageryPosture
  };
};

const buildContentModelBlock = (
  brief: string,
  references: InspiredesignReferenceEvidence[]
): JsonRecord => {
  const block = cloneTemplate(BASE_CONTRACT_TEMPLATE.contentModel);
  return {
    ...block,
    primaryMessage: summarizeBrief(brief),
    supportingMessages: buildSupportingMessages(references)
  };
};

const buildLayoutSystemBlock = (
  plan: InspiredesignGenerationPlan,
  format: InspiredesignBriefFormat
): JsonRecord => {
  const block = cloneTemplate(BASE_CONTRACT_TEMPLATE.layoutSystem);
  return {
    ...block,
    layoutArchetype: format.layoutArchetype,
    layoutApproach: plan.layoutStrategy.approach,
    navigationModel: plan.layoutStrategy.navigationModel,
    pagePatterns: [format.layoutArchetype, ...PROFILE_CONFIG[plan.visualDirection.profile].pagePatterns],
    mediaDerivedComposition: plan.designVectors.compositionModel
  };
};

const buildTypographySystemBlock = (
  format: InspiredesignBriefFormat,
  designVectors: InspiredesignDesignVectors
): JsonRecord => {
  const block = cloneTemplate(BASE_CONTRACT_TEMPLATE.typographySystem);
  return {
    ...block,
    system: format.typographySystem,
    tokens: {
      display: "56/1.0",
      h1: "40/1.05",
      h2: "28/1.1",
      h3: "20/1.2",
      body: "16/1.6",
      label: "14/1.4",
      caption: "12/1.4"
    },
    mediaDerivedHierarchy: designVectors.typographyPosture,
    readableTextPolicy: "Exact readable text was not extracted by v1 media analysis; use brief or fetched metadata for copy."
  };
};

const buildColorSystemBlock = (
  profile: CanvasVisualDirectionProfile,
  format: InspiredesignBriefFormat,
  designVectors: InspiredesignDesignVectors
): JsonRecord => {
  const colors = buildColorModeTokens(profile, designVectors);
  return {
    paletteName: `${format.id}-default`,
    paletteIntent: format.paletteIntent,
    tokens: colors,
    contrastRequirements: {
      bodyText: "4.5:1",
      largeText: "3:1",
      focusRing: "3:1"
    },
    mediaDerivedTokenNotes: designVectors.materialEffects.filter(isMediaDerivedSummary)
  };
};

const buildSurfaceSystemBlock = (
  format: InspiredesignBriefFormat,
  designVectors: InspiredesignDesignVectors
): JsonRecord => ({
  surfaceTreatment: format.surfaceTreatment,
  shapeLanguage: format.shapeLanguage,
  radiusScale: {
    xs: "6px",
    sm: "10px",
    md: "16px",
    lg: "24px"
  },
  borderPolicy: "Use 1px neutral strokes before adding elevation.",
  shadowPolicy: {
    sm: "0 1px 2px rgba(15, 23, 42, 0.06)",
    md: "0 10px 30px rgba(15, 23, 42, 0.10)",
    lg: "0 24px 60px rgba(15, 23, 42, 0.14)"
  },
  mediaDerivedImageryPosture: designVectors.imageryPosture,
  mediaDerivedMaterialEffects: designVectors.materialEffects
});

const buildIconSystemBlock = (): JsonRecord => ({
  family: "tabler",
  strokeWidth: 1.5,
  style: "rounded-linear",
  usageRules: [
    "Use icons to reinforce labels, not replace them.",
    "Decorative icons should remain visually lighter than primary copy."
  ]
});

const buildMotionSystemBlock = (
  format: InspiredesignBriefFormat,
  designVectors: InspiredesignDesignVectors
): JsonRecord => {
  const block = cloneTemplate(BASE_CONTRACT_TEMPLATE.motionSystem);
  return {
    ...block,
    grammar: format.motionGrammar,
    posture: [...designVectors.motionPosture],
    interactionMoments: [...designVectors.interactionMoments],
    materialEffects: [...designVectors.materialEffects],
    advancedMotionAdvisory: [...designVectors.advancedMotionAdvisory],
    advancedMotionRuntimePolicy: "Advanced motion fields are advisory contract metadata only and do not authorize shader, WebGL, Spline, R3F, Pixi, Babylon, or GLSL runtime support.",
    parallaxPolicy: "Use parallax only as a restrained hierarchy cue and remove transform-based depth for reduced-motion users.",
    hoverPolicy: "Hover effects must clarify clickability without becoming the only visible affordance.",
    cursorPolicy: "Cursor effects are allowed only on premium hero or CTA moments and must not interfere with reading or form controls.",
    durations: {
      quick: "120ms",
      standard: "180ms",
      emphasis: "240ms"
    }
  };
};

const buildResponsiveSystemBlock = (format: InspiredesignBriefFormat): JsonRecord => {
  const block = cloneTemplate(BASE_CONTRACT_TEMPLATE.responsiveSystem);
  return {
    ...block,
    collapseRules: [...format.responsiveCollapseRules],
    breakpoints: {
      mobile: "0-639px",
      tablet: "640-1023px",
      desktop: "1024px+"
    }
  };
};

const buildAccessibilityBlock = (): JsonRecord => {
  const block = cloneTemplate(BASE_CONTRACT_TEMPLATE.accessibilityPolicy);
  return {
    ...block,
    reducedMotion: "Respect user preference and preserve information without animation."
  };
};

const buildLibraryPolicyBlock = (): JsonRecord => ({
  components: ["shadcn"],
  icons: ["tabler"],
  styling: ["tailwindcss"],
  motion: [],
  threeD: []
});

const buildRuntimeBudgetsBlock = (plan: CanvasGenerationPlan): JsonRecord => ({
  maxHeroActions: 2,
  maxPrimarySections: plan.layoutStrategy.navigationModel === "global-header" ? 12 : 8,
  maxInteractionLatencyMs: plan.validationTargets.maxInteractionLatencyMs,
  previewBudgetMs: 1500,
  notes: [
    "Keep above-the-fold content inside one visual composition.",
    "Avoid heavyweight decorative animation before interaction clarity is established."
  ]
});

const EMITTED_GOVERNANCE_BLOCKS: InspiredesignContractScope["emittedGovernanceBlocks"] = [
  "intent",
  "generationPlan",
  "designLanguage",
  "contentModel",
  "layoutSystem",
  "typographySystem",
  "colorSystem",
  "surfaceSystem",
  "iconSystem",
  "motionSystem",
  "responsiveSystem",
  "accessibilityPolicy",
  "libraryPolicy",
  "runtimeBudgets"
];

const buildNavigationModelBlock = (navigationModel: CanvasNavigationModel): JsonRecord => {
  const block = cloneTemplate(BASE_CONTRACT_TEMPLATE.navigationModel);
  return {
    ...block,
    primaryRouteModel: `Use a ${navigationModel} route shell so the primary action remains stable through state changes.`
  };
};

const buildAsyncModelBlock = (): JsonRecord => {
  return cloneTemplate(BASE_CONTRACT_TEMPLATE.asyncModel);
};

const buildPerformanceModelBlock = (): JsonRecord => {
  return cloneTemplate(BASE_CONTRACT_TEMPLATE.performanceModel);
};

const buildCanvasPlanRequest = (
  brief: string,
  generationPlan: InspiredesignGenerationPlan
): CanvasPlanRequestTemplate => ({
  ...cloneTemplate(BASE_PLAN_REQUEST_TEMPLATE),
  requestId: `req_plan_${referenceFingerprint(brief).slice(0, 12)}`,
  generationPlan: toCanvasGenerationPlan(generationPlan)
});

const toCanvasGenerationPlan = (plan: InspiredesignGenerationPlan): CanvasPlanRequestTemplate["generationPlan"] => {
  const generationPlan = cloneTemplate({
    targetOutcome: plan.targetOutcome,
    visualDirection: plan.visualDirection,
    layoutStrategy: plan.layoutStrategy,
    contentStrategy: plan.contentStrategy,
    componentStrategy: plan.componentStrategy,
    motionPosture: plan.motionPosture,
    responsivePosture: plan.responsivePosture,
    accessibilityPosture: plan.accessibilityPosture,
    validationTargets: plan.validationTargets,
    interactionMoments: [...plan.interactionMoments],
    materialEffects: [...plan.materialEffects],
    designVectors: plan.designVectors as JsonRecord
  });
  return scrubCanvasGenerationPlanValue(generationPlan as JsonValue) as CanvasPlanRequestTemplate["generationPlan"];
};

const buildContractScope = (): InspiredesignContractScope => ({
  emittedContract: "CanvasDesignGovernance",
  emittedGovernanceBlocks: [...EMITTED_GOVERNANCE_BLOCKS],
  omittedTemplateBlocks: ["navigationModel", "asyncModel", "performanceModel"],
  note: `${INSPIREDESIGN_HANDOFF_FILES.designContract} is the narrowed canvas governance contract. Use ${INSPIREDESIGN_HANDOFF_FILES.designAgentHandoff} for navigation, async, and performance context that informs implementation but does not belong in canvas governance patches.`
});

const buildBriefExpansionMetadata = (
  briefExpansion: InspiredesignBriefExpansion
): InspiredesignFollowthrough["briefExpansion"] => ({
  templateVersion: briefExpansion.templateVersion,
  file: INSPIREDESIGN_HANDOFF_FILES.advancedBrief,
  format: cloneInspiredesignBriefFormat(briefExpansion.format)
});

const buildRequiredReferenceArtifacts = (includePrototypeGuidance: boolean): string[] => {
  const files = [
    INSPIREDESIGN_HANDOFF_FILES.evidence,
    INSPIREDESIGN_HANDOFF_FILES.visualEvidence,
    INSPIREDESIGN_HANDOFF_FILES.screenshotIndex,
    INSPIREDESIGN_HANDOFF_FILES.motionEvidence,
    INSPIREDESIGN_HANDOFF_FILES.pinMediaEvidence,
    INSPIREDESIGN_HANDOFF_FILES.pinMediaIndex,
    INSPIREDESIGN_HANDOFF_FILES.mediaAnalysis,
    INSPIREDESIGN_HANDOFF_FILES.rankedReferences,
    INSPIREDESIGN_HANDOFF_FILES.metaPrompt,
    INSPIREDESIGN_HANDOFF_FILES.advancedBrief,
    INSPIREDESIGN_HANDOFF_FILES.designMarkdown,
    INSPIREDESIGN_HANDOFF_FILES.generationPlan,
    INSPIREDESIGN_HANDOFF_FILES.canvasPlanRequest,
    INSPIREDESIGN_HANDOFF_FILES.designContract,
    INSPIREDESIGN_HANDOFF_FILES.implementationPlanMarkdown
  ];
  return includePrototypeGuidance
    ? [...files, INSPIREDESIGN_HANDOFF_FILES.prototypeGuidance]
    : files;
};

type BuildFollowthroughInput = {
  generationPlan: InspiredesignGenerationPlan;
  briefExpansion: InspiredesignBriefExpansion;
  synthesis: InspiredesignReferenceSynthesis;
  includePrototypeGuidance: boolean;
  implementationPlan: InspiredesignImplementationPlan;
  referencePatternBoard: InspiredesignReferencePatternBoard;
  designVectors: InspiredesignDesignVectors;
  targetAnalysis: InspiredesignTargetAnalysis;
};

const buildFollowthrough = ({
  generationPlan,
  briefExpansion,
  synthesis,
  includePrototypeGuidance,
  implementationPlan,
  referencePatternBoard,
  designVectors,
  targetAnalysis
}: BuildFollowthroughInput): InspiredesignFollowthrough => ({
  summary: buildInspiredesignFollowthroughSummary(),
  nextStep: buildInspiredesignNextStep(),
  artifactGuide: INSPIREDESIGN_ARTIFACT_GUIDE,
  contractSectionGuide: INSPIREDESIGN_CONTRACT_SECTION_GUIDE,
  briefExpansion: buildBriefExpansionMetadata(briefExpansion),
  recommendedSkills: [...INSPIREDESIGN_HANDOFF_RECOMMENDED_SKILLS],
  commandExamples: { ...INSPIREDESIGN_HANDOFF_COMMANDS },
  deepCaptureRecommendation: INSPIREDESIGN_HANDOFF_GUIDANCE.deepCaptureRecommendation,
  contractScope: buildContractScope(),
  implementationContext: {
    navigationModel: buildNavigationModelBlock(generationPlan.layoutStrategy.navigationModel),
    asyncModel: buildAsyncModelBlock(),
    performanceModel: buildPerformanceModelBlock(),
    tokenStrategy: implementationPlan.tokenStrategy,
    implementationPlan,
    referenceSynthesis: {
      requiredArtifacts: buildRequiredReferenceArtifacts(includePrototypeGuidance),
      cues: synthesis.lines
    },
    referencePatternBoard,
    designVectors,
    targetAnalysis
  }
});

type BuildDesignContractInput = {
  brief: string;
  designReferences: InspiredesignReferenceEvidence[];
  plan: InspiredesignGenerationPlan;
  format: InspiredesignBriefFormat;
};

const buildDesignContract = ({
  brief,
  designReferences,
  plan,
  format
}: BuildDesignContractInput): CanvasDesignGovernance => ({
  intent: buildIntentBlock(brief, designReferences.map((reference) => reference.url), designReferences, format),
  generationPlan: toCanvasGenerationPlan(plan),
  designLanguage: buildDesignLanguageBlock(plan.visualDirection.profile, format, plan.designVectors),
  contentModel: buildContentModelBlock(brief, designReferences),
  layoutSystem: buildLayoutSystemBlock(plan, format),
  typographySystem: buildTypographySystemBlock(format, plan.designVectors),
  colorSystem: buildColorSystemBlock(plan.visualDirection.profile, format, plan.designVectors),
  surfaceSystem: buildSurfaceSystemBlock(format, plan.designVectors),
  iconSystem: buildIconSystemBlock(),
  motionSystem: buildMotionSystemBlock(format, plan.designVectors),
  responsiveSystem: buildResponsiveSystemBlock(format),
  accessibilityPolicy: buildAccessibilityBlock(),
  libraryPolicy: buildLibraryPolicyBlock(),
  runtimeBudgets: buildRuntimeBudgetsBlock(plan)
});

const buildTokenStrategy = (
  profile: CanvasVisualDirectionProfile,
  designVectors: InspiredesignDesignVectors
): InspiredesignTokenStrategy => ({
  colors: buildColorModeTokens(profile, designVectors),
  typography: {
    display: "font-display text-[56px] leading-[1.0]",
    h1: "font-display text-[40px] leading-[1.05]",
    h2: "font-display text-[28px] leading-[1.1]",
    h3: "font-display text-[20px] leading-[1.2]",
    body: "font-body text-[16px] leading-[1.6]",
    label: "font-body text-[14px] leading-[1.4]",
    caption: "font-body text-[12px] leading-[1.4]"
  },
  spacing: {
    xs: "4px",
    sm: "8px",
    md: "16px",
    lg: "24px",
    xl: "40px",
    section: "96px"
  },
  radius: {
    xs: "6px",
    sm: "10px",
    md: "16px",
    lg: "24px"
  },
  shadow: {
    sm: "0 1px 2px rgba(15, 23, 42, 0.06)",
    md: "0 10px 30px rgba(15, 23, 42, 0.10)",
    lg: "0 24px 60px rgba(15, 23, 42, 0.14)"
  },
  motion: {
    quick: "120ms ease-out",
    standard: "180ms ease-out",
    emphasis: "240ms cubic-bezier(0.22, 1, 0.36, 1)"
  },
  zIndex: {
    base: 0,
    sticky: 20,
    overlay: 40,
    modal: 60,
    toast: 70
  },
  breakpoints: {
    mobile: "640px",
    tablet: "1024px",
    desktop: "1280px"
  }
});

const componentPurposeFromEvidence = (
  name: string,
  brief: string,
  synthesis: InspiredesignReferenceSynthesis,
  designVectors: InspiredesignDesignVectors
): string => {
  const componentName = name.toLowerCase();
  const briefSummary = summarizeBrief(brief);
  const evidenceCue = synthesis.summary;
  const sectionCue = designVectors.sectionArchitecture[0] ?? designVectors.surfaceIntent;
  if (componentName.includes("hero")) {
    return `Compose the hero around ${briefSummary}; use ${evidenceCue} and keep the primary booking, portfolio, or CTA path visible.`;
  }
  if (componentName.includes("button") || componentName.includes("cta")) {
    return `Define CTA and button states for ${briefSummary}; connect hover, focus, loading, and success feedback to the conversion path.`;
  }
  if (componentName.includes("card") || componentName.includes("feature") || componentName.includes("section")) {
    return `Turn ${sectionCue} into concrete proof, gallery, service, portfolio, or story sections backed by reference cues.`;
  }
  if (componentName.includes("footer")) {
    return `Close ${briefSummary} with location, booking recovery, portfolio navigation, contact, and proof links instead of a generic footer.`;
  }
  return `Adapt ${name.toLowerCase()} to ${briefSummary} using ${evidenceCue}.`;
};

const componentImplementationNoteFromEvidence = (
  name: string,
  designVectors: InspiredesignDesignVectors
): string => {
  const componentName = name.toLowerCase();
  if (componentName.includes("hero")) return designVectors.compositionModel[0] ?? designVectors.directionLabel;
  if (componentName.includes("button") || componentName.includes("cta")) {
    return designVectors.interactionMoments[0] ?? "Keep CTA state changes visible across pointer, keyboard, and loading states.";
  }
  if (componentName.includes("card") || componentName.includes("feature") || componentName.includes("section")) {
    return designVectors.imageryPosture[0] ?? designVectors.patternsToBorrow[0] ?? "Use reference-backed imagery and hierarchy.";
  }
  return designVectors.patternsToBorrow[0] ?? "Use reference-backed structure and semantic tokens.";
};

const buildComponentBuildPlan = (
  profile: CanvasVisualDirectionProfile,
  brief: string,
  synthesis: InspiredesignReferenceSynthesis,
  designVectors: InspiredesignDesignVectors
) => {
  const referenceFirstPublicLanding = isReferenceFirstPublicLanding(designVectors);
  return PROFILE_CONFIG[profile].componentSequence.map((name) => ({
    name,
    purpose: referenceFirstPublicLanding
      ? componentPurposeFromEvidence(name, brief, synthesis, designVectors)
      : `Establish the ${name.toLowerCase()} pattern as a reusable system primitive.`,
    states: ["default", "hover", "focus", "disabled"],
    implementationNote: referenceFirstPublicLanding
      ? componentImplementationNoteFromEvidence(name, designVectors)
      : "Use semantic tokens first and keep copy/state logic outside the visual component."
  }));
};

type BuildImplementationPlanInput = {
  brief: string;
  profile: CanvasVisualDirectionProfile;
  format: InspiredesignBriefFormat;
  references: InspiredesignReferenceEvidence[];
  attemptedReferenceCount: number;
  synthesis: InspiredesignReferenceSynthesis;
  designVectors: InspiredesignDesignVectors;
};

const buildImplementationPlan = ({
  brief,
  profile,
  format,
  references,
  attemptedReferenceCount,
  synthesis,
  designVectors
}: BuildImplementationPlanInput): InspiredesignImplementationPlan => ({
  architectureRecommendation: `Implement the surface as a ${format.archetype} using token-first components and shared semantic CSS variables, then compose page sections from those primitives before adding any page-specific polish.`,
  tokenStrategy: buildTokenStrategy(profile, designVectors),
  referenceImplementationNotes: synthesis.lines.length > 0
    ? synthesis.lines
    : ["No live reference cues were captured; keep implementation anchored to the source brief and selected prompt format."],
  componentBuildPlan: buildComponentBuildPlan(profile, brief, synthesis, designVectors),
  pageAssemblyPlan: [
    `Start with the ${format.layoutArchetype} and the primary navigation pattern.`,
    ...designVectors.sectionArchitecture,
    "Make each major section content-rich with a concrete headline, supporting copy, proof detail, and a clear role in the journey.",
    "Compose the hero or primary decision section before supporting sections.",
    "Add proof, utility, and footer sections only after the top-level hierarchy is stable."
  ],
  stateAndInteractionPlan: [
    `Use ${format.motionGrammar} while keeping hover, focus, loading, success, and error states visually distinct.`,
    ...designVectors.motionPosture,
    ...designVectors.interactionMoments,
    ...designVectors.materialEffects,
    ...designVectors.advancedMotionAdvisory,
    "Implement hero entrance reveal, section scroll reveal, and CTA/focus feedback as the minimum motion system for landing pages.",
    "Use @media (prefers-reduced-motion: reduce) to preserve hierarchy without motion.",
    "Preserve layout during loading and keep transient confirmations out of the main flow.",
    "Use reduced-motion-safe transitions for reveals and CTA feedback."
  ],
  accessibilityChecklist: [
    "Maintain 4.5:1 body text contrast across all surfaces.",
    "Preserve visible focus rings on every interactive element.",
    "Keep landmarks and heading levels explicit and sequential."
  ],
  responsiveChecklist: [
    ...format.responsiveCollapseRules,
    "Collapse multicolumn layouts before text measure becomes cramped.",
    "Keep the primary CTA visible without overlap on narrow screens.",
    "Avoid horizontal scrolling for primary content."
  ],
  risksAndAmbiguities: [
    attemptedReferenceCount === 0
      ? "No live references were supplied, so visual cues are derived entirely from the written brief."
      : synthesis.lines.length > 0
        ? "Live references were reduced into reusable patterns; unique brand assets should still be recreated, not copied."
        : "Reference URLs were attempted, but no usable creative evidence was captured; keep implementation anchored to the source brief and selected prompt format.",
    "Any missing interaction states must be validated during visual QA.",
    "Capture desktop and mobile browser proof before handoff, including reduced-motion behavior and primary CTA visibility."
  ],
  buildSequence: [
    "Define semantic tokens and typography.",
    "Build the shell, navigation, and primary CTA components.",
    "Implement section-level patterns and proof blocks.",
    "Add loading, empty, and error states.",
    "Capture desktop and mobile browser proof for responsive layout, reduced-motion behavior, focus states, and primary CTA visibility before final polish."
  ]
});

const formatBulletList = (items: string[]): string => items.map((item) => `- ${item}`).join("\n");

const renderAntiPatternRule = (rule: string): string => {
  const cleanRule = rule.replace(/\.$/, "").trim();
  const withoutNo = cleanRule.replace(/^no\s+/i, "");
  if (withoutNo !== cleanRule) return `Don't use ${withoutNo.charAt(0).toLowerCase()}${withoutNo.slice(1)}.`;
  const withoutDoNot = cleanRule.replace(/^do not\s+/i, "");
  if (withoutDoNot !== cleanRule) return `Don't ${withoutDoNot.charAt(0).toLowerCase()}${withoutDoNot.slice(1)}.`;
  return `Don't ${cleanRule.charAt(0).toLowerCase()}${cleanRule.slice(1)}.`;
};

const formatRecordList = (record: Record<string, string | number>): string => {
  return Object.entries(record).map(([key, value]) => `- \`${key}\`: ${value}`).join("\n");
};

const formatColorModeRecordList = (colors: InspiredesignColorModeTokens): string => [
  "### Light Theme",
  formatRecordList(colors.light),
  "",
  "### Dark Theme",
  formatRecordList(colors.dark)
].join("\n");

const referenceContribution = (reference: InspiredesignReferenceEvidence): string => {
  if (reference.captureStatus === "captured") return "Live hierarchy and component evidence captured from the page.";
  return "Content and structural cues inferred from fetched page data.";
};

const referenceMotionNote = (reference: InspiredesignReferenceEvidence): string => {
  if (reference.capture?.snapshot?.warnings?.length) {
    return `Capture warnings: ${reference.capture.snapshot.warnings.join(", ")}`;
  }
  if (reference.captureStatus === "captured") return "Motion should remain subtle until validated against the live capture.";
  return "Motion is inferred from the brief rather than directly observed.";
};

const referenceMediaObservation = (
  mediaReference: InspiredesignMediaAnalysisReference | undefined
): string => {
  if (!mediaReference) return "No trusted media-analysis entry is available for this source.";
  return summarizeMediaAnalysisReference(mediaReference);
};

const referenceTypographyObservation = (
  reference: InspiredesignReferenceEvidence,
  mediaReference: InspiredesignMediaAnalysisReference | undefined
): string => {
  if (mediaReference && hasMeasuredMediaAnalysisDesignFacts(mediaReference)) {
    return `${mediaReference.designGuidance.typographyPosture} Exact readable text was not extracted by v1 media analysis.`;
  }
  if (mediaReference) {
    return "Metadata-only media analysis did not extract typography structure; exact readable text was not extracted by v1 media analysis.";
  }
  return reference.title
    ? "Headline density and copy hierarchy were inferred from the fetched title and excerpt."
    : "Typography is inferred.";
};

const referenceColorObservation = (
  reference: InspiredesignReferenceEvidence,
  mediaReference: InspiredesignMediaAnalysisReference | undefined
): string => {
  if (mediaReference && hasMeasuredMediaAnalysisDesignFacts(mediaReference)) {
    const tokenNotes = mediaReference.designGuidance.tokenNotes.join(" ");
    return tokenNotes || mediaReference.designGuidance.imageryPosture;
  }
  if (mediaReference) {
    return "Metadata-only media analysis did not extract measured palette, tone, or theme facts.";
  }
  if (reference.captureStatus === "captured") {
    return "Color posture should be validated against the captured page before cloning brand treatment.";
  }
  return "Color posture remains a synthesis decision.";
};

const referenceLayoutObservationFromMedia = (
  reference: InspiredesignReferenceEvidence,
  excerpt: string,
  mediaReference: InspiredesignMediaAnalysisReference | undefined
): string => {
  if (mediaReference && hasMeasuredMediaAnalysisDesignFacts(mediaReference)) return mediaReference.designGuidance.layoutRecipe;
  if (mediaReference) {
    return "Metadata-only media analysis did not extract measured layout or hierarchy facts.";
  }
  return referenceLayoutObservation(reference, excerpt);
};

const referenceMotionObservation = (
  reference: InspiredesignReferenceEvidence,
  mediaReference: InspiredesignMediaAnalysisReference | undefined
): string => {
  if (mediaReference && hasMeasuredMediaAnalysisDesignFacts(mediaReference)) return mediaReference.designGuidance.motionPosture;
  if (mediaReference) {
    return "Metadata-only media analysis did not extract sampled motion facts.";
  }
  return referenceMotionNote(reference);
};

const referenceComponentPatterns = (
  reference: InspiredesignReferenceEvidence,
  mediaReference: InspiredesignMediaAnalysisReference | undefined
): string => {
  if (mediaReference && hasMeasuredMediaAnalysisDesignFacts(mediaReference)) return mediaReference.designGuidance.componentFamilies.join(", ");
  if (mediaReference) {
    return "Metadata-only media analysis did not extract measured component-family facts.";
  }
  if (reference.capture?.clone) {
    return "Buttons, cards, or layout wrappers can be inferred from the captured clone preview.";
  }
  return "Component families were inferred from available reference text.";
};

const PINTEREST_PIN_ID_PATTERN = /\/pin\/(\d+)\/?/i;
const GENERIC_SOURCE_TITLE_PATTERNS = [
  /^your profile$/i,
  /^home$/i,
  /skip to content/i,
  /settings & support/i,
  /^updates$/i,
  /^messages$/i,
  /\[r\d+\]\s+(?:link|button|combobox|textbox|option)\s+/i
] as const;

const isGenericSourceTitle = (value: string): boolean => (
  GENERIC_SOURCE_TITLE_PATTERNS.some((pattern) => pattern.test(value))
);

const renderReferenceTitle = (
  reference: InspiredesignReferenceEvidence,
  index: number,
  mediaReference: InspiredesignMediaAnalysisReference | undefined
): string => {
  const title = reference.title?.trim();
  if (title && !isGenericSourceTitle(title)) return title;
  const pinId = reference.url.match(PINTEREST_PIN_ID_PATTERN)?.[1];
  if (pinId) return `Pinterest pin ${pinId} media reference`;
  if (mediaReference) return `Saved ${mediaReference.kind} reference ${index + 1}`;
  return reference.url;
};

const referenceLayoutObservation = (
  reference: InspiredesignReferenceEvidence,
  excerpt: string
): string => {
  if (!reference.capture?.snapshot && !reference.capture?.clone && !reference.capture?.dom) return excerpt;
  const signals = getInspiredesignReferenceSignals(reference);
  return signals.find((signal) => signal !== reference.title) ?? signals[0] ?? excerpt;
};

const renderReferenceMarkdown = (
  reference: InspiredesignReferenceEvidence,
  index: number,
  mediaReference?: InspiredesignMediaAnalysisReference
): string => {
  const excerpt = reference.excerpt ? clipText(reference.excerpt, 220) : "No fetched excerpt captured.";
  const title = renderReferenceTitle(reference, index, mediaReference);
  return [
    `### Source ${index + 1}: ${title}`,
    `- what it contributes: ${referenceContribution(reference)}`,
    `- notable UI patterns: ${reference.capture?.snapshot ? "Primary hierarchy and actionables were captured from the live page." : "Patterns inferred from brief and fetched content."}`,
    `- media observations: ${referenceMediaObservation(mediaReference)}`,
    `- typography observations: ${referenceTypographyObservation(reference, mediaReference)}`,
    `- color and theme observations: ${referenceColorObservation(reference, mediaReference)}`,
    `- layout and hierarchy observations: ${referenceLayoutObservationFromMedia(reference, excerpt, mediaReference)}`,
    `- component patterns: ${referenceComponentPatterns(reference, mediaReference)}`,
    `- motion/interaction observations: ${referenceMotionObservation(reference, mediaReference)}`,
    `- accessibility/responsiveness notes: ${reference.captureStatus === "captured" ? "Validate focus order, CTA prominence, and stacked layouts during build QA." : "Accessibility and responsiveness are inferred from system defaults."}`,
    `- what should be adopted, adapted, or avoided: adopt layout hierarchy, adapt it to the new brand tokens, avoid copying proprietary copy or visual assets directly.`
  ].join("\n");
};

const renderInspirationAnalysis = (
  references: InspiredesignReferenceEvidence[],
  usableReferences: InspiredesignReferenceEvidence[],
  mediaAnalysis: InspiredesignMediaAnalysis
): string => {
  const mediaLookup = buildMediaAnalysisReferenceLookup(mediaAnalysis);
  if (usableReferences.length > 0) {
    return usableReferences
      .map((reference, index) => renderReferenceMarkdown(
        reference,
        index,
        getTrustedMediaAnalysisForDesignReference(reference, mediaAnalysisReferencesForDesignReference(reference, mediaLookup))
      ))
      .join("\n\n");
  }
  if (references.length > 0) {
    return "- Reference URLs were attempted, but no usable creative evidence was captured. See evidence.json for fetch/capture status.";
  }
  return "- No live inspiration source was provided. The system is derived entirely from the brief.";
};

const renderGovernanceMarkdown = (
  designContract: CanvasDesignGovernance,
  implementationPlan: InspiredesignImplementationPlan,
  format: InspiredesignBriefFormat
): string => {
  const generationPlan = designContract.generationPlan as CanvasGenerationPlan;
  const profileConfig = PROFILE_CONFIG[generationPlan.visualDirection.profile];
  return [
    "## 4.1 Design Intent",
    formatBulletList([
      `Purpose: ${(designContract.intent.task as string) || ""}`,
      "Capture the reusable visual logic from the references without cloning proprietary brand assets.",
      "Keep the resulting system executable for downstream build agents."
    ]),
    "",
    "## 4.2 Core UX Principles",
    formatBulletList(profileConfig.hierarchyPrinciples),
    "",
    "## 4.3 Visual Identity",
    formatBulletList([
      `Aesthetic style: ${profileConfig.visualPersonality}`,
      `Brand tone: ${profileConfig.brandTone}`,
      `Quality posture: ${profileConfig.direction}`,
      `Format archetype: ${format.archetype}`,
      `Surface treatment: ${format.surfaceTreatment}`,
      `Shape language: ${format.shapeLanguage}`,
      `Palette intent: ${format.paletteIntent}`,
      "Direction: modern, system-led, and implementation-aware."
    ]),
    "",
    "## 4.4 Color System",
    formatColorModeRecordList(implementationPlan.tokenStrategy.colors),
    "",
    "## 4.5 Typography System",
    [
      formatBulletList([`system: ${format.typographySystem}`]),
      formatRecordList(implementationPlan.tokenStrategy.typography)
    ].join("\n"),
    "",
    "## 4.6 Spacing and Layout System",
    [
      formatBulletList([
        `layout archetype: ${format.layoutArchetype}`,
        `layout approach: ${generationPlan.layoutStrategy.approach}`,
        `navigation model: ${generationPlan.layoutStrategy.navigationModel}`
      ]),
      formatRecordList(implementationPlan.tokenStrategy.spacing)
    ].join("\n"),
    "",
    "## 4.7 Shape, Border, and Elevation Rules",
    [
      formatRecordList(implementationPlan.tokenStrategy.radius),
      formatRecordList(implementationPlan.tokenStrategy.shadow)
    ].join("\n"),
    "",
    "## 4.8 Motion and Interaction Rules",
    [
      formatBulletList([`motion grammar: ${format.motionGrammar}`]),
      formatRecordList(implementationPlan.tokenStrategy.motion)
    ].join("\n"),
    "",
    "## 4.9 Component System",
    implementationPlan.componentBuildPlan.map((component) => [
      `### ${component.name}`,
      formatBulletList([
        `purpose: ${component.purpose}`,
        `structure: build from semantic tokens and keep state visuals explicit`,
        `visual style: ${profileConfig.direction}`,
        `states: ${component.states.join(", ")}`,
        "spacing: keep internal padding on the 8px rhythm",
        "accessibility notes: preserve focus visibility and keyboard parity",
        "responsive behavior: stack content before line length becomes cramped",
        `implementation notes: ${component.implementationNote}`
      ])
    ].join("\n")).join("\n\n"),
    "",
    "## 4.10 Page or Section Patterns",
    formatBulletList(profileConfig.pagePatterns),
    "",
    "## 4.11 Accessibility Requirements",
    formatBulletList(implementationPlan.accessibilityChecklist),
    "",
    "## 4.12 Responsiveness Requirements",
    formatBulletList(implementationPlan.responsiveChecklist),
    "",
    "## 4.13 Content and Microcopy Guidance",
    formatBulletList([
      "Use direct, confident labels and short CTA copy.",
      "Keep error and success messages specific to the affected region.",
      "Prefer descriptive button copy over generic verbs."
    ]),
    "",
    "## 4.14 Do / Don't Rules",
    formatBulletList([
      "Do preserve one dominant message per section.",
      "Do encode repeated visual rules into semantic tokens.",
      "Don't copy proprietary logos, screenshots, or brand-only illustrations.",
      "Don't hide important actions inside ambiguous hover-only affordances.",
      ...format.antiPatterns.map(renderAntiPatternRule)
    ]),
    "",
    "## 4.15 Acceptance Criteria",
    formatBulletList([
      "Primary action is obvious within one viewport.",
      "Color, typography, spacing, and elevation all resolve through named tokens.",
      "Keyboard, focus, and reduced-motion behavior remain intact across breakpoints."
    ])
  ].join("\n");
};

const renderImplementationMarkdown = (implementationPlan: InspiredesignImplementationPlan): string => {
  return [
    "# 5. Implementation Plan",
    "",
    "## 5.1 Architecture Recommendation",
    implementationPlan.architectureRecommendation,
    "",
    "## 5.2 Design Token Strategy",
    formatColorModeRecordList(implementationPlan.tokenStrategy.colors),
    "",
    formatRecordList(implementationPlan.tokenStrategy.typography),
    "",
    "## 5.3 Reference Implementation Notes",
    formatBulletList(implementationPlan.referenceImplementationNotes),
    "",
    "## 5.4 Component Build Plan",
    implementationPlan.componentBuildPlan.map((component, index) => (
      `${index + 1}. ${component.name}: ${component.purpose}`
    )).join("\n"),
    "",
    "## 5.5 Page Assembly Plan",
    formatBulletList(implementationPlan.pageAssemblyPlan),
    "",
    "## 5.6 State and Interaction Plan",
    formatBulletList(implementationPlan.stateAndInteractionPlan),
    "",
    "## 5.7 Accessibility Implementation Checklist",
    formatBulletList(implementationPlan.accessibilityChecklist),
    "",
    "## 5.8 Responsive Implementation Checklist",
    formatBulletList(implementationPlan.responsiveChecklist),
    "",
    "## 5.9 Risks and Ambiguities",
    formatBulletList(implementationPlan.risksAndAmbiguities),
    "",
    "## 5.10 Recommended Build Sequence",
    implementationPlan.buildSequence.map((step, index) => `${index + 1}. ${step}`).join("\n")
  ].join("\n");
};

const renderTargetAnalysisGuidance = (targetAnalysis: InspiredesignTargetAnalysis): string => {
  const targetGuidance = [
    ...(targetAnalysis.page?.implementationNotes ?? []),
    ...(targetAnalysis.component?.prototypeGuidance ?? []),
    ...(targetAnalysis.asset?.prototypeGuidance ?? [])
  ];
  return [
    "## 6.3 Target Analysis",
    formatBulletList([
      `primary target: ${targetAnalysis.primaryKind}`,
      `target kinds: ${targetAnalysis.kinds.join(", ")}`,
      `confidence: ${targetAnalysis.confidence.toFixed(2)}`,
      `triggering signals: ${targetAnalysis.triggeringSignals.join("; ")}`,
      ...targetGuidance,
      `anatomy: ${targetAnalysis.evidenceBuckets.anatomy.join(" ")}`,
      `props/slots: ${targetAnalysis.evidenceBuckets.propsSlots.join(" ")}`,
      `state matrix: ${targetAnalysis.evidenceBuckets.stateMatrix.join(" ")}`,
      `tokens: ${targetAnalysis.evidenceBuckets.tokens.join(" ")}`,
      `assets: ${targetAnalysis.evidenceBuckets.assets.join(" ")}`,
      `accessibility: ${targetAnalysis.evidenceBuckets.accessibility.join(" ")}`,
      `motion: ${targetAnalysis.evidenceBuckets.motion.join(" ")}`,
      `preview fixtures: ${targetAnalysis.evidenceBuckets.previewFixtures.join(" ")}`
    ])
  ].join("\n");
};

const renderPrototypeGuidance = (
  profile: CanvasVisualDirectionProfile,
  synthesis: InspiredesignReferenceSynthesis,
  designVectors: InspiredesignDesignVectors,
  targetAnalysis: InspiredesignTargetAnalysis
): string => {
  return [
    "# 6. Optional Prototype Plan",
    "",
    "## 6.1 Reference Anchors",
    formatBulletList(synthesis.lines.length > 0 ? synthesis.lines : ["No live reference cues were captured."]),
    "",
    "## 6.2 Prototype Structure",
    "- page structure: for public landing pages, build 8 to 12 content-rich sections unless the brief explicitly asks for a microsite.",
    `- section architecture: ${designVectors.sectionArchitecture.join(" ")}`,
    `- section order: ${PROFILE_CONFIG[profile].pagePatterns.join(" -> ")}`,
    "- component composition: reuse button, card, input, and navigation primitives before page-specific wrappers.",
    `- interaction expectations: ${designVectors.interactionMoments.join(" ")}`,
    `- motion expectations: ${designVectors.motionPosture.join(" ")}`,
    `- material and depth expectations: ${designVectors.materialEffects.join(" ")}`,
    `- advisory advanced motion: ${designVectors.advancedMotionAdvisory.join(" ")}`,
    "",
    renderTargetAnalysisGuidance(targetAnalysis),
    "",
    "- browser proof: capture desktop and mobile browser screenshots, verify reduced-motion behavior, inspect focus states, and confirm the primary CTA remains visible without overlap.",
    "- HTML skeleton guidance: start with one main landmark, one primary CTA group, and semantic sections that follow the design vector section architecture instead of fixed industry-specific defaults.",
    "- styling approach: define CSS variables for timing, easing, elevation, translucency, backdrop blur, cursor effects, hover effects, and parallax distance before mapping components to semantic tokens.",
    "- first prototype should include vs omit: include shell, primary hero or decision section, CTA group, proof or detail sections, section patterns named in the design vectors, final CTA, and footer; omit analytics, app-shell widgets, empty card grids, and any section not supported by the brief or reference evidence."
  ].join("\n");
};

const renderDeliverablesSummary = (includePrototypeGuidance: boolean, canvasContinuationReady: boolean): string => {
  const deliverables = [
    "Structured `designContract` JSON aligned to canvas governance",
    "Valid `generationPlan` JSON aligned to the canvas generation plan contract",
    canvasContinuationReady
      ? "Ready-to-fill `canvasPlanRequest` JSON for `canvas.plan.set`"
      : "Diagnostic `canvasPlanRequest` preview; do not submit to Canvas until next-step guidance is ready",
    "Design-agent handoff JSON with contract scope, skill nudges, and richer implementation context",
    "Human-readable `design.md` design specification",
    "Engineering implementation plan in JSON and Markdown"
  ];
  if (includePrototypeGuidance) {
    deliverables.push("Prototype guidance Markdown for the first HTML pass");
  }
  deliverables.push("Evidence digest describing brief, references, fetch outcomes, and capture outcomes");
  return formatBulletList(deliverables);
};

type BuildEvidencePayloadInput = {
  brief: string;
  briefExpansion: InspiredesignBriefExpansion;
  advancedBriefMarkdown: string;
  urls: string[];
  references: InspiredesignReferenceEvidence[];
  mediaAnalysis: InspiredesignMediaAnalysis;
  referencePatternBoard: InspiredesignReferencePatternBoard;
  designVectors: InspiredesignDesignVectors;
  targetAnalysis: InspiredesignTargetAnalysis;
};

const buildMediaAnalysisEvidenceCitation = (
  mediaAnalysis: InspiredesignMediaAnalysis
): JsonRecord => {
  const analyzedReferences: JsonValue[] = mediaAnalysis.references.map((reference) => ({
    referenceId: reference.referenceId,
    mediaPath: reference.mediaPath,
    authority: reference.authority,
    claimLevels: [...reference.claimLevels],
    confidence: reference.confidence,
    limitationsCount: reference.limitations.length
  }));
  return {
    file: INSPIREDESIGN_MEDIA_ANALYSIS_ARTIFACT_FILE,
    version: mediaAnalysis.version,
    generatedAt: mediaAnalysis.generatedAt,
    referenceCount: mediaAnalysis.references.length,
    analyzedReferences,
    limitationCount: mediaAnalysis.references.reduce((count, reference) => count + reference.limitations.length, 0),
    nonGoals: [...mediaAnalysis.nonGoals]
  };
};

const buildEvidencePayload = ({
  brief,
  briefExpansion,
  advancedBriefMarkdown,
  urls,
  references,
  mediaAnalysis,
  referencePatternBoard,
  designVectors,
  targetAnalysis
}: BuildEvidencePayloadInput): JsonRecord => ({
  brief,
  briefHash: referenceFingerprint(brief),
  advancedBrief: advancedBriefMarkdown,
  advancedBriefHash: referenceFingerprint(advancedBriefMarkdown),
  briefExpansion: {
    templateVersion: briefExpansion.templateVersion,
    format: cloneInspiredesignBriefFormat(briefExpansion.format)
  },
  urls,
  referenceCount: references.length,
  references: references.map((reference) => toReferenceEvidenceJson(reference)),
  mediaAnalysis: buildMediaAnalysisEvidenceCitation(mediaAnalysis),
  referencePatternBoard: referencePatternBoard as JsonRecord,
  rankedReferences: referencePatternBoard.references as unknown as JsonValue,
  designVectors: designVectors as JsonRecord,
  targetAnalysis: targetAnalysis as JsonRecord,
  visualEvidence: buildVisualEvidencePayload(references) as unknown as JsonValue,
  screenshotIndex: buildScreenshotIndex(references) as unknown as JsonValue,
  motionEvidence: buildMotionEvidencePayload(references) as unknown as JsonValue,
  pinMediaEvidence: buildPinMediaEvidencePayload(references) as unknown as JsonValue,
  pinMediaIndex: buildPinMediaIndex(references) as unknown as JsonValue
});

const buildVisualEvidencePayload = (
  references: InspiredesignReferenceEvidence[]
): InspiredesignVisualEvidenceJson[] => references.flatMap((reference) => {
  const visual = normalizeInspiredesignCaptureEvidence(reference.capture)?.visual;
  return visual ? [{
    referenceId: reference.id,
    url: reference.url,
    visual: persistInspiredesignVisualEvidence(visual)
  }] : [];
});

const buildScreenshotIndex = (
  references: InspiredesignReferenceEvidence[]
): InspiredesignScreenshotIndexEntry[] => buildVisualEvidencePayload(references)
  .filter((entry): entry is InspiredesignVisualEvidenceJson & {
    visual: InspiredesignPersistedVisualEvidence & { path: string; sha256: string; bytes: number };
  } => (
    entry.visual.status === "captured"
    && typeof entry.visual.path === "string"
    && typeof entry.visual.sha256 === "string"
    && typeof entry.visual.bytes === "number"
  ))
  .map((entry) => ({
    referenceId: entry.referenceId,
    url: entry.url,
    ...(entry.visual.sourceUrl ? { sourceUrl: entry.visual.sourceUrl } : {}),
    ...(entry.visual.pinterestPageQuality ? { pinterestPageQuality: entry.visual.pinterestPageQuality } : {}),
    path: entry.visual.path,
    sha256: entry.visual.sha256,
    bytes: entry.visual.bytes,
    kind: entry.visual.kind,
    fullPage: entry.visual.fullPage,
    capturedAt: entry.visual.capturedAt,
    warnings: entry.visual.warnings,
    ...(entry.visual.failure ? { failure: entry.visual.failure } : {})
  }));

const buildMotionEvidencePayload = (
  references: InspiredesignReferenceEvidence[]
): InspiredesignMotionEvidenceJson[] => references.flatMap((reference) => {
  const motion = normalizeInspiredesignCaptureEvidence(reference.capture)?.motion;
  return motion ? [{
    referenceId: reference.id,
    url: reference.url,
    motion: persistInspiredesignMotionEvidence(motion)
  }] : [];
});

const buildPinMediaEvidencePayload = (
  references: InspiredesignReferenceEvidence[]
): InspiredesignPinMediaEvidenceJson[] => references.flatMap((reference) => {
  const pinMedia = normalizeInspiredesignCaptureEvidence(reference.capture)?.pinMedia;
  return pinMedia ? [{
    referenceId: reference.id,
    url: reference.url,
    pinMedia: persistPinMediaEvidenceForArtifact(pinMedia)
  }] : [];
});

const persistPinMediaEvidenceForArtifact = (
  pinMedia: InspiredesignPinterestPinMediaRuntimeMetadata | InspiredesignPersistedPinterestPinMediaEvidence
): InspiredesignPersistedPinterestPinMediaEvidence => (
  redactDiagnosticPinterestPinMediaEvidence(persistInspiredesignPinterestPinMediaEvidence(pinMedia))
);

const buildPinMediaIndex = (
  references: InspiredesignReferenceEvidence[]
): InspiredesignPinterestPinMediaIndexEntry[] => buildPinMediaEvidencePayload(references)
  .map((entry) => buildInspiredesignPinterestPinMediaIndexEntry(entry.pinMedia))
  .filter((entry): entry is InspiredesignPinterestPinMediaIndexEntry => Boolean(entry));

const toCaptureEvidenceJson = (reference: InspiredesignReferenceEvidence): JsonValue => {
  const normalized = normalizeInspiredesignCaptureEvidence(reference.capture);
  if (!normalized) return null;
  const signals = getInspiredesignReferenceSignals(reference);
  const pinMedia = normalized.pinMedia ? persistPinMediaEvidenceForArtifact(normalized.pinMedia) : undefined;
  return {
    ...(normalized.title ? { title: normalized.title } : {}),
    ...(signals.length > 0 ? { signals } : {}),
    ...(normalized.visual ? { visual: normalized.visual as JsonRecord } : {}),
    ...(normalized.motion ? { motion: normalized.motion as JsonRecord } : {}),
    ...(pinMedia ? { pinMedia: pinMedia as JsonRecord } : {}),
    ...(normalized.attempts ? { attempts: normalized.attempts } : {})
  };
};

const cleanReferenceExcerptForEvidence = (reference: InspiredesignReferenceEvidence): string | undefined => {
  if (!reference.excerpt) return undefined;
  const [excerptSignal] = getInspiredesignReferenceSignals({
    ...reference,
    title: undefined,
    capture: null
  });
  return excerptSignal;
};

const toReferenceEvidenceJson = (reference: InspiredesignReferenceEvidence): JsonValue => {
  const excerpt = cleanReferenceExcerptForEvidence(reference);
  return {
    id: reference.id,
    url: reference.url,
    ...(reference.title ? { title: reference.title } : {}),
    ...(excerpt ? { excerpt } : {}),
    fetchStatus: reference.fetchStatus,
    captureStatus: reference.captureStatus,
    ...(reference.fetchFailure ? { fetchFailure: reference.fetchFailure } : {}),
    ...(reference.captureFailure ? { captureFailure: reference.captureFailure } : {}),
    capture: toCaptureEvidenceJson(reference)
  };
};

export const buildInspiredesignPacket = (input: BuildInspiredesignPacketInput): InspiredesignPacket => {
  const brief = trimText(input.brief);
  const selectedFormat = cloneInspiredesignBriefFormat(input.briefExpansion.format);
  const includePrototypeGuidance = input.includePrototypeGuidance ?? false;
  const urls = [...new Set(input.urls.map((url) => trimText(url)).filter(Boolean))];
  const references = input.references.map((reference) => ({
    ...reference,
    title: reference.title ? trimText(reference.title) : undefined,
    excerpt: reference.excerpt ? trimText(reference.excerpt) : undefined
  }));
  const referenceEvidenceRequired = input.referenceEvidenceRequired ?? (urls.length > 0 || references.length > 0);
  const mediaAnalysis = input.mediaAnalysis ?? buildEmptyInspiredesignMediaAnalysis();
  const pinMediaIndex = buildPinMediaIndex(references);
  const referencePatternBoard = buildInspiredesignReferencePatternBoard(
    referenceFingerprint(brief),
    selectedFormat,
    references,
    brief,
    mediaAnalysis,
    pinMediaIndex
  );
  const readyReferenceKeys = new Set(
    referencePatternBoard.references.filter(isInspiredesignDesignReference).map((reference) => (
      `${reference.id}\u0000${reference.url}\u0000${reference.mediaArtifactPath ?? ""}`
    ))
  );
  const usableReferences = references
    .filter((reference) => hasInspiredesignUsableReferenceEvidence(reference, pinMediaIndex))
    .filter((reference) => readyReferenceKeys.has(
      `${reference.id}\u0000${reference.url}\u0000${persistedPinMediaPathForReference(reference) ?? ""}`
    ));
  const synthesis = buildReferenceSynthesis(usableReferences, pinMediaIndex);
  const designVectors = buildInspiredesignDesignVectors(selectedFormat, referencePatternBoard);
  const designReferencePatternBoard = buildInspiredesignDesignReferencePatternBoard(referencePatternBoard, designVectors);
  const effectiveFormat = buildEvidenceDerivedFormat(selectedFormat, designVectors);
  const targetAnalysis = buildTargetAnalysis(
    brief,
    effectiveFormat,
    usableReferences,
    synthesis,
    designVectors
  );
  const effectiveBriefExpansion: InspiredesignBriefExpansion = {
    ...input.briefExpansion,
    advancedBrief: isReferenceFirstPublicLanding(designVectors)
      ? renderEvidenceDerivedAdvancedBrief(input.briefExpansion, effectiveFormat)
      : input.briefExpansion.advancedBrief,
    format: effectiveFormat
  };
  const metaPromptMarkdown = buildInspiredesignMetaPrompt({
    brief,
    briefExpansion: effectiveBriefExpansion,
    referencePatternBoard,
    designVectors
  });
  const advancedBriefMarkdown = renderReferenceFirstAdvancedBrief(
    effectiveBriefExpansion,
    designReferencePatternBoard,
    designVectors,
    references
  );
  const generationPlan = buildGenerationPlan({
    brief,
    format: effectiveFormat,
    synthesis,
    referencePatternBoard: designReferencePatternBoard,
    designVectors,
    targetAnalysis
  });
  const profile = generationPlan.visualDirection.profile;
  const canvasPlanRequest = buildCanvasPlanRequest(brief, generationPlan);
  const designContract = buildDesignContract({
    brief,
    designReferences: usableReferences,
    plan: generationPlan,
    format: effectiveFormat
  });
  const implementationPlan = buildImplementationPlan({
    brief,
    profile,
    format: effectiveFormat,
    references: usableReferences,
    attemptedReferenceCount: references.length,
    synthesis,
    designVectors
  });
  const followthrough = buildFollowthrough({
    generationPlan,
    briefExpansion: effectiveBriefExpansion,
    synthesis,
    includePrototypeGuidance,
    implementationPlan,
    referencePatternBoard: designReferencePatternBoard,
    designVectors,
    targetAnalysis
  });
  const governanceMarkdown = renderGovernanceMarkdown(designContract, implementationPlan, effectiveFormat);
  const implementationPlanMarkdown = renderImplementationMarkdown(implementationPlan);
  const prototypeGuidanceMarkdown = includePrototypeGuidance
    ? renderPrototypeGuidance(profile, synthesis, designVectors, targetAnalysis)
    : null;
  const designMarkdown = [
    "# 1. Executive Summary",
    "",
    formatBulletList([
      `Analyzed brief plus ${references.length || 0} inspiration reference(s).`,
      `Chosen design direction: ${designVectors.surfaceIntent}.`,
      `Route profile: ${PROFILE_CONFIG[profile].direction}.`,
      `Prompt format: ${effectiveFormat.label} (${input.briefExpansion.templateVersion}).`,
      "Final outcome: a reusable design contract, engineering plan, and optional prototype guidance.",
      `Scope mode: ${references.length > 1 ? "full-site synthesis" : "single-surface synthesis"}.`
    ]),
    "",
    "# 2. Inspiration Analysis",
    "",
    renderInspirationAnalysis(references, usableReferences, mediaAnalysis),
    "",
    "# 3. Unified Design Direction",
    "",
    "## 3.1 Reference-Specific Build Rules",
    "",
    formatBulletList(synthesis.lines.length > 0 ? synthesis.lines : ["No live reference cues were captured."]),
    "",
    "## 3.2 Reference Pattern Board",
    "",
    formatBulletList(designVectors.patternsToBorrow.length > 0
      ? designVectors.patternsToBorrow
      : ["No live reference cues were captured."]),
    "",
    "## 3.3 Design Vectors",
    "",
    formatBulletList([
      `source priority: ${designVectors.sourcePriority}`,
      `direction: ${designVectors.directionLabel}`,
      `premium posture: ${designVectors.premiumPosture.join(" ")}`,
      `motion posture: ${designVectors.motionPosture.join(" ")}`,
      `section architecture: ${designVectors.sectionArchitecture.join(" ")}`,
      `composition: ${designVectors.compositionModel.join(" ")}`,
      `typography posture: ${designVectors.typographyPosture.join(" ")}`,
      `imagery posture: ${designVectors.imageryPosture.join(" ")}`,
      `interaction moments: ${designVectors.interactionMoments.join(" ")}`,
      `material effects: ${designVectors.materialEffects.join(" ")}`,
      `advanced motion advisory: ${designVectors.advancedMotionAdvisory.join(" ")}`
    ]),
    "",
    "## 3.4 System Direction",
    "",
    formatBulletList([
      `visual personality: ${PROFILE_CONFIG[profile].visualPersonality}`,
      `tone: ${PROFILE_CONFIG[profile].brandTone}`,
      `layout archetype: ${effectiveFormat.layoutArchetype}`,
      `typography system: ${effectiveFormat.typographySystem}`,
      `motion grammar: ${effectiveFormat.motionGrammar}`,
      `UX principles: ${PROFILE_CONFIG[profile].hierarchyPrinciples.join(" ")}`,
      `interaction philosophy: ${PROFILE_CONFIG[profile].interactionPhilosophy}`,
      "branding posture: preserve the intent of the references without cloning brand-only assets.",
      "system coherence rules: encode tokens first, keep one dominant idea per section, and keep states explicit."
    ]),
    "",
    "# 4. Design Governance (`design.md`)",
    "",
    governanceMarkdown,
    "",
    renderImplementationMarkdown(implementationPlan),
    "",
    prototypeGuidanceMarkdown ?? "# 6. Optional Prototype Plan\n\n- Prototype guidance omitted for this run.",
    "",
    "# 7. Deliverables Summary",
    "",
	    renderDeliverablesSummary(
	      Boolean(input.includePrototypeGuidance),
	      false
	    )
	  ].join("\n");

  const visualEvidence = buildVisualEvidencePayload(references);
  const screenshotIndex = buildScreenshotIndex(references);
  const motionEvidence = buildMotionEvidencePayload(references);
  const pinMediaEvidence = buildPinMediaEvidencePayload(references);
  return {
    advancedBriefMarkdown,
    designContract,
    generationPlan,
    canvasPlanRequest,
    followthrough,
    designMarkdown,
    implementationPlan,
    implementationPlanMarkdown,
    prototypeGuidanceMarkdown,
    visualEvidence,
    screenshotIndex,
    motionEvidence,
    pinMediaEvidence,
    pinMediaIndex,
    mediaAnalysis,
    rankedReferences: designReferencePatternBoard.references,
    referencePatternBoard,
    metaPromptMarkdown,
    evidence: buildEvidencePayload({
      brief,
      briefExpansion: effectiveBriefExpansion,
      advancedBriefMarkdown,
      urls,
      references,
      mediaAnalysis,
      referencePatternBoard: designReferencePatternBoard,
      designVectors,
      targetAnalysis
    })
  };
};
