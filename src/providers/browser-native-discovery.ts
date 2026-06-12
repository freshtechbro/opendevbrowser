import {
  createProviderError,
  isProviderReasonCode,
  normalizeProviderReasonCode,
  providerErrorCodeFromReasonCode
} from "./errors";
import type { JsonValue, NormalizedRecord, ProviderFailureEntry, ProviderReasonCode, ProviderSource } from "./types";
import type { SiteRecipe, SiteRecipeBadState } from "../guidance/types";
import {
  classifyPinterestCandidate,
  classifyPinterestSourcePage,
  hasPinterestChromeMarkers,
  isCanonicalPinterestPinUrl,
  shouldBlockPinterestSourceExtraction,
  summarizePinterestClassifications,
  type PinterestMediaClassification,
  type PinterestSourcePageQuality
} from "../inspiredesign/pinterest-media-classification";
import { isAllowedPinterestReferenceHost, normalizePinterestReferenceUrl } from "../guidance/recipes/pinterest";

export type BrowserNativeDiscoveryResult = {
  records: NormalizedRecord[];
  failures: ProviderFailureEntry[];
  diagnostics: Record<string, JsonValue>;
};

export type BrowserNativeDiscoveryInput = {
  recipe: SiteRecipe;
  query: string;
  maxReferences: number;
  browserMode?: string;
  useCookies?: boolean;
  cookiePolicy?: string;
  fetchSearchPage?: (url: string) => Promise<BrowserNativeDiscoveryFetchResult>;
};

export type BrowserNativeDiscoveryFetchResult = {
  records: NormalizedRecord[];
  failures: ProviderFailureEntry[];
  errorMessage?: string;
};

type MatchedBadState = {
  state: SiteRecipeBadState;
  reasonCode: ProviderReasonCode;
};

type BadStateMatchMode = "hard_blocker" | "pre_extraction" | "all";
type ReferenceUrlFilter = (url: string, record: NormalizedRecord) => boolean;

const RENDERED_HREF_PATTERN = /href\s*=\s*["']([^"']+)["']/gi;
const SEARCH_RESULT_CONTEXT_MARKERS = [
  "data-grid=\"search-results",
  "data-grid='search-results",
  "aria-label=\"search results",
  "aria-label='search results"
];

const HARD_FAILURE_REASON_CODES = new Set<ProviderReasonCode>([
  "auth_required",
  "challenge_detected",
  "policy_blocked",
  "rate_limited",
  "token_required"
]);

const sourceForRecipe = (recipe: SiteRecipe): ProviderSource => {
  return recipe.id.startsWith("social/") ? "social" : "web";
};

const needsAuthenticatedBrowser = (input: BrowserNativeDiscoveryInput): boolean => {
  if (input.recipe.authMode === "public") return false;
  if (input.cookiePolicy === "required") return true;
  return input.recipe.authMode === "authenticated";
};

const hasAuthenticatedBrowser = (input: BrowserNativeDiscoveryInput): boolean => {
  return input.browserMode === "extension" && input.useCookies === true;
};

const htmlFromRecord = (record: NormalizedRecord): string => {
  const html = record.attributes.html;
  return typeof html === "string" ? html : "";
};

const linksFromRecord = (record: NormalizedRecord): string[] => {
  const links = record.attributes.links;
  return Array.isArray(links) ? links.filter((link): link is string => typeof link === "string") : [];
};

const pinterestCandidateFromRecord = (record: NormalizedRecord) => ({
  url: record.url ?? undefined,
  title: record.title ?? undefined,
  content: record.content ?? undefined,
  html: typeof record.attributes.html === "string" ? record.attributes.html : undefined,
  links: linksFromRecord(record)
});

const isPinterestRecipe = (recipe: SiteRecipe): boolean => recipe.id === "social/pinterest";

const badStateTextForRecord = (record: NormalizedRecord): string => {
  return [
    record.url ?? "",
    record.title ?? "",
    record.content ?? "",
    htmlFromRecord(record)
  ].join(" ").toLowerCase();
};

const normalizeBadStateReasonCode = (state: SiteRecipeBadState): ProviderReasonCode => {
  return isProviderReasonCode(state.reasonCode) ? state.reasonCode : "env_limited";
};

const shouldMatchBadState = (state: SiteRecipeBadState, mode: BadStateMatchMode): boolean => {
  if (mode === "hard_blocker") return state.id === "challenge";
  return mode === "all" || state.id !== "search-shell";
};

const findBadState = (
  recipe: SiteRecipe,
  records: NormalizedRecord[],
  mode: BadStateMatchMode
): MatchedBadState | undefined => {
  for (const record of records) {
    const text = badStateTextForRecord(record);
    const state = recipe.badStates.find((candidate) => (
      shouldMatchBadState(candidate, mode)
      && candidate.markers.some((marker) => text.includes(marker.toLowerCase()))
    ));
    if (state) {
      return {
        state,
        reasonCode: normalizeBadStateReasonCode(state)
      };
    }
  }
  return undefined;
};

const pinterestClassificationBadStateId = (classification: PinterestMediaClassification): string => {
  if (classification.sourcePageQuality === "login_challenge") return "login";
  return "search-shell";
};

const pinterestClassificationRecoveryAction = (classification: PinterestMediaClassification): string => {
  if (classification.sourcePageQuality === "login_challenge") {
    return "Use extension mode with a user-authorized logged-in Pinterest session.";
  }
  return "Open a concrete pin, board, or idea page before capture.";
};

const matchedPinterestClassificationBadState = (
  recipe: SiteRecipe,
  classification: PinterestMediaClassification
): MatchedBadState => {
  const stateId = pinterestClassificationBadStateId(classification);
  const recipeState = recipe.badStates.find((state) => state.id === stateId);
  const state = recipeState ?? {
    id: stateId,
    markers: [],
    reasonCode: classification.sourcePageQuality === "login_challenge" ? "auth_required" : "env_limited",
    recoveryAction: pinterestClassificationRecoveryAction(classification)
  };
  return {
    state,
    reasonCode: normalizeBadStateReasonCode(state)
  };
};

const findHardFailure = (failures: ProviderFailureEntry[]): ProviderFailureEntry | undefined => (
  failures.find((failure) => Boolean(hardReasonCodeForFailure(failure)))
);

const reasonCodesForFailure = (failure: ProviderFailureEntry): ProviderReasonCode[] => {
  const candidates = [
    failure.error.reasonCode,
    failure.error.details?.reasonCode,
    normalizeProviderReasonCode({
      code: failure.error.code,
      message: failure.error.message,
      details: failure.error.details
    })
  ];
  const reasonCodes = candidates.filter((reasonCode): reasonCode is ProviderReasonCode => (
    typeof reasonCode === "string" && isProviderReasonCode(reasonCode)
  ));
  return [...new Set(reasonCodes)];
};

const hardReasonCodeForFailure = (failure: ProviderFailureEntry): ProviderReasonCode | undefined => (
  reasonCodesForFailure(failure).find((reasonCode) => HARD_FAILURE_REASON_CODES.has(reasonCode))
);

const reasonCodeForFailure = (failure: ProviderFailureEntry): ProviderReasonCode | undefined => {
  return hardReasonCodeForFailure(failure) ?? reasonCodesForFailure(failure)[0];
};

const reasonCodeForFirstFailure = (failures: readonly ProviderFailureEntry[]): ProviderReasonCode | undefined => {
  const [failure] = failures;
  return failure ? reasonCodeForFailure(failure) : undefined;
};

const buildBadStateResult = (
  input: BrowserNativeDiscoveryInput,
  source: ProviderSource,
  searchUrl: string,
  fetchedRecordCount: number,
  badState: MatchedBadState,
  sourcePageQuality?: PinterestSourcePageQuality,
  diagnosticBlockers: readonly string[] = []
): BrowserNativeDiscoveryResult => ({
  records: [],
  failures: [{
    provider: input.recipe.id,
    source,
    error: createProviderError(
      providerErrorCodeFromReasonCode(badState.reasonCode),
      badState.state.recoveryAction,
      {
        retryable: true,
        reasonCode: badState.reasonCode,
        provider: input.recipe.id,
        source,
        details: {
          siteRecipeId: input.recipe.id,
          query: input.query,
          searchUrl,
          badStateId: badState.state.id,
          ...(sourcePageQuality ? { sourcePageQuality } : {}),
          ...(diagnosticBlockers.length > 0 ? { diagnosticBlockers: [...diagnosticBlockers] } : {})
        }
      }
    )
  }],
  diagnostics: {
    siteRecipeId: input.recipe.id,
    attempted: true,
    reason: badState.reasonCode,
    searchUrl,
    fetchedRecordCount,
    badStateId: badState.state.id,
    recoveryAction: badState.state.recoveryAction,
    ...(sourcePageQuality ? { sourcePageQuality } : {}),
    ...(diagnosticBlockers.length > 0 ? { diagnosticBlockers: [...diagnosticBlockers] } : {})
  }
});

const buildHardFailureResult = (
  input: BrowserNativeDiscoveryInput,
  source: ProviderSource,
  searchUrl: string,
  fetchedRecordCount: number,
  failure: ProviderFailureEntry
): BrowserNativeDiscoveryResult => ({
  records: [],
  failures: [failure],
  diagnostics: {
    siteRecipeId: input.recipe.id,
    attempted: true,
    reason: reasonCodeForFailure(failure) ?? "challenge_detected",
    searchUrl,
    fetchedRecordCount,
    recoveryAction: failure.error.message
  }
});

const buildFailurePassthroughResult = (
  input: BrowserNativeDiscoveryInput,
  source: ProviderSource,
  searchUrl: string,
  fetchedRecordCount: number,
  failures: ProviderFailureEntry[],
  sourcePageQuality?: PinterestSourcePageQuality,
  diagnosticBlockers: readonly string[] = []
): BrowserNativeDiscoveryResult => ({
  records: [],
  failures,
  diagnostics: {
    siteRecipeId: input.recipe.id,
    attempted: true,
    reason: reasonCodeForFirstFailure(failures) ?? "env_limited",
    searchUrl,
    fetchedRecordCount,
    ...(sourcePageQuality ? { sourcePageQuality } : {}),
    ...(diagnosticBlockers.length > 0 ? { diagnosticBlockers: [...diagnosticBlockers] } : {})
  }
});

const extractRecipeReferenceUrls = (
  input: BrowserNativeDiscoveryInput,
  records: NormalizedRecord[],
  maxReferences: number,
  shouldAcceptUrl: ReferenceUrlFilter
): string[] => {
  const extractor = input.recipe.browserNativeDiscovery?.extractReferenceUrls;
  if (!extractor) return [];
  const urls: string[] = [];
  const seen = new Set<string>();
  const pushUrl = (url: string, record: NormalizedRecord): void => {
    if (!url || !shouldAcceptUrl(url, record) || seen.has(url)) return;
    seen.add(url);
    urls.push(url);
  };
  for (const record of records) {
    extractor({
      url: record.url ?? undefined,
      content: record.content ?? undefined,
      html: typeof record.attributes.html === "string" ? record.attributes.html : undefined,
      links: linksFromRecord(record)
    }).forEach((url) => pushUrl(url, record));
    if (urls.length >= maxReferences) break;
  }
  return urls.slice(0, maxReferences);
};

const isStrictPinterestSourceBlock = (classification: PinterestMediaClassification): boolean => (
  shouldBlockPinterestSourceExtraction(classification)
  && classification.sourcePageQuality !== "search_shell"
);

const isPinterestSearchResultPageUrl = (value: string | undefined): boolean => {
  if (!value) return false;
  try {
    const url = new URL(value);
    const segments = url.pathname.split("/").filter(Boolean);
    return isAllowedPinterestReferenceHost(url.hostname.toLowerCase())
      && segments[0] === "search"
      && segments[1] === "pins";
  } catch {
    return false;
  }
};

const hasPinterestSearchResultContext = (record: NormalizedRecord): boolean => {
  if (isPinterestSearchResultPageUrl(record.url ?? undefined)) return true;
  if (hasPinterestChromeMarkers(pinterestCandidateFromRecord(record))) return false;
  const html = htmlFromRecord(record).toLowerCase();
  return SEARCH_RESULT_CONTEXT_MARKERS.some((marker) => html.includes(marker));
};

const renderedHrefUrlsFromRecord = (record: NormalizedRecord): string[] => {
  const html = htmlFromRecord(record);
  const hrefs = Array.from(html.matchAll(RENDERED_HREF_PATTERN), (match) => match[1])
    .filter((href): href is string => typeof href === "string");
  return [...linksFromRecord(record), ...hrefs];
};

const hasRenderedPinterestPinLinkEvidence = (targetUrl: string, record: NormalizedRecord): boolean => {
  const normalizedTarget = normalizePinterestReferenceUrl(targetUrl);
  if (!isCanonicalPinterestPinUrl(normalizedTarget ?? undefined)) return false;
  return renderedHrefUrlsFromRecord(record).some((candidate) => normalizePinterestReferenceUrl(candidate) === normalizedTarget);
};

const acceptsSearchShellPinterestReferenceUrl = (url: string, record: NormalizedRecord): boolean => (
  hasPinterestSearchResultContext(record) && hasRenderedPinterestPinLinkEvidence(url, record)
);

const acceptsPinterestReferenceUrlForRecord = (url: string, record: NormalizedRecord): boolean => {
  if (!isCanonicalPinterestPinUrl(url)) return false;
  const classification = classifyPinterestCandidate(pinterestCandidateFromRecord(record));
  if (isStrictPinterestSourceBlock(classification)) return false;
  if (classification.sourcePageQuality === "search_shell") return acceptsSearchShellPinterestReferenceUrl(url, record);
  if (classification.sourcePageQuality === "pin_grid_media") return true;
  if (isCanonicalPinterestPinUrl(record.url ?? undefined)) return true;
  return isPinterestSearchResultPageUrl(record.url ?? undefined);
};

const acceptsRecipeReferenceUrl = (recipe: SiteRecipe, url: string, record: NormalizedRecord): boolean => (
  !isPinterestRecipe(recipe) || acceptsPinterestReferenceUrlForRecord(url, record)
);

const buildRecipeReferenceRecord = (
  input: BrowserNativeDiscoveryInput,
  url: string,
  index: number,
  classification?: PinterestMediaClassification,
  sourcePageQuality?: PinterestSourcePageQuality
): NormalizedRecord => {
  const timestamp = new Date().toISOString();
  return {
    id: `${input.recipe.id}:reference:${index + 1}:${timestamp}`,
    source: sourceForRecipe(input.recipe),
    provider: input.recipe.id,
    url,
    title: `Site visual reference ${index + 1} for ${input.query}`,
    content: input.recipe.navigationSteps.map((step) => step.instruction).join(" "),
    timestamp,
    confidence: 0.72,
    attributes: {
      siteRecipeId: input.recipe.id,
      discoveryMode: "browser_native_extracted_reference",
      authMode: input.recipe.authMode,
      maxReferences: input.maxReferences,
      validationChecks: input.recipe.evidenceRequirements.map((entry) => entry.validation),
      ...(classification ? { pinterestMediaClassification: classification as unknown as JsonValue } : {}),
      ...(sourcePageQuality ? { pinterestSourcePageQuality: sourcePageQuality } : {})
    }
  };
};

export const runBrowserNativeDiscovery = async (
  input: BrowserNativeDiscoveryInput
): Promise<BrowserNativeDiscoveryResult> => {
  const source = sourceForRecipe(input.recipe);
  const searchUrl = input.recipe.browserNativeDiscovery?.buildSearchUrl(input.query);
  if (!searchUrl) {
    return {
      records: [],
      failures: [{
        provider: input.recipe.id,
        source,
        error: createProviderError(
          "unavailable",
          `Site recipe ${input.recipe.id} does not define browser-native discovery.`,
          {
            retryable: false,
            reasonCode: "env_limited",
            provider: input.recipe.id,
            source,
            details: {
              siteRecipeId: input.recipe.id,
              query: input.query
            }
          }
        )
      }],
      diagnostics: {
        siteRecipeId: input.recipe.id,
        attempted: false,
        reason: "unsupported_site_recipe"
      }
    };
  }
  if (needsAuthenticatedBrowser(input) && !hasAuthenticatedBrowser(input)) {
    return {
      records: [],
      failures: [{
        provider: input.recipe.id,
        source,
        error: createProviderError(
          "auth",
          `${input.recipe.id} requires an authenticated browser session before search results are visible.`,
          {
            retryable: true,
            reasonCode: "auth_required",
            provider: input.recipe.id,
            source,
            details: {
              siteRecipeId: input.recipe.id,
              query: input.query,
              requiredBrowserMode: "extension",
              requiredCookies: true
            }
          }
        )
      }],
      diagnostics: {
        siteRecipeId: input.recipe.id,
        attempted: false,
        reason: "auth_required",
        recoverySteps: input.recipe.recoverySteps.map((step) => step.instruction)
      }
    };
  }

  if (!input.fetchSearchPage) {
    return {
      records: [],
      failures: [{
        provider: input.recipe.id,
        source,
        error: createProviderError(
          "unavailable",
          `${input.recipe.id} browser-native discovery requires a browser-backed fetch executor for the search page.`,
          {
            retryable: true,
            reasonCode: "env_limited",
            provider: input.recipe.id,
            source,
            details: {
              siteRecipeId: input.recipe.id,
              query: input.query,
              searchUrl
            }
          }
        )
      }],
      diagnostics: {
        siteRecipeId: input.recipe.id,
        attempted: false,
        reason: "fetch_executor_missing",
        searchUrl
      }
    };
  }

  const fetched = await input.fetchSearchPage(searchUrl);
  const hardFailure = findHardFailure(fetched.failures);
  if (hardFailure) {
    return buildHardFailureResult(input, source, searchUrl, fetched.records.length, hardFailure);
  }
  const preExtractionMode = needsAuthenticatedBrowser(input) ? "pre_extraction" : "hard_blocker";
  const hardBlocker = findBadState(input.recipe, fetched.records, preExtractionMode);
  if (hardBlocker) {
    return buildBadStateResult(input, source, searchUrl, fetched.records.length, hardBlocker);
  }
  const pinterestSourceClassification = isPinterestRecipe(input.recipe)
    ? classifyPinterestSourcePage(fetched.records.map(pinterestCandidateFromRecord))
    : undefined;
  if (pinterestSourceClassification && isStrictPinterestSourceBlock(pinterestSourceClassification)) {
    const shellState = findBadState(input.recipe, fetched.records, "all")
      ?? matchedPinterestClassificationBadState(input.recipe, pinterestSourceClassification);
    return buildBadStateResult(
      input,
      source,
      searchUrl,
      fetched.records.length,
      shellState,
      pinterestSourceClassification.sourcePageQuality,
      pinterestSourceClassification.diagnosticBlockers
    );
  }
  if (pinterestSourceClassification?.sourcePageQuality === "search_shell" && fetched.failures.length > 0) {
    return buildFailurePassthroughResult(
      input,
      source,
      searchUrl,
      fetched.records.length,
      fetched.failures,
      pinterestSourceClassification.sourcePageQuality,
      pinterestSourceClassification.diagnosticBlockers
    );
  }
  const acceptedUrls = extractRecipeReferenceUrls(
    input,
    fetched.records,
    input.maxReferences,
    (url, record) => acceptsRecipeReferenceUrl(input.recipe, url, record)
  );
  if (acceptedUrls.length === 0) {
    if (pinterestSourceClassification?.sourcePageQuality === "search_shell") {
      const shellState = findBadState(input.recipe, fetched.records, "all")
        ?? matchedPinterestClassificationBadState(input.recipe, pinterestSourceClassification);
      return buildBadStateResult(
        input,
        source,
        searchUrl,
        fetched.records.length,
        shellState,
        pinterestSourceClassification.sourcePageQuality,
        pinterestSourceClassification.diagnosticBlockers
      );
    }
    const shellState = fetched.failures.length === 0 ? findBadState(input.recipe, fetched.records, "all") : undefined;
    if (shellState) {
      return buildBadStateResult(input, source, searchUrl, fetched.records.length, shellState);
    }
    return {
      records: [],
      failures: fetched.failures.length > 0
        ? fetched.failures
        : [{
          provider: input.recipe.id,
          source,
          error: createProviderError(
            "unavailable",
            fetched.errorMessage ?? `${input.recipe.id} search did not expose recipe-approved URLs that can be used as references.`,
            {
              retryable: true,
              reasonCode: "env_limited",
              provider: input.recipe.id,
              source,
              details: {
                siteRecipeId: input.recipe.id,
                query: input.query,
                searchUrl
              }
            }
          )
        }],
      diagnostics: {
        siteRecipeId: input.recipe.id,
        attempted: true,
        reason: "no_reference_urls_extracted",
        searchUrl,
        fetchedRecordCount: fetched.records.length
      }
    };
  }

  const pinterestClassifications = isPinterestRecipe(input.recipe)
    ? acceptedUrls.map((url) => classifyPinterestCandidate({ url }))
    : [];
  return {
    records: acceptedUrls.map((url, index) => buildRecipeReferenceRecord(
      input,
      url,
      index,
      pinterestClassifications[index],
      pinterestSourceClassification?.sourcePageQuality
    )),
    failures: [],
    diagnostics: {
      siteRecipeId: input.recipe.id,
      attempted: true,
      reason: "reference_urls_extracted",
      searchUrl,
      navigationSteps: input.recipe.navigationSteps.map((step) => step.instruction),
      badStates: input.recipe.badStates.map((state) => state.id),
      extractedUrlCount: acceptedUrls.length,
      ...(pinterestSourceClassification ? {
        sourcePageQuality: pinterestSourceClassification.sourcePageQuality,
        diagnosticBlockers: pinterestSourceClassification.diagnosticBlockers as unknown as JsonValue,
        classificationCounts: summarizePinterestClassifications(pinterestClassifications) as unknown as JsonValue
      } : {})
    }
  };
};
