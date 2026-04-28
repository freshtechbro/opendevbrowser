import { createHash } from "crypto";
import generationPlanTemplateJson from "../../skills/opendevbrowser-design-agent/assets/templates/canvas-generation-plan.design.v1.json";
import designContractTemplateJson from "../../skills/opendevbrowser-design-agent/assets/templates/design-contract.v1.json";
import type {
  CanvasDesignGovernance,
  CanvasGenerationPlan,
  CanvasNavigationModel,
  CanvasVisualDirectionProfile
} from "../canvas/types";
import {
  INSPIREDESIGN_HANDOFF_COMMANDS,
  INSPIREDESIGN_HANDOFF_GUIDANCE,
  INSPIREDESIGN_HANDOFF_RECOMMENDED_SKILLS,
  INSPIREDESIGN_HANDOFF_FILES,
  buildInspiredesignFollowthroughSummary,
  buildInspiredesignNextStep
} from "../inspiredesign/handoff";
import {
  cloneInspiredesignBriefFormat,
  type InspiredesignBriefExpansion,
  type InspiredesignBriefFormat
} from "../inspiredesign/brief-expansion";
import {
  buildInspiredesignDesignVectors,
  buildInspiredesignReferencePatternBoard,
  getInspiredesignReferenceSignals,
  hasInspiredesignUsableReferenceEvidence,
  type InspiredesignDesignVectors,
  type InspiredesignReferencePatternBoard
} from "../inspiredesign/reference-pattern-board";
import type { JsonValue } from "./types";

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
  colors: Record<string, string>;
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
    ...(hasUsableInspiredesignClone(capture) && capture.clone ? { clone: capture.clone } : {})
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
  colors: Record<string, string>;
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
  interactionMoments: string[];
  materialEffects: string[];
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
  referenceSynthesis: JsonRecord;
  referencePatternBoard: InspiredesignReferencePatternBoard;
  designVectors: InspiredesignDesignVectors;
};

export type InspiredesignFollowthrough = {
  summary: string;
  nextStep: string;
  briefExpansion: {
    templateVersion: string;
    file: string;
    format: InspiredesignBriefFormat;
  };
  recommendedSkills: string[];
  commandExamples: {
    loadBestPractices: string;
    loadDesignAgent: string;
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
  includePrototypeGuidance?: boolean;
};

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
  references: InspiredesignReferenceEvidence[]
): InspiredesignReferenceSynthesis => {
  const lines = references
    .filter(hasInspiredesignUsableReferenceEvidence)
    .map((reference, index) => {
      const signals = getInspiredesignReferenceSignals(reference);
      if (signals.length === 0) return "";
      return `Source ${index + 1} ${reference.title ?? reference.url}: ${signals.join(" | ")}`;
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
  if (board.references.length === 0) {
    if (references.length > 0) {
      return [
        "Reference evidence unavailable:",
        "URL references were attempted, but no usable creative evidence was captured. Treat this as a capture gap, not a design direction.",
        "",
        formatBulletList(references.map((reference) => renderUnavailableReference(reference))),
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
      `materialEffects: ${vectors.materialEffects.join(" ")}`
    ]),
    "",
    "Fixed format guardrails:",
    "Selected prompt format supplies route defaults and guardrails, not the creative source of truth.",
    "",
    briefExpansion.advancedBrief
  ].join("\n");
};

const renderUnavailableReference = (reference: InspiredesignReferenceEvidence): string => {
  const reason = reference.fetchFailure ?? reference.captureFailure ?? "no usable creative evidence captured";
  return `${reference.url}: fetch=${reference.fetchStatus}, capture=${reference.captureStatus}, reason=${clipText(reason, 160)}`;
};

const cloneTemplate = <T>(value: T): T => structuredClone(value);

const referenceFingerprint = (value: string): string => {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
};

const summarizeBrief = (brief: string): string => {
  const normalized = trimText(brief);
  const sentence = normalized.split(/[.!?]/).map((part) => part.trim()).find(Boolean);
  return clipText(sentence ?? normalized, 140);
};

const buildSupportingMessages = (references: InspiredesignReferenceEvidence[]): string[] => {
  const messages = references
    .map((reference) => reference.title ?? reference.excerpt ?? "")
    .map((value) => clipText(trimText(value), 72))
    .filter((value) => value.length > 0);
  return messages.slice(0, 3);
};

const summarizeDesignVectors = (designVectors: InspiredesignDesignVectors): string => [
  `direction: ${designVectors.directionLabel}`,
  `sections: ${designVectors.sectionArchitecture.join(" ")}`,
  `motion: ${designVectors.motionPosture.slice(0, 1).join(" ")}`,
  `interactions: ${designVectors.interactionMoments.slice(0, 1).join(" ")}`,
  `materials: ${designVectors.materialEffects.slice(0, 1).join(" ")}`
].join(" ");

const isReferenceFirstPublicLanding = (designVectors: InspiredesignDesignVectors): boolean => {
  return designVectors.sourcePriority === "reference-evidence-first"
    && designVectors.surfaceIntent.toLowerCase().includes("public landing page");
};

const buildEvidenceDerivedFormat = (
  format: InspiredesignBriefFormat,
  designVectors: InspiredesignDesignVectors
): InspiredesignBriefFormat => {
  const clone = cloneInspiredesignBriefFormat(format);
  if (!isReferenceFirstPublicLanding(designVectors)) return clone;
  return {
    ...clone,
    archetype: "reference-led public landing page",
    layoutArchetype: "full-bleed hero with narrative section cadence",
    componentGrammar: "hero composition, proof bands, narrative pathways, service or story sections, conversion CTA, and footer",
    route: {
      ...clone.route,
      profile: "product-story",
      navigationModel: "global-header",
      layoutApproach: "reference-led-landing-page"
    }
  };
};

type BuildGenerationPlanInput = {
  brief: string;
  format: InspiredesignBriefFormat;
  synthesis: InspiredesignReferenceSynthesis;
  referencePatternBoard: InspiredesignReferencePatternBoard;
  designVectors: InspiredesignDesignVectors;
};

const buildGenerationPlan = ({
  brief,
  format,
  synthesis,
  referencePatternBoard,
  designVectors
}: BuildGenerationPlanInput): InspiredesignGenerationPlan => {
  const plan = cloneTemplate(BASE_GENERATION_PLAN);
  const profile = format.route.profile;
  const vectorSummary = summarizeDesignVectors(designVectors);
  plan.targetOutcome.summary = clipText(
    `${summarizeBrief(brief)} Reference cues: ${synthesis.summary} ${vectorSummary}`,
    GENERATION_PLAN_REFERENCE_CLIP_LENGTH
  );
  plan.visualDirection.profile = profile;
  plan.visualDirection.themeStrategy = format.route.themeStrategy;
  plan.layoutStrategy.approach = format.route.layoutApproach;
  plan.layoutStrategy.navigationModel = format.route.navigationModel;
  plan.contentStrategy.source = clipText(
    `${INSPIREDESIGN_HANDOFF_FILES.evidence}, ${INSPIREDESIGN_HANDOFF_FILES.advancedBrief}, ${INSPIREDESIGN_HANDOFF_FILES.designMarkdown}. Use reference pattern board and design vectors from evidence/handoff artifacts. ${synthesis.summary} ${vectorSummary}`,
    GENERATION_PLAN_REFERENCE_CLIP_LENGTH
  );
  plan.componentStrategy.mode = clipText(
    `reuse-first, adapted from captured references: ${synthesis.summary}. Include hero entrance reveal, section scroll reveal, CTA/focus feedback, microinteractions, hover effects, evidence-gated cursor effects, material depth, parallax constraints, glass/translucency policy, and prefers-reduced-motion behavior. Capture desktop and mobile browser proof for responsive layout, reduced-motion behavior, focus states, and primary CTA visibility.`,
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
  format: InspiredesignBriefFormat
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
    designVariance: format.designVariance
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
  plan: CanvasGenerationPlan,
  format: InspiredesignBriefFormat
): JsonRecord => {
  const block = cloneTemplate(BASE_CONTRACT_TEMPLATE.layoutSystem);
  return {
    ...block,
    layoutArchetype: format.layoutArchetype,
    layoutApproach: plan.layoutStrategy.approach,
    navigationModel: plan.layoutStrategy.navigationModel,
    pagePatterns: [format.layoutArchetype, ...PROFILE_CONFIG[plan.visualDirection.profile].pagePatterns]
  };
};

const buildTypographySystemBlock = (format: InspiredesignBriefFormat): JsonRecord => {
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
    }
  };
};

const buildColorSystemBlock = (
  profile: CanvasVisualDirectionProfile,
  format: InspiredesignBriefFormat
): JsonRecord => {
  const colors = PROFILE_CONFIG[profile].colors;
  return {
    paletteName: `${format.id}-default`,
    paletteIntent: format.paletteIntent,
    tokens: colors,
    contrastRequirements: {
      bodyText: "4.5:1",
      largeText: "3:1",
      focusRing: "3:1"
    }
  };
};

const buildSurfaceSystemBlock = (format: InspiredesignBriefFormat): JsonRecord => ({
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
  }
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
  motion: ["css"],
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

const toCanvasGenerationPlan = (plan: InspiredesignGenerationPlan): CanvasPlanRequestTemplate["generationPlan"] => cloneTemplate({
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
  referencePatternBoard: InspiredesignReferencePatternBoard;
  designVectors: InspiredesignDesignVectors;
};

const buildFollowthrough = ({
  generationPlan,
  briefExpansion,
  synthesis,
  includePrototypeGuidance,
  referencePatternBoard,
  designVectors
}: BuildFollowthroughInput): InspiredesignFollowthrough => ({
  summary: buildInspiredesignFollowthroughSummary(),
  nextStep: buildInspiredesignNextStep(),
  briefExpansion: buildBriefExpansionMetadata(briefExpansion),
  recommendedSkills: [...INSPIREDESIGN_HANDOFF_RECOMMENDED_SKILLS],
  commandExamples: { ...INSPIREDESIGN_HANDOFF_COMMANDS },
  deepCaptureRecommendation: INSPIREDESIGN_HANDOFF_GUIDANCE.deepCaptureRecommendation,
  contractScope: buildContractScope(),
  implementationContext: {
    navigationModel: buildNavigationModelBlock(generationPlan.layoutStrategy.navigationModel),
    asyncModel: buildAsyncModelBlock(),
    performanceModel: buildPerformanceModelBlock(),
    referenceSynthesis: {
      requiredArtifacts: buildRequiredReferenceArtifacts(includePrototypeGuidance),
      cues: synthesis.lines
    },
    referencePatternBoard,
    designVectors
  }
});

type BuildDesignContractInput = {
  brief: string;
  urls: string[];
  references: InspiredesignReferenceEvidence[];
  plan: InspiredesignGenerationPlan;
  format: InspiredesignBriefFormat;
};

const buildDesignContract = ({
  brief,
  urls,
  references,
  plan,
  format
}: BuildDesignContractInput): CanvasDesignGovernance => ({
  intent: buildIntentBlock(brief, urls, references, format),
  generationPlan: toCanvasGenerationPlan(plan),
  designLanguage: buildDesignLanguageBlock(plan.visualDirection.profile, format),
  contentModel: buildContentModelBlock(brief, references.filter(hasInspiredesignUsableReferenceEvidence)),
  layoutSystem: buildLayoutSystemBlock(plan, format),
  typographySystem: buildTypographySystemBlock(format),
  colorSystem: buildColorSystemBlock(plan.visualDirection.profile, format),
  surfaceSystem: buildSurfaceSystemBlock(format),
  iconSystem: buildIconSystemBlock(),
  motionSystem: buildMotionSystemBlock(format, plan.designVectors),
  responsiveSystem: buildResponsiveSystemBlock(format),
  accessibilityPolicy: buildAccessibilityBlock(),
  libraryPolicy: buildLibraryPolicyBlock(),
  runtimeBudgets: buildRuntimeBudgetsBlock(plan)
});

const buildTokenStrategy = (profile: CanvasVisualDirectionProfile): InspiredesignTokenStrategy => ({
  colors: PROFILE_CONFIG[profile].colors,
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

const buildComponentBuildPlan = (profile: CanvasVisualDirectionProfile) => {
  return PROFILE_CONFIG[profile].componentSequence.map((name) => ({
    name,
    purpose: `Establish the ${name.toLowerCase()} pattern as a reusable system primitive.`,
    states: ["default", "hover", "focus", "disabled"],
    implementationNote: "Use semantic tokens first and keep copy/state logic outside the visual component."
  }));
};

type BuildImplementationPlanInput = {
  profile: CanvasVisualDirectionProfile;
  format: InspiredesignBriefFormat;
  references: InspiredesignReferenceEvidence[];
  synthesis: InspiredesignReferenceSynthesis;
  designVectors: InspiredesignDesignVectors;
};

const buildImplementationPlan = ({
  profile,
  format,
  references,
  synthesis,
  designVectors
}: BuildImplementationPlanInput): InspiredesignImplementationPlan => ({
  architectureRecommendation: `Implement the surface as a ${format.archetype} using token-first components and shared semantic CSS variables, then compose page sections from those primitives before adding any page-specific polish.`,
  tokenStrategy: buildTokenStrategy(profile),
  referenceImplementationNotes: synthesis.lines.length > 0
    ? synthesis.lines
    : ["No live reference cues were captured; keep implementation anchored to the source brief and selected prompt format."],
  componentBuildPlan: buildComponentBuildPlan(profile),
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
    references.length === 0
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

const referenceLayoutObservation = (
  reference: InspiredesignReferenceEvidence,
  excerpt: string
): string => {
  if (!reference.capture?.snapshot && !reference.capture?.clone && !reference.capture?.dom) return excerpt;
  const signals = getInspiredesignReferenceSignals(reference);
  return signals.find((signal) => signal !== reference.title) ?? signals[0] ?? excerpt;
};

const renderReferenceMarkdown = (reference: InspiredesignReferenceEvidence, index: number): string => {
  const excerpt = reference.excerpt ? clipText(reference.excerpt, 220) : "No fetched excerpt captured.";
  const title = reference.title ?? reference.url;
  return [
    `### Source ${index + 1}: ${title}`,
    `- what it contributes: ${referenceContribution(reference)}`,
    `- notable UI patterns: ${reference.capture?.snapshot ? "Primary hierarchy and actionables were captured from the live page." : "Patterns inferred from brief and fetched content."}`,
    `- typography observations: ${reference.title ? "Headline density and copy hierarchy were inferred from the fetched title and excerpt." : "Typography is inferred."}`,
    `- color and theme observations: ${reference.captureStatus === "captured" ? "Color posture should be validated against the captured page before cloning brand treatment." : "Color posture remains a synthesis decision."}`,
    `- layout and hierarchy observations: ${referenceLayoutObservation(reference, excerpt)}`,
    `- component patterns: ${reference.capture?.clone ? "Buttons, cards, or layout wrappers can be inferred from the captured clone preview." : "Component families were inferred from available reference text."}`,
    `- motion/interaction observations: ${referenceMotionNote(reference)}`,
    `- accessibility/responsiveness notes: ${reference.captureStatus === "captured" ? "Validate focus order, CTA prominence, and stacked layouts during build QA." : "Accessibility and responsiveness are inferred from system defaults."}`,
    `- what should be adopted, adapted, or avoided: adopt layout hierarchy, adapt it to the new brand tokens, avoid copying proprietary copy or visual assets directly.`
  ].join("\n");
};

const renderInspirationAnalysis = (
  references: InspiredesignReferenceEvidence[],
  usableReferences: InspiredesignReferenceEvidence[]
): string => {
  if (usableReferences.length > 0) return usableReferences.map(renderReferenceMarkdown).join("\n\n");
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
    formatRecordList(implementationPlan.tokenStrategy.colors),
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
    formatRecordList(implementationPlan.tokenStrategy.colors),
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

const renderPrototypeGuidance = (
  profile: CanvasVisualDirectionProfile,
  synthesis: InspiredesignReferenceSynthesis,
  designVectors: InspiredesignDesignVectors
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
    "- browser proof: capture desktop and mobile browser screenshots, verify reduced-motion behavior, inspect focus states, and confirm the primary CTA remains visible without overlap.",
    "- HTML skeleton guidance: start with one main landmark, one primary CTA group, and semantic sections that follow the design vector section architecture instead of fixed industry-specific defaults.",
    "- styling approach: define CSS variables for timing, easing, elevation, translucency, backdrop blur, cursor effects, hover effects, and parallax distance before mapping components to semantic tokens.",
    "- first prototype should include vs omit: include shell, primary hero or decision section, CTA group, proof or detail sections, section patterns named in the design vectors, final CTA, and footer; omit analytics, app-shell widgets, empty card grids, and any section not supported by the brief or reference evidence."
  ].join("\n");
};

const renderDeliverablesSummary = (includePrototypeGuidance: boolean): string => {
  const deliverables = [
    "Structured `designContract` JSON aligned to canvas governance",
    "Valid `generationPlan` JSON aligned to the canvas generation plan contract",
    "Ready-to-fill `canvasPlanRequest` JSON for `canvas.plan.set`",
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
  referencePatternBoard: InspiredesignReferencePatternBoard;
  designVectors: InspiredesignDesignVectors;
};

const buildEvidencePayload = ({
  brief,
  briefExpansion,
  advancedBriefMarkdown,
  urls,
  references,
  referencePatternBoard,
  designVectors
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
  referencePatternBoard: referencePatternBoard as JsonRecord,
  designVectors: designVectors as JsonRecord
});

const toCaptureEvidenceJson = (reference: InspiredesignReferenceEvidence): JsonValue => {
  const normalized = normalizeInspiredesignCaptureEvidence(reference.capture);
  if (!normalized) return null;
  const signals = getInspiredesignReferenceSignals(reference);
  return {
    ...(normalized.title ? { title: normalized.title } : {}),
    ...(signals.length > 0 ? { signals } : {}),
    ...(normalized.attempts ? { attempts: normalized.attempts } : {})
  };
};

const toReferenceEvidenceJson = (reference: InspiredesignReferenceEvidence): JsonValue => ({
  id: reference.id,
  url: reference.url,
  ...(reference.title ? { title: reference.title } : {}),
  ...(reference.excerpt ? { excerpt: reference.excerpt } : {}),
  fetchStatus: reference.fetchStatus,
  captureStatus: reference.captureStatus,
  ...(reference.fetchFailure ? { fetchFailure: reference.fetchFailure } : {}),
  ...(reference.captureFailure ? { captureFailure: reference.captureFailure } : {}),
  capture: toCaptureEvidenceJson(reference)
});

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
  const usableReferences = references.filter(hasInspiredesignUsableReferenceEvidence);
  const synthesis = buildReferenceSynthesis(usableReferences);
  const referencePatternBoard = buildInspiredesignReferencePatternBoard(
    referenceFingerprint(brief),
    selectedFormat,
    references
  );
  const designVectors = buildInspiredesignDesignVectors(selectedFormat, referencePatternBoard);
  const effectiveFormat = buildEvidenceDerivedFormat(selectedFormat, designVectors);
  const effectiveBriefExpansion: InspiredesignBriefExpansion = {
    ...input.briefExpansion,
    format: effectiveFormat
  };
  const advancedBriefMarkdown = renderReferenceFirstAdvancedBrief(
    input.briefExpansion,
    referencePatternBoard,
    designVectors,
    references
  );
  const generationPlan = buildGenerationPlan({
    brief,
    format: effectiveFormat,
    synthesis,
    referencePatternBoard,
    designVectors
  });
  const profile = generationPlan.visualDirection.profile;
  const canvasPlanRequest = buildCanvasPlanRequest(brief, generationPlan);
  const designContract = buildDesignContract({
    brief,
    urls,
    references,
    plan: generationPlan,
    format: effectiveFormat
  });
  const followthrough = buildFollowthrough({
    generationPlan,
    briefExpansion: effectiveBriefExpansion,
    synthesis,
    includePrototypeGuidance,
    referencePatternBoard,
    designVectors
  });
  const implementationPlan = buildImplementationPlan({
    profile,
    format: effectiveFormat,
    references,
    synthesis,
    designVectors
  });
  const governanceMarkdown = renderGovernanceMarkdown(designContract, implementationPlan, effectiveFormat);
  const implementationPlanMarkdown = renderImplementationMarkdown(implementationPlan);
  const prototypeGuidanceMarkdown = includePrototypeGuidance
    ? renderPrototypeGuidance(profile, synthesis, designVectors)
    : null;
  const designMarkdown = [
    "# 1. Executive Summary",
    "",
    formatBulletList([
      `Analyzed brief plus ${references.length || 0} inspiration reference(s).`,
      `Chosen design direction: ${designVectors.surfaceIntent}.`,
      `Route profile: ${PROFILE_CONFIG[profile].direction}.`,
      `Prompt format: ${selectedFormat.label} (${input.briefExpansion.templateVersion}).`,
      "Final outcome: a reusable design contract, engineering plan, and optional prototype guidance.",
      `Scope mode: ${references.length > 1 ? "full-site synthesis" : "single-surface synthesis"}.`
    ]),
    "",
    "# 2. Inspiration Analysis",
    "",
    renderInspirationAnalysis(references, usableReferences),
    "",
    "# 3. Unified Design Direction",
    "",
    "## 3.1 Reference-Specific Build Rules",
    "",
    formatBulletList(synthesis.lines.length > 0 ? synthesis.lines : ["No live reference cues were captured."]),
    "",
    "## 3.2 Reference Pattern Board",
    "",
    formatBulletList(referencePatternBoard.synthesis.sharedStrengths.length > 0
      ? referencePatternBoard.synthesis.sharedStrengths
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
      `interaction moments: ${designVectors.interactionMoments.join(" ")}`,
      `material effects: ${designVectors.materialEffects.join(" ")}`
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
    renderDeliverablesSummary(Boolean(input.includePrototypeGuidance))
  ].join("\n");

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
    evidence: buildEvidencePayload({
      brief,
      briefExpansion: effectiveBriefExpansion,
      advancedBriefMarkdown,
      urls,
      references,
      referencePatternBoard,
      designVectors
    })
  };
};
