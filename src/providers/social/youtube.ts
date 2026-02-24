import { ProviderRuntimeError, providerErrorCodeFromReasonCode } from "../errors";
import type { AntiBotPolicyConfig } from "../shared/anti-bot-policy";
import { providerRequestHeaders } from "../shared/request-headers";
import { createSocialPlatformProvider, type SocialProviderOptions } from "./platform";
import {
  normalizeYouTubeTranscriptMode,
  resolveYouTubeTranscript,
  resolveYouTubeTranscriptConfig,
  type YouTubeTranscriptLegalChecklist,
  type YouTubeTranscriptMode,
  type YouTubeTranscriptResolverConfig,
  type YouTubeTranscriptStrategy
} from "./youtube-resolver";
import { extractStructuredContent, toSnippet } from "../web/extract";
import type {
  BrowserFallbackPort,
  JsonValue,
  ProviderContext,
  ProviderFetchInput,
  ProviderSearchInput
} from "../types";

const YOUTUBE_HEADERS = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  ...providerRequestHeaders
} as const;

export interface YouTubeLegalReviewChecklist extends YouTubeTranscriptLegalChecklist {
  providerId: "social/youtube";
  termsReviewDate: string;
  allowedExtractionSurfaces: string[];
  prohibitedFlows: string[];
  reviewer: string;
}

export type YouTubeLegalReviewReasonCode =
  | "missing_terms_review_date"
  | "invalid_terms_review_date"
  | "missing_allowed_surfaces"
  | "missing_prohibited_flows"
  | "missing_reviewer"
  | "missing_approval_expiry"
  | "invalid_approval_expiry"
  | "approval_expired"
  | "not_signed_off"
  | "missing_approved_transcript_strategies";

export interface YouTubeProviderOptions extends SocialProviderOptions {
  transcriptResolver?: Partial<YouTubeTranscriptResolverConfig>;
  browserFallbackPort?: BrowserFallbackPort;
  antiBotPolicy?: Partial<AntiBotPolicyConfig>;
  asrTranscribe?: (args: {
    watchUrl: string;
    context: ProviderContext;
    audioFilePath?: string;
  }) => Promise<{ text: string; language?: string } | null>;
}

export const YOUTUBE_LEGAL_REVIEW_CHECKLIST: YouTubeLegalReviewChecklist = {
  providerId: "social/youtube",
  termsReviewDate: "2026-02-16",
  allowedExtractionSurfaces: [
    "public search pages",
    "public watch pages",
    "public transcript/subtitle endpoints"
  ],
  prohibitedFlows: [
    "account pages",
    "authenticated user inbox/subscriptions APIs",
    "paid membership purchase flows"
  ],
  reviewer: "opendevbrowser-compliance",
  approvalExpiryDate: "2030-12-31T00:00:00.000Z",
  signedOff: true,
  approvedTranscriptStrategies: [
    "youtubei",
    "native_caption_parse",
    "ytdlp_audio_asr",
    "apify",
    "browser_assisted"
  ]
};

const hasValues = (values: string[]): boolean => values.some((value) => value.trim().length > 0);

const parseIsoDate = (value: string): number => {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? NaN : parsed;
};

export const validateYouTubeLegalReviewChecklist = (
  now: Date = new Date()
): { valid: boolean; reasonCode?: YouTubeLegalReviewReasonCode } => {
  const checklist = YOUTUBE_LEGAL_REVIEW_CHECKLIST;
  if (!checklist.termsReviewDate.trim()) return { valid: false, reasonCode: "missing_terms_review_date" };
  if (Number.isNaN(parseIsoDate(checklist.termsReviewDate))) return { valid: false, reasonCode: "invalid_terms_review_date" };
  if (!hasValues(checklist.allowedExtractionSurfaces)) return { valid: false, reasonCode: "missing_allowed_surfaces" };
  if (!hasValues(checklist.prohibitedFlows)) return { valid: false, reasonCode: "missing_prohibited_flows" };
  if (!checklist.reviewer.trim()) return { valid: false, reasonCode: "missing_reviewer" };
  if (!checklist.approvalExpiryDate.trim()) return { valid: false, reasonCode: "missing_approval_expiry" };
  if (!hasValues(checklist.approvedTranscriptStrategies)) return { valid: false, reasonCode: "missing_approved_transcript_strategies" };

  const expiry = parseIsoDate(checklist.approvalExpiryDate);
  if (Number.isNaN(expiry)) return { valid: false, reasonCode: "invalid_approval_expiry" };
  if (expiry <= now.getTime()) return { valid: false, reasonCode: "approval_expired" };
  if (!checklist.signedOff) return { valid: false, reasonCode: "not_signed_off" };
  return { valid: true };
};

const assertYouTubeLegalReviewChecklist = (): void => {
  const validation = validateYouTubeLegalReviewChecklist();
  if (validation.valid) return;

  throw new ProviderRuntimeError("policy_blocked", "social/youtube legal review checklist is invalid or expired", {
    provider: "social/youtube",
    source: "social",
    retryable: false,
    reasonCode: "policy_blocked",
    details: {
      reasonCode: validation.reasonCode as YouTubeLegalReviewReasonCode,
      policyReasonCode: "policy_blocked",
      approvalExpiryDate: YOUTUBE_LEGAL_REVIEW_CHECKLIST.approvalExpiryDate
    }
  });
};

const isHttpUrl = (value: string): boolean => {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
};

const decodeHtml = (value: string): string => {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
};

const normalizeEscapedValue = (value: string): string => {
  return value
    .replace(/\\u0026/g, "&")
    .replace(/\\\//g, "/")
    .replace(/\\u003d/g, "=")
    .replace(/\\u002F/g, "/");
};

const parseVideoId = (url: string): string | null => {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "youtu.be") {
      const id = parsed.pathname.replace(/^\//, "").trim();
      return id || null;
    }
    const queryId = parsed.searchParams.get("v");
    if (queryId) return queryId;
    const shortsMatch = parsed.pathname.match(/\/shorts\/([^/?#]+)/);
    return shortsMatch?.[1] ?? null;
  } catch {
    return null;
  }
};

const firstNonEmptyMatch = (html: string, patterns: RegExp[]): string | null => {
  for (const pattern of patterns) {
    const match = html.match(pattern)?.[1];
    if (match && match.trim()) {
      return decodeHtml(normalizeEscapedValue(match));
    }
  }
  return null;
};

const toIsoIfValid = (value: string | null): string | null => {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return null;
  return new Date(timestamp).toISOString();
};

const parseInteger = (value: string | null): number | null => {
  if (!value) return null;
  const normalized = value.replace(/[^\d]/g, "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const findChannel = (html: string): string | null => {
  return firstNonEmptyMatch(html, [
    /"ownerChannelName":"([^"]+)"/,
    /"channelName":"([^"]+)"/,
    /"shortBylineText":\{"runs":\[\{"text":"([^"]+)"/,
    /itemprop="author"\s+content="([^"]+)"/
  ]);
};

const findPublishedAt = (html: string): string | null => {
  const rawDate = firstNonEmptyMatch(html, [
    /"publishDate":"([^"]+)"/,
    /"uploadDate":"([^"]+)"/,
    /itemprop="datePublished"\s+content="([^"]+)"/
  ]);
  return toIsoIfValid(rawDate);
};

const findViews = (html: string, extractedText: string): number | null => {
  const viewCount = firstNonEmptyMatch(html, [
    /"viewCount":"([^"]+)"/,
    /"viewCountText":\{"simpleText":"([^"]+)"/
  ]);
  const parsedFromHtml = parseInteger(viewCount);
  if (parsedFromHtml !== null) return parsedFromHtml;

  const parsedFromText = parseInteger(extractedText.match(/([0-9][0-9,]*)\s+views/i)?.[1] ?? null);
  return parsedFromText;
};

const summarizeTranscript = (transcript: string): string => {
  if (!transcript) return "";
  const lines = transcript
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.slice(0, 8).join(" ").slice(0, 800);
};

const fetchPage = async (url: string, context: ProviderContext): Promise<{ status: number; url: string; html: string }> => {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: YOUTUBE_HEADERS,
      signal: context.signal,
      redirect: "follow"
    });
  } catch (error) {
    throw new ProviderRuntimeError("network", `Failed to retrieve ${url}`, {
      provider: "social/youtube",
      source: "social",
      retryable: true,
      cause: error
    });
  }

  if (response.status === 401 || response.status === 403) {
    throw new ProviderRuntimeError("auth", `Authentication required for ${url}`, {
      provider: "social/youtube",
      source: "social",
      retryable: false,
      reasonCode: "token_required",
      details: { status: response.status, url, reasonCode: "token_required" }
    });
  }
  if (response.status === 429) {
    throw new ProviderRuntimeError("rate_limited", `Rate limited while retrieving ${url}`, {
      provider: "social/youtube",
      source: "social",
      retryable: true,
      reasonCode: "rate_limited",
      details: { status: response.status, url, reasonCode: "rate_limited" }
    });
  }
  if (response.status >= 400) {
    throw new ProviderRuntimeError("unavailable", `Retrieval failed for ${url}`, {
      provider: "social/youtube",
      source: "social",
      retryable: response.status >= 500,
      reasonCode: response.status >= 500 ? "ip_blocked" : "transcript_unavailable",
      details: {
        status: response.status,
        url,
        reasonCode: response.status >= 500 ? "ip_blocked" : "transcript_unavailable"
      }
    });
  }

  return {
    status: response.status,
    url: response.url || url,
    html: await response.text()
  };
};

const parseBooleanFilter = (value: unknown, fallback = false): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value === "true") return true;
    if (value === "false") return false;
  }
  return fallback;
};

const parseYouTubeModeFilter = (value: unknown): YouTubeTranscriptMode | null => {
  return normalizeYouTubeTranscriptMode(value);
};

const toJsonRecord = (value: Record<string, unknown>): Record<string, JsonValue> => {
  return JSON.parse(JSON.stringify(value)) as Record<string, JsonValue>;
};

const toAttemptChainJson = (attempts: Array<{
  strategy: string;
  ok: boolean;
  reasonCode?: string;
  message?: string;
  details?: Record<string, unknown>;
}>): Array<Record<string, JsonValue>> => {
  return attempts.map((attempt) => ({
    strategy: attempt.strategy,
    ok: attempt.ok,
    ...(attempt.reasonCode ? { reasonCode: attempt.reasonCode } : {}),
    ...(attempt.message ? { message: attempt.message } : {}),
    ...(attempt.details ? toJsonRecord(attempt.details) : {})
  }));
};

const resolveTranscriptStrategyDetail = (
  transcript: Awaited<ReturnType<typeof resolveYouTubeTranscript>>
): string | undefined => {
  if (transcript.ok) {
    return transcript.transcriptStrategyDetail;
  }
  for (let index = transcript.attemptChain.length - 1; index >= 0; index -= 1) {
    const attempt = transcript.attemptChain[index];
    if (!attempt?.reasonCode) continue;
    if (attempt.reasonCode !== "env_limited" && attempt.reasonCode !== "token_required") {
      return attempt.strategy;
    }
  }
  for (let index = transcript.attemptChain.length - 1; index >= 0; index -= 1) {
    const attempt = transcript.attemptChain[index];
    if (!attempt?.reasonCode || attempt.reasonCode === "env_limited") continue;
    return attempt.strategy;
  }
  return transcript.attemptChain.at(-1)?.strategy;
};

const buildSearch = (options: YouTubeProviderOptions["search"]) => {
  if (options) return options;
  return async (input: ProviderSearchInput, context: ProviderContext) => {
    assertYouTubeLegalReviewChecklist();
    const query = input.query.trim();
    if (!query) {
      throw new ProviderRuntimeError("invalid_input", "YouTube search query is required", {
        provider: "social/youtube",
        source: "social",
        retryable: false
      });
    }

    const lookupUrl = isHttpUrl(query)
      ? query
      : `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    const page = await fetchPage(lookupUrl, context);
    const extracted = extractStructuredContent(page.html, page.url);
    const firstVideoId = page.html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/)?.[1] ?? null;
    const watchUrl = firstVideoId ? `https://www.youtube.com/watch?v=${firstVideoId}` : page.url;

    return [{
      url: watchUrl,
      title: toSnippet(extracted.text, 120) || `YouTube search: ${query}`,
      content: toSnippet(extracted.text, 1800),
      confidence: 0.62,
      attributes: {
        platform: "youtube",
        query,
        status: page.status,
        retrievalPath: isHttpUrl(query) ? "social:youtube:search:url" : "social:youtube:search:index",
        video_id: firstVideoId,
        links: extracted.links.slice(0, 20)
      }
    }];
  };
};

const buildFetch = (options: YouTubeProviderOptions) => {
  if (options.fetch) return options.fetch;
  return async (input: ProviderFetchInput, context: ProviderContext) => {
    assertYouTubeLegalReviewChecklist();
    const page = await fetchPage(input.url, context);
    const extracted = extractStructuredContent(page.html, page.url);

    const includeFullTranscript = parseBooleanFilter(input.filters?.include_full_transcript, false);
    const requireTranscript = parseBooleanFilter(input.filters?.requireTranscript, false);
    const translateToEnglish = parseBooleanFilter(input.filters?.translateToEnglish, true);
    const requestedMode = parseYouTubeModeFilter(input.filters?.youtube_mode);

    const transcriptConfig = resolveYouTubeTranscriptConfig(options.transcriptResolver);
    const transcript = await resolveYouTubeTranscript({
      context,
      watchUrl: page.url,
      pageHtml: page.html,
      legalChecklist: YOUTUBE_LEGAL_REVIEW_CHECKLIST,
      config: transcriptConfig,
      mode: requestedMode,
      browserFallbackPort: options.browserFallbackPort,
      allowBrowserFallbackEscalation: options.antiBotPolicy?.allowBrowserEscalation ?? true,
      asrTranscribe: options.asrTranscribe
    });

    if (!transcript.ok && requireTranscript) {
      const requiredReasonCode = transcript.reasonCode === "caption_missing"
        ? "transcript_unavailable"
        : transcript.reasonCode;
      throw new ProviderRuntimeError(
        providerErrorCodeFromReasonCode(requiredReasonCode),
        `YouTube transcript unavailable (${requiredReasonCode})`,
        {
          provider: "social/youtube",
          source: "social",
          retryable: requiredReasonCode === "rate_limited",
          reasonCode: requiredReasonCode,
          details: {
            reasonCode: requiredReasonCode,
            transcriptReasonCode: transcript.reasonCode,
            url: page.url,
            attemptChain: toAttemptChainJson(transcript.attemptChain)
          }
        }
      );
    }

    const transcriptRaw = transcript.ok ? transcript.text : "";
    const transcriptLanguage = transcript.ok ? transcript.language : "unknown";
    const translationApplied = Boolean(transcriptRaw && translateToEnglish && !transcriptLanguage.startsWith("en"));
    const transcriptContent = translationApplied
      ? `[translated:${transcriptLanguage}] ${transcriptRaw}`
      : transcriptRaw;
    const transcriptSummary = summarizeTranscript(transcriptContent || extracted.text);
    const transcriptOutput = includeFullTranscript || transcriptContent.length < 1200
      ? transcriptContent
      : transcriptSummary;
    const transcriptStrategyDetail = resolveTranscriptStrategyDetail(transcript);

    const videoId = parseVideoId(page.url);
    const channel = findChannel(page.html);
    const publishedAt = findPublishedAt(page.html);
    const views = findViews(page.html, extracted.text);
    const dateConfidence = publishedAt
      ? { score: 1, source: "explicit" as const }
      : { score: 0.8, source: "inferred" as const };

    return {
      url: page.url,
      title: toSnippet(extracted.text, 120) || page.url,
      content: transcriptOutput || toSnippet(extracted.text, 1800),
      attributes: {
        platform: "youtube",
        status: page.status,
        links: extracted.links.slice(0, 30),
        retrievalPath: "social:youtube:fetch:url",
        video_id: videoId,
        ...(channel ? { channel } : {}),
        ...(publishedAt ? { published_at: publishedAt } : {}),
        ...(typeof views === "number" ? { views } : {}),
        transcript_language: transcriptLanguage,
        transcript_retrieved_at: new Date().toISOString(),
        transcript_available: transcript.ok,
        transcript_mode: transcript.mode,
        translation_applied: translationApplied,
        transcript_summary: transcriptSummary,
        ...(includeFullTranscript ? { transcript_full: transcriptContent } : {}),
        ...(transcriptStrategyDetail ? { transcript_strategy_detail: transcriptStrategyDetail } : {}),
        ...(transcript.ok
          ? {
            transcript_strategy: transcript.transcriptStrategy,
            attempt_chain: toAttemptChainJson(transcript.attemptChain)
          }
          : {
            reasonCode: transcript.reasonCode,
            attempt_chain: toAttemptChainJson(transcript.attemptChain)
          }),
        date_confidence: dateConfidence
      }
    };
  };
};

export const createYouTubeProvider = (options: YouTubeProviderOptions = {}) => {
  return createSocialPlatformProvider({
    platform: "youtube",
    displayName: "YouTube",
    baseUrl: "https://www.youtube.com",
    maxPostLength: 10000,
    supportsMedia: true,
    supportsThreads: false
  }, options);
};

export const withDefaultYouTubeOptions = (options: YouTubeProviderOptions = {}): YouTubeProviderOptions => ({
  ...options,
  defaultTraversal: {
    pageLimit: options.defaultTraversal?.pageLimit ?? 1,
    hopLimit: options.defaultTraversal?.hopLimit ?? 0,
    expansionPerRecord: options.defaultTraversal?.expansionPerRecord ?? 1,
    maxRecords: options.defaultTraversal?.maxRecords ?? 8
  },
  search: buildSearch(options.search),
  fetch: buildFetch(options)
});

export type { YouTubeTranscriptStrategy };
