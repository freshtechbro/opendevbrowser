import type { ResearchRecord } from "../enrichment";
import type { ResearchBriefingPassage } from "./types";
import {
  compareStableText,
  evidenceFocusTerms,
  focusedTextWindow,
  MIN_USABLE_CONTENT_CHARS,
  normalizeWhitespace,
  recordContentChars,
  recordTitle,
  splitSentences,
  tokenize,
  topicTokens
} from "./rules";

const MAX_PASSAGES = 12;
const PASSAGE_CONTEXT_CHARACTERS = 360;
const PASSAGE_CONTEXT_LEAD_CHARS = 0;
const MIN_FEATURE_TEXT_CHARACTERS = 24;
const FEATURE_PASSAGE_SCORE_BONUS = 14;
const PRACTICE_TERM_SCORE_BONUS = 3;
const BOILERPLATE_SCORE_PENALTY = 8;
const LOW_SIGNAL_PASSAGE_SCORE_PENALTY = 18;
const LOW_SIGNAL_CUE_THRESHOLD = 2;

const ACTIONABLE_EVIDENCE_TERMS = [
  "anti-bot",
  "accessibility",
  "adaptation",
  "adapts",
  "alert",
  "alerts",
  "backoff",
  "checkpointing",
  "claim",
  "claims",
  "confidence",
  "dom",
  "evidence",
  "escalation",
  "failure",
  "gate",
  "gates",
  "human",
  "human-in-the-loop",
  "identification",
  "limitations",
  "locators",
  "map",
  "maps",
  "monitor",
  "monitoring",
  "monitors",
  "oversight",
  "recording",
  "recordings",
  "recovery",
  "retries",
  "retry",
  "screenshots",
  "semantic",
  "selectors",
  "session",
  "self-healing",
  "stable",
  "stability",
  "traces",
  "validation",
  "verification",
  "wait"
] as const;

const PRACTICE_FEATURE_TERMS = [
  "adapt",
  "adapts",
  "alert",
  "alerts",
  "backoff",
  "bounded",
  "captcha",
  "checkpoint",
  "checkpointing",
  "escalate",
  "fingerprint",
  "failure",
  "human",
  "human-in-the-loop",
  "identification",
  "log",
  "monitor",
  "oversight",
  "pattern",
  "patterns",
  "prefer",
  "proxy",
  "replay",
  "retry",
  "retries",
  "screenshot",
  "screenshots",
  "selector",
  "selectors",
  "session",
  "self-healing",
  "stable",
  "recording",
  "recordings",
  "trace",
  "traces",
  "validation",
  "validate",
  "verification",
  "verifies",
  "verify"
] as const;
const PRACTICE_FOCUS_TERMS = [...new Set([
  ...ACTIONABLE_EVIDENCE_TERMS,
  ...PRACTICE_FEATURE_TERMS
])];

const BOILERPLATE_CUES = [
  "accept reject manage cookies",
  "browser automation cloud accessibility testing",
  "browser automation platforms in 2026 table of content",
  "download microsoft edge",
  "features pricing demo blog resources",
  "home /",
  "mobile app testing app live",
  "open main menu",
  "privacy statement",
  "profile analytics settings",
  "related articles",
  "share:",
  "sign in profile",
  "skip to main content",
  "suggestions will filter"
] as const;

const COMMAND_LIKE_CUES = [
  " npx ",
  " npm ",
  " pnpm ",
  " yarn ",
  " pip install ",
  " curl ",
  "firecrawl browser",
  " from firecrawl import ",
  "open https://example.com"
] as const;

const COMMAND_LIKE_PATTERNS = [
  /\bnpx\s+-[a-z]/i,
  /\b(?:npm|pnpm|yarn)\s+(?:run|add|install|exec)\b/i,
  /\b(?:python|node)\s+[\w./-]+\.(?:js|mjs|ts|py)\b/i,
  /#\s+[A-Z][A-Za-z]+/
] as const;

const COMPARISON_TABLE_CUES = [
  " api +",
  "break scripts adapt dynamically",
  "built-in reasoning",
  "developers building",
  "e-commerce price monitoring",
  "free tier",
  "high volume, low cost per execution",
  "inventory tracking, competitor analysis",
  "llm costs",
  "open-source sdk",
  "semantic understanding error recovery",
  "traditional automation excels",
  "typescript developers"
] as const;

const COMPARISON_TABLE_PATTERNS = [
  /\$\d+(?:\/mo|\s*per\s*month)?/i,
  /\d{2,3},\d{3}\+/,
  /\bfree\s*\(\+\s*llm costs\)/i
] as const;

const HEADER_TITLE_CUES = [
  "browser agent that outperforms",
  "achieving 90%+ reliability in enterprise automation ai & automation"
] as const;

const cueMatchCount = (value: string, cues: readonly string[]): number => (
  cues.filter((cue) => value.includes(cue.toLowerCase())).length
);

const patternMatchCount = (value: string, patterns: readonly RegExp[]): number => (
  patterns.filter((pattern) => pattern.test(value)).length
);

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const matchedPracticeFocusTerms = (sentence: string): string[] => {
  const normalized = normalizeWhitespace(sentence).toLowerCase();
  return PRACTICE_FOCUS_TERMS
  .map((term) => ({
    term,
    index: normalized.search(new RegExp(`\\b${escapeRegex(term)}\\b`, "i"))
  }))
  .filter((entry) => entry.index >= 0)
  .sort((left, right) => left.index - right.index)
  .map((entry) => entry.term);
};

const hasBoilerplateCue = (value: string): boolean => {
  const normalized = normalizeWhitespace(value).toLowerCase();
  return BOILERPLATE_CUES.some((cue) => normalized.includes(cue));
};

const hasHeaderTitleCue = (value: string): boolean => {
  const normalized = normalizeWhitespace(value).toLowerCase();
  return HEADER_TITLE_CUES.some((cue) => normalized.includes(cue));
};

const isCommandLikeEvidenceText = (value: string): boolean => {
  const normalized = ` ${normalizeWhitespace(value).toLowerCase()} `;
  const matchCount = cueMatchCount(normalized, COMMAND_LIKE_CUES)
    + patternMatchCount(normalized, COMMAND_LIKE_PATTERNS);
  return matchCount >= LOW_SIGNAL_CUE_THRESHOLD;
};

const isComparisonTableEvidenceText = (value: string): boolean => {
  const normalized = ` ${normalizeWhitespace(value).toLowerCase()} `;
  const matchCount = cueMatchCount(normalized, COMPARISON_TABLE_CUES)
    + patternMatchCount(normalized, COMPARISON_TABLE_PATTERNS);
  return matchCount >= LOW_SIGNAL_CUE_THRESHOLD;
};

export const isLowSignalEvidenceText = (value: string): boolean => (
  isCommandLikeEvidenceText(value) || isComparisonTableEvidenceText(value)
);

export const phraseIsActionable = (phrase: string): boolean => {
  const tokens = tokenize(phrase);
  return tokens.some((token) => ACTIONABLE_EVIDENCE_TERMS.includes(token as typeof ACTIONABLE_EVIDENCE_TERMS[number]));
};

const focusedPassageText = (sentence: string, terms: readonly string[]): string => {
  const focusTerms = [...matchedPracticeFocusTerms(sentence), ...terms];
  const window = focusedTextWindow(sentence, focusTerms, PASSAGE_CONTEXT_CHARACTERS + PASSAGE_CONTEXT_LEAD_CHARS);
  return normalizeWhitespace(window);
};

const cleanContentSentence = (sentence: string, focusTerms: readonly string[]): string | null => {
  const normalized = normalizeWhitespace(sentence);
  if (!hasBoilerplateCue(normalized)) return normalized;
  const focused = focusedPassageText(normalized, focusTerms);
  return focused && !hasBoilerplateCue(focused) && !hasHeaderTitleCue(focused) ? focused : null;
};

const passageSignalScore = (sentence: string, topicTerms: readonly string[], titleTerms: readonly string[]): number => {
  const sentenceTerms = new Set(tokenize(sentence));
  const normalized = normalizeWhitespace(sentence).toLowerCase();
  return topicTerms.filter((term) => sentenceTerms.has(term)).length * 4
    + titleTerms.filter((term) => sentenceTerms.has(term)).length * 2
    + ACTIONABLE_EVIDENCE_TERMS.filter((term) => normalized.includes(term)).length * PRACTICE_TERM_SCORE_BONUS;
};

const passagePenalty = (sentence: string): number => {
  const boilerplatePenalty = hasBoilerplateCue(sentence) ? BOILERPLATE_SCORE_PENALTY : 0;
  const lowSignalPenalty = isLowSignalEvidenceText(sentence) ? LOW_SIGNAL_PASSAGE_SCORE_PENALTY : 0;
  return boilerplatePenalty + lowSignalPenalty;
};

const passageScore = (args: {
  sentence: string;
  record: ResearchRecord;
  topicTerms: readonly string[];
  titleTerms: readonly string[];
  feature: boolean;
}): number => (
  passageSignalScore(args.sentence, args.topicTerms, args.titleTerms)
  + (args.feature ? FEATURE_PASSAGE_SCORE_BONUS : 0)
  + args.record.confidence
  + (args.record.recency.within_timebox ? 1 : 0)
  + (recordContentChars(args.record) >= MIN_USABLE_CONTENT_CHARS ? 1 : 0)
  - passagePenalty(args.sentence)
);

const isPracticeFeatureText = (value: string): boolean => {
  const normalized = normalizeWhitespace(value).toLowerCase();
  return !isLowSignalEvidenceText(normalized)
    && PRACTICE_FEATURE_TERMS.some((term) => normalized.includes(term));
};

const recordFeatureTexts = (record: ResearchRecord): string[] => {
  const features = record.attributes.features;
  if (!Array.isArray(features)) return [];
  return features.flatMap((feature) => {
    if (typeof feature !== "string") return [];
    const normalized = normalizeWhitespace(feature);
    return normalized.length >= MIN_FEATURE_TEXT_CHARACTERS && isPracticeFeatureText(normalized) ? [normalized] : [];
  });
};

const contentEntries = (record: ResearchRecord, focusTerms: readonly string[]): Array<{ sentence: string; feature: boolean }> => (
  splitSentences(record.content ?? "").flatMap((sentence) => {
    const cleanSentence = cleanContentSentence(sentence, focusTerms);
    return cleanSentence ? [{ sentence: cleanSentence, feature: false }] : [];
  })
);

const passageEntry = (args: {
  entry: { sentence: string; feature: boolean };
  index: number;
  record: ResearchRecord;
  topicTerms: readonly string[];
  titleTerms: readonly string[];
  focusTerms: readonly string[];
}): ResearchBriefingPassage => ({
  recordId: args.record.id,
  title: recordTitle(args.record),
  url: args.record.url ?? "URL not provided",
  source: args.record.source,
  provider: args.record.provider,
  text: focusedPassageText(args.entry.sentence, args.focusTerms),
  analysisText: normalizeWhitespace(args.entry.sentence),
  score: passageScore({
    sentence: args.entry.sentence,
    record: args.record,
    topicTerms: args.topicTerms,
    titleTerms: args.titleTerms,
    feature: args.entry.feature
  }) - args.index * 0.01
});

const passagesForRecord = (
  record: ResearchRecord,
  topicTerms: readonly string[]
): ResearchBriefingPassage[] => {
  const titleTerms = tokenize(recordTitle(record));
  const focusTerms = evidenceFocusTerms(topicTerms.join(" "), recordTitle(record));
  const featureEntries = recordFeatureTexts(record).map((sentence) => ({ sentence, feature: true }));
  return [...featureEntries, ...contentEntries(record, focusTerms)].map((entry, index) => (
    passageEntry({ entry, index, record, topicTerms, titleTerms, focusTerms })
  ));
};

export const selectPassages = (topic: string, records: readonly ResearchRecord[]): ResearchBriefingPassage[] => {
  const terms = topicTokens(topic);
  return records
  .flatMap((record) => passagesForRecord(record, terms))
  .sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return compareStableText(`${left.recordId}:${left.text}`, `${right.recordId}:${right.text}`);
  })
  .slice(0, MAX_PASSAGES);
};
