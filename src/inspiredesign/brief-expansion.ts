import type {
  CanvasNavigationModel,
  CanvasThemeStrategy,
  CanvasVisualDirectionProfile
} from "../canvas/types";
import templateJson from "../../skills/opendevbrowser-design-agent/assets/templates/inspiredesign-advanced-brief.v1.json";

type InspiredesignBriefMatchSignals = {
  positive: string[];
  required?: string[];
  excluded?: string[];
  tieBreaker?: number;
};

type InspiredesignBriefFormatRoute = {
  profile: CanvasVisualDirectionProfile;
  themeStrategy: CanvasThemeStrategy;
  navigationModel: CanvasNavigationModel;
  layoutApproach: string;
};

type InspiredesignBriefFormatTemplate = {
  id: string;
  label: string;
  bestFor: string[];
  businessFocus: string[];
  keywords: string[];
  matchSignals: InspiredesignBriefMatchSignals;
  lead: string;
  archetype: string;
  layoutArchetype: string;
  typographySystem: string;
  surfaceTreatment: string;
  shapeLanguage: string;
  componentGrammar: string;
  motionGrammar: string;
  paletteIntent: string;
  visualDensity: string;
  designVariance: string;
  focusAreas: string[];
  responsiveCollapseRules: string[];
  guardrails: string[];
  antiPatterns: string[];
  deliverables: string[];
  route: InspiredesignBriefFormatRoute;
};

type InspiredesignBriefTemplate = {
  version: string;
  defaultFormatId: string;
  commonRules: string[];
  outputRequirements: string[];
  formats: InspiredesignBriefFormatTemplate[];
};

export type InspiredesignBriefFormat = {
  id: string;
  label: string;
  bestFor: string[];
  businessFocus: string[];
  keywords: string[];
  archetype: string;
  layoutArchetype: string;
  typographySystem: string;
  surfaceTreatment: string;
  shapeLanguage: string;
  componentGrammar: string;
  motionGrammar: string;
  paletteIntent: string;
  visualDensity: string;
  designVariance: string;
  responsiveCollapseRules: string[];
  guardrails: string[];
  antiPatterns: string[];
  deliverables: string[];
  route: InspiredesignBriefFormatRoute;
};

export type InspiredesignBriefExpansion = {
  sourceBrief: string;
  advancedBrief: string;
  templateVersion: string;
  format: InspiredesignBriefFormat;
};

const BRIEF_TEMPLATE = templateJson as InspiredesignBriefTemplate;

export const normalizeInspiredesignBriefText = (value: string): string => value.trim().replace(/\s+/g, " ");

const formatBulletList = (items: readonly string[]): string => items.map((item) => `- ${item}`).join("\n");

const countMatches = (brief: string, keywords: readonly string[]): number => {
  const haystack = brief.toLowerCase();
  return keywords.reduce(
    (total, keyword) => total + (haystack.includes(keyword.toLowerCase()) ? 1 : 0),
    0
  );
};

const cloneStringList = (items: readonly string[]): string[] => [...items];

const cloneRoute = (route: InspiredesignBriefFormatRoute): InspiredesignBriefFormatRoute => ({
  profile: route.profile,
  themeStrategy: route.themeStrategy,
  navigationModel: route.navigationModel,
  layoutApproach: route.layoutApproach
});

export const cloneInspiredesignBriefFormat = (
  format: InspiredesignBriefFormat
): InspiredesignBriefFormat => ({
  id: format.id,
  label: format.label,
  bestFor: cloneStringList(format.bestFor),
  businessFocus: cloneStringList(format.businessFocus),
  keywords: cloneStringList(format.keywords),
  archetype: format.archetype,
  layoutArchetype: format.layoutArchetype,
  typographySystem: format.typographySystem,
  surfaceTreatment: format.surfaceTreatment,
  shapeLanguage: format.shapeLanguage,
  componentGrammar: format.componentGrammar,
  motionGrammar: format.motionGrammar,
  paletteIntent: format.paletteIntent,
  visualDensity: format.visualDensity,
  designVariance: format.designVariance,
  responsiveCollapseRules: cloneStringList(format.responsiveCollapseRules),
  guardrails: cloneStringList(format.guardrails),
  antiPatterns: cloneStringList(format.antiPatterns),
  deliverables: cloneStringList(format.deliverables),
  route: cloneRoute(format.route)
});

const summarizeFormat = (format: InspiredesignBriefFormatTemplate): InspiredesignBriefFormat => ({
  id: format.id,
  label: format.label,
  bestFor: cloneStringList(format.bestFor),
  businessFocus: cloneStringList(format.businessFocus),
  keywords: cloneStringList(format.keywords),
  archetype: format.archetype,
  layoutArchetype: format.layoutArchetype,
  typographySystem: format.typographySystem,
  surfaceTreatment: format.surfaceTreatment,
  shapeLanguage: format.shapeLanguage,
  componentGrammar: format.componentGrammar,
  motionGrammar: format.motionGrammar,
  paletteIntent: format.paletteIntent,
  visualDensity: format.visualDensity,
  designVariance: format.designVariance,
  responsiveCollapseRules: cloneStringList(format.responsiveCollapseRules),
  guardrails: cloneStringList(format.guardrails),
  antiPatterns: cloneStringList(format.antiPatterns),
  deliverables: cloneStringList(format.deliverables),
  route: cloneRoute(format.route)
});

const getDefaultFormat = (): InspiredesignBriefFormatTemplate => {
  const defaultFormat = BRIEF_TEMPLATE.formats.find((format) => format.id === BRIEF_TEMPLATE.defaultFormatId)
    ?? BRIEF_TEMPLATE.formats[0];
  if (!defaultFormat) {
    throw new Error("Inspiredesign brief template must define at least one format.");
  }
  return defaultFormat;
};

const scoreFormat = (sourceBrief: string, format: InspiredesignBriefFormatTemplate): number => {
  const requiredMatches = countMatches(sourceBrief, format.matchSignals.required ?? []);
  if ((format.matchSignals.required?.length ?? 0) > 0 && requiredMatches === 0) {
    return Number.NEGATIVE_INFINITY;
  }
  const excludedMatches = countMatches(sourceBrief, format.matchSignals.excluded ?? []);
  const positiveMatches = countMatches(sourceBrief, format.matchSignals.positive);
  return (positiveMatches * 4)
    + (requiredMatches * 6)
    - (excludedMatches * 8)
    + (format.matchSignals.tieBreaker ?? 0);
};

const chooseFormat = (sourceBrief: string): InspiredesignBriefFormatTemplate => {
  const defaultFormat = getDefaultFormat();
  const seeded = {
    score: scoreFormat(sourceBrief, defaultFormat) + 0.5,
    format: defaultFormat
  };
  return BRIEF_TEMPLATE.formats.reduce((best, format) => {
    const score = scoreFormat(sourceBrief, format);
    return score > best.score ? { score, format } : best;
  }, seeded).format;
};

const buildReturnRequirements = (format: InspiredesignBriefFormatTemplate): string[] => (
  [...new Set([...format.deliverables, ...BRIEF_TEMPLATE.outputRequirements])]
);

const buildRouteDefaults = (format: InspiredesignBriefFormatTemplate): string[] => ([
  `profile: ${format.route.profile}`,
  `theme strategy: ${format.route.themeStrategy}`,
  `navigation model: ${format.route.navigationModel}`,
  `layout approach: ${format.route.layoutApproach}`
]);

const buildDesignDirection = (format: InspiredesignBriefFormatTemplate): string[] => ([
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
]);

const renderAdvancedBrief = (
  sourceBrief: string,
  format: InspiredesignBriefFormatTemplate
): string => [
  `Selected prompt format: ${format.label}`,
  "",
  "Source brief:",
  sourceBrief,
  "",
  "Prompt objective:",
  format.lead,
  "",
  "Business focus:",
  formatBulletList(format.businessFocus),
  "",
  "Keywords:",
  formatBulletList(format.keywords),
  "",
  "Route defaults:",
  formatBulletList(buildRouteDefaults(format)),
  "",
  "Design direction:",
  formatBulletList(buildDesignDirection(format)),
  "",
  "Focus areas:",
  formatBulletList(format.focusAreas),
  "",
  "Responsive collapse rules:",
  formatBulletList(format.responsiveCollapseRules),
  "",
  "Execution rules:",
  formatBulletList([...BRIEF_TEMPLATE.commonRules, ...format.guardrails]),
  "",
  "Anti-patterns:",
  formatBulletList(format.antiPatterns),
  "",
  "Return:",
  formatBulletList(buildReturnRequirements(format)),
  "",
  "Best fit use cases:",
  formatBulletList(format.bestFor)
].join("\n");

export const expandInspiredesignBrief = (brief: string): InspiredesignBriefExpansion => {
  const sourceBrief = normalizeInspiredesignBriefText(brief);
  const format = chooseFormat(sourceBrief);
  return {
    sourceBrief,
    advancedBrief: renderAdvancedBrief(sourceBrief, format),
    templateVersion: BRIEF_TEMPLATE.version,
    format: summarizeFormat(format)
  };
};
