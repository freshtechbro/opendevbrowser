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
    visual?: {
      status: "captured" | "skipped" | "failed";
      path?: string;
      sha256?: string;
      bytes?: number;
      failure?: string;
      warnings: string[];
    };
  } | null;
};

export type InspiredesignReferenceQualitySummary = {
  rankedReferenceCount: number;
  rejectedReferenceCount: number;
  topReferenceScore?: number;
  topReferenceConfidence?: number;
  topReferenceIntentMatched?: boolean;
  failedCaptureCount: number;
  missingScreenshotCount: number;
  diagnosticOnlyReasons: string[];
};

export type InspiredesignReferencePatternBoard = {
  briefId: string;
  targetSurface: string;
  qualitySummary: InspiredesignReferenceQualitySummary;
  references: Array<{
    id: string;
    rank: number;
    score: number;
    confidence: number;
    name: string;
    url: string;
    surfaceType: string;
    capturedVia: string[];
    intentMatched: boolean;
    selectionReason: string;
    visualStrengths: string[];
    visualRisks: string[];
    layoutRecipe: string;
    contentHierarchy: string[];
    componentFamilies: string[];
    motionPosture: string[];
    tokenNotes: string[];
    patternsToBorrow: string[];
    patternsToReject: string[];
    whyItWorks: string;
  }>;
  rejectedReferences: Array<{
    id: string;
    url: string;
    reason: string;
    fetchStatus: ReferenceStatus;
    captureStatus: "off" | "captured" | "failed";
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
  advancedMotionAdvisory: string[];
  referenceInfluence: string[];
  patternsToBorrow: string[];
  patternsToReject: string[];
  guardrails: string[];
  antiPatterns: string[];
};

const SIGNAL_LIMIT = 5;
const SIGNAL_CLIP = 180;
const PATTERN_LIMIT = 6;
const SCORE_FETCH_CAPTURED = 20;
const SCORE_CAPTURE_CAPTURED = 20;
const SCORE_VISUAL_CAPTURED = 30;
const SCORE_SNAPSHOT = 10;
const SCORE_CLONE = 8;
const SCORE_DOM = 8;
const SCORE_PUBLIC_LANDING = 6;
const SCORE_SIGNAL_CAP = 12;
const SCORE_INTENT_MISMATCH_PENALTY = 55;
const MAX_REFERENCE_SCORE = 100;
const ADVANCED_MOTION_FIELDS = [
  "Advisory shader-style gradients: specify effect type, uniforms, static fallback, and reduced-motion replacement as design language only.",
  "Advisory WebGL-style depth cues: describe layered depth, camera-like parallax, and spatial hierarchy without requiring WebGL runtime.",
  "Advisory Spline-style staging: describe object-like hero composition, scene count, camera posture, depth model, asset source, and spatial sequencing as implementation guidance only.",
  "Advanced motion performance policy: define frame budget, lazy loading, offscreen pause behavior, and vestibular risk before implementation.",
  "Runtime boundary: implement with approved CSS and Canvas-safe primitives unless explicit source-owned runtime support is added later."
] as const;

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
    || lower.includes("--gestalt-")
    || lower.includes("align-content:")
    || lower.startsWith(":root")
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
  "404",
  "page not found",
  "not found",
  "unavailable page",
  "accept all cookies",
  "cookie consent",
  "cookie preferences",
  "privacy settings",
  "consent modal",
  "javascript required",
  "javascript is required",
  "captcha",
  "verification challenge",
  "enable cookies",
  "checking if the site connection is secure",
  "complete the verification",
  "blocked reference"
] as const;

const SEARCH_OR_LISTING_SHELL_MARKERS = [
  "search results for",
  "related searches",
  "sort by",
  "filter by"
] as const;

const MARKETPLACE_CHROME_MARKERS = [
  "add to cart",
  "marketplace",
  "envato",
  "etsy",
  "template kits"
] as const;

const HARD_DIAGNOSTIC_PAGE_MARKERS = [
  "404",
  "page not found",
  "this page is unavailable",
  "accept all cookies",
  "manage cookies",
  "cookie consent",
  "sign in to continue",
  "log in to continue",
  "captcha",
  "verification challenge"
] as const;

const INTERFACE_CHROME_TEXT_MARKERS = [
  "your profile",
  "your boards",
  "remove search input",
  "settings & support",
  "pin card",
  "voice search",
  "lens",
  "back to home page",
  "toggle mobile menu",
  "facebook",
  "instagram",
  "updates",
  "messages",
  "when autocomplete results are available",
  "touch device users"
] as const;

const PUBLIC_LANDING_TEXT_MARKERS = [
  "church",
  "landing page",
  "homepage",
  "home page",
  "consulting",
  "advisory",
  "bcg",
  "ai consulting",
  "enterprise ai",
  "transformation",
  "client services",
  "business services",
  "case studies",
  "clients",
  "industries",
  "worship",
  "locations",
  "gallery",
  "atelier",
  "fashion"
] as const;

const PUBLIC_LANDING_SUPPORT_MARKERS = [
  "online",
  "events",
  "studio",
  "website",
  "full-bleed",
  "hero",
  "story",
  "stories",
  "services",
  "service",
  "cta",
] as const;

const isDiagnosticText = (value: string): boolean => {
  const lower = value.toLowerCase();
  return DIAGNOSTIC_TEXT_MARKERS.some((marker) => lower.includes(marker));
};

const diagnosticPageReasons = (value: string): string[] => {
  const lower = value.toLowerCase();
  const reasons: string[] = [];
  if (["404", "page not found", "this page is unavailable"].some((marker) => lower.includes(marker))) {
    reasons.push("unavailable_page");
  }
  if (["accept all cookies", "manage cookies", "cookie consent", "privacy settings", "enable cookies"].some((marker) => lower.includes(marker))) {
    reasons.push("cookie_or_consent_modal");
  }
  if ([
    "sign in to continue",
    "log in to continue",
    "authentication required",
    "access denied",
    "captcha",
    "verification challenge",
    "complete the verification"
  ].some((marker) => lower.includes(marker))) {
    reasons.push("login_or_challenge_state");
  }
  const searchShellCount = SEARCH_OR_LISTING_SHELL_MARKERS.filter((marker) => lower.includes(marker)).length;
  if (searchShellCount >= 2 || lower.includes("search results for") || lower.includes("related searches")) {
    reasons.push("search_or_listing_shell");
  }
  const marketplaceChromeCount = MARKETPLACE_CHROME_MARKERS.filter((marker) => lower.includes(marker)).length;
  if (
    marketplaceChromeCount >= 2
    || ((lower.includes("envato") || lower.includes("etsy")) && (lower.includes("template kits") || searchShellCount > 0))
  ) {
    reasons.push("marketplace_or_template_chrome");
  }
  if (isInterfaceChromeText(value)) {
    reasons.push("interface_chrome_shell");
  }
  return [...new Set(reasons)];
};

const isDiagnosticPageText = (value: string): boolean => {
  const lower = value.toLowerCase();
  return HARD_DIAGNOSTIC_PAGE_MARKERS.some((marker) => lower.includes(marker))
    || diagnosticPageReasons(value).length > 0;
};

const isInterfaceChromeText = (value: string): boolean => {
  const lower = value.toLowerCase();
  if (
    lower === "your profile"
    || lower === "adobe, inc."
    || lower === "dribbble: the community for graphic design"
    || /^https?:\/\/\S+$/.test(lower)
    || (lower.includes("when autocomplete results are available") && lower.includes("touch device users"))
    || (lower.includes("get 20%") && lower.includes("dribbble: the community for graphic design"))
    || (lower.includes("our free wordpress themes are downloaded") && lower.includes("get them now"))
  ) {
    return true;
  }
  const markerCount = INTERFACE_CHROME_TEXT_MARKERS.filter((marker) => lower.includes(marker)).length;
  return markerCount >= 3 || (lower.includes("pin card") && lower.includes("your profile"));
};

const hasPublicLandingSignal = (value: string): boolean => {
  const lower = value.toLowerCase();
  const strongCount = PUBLIC_LANDING_TEXT_MARKERS.filter((marker) => lower.includes(marker)).length;
  const supportCount = PUBLIC_LANDING_SUPPORT_MARKERS.filter((marker) => lower.includes(marker)).length;
  const visualLandingCombo = lower.includes("hero")
    && (lower.includes("full-bleed") || lower.includes("cta") || lower.includes("website"));
  return visualLandingCombo || strongCount >= 2 || (strongCount >= 1 && strongCount + supportCount >= 2);
};

const pushSignal = (signals: string[], value: string | undefined): void => {
  if (!value || isCodeOrCssPreview(value)) return;
  const text = cleanEvidenceText(value);
  if (isCodeOrCssPreview(text) || isDiagnosticText(text) || isInterfaceChromeText(text)) return;
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
  return text.length > 0
    && !isCodeOrCssPreview(text)
    && !isDiagnosticText(text)
    && !isDiagnosticPageText(text)
    && !isInterfaceChromeText(text);
};

const hasUsableCloneCreativeEvidence = (reference: ReferenceInput): boolean => (
  hasCleanSignal(reference.capture?.clone?.componentPreview)
);

const hasUsableRecoveredCreativeEvidence = (reference: ReferenceInput): boolean => (
  hasUsableCloneCreativeEvidence(reference)
  || hasCleanSignal(textFromHtml(reference.capture?.dom?.outerHTML))
);

const hasUsableCaptureEvidence = (reference: ReferenceInput): boolean => (
  hasCleanSignal(reference.capture?.snapshot?.content)
  || hasUsableCloneCreativeEvidence(reference)
  || hasCleanSignal(textFromHtml(reference.capture?.dom?.outerHTML))
);

const referenceDiagnosticReasons = (reference: ReferenceInput): string[] => {
  const text = [
    reference.title,
    reference.excerpt,
    reference.capture?.title,
    reference.capture?.snapshot?.content,
    textFromHtml(reference.capture?.clone?.componentPreview),
    reference.capture?.clone?.cssPreview,
    textFromHtml(reference.capture?.dom?.outerHTML),
    reference.capture?.visual?.failure,
    ...(reference.capture?.visual?.warnings ?? [])
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0).join(" ");
  return diagnosticPageReasons(text);
};

const hasBlockingDiagnosticReason = (reasons: string[]): boolean => (
  reasons.some((reason) => reason !== "login_or_challenge_state")
);

export const hasInspiredesignUsableReferenceEvidence = (reference: ReferenceInput): boolean => {
  const diagnosticReasons = referenceDiagnosticReasons(reference);
  if (hasBlockingDiagnosticReason(diagnosticReasons)) return false;
  if (diagnosticReasons.includes("login_or_challenge_state") && !hasUsableRecoveredCreativeEvidence(reference)) {
    return false;
  }
  if (reference.captureStatus === "captured" && hasUsableCaptureEvidence(reference)) return true;
  return reference.fetchStatus === "captured"
    && diagnosticReasons.length === 0
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
    value.length > 0 && !isCodeOrCssPreview(value) && !isDiagnosticText(value) && !isInterfaceChromeText(value)
  ));
  return preferred ? clipText(preferred, SIGNAL_CLIP) : reference.url;
};

const displayNameForReference = (reference: ReferenceInput, primarySignal: string): string => {
  const title = reference.title ? cleanEvidenceText(reference.title) : "";
  if (title && !isDiagnosticText(title) && !isInterfaceChromeText(title)) {
    return clipText(title, SIGNAL_CLIP);
  }
  return primarySignal !== reference.url ? primarySignal : reference.url;
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
  },
  {
    summary: "premium consulting public landing page with service narrative, client proof, and conversion CTAs",
    matches: ["consulting", "advisory", "bcg", "enterprise ai", "transformation", "client services", "case studies", "industries"]
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
  if (hasCleanSignal(reference.capture?.snapshot?.content)) methods.push("snapshot");
  if (hasUsableCloneCreativeEvidence(reference)) {
    methods.push("clone");
  }
  if (hasCleanSignal(textFromHtml(reference.capture?.dom?.outerHTML))) methods.push("dom");
  if (reference.capture?.visual?.status === "captured" && hasUsableCaptureEvidence(reference)) methods.push("visual");
  return methods;
};

const scoreReference = (
  reference: ReferenceInput,
  signals: string[],
  isPublicLanding: boolean
): number => {
  let score = 0;
  if (reference.fetchStatus === "captured") score += SCORE_FETCH_CAPTURED;
  if (reference.captureStatus === "captured" && hasUsableCaptureEvidence(reference)) score += SCORE_CAPTURE_CAPTURED;
  if (reference.capture?.visual?.status === "captured" && hasUsableCaptureEvidence(reference)) score += SCORE_VISUAL_CAPTURED;
  if (hasCleanSignal(reference.capture?.snapshot?.content)) score += SCORE_SNAPSHOT;
  if (hasUsableCloneCreativeEvidence(reference)) score += SCORE_CLONE;
  if (hasCleanSignal(textFromHtml(reference.capture?.dom?.outerHTML))) score += SCORE_DOM;
  if (isPublicLanding) score += SCORE_PUBLIC_LANDING;
  score += Math.min(SCORE_SIGNAL_CAP, signals.length * 2);
  return Math.min(MAX_REFERENCE_SCORE, score);
};

const confidenceFromScore = (score: number): number => (
  Number((score / MAX_REFERENCE_SCORE).toFixed(2))
);

const deriveVisualStrengths = (
  reference: ReferenceInput,
  patterns: string[]
): string[] => {
  const strengths = [
    ...(reference.capture?.visual?.status === "captured"
      ? ["Screenshot artifact is available for direct visual inspection."]
      : []),
    ...(reference.capture?.snapshot?.content.trim()
      ? ["Snapshot text confirms visible hierarchy and interaction targets."]
      : []),
    ...(hasUsableCloneCreativeEvidence(reference)
      ? ["Clone preview exposes reusable component and styling cues."]
      : []),
    ...patterns.slice(0, 2).map((pattern) => `Reusable visual cue: ${pattern}.`)
  ];
  return strengths.slice(0, PATTERN_LIMIT);
};

const deriveVisualRisks = (reference: ReferenceInput): string[] => {
  const risks = [
    ...(reference.capture?.visual?.status !== "captured"
      ? ["No finalized screenshot artifact, so visual claims must stay conservative."]
      : []),
    ...(reference.capture?.visual?.status === "failed" && reference.capture.visual.failure
      ? [`Screenshot failure: ${reference.capture.visual.failure}.`]
      : []),
    ...(reference.capture?.visual?.warnings ?? []).map((warning) => `Screenshot warning: ${warning}.`),
    ...(reference.fetchStatus !== "captured"
      ? ["Fetch evidence failed or was skipped, so use browser capture cautiously."]
      : [])
  ];
  return risks.length > 0
    ? risks.slice(0, PATTERN_LIMIT)
    : ["No major visual evidence risk detected in the captured reference."];
};

const selectionReasonForScore = (score: number, capturedVia: string[]): string => {
  if (capturedVia.includes("visual")) {
    return `Ranked for screenshot-backed visual evidence plus ${capturedVia.join(", ")} capture.`;
  }
  if (score >= 50) {
    return `Ranked for strong text and structural evidence from ${capturedVia.join(", ") || "reference metadata"}.`;
  }
  return "Ranked for limited but usable reference cues.";
};

const deriveComponentFamilies = (
  format: InspiredesignBriefFormat,
  patterns: string[],
  isPublicLanding: boolean
): string[] => {
  const base = isPublicLanding
    ? "hero composition, proof bands, narrative pathways, service or story sections, conversion CTA, and footer"
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

const INTENT_STOP_WORDS = new Set([
  "and",
  "cinematic",
  "dark",
  "digital",
  "for",
  "from",
  "landing",
  "light",
  "microinteractions",
  "motion",
  "page",
  "parallax",
  "premium",
  "reveal",
  "site",
  "scroll",
  "theme",
  "with",
  "design",
  "website"
]);

const tokenizeIntent = (value: string): string[] => (
  value.toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) ?? []
).filter((token) => !INTENT_STOP_WORDS.has(token));

const formatIntentTokens = (format: InspiredesignBriefFormat): string[] => [
  ...format.keywords,
  ...format.businessFocus,
  ...format.bestFor,
  ...(format.focusAreas ?? []),
  format.archetype,
  format.layoutArchetype,
  format.surfaceTreatment,
  format.motionGrammar,
  format.paletteIntent
].flatMap(tokenizeIntent);

const intentTokenVariants = (token: string): string[] => {
  if (token === "photo" || token === "photos" || token === "photography" || token === "photographer" || token === "photographic") {
    return ["photo", "photos", "photography", "photographer", "photographic"];
  }
  return [token];
};

const countMatchedIntentTokens = (signals: string[], intentTokens: string[]): number => {
  const evidenceTokens = new Set(signals.flatMap(tokenizeIntent));
  return intentTokens.filter((token) => intentTokenVariants(token).some((variant) => evidenceTokens.has(variant))).length;
};

const hasBriefIntentMatch = (
  signals: string[],
  format: InspiredesignBriefFormat,
  briefText: string
): boolean => {
  const briefTokens = tokenizeIntent(briefText);
  const hasBriefIntentTokens = briefTokens.length > 0;
  const intentTokens = [...new Set(hasBriefIntentTokens ? briefTokens : formatIntentTokens(format))];
  if (intentTokens.length === 0) return true;
  const matchCount = countMatchedIntentTokens(signals, intentTokens);
  if (!hasBriefIntentTokens) return matchCount > 0;
  return matchCount >= Math.min(2, intentTokens.length);
};

const deriveReferenceEntry = (
  reference: ReferenceInput,
  format: InspiredesignBriefFormat,
  briefText: string
): Omit<InspiredesignReferencePatternBoard["references"][number], "rank"> => {
  const signals = getInspiredesignReferenceSignals(reference);
  const primarySignal = firstSignal(reference);
  const patterns = appendSourceDetail(derivePatternSummaries(signals, primarySignal), primarySignal);
  const isPublicLanding = signals.some(hasPublicLandingSignal);
  const capturedVia = deriveCapturedVia(reference);
  const intentMatched = hasBriefIntentMatch(signals, format, briefText);
  const rawScore = scoreReference(reference, signals, isPublicLanding);
  const score = intentMatched ? rawScore : Math.max(0, rawScore - SCORE_INTENT_MISMATCH_PENALTY);
  return {
    id: reference.id,
    score,
    confidence: confidenceFromScore(score),
    name: displayNameForReference(reference, primarySignal),
    url: reference.url,
    surfaceType: isPublicLanding ? "public landing page" : format.archetype,
    capturedVia,
    intentMatched,
    selectionReason: intentMatched
      ? selectionReasonForScore(score, capturedVia)
      : `${selectionReasonForScore(score, capturedVia)} Intent overlap with the brief is weak, so the score was downgraded.`,
    visualStrengths: deriveVisualStrengths(reference, patterns),
    visualRisks: deriveVisualRisks(reference),
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

const sortReferenceEntries = (
  entries: Array<Omit<InspiredesignReferencePatternBoard["references"][number], "rank">>
): Array<InspiredesignReferencePatternBoard["references"][number]> => entries
  .slice()
  .sort((left, right) => (
    right.score - left.score
      || left.id.localeCompare(right.id)
      || left.url.localeCompare(right.url)
  ))
  .map((entry, index) => ({
    rank: index + 1,
    ...entry
  }));

const rejectionReasonForReference = (reference: ReferenceInput): string => {
  const diagnosticReasons = referenceDiagnosticReasons(reference);
  if (diagnosticReasons.length > 0) {
    return `Reference evidence is diagnostic-only: ${diagnosticReasons.join(", ")}.`;
  }
  if (reference.fetchStatus === "failed" && reference.captureStatus === "failed") {
    return "Fetch and capture did not produce usable creative evidence.";
  }
  if (reference.captureStatus === "failed") {
    return "Capture did not produce usable creative evidence.";
  }
  if (reference.fetchStatus === "failed") {
    return "Fetch did not produce usable creative evidence.";
  }
  return "Reference evidence was diagnostic, empty, or too weak for creative synthesis.";
};

const buildRejectedReferences = (
  references: ReferenceInput[]
): InspiredesignReferencePatternBoard["rejectedReferences"] => references
  .filter((reference) => !hasInspiredesignUsableReferenceEvidence(reference))
  .map((reference) => ({
    id: reference.id,
    url: reference.url,
    reason: rejectionReasonForReference(reference),
    fetchStatus: reference.fetchStatus,
    captureStatus: reference.captureStatus
  }));

const buildQualitySummary = (
  references: ReferenceInput[],
  rankedEntries: InspiredesignReferencePatternBoard["references"],
  rejectedReferences: InspiredesignReferencePatternBoard["rejectedReferences"]
): InspiredesignReferenceQualitySummary => {
  const diagnosticOnlyReasons = [...new Set(references.flatMap(referenceDiagnosticReasons))];
  const rankedIds = new Set(rankedEntries.map((entry) => entry.id));
  const rankedReferences = references.filter((reference) => rankedIds.has(reference.id));
  const failedCaptureCount = rankedReferences.filter((reference) => reference.captureStatus === "failed").length;
  const missingScreenshotCount = rankedReferences.filter((reference) => reference.capture?.visual?.status !== "captured").length;
  const topReference = rankedEntries[0];
  return {
    rankedReferenceCount: rankedEntries.length,
    rejectedReferenceCount: rejectedReferences.length,
    failedCaptureCount,
    missingScreenshotCount,
    diagnosticOnlyReasons,
    ...(topReference
      ? {
        topReferenceScore: topReference.score,
        topReferenceConfidence: topReference.confidence,
        topReferenceIntentMatched: topReference.intentMatched
      }
      : {})
  };
};

export const summarizeInspiredesignReferenceQuality = (
  board: InspiredesignReferencePatternBoard
): InspiredesignReferenceQualitySummary => ({ ...board.qualitySummary });

export const buildInspiredesignReferencePatternBoard = (
  briefId: string,
  format: InspiredesignBriefFormat,
  references: ReferenceInput[],
  briefText = ""
): InspiredesignReferencePatternBoard => {
  const entries = references
    .filter(hasInspiredesignUsableReferenceEvidence)
    .map((reference) => deriveReferenceEntry(reference, format, briefText));
  const rankedEntries = sortReferenceEntries(entries);
  const rejectedReferences = buildRejectedReferences(references);
  const sharedStrengths = rankedEntries.flatMap((entry) => entry.patternsToBorrow).slice(0, 6);
  const targetSurface = rankedEntries.some((entry) => entry.surfaceType === "public landing page")
    ? "reference-led public landing page"
    : format.layoutArchetype;
  return {
    briefId,
    targetSurface,
    qualitySummary: buildQualitySummary(references, rankedEntries, rejectedReferences),
    references: rankedEntries,
    rejectedReferences,
    synthesis: {
      dominantDirection: rankedEntries[0]?.layoutRecipe ?? format.archetype,
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
    return "low-to-medium; prioritize visual overview, proof scanning, and a small number of clear action paths.";
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
      "Build a clear sequence from hero, proof, story, service pathways, impact, conversion CTA, and footer."
    ];
  }
  if (format.route.profile === "documentation") {
    return [
      "Use a text-light overview sequence for purpose, proof, examples, action paths, and footer.",
      "Keep long-form reference depth, citation modules, annotation rails, and methodology blocks out of the primary visual route."
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
    "Build a clear sequence from hero, proof, story, service pathways, impact, conversion CTA, and footer."
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
    advancedMotionAdvisory: [...ADVANCED_MOTION_FIELDS],
    referenceInfluence: influence,
    patternsToBorrow: board.references.flatMap((entry) => entry.patternsToBorrow).slice(0, 8),
    patternsToReject: board.references.flatMap((entry) => entry.patternsToReject).slice(0, 8),
    guardrails: [...format.guardrails],
    antiPatterns: [...format.antiPatterns]
  };
};
