import type { InspiredesignBriefFormat } from "./brief-expansion";

type ReferenceStatus = "captured" | "failed" | "skipped";

type ReferenceInput = {
  id: string;
  url: string;
  title?: string;
  excerpt?: string;
  fetchStatus: ReferenceStatus;
  captureStatus: "off" | "captured" | "failed";
  capture?: {
    title?: string;
    snapshot?: {
      content: string;
    };
    dom?: {
      outerHTML: string;
    };
    clone?: {
      componentPreview: string;
      cssPreview: string;
    };
  } | null;
};

export type InspiredesignReferencePatternBoard = {
  briefId: string;
  targetSurface: string;
  references: Array<{
    id: string;
    name: string;
    url: string;
    surfaceType: string;
    capturedVia: string[];
    layoutRecipe: string;
    contentHierarchy: string[];
    componentFamilies: string[];
    motionPosture: string[];
    tokenNotes: string[];
    patternsToBorrow: string[];
    patternsToReject: string[];
    whyItWorks: string;
  }>;
  synthesis: {
    dominantDirection: string;
    sharedStrengths: string[];
    sharedFailuresToAvoid: string[];
    contractDeltas: string[];
  };
};

export type InspiredesignDesignVectors = {
  sourcePriority: "reference-evidence-first" | "brief-only";
  directionLabel: string;
  surfaceIntent: string;
  compositionModel: string[];
  premiumPosture: string[];
  motionPosture: string[];
  sectionArchitecture: string[];
  typographyPosture: string[];
  imageryPosture: string[];
  interactionDensity: string;
  interactionMoments: string[];
  materialEffects: string[];
  referenceInfluence: string[];
  patternsToBorrow: string[];
  patternsToReject: string[];
  guardrails: string[];
  antiPatterns: string[];
};

const SIGNAL_LIMIT = 5;
const SIGNAL_CLIP = 180;
const PATTERN_LIMIT = 6;

const trimText = (value: string): string => value.trim().replace(/\s+/g, " ");

const clipText = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
};

const textFromHtml = (html: string | undefined): string | undefined => {
  return html ? trimText(html.replace(/<[^>]+>/g, " ")) : undefined;
};

const stripActionRefs = (value: string): string => (
  value
    .replace(/\[r\d+\]\s+(?:link|button|combobox|textbox|option)\s+/gi, "")
    .replace(/\[r\d+\]\s+/gi, "")
    .replace(/\bvalue=/gi, "")
);

const isCodeOrCssPreview = (value: string): boolean => {
  const lower = value.toLowerCase();
  return lower.includes("dangerouslysetinnerhtml")
    || lower.includes("opendevbrowser-root")
    || lower.includes("align-content:")
    || lower.startsWith("import ")
    || /^[.#][a-z0-9_-]+\s*\{/.test(lower)
    || (lower.includes("{") && /[a-z-]+:\s*[^;]+;/.test(lower));
};

const cleanEvidenceText = (value: string): string => {
  return trimText(stripActionRefs(value).replace(/[{};]/g, " "));
};

const DIAGNOSTIC_TEXT_MARKERS = [
  "authentication required",
  "sign in",
  "login required",
  "challenge page",
  "access denied",
  "browser capture unavailable",
  "javascript required",
  "javascript is required",
  "captcha",
  "verification challenge",
  "enable cookies",
  "checking if the site connection is secure",
  "complete the verification",
  "blocked reference"
] as const;

const PUBLIC_LANDING_TEXT_MARKERS = [
  "church",
  "landing page",
  "homepage",
  "full-bleed",
  "hero",
  "story",
  "stories",
  "worship",
  "locations",
  "online",
  "events",
  "cta",
  "gallery",
  "atelier",
  "fashion",
  "studio"
] as const;

const isDiagnosticText = (value: string): boolean => {
  const lower = value.toLowerCase();
  return DIAGNOSTIC_TEXT_MARKERS.some((marker) => lower.includes(marker));
};

const hasPublicLandingSignal = (value: string): boolean => {
  const lower = value.toLowerCase();
  return PUBLIC_LANDING_TEXT_MARKERS.some((marker) => lower.includes(marker));
};

const pushSignal = (signals: string[], value: string | undefined): void => {
  if (!value || isCodeOrCssPreview(value)) return;
  const text = cleanEvidenceText(value);
  if (isCodeOrCssPreview(text) || isDiagnosticText(text)) return;
  if (text.length > 0 && !signals.includes(text)) {
    signals.push(text);
  }
};

export const getInspiredesignReferenceSignals = (reference: ReferenceInput): string[] => {
  const signals: string[] = [];
  pushSignal(signals, reference.title);
  pushSignal(signals, reference.excerpt);
  pushSignal(signals, reference.capture?.title);
  pushSignal(signals, reference.capture?.snapshot?.content);
  pushSignal(signals, textFromHtml(reference.capture?.clone?.componentPreview));
  pushSignal(signals, reference.capture?.clone?.cssPreview);
  pushSignal(signals, textFromHtml(reference.capture?.dom?.outerHTML));
  return signals.map((signal) => clipText(signal, SIGNAL_CLIP)).slice(0, SIGNAL_LIMIT);
};

const hasCleanSignal = (value: string | undefined): boolean => {
  if (!value || isCodeOrCssPreview(value)) return false;
  const text = cleanEvidenceText(value);
  return text.length > 0 && !isCodeOrCssPreview(text) && !isDiagnosticText(text);
};

const hasUsableCloneCreativeEvidence = (reference: ReferenceInput): boolean => (
  hasCleanSignal(reference.capture?.clone?.componentPreview)
);

const hasUsableCaptureEvidence = (reference: ReferenceInput): boolean => (
  hasCleanSignal(reference.capture?.snapshot?.content)
  || hasUsableCloneCreativeEvidence(reference)
  || hasCleanSignal(textFromHtml(reference.capture?.dom?.outerHTML))
);

export const hasInspiredesignUsableReferenceEvidence = (reference: ReferenceInput): boolean => {
  if (reference.captureStatus === "captured" && hasUsableCaptureEvidence(reference)) return true;
  return reference.fetchStatus === "captured"
    && (hasCleanSignal(reference.title) || hasCleanSignal(reference.excerpt));
};

const firstSignal = (reference: ReferenceInput): string => {
  const preferred = [
    reference.capture?.title,
    reference.capture?.snapshot?.content,
    textFromHtml(reference.capture?.clone?.componentPreview),
    textFromHtml(reference.capture?.dom?.outerHTML),
    reference.excerpt,
    reference.title
  ].map((value) => value ? cleanEvidenceText(value) : "").find((value) => (
    value.length > 0 && !isCodeOrCssPreview(value) && !isDiagnosticText(value)
  ));
  return preferred ? clipText(preferred, SIGNAL_CLIP) : reference.url;
};

type ReferencePatternRule = {
  summary: string;
  matches: readonly string[];
};

const REFERENCE_PATTERN_RULES: readonly ReferencePatternRule[] = [
  {
    summary: "location-first church discovery with regional pathways",
    matches: ["find a church", "church locations", "location", "city or postcode", "current location"]
  },
  {
    summary: "worship and music content as atmosphere and ministry proof",
    matches: ["music", "worship", "united", "young & free", "chapel", "instrumentals"]
  },
  {
    summary: "global region navigation with online participation path",
    matches: ["asia pacific", "europe", "north america", "latin america", "africa", "middle east", "online"]
  },
  {
    summary: "story-led editorial pathway after the primary church action",
    matches: ["stories", "blog", "start reading", "newsroom"]
  },
  {
    summary: "ministry ecosystem pathways for college, conferences, and events",
    matches: ["college", "conference", "tours", "events"]
  },
  {
    summary: "multilingual/global audience affordance",
    matches: ["language", "\"en\"", "\"fr\"", "\"es\"", "\"pt\"", "\"de\""]
  },
  {
    summary: "full-bleed hero with restrained CTA rail",
    matches: ["full-bleed", "hero", "cta rail", "primary cta"]
  }
];

const ruleMatches = (text: string, rule: ReferencePatternRule): boolean => {
  const lower = text.toLowerCase();
  return rule.matches.some((match) => lower.includes(match));
};

const derivePatternSummaries = (signals: string[], fallback: string): string[] => {
  const text = signals.join(" ");
  const matches = REFERENCE_PATTERN_RULES
    .filter((rule) => ruleMatches(text, rule))
    .map((rule) => rule.summary);
  return matches.length > 0 ? matches.slice(0, PATTERN_LIMIT) : [fallback];
};

const appendSourceDetail = (patterns: string[], primarySignal: string): string[] => {
  if (patterns.some((pattern) => primarySignal.toLowerCase().includes(pattern.toLowerCase()))) {
    return patterns;
  }
  return [...patterns, `source detail: ${primarySignal}`].slice(0, PATTERN_LIMIT);
};

const deriveCapturedVia = (reference: ReferenceInput): string[] => {
  const methods: string[] = [];
  if (reference.fetchStatus === "captured") methods.push("fetch");
  if (reference.capture?.snapshot?.content.trim()) methods.push("snapshot");
  if (hasUsableCloneCreativeEvidence(reference)) {
    methods.push("clone");
  }
  if (reference.capture?.dom?.outerHTML.trim()) methods.push("dom");
  return methods;
};

const deriveComponentFamilies = (
  format: InspiredesignBriefFormat,
  patterns: string[],
  isPublicLanding: boolean
): string[] => {
  const base = isPublicLanding
    ? "hero composition, proof bands, narrative pathways, event sections, visit CTA, and footer"
    : format.componentGrammar;
  return [base, ...patterns.slice(0, 3)];
};

const hasReferencePublicLandingEvidence = (
  reference: InspiredesignReferencePatternBoard["references"][number]
): boolean => {
  const text = [
    reference.surfaceType,
    reference.layoutRecipe,
    ...reference.contentHierarchy,
    ...reference.patternsToBorrow
  ].join(" ");
  return hasPublicLandingSignal(text);
};

const hasBoardPublicLandingEvidence = (board: InspiredesignReferencePatternBoard): boolean => (
  board.references.some(hasReferencePublicLandingEvidence)
);

const boardEvidenceText = (board: InspiredesignReferencePatternBoard): string => (
  board.references.map((reference) => [
    reference.layoutRecipe,
    ...reference.contentHierarchy,
    ...reference.componentFamilies,
    ...reference.motionPosture,
    ...reference.patternsToBorrow
  ].join(" ")).join(" ").toLowerCase()
);

const hasEvidenceCue = (text: string, matches: readonly string[]): boolean => (
  matches.some((match) => text.includes(match))
);

const deriveReferenceEntry = (
  reference: ReferenceInput,
  format: InspiredesignBriefFormat
): InspiredesignReferencePatternBoard["references"][number] => {
  const signals = getInspiredesignReferenceSignals(reference);
  const primarySignal = firstSignal(reference);
  const patterns = appendSourceDetail(derivePatternSummaries(signals, primarySignal), primarySignal);
  const isPublicLanding = signals.some(hasPublicLandingSignal);
  return {
    id: reference.id,
    name: reference.title ?? reference.url,
    url: reference.url,
    surfaceType: isPublicLanding ? "public landing page" : format.archetype,
    capturedVia: deriveCapturedVia(reference),
    layoutRecipe: patterns.join("; "),
    contentHierarchy: patterns.slice(0, 4),
    componentFamilies: deriveComponentFamilies(format, patterns, isPublicLanding),
    motionPosture: [format.motionGrammar, "Plan hero reveal, scroll reveal, CTA feedback, and reduced-motion behavior."],
    tokenNotes: [format.paletteIntent, format.typographySystem, format.surfaceTreatment],
    patternsToBorrow: [...patterns, ...signals.slice(0, 2)].slice(0, PATTERN_LIMIT),
    patternsToReject: [...format.antiPatterns],
    whyItWorks: reference.captureStatus === "captured"
      ? "Captured reference evidence provides reusable hierarchy, rhythm, and component cues."
      : "Available reference text provides directional content and hierarchy cues."
  };
};

export const buildInspiredesignReferencePatternBoard = (
  briefId: string,
  format: InspiredesignBriefFormat,
  references: ReferenceInput[]
): InspiredesignReferencePatternBoard => {
  const entries = references
    .filter(hasInspiredesignUsableReferenceEvidence)
    .map((reference) => deriveReferenceEntry(reference, format));
  const sharedStrengths = entries.flatMap((entry) => entry.patternsToBorrow).slice(0, 6);
  const targetSurface = entries.some((entry) => entry.surfaceType === "public landing page")
    ? "reference-led public landing page"
    : format.layoutArchetype;
  return {
    briefId,
    targetSurface,
    references: entries,
    synthesis: {
      dominantDirection: entries[0]?.layoutRecipe ?? format.archetype,
      sharedStrengths,
      sharedFailuresToAvoid: [...format.antiPatterns],
      contractDeltas: [
        "Selected prompt format supplies route defaults and guardrails, not the creative source of truth.",
        "Use captured reference hierarchy before generic profile defaults when URL evidence exists."
      ]
    }
  };
};

const buildInteractionDensity = (
  format: InspiredesignBriefFormat,
  board: InspiredesignReferencePatternBoard
): string => {
  if (hasBoardPublicLandingEvidence(board)) {
    return "low-to-medium; prioritize confident public-page CTAs over app-shell controls.";
  }
  if (format.route.navigationModel === "sidebar") {
    return "medium-to-high; prioritize command surfaces, state clarity, and durable workspace controls.";
  }
  if (format.route.profile === "documentation") {
    return "medium; prioritize scan-friendly navigation, examples, and low-friction reference jumps.";
  }
  if (format.route.profile === "auth-focused") {
    return "low; prioritize one confident first action with clear feedback and trust cues.";
  }
  return "low-to-medium; prioritize confident public-page CTAs over app-shell controls.";
};

const buildImageryPosture = (
  format: InspiredesignBriefFormat,
  board: InspiredesignReferencePatternBoard
): string[] => {
  if (hasBoardPublicLandingEvidence(board)) {
    return [format.surfaceTreatment, "Use dominant atmospheric imagery as the visual anchor."];
  }
  if (format.route.navigationModel === "sidebar") {
    return [format.surfaceTreatment, "Use product state, data hierarchy, and workspace continuity as the visual anchor."];
  }
  return [format.surfaceTreatment, "Use dominant atmospheric imagery as the visual anchor."];
};

const buildInteractionMoments = (
  format: InspiredesignBriefFormat,
  board: InspiredesignReferencePatternBoard
): string[] => {
  const evidenceText = boardEvidenceText(board);
  const publicLanding = hasBoardPublicLandingEvidence(board);
  const referenceBacked = board.references.length > 0;
  const cursorScope = publicLanding
    ? "hero CTA, media reveals, and primary navigation moments"
    : "high-value actions and selected command surfaces";
  const moments = [
    "Microinteractions: define hover effects, visible focus rings, pressed states, loading states, and confirmation feedback for every primary action.",
    `Animation choreography: sequence ${format.motionGrammar}, hover feedback, active feedback, and page transitions through one timing system.`
  ];
  const cursorBacked = hasEvidenceCue(evidenceText, ["cursor", "magnetic", "follow-cursor", "pointer"]);
  const cursorPolicy = cursorBacked
    ? `Cursor effects: reference evidence supports premium pointer affordances for ${cursorScope}; keep default cursor behavior for reading surfaces.`
    : `Cursor effects policy: consider magnetic or follow-cursor affordances only when reference evidence supports ${cursorScope}.`;
  return referenceBacked ? [...moments, cursorPolicy] : moments;
};

const buildMaterialEffects = (board: InspiredesignReferencePatternBoard): string[] => {
  if (board.references.length === 0) {
    return [
      "Material effects: define elevation, shadows, surface contrast, and reduced-motion-safe depth from the brief.",
      "Reduced-motion material fallback: preserve hierarchy and CTA clarity without transform-based depth."
    ];
  }
  const evidenceText = boardEvidenceText(board);
  const publicLanding = hasBoardPublicLandingEvidence(board);
  const glassScope = publicLanding
    ? "navigation overlays, hero scrims, and atmospheric CTA surfaces"
    : "focused overlays, inspectors, or state containers";
  const parallaxBacked = hasEvidenceCue(evidenceText, ["parallax", "depth", "layered", "immersive", "full-bleed"]);
  const glassBacked = hasEvidenceCue(evidenceText, ["glass", "frosted", "blur", "translucent", "scrim", "overlay"]);
  const parallax = parallaxBacked
    ? "Depth language: reference evidence supports restrained parallax, layered shadows, and atmospheric depth where it reinforces hierarchy."
    : "Depth language policy: use parallax only when reference evidence supports layered depth; otherwise use spacing, scale, and shadow hierarchy.";
  const glass = glassBacked
    ? `Glassmorphism/translucency: reference evidence supports frosted or translucent surfaces for ${glassScope}; never use glass as generic decoration.`
    : `Glassmorphism/translucency policy: use frosted or translucent surfaces only when reference evidence supports ${glassScope}.`;
  return [
    parallax,
    glass,
    "Reduced-motion material fallback: remove parallax and cursor-follow transforms while preserving hierarchy, depth, and CTA clarity."
  ];
};

const buildSectionArchitecture = (
  format: InspiredesignBriefFormat,
  board: InspiredesignReferencePatternBoard
): string[] => {
  if (hasBoardPublicLandingEvidence(board)) {
    return [
      "Use 8 to 12 primary landing-page sections unless the user explicitly asks for a microsite.",
      "Build a clear sequence from hero, proof, story, pathways, impact, events, CTA, and footer."
    ];
  }
  if (format.route.profile === "documentation") {
    return [
      "Use documentation zones for overview, navigation, examples, reference depth, and next-step handoff.",
      "Keep the information architecture scan-friendly without marketing-section sprawl."
    ];
  }
  if (format.route.profile === "auth-focused") {
    return [
      "Use a screen sequence for value, trust, input, confirmation, and first-action transition.",
      "Keep the flow compact instead of expanding into marketing section sprawl."
    ];
  }
  if (format.route.navigationModel === "immersive") {
    return [
      "Use cinematic scene beats for hero, product reveal, proof, detail, and decisive CTA.",
      "Keep each scroll beat focused on one visual idea."
    ];
  }
  if (format.route.navigationModel === "sidebar") {
    return [
      "Use workspace shell zones for navigation, command surfaces, primary work area, detail panels, and state feedback.",
      "Prioritize task continuity over marketing-section cadence."
    ];
  }
  return [
    "Use 8 to 12 primary landing-page sections unless the user explicitly asks for a microsite.",
    "Build a clear sequence from hero, proof, story, pathways, impact, events, CTA, and footer."
  ];
};

export const buildInspiredesignDesignVectors = (
  format: InspiredesignBriefFormat,
  board: InspiredesignReferencePatternBoard
): InspiredesignDesignVectors => {
  const influence = board.synthesis.sharedStrengths.length > 0
    ? board.synthesis.sharedStrengths
    : [format.archetype];
  const publicLandingEvidence = hasBoardPublicLandingEvidence(board);
  const surfaceIntent = publicLandingEvidence
    ? "reference-led public landing page"
    : format.archetype;
  const compositionModel = publicLandingEvidence
    ? ["full-bleed hero with narrative section cadence", ...board.references.map((entry) => entry.layoutRecipe)]
    : [format.layoutArchetype, ...board.references.map((entry) => entry.layoutRecipe)];
  return {
    sourcePriority: board.references.length > 0 ? "reference-evidence-first" : "brief-only",
    directionLabel: board.synthesis.dominantDirection,
    surfaceIntent,
    compositionModel: compositionModel.slice(0, 5),
    premiumPosture: [
      "premium visual hierarchy, refined spacing, and editorial image treatment.",
      "Premium typography, spacing, visual hierarchy, palette, and image treatment must lead the page.",
      format.surfaceTreatment,
      format.paletteIntent
    ],
    motionPosture: [
      "Use a hero entrance reveal, section scroll reveal, and CTA/focus feedback.",
      "Respect reduced-motion preference with static hierarchy preserved.",
      format.motionGrammar
    ],
    sectionArchitecture: buildSectionArchitecture(format, board),
    typographyPosture: [format.typographySystem],
    imageryPosture: buildImageryPosture(format, board),
    interactionDensity: buildInteractionDensity(format, board),
    interactionMoments: buildInteractionMoments(format, board),
    materialEffects: buildMaterialEffects(board),
    referenceInfluence: influence,
    patternsToBorrow: board.references.flatMap((entry) => entry.patternsToBorrow).slice(0, 8),
    patternsToReject: board.references.flatMap((entry) => entry.patternsToReject).slice(0, 8),
    guardrails: [...format.guardrails],
    antiPatterns: [...format.antiPatterns]
  };
};
