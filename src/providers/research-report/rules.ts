import { parse as parseDomain } from "tldts";
import { canonicalizeUrl } from "../web/crawler";
import type { ResearchRecord } from "../enrichment";
import type {
  ResearchAcceptedDestinationOverlap,
  ResearchBriefingMetaView,
  ResearchCookieDiagnosticSummary,
  ResearchCookieDiagnosticView,
  ResearchRejectedCandidateView
} from "./types";

export const MIN_PARTIAL_ACCEPTED_RECORDS = 1;
export const MIN_PASS_ACCEPTED_RECORDS = 3;
export const MIN_PASS_INDEPENDENT_DOMAINS = 2;
export const MIN_USABLE_CONTENT_CHARS = 500;
export const MAX_PASS_REJECTION_PRESSURE = 0.6;
export const MAX_PARTIAL_REJECTION_PRESSURE = 0.85;
const PRIVATE_PUBLIC_SUFFIX_OPTIONS = { allowPrivateDomains: true } as const;

export const DEFAULT_RESEARCH_ARTIFACT_FILES = [
  "summary.md",
  "report.md",
  "records.json",
  "context.json",
  "meta.json",
  "bundle-manifest.json"
] as const;

const DISAGREEMENT_CUES = [
  "however",
  "but",
  "risk",
  "avoid",
  "limitation",
  "tradeoff",
  "concern",
  "challenge"
] as const;
const DISAGREEMENT_PATTERN_CUES = [
  {
    cue: "not",
    pattern: /\b(?:does|do|did|is|are|was|were|can|could|should|will|would)\s+not\b|\bnot\s+(?:support|supports|supported|recommended|ready|reliable|stable|usable|enough|work|working|suitable)\b/i
  },
  {
    cue: "cannot",
    pattern: /\bcannot\b|\bcan't\b/i
  }
] as const;
const FAILURE_MESSAGE_CHARACTERS = 240;
const MAX_FAILURE_SUMMARIES = 10;
const ACTIVE_CHALLENGE_ORCHESTRATION_STATUSES = new Set([
  "active",
  "blocked",
  "challenge_preserved",
  "deferred",
  "failed",
  "manual_yield",
  "needs_input",
  "needs_recovery",
  "no_progress",
  "policy_blocked",
  "preserved",
  "still_blocked",
  "timed_out",
  "timeout",
  "unresolved",
  "yield_required"
]);
const INACTIVE_CHALLENGE_ORCHESTRATION_STATUSES = new Set([
  "clear",
  "cleared",
  "completed",
  "not_recorded",
  "resolved",
  "stand_down"
]);

const STOPWORDS = new Set([
  "about",
  "across",
  "after",
  "again",
  "all",
  "also",
  "and",
  "any",
  "are",
  "because",
  "before",
  "being",
  "between",
  "blog",
  "business",
  "can",
  "careers",
  "could",
  "design",
  "does",
  "docs",
  "doing",
  "decisions",
  "during",
  "each",
  "every",
  "for",
  "from",
  "have",
  "into",
  "introduce",
  "login",
  "main",
  "menu",
  "min",
  "more",
  "navigation",
  "need",
  "needs",
  "notifications",
  "only",
  "our",
  "other",
  "output",
  "over",
  "page",
  "pages",
  "premium",
  "pricing",
  "prefer",
  "read",
  "report",
  "reports",
  "research",
  "search",
  "should",
  "show",
  "sign",
  "skip",
  "source",
  "sources",
  "such",
  "team",
  "teams",
  "that",
  "the",
  "their",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "using",
  "was",
  "were",
  "when",
  "where",
  "which",
  "will",
  "while",
  "with",
  "without",
  "would"
]);

export const plainObject = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
};

const toFiniteNumber = (value: unknown): number | undefined => (
  typeof value === "number" && Number.isFinite(value) ? value : undefined
);

const readNumber = (object: Record<string, unknown>, keys: readonly string[]): number => {
  for (const key of keys) {
    const value = toFiniteNumber(object[key]);
    if (value !== undefined) return value;
  }
  return 0;
};

const readOptionalNumber = (object: Record<string, unknown>, keys: readonly string[]): number | undefined => {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(object, key)) continue;
    const value = toFiniteNumber(object[key]);
    if (value !== undefined) return value;
  }
  return undefined;
};

const readString = (object: Record<string, unknown>, key: string, fallback: string): string => {
  const value = object[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
};

const readStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
};

const readRecordArray = (value: unknown): Record<string, unknown>[] => {
  if (!Array.isArray(value)) return [];
  return value.map(plainObject).filter((entry) => Object.keys(entry).length > 0);
};

export const normalizeWhitespace = (value: string | undefined): string => (
  value?.replace(/\s+/g, " ").trim() ?? ""
);

export const boundedInlineText = (args: {
  content: string | undefined;
  fallback: string;
  limit: number;
  target: string;
}): string => {
  const normalized = normalizeWhitespace(args.content);
  if (!normalized) return args.fallback;
  if (normalized.length <= args.limit) return normalized;
  return `${normalized.slice(0, args.limit)} [truncated; see ${args.target}]`;
};

export const recordTitle = (record: ResearchRecord): string => record.title ?? record.url ?? record.provider;

export const recordContentChars = (record: ResearchRecord): number => {
  const extractionQuality = plainObject(record.attributes.extractionQuality);
  const fromMetadata = toFiniteNumber(extractionQuality.contentChars);
  if (fromMetadata !== undefined) return fromMetadata;
  return normalizeWhitespace(record.content).length;
};

export const compareStableText = (left: string, right: string): number => {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
};

const normalizedHostname = (url: string): string | undefined => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  } catch {
    return undefined;
  }
};

const parsedRegistrableDomain = (url: string): string | undefined => {
  const privateAwareDomain = parseDomain(url, PRIVATE_PUBLIC_SUFFIX_OPTIONS).domain;
  if (privateAwareDomain) return privateAwareDomain.toLowerCase();
  return parseDomain(url).domain?.toLowerCase();
};

export const registrableDomainFromUrl = (url: string | undefined): string => {
  if (!url) return "unknown-domain";
  const parsedDomain = parsedRegistrableDomain(url);
  if (parsedDomain) return parsedDomain;
  const hostname = normalizedHostname(url);
  return hostname === undefined ? "unknown-domain" : hostname;
};

export const recordDomain = (record: ResearchRecord): string => registrableDomainFromUrl(record.url);

export const uniqueDomains = (records: readonly ResearchRecord[]): string[] => (
  [...new Set(records.map(recordDomain).filter((domain) => domain !== "unknown-domain"))].sort(compareStableText)
);

export const tokenize = (value: string): string[] => (
  normalizeWhitespace(value)
  .toLowerCase()
  .replace(/[^a-z0-9\s-]/g, " ")
  .split(/\s+/)
  .map((token) => token.replace(/^-+|-+$/g, ""))
  .filter((token) => token.length > 2 && !STOPWORDS.has(token))
);

export const topicTokens = (topic: string): string[] => [...new Set(tokenize(topic))];

export const adjacentPhrases = (tokens: readonly string[]): string[] => {
  const phrases: string[] = [];
  for (let index = 0; index < tokens.length - 1; index += 1) {
    phrases.push(`${tokens[index]} ${tokens[index + 1]}`);
  }
  return phrases;
};

export const evidenceFocusTerms = (topic: string, title: string): string[] => {
  const topicTermList = topicTokens(topic);
  const titleTerms = tokenize(title);
  return [
    ...adjacentPhrases(topicTermList),
    ...topicTermList,
    ...adjacentPhrases(titleTerms),
    ...titleTerms
  ].filter((term, index, terms) => terms.indexOf(term) === index);
};

export const focusedTextWindow = (
  content: string | undefined,
  terms: readonly string[],
  characters: number
): string | undefined => {
  const normalized = normalizeWhitespace(content);
  if (!normalized) return undefined;
  const lower = normalized.toLowerCase();
  const firstMatch = terms
  .map((term) => lower.indexOf(term.toLowerCase()))
  .find((position) => position >= 0);
  if (firstMatch === undefined) return normalized;
  return normalized.slice(firstMatch, firstMatch + characters).trim();
};

export const splitSentences = (value: string): string[] => (
  normalizeWhitespace(value)
  .split(/(?<=[.!?])\s+/)
  .map((sentence) => sentence.trim())
  .filter((sentence) => sentence.length > 40)
);

export const disagreementCuesForText = (value: string): string[] => {
  const normalized = normalizeWhitespace(value);
  const terms = new Set(tokenize(value));
  return [
    ...DISAGREEMENT_CUES.filter((cue) => terms.has(cue)),
    ...DISAGREEMENT_PATTERN_CUES.flatMap((entry) => entry.pattern.test(normalized) ? [entry.cue] : [])
  ].filter((cue, index, cues) => cues.indexOf(cue) === index);
};

export const hasDisagreementCue = (value: string): boolean => disagreementCuesForText(value).length > 0;

const cookieDiagnosticKey = (diagnostic: ResearchCookieDiagnosticView): string => [
  diagnostic.provider,
  diagnostic.source,
  diagnostic.policy,
  diagnostic.sourceRef,
  diagnostic.sessionEvidence,
  diagnostic.message
].join("\u0000");

const toCookieDiagnostic = (value: unknown): ResearchCookieDiagnosticView | null => {
  const record = plainObject(value);
  const message = readString(record, "message", "");
  if (!message) return null;
  return {
    provider: readString(record, "provider", "unknown_provider"),
    source: readString(record, "source", "unknown_source"),
    policy: readString(record, "policy", "unknown_policy"),
    sourceRef: readString(record, "sourceRef", readString(record, "source_ref", "not_recorded")),
    sessionEvidence: readString(
      record,
      "sessionEvidence",
      readString(record, "session_evidence", "not_recorded")
    ),
    message
  };
};

const cookieDiagnosticsFromMetrics = (metrics: Record<string, unknown>): ResearchCookieDiagnosticSummary[] => {
  const snakeCaseDiagnostics = readRecordArray(metrics.cookie_diagnostics);
  const raw = snakeCaseDiagnostics.length > 0
    ? snakeCaseDiagnostics
    : readRecordArray(metrics.cookieDiagnostics);
  const grouped = new Map<string, ResearchCookieDiagnosticSummary>();
  for (const entry of raw) {
    const diagnostic = toCookieDiagnostic(entry);
    if (!diagnostic) continue;
    const key = cookieDiagnosticKey(diagnostic);
    const existing = grouped.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      grouped.set(key, { ...diagnostic, count: 1 });
    }
  }
  return [...grouped.values()].sort((left, right) => compareStableText(left.message, right.message));
};

export const isRequiredCookieDiagnostic = (diagnostic: ResearchCookieDiagnosticSummary): boolean => (
  diagnostic.policy === "required"
);

const rejectedCandidateFromValue = (value: unknown): ResearchRejectedCandidateView => {
  const record = plainObject(value);
  const url = readString(record, "url", "");
  return {
    provider: readString(record, "provider", "unknown_provider"),
    source: readString(record, "source", "unknown_source"),
    reason: readString(record, "reason", "unknown_reason"),
    replacementStatus: readString(record, "replacement_status", "not_recorded"),
    retrievalPath: readString(record, "retrievalPath", "not_recorded"),
    url: url || "URL not recorded"
  };
};

const rejectedCandidatesFromMeta = (meta: Record<string, unknown>): ResearchRejectedCandidateView[] => (
  readRecordArray(meta.rejected_candidates)
  .map(rejectedCandidateFromValue)
);

const isDeadEndSearchFailure = (failure: Record<string, unknown>): boolean => {
  const error = plainObject(failure.error);
  const details = plainObject(error.details);
  return details.fallbackOutputReason === "research_dead_end_shell";
};

const failureSummariesFromMeta = (meta: Record<string, unknown>): string[] => {
  const failures = readRecordArray(meta.failures);
  const summaries = failures.slice(0, MAX_FAILURE_SUMMARIES).map((failure) => {
    const error = plainObject(failure.error);
    const provider = readString(failure, "provider", "unknown");
    const source = readString(failure, "source", "unknown");
    const reason = readString(error, "reasonCode", readString(error, "code", "provider_failure"));
    const message = boundedInlineText({
      content: typeof error.message === "string" ? error.message : undefined,
      fallback: "provider failure",
      limit: FAILURE_MESSAGE_CHARACTERS,
      target: "meta.json"
    });
    return `${provider} (${source}): ${reason}: ${message}`;
  });
  const omitted = failures.length - summaries.length;
  if (omitted > 0) {
    const noun = omitted === 1 ? "failure" : "failures";
    summaries.push(`${omitted} more provider ${noun} omitted from this report; see meta.json`);
  }
  return summaries;
};

const deadEndSearchFailureCount = (meta: Record<string, unknown>): number => (
  readRecordArray(meta.failures).filter(isDeadEndSearchFailure).length
);

const challengeOrchestrationFromMetrics = (metrics: Record<string, unknown>): Record<string, unknown>[] => {
  const snakeCase = readRecordArray(metrics.challenge_orchestration);
  return snakeCase.length > 0 ? snakeCase : readRecordArray(metrics.challengeOrchestration);
};

export const isActiveChallengeOrchestration = (entry: Record<string, unknown>): boolean => {
  if (entry.invoked === false) return false;
  const status = typeof entry.status === "string" ? entry.status.trim().toLowerCase() : "";
  if (INACTIVE_CHALLENGE_ORCHESTRATION_STATUSES.has(status)) return false;
  if (ACTIVE_CHALLENGE_ORCHESTRATION_STATUSES.has(status)) return true;
  return entry.invoked === true;
};

const challengeDiagnosticsFromMetrics = (metrics: Record<string, unknown>): Record<string, unknown>[] => {
  const snakeCase = readRecordArray(metrics.challenge_diagnostics);
  return snakeCase.length > 0 ? snakeCase : readRecordArray(metrics.challengeDiagnostics);
};

const aliasedRecordFromMetrics = (
  metrics: Record<string, unknown>,
  snakeKey: string,
  camelKey: string
): Record<string, unknown> => {
  const snakeCase = plainObject(metrics[snakeKey]);
  return Object.keys(snakeCase).length > 0 ? snakeCase : plainObject(metrics[camelKey]);
};

const sanitizedReasonDistribution = (metrics: Record<string, unknown>): Record<string, number> => {
  const raw = plainObject(metrics.sanitized_reason_distribution);
  const entries = Object.entries(raw).flatMap(([key, value]): Array<[string, number]> => {
    const count = readNumber({ value }, ["value"]);
    return count > 0 ? [[key, count]] : [];
  }).sort((left, right) => compareStableText(left[0], right[0]));
  return Object.fromEntries(
    entries
  );
};

const recordIdentity = (record: Record<string, unknown>): string => (
  JSON.stringify(Object.keys(record).sort(compareStableText).map((key) => [key, record[key]]))
);

const mergeRecordArrays = (
  first: readonly Record<string, unknown>[],
  second: readonly Record<string, unknown>[]
): Record<string, unknown>[] => {
  const merged = new Map<string, Record<string, unknown>>();
  for (const record of [...first, ...second]) {
    merged.set(recordIdentity(record), record);
  }
  return [...merged.values()];
};

const alertsFromMeta = (
  meta: Record<string, unknown>,
  metrics: Record<string, unknown>
): Record<string, unknown>[] => mergeRecordArrays(
  readRecordArray(metrics.alerts),
  readRecordArray(meta.alerts)
);

export const buildResearchBriefingMetaView = (meta: Record<string, unknown>): ResearchBriefingMetaView => {
  const metrics = plainObject(meta.metrics);
  const selection = plainObject(meta.selection);
  const distribution = sanitizedReasonDistribution(metrics);
  const rejectedCandidates = rejectedCandidatesFromMeta(meta);
  const deadEndCount = deadEndSearchFailureCount(meta);
  const antiBotPressure = aliasedRecordFromMetrics(metrics, "anti_bot_pressure", "antiBotPressure");
  const rejectedCountFromDistribution = Object.values(distribution).reduce((sum, count) => sum + count, 0);
  const explicitRejectedCount = readOptionalNumber(metrics, ["rejected_candidate_count", "rejectedCandidateCount"]);
  const sanitizedRecords = readNumber(metrics, ["sanitized_records", "sanitizedRecords"]);
  const rejectedBaseCount = explicitRejectedCount ?? Math.max(
    rejectedCandidates.length,
    rejectedCountFromDistribution,
    sanitizedRecords
  );
  const rejectedCandidateCount = explicitRejectedCount ?? rejectedBaseCount + deadEndCount;

  return {
    ...(typeof meta.primaryConstraintSummary === "string" && meta.primaryConstraintSummary.trim().length > 0
      ? { primaryConstraintSummary: meta.primaryConstraintSummary.trim() }
      : {}),
    timebox: plainObject(meta.timebox),
    sourceSelection: readString(selection, "source_selection", "not_recorded"),
    resolvedSources: readStringArray(selection.resolved_sources),
    totalRecords: readNumber(metrics, ["total_records", "totalRecords"]),
    withinTimebox: readNumber(metrics, ["within_timebox", "withinTimebox"]),
    finalRecords: readNumber(metrics, ["final_records", "finalRecords"]),
    failedSources: readStringArray(metrics.failed_sources),
    failureSummaries: failureSummariesFromMeta(meta),
    rejectedCandidateCount,
    effectiveRejectedCandidateCount: rejectedCandidateCount,
    acceptedDestinationOverlapCount: 0,
    sanitizedReasonDistribution: distribution,
    cookieDiagnostics: cookieDiagnosticsFromMetrics(metrics),
    challengeDiagnostics: challengeDiagnosticsFromMetrics(metrics),
    challengeOrchestration: challengeOrchestrationFromMetrics(metrics),
    antiBotPressure,
    antiBotFailureCount: readNumber(antiBotPressure, ["anti_bot_failures", "antiBotFailures"]),
    antiBotTotalFailures: readNumber(antiBotPressure, ["total_failures", "totalFailures"]),
    transcriptDurability: aliasedRecordFromMetrics(metrics, "transcript_durability", "transcriptDurability"),
    alerts: alertsFromMeta(meta, metrics),
    rejectedCandidates,
    deadEndSearchFailureCount: deadEndCount,
    malformedMetadata: rejectedCandidates
    .filter((candidate) => candidate.url === "URL not recorded")
    .map((candidate) => `Malformed rejected candidate metadata ignored for final claims: ${candidate.reason}`)
  };
};

export const applyAcceptedDestinationOverlapDiscount = (
  metaView: ResearchBriefingMetaView,
  overlapCount: number
): ResearchBriefingMetaView => {
  const acceptedDestinationOverlapCount = Math.max(0, Math.min(overlapCount, metaView.rejectedCandidateCount));
  return {
    ...metaView,
    acceptedDestinationOverlapCount,
    effectiveRejectedCandidateCount: Math.max(0, metaView.rejectedCandidateCount - acceptedDestinationOverlapCount)
  };
};

export const rejectionPressure = (acceptedRecordCount: number, rejectedCandidateCount: number): number => {
  const total = acceptedRecordCount + rejectedCandidateCount;
  if (total === 0) return 0;
  return rejectedCandidateCount / total;
};

export const unwrapSearchRedirect = (rawUrl: string): string => {
  const canonical = canonicalizeUrl(rawUrl);
  try {
    const parsed = new URL(canonical);
    const isDuckDuckGoRedirect = /(^|\.)duckduckgo\.com$/i.test(parsed.hostname)
      && (parsed.pathname === "/l" || parsed.pathname === "/l/");
    if (!isDuckDuckGoRedirect) return canonical;
    const redirect = parsed.searchParams.get("uddg");
    return redirect ? canonicalizeUrl(redirect) : canonical;
  } catch {
    return canonical;
  }
};

export const findAcceptedDestinationOverlaps = (
  rejected: readonly ResearchRejectedCandidateView[],
  records: readonly ResearchRecord[]
): ResearchAcceptedDestinationOverlap[] => {
  const acceptedByUrl = new Map<string, ResearchRecord>();
  for (const record of records) {
    if (!record.url) continue;
    acceptedByUrl.set(unwrapSearchRedirect(record.url), record);
  }

  return rejected.flatMap((candidate) => {
    if (candidate.reason !== "search_index_shell") return [];
    const accepted = acceptedByUrl.get(unwrapSearchRedirect(candidate.url));
    if (!accepted?.url) return [];
    return [{
      rejectedUrl: candidate.url,
      acceptedRecordId: accepted.id,
      acceptedUrl: accepted.url
    }];
  });
};
