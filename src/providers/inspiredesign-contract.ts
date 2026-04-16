import { createHash } from "crypto";
import generationPlanTemplateJson from "../../skills/opendevbrowser-design-agent/assets/templates/canvas-generation-plan.design.v1.json";
import designContractTemplateJson from "../../skills/opendevbrowser-design-agent/assets/templates/design-contract.v1.json";
import type {
  CanvasDesignGovernance,
  CanvasGenerationPlan,
  CanvasNavigationModel,
  CanvasVisualDirectionProfile
} from "../canvas/types";
import type { JsonValue } from "./types";

type JsonRecord = Record<string, JsonValue>;
type FetchStatus = "captured" | "failed" | "skipped";
type CaptureStatus = "off" | "captured" | "failed";

type DesignContractTemplate = {
  intent: JsonRecord;
  designLanguage: JsonRecord;
  contentModel: JsonRecord;
  layoutSystem: JsonRecord;
  typographySystem: JsonRecord;
  motionSystem: JsonRecord;
  responsiveSystem: JsonRecord;
  accessibilityPolicy: JsonRecord;
};

type GenerationPlanTemplate = {
  generationPlan: CanvasGenerationPlan;
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

export type InspiredesignPacket = {
  designContract: CanvasDesignGovernance;
  generationPlan: CanvasGenerationPlan;
  designMarkdown: string;
  implementationPlan: InspiredesignImplementationPlan;
  implementationPlanMarkdown: string;
  prototypeGuidanceMarkdown: string | null;
  evidence: JsonRecord;
};

export type BuildInspiredesignPacketInput = {
  brief: string;
  urls: string[];
  references: InspiredesignReferenceEvidence[];
  includePrototypeGuidance?: boolean;
};

const BASE_CONTRACT_TEMPLATE: DesignContractTemplate = designContractTemplateJson;
const BASE_GENERATION_PLAN: CanvasGenerationPlan = (
  generationPlanTemplateJson as GenerationPlanTemplate
).generationPlan;

const PROFILE_MATCHERS: ReadonlyArray<{
  profile: CanvasVisualDirectionProfile;
  keywords: readonly string[];
}> = [
  { profile: "auth-focused", keywords: ["auth", "login", "signin", "sign-in", "signup", "sign-up", "onboarding"] },
  { profile: "settings-system", keywords: ["settings", "preferences", "account", "profile", "billing"] },
  { profile: "ops-control", keywords: ["dashboard", "admin", "control", "analytics", "monitor", "reporting"] },
  { profile: "documentation", keywords: ["docs", "documentation", "knowledge base", "reference", "guide"] },
  { profile: "commerce-system", keywords: ["shop", "commerce", "pricing", "checkout", "product page", "catalog"] }
] as const;

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
    direction: "reference-first documentation",
    visualPersonality: "legible, calm, highly structured",
    brandTone: "expert and accessible",
    hierarchyPrinciples: ["Make scanning effortless.", "Keep code, steps, and warnings visually distinct."],
    interactionPhilosophy: "Light motion, sticky wayfinding, strong anchor visibility.",
    navigationModel: "sidebar",
    layoutApproach: "docs-shell",
    pagePatterns: ["Docs shell", "Procedure section", "Reference table block"],
    componentSequence: ["Sidebar", "Search", "Anchored headings", "Code blocks", "Callouts"],
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

const cloneTemplate = <T>(value: T): T => structuredClone(value);

const referenceFingerprint = (value: string): string => {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
};

const hasKeyword = (value: string, keywords: readonly string[]): boolean => {
  const haystack = value.toLowerCase();
  return keywords.some((keyword) => haystack.includes(keyword));
};

const classifyProfile = (brief: string, references: InspiredesignReferenceEvidence[]): CanvasVisualDirectionProfile => {
  const combined = [brief, ...references.map((reference) => `${reference.title ?? ""} ${reference.excerpt ?? ""}`)]
    .join(" ")
    .toLowerCase();
  return PROFILE_MATCHERS.find((matcher) => hasKeyword(combined, matcher.keywords))?.profile ?? "product-story";
};

const resolveThemeStrategy = (brief: string, references: InspiredesignReferenceEvidence[]): CanvasGenerationPlan["visualDirection"]["themeStrategy"] => {
  const combined = `${brief} ${references.map((reference) => reference.excerpt ?? "").join(" ")}`.toLowerCase();
  return combined.includes("dark")
    ? "light-dark-parity"
    : "single-theme";
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

const buildGenerationPlan = (
  brief: string,
  profile: CanvasVisualDirectionProfile,
  references: InspiredesignReferenceEvidence[]
): CanvasGenerationPlan => {
  const plan = cloneTemplate(BASE_GENERATION_PLAN);
  plan.targetOutcome.summary = summarizeBrief(brief);
  plan.visualDirection.profile = profile;
  plan.visualDirection.themeStrategy = resolveThemeStrategy(brief, references);
  plan.layoutStrategy.approach = PROFILE_CONFIG[profile].layoutApproach;
  plan.layoutStrategy.navigationModel = PROFILE_CONFIG[profile].navigationModel;
  plan.componentStrategy.interactionStates = ["default", "hover", "focus", "disabled", "loading"];
  plan.validationTargets.requiredThemes = plan.visualDirection.themeStrategy === "light-dark-parity"
    ? ["light", "dark"]
    : ["light"];
  return plan;
};

const buildIntentBlock = (brief: string, urls: string[], references: InspiredesignReferenceEvidence[]): JsonRecord => {
  const intent = cloneTemplate(BASE_CONTRACT_TEMPLATE.intent);
  return {
    ...intent,
    task: summarizeBrief(brief),
    brief,
    briefHash: referenceFingerprint(brief),
    referenceCount: references.length,
    referenceUrls: urls,
    evidenceStatus: {
      fetched: references.filter((reference) => reference.fetchStatus === "captured").length,
      captured: references.filter((reference) => reference.captureStatus === "captured").length
    }
  };
};

const buildDesignLanguageBlock = (profile: CanvasVisualDirectionProfile): JsonRecord => {
  const block = cloneTemplate(BASE_CONTRACT_TEMPLATE.designLanguage);
  const config = PROFILE_CONFIG[profile];
  return {
    ...block,
    direction: config.direction,
    visualPersonality: config.visualPersonality,
    brandTone: config.brandTone
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

const buildLayoutSystemBlock = (profile: CanvasVisualDirectionProfile): JsonRecord => {
  const block = cloneTemplate(BASE_CONTRACT_TEMPLATE.layoutSystem);
  return {
    ...block,
    pagePatterns: PROFILE_CONFIG[profile].pagePatterns
  };
};

const buildTypographySystemBlock = (): JsonRecord => {
  const block = cloneTemplate(BASE_CONTRACT_TEMPLATE.typographySystem);
  return {
    ...block,
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

const buildColorSystemBlock = (profile: CanvasVisualDirectionProfile): JsonRecord => {
  const colors = PROFILE_CONFIG[profile].colors;
  return {
    paletteName: `${profile}-default`,
    tokens: colors,
    contrastRequirements: {
      bodyText: "4.5:1",
      largeText: "3:1",
      focusRing: "3:1"
    }
  };
};

const buildSurfaceSystemBlock = (): JsonRecord => ({
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

const buildMotionSystemBlock = (): JsonRecord => {
  const block = cloneTemplate(BASE_CONTRACT_TEMPLATE.motionSystem);
  return {
    ...block,
    durations: {
      quick: "120ms",
      standard: "180ms",
      emphasis: "240ms"
    }
  };
};

const buildResponsiveSystemBlock = (): JsonRecord => {
  const block = cloneTemplate(BASE_CONTRACT_TEMPLATE.responsiveSystem);
  return {
    ...block,
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
  maxPrimarySections: 8,
  maxInteractionLatencyMs: plan.validationTargets.maxInteractionLatencyMs,
  previewBudgetMs: 1500,
  notes: [
    "Keep above-the-fold content inside one visual composition.",
    "Avoid heavyweight decorative animation before interaction clarity is established."
  ]
});

const buildDesignContract = (
  brief: string,
  urls: string[],
  references: InspiredesignReferenceEvidence[],
  plan: CanvasGenerationPlan
): CanvasDesignGovernance => ({
  intent: buildIntentBlock(brief, urls, references),
  generationPlan: plan,
  designLanguage: buildDesignLanguageBlock(plan.visualDirection.profile),
  contentModel: buildContentModelBlock(brief, references),
  layoutSystem: buildLayoutSystemBlock(plan.visualDirection.profile),
  typographySystem: buildTypographySystemBlock(),
  colorSystem: buildColorSystemBlock(plan.visualDirection.profile),
  surfaceSystem: buildSurfaceSystemBlock(),
  iconSystem: buildIconSystemBlock(),
  motionSystem: buildMotionSystemBlock(),
  responsiveSystem: buildResponsiveSystemBlock(),
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

const buildImplementationPlan = (
  brief: string,
  profile: CanvasVisualDirectionProfile,
  references: InspiredesignReferenceEvidence[]
): InspiredesignImplementationPlan => ({
  architectureRecommendation: "Implement the surface as token-first components using shared semantic CSS variables, then compose page sections from those primitives before adding any page-specific polish.",
  tokenStrategy: buildTokenStrategy(profile),
  componentBuildPlan: buildComponentBuildPlan(profile),
  pageAssemblyPlan: [
    "Start with the shell and primary navigation pattern.",
    "Compose the hero or primary decision section before supporting sections.",
    "Add proof, utility, and footer sections only after the top-level hierarchy is stable."
  ],
  stateAndInteractionPlan: [
    "Keep hover, focus, loading, success, and error states visually distinct.",
    "Preserve layout during loading and keep transient confirmations out of the main flow.",
    "Use reduced-motion-safe transitions for reveals and CTA feedback."
  ],
  accessibilityChecklist: [
    "Maintain 4.5:1 body text contrast across all surfaces.",
    "Preserve visible focus rings on every interactive element.",
    "Keep landmarks and heading levels explicit and sequential."
  ],
  responsiveChecklist: [
    "Collapse multicolumn layouts before text measure becomes cramped.",
    "Keep the primary CTA visible without overlap on narrow screens.",
    "Avoid horizontal scrolling for primary content."
  ],
  risksAndAmbiguities: [
    references.length === 0
      ? "No live references were supplied, so visual cues are derived entirely from the written brief."
      : "Live references were reduced into reusable patterns; unique brand assets should still be recreated, not copied.",
    "Any missing interaction states must be validated during visual QA."
  ],
  buildSequence: [
    "Define semantic tokens and typography.",
    "Build the shell, navigation, and primary CTA components.",
    "Implement section-level patterns and proof blocks.",
    "Add loading, empty, and error states.",
    "Run accessibility, responsive, and browser QA before final polish."
  ]
});

const formatBulletList = (items: string[]): string => items.map((item) => `- ${item}`).join("\n");

const formatRecordList = (record: Record<string, string | number>): string => {
  return Object.entries(record).map(([key, value]) => `- \`${key}\`: ${value}`).join("\n");
};

const referenceContribution = (reference: InspiredesignReferenceEvidence): string => {
  if (reference.captureStatus === "captured") return "Live hierarchy and component evidence captured from the page.";
  if (reference.fetchStatus === "captured") return "Content and structural cues inferred from fetched page data.";
  return "Only operator brief context was available for this reference.";
};

const referenceMotionNote = (reference: InspiredesignReferenceEvidence): string => {
  if (reference.capture?.snapshot?.warnings?.length) {
    return `Capture warnings: ${reference.capture.snapshot.warnings.join(", ")}`;
  }
  if (reference.captureStatus === "captured") return "Motion should remain subtle until validated against the live capture.";
  return "Motion is inferred from the brief rather than directly observed.";
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
    `- layout and hierarchy observations: ${reference.capture?.snapshot ? clipText(reference.capture.snapshot.content, 180) : excerpt}`,
    `- component patterns: ${reference.capture?.clone ? "Buttons, cards, or layout wrappers can be inferred from the captured clone preview." : "Component families were inferred from available reference text."}`,
    `- motion/interaction observations: ${referenceMotionNote(reference)}`,
    `- accessibility/responsiveness notes: ${reference.captureStatus === "captured" ? "Validate focus order, CTA prominence, and stacked layouts during build QA." : "Accessibility and responsiveness are inferred from system defaults."}`,
    `- what should be adopted, adapted, or avoided: adopt layout hierarchy, adapt it to the new brand tokens, avoid copying proprietary copy or visual assets directly.`
  ].join("\n");
};

const resolveProfileConfigFromGenerationPlan = (
  generationPlan: CanvasDesignGovernance["generationPlan"]
): ProfileConfig => {
  if (!generationPlan || typeof generationPlan !== "object" || !("visualDirection" in generationPlan)) {
    throw new Error("Inspiredesign design contract requires a generation plan.");
  }
  const visualDirection = generationPlan.visualDirection;
  if (!visualDirection || typeof visualDirection !== "object" || !("profile" in visualDirection)) {
    throw new Error("Inspiredesign design contract requires a visual direction profile.");
  }
  const profile = visualDirection.profile;
  if (typeof profile !== "string" || !(profile in PROFILE_CONFIG)) {
    throw new Error("Inspiredesign design contract profile is invalid.");
  }
  return PROFILE_CONFIG[profile as CanvasVisualDirectionProfile];
};

const renderGovernanceMarkdown = (
  designContract: CanvasDesignGovernance,
  implementationPlan: InspiredesignImplementationPlan
): string => {
  const profileConfig = resolveProfileConfigFromGenerationPlan(designContract.generationPlan);
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
      "Direction: modern, system-led, and implementation-aware."
    ]),
    "",
    "## 4.4 Color System",
    formatRecordList(implementationPlan.tokenStrategy.colors),
    "",
    "## 4.5 Typography System",
    formatRecordList(implementationPlan.tokenStrategy.typography),
    "",
    "## 4.6 Spacing and Layout System",
    formatRecordList(implementationPlan.tokenStrategy.spacing),
    "",
    "## 4.7 Shape, Border, and Elevation Rules",
    [
      formatRecordList(implementationPlan.tokenStrategy.radius),
      formatRecordList(implementationPlan.tokenStrategy.shadow)
    ].join("\n"),
    "",
    "## 4.8 Motion and Interaction Rules",
    formatRecordList(implementationPlan.tokenStrategy.motion),
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
      "Don't hide important actions inside ambiguous hover-only affordances."
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
    "## 5.3 Component Build Plan",
    implementationPlan.componentBuildPlan.map((component, index) => (
      `${index + 1}. ${component.name}: ${component.purpose}`
    )).join("\n"),
    "",
    "## 5.4 Page Assembly Plan",
    formatBulletList(implementationPlan.pageAssemblyPlan),
    "",
    "## 5.5 State and Interaction Plan",
    formatBulletList(implementationPlan.stateAndInteractionPlan),
    "",
    "## 5.6 Accessibility Implementation Checklist",
    formatBulletList(implementationPlan.accessibilityChecklist),
    "",
    "## 5.7 Responsive Implementation Checklist",
    formatBulletList(implementationPlan.responsiveChecklist),
    "",
    "## 5.8 Risks and Ambiguities",
    formatBulletList(implementationPlan.risksAndAmbiguities),
    "",
    "## 5.9 Recommended Build Sequence",
    implementationPlan.buildSequence.map((step, index) => `${index + 1}. ${step}`).join("\n")
  ].join("\n");
};

const renderPrototypeGuidance = (profile: CanvasVisualDirectionProfile): string => {
  return [
    "# 6. Optional Prototype Plan",
    "",
    "- page structure: establish the shell, hero or primary action zone, proof sections, and footer in that order.",
    `- section order: ${PROFILE_CONFIG[profile].pagePatterns.join(" -> ")}`,
    "- component composition: reuse button, card, input, and navigation primitives before page-specific wrappers.",
    "- interaction expectations: provide visible focus, compact hover feedback, and reduced-motion-safe entry transitions.",
    "- HTML skeleton guidance: start with one main landmark, one primary CTA group, and semantic sections for proof or detail bands.",
    "- styling approach: define CSS variables first, then map components to semantic tokens rather than raw values.",
    "- first prototype should include vs omit: include shell, hero, CTA, one proof section, and one form or action cluster; omit analytics, heavy animation, and tertiary content until hierarchy is proven."
  ].join("\n");
};

const renderDeliverablesSummary = (includePrototypeGuidance: boolean): string => {
  const deliverables = [
    "Structured `designContract` JSON aligned to canvas governance",
    "Valid `generationPlan` JSON aligned to the canvas generation plan contract",
    "Human-readable `design.md` design specification",
    "Engineering implementation plan in JSON and Markdown"
  ];
  if (includePrototypeGuidance) {
    deliverables.push("Prototype guidance Markdown for the first HTML pass");
  }
  deliverables.push("Evidence digest describing brief, references, fetch outcomes, and capture outcomes");
  return formatBulletList(deliverables);
};

const buildEvidencePayload = (
  brief: string,
  urls: string[],
  references: InspiredesignReferenceEvidence[]
): JsonRecord => ({
  brief,
  briefHash: referenceFingerprint(brief),
  urls,
  referenceCount: references.length,
  references: references.map((reference) => toReferenceEvidenceJson(reference))
});

const toCaptureEvidenceJson = (capture: InspiredesignCaptureEvidence | null | undefined): JsonValue => {
  if (!capture) return null;
  return {
    ...(capture.title ? { title: capture.title } : {}),
    ...(capture.snapshot ? { snapshot: capture.snapshot } : {}),
    ...(capture.dom ? { dom: capture.dom } : {}),
    ...(capture.clone ? { clone: capture.clone } : {})
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
  capture: toCaptureEvidenceJson(reference.capture)
});

export const buildInspiredesignPacket = (input: BuildInspiredesignPacketInput): InspiredesignPacket => {
  const brief = trimText(input.brief);
  const urls = [...new Set(input.urls.map((url) => trimText(url)).filter(Boolean))];
  const references = input.references.map((reference) => ({
    ...reference,
    title: reference.title ? trimText(reference.title) : undefined,
    excerpt: reference.excerpt ? trimText(reference.excerpt) : undefined
  }));
  const profile = classifyProfile(brief, references);
  const generationPlan = buildGenerationPlan(brief, profile, references);
  const designContract = buildDesignContract(brief, urls, references, generationPlan);
  const implementationPlan = buildImplementationPlan(brief, profile, references);
  const governanceMarkdown = renderGovernanceMarkdown(designContract, implementationPlan);
  const implementationPlanMarkdown = renderImplementationMarkdown(implementationPlan);
  const prototypeGuidanceMarkdown = input.includePrototypeGuidance
    ? renderPrototypeGuidance(profile)
    : null;
  const designMarkdown = [
    "# 1. Executive Summary",
    "",
    formatBulletList([
      `Analyzed brief plus ${references.length || 0} inspiration reference(s).`,
      `Chosen design direction: ${PROFILE_CONFIG[profile].direction}.`,
      "Final outcome: a reusable design contract, engineering plan, and optional prototype guidance.",
      `Scope mode: ${references.length > 1 ? "full-site synthesis" : "single-surface synthesis"}.`
    ]),
    "",
    "# 2. Inspiration Analysis",
    "",
    references.length > 0
      ? references.map(renderReferenceMarkdown).join("\n\n")
      : "- No live inspiration source was provided. The system is derived entirely from the brief.",
    "",
    "# 3. Unified Design Direction",
    "",
    formatBulletList([
      `visual personality: ${PROFILE_CONFIG[profile].visualPersonality}`,
      `tone: ${PROFILE_CONFIG[profile].brandTone}`,
      `UX principles: ${PROFILE_CONFIG[profile].hierarchyPrinciples.join(" ")}`,
      `interaction philosophy: ${PROFILE_CONFIG[profile].interactionPhilosophy}`,
      "branding posture: preserve the intent of the references without cloning brand-only assets.",
      "system coherence rules: encode tokens first, keep one dominant idea per section, and keep states explicit."
    ]),
    "",
    "# 4. Design Governance (`design.md`)",
    "",
    renderGovernanceMarkdown(designContract, implementationPlan),
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
    designContract,
    generationPlan,
    designMarkdown,
    implementationPlan,
    implementationPlanMarkdown,
    prototypeGuidanceMarkdown,
    evidence: buildEvidencePayload(brief, urls, references)
  };
};
