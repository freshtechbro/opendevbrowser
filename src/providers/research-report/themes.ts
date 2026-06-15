import type { ResearchRecord } from "../enrichment";
import type { ResearchBriefingPassage, ResearchBriefingTheme } from "./types";
import {
  compareStableText,
  disagreementCuesForText,
  normalizeWhitespace,
  registrableDomainFromUrl,
  tokenize,
  topicTokens
} from "./rules";
import { isLowSignalEvidenceText, phraseIsActionable } from "./passages";
import { isSemanticThemePhrase, semanticPhrasesForPassage, semanticThemeEvidenceScore } from "./semantic-themes";

const MAX_THEMES = 10;
const MAX_THEME_PASSAGES = 3;
const MAX_SINGLE_SOURCE_THEMES_PER_PRIMARY_RECORD = 3;
const MIN_THEME_TOKEN_COUNT = 2;
const MIN_TOPIC_ECHO_SOURCE_COUNT = 2;
const ACTIONABLE_THEME_SCORE_BONUS = 8;
const TOPIC_ECHO_SCORE_PENALTY = 8;

const WEAK_THEME_LEADING_TOKENS = new Set([
  "apis",
  "automate",
  "runs",
  "support",
  "supports",
  "tool",
  "tools",
  "via",
  "websites",
  "workflows"
]);
const WEAK_THEME_TOKENS = new Set([
  "appears",
  "based",
  "closer",
  "compare",
  "compares",
  "core",
  "exactly",
  "execution",
  "goal",
  "increasingly",
  "keep",
  "keeps",
  "management",
  "need",
  "needs",
  "runs",
  "should",
  "specific",
  "support",
  "supports",
  "task",
  "than"
]);
const BROWSER_ENGINE_FRAGMENT_TOKENS = new Set([
  "chrome",
  "chromium",
  "edge",
  "firefox",
  "playwright",
  "puppeteer",
  "safari",
  "selenium",
  "webdriver",
  "webkit"
]);
const WEAK_TOPIC_FRAGMENT_TOKENS = new Set([
  "ai-driven",
  "capabilities",
  ...BROWSER_ENGINE_FRAGMENT_TOKENS,
  "framework",
  "frameworks",
  "platform",
  "platforms",
  "signals"
]);
const TOPIC_ANCHORED_PLATFORM_TOKENS = new Set([
  "agent",
  "agents",
  "browser",
  "browsers",
  "instance",
  "instances",
  "managed",
  "provider",
  "providers",
  "workflow",
  "workflows"
]);
const WEAK_MONITORING_ACTION_TOKENS = new Set(["monitor", "monitoring", "monitors"]);
const WEAK_MONITORING_OBJECT_TOKENS = new Set(["action", "content", "data", "price", "result"]);
const GENERIC_THEME_TOKENS = new Set([
  "actions",
  "agent",
  "agents",
  "browser",
  "browsers",
  "call",
  "calls",
  "chrome",
  "context",
  "control",
  "did",
  "read",
  "reads",
  "sessions",
  "use",
  "uses",
  "web",
  "workflows",
  "you",
  "your"
]);

const phrasesFromTokens = (tokens: readonly string[]): string[] => {
  const phrases: string[] = [];
  for (let index = 0; index <= tokens.length - MIN_THEME_TOKEN_COUNT; index += 1) {
    const phraseTokens = tokens.slice(index, index + MIN_THEME_TOKEN_COUNT);
    if (phraseTokens.some((token) => /^\d+$/.test(token))) continue;
    if (phraseTokens.some((token) => WEAK_THEME_TOKENS.has(token))) continue;
    if (phraseIsWeakMonitoringObject(phraseTokens)) continue;
    if (new Set(phraseTokens).size !== phraseTokens.length) continue;
    if (WEAK_THEME_LEADING_TOKENS.has(phraseTokens[0] ?? "")) continue;
    phrases.push(phraseTokens.join(" "));
  }
  return phrases;
};

const phraseIsWeakMonitoringObject = (tokens: readonly string[]): boolean => (
  tokens.length === MIN_THEME_TOKEN_COUNT
  && tokens.some((token) => WEAK_MONITORING_ACTION_TOKENS.has(token))
  && tokens.some((token) => WEAK_MONITORING_OBJECT_TOKENS.has(token))
);

const normalizedCandidateToken = (value: string): string | undefined => {
  const tokens = tokenize(value);
  return tokens.length === 1 ? tokens[0] : undefined;
};

const flushPhraseGroup = (phrases: string[], group: string[]): void => {
  phrases.push(...phrasesFromTokens(group));
  group.length = 0;
};

const phrasesFromContiguousTokens = (segment: string): string[] => {
  const phrases: string[] = [];
  const group: string[] = [];
  const rawTokens = segment.match(/[a-z0-9][a-z0-9-]*/gi) ?? [];
  for (const rawToken of rawTokens) {
    const token = normalizedCandidateToken(rawToken);
    if (token === undefined) {
      flushPhraseGroup(phrases, group);
    } else {
      group.push(token);
    }
  }
  flushPhraseGroup(phrases, group);
  return phrases;
};

const phraseIsGenericAgentBrowserNoise = (phrase: string): boolean => {
  const tokens = tokenize(phrase);
  return tokens.length > 0 && tokens.every((token) => GENERIC_THEME_TOKENS.has(token));
};

const candidatePhrases = (passage: ResearchBriefingPassage): string[] => (
  isLowSignalEvidenceText(passage.analysisText) ? [] :
  normalizeWhitespace(passage.analysisText)
  .split(/[.!?:;,()[\]{}|•]+|\s+-\s+/)
  .flatMap((segment) => phrasesFromContiguousTokens(segment))
  .filter((phrase) => !phraseIsGenericAgentBrowserNoise(phrase))
);

const phraseIsTopicEcho = (phrase: string, topicTermSet: ReadonlySet<string>): boolean => {
  const tokens = tokenize(phrase);
  return tokens.length > 0 && tokens.every((token) => topicTermSet.has(token));
};

const phraseIsSingleSourcePlatformEcho = (
  theme: ResearchBriefingTheme,
  topicTermSet: ReadonlySet<string>
): boolean => {
  if (theme.sourceCount >= MIN_TOPIC_ECHO_SOURCE_COUNT) return false;
  const tokens = tokenize(theme.phrase);
  return tokens.some((token) => topicTermSet.has(token))
    && tokens.some((token) => TOPIC_ANCHORED_PLATFORM_TOKENS.has(token))
    && !phraseIsActionable(theme.phrase);
};

const phraseHasDecisionReadyAction = (theme: ResearchBriefingTheme): boolean => (
  phraseIsActionable(theme.phrase) && themeHasDecisionReadyEvidence(theme)
);

const phraseIsWeakSingleSourceTopicFragment = (
  theme: ResearchBriefingTheme,
  topicTermSet: ReadonlySet<string>
): boolean => {
  if (theme.sourceCount >= MIN_TOPIC_ECHO_SOURCE_COUNT) return false;
  if (phraseHasDecisionReadyAction(theme)) return false;
  const tokens = tokenize(theme.phrase);
  const hasTopicToken = tokens.some((token) => topicTermSet.has(token));
  return hasTopicToken && tokens.some((token) => WEAK_TOPIC_FRAGMENT_TOKENS.has(token));
};

const phraseIsBrowserEngineListFragment = (theme: ResearchBriefingTheme): boolean => {
  if (phraseHasDecisionReadyAction(theme)) return false;
  const tokens = tokenize(theme.phrase);
  return tokens.some((token) => BROWSER_ENGINE_FRAGMENT_TOKENS.has(token));
};

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const phraseIsComparisonObject = (theme: ResearchBriefingTheme): boolean => {
  const pattern = new RegExp(`\\b(?:rather\\s+)?than\\s+${escapeRegex(theme.phrase)}\\b`, "i");
  return theme.passages.some((passage) => pattern.test(normalizeWhitespace(passage.analysisText)));
};

const phraseTokenEvidenceScore = (phrase: string, passage: ResearchBriefingPassage): number => {
  const textTokens = new Set(tokenize(passage.analysisText));
  return tokenize(phrase).filter((token) => textTokens.has(token)).length;
};

const sortedRepresentativeCandidates = (
  phrase: string,
  passages: readonly ResearchBriefingPassage[]
): ResearchBriefingPassage[] => (
  [...passages].sort((left, right) => {
    const semanticDelta = semanticThemeEvidenceScore(phrase, right) - semanticThemeEvidenceScore(phrase, left);
    if (semanticDelta !== 0) return semanticDelta;
    const phraseDelta = phraseTokenEvidenceScore(phrase, right) - phraseTokenEvidenceScore(phrase, left);
    if (phraseDelta !== 0) return phraseDelta;
    if (right.score !== left.score) return right.score - left.score;
    return compareStableText(`${left.recordId}:${left.text}`, `${right.recordId}:${right.text}`);
  })
);

const representativePassages = (
  phrase: string,
  passages: readonly ResearchBriefingPassage[]
): ResearchBriefingPassage[] => {
  const selected: ResearchBriefingPassage[] = [];
  const selectedRecords = new Set<string>();
  const sortedPassages = sortedRepresentativeCandidates(phrase, passages);
  for (const passage of sortedPassages) {
    if (selectedRecords.has(passage.recordId)) continue;
    selected.push(passage);
    selectedRecords.add(passage.recordId);
    if (selected.length === MAX_THEME_PASSAGES) return selected;
  }
  return [
    ...selected,
    ...sortedPassages.filter((passage) => !selected.includes(passage))
  ].slice(0, MAX_THEME_PASSAGES);
};

const domainsForUrls = (urls: readonly string[]): Set<string> => (
  new Set(urls.map(registrableDomainFromUrl))
);

const promoteTheme = (
  phrase: string,
  passages: readonly ResearchBriefingPassage[]
): ResearchBriefingTheme => {
  const recordIds = [...new Set(passages.map((passage) => passage.recordId))].sort(compareStableText);
  const urls = [...new Set(passages.map((passage) => passage.url))].sort(compareStableText);
  const domains = domainsForUrls(urls);
  return {
    phrase,
    recordIds,
    urls,
    domainCount: domains.has("unknown-domain") ? Math.max(0, domains.size - 1) : domains.size,
    sourceCount: recordIds.length,
    passages: representativePassages(phrase, passages),
    disagreementSignals: passages.flatMap((passage) => disagreementCuesForText(passage.analysisText))
  };
};

const themeQualityScore = (theme: ResearchBriefingTheme, topicTermSet: ReadonlySet<string>): number => {
  const maxPassageScore = Math.max(0, ...theme.passages.map((passage) => passage.score));
  const actionScore = phraseIsActionable(theme.phrase) ? ACTIONABLE_THEME_SCORE_BONUS : 0;
  const topicEchoPenalty = phraseIsTopicEcho(theme.phrase, topicTermSet) && !phraseIsActionable(theme.phrase)
    ? TOPIC_ECHO_SCORE_PENALTY
    : 0;
  return maxPassageScore + theme.domainCount * 3 + theme.sourceCount * 2 + actionScore - topicEchoPenalty;
};

export const themeHasDecisionReadyEvidence = (theme: ResearchBriefingTheme): boolean => (
  theme.passages.some((passage) => (
    !isLowSignalEvidenceText(passage.analysisText) && phraseIsActionable(passage.analysisText)
  ))
);

const themeIsSupported = (
  theme: ResearchBriefingTheme,
  terms: readonly string[],
  topicTermSet: ReadonlySet<string>
): boolean => {
  if (theme.sourceCount === 0) return false;
  const semanticTheme = isSemanticThemePhrase(theme.phrase);
  if (semanticTheme && theme.sourceCount < MIN_TOPIC_ECHO_SOURCE_COUNT) return false;
  const actionable = phraseIsActionable(theme.phrase);
  const topicOverlap = theme.phrase.split(" ").some((token) => terms.includes(token));
  if (!topicOverlap && !actionable && !semanticTheme) return false;
  if (phraseIsComparisonObject(theme)) return false;
  if (phraseIsSingleSourcePlatformEcho(theme, topicTermSet)) return false;
  if (phraseIsWeakSingleSourceTopicFragment(theme, topicTermSet)) return false;
  if (phraseIsBrowserEngineListFragment(theme)) return false;
  if (theme.sourceCount < MIN_TOPIC_ECHO_SOURCE_COUNT && theme.disagreementSignals.length > 0) return false;
  if (phraseIsTopicEcho(theme.phrase, topicTermSet)) return actionable && themeHasDecisionReadyEvidence(theme);
  return true;
};

const primaryPassageRecordId = (theme: ResearchBriefingTheme): string | undefined => (
  theme.passages[0]?.recordId
);

const themeTokensOverlap = (left: ResearchBriefingTheme, right: ResearchBriefingTheme): boolean => {
  const leftTokens = new Set(tokenize(left.phrase));
  return tokenize(right.phrase).some((token) => leftTokens.has(token));
};

const samePrimaryPassageFamily = (left: ResearchBriefingTheme, right: ResearchBriefingTheme): boolean => {
  const leftRecordId = primaryPassageRecordId(left);
  const rightRecordId = primaryPassageRecordId(right);
  return leftRecordId !== undefined
    && rightRecordId !== undefined
    && leftRecordId === rightRecordId
    && themeTokensOverlap(left, right);
};

const dedupeThemePassageFamilies = (
  themes: readonly ResearchBriefingTheme[]
): ResearchBriefingTheme[] => {
  const selected: ResearchBriefingTheme[] = [];
  for (const theme of themes) {
    if (!selected.some((candidate) => samePrimaryPassageFamily(candidate, theme))) {
      selected.push(theme);
    }
  }
  return selected;
};

const limitSingleSourceDominance = (
  themes: readonly ResearchBriefingTheme[]
): ResearchBriefingTheme[] => {
  const selected: ResearchBriefingTheme[] = [];
  const singleSourceCounts = new Map<string, number>();
  for (const theme of themes) {
    const primaryRecordId = primaryPassageRecordId(theme);
    if (primaryRecordId === undefined || theme.sourceCount > 1) {
      selected.push(theme);
      continue;
    }
    const currentCount = singleSourceCounts.get(primaryRecordId) ?? 0;
    if (currentCount < MAX_SINGLE_SOURCE_THEMES_PER_PRIMARY_RECORD) {
      selected.push(theme);
      singleSourceCounts.set(primaryRecordId, currentCount + 1);
    }
  }
  return selected;
};

const groupThemePassages = (
  passages: readonly ResearchBriefingPassage[]
): Map<string, ResearchBriefingPassage[]> => {
  const grouped = new Map<string, ResearchBriefingPassage[]>();
  for (const passage of passages) {
    const semanticPhrases = isLowSignalEvidenceText(passage.analysisText)
      ? []
      : semanticPhrasesForPassage(passage);
    const phrases = [...new Set([
      ...candidatePhrases(passage),
      ...semanticPhrases
    ])];
    for (const phrase of phrases) {
      grouped.set(phrase, [...(grouped.get(phrase) ?? []), passage]);
    }
  }
  return grouped;
};

export const phraseIsTopicOnlyEcho = phraseIsTopicEcho;

export const buildThemes = (
  topic: string,
  records: readonly ResearchRecord[],
  passages: readonly ResearchBriefingPassage[]
): ResearchBriefingTheme[] => {
  const terms = topicTokens(topic);
  const topicTermSet = new Set(terms);
  const sortedThemes = [...groupThemePassages(passages).entries()]
  .map(([phrase, themePassages]) => promoteTheme(phrase, themePassages))
  .filter((theme) => themeIsSupported(theme, terms, topicTermSet))
  .sort((left, right) => {
    const scoreDelta = themeQualityScore(right, topicTermSet) - themeQualityScore(left, topicTermSet);
    if (scoreDelta !== 0) return scoreDelta;
    return compareStableText(left.phrase, right.phrase);
  });
  const themes = limitSingleSourceDominance(dedupeThemePassageFamilies(sortedThemes)).slice(0, MAX_THEMES);

  return themes.length > 0 || records.length === 0 ? themes : [];
};
