import type {
  JsonValue,
  ProviderAggregateResult,
  ProviderCallResultByOperation,
  ProviderExecutionMetadata,
  ProviderOperation,
  ProviderRunOptions,
  ProviderSelection,
  WorkflowBrowserMode
} from "../providers/types";
import type { SocialPlatform } from "../providers/social";
import { detectSocialSearchShell } from "../providers/social/search-quality";

export type MacroResolution = {
  action: {
    source: ProviderSelection;
    operation: ProviderOperation;
    input: Record<string, unknown>;
  };
  provenance: {
    macro: string;
    provider: string;
    resolvedQuery: string;
    pack: string;
    args: {
      positional: string[];
      named: Record<string, string>;
    };
  };
};

export type MacroRuntimeExecutor = {
  search: (
    input: ProviderCallResultByOperation["search"],
    options?: ProviderRunOptions
  ) => Promise<ProviderAggregateResult>;
  fetch: (
    input: ProviderCallResultByOperation["fetch"],
    options?: ProviderRunOptions
  ) => Promise<ProviderAggregateResult>;
  crawl: (
    input: ProviderCallResultByOperation["crawl"],
    options?: ProviderRunOptions
  ) => Promise<ProviderAggregateResult>;
  post: (
    input: ProviderCallResultByOperation["post"],
    options?: ProviderRunOptions
  ) => Promise<ProviderAggregateResult>;
};

export type MacroExecutionPayload = {
  records: ProviderAggregateResult["records"];
  failures: ProviderAggregateResult["failures"];
  metrics: ProviderAggregateResult["metrics"];
  meta: {
    ok: ProviderAggregateResult["ok"];
    partial: ProviderAggregateResult["partial"];
    sourceSelection: ProviderAggregateResult["sourceSelection"];
    providerOrder: ProviderAggregateResult["providerOrder"];
    trace: ProviderAggregateResult["trace"];
    tier?: ProviderExecutionMetadata["tier"];
    provenance?: ProviderExecutionMetadata["provenance"];
    blocker?: ProviderExecutionMetadata["blocker"];
    error?: ProviderAggregateResult["error"];
  };
  diagnostics?: ProviderAggregateResult["diagnostics"];
};

type MacroExecutionOverrides = Pick<ProviderRunOptions, "challengeAutomationMode"> & {
  browserMode?: WorkflowBrowserMode;
  useCookies?: boolean;
  cookiePolicyOverride?: ProviderRunOptions["cookiePolicyOverride"];
};

const buildRuntimePolicyOverrides = (
  overrides?: MacroExecutionOverrides
): ProviderRunOptions["runtimePolicy"] | undefined => {
  if (!overrides) {
    return undefined;
  }
  const runtimePolicy = {
    ...(overrides.browserMode ? { browserMode: overrides.browserMode } : {}),
    ...(typeof overrides.useCookies === "boolean" ? { useCookies: overrides.useCookies } : {}),
    ...(overrides.cookiePolicyOverride ? { cookiePolicyOverride: overrides.cookiePolicyOverride } : {})
  };
  return Object.keys(runtimePolicy).length > 0 ? runtimePolicy : undefined;
};

const isRecordValue = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const requireMacroString = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Macro action missing ${label}`);
  }
  return value;
};

const optionalPositiveInteger = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;

const optionalBoolean = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;

const optionalJsonRecord = (value: unknown): Record<string, JsonValue> | undefined =>
  isRecordValue(value) ? value as Record<string, JsonValue> : undefined;

const optionalStringArray = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const parsed = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return parsed.length > 0 ? parsed : undefined;
};

const normalizePlainText = (value: unknown): string => (
  typeof value === "string"
    ? value.replace(/\s+/g, " ").trim()
    : ""
);

const REDDIT_VERIFICATION_WALL_RE = /\b(?:please wait for verification|verify you are human|security check)\b/i;

const readTargetedSocialPlatform = (
  providerId?: string
): Extract<SocialPlatform, "x" | "bluesky" | "reddit" | "facebook" | "threads"> | null => {
  switch (providerId) {
    case "social/x":
      return "x";
    case "social/bluesky":
      return "bluesky";
    case "social/reddit":
      return "reddit";
    case "social/facebook":
      return "facebook";
    case "social/threads":
      return "threads";
    default:
      return null;
  }
};

const getMacroShellReason = (
  record: ProviderAggregateResult["records"][number],
  providerId?: string,
  fallbackRetrievalPath?: string
): string | null => {
  const url = normalizePlainText(record?.url).toLowerCase();
  const title = normalizePlainText(record?.title);
  const content = normalizePlainText(record?.content);
  const combined = `${title} ${content}`.trim().toLowerCase();
  const retrievalPath = normalizePlainText(
    typeof record?.attributes?.retrievalPath === "string"
      ? record.attributes.retrievalPath
      : fallbackRetrievalPath
  ).toLowerCase();
  const extractionQuality = optionalJsonRecord(record?.attributes?.extractionQuality);
  const contentChars = Number(extractionQuality?.contentChars ?? content.length);
  const links = optionalStringArray(record?.attributes?.links) ?? [];

  if (
    combined.includes("bots use duckduckgo too")
    || combined.includes("please complete the following challenge")
    || combined.includes("select all squares containing a duck")
  ) {
    return "challenge_shell";
  }

  const socialPlatform = readTargetedSocialPlatform(providerId);
  if (socialPlatform) {
    const socialShell = detectSocialSearchShell(socialPlatform, {
      url,
      title,
      content,
      links
    });
    if (socialShell) {
      return socialShell.providerShell;
    }
  }

  if (url.includes("reddit.com") && REDDIT_VERIFICATION_WALL_RE.test(combined)) {
    return "challenge_shell";
  }

  if (
    retrievalPath === "web:search:index"
    && (
      url.includes("duckduckgo.com")
      || title.toLowerCase().includes("duckduckgo")
    )
  ) {
    return "search_shell";
  }

  if (
    providerId === "web/default"
    && (retrievalPath === "web:fetch:url" || retrievalPath.startsWith("fetch:"))
    && contentChars > 0
    && contentChars <= 8
    && links.length >= 20
  ) {
    return "truncated_fetch_shell";
  }

  if (
    providerId === "social/youtube"
    && (
      (
        url.includes("youtube.com/watch")
        && combined.includes("about press copyright contact us creators advertise developers terms privacy policy")
      )
      || (
        url.includes("developers.google.com/youtube")
        && combined.includes("google for developers skip to main content youtube")
      )
    )
  ) {
    return "generic_shell";
  }

  return null;
};

const assertMacroExecutionQuality = (
  resolution: MacroResolution,
  result: ProviderAggregateResult
): void => {
  if (!Array.isArray(result.records) || result.records.length === 0 || result.failures.length > 0) {
    return;
  }

  const providerId = typeof resolution.action.input.providerId === "string"
    && resolution.action.input.providerId.trim()
    ? resolution.action.input.providerId.trim()
    : resolution.provenance.provider;
  const fallbackRetrievalPath = normalizePlainText(
    optionalJsonRecord(result.meta?.provenance)?.retrievalPath as string | undefined
  );
  const reasons = result.records
    .map((record) => getMacroShellReason(record, providerId, fallbackRetrievalPath))
    .filter((reason): reason is string => typeof reason === "string");
  if (reasons.length !== result.records.length) {
    return;
  }

  throw new Error(`Macro execution returned only shell records (${[...new Set(reasons)].join(",")}).`);
};

const partitionMacroExecutionRecords = (
  records: ProviderAggregateResult["records"],
  providerId?: string,
  fallbackRetrievalPath?: string
): {
  usable: ProviderAggregateResult["records"];
  shell: Array<{ record: ProviderAggregateResult["records"][number]; reason: string }>;
} => {
  const usable: ProviderAggregateResult["records"] = [];
  const shell: Array<{ record: ProviderAggregateResult["records"][number]; reason: string }> = [];
  for (const record of records) {
    const reason = getMacroShellReason(record, providerId, fallbackRetrievalPath);
    if (reason) {
      shell.push({ record, reason });
    } else {
      usable.push(record);
    }
  }
  return { usable, shell };
};

const prioritizeMacroExecutionRecords = (
  resolution: MacroResolution,
  result: ProviderAggregateResult
): ProviderAggregateResult => {
  if (!Array.isArray(result.records) || result.records.length <= 1) {
    return result;
  }

  const providerId = typeof resolution.action.input.providerId === "string"
    && resolution.action.input.providerId.trim()
    ? resolution.action.input.providerId.trim()
    : resolution.provenance.provider;
  const fallbackRetrievalPath = normalizePlainText(
    optionalJsonRecord(result.meta?.provenance)?.retrievalPath as string | undefined
  );
  const { usable, shell } = partitionMacroExecutionRecords(result.records, providerId, fallbackRetrievalPath);
  if (usable.length === 0 || shell.length === 0) {
    return result;
  }

  return {
    ...result,
    records: [
      ...usable,
      ...shell.map((entry) => entry.record)
    ]
  };
};

const normalizeSearchInput = (input: Record<string, unknown>): ProviderCallResultByOperation["search"] => {
  const query = requireMacroString(input.query, "search.query");
  const limit = optionalPositiveInteger(input.limit);
  const filters = optionalJsonRecord(input.filters);
  return {
    query,
    ...(limit !== undefined ? { limit } : {}),
    ...(filters ? { filters } : {})
  };
};

const normalizeFetchInput = (input: Record<string, unknown>): ProviderCallResultByOperation["fetch"] => {
  const url = requireMacroString(input.url, "fetch.url");
  const filters = optionalJsonRecord(input.filters);
  return {
    url,
    ...(filters ? { filters } : {})
  };
};

const normalizeCrawlInput = (input: Record<string, unknown>): ProviderCallResultByOperation["crawl"] => {
  const seedUrls = optionalStringArray(input.seedUrls);
  if (!seedUrls || seedUrls.length === 0) {
    throw new Error("Macro action missing crawl.seedUrls");
  }

  const strategy = input.strategy === "bfs" || input.strategy === "dfs"
    ? input.strategy
    : undefined;
  const maxDepth = optionalPositiveInteger(input.maxDepth);
  const maxPages = optionalPositiveInteger(input.maxPages);
  const maxPerDomain = optionalPositiveInteger(input.maxPerDomain);
  const filters = optionalJsonRecord(input.filters);

  return {
    seedUrls,
    ...(strategy ? { strategy } : {}),
    ...(maxDepth !== undefined ? { maxDepth } : {}),
    ...(maxPages !== undefined ? { maxPages } : {}),
    ...(maxPerDomain !== undefined ? { maxPerDomain } : {}),
    ...(filters ? { filters } : {})
  };
};

const normalizePostInput = (input: Record<string, unknown>): ProviderCallResultByOperation["post"] => {
  const target = requireMacroString(input.target, "post.target");
  const content = requireMacroString(input.content, "post.content");
  const mediaUrls = optionalStringArray(input.mediaUrls);
  const confirm = optionalBoolean(input.confirm);
  const riskAccepted = optionalBoolean(input.riskAccepted);
  const metadata = optionalJsonRecord(input.metadata);

  return {
    target,
    content,
    ...(mediaUrls ? { mediaUrls } : {}),
    ...(confirm !== undefined ? { confirm } : {}),
    ...(riskAccepted !== undefined ? { riskAccepted } : {}),
    ...(metadata ? { metadata } : {})
  };
};

const buildRunOptions = (
  resolution: MacroResolution,
  overrides?: MacroExecutionOverrides
): ProviderRunOptions => {
  const source = resolution.action.source;
  const providerId = typeof resolution.action.input.providerId === "string"
    && resolution.action.input.providerId.trim()
    ? resolution.action.input.providerId.trim()
    : undefined;
  const runtimePolicy = buildRuntimePolicyOverrides(overrides);
  return {
    source,
    ...(providerId ? { providerIds: [providerId] } : {}),
    ...(overrides?.challengeAutomationMode
      ? { challengeAutomationMode: overrides.challengeAutomationMode }
      : {}),
    ...(runtimePolicy ? { runtimePolicy } : {})
  };
};

export const executeMacroResolution = async (
  resolution: MacroResolution,
  runtime: MacroRuntimeExecutor,
  overrides?: MacroExecutionOverrides
): Promise<ProviderAggregateResult> => {
  const { operation, input } = resolution.action;
  if (!isRecordValue(input)) {
    throw new Error("Macro action input is invalid");
  }

  const options = buildRunOptions(resolution, overrides);
  let result: ProviderAggregateResult;
  switch (operation) {
    case "search":
      result = await runtime.search(normalizeSearchInput(input), options);
      break;
    case "fetch":
      result = await runtime.fetch(normalizeFetchInput(input), options);
      break;
    case "crawl":
      result = await runtime.crawl(normalizeCrawlInput(input), options);
      break;
    case "post":
      result = await runtime.post(normalizePostInput(input), options);
      break;
    default:
      throw new Error(`Macro operation is not supported: ${operation}`);
  }
  const prioritized = prioritizeMacroExecutionRecords(resolution, result);
  assertMacroExecutionQuality(resolution, prioritized);
  return prioritized;
};

export const shapeExecutionPayload = (result: ProviderAggregateResult): MacroExecutionPayload => {
  return {
    records: result.records,
    failures: result.failures,
    metrics: result.metrics,
    meta: {
      ok: result.ok,
      partial: result.partial,
      sourceSelection: result.sourceSelection,
      providerOrder: result.providerOrder,
      trace: result.trace,
      ...(result.meta?.tier ? { tier: result.meta.tier } : {}),
      ...(result.meta?.provenance ? { provenance: result.meta.provenance } : {}),
      ...(result.meta?.blocker ? { blocker: result.meta.blocker } : {}),
      ...(result.error ? { error: result.error } : {})
    },
    ...(result.diagnostics ? { diagnostics: result.diagnostics } : {})
  };
};
