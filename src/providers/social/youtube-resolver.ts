import { execFile } from "child_process";
import { mkdtemp, readdir, rm } from "fs/promises";
import { tmpdir } from "os";
import * as path from "path";
import { promisify } from "util";
import { providerErrorCodeFromReasonCode } from "../errors";
import type {
  BrowserFallbackPort,
  JsonValue,
  ProviderContext,
  ProviderReasonCode
} from "../types";

const execFileAsync = promisify(execFile);

const TRANSCRIPT_FETCH_HEADERS = {
  accept: "application/xml,text/xml,text/vtt,*/*"
} as const;

const YOUTUBEI_HEADERS = {
  accept: "application/json",
  "content-type": "application/json"
} as const;

const APIFY_HEADERS = {
  accept: "application/json",
  "content-type": "application/json"
} as const;

type TranscriptPlannerStrategy = "youtubei" | "native_caption_parse" | "ytdlp_audio_asr" | "apify";

type LegacyTranscriptStrategy = "ytdlp_subtitle" | "optional_asr";

export type YouTubeTranscriptMode = "auto" | "web" | "no-auto" | "yt-dlp" | "apify";

export type YouTubeTranscriptModeInput = YouTubeTranscriptMode | "ytdlp";

export type YouTubeTranscriptStrategyDetail =
  | "youtubei"
  | "native_caption_parse"
  | "ytdlp_audio_asr"
  | "apify"
  | "browser_assisted";

export type YouTubeTranscriptStrategy = "native_caption_parse" | "optional_asr" | "browser_assisted";

export interface YouTubeTranscriptLegalChecklist {
  approvalExpiryDate: string;
  signedOff: boolean;
  approvedTranscriptStrategies: Array<
    | YouTubeTranscriptStrategyDetail
    | YouTubeTranscriptStrategy
    | LegacyTranscriptStrategy
  >;
}

export interface YouTubeTranscriptResolverConfig {
  modeDefault: YouTubeTranscriptMode;
  strategyOrder: Array<TranscriptPlannerStrategy | LegacyTranscriptStrategy>;
  enableYtdlp: boolean;
  enableAsr: boolean;
  enableYtdlpAudioAsr: boolean;
  enableApify: boolean;
  apifyActorId: string;
  enableBrowserFallback: boolean;
  ytdlpTimeoutMs: number;
}

export interface YouTubeTranscriptAttempt {
  strategy: YouTubeTranscriptStrategyDetail;
  ok: boolean;
  reasonCode?: ProviderReasonCode;
  message?: string;
  details?: Record<string, JsonValue>;
}

export interface YouTubeTranscriptSuccess {
  ok: true;
  mode: YouTubeTranscriptMode;
  text: string;
  language: string;
  transcriptStrategy: YouTubeTranscriptStrategy;
  transcriptStrategyDetail: YouTubeTranscriptStrategyDetail;
  attemptChain: YouTubeTranscriptAttempt[];
}

export interface YouTubeTranscriptFailure {
  ok: false;
  mode: YouTubeTranscriptMode;
  reasonCode: ProviderReasonCode;
  attemptChain: YouTubeTranscriptAttempt[];
}

export type YouTubeTranscriptResolution = YouTubeTranscriptSuccess | YouTubeTranscriptFailure;

export interface YouTubeTranscriptResolverDependencies {
  context: ProviderContext;
  watchUrl: string;
  pageHtml: string;
  legalChecklist: YouTubeTranscriptLegalChecklist;
  config?: Partial<YouTubeTranscriptResolverConfig>;
  mode?: YouTubeTranscriptModeInput | null;
  browserFallbackPort?: BrowserFallbackPort;
  allowBrowserFallbackEscalation?: boolean;
  asrTranscribe?: (args: {
    watchUrl: string;
    context: ProviderContext;
    audioFilePath?: string;
  }) => Promise<{ text: string; language?: string } | null>;
}

type TranscriptFailureResult = {
  ok: false;
  reasonCode: ProviderReasonCode;
  message: string;
};

type TranscriptSuccessResult = {
  ok: true;
  text: string;
  language: string;
};

type TranscriptFetchResponse = {
  ok: boolean;
  status: number;
  payload: string;
};

type CaptionTrack = {
  baseUrl: string;
  languageCode: string;
  name: string;
  kind?: string;
  vssId?: string;
};

type ApifyRunResponse = {
  data?: {
    defaultDatasetId?: string;
  };
};

const DEFAULT_TRANSCRIPT_RESOLVER_CONFIG: YouTubeTranscriptResolverConfig = {
  modeDefault: "auto",
  strategyOrder: ["youtubei", "native_caption_parse", "ytdlp_audio_asr", "apify"],
  enableYtdlp: false,
  enableAsr: false,
  enableYtdlpAudioAsr: true,
  enableApify: true,
  apifyActorId: "streamers/youtube-scraper",
  enableBrowserFallback: true,
  ytdlpTimeoutMs: 10000
};

const dedupeStrategyOrder = (
  order: Array<TranscriptPlannerStrategy | LegacyTranscriptStrategy>
): Array<TranscriptPlannerStrategy | LegacyTranscriptStrategy> => {
  const seen = new Set<string>();
  const output: Array<TranscriptPlannerStrategy | LegacyTranscriptStrategy> = [];
  for (const strategy of order) {
    if (seen.has(strategy)) continue;
    seen.add(strategy);
    output.push(strategy);
  }
  return output;
};

const mapLegacyModeAlias = (value: string): YouTubeTranscriptMode | null => {
  if (value === "ytdlp") return "yt-dlp";
  if (value === "auto" || value === "web" || value === "no-auto" || value === "yt-dlp" || value === "apify") {
    return value;
  }
  return null;
};

export const normalizeYouTubeTranscriptMode = (
  value: unknown
): YouTubeTranscriptMode | null => {
  if (typeof value !== "string") return null;
  return mapLegacyModeAlias(value.trim().toLowerCase());
};

const resolveMode = (
  inputMode: YouTubeTranscriptModeInput | null | undefined,
  fallbackMode: YouTubeTranscriptMode
): YouTubeTranscriptMode => {
  const normalizedInput = normalizeYouTubeTranscriptMode(inputMode);
  if (normalizedInput) return normalizedInput;
  return normalizeYouTubeTranscriptMode(fallbackMode) ?? "auto";
};

export const resolveYouTubeTranscriptConfig = (
  config: Partial<YouTubeTranscriptResolverConfig> | undefined
): YouTubeTranscriptResolverConfig => {
  const merged: YouTubeTranscriptResolverConfig = {
    ...DEFAULT_TRANSCRIPT_RESOLVER_CONFIG,
    ...(config ?? {})
  };
  const dedupedOrder = dedupeStrategyOrder(merged.strategyOrder);
  const normalizedModeDefault = normalizeYouTubeTranscriptMode(merged.modeDefault) ?? "auto";
  const enableYtdlpAudioAsr = merged.enableYtdlpAudioAsr || merged.enableYtdlp || merged.enableAsr;

  return {
    ...merged,
    modeDefault: normalizedModeDefault,
    strategyOrder: dedupedOrder.includes("native_caption_parse")
      ? dedupedOrder
      : ["native_caption_parse", ...dedupedOrder],
    enableYtdlpAudioAsr,
    ytdlpTimeoutMs: Math.min(120000, Math.max(1000, Math.floor(merged.ytdlpTimeoutMs))),
    apifyActorId: merged.apifyActorId.trim() || DEFAULT_TRANSCRIPT_RESOLVER_CONFIG.apifyActorId
  };
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

const findBalancedSlice = (
  value: string,
  startIndex: number,
  openChar: string,
  closeChar: string
): string | null => {
  let depth = 0;
  let inString = false;
  let escaping = false;
  for (let index = startIndex; index < value.length; index += 1) {
    const char = value[index];
    if (escaping) {
      escaping = false;
      continue;
    }
    if (char === "\\") {
      if (inString) escaping = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === openChar) {
      depth += 1;
      continue;
    }
    if (char === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return value.slice(startIndex, index + 1);
      }
    }
  }
  return null;
};

const findJsonSegmentAfter = (
  value: string,
  marker: string,
  openChar: "{" | "[",
  closeChar: "}" | "]"
): string | null => {
  const markerIndex = value.indexOf(marker);
  if (markerIndex < 0) return null;
  const openIndex = value.indexOf(openChar, markerIndex + marker.length);
  if (openIndex < 0) return null;
  return findBalancedSlice(value, openIndex, openChar, closeChar);
};

const parseJson = <T>(value: string | null): T | null => {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    try {
      return JSON.parse(normalizeEscapedValue(value)) as T;
    } catch {
      return null;
    }
  }
};

const trackNameFromValue = (value: unknown): string => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const record = value as Record<string, unknown>;
  if (typeof record.simpleText === "string") return decodeHtml(record.simpleText);
  if (Array.isArray(record.runs)) {
    return record.runs
      .filter((run): run is { text: string } => Boolean(run && typeof run === "object" && !Array.isArray(run) && typeof (run as { text?: unknown }).text === "string"))
      .map((run) => decodeHtml(run.text))
      .join("")
      .trim();
  }
  return "";
};

const extractCaptionTracks = (html: string): CaptionTrack[] => {
  const block = findJsonSegmentAfter(html, '"captionTracks":', "[", "]");
  const parsed = parseJson<unknown[]>(block);
  if (!Array.isArray(parsed)) return [];

  const tracks: CaptionTrack[] = [];
  for (const candidate of parsed) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const record = candidate as Record<string, unknown>;
    const rawBaseUrl = record.baseUrl;
    const rawLanguage = record.languageCode;
    if (typeof rawBaseUrl !== "string" || typeof rawLanguage !== "string") continue;
    tracks.push({
      baseUrl: normalizeEscapedValue(rawBaseUrl),
      languageCode: rawLanguage,
      name: trackNameFromValue(record.name),
      kind: typeof record.kind === "string" ? record.kind : undefined,
      vssId: typeof record.vssId === "string" ? record.vssId : undefined
    });
  }
  return tracks;
};

const isAutomaticCaptionTrack = (track: CaptionTrack): boolean => {
  if (track.kind?.toLowerCase() === "asr") return true;
  if (track.vssId?.startsWith("a.")) return true;
  if (/auto[- ]generated/i.test(track.name)) return true;
  return false;
};

const isEnglishLike = (languageCode: string): boolean => {
  return languageCode.toLowerCase().startsWith("en");
};

const pickCaptionTrack = (tracks: CaptionTrack[], manualOnly: boolean): CaptionTrack | null => {
  const eligible = manualOnly
    ? tracks.filter((track) => !isAutomaticCaptionTrack(track))
    : tracks;
  if (eligible.length === 0) return null;

  const sorted = [...eligible].sort((left, right) => {
    const leftManual = isAutomaticCaptionTrack(left) ? 0 : 1;
    const rightManual = isAutomaticCaptionTrack(right) ? 0 : 1;
    if (leftManual !== rightManual) return rightManual - leftManual;

    const leftEnglish = isEnglishLike(left.languageCode) ? 1 : 0;
    const rightEnglish = isEnglishLike(right.languageCode) ? 1 : 0;
    if (leftEnglish !== rightEnglish) return rightEnglish - leftEnglish;

    return left.languageCode.localeCompare(right.languageCode);
  });

  return sorted[0] ?? null;
};

export const findCaptionBaseUrl = (html: string): string | null => {
  const track = pickCaptionTrack(extractCaptionTracks(html), false);
  return track?.baseUrl ?? null;
};

export const findTranscriptLanguage = (html: string): string => {
  const track = pickCaptionTrack(extractCaptionTracks(html), false);
  return track?.languageCode ?? "unknown";
};

const parseTranscriptXml = (xml: string): string => {
  const chunks = [...xml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)]
    .map((match) => decodeHtml(match[1] ?? ""))
    .filter(Boolean);
  return chunks.join("\n").trim();
};

const parseTranscriptVtt = (vtt: string): string => {
  return vtt
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !/^WEBVTT/i.test(line))
    .filter((line) => !/^\d{1,2}:\d{2}(?::\d{2})?\.\d{3}\s+-->\s+\d{1,2}:\d{2}(?::\d{2})?\.\d{3}/.test(line))
    .filter((line) => !/^\d+$/.test(line))
    .join("\n")
    .trim();
};

const parseTranscriptPayload = (payload: string): string => {
  if (payload.includes("<text")) return parseTranscriptXml(payload);
  return parseTranscriptVtt(payload);
};

const parseTranscriptJson3 = (payload: string): string => {
  const parsed = parseJson<Record<string, unknown>>(payload);
  if (!parsed) return "";
  const events = parsed.events;
  if (!Array.isArray(events)) return "";

  const lines = events
    .map((event) => {
      if (!event || typeof event !== "object" || Array.isArray(event)) return "";
      const segs = (event as Record<string, unknown>).segs;
      if (!Array.isArray(segs)) return "";
      const text = segs
        .map((segment) => {
          if (!segment || typeof segment !== "object" || Array.isArray(segment)) return "";
          const utf8 = (segment as Record<string, unknown>).utf8;
          return typeof utf8 === "string" ? decodeHtml(utf8) : "";
        })
        .join("")
        .trim();
      return text;
    })
    .filter(Boolean);

  return lines.join("\n").trim();
};

const toTranscriptFetchReasonCode = (status: number): ProviderReasonCode => {
  if (status === 401 || status === 403) return "token_required";
  if (status === 429) return "rate_limited";
  return "transcript_unavailable";
};

const fetchTranscriptPayload = async (
  transcriptUrl: string,
  context: ProviderContext,
  acceptHeader: string
): Promise<TranscriptFetchResponse> => {
  try {
    const response = await fetch(transcriptUrl, {
      headers: {
        ...TRANSCRIPT_FETCH_HEADERS,
        accept: acceptHeader
      },
      signal: context.signal,
      redirect: "follow"
    });
    return {
      ok: response.ok,
      status: response.status,
      payload: await response.text()
    };
  } catch {
    return {
      ok: false,
      status: 0,
      payload: ""
    };
  }
};

const withQueryParam = (baseUrl: string, key: string, value: string): string => {
  try {
    const url = new URL(baseUrl);
    url.searchParams.set(key, value);
    return url.toString();
  } catch {
    return baseUrl;
  }
};

const resolveNativeCaptionTranscript = async (args: {
  pageHtml: string;
  context: ProviderContext;
  manualOnly: boolean;
}): Promise<TranscriptSuccessResult | TranscriptFailureResult> => {
  const tracks = extractCaptionTracks(args.pageHtml);
  const selectedTrack = pickCaptionTrack(tracks, args.manualOnly);
  if (!selectedTrack) {
    return {
      ok: false,
      reasonCode: "caption_missing",
      message: args.manualOnly
        ? "No creator-provided caption track was found."
        : "No caption track URL found in page payload."
    };
  }

  const json3Url = withQueryParam(selectedTrack.baseUrl, "fmt", "json3");
  const json3Response = await fetchTranscriptPayload(json3Url, args.context, "application/json,text/plain,*/*");
  if (json3Response.ok) {
    const json3Text = parseTranscriptJson3(json3Response.payload);
    if (json3Text) {
      return {
        ok: true,
        text: json3Text,
        language: selectedTrack.languageCode || "unknown"
      };
    }
  } else if (json3Response.status === 401 || json3Response.status === 403 || json3Response.status === 429) {
    return {
      ok: false,
      reasonCode: toTranscriptFetchReasonCode(json3Response.status),
      message: `Caption JSON3 endpoint returned HTTP ${json3Response.status}.`
    };
  }

  const fallbackResponse = await fetchTranscriptPayload(selectedTrack.baseUrl, args.context, TRANSCRIPT_FETCH_HEADERS.accept);
  if (!fallbackResponse.ok) {
    return {
      ok: false,
      reasonCode: toTranscriptFetchReasonCode(fallbackResponse.status),
      message: fallbackResponse.status > 0
        ? `Caption endpoint returned HTTP ${fallbackResponse.status}.`
        : "Caption endpoint request failed."
    };
  }

  const text = parseTranscriptPayload(fallbackResponse.payload);
  if (!text) {
    return {
      ok: false,
      reasonCode: "transcript_unavailable",
      message: "Caption endpoint returned no transcript payload."
    };
  }

  return {
    ok: true,
    text,
    language: selectedTrack.languageCode || "unknown"
  };
};

const firstNonEmptyMatch = (value: string, patterns: RegExp[]): string | null => {
  for (const pattern of patterns) {
    const match = value.match(pattern)?.[1];
    if (match && match.trim().length > 0) {
      return decodeHtml(normalizeEscapedValue(match));
    }
  }
  return null;
};

const extractYoutubeiContext = (html: string): Record<string, unknown> | null => {
  const fromObject = parseJson<Record<string, unknown>>(findJsonSegmentAfter(html, '"INNERTUBE_CONTEXT":', "{", "}"));
  if (fromObject) return fromObject;

  const clientName = firstNonEmptyMatch(html, [
    /"INNERTUBE_CONTEXT_CLIENT_NAME":"([^"]+)"/,
    /"clientName":"([^"]+)"/
  ]);
  const clientVersion = firstNonEmptyMatch(html, [
    /"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/,
    /"clientVersion":"([^"]+)"/
  ]);

  if (!clientName || !clientVersion) return null;
  return {
    client: {
      clientName,
      clientVersion
    }
  };
};

const extractYoutubeiTranscriptParams = (html: string): string | null => {
  return firstNonEmptyMatch(html, [
    /"getTranscriptEndpoint"\s*:\s*\{\s*"params"\s*:\s*"([^"]+)"/,
    /"params"\s*:\s*"([^"]+)"\s*,\s*"commandMetadata"\s*:\s*\{\s*"webCommandMetadata"\s*:\s*\{\s*"apiUrl"\s*:\s*"\\\/youtubei\\\/v1\\\/get_transcript"/
  ]);
};

const runTextFromRenderer = (value: unknown): string => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const record = value as Record<string, unknown>;
  if (typeof record.simpleText === "string") return decodeHtml(record.simpleText);
  if (!Array.isArray(record.runs)) return "";
  return record.runs
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return "";
      const text = (entry as Record<string, unknown>).text;
      return typeof text === "string" ? decodeHtml(text) : "";
    })
    .join("")
    .trim();
};

const collectYoutubeiSegments = (payload: unknown): string[] => {
  const segments: string[] = [];
  const queue: unknown[] = [payload];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;

    if (Array.isArray(current)) {
      for (const entry of current) {
        queue.push(entry);
      }
      continue;
    }

    if (typeof current !== "object") continue;
    const record = current as Record<string, unknown>;

    const renderer = record.transcriptSegmentRenderer;
    if (renderer && typeof renderer === "object" && !Array.isArray(renderer)) {
      const text = runTextFromRenderer((renderer as Record<string, unknown>).snippet);
      if (text) segments.push(text);
    }

    for (const value of Object.values(record)) {
      queue.push(value);
    }
  }

  return segments;
};

const findLanguageInPayload = (payload: unknown): string | null => {
  const stack: unknown[] = [payload];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    if (Array.isArray(current)) {
      for (const entry of current) stack.push(entry);
      continue;
    }
    if (typeof current !== "object") continue;

    const record = current as Record<string, unknown>;
    const languageCode = record.languageCode;
    if (typeof languageCode === "string" && languageCode.trim().length > 0) {
      return languageCode;
    }

    for (const value of Object.values(record)) {
      stack.push(value);
    }
  }

  return null;
};

const resolveYoutubeiTranscript = async (args: {
  pageHtml: string;
  context: ProviderContext;
}): Promise<TranscriptSuccessResult | TranscriptFailureResult> => {
  const apiKey = firstNonEmptyMatch(args.pageHtml, [
    /"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/,
    /"innertubeApiKey"\s*:\s*"([^"]+)"/
  ]);
  const context = extractYoutubeiContext(args.pageHtml);
  const params = extractYoutubeiTranscriptParams(args.pageHtml);

  if (!apiKey || !context || !params) {
    return {
      ok: false,
      reasonCode: "caption_missing",
      message: "youtubei transcript bootstrap payload is missing API key, context, or transcript params."
    };
  }

  let response: Response;
  try {
    response = await fetch(`https://www.youtube.com/youtubei/v1/get_transcript?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: YOUTUBEI_HEADERS,
      body: JSON.stringify({ context, params }),
      signal: args.context.signal
    });
  } catch {
    return {
      ok: false,
      reasonCode: "transcript_unavailable",
      message: "youtubei transcript endpoint request failed."
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      reasonCode: toTranscriptFetchReasonCode(response.status),
      message: `youtubei transcript endpoint returned HTTP ${response.status}.`
    };
  }

  const payloadText = await response.text();
  const payload = parseJson<unknown>(payloadText);
  if (!payload) {
    return {
      ok: false,
      reasonCode: "transcript_unavailable",
      message: "youtubei transcript endpoint returned malformed JSON."
    };
  }

  const segments = collectYoutubeiSegments(payload);
  if (segments.length === 0) {
    return {
      ok: false,
      reasonCode: "transcript_unavailable",
      message: "youtubei transcript payload did not include transcript segments."
    };
  }

  return {
    ok: true,
    text: segments.join("\n").trim(),
    language: findLanguageInPayload(payload) ?? findTranscriptLanguage(args.pageHtml)
  };
};

const normalizeErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  return String(error);
};

const toExecFailureReasonCode = (
  message: string,
  fallback: ProviderReasonCode
): ProviderReasonCode => {
  if (/ENOENT|not found|spawn\s+yt-dlp/i.test(message)) return "env_limited";
  if (/timeout|timed out|ETIMEDOUT/i.test(message)) return "transcript_unavailable";
  if (/429|rate\s*limit/i.test(message)) return "rate_limited";
  if (/401|403|forbidden|unauthorized/i.test(message)) return "token_required";
  return fallback;
};

const resolveYtdlpAudioAsrTranscript = async (args: {
  watchUrl: string;
  context: ProviderContext;
  timeoutMs: number;
  asrTranscribe: NonNullable<YouTubeTranscriptResolverDependencies["asrTranscribe"]>;
}): Promise<TranscriptSuccessResult | TranscriptFailureResult> => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "opendevbrowser-ytdlp-"));
  try {
    const outputTemplate = path.join(tempDir, "audio.%(ext)s");
    await execFileAsync(
      "yt-dlp",
      [
        "-x",
        "--audio-format",
        "mp3",
        "--no-playlist",
        "--no-warnings",
        "-o",
        outputTemplate,
        args.watchUrl
      ],
      {
        timeout: args.timeoutMs,
        maxBuffer: 8 * 1024 * 1024
      }
    );

    const files = await readdir(tempDir);
    const audioFile = files
      .filter((file) => /\.(mp3|m4a|wav|opus|ogg)$/i.test(file))
      .sort()[0];
    if (!audioFile) {
      return {
        ok: false,
        reasonCode: "transcript_unavailable",
        message: "yt-dlp audio download did not produce an audio file."
      };
    }

    const transcript = await args.asrTranscribe({
      watchUrl: args.watchUrl,
      context: args.context,
      audioFilePath: path.join(tempDir, audioFile)
    });

    if (!transcript?.text.trim()) {
      return {
        ok: false,
        reasonCode: "transcript_unavailable",
        message: "ASR returned an empty transcript."
      };
    }

    return {
      ok: true,
      text: transcript.text,
      language: transcript.language ?? "unknown"
    };
  } catch (error) {
    const message = normalizeErrorMessage(error);
    return {
      ok: false,
      reasonCode: toExecFailureReasonCode(message, "transcript_unavailable"),
      message
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {
      // Best-effort temp cleanup.
    });
  }
};

const readApifyTextCandidate = (value: unknown): string => {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    const joined = value
      .map((entry) => {
        if (typeof entry === "string") return entry;
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) return "";
        const text = (entry as Record<string, unknown>).text;
        return typeof text === "string" ? text : "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
    return joined;
  }
  return "";
};

const resolveApifyTranscriptFromItems = (items: unknown): { text: string; language: string } | null => {
  if (!Array.isArray(items)) return null;
  const transcriptKeys = ["transcript", "captions", "subtitles", "text"];

  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;

    for (const key of transcriptKeys) {
      const value = readApifyTextCandidate(record[key]);
      if (!value) continue;
      const language = typeof record.languageCode === "string"
        ? record.languageCode
        : typeof record.language === "string"
          ? record.language
          : "unknown";
      return {
        text: value,
        language
      };
    }
  }

  return null;
};

const resolveApifyTranscript = async (args: {
  watchUrl: string;
  context: ProviderContext;
  actorId: string;
  token: string;
}): Promise<TranscriptSuccessResult | TranscriptFailureResult> => {
  const encodedActorId = encodeURIComponent(args.actorId);
  const runUrl = `https://api.apify.com/v2/acts/${encodedActorId}/runs?token=${encodeURIComponent(args.token)}&waitForFinish=120`;

  let runResponse: Response;
  try {
    runResponse = await fetch(runUrl, {
      method: "POST",
      headers: APIFY_HEADERS,
      signal: args.context.signal,
      body: JSON.stringify({
        startUrls: [{ url: args.watchUrl }]
      })
    });
  } catch {
    return {
      ok: false,
      reasonCode: "transcript_unavailable",
      message: "Apify actor request failed."
    };
  }

  if (!runResponse.ok) {
    return {
      ok: false,
      reasonCode: toTranscriptFetchReasonCode(runResponse.status),
      message: `Apify actor request returned HTTP ${runResponse.status}.`
    };
  }

  const runPayload = parseJson<ApifyRunResponse>(await runResponse.text());
  const datasetId = runPayload?.data?.defaultDatasetId;
  if (!datasetId) {
    return {
      ok: false,
      reasonCode: "transcript_unavailable",
      message: "Apify actor response did not include a dataset id."
    };
  }

  const datasetUrl = `https://api.apify.com/v2/datasets/${encodeURIComponent(datasetId)}/items?token=${encodeURIComponent(args.token)}&clean=true&format=json`;

  let datasetResponse: Response;
  try {
    datasetResponse = await fetch(datasetUrl, {
      headers: {
        accept: "application/json"
      },
      signal: args.context.signal
    });
  } catch {
    return {
      ok: false,
      reasonCode: "transcript_unavailable",
      message: "Apify dataset request failed."
    };
  }

  if (!datasetResponse.ok) {
    return {
      ok: false,
      reasonCode: toTranscriptFetchReasonCode(datasetResponse.status),
      message: `Apify dataset request returned HTTP ${datasetResponse.status}.`
    };
  }

  const transcript = resolveApifyTranscriptFromItems(parseJson<unknown>(await datasetResponse.text()));
  if (!transcript) {
    return {
      ok: false,
      reasonCode: "transcript_unavailable",
      message: "Apify dataset did not include transcript text."
    };
  }

  return {
    ok: true,
    text: transcript.text,
    language: transcript.language
  };
};

const isStrategyApproved = (
  checklist: YouTubeTranscriptLegalChecklist,
  strategy: YouTubeTranscriptStrategyDetail
): boolean => {
  const expiry = Date.parse(checklist.approvalExpiryDate);
  if (!checklist.signedOff || Number.isNaN(expiry) || expiry <= Date.now()) {
    return false;
  }

  if (strategy === "ytdlp_audio_asr") {
    return checklist.approvedTranscriptStrategies.includes("ytdlp_audio_asr")
      || checklist.approvedTranscriptStrategies.includes("optional_asr")
      || checklist.approvedTranscriptStrategies.includes("ytdlp_subtitle");
  }

  return checklist.approvedTranscriptStrategies.includes(strategy);
};

const modeBaseStrategies = (mode: YouTubeTranscriptMode): TranscriptPlannerStrategy[] => {
  switch (mode) {
    case "auto":
      return ["youtubei", "native_caption_parse", "ytdlp_audio_asr", "apify"];
    case "web":
      return ["youtubei", "native_caption_parse"];
    case "no-auto":
      return ["native_caption_parse", "ytdlp_audio_asr"];
    case "yt-dlp":
      return ["ytdlp_audio_asr"];
    case "apify":
      return ["apify"];
  }
};

const mapStrategyOrderEntry = (
  strategy: TranscriptPlannerStrategy | LegacyTranscriptStrategy
): TranscriptPlannerStrategy[] => {
  if (strategy === "youtubei" || strategy === "native_caption_parse" || strategy === "ytdlp_audio_asr" || strategy === "apify") {
    return [strategy];
  }
  if (strategy === "ytdlp_subtitle") {
    return ["ytdlp_audio_asr"];
  }
  return ["ytdlp_audio_asr", "apify"];
};

const planStrategies = (
  mode: YouTubeTranscriptMode,
  strategyOrder: Array<TranscriptPlannerStrategy | LegacyTranscriptStrategy>
): TranscriptPlannerStrategy[] => {
  const base = modeBaseStrategies(mode);
  const allowed = new Set(base);
  const ordered: TranscriptPlannerStrategy[] = [];

  for (const entry of strategyOrder) {
    for (const mapped of mapStrategyOrderEntry(entry)) {
      if (!allowed.has(mapped) || ordered.includes(mapped)) continue;
      ordered.push(mapped);
    }
  }

  for (const fallback of base) {
    if (ordered.includes(fallback)) continue;
    ordered.push(fallback);
  }

  return ordered;
};

const mapDetailToBucket = (detail: YouTubeTranscriptStrategyDetail): YouTubeTranscriptStrategy => {
  switch (detail) {
    case "youtubei":
    case "native_caption_parse":
      return "native_caption_parse";
    case "ytdlp_audio_asr":
    case "apify":
      return "optional_asr";
    case "browser_assisted":
      return "browser_assisted";
  }
};

const createFailure = (
  mode: YouTubeTranscriptMode,
  reasonCode: ProviderReasonCode,
  attemptChain: YouTubeTranscriptAttempt[]
): YouTubeTranscriptFailure => ({
  ok: false,
  mode,
  reasonCode,
  attemptChain
});

const createAttempt = (
  strategy: YouTubeTranscriptStrategyDetail,
  reasonCode: ProviderReasonCode,
  message: string,
  details?: Record<string, JsonValue>
): YouTubeTranscriptAttempt => ({
  strategy,
  ok: false,
  reasonCode,
  message,
  ...(details ? { details } : {})
});

const isForcedMode = (mode: YouTubeTranscriptMode): boolean => {
  return mode === "yt-dlp" || mode === "apify";
};

const isYtdlpSubtitleAliasConfigured = (
  config: YouTubeTranscriptResolverConfig
): boolean => config.strategyOrder.includes("ytdlp_subtitle");

const resolveApifyToken = (): string | null => {
  const token = process.env.APIFY_TOKEN ?? process.env.APIFY_API_TOKEN;
  if (!token || !token.trim()) return null;
  return token.trim();
};

const precheckStrategyAvailability = (args: {
  strategy: TranscriptPlannerStrategy;
  config: YouTubeTranscriptResolverConfig;
  hasAsrTranscriber: boolean;
  apifyToken: string | null;
}): TranscriptFailureResult | null => {
  if (args.strategy === "youtubei") {
    return null;
  }

  if (args.strategy === "ytdlp_audio_asr") {
    if (!args.config.enableYtdlpAudioAsr) {
      return {
        ok: false,
        reasonCode: "env_limited",
        message: "yt-dlp audio ASR strategy is disabled by configuration."
      };
    }
    if (!args.hasAsrTranscriber) {
      return {
        ok: false,
        reasonCode: "env_limited",
        message: "ASR engine is not configured."
      };
    }
    return null;
  }

  if (args.strategy === "apify") {
    if (!args.config.enableApify) {
      return {
        ok: false,
        reasonCode: "env_limited",
        message: "Apify strategy is disabled by configuration."
      };
    }
    if (!args.apifyToken) {
      return {
        ok: false,
        reasonCode: "token_required",
        message: "APIFY_TOKEN is required to use the Apify transcript strategy."
      };
    }
    return null;
  }

  return null;
};

const withLegacyYtdlpAliasNote = (
  message: string,
  config: YouTubeTranscriptResolverConfig
): string => {
  if (!isYtdlpSubtitleAliasConfigured(config)) return message;
  return `${message} (legacy ytdlp_subtitle alias mapped to ytdlp_audio_asr)`;
};

const isDeferredFallbackReason = (reasonCode: ProviderReasonCode): boolean => {
  return reasonCode === "env_limited" || reasonCode === "token_required";
};

const resolveStrategyFailureReason = (
  fallback: ProviderReasonCode,
  attempts: YouTubeTranscriptAttempt[]
): ProviderReasonCode => {
  for (let index = attempts.length - 1; index >= 0; index -= 1) {
    const reasonCode = attempts[index]?.reasonCode;
    if (!reasonCode) continue;
    if (!isDeferredFallbackReason(reasonCode)) {
      return reasonCode;
    }
  }
  for (let index = attempts.length - 1; index >= 0; index -= 1) {
    const reasonCode = attempts[index]?.reasonCode;
    if (!reasonCode || reasonCode === "env_limited") continue;
    return reasonCode;
  }
  return attempts.at(-1)?.reasonCode ?? fallback;
};

export const resolveYouTubeTranscript = async (
  deps: YouTubeTranscriptResolverDependencies
): Promise<YouTubeTranscriptResolution> => {
  const config = resolveYouTubeTranscriptConfig(deps.config);
  const mode = resolveMode(deps.mode, config.modeDefault);
  const forcedMode = isForcedMode(mode);
  const attemptChain: YouTubeTranscriptAttempt[] = [];
  const planned = planStrategies(mode, config.strategyOrder);
  const apifyToken = resolveApifyToken();

  for (const strategy of planned) {
    const availability = precheckStrategyAvailability({
      strategy,
      config,
      hasAsrTranscriber: Boolean(deps.asrTranscribe),
      apifyToken
    });

    if (availability) {
      const message = strategy === "ytdlp_audio_asr"
        ? withLegacyYtdlpAliasNote(availability.message, config)
        : availability.message;
      attemptChain.push(createAttempt(strategy, availability.reasonCode, message));
      if (forcedMode) {
        return createFailure(mode, availability.reasonCode, attemptChain);
      }
      continue;
    }

    if (!isStrategyApproved(deps.legalChecklist, strategy)) {
      const message = `Legal gate blocked transcript strategy: ${strategy}`;
      attemptChain.push(createAttempt(strategy, "strategy_unapproved", message));
      if (forcedMode) {
        return createFailure(mode, "strategy_unapproved", attemptChain);
      }
      continue;
    }

    if (strategy === "youtubei") {
      const resolved = await resolveYoutubeiTranscript({
        pageHtml: deps.pageHtml,
        context: deps.context
      });

      if (!resolved.ok) {
        attemptChain.push(createAttempt(strategy, resolved.reasonCode, resolved.message));
        continue;
      }

      attemptChain.push({ strategy, ok: true });
      return {
        ok: true,
        mode,
        text: resolved.text,
        language: resolved.language,
        transcriptStrategy: mapDetailToBucket(strategy),
        transcriptStrategyDetail: strategy,
        attemptChain
      };
    }

    if (strategy === "native_caption_parse") {
      const resolved = await resolveNativeCaptionTranscript({
        pageHtml: deps.pageHtml,
        context: deps.context,
        manualOnly: mode === "no-auto"
      });

      if (!resolved.ok) {
        attemptChain.push(createAttempt(strategy, resolved.reasonCode, resolved.message));
        continue;
      }

      attemptChain.push({ strategy, ok: true });
      return {
        ok: true,
        mode,
        text: resolved.text,
        language: resolved.language,
        transcriptStrategy: mapDetailToBucket(strategy),
        transcriptStrategyDetail: strategy,
        attemptChain
      };
    }

    if (strategy === "ytdlp_audio_asr") {
      const asrTranscribe = deps.asrTranscribe as NonNullable<YouTubeTranscriptResolverDependencies["asrTranscribe"]>;

      const resolved = await resolveYtdlpAudioAsrTranscript({
        watchUrl: deps.watchUrl,
        context: deps.context,
        timeoutMs: config.ytdlpTimeoutMs,
        asrTranscribe
      });

      if (!resolved.ok) {
        const message = withLegacyYtdlpAliasNote(resolved.message, config);
        attemptChain.push(createAttempt(strategy, resolved.reasonCode, message));
        continue;
      }

      const successMessage = isYtdlpSubtitleAliasConfigured(config)
        ? "legacy ytdlp_subtitle alias mapped to ytdlp_audio_asr"
        : undefined;
      attemptChain.push({
        strategy,
        ok: true,
        ...(successMessage ? { message: successMessage } : {})
      });
      return {
        ok: true,
        mode,
        text: resolved.text,
        language: resolved.language,
        transcriptStrategy: mapDetailToBucket(strategy),
        transcriptStrategyDetail: strategy,
        attemptChain
      };
    }

    if (strategy === "apify") {
      const ensuredApifyToken = apifyToken as string;

      const resolved = await resolveApifyTranscript({
        watchUrl: deps.watchUrl,
        context: deps.context,
        actorId: config.apifyActorId,
        token: ensuredApifyToken
      });

      if (!resolved.ok) {
        attemptChain.push(createAttempt(strategy, resolved.reasonCode, resolved.message));
        continue;
      }

      attemptChain.push({ strategy, ok: true });
      return {
        ok: true,
        mode,
        text: resolved.text,
        language: resolved.language,
        transcriptStrategy: mapDetailToBucket(strategy),
        transcriptStrategyDetail: strategy,
        attemptChain
      };
    }
  }

  if (
    !forcedMode
    && config.enableBrowserFallback
    && deps.browserFallbackPort
    && deps.allowBrowserFallbackEscalation
  ) {
    const fallback = await deps.browserFallbackPort.resolve({
      provider: "social/youtube",
      source: "social",
      operation: "fetch",
      reasonCode: "transcript_unavailable",
      trace: deps.context.trace,
      url: deps.watchUrl,
      preferredModes: ["extension", "managed_headed"],
      ...(typeof deps.context.useCookies === "boolean"
        ? { useCookies: deps.context.useCookies }
        : {}),
      ...(deps.context.cookiePolicyOverride
        ? { cookiePolicyOverride: deps.context.cookiePolicyOverride }
        : {}),
      details: {
        request: "youtube_transcript"
      }
    });

    if (!fallback.ok) {
      const fallbackDiagnostics = (
        fallback.details?.cookieDiagnostics
          && typeof fallback.details.cookieDiagnostics === "object"
          && !Array.isArray(fallback.details.cookieDiagnostics)
      )
        ? { cookieDiagnostics: fallback.details.cookieDiagnostics as Record<string, JsonValue> }
        : undefined;
      attemptChain.push({
        strategy: "browser_assisted",
        ok: false,
        reasonCode: fallback.reasonCode,
        message: typeof fallback.details?.message === "string" ? fallback.details.message : "Browser fallback failed.",
        ...(fallbackDiagnostics ? { details: fallbackDiagnostics } : {})
      });
      return createFailure(mode, fallback.reasonCode, attemptChain);
    }

    const html = fallback.output?.html;
    if (typeof html !== "string" || html.trim().length === 0) {
      attemptChain.push(createAttempt("browser_assisted", "env_limited", "Browser fallback did not return page HTML."));
      return createFailure(mode, "env_limited", attemptChain);
    }

    const nativeResolved = await resolveNativeCaptionTranscript({
      pageHtml: html,
      context: deps.context,
      manualOnly: mode === "no-auto"
    });

    if (!nativeResolved.ok) {
      attemptChain.push(createAttempt("browser_assisted", nativeResolved.reasonCode, nativeResolved.message));
      return createFailure(mode, nativeResolved.reasonCode, attemptChain);
    }

    attemptChain.push({ strategy: "browser_assisted", ok: true });
    return {
      ok: true,
      mode,
      text: nativeResolved.text,
      language: nativeResolved.language,
      transcriptStrategy: "browser_assisted",
      transcriptStrategyDetail: "browser_assisted",
      attemptChain
    };
  }

  return createFailure(
    mode,
    resolveStrategyFailureReason("transcript_unavailable", attemptChain),
    attemptChain
  );
};

export const asTranscriptProviderError = (
  message: string,
  reasonCode: ProviderReasonCode
): {
  code: ReturnType<typeof providerErrorCodeFromReasonCode>;
  message: string;
  reasonCode: ProviderReasonCode;
  details: Record<string, JsonValue>;
} => ({
  code: providerErrorCodeFromReasonCode(reasonCode),
  message,
  reasonCode,
  details: {
    reasonCode
  }
});
