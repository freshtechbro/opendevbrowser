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
const SEARCH_RESULT_TEXT_MARKERS = ["search results for", "pin card"];
const SEARCH_SHELL_WITHOUT_RENDERED_PIN_LINKS = "search_shell_without_rendered_pin_links";
const PINTEREST_BROWSER_NATIVE_SEARCH_ATTEMPT_LIMIT = 2;
const PINTEREST_SEARCH_SHELL_RECOVERY_ACTION = "Refine or reload the Pinterest search until rendered canonical pin links are visible, then rerun harvest or provide explicit canonical /pin/<id>/ URLs.";
const PINTEREST_TRUE_CHALLENGE_MARKERS = ["captcha", "verification", "challenge"];
const PINTEREST_RECOVERABLE_RENDERED_PIN_QUALITIES = new Set<PinterestSourcePageQuality>([
  "login_challenge",
  "search_shell"
]);

const HARD_FAILURE_REASON_CODES = new Set<ProviderReasonCode>([
  "auth_required",
  "challenge_detected",
  "cooldown_active",
  "ip_blocked",
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
  if (classification.sourcePageQuality === "search_shell") return PINTEREST_SEARCH_SHELL_RECOVERY_ACTION;
  if (classification.sourcePageQuality === "chrome_only") {
    return "Close Pinterest account, settings, or chrome-only surfaces, then rerun search or provide an explicit canonical /pin/<id>/ URL.";
  }
  return "Open a concrete canonical Pinterest pin before capture.";
};

const matchedPinterestClassificationBadState = (
  recipe: SiteRecipe,
  classification: PinterestMediaClassification
): MatchedBadState => {
  const stateId = pinterestClassificationBadStateId(classification);
  const recipeState = recipe.badStates.find((state) => state.id === stateId);
  const state = recipeState
    ? { ...recipeState, recoveryAction: pinterestClassificationRecoveryAction(classification) }
    : {
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

const diagnosticBlockersForBadState = (
  sourcePageQuality: PinterestSourcePageQuality | undefined,
  diagnosticBlockers: readonly string[]
): string[] => {
  const blockers = new Set(diagnosticBlockers);
  if (sourcePageQuality === "search_shell") blockers.add(SEARCH_SHELL_WITHOUT_RENDERED_PIN_LINKS);
  return [...blockers];
};

const buildAcceptedReferenceDiagnostics = (
  input: BrowserNativeDiscoveryInput,
  source: ProviderSource,
  urls: readonly string[],
  sourcePageQuality?: PinterestSourcePageQuality
): JsonValue => urls.map((url, index) => ({
  url,
  provider: input.recipe.id,
  source,
  rank: index + 1,
  siteRecipeId: input.recipe.id,
  discoveryMode: "browser_native_extracted_reference",
  ...(sourcePageQuality ? { sourcePageQuality } : {})
}));

const recoveryActionForBadState = (
  badState: MatchedBadState,
  sourcePageQuality?: PinterestSourcePageQuality
): string => {
  if (sourcePageQuality === "search_shell") return PINTEREST_SEARCH_SHELL_RECOVERY_ACTION;
  if (sourcePageQuality === "chrome_only") {
    return "Close Pinterest account, settings, or chrome-only surfaces, then rerun search or provide an explicit canonical /pin/<id>/ URL.";
  }
  return badState.state.recoveryAction;
};

const buildBadStateResult = (
  input: BrowserNativeDiscoveryInput,
  source: ProviderSource,
  searchUrl: string,
  fetchedRecordCount: number,
  badState: MatchedBadState,
  sourcePageQuality?: PinterestSourcePageQuality,
  diagnosticBlockers: readonly string[] = []
): BrowserNativeDiscoveryResult => {
  const blockers = diagnosticBlockersForBadState(sourcePageQuality, diagnosticBlockers);
  const recoveryAction = recoveryActionForBadState(badState, sourcePageQuality);
  return ({
  records: [],
  failures: [{
    provider: input.recipe.id,
    source,
    error: createProviderError(
      providerErrorCodeFromReasonCode(badState.reasonCode),
      recoveryAction,
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
          ...(blockers.length > 0 ? { diagnosticBlockers: blockers } : {})
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
    recoveryAction,
    acceptedUrls: [],
    acceptedUrlCount: 0,
    rejectedUrlCount: 0,
    failureCount: 1,
    ...(sourcePageQuality ? { sourcePageQuality } : {}),
    ...(blockers.length > 0 ? { diagnosticBlockers: blockers } : {})
  }
});
};

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
    recoveryAction: failure.error.message,
    acceptedUrls: [],
    acceptedUrlCount: 0,
    rejectedUrlCount: 0,
    failureCount: 1
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
    acceptedUrls: [],
    acceptedUrlCount: 0,
    rejectedUrlCount: 0,
    failureCount: failures.length,
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

const hasPinterestRenderedSearchResultContext = (record: NormalizedRecord): boolean => {
  if (hasPinterestChromeMarkers(pinterestCandidateFromRecord(record))) return false;
  const html = htmlFromRecord(record).toLowerCase();
  return SEARCH_RESULT_CONTEXT_MARKERS.some((marker) => html.includes(marker));
};

const hasPinterestSearchResultContext = (record: NormalizedRecord): boolean => {
  if (isPinterestSearchResultPageUrl(record.url ?? undefined)) return true;
  return hasPinterestRenderedSearchResultContext(record);
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

const hasPinterestSearchResultText = (record: NormalizedRecord): boolean => {
  const text = badStateTextForRecord(record);
  return SEARCH_RESULT_TEXT_MARKERS.some((marker) => text.includes(marker));
};

const hasRecoverablePinterestLoginSearchContext = (record: NormalizedRecord): boolean => (
  hasPinterestRenderedSearchResultContext(record)
  || (isPinterestSearchResultPageUrl(record.url ?? undefined) && hasPinterestSearchResultText(record))
);

const hasPinterestTrueChallengeMarker = (record: NormalizedRecord): boolean => (
  PINTEREST_TRUE_CHALLENGE_MARKERS.some((marker) => badStateTextForRecord(record).includes(marker))
);

const acceptsRecoverableRenderedPinterestPin = (
  url: string,
  record: NormalizedRecord,
  classification: PinterestMediaClassification
): boolean => {
  if (classification.sourcePageQuality === "search_shell") return acceptsSearchShellPinterestReferenceUrl(url, record);
  if (classification.sourcePageQuality !== "login_challenge") return false;
  if (hasPinterestTrueChallengeMarker(record)) return false;
  return hasRecoverablePinterestLoginSearchContext(record) && hasRenderedPinterestPinLinkEvidence(url, record);
};

const acceptsPinterestReferenceUrlForRecord = (url: string, record: NormalizedRecord): boolean => {
  if (!isCanonicalPinterestPinUrl(url)) return false;
  const classification = classifyPinterestCandidate(pinterestCandidateFromRecord(record));
  if (acceptsRecoverableRenderedPinterestPin(url, record, classification)) return true;
  if (PINTEREST_RECOVERABLE_RENDERED_PIN_QUALITIES.has(classification.sourcePageQuality)) return false;
  if (isStrictPinterestSourceBlock(classification)) return false;
  if (classification.sourcePageQuality === "pin_grid_media") return true;
  if (isCanonicalPinterestPinUrl(record.url ?? undefined)) return true;
  return isPinterestSearchResultPageUrl(record.url ?? undefined);
};

const acceptsRecipeReferenceUrl = (recipe: SiteRecipe, url: string, record: NormalizedRecord): boolean => (
  !isPinterestRecipe(recipe) || acceptsPinterestReferenceUrlForRecord(url, record)
);

const hasPinterestSearchContextRecord = (records: NormalizedRecord[]): boolean => (
  records.some(hasPinterestSearchResultContext)
);

const shouldRetryPinterestSourcePage = (
  recipe: SiteRecipe,
  classification: PinterestMediaClassification | undefined,
  records: NormalizedRecord[],
  attemptCount: number
): boolean => {
  if (!isPinterestRecipe(recipe) || !classification) return false;
  if (attemptCount >= PINTEREST_BROWSER_NATIVE_SEARCH_ATTEMPT_LIMIT) return false;
  if (!hasPinterestSearchContextRecord(records)) return false;
  return classification.sourcePageQuality === "search_shell" || classification.sourcePageQuality === "login_challenge";
};

const shouldRetryPinterestBadState = (
  recipe: SiteRecipe,
  badState: MatchedBadState,
  records: NormalizedRecord[],
  attemptCount: number
): boolean => (
  isPinterestRecipe(recipe)
  && attemptCount < PINTEREST_BROWSER_NATIVE_SEARCH_ATTEMPT_LIMIT
  && badState.state.id === "login"
  && hasPinterestSearchContextRecord(records)
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

  let fetched = await input.fetchSearchPage(searchUrl);
  let discoveryAttemptCount = 1;

  while (true) {
    const hardFailure = findHardFailure(fetched.failures);
    if (hardFailure) {
      return buildHardFailureResult(input, source, searchUrl, fetched.records.length, hardFailure);
    }

    const pinterestSourceClassification = isPinterestRecipe(input.recipe)
      ? classifyPinterestSourcePage(fetched.records.map(pinterestCandidateFromRecord))
      : undefined;
    const acceptedUrls = extractRecipeReferenceUrls(
      input,
      fetched.records,
      input.maxReferences,
      (url, record) => acceptsRecipeReferenceUrl(input.recipe, url, record)
    );

    const preExtractionMode = needsAuthenticatedBrowser(input) ? "pre_extraction" : "hard_blocker";
    const hardBlocker = findBadState(input.recipe, fetched.records, preExtractionMode);
    if (hardBlocker?.state.id === "challenge") {
      return buildBadStateResult(input, source, searchUrl, fetched.records.length, hardBlocker);
    }
    if (hardBlocker && acceptedUrls.length === 0) {
      if (shouldRetryPinterestBadState(input.recipe, hardBlocker, fetched.records, discoveryAttemptCount)) {
        discoveryAttemptCount += 1;
        fetched = await input.fetchSearchPage(searchUrl);
        continue;
      }
      return buildBadStateResult(input, source, searchUrl, fetched.records.length, hardBlocker);
    }

    if (
      pinterestSourceClassification
      && isStrictPinterestSourceBlock(pinterestSourceClassification)
      && (
        acceptedUrls.length === 0
        || !PINTEREST_RECOVERABLE_RENDERED_PIN_QUALITIES.has(pinterestSourceClassification.sourcePageQuality)
      )
    ) {
      if (shouldRetryPinterestSourcePage(input.recipe, pinterestSourceClassification, fetched.records, discoveryAttemptCount)) {
        discoveryAttemptCount += 1;
        fetched = await input.fetchSearchPage(searchUrl);
        continue;
      }
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

    if (acceptedUrls.length === 0) {
      if (pinterestSourceClassification?.sourcePageQuality === "search_shell" && fetched.failures.length > 0) {
        if (shouldRetryPinterestSourcePage(input.recipe, pinterestSourceClassification, fetched.records, discoveryAttemptCount)) {
          discoveryAttemptCount += 1;
          fetched = await input.fetchSearchPage(searchUrl);
          continue;
        }
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
      if (pinterestSourceClassification?.sourcePageQuality === "search_shell") {
        if (shouldRetryPinterestSourcePage(input.recipe, pinterestSourceClassification, fetched.records, discoveryAttemptCount)) {
          discoveryAttemptCount += 1;
          fetched = await input.fetchSearchPage(searchUrl);
          continue;
        }
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
          fetchedRecordCount: fetched.records.length,
          acceptedUrls: [],
          acceptedUrlCount: 0,
          rejectedUrlCount: 0,
          failureCount: fetched.failures.length > 0 ? fetched.failures.length : 1
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
        acceptedUrls,
        acceptedUrlCount: acceptedUrls.length,
        rejectedUrlCount: 0,
        failureCount: 0,
        acceptedReferences: buildAcceptedReferenceDiagnostics(
          input,
          source,
          acceptedUrls,
          pinterestSourceClassification?.sourcePageQuality
        ),
        ...(pinterestSourceClassification ? {
          sourcePageQuality: pinterestSourceClassification.sourcePageQuality,
          diagnosticBlockers: pinterestSourceClassification.diagnosticBlockers as unknown as JsonValue,
          classificationCounts: summarizePinterestClassifications(pinterestClassifications) as unknown as JsonValue
        } : {})
      }
    };
  }
};
