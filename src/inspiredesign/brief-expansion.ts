import templateJson from "../../skills/opendevbrowser-design-agent/assets/templates/inspiredesign-advanced-brief.v1.json";

type InspiredesignBriefFormatTemplate = {
  id: string;
  label: string;
  bestFor: string[];
  matchKeywords: string[];
  lead: string;
  focusAreas: string[];
  guardrails: string[];
  deliverables: string[];
};

type InspiredesignBriefTemplate = {
  version: string;
  defaultFormatId: string;
  commonRules: string[];
  outputRequirements: string[];
  formats: InspiredesignBriefFormatTemplate[];
};

export type InspiredesignBriefExpansion = {
  sourceBrief: string;
  advancedBrief: string;
  templateVersion: string;
  format: {
    id: string;
    label: string;
    bestFor: string[];
  };
};

const BRIEF_TEMPLATE = templateJson as InspiredesignBriefTemplate;

const normalizeWhitespace = (value: string): string => value.trim().replace(/\s+/g, " ");

const formatBulletList = (items: readonly string[]): string => items.map((item) => `- ${item}`).join("\n");

const countMatches = (brief: string, keywords: readonly string[]): number => {
  const haystack = brief.toLowerCase();
  return keywords.reduce(
    (total, keyword) => total + (haystack.includes(keyword.toLowerCase()) ? 1 : 0),
    0
  );
};

const getDefaultFormat = (): InspiredesignBriefFormatTemplate => {
  const defaultFormat = BRIEF_TEMPLATE.formats.find((format) => format.id === BRIEF_TEMPLATE.defaultFormatId)
    ?? BRIEF_TEMPLATE.formats[0];
  if (!defaultFormat) {
    throw new Error("Inspiredesign brief template must define at least one format.");
  }
  return defaultFormat;
};

const chooseFormat = (sourceBrief: string): InspiredesignBriefFormatTemplate => {
  const defaultFormat = getDefaultFormat();
  const seeded = {
    score: countMatches(sourceBrief, defaultFormat.matchKeywords),
    format: defaultFormat
  };
  return BRIEF_TEMPLATE.formats.reduce((best, format) => {
    const score = countMatches(sourceBrief, format.matchKeywords);
    return score > best.score ? { score, format } : best;
  }, seeded).format;
};

const buildReturnRequirements = (format: InspiredesignBriefFormatTemplate): string[] => (
  [...new Set([...format.deliverables, ...BRIEF_TEMPLATE.outputRequirements])]
);

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
  "Focus areas:",
  formatBulletList(format.focusAreas),
  "",
  "Execution rules:",
  formatBulletList([...BRIEF_TEMPLATE.commonRules, ...format.guardrails]),
  "",
  "Return:",
  formatBulletList(buildReturnRequirements(format)),
  "",
  "Best fit use cases:",
  formatBulletList(format.bestFor)
].join("\n");

export const expandInspiredesignBrief = (brief: string): InspiredesignBriefExpansion => {
  const sourceBrief = normalizeWhitespace(brief);
  const format = chooseFormat(sourceBrief);
  return {
    sourceBrief,
    advancedBrief: renderAdvancedBrief(sourceBrief, format),
    templateVersion: BRIEF_TEMPLATE.version,
    format: {
      id: format.id,
      label: format.label,
      bestFor: [...format.bestFor]
    }
  };
};
