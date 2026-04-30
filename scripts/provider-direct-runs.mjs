#!/usr/bin/env node
import {
  buildProviderCoverageSummary,
  shoppingProvidersForMode,
  socialPlatformsForMode
} from "./provider-live-scenarios.mjs";
import {
  AUTH_GATED_SHOPPING_PROVIDERS,
  DIRECT_SHOPPING_PROVIDER_TIMEOUT_MS,
  HIGH_FRICTION_SHOPPING_PROVIDERS,
  SOCIAL_POST_CASES
} from "./shared/workflow-lane-constants.mjs";
import {
  classifyShellOnlyReasons,
  parseShellOnlyFailureDetail
} from "./shared/workflow-lane-verdicts.mjs";
import {
  classifyRecords,
  defaultArtifactPath,
  ensureCliBuilt,
  finalizeReport,
  normalizedCodesFromFailures,
  pushStep,
  readCliFlagValue,
  runCli,
  summarizeFailures,
  writeJson
} from "./live-direct-utils.mjs";
import {
  currentHarnessDaemonStatusDetail,
  isCurrentHarnessDaemonStatus,
  startConfiguredDaemon,
  stopDaemon
} from "./skill-runtime-probe-utils.mjs";

const HELP_TEXT = [
  "Usage: node scripts/provider-direct-runs.mjs [options]",
  "",
  "Options:",
  "  --out <path>                 Output JSON path (default: /tmp/odb-provider-direct-runs-<mode>-<ts>.json)",
  "  --smoke                      Reduced provider set for faster manual checks",
  "  --release-gate               Strict release mode (enables gated cases and fails on env_limited)",
  "  --include-auth-gated         Include auth-gated provider scenarios",
  "  --include-high-friction      Include high-friction provider scenarios",
  "  --include-social-posts       Include write-path social probes",
  "  --quiet                      Suppress per-step progress logging",
  "  --help                       Show help"
].join("\n");
const MACRO_REQUESTED_CHALLENGE_AUTOMATION_MODE = "browser_with_helper";
const MACRO_CHALLENGE_ARGS = ["--challenge-automation-mode", MACRO_REQUESTED_CHALLENGE_AUTOMATION_MODE];
const LINKEDIN_TIMEOUT_RETRY_DETAIL_RE = /\b(?:request|provider request) timed out after \d+ms\b/i;
const YOUTUBE_SITE_CHROME_SHELL_RETRY_DETAIL = "shell_only_records=youtube_site_chrome_shell";

const DIRECT_WEB_COMMUNITY_CASES = [
  {
    id: "provider.web.search.keyword",
    providerId: "web/default",
    args: ["macro-resolve", "--execute", "--expression", '@web.search("site:developer.mozilla.org playwright locator", 4)', "--timeout-ms", "120000", ...MACRO_CHALLENGE_ARGS]
  },
  {
    id: "provider.web.search.url",
    providerId: "web/default",
    args: ["macro-resolve", "--execute", "--expression", '@web.search("https://example.com", 2)', "--timeout-ms", "120000", ...MACRO_CHALLENGE_ARGS]
  },
  {
    id: "provider.web.fetch.url",
    providerId: "web/default",
    args: ["macro-resolve", "--execute", "--expression", '@web.fetch("https://example.com")', "--timeout-ms", "120000", ...MACRO_CHALLENGE_ARGS]
  },
  {
    id: "provider.community.search.keyword",
    providerId: "community/default",
    args: ["macro-resolve", "--execute", "--expression", '@community.search("browser automation failures", 4)', "--timeout-ms", "120000", ...MACRO_CHALLENGE_ARGS]
  },
  {
    id: "provider.community.search.url",
    providerId: "community/default",
    args: ["macro-resolve", "--execute", "--expression", '@community.search("https://www.reddit.com/r/programming", 2)', "--timeout-ms", "120000", ...MACRO_CHALLENGE_ARGS]
  }
];

function readDaemonStatus(env = process.env) {
  return runCli(["status", "--daemon"], {
    env,
    allowFailure: true,
    timeoutMs: 15_000
  });
}

function appendDaemonState(step, startedDaemon) {
  if (!startedDaemon) {
    return step;
  }

  return {
    ...step,
    data: {
      ...(step.data ?? {}),
      harnessStartedDaemon: true
    }
  };
}

export async function ensureProviderDaemon(
  state,
  {
    env = process.env,
    readDaemonStatusImpl = readDaemonStatus,
    startConfiguredDaemonImpl = startConfiguredDaemon
  } = {}
) {
  const daemonStatus = readDaemonStatusImpl(env);
  if (isCurrentHarnessDaemonStatus(daemonStatus)) {
    return {
      daemonStatus,
      startedDaemon: false
    };
  }

  state.ownedDaemon = await startConfiguredDaemonImpl(env);
  return {
    daemonStatus: readDaemonStatusImpl(env),
    startedDaemon: true
  };
}

export function classifyDaemonPreflight(result) {
  const ok = isCurrentHarnessDaemonStatus(result);
  return {
    id: "infra.daemon_status",
    status: ok ? "pass" : "fail",
    detail: currentHarnessDaemonStatusDetail(result),
    data: result.json?.data ?? null
  };
}

export function shouldAbortForDaemonPreflight(result) {
  return !isCurrentHarnessDaemonStatus(result);
}

export function buildProviderCoverageStep(providerCoverage, { releaseGate = false } = {}) {
  const detail = providerCoverage.ok
    ? null
    : `missing=${providerCoverage.missingProviderIds.join(",") || "none"} extra=${providerCoverage.extraScenarioProviderIds.join(",") || "none"}`;
  return {
    id: "infra.provider_scenario_coverage",
    status: providerCoverage.ok
      ? "pass"
      : (releaseGate ? "fail" : "skipped"),
    detail,
    data: {
      expectedCount: providerCoverage.expected.all.length,
      scenarioCount: providerCoverage.scenarios.all.length,
      missingProviderIds: providerCoverage.missingProviderIds,
      extraScenarioProviderIds: providerCoverage.extraScenarioProviderIds,
      coverageGap: !providerCoverage.ok
    }
  };
}

function collectMacroExecution(result) {
  const execution = result.json?.data?.execution;
  const records = Array.isArray(execution?.records) ? execution.records : [];
  const failures = Array.isArray(execution?.failures) ? execution.failures : [];
  const providerOrder = Array.isArray(execution?.meta?.providerOrder) ? execution.meta.providerOrder : [];
  return {
    execution,
    records,
    failures,
    providerOrder,
    hasExecutionPayload: Boolean(execution)
  };
}

function isJsonRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readJsonRecordField(value, key) {
  if (!isJsonRecord(value)) {
    return null;
  }
  const candidate = value[key];
  return isJsonRecord(candidate) ? candidate : null;
}

function readStringField(value, key) {
  if (!isJsonRecord(value)) {
    return null;
  }
  const candidate = value[key];
  return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
}

function firstJsonRecord(value) {
  if (isJsonRecord(value)) {
    return value;
  }
  if (!Array.isArray(value)) {
    return null;
  }
  for (const entry of value) {
    if (isJsonRecord(entry)) {
      return entry;
    }
  }
  return null;
}

function collectRequestedChallengeMetadata(args) {
  const requestedChallengeAutomationMode = readCliFlagValue(args, "--challenge-automation-mode");
  return {
    requestedChallengeAutomationMode,
    helperCapableRequested: requestedChallengeAutomationMode === "browser_with_helper"
  };
}

function collectMacroChallengeOrchestration(execution) {
  for (const record of execution.records) {
    const candidate = readJsonRecordField(record?.attributes, "browser_fallback_challenge_orchestration");
    if (candidate) {
      return candidate;
    }
  }
  for (const failure of execution.failures) {
    const candidate = readJsonRecordField(failure?.error?.details, "challengeOrchestration");
    if (candidate) {
      return candidate;
    }
  }
  return readJsonRecordField(execution.execution?.meta, "challengeOrchestration");
}

function collectMacroBrowserFallback(execution) {
  for (const record of execution.records) {
    const browserFallbackReasonCode = readStringField(record?.attributes, "browser_fallback_reason_code");
    const browserFallbackMode = readStringField(record?.attributes, "browser_fallback_mode");
    if (browserFallbackReasonCode || browserFallbackMode) {
      return { browserFallbackReasonCode, browserFallbackMode };
    }
  }
  for (const failure of execution.failures) {
    const browserFallbackReasonCode = readStringField(failure?.error?.details, "browserFallbackReasonCode");
    const browserFallbackMode = readStringField(failure?.error?.details, "browserFallbackMode");
    if (browserFallbackReasonCode || browserFallbackMode) {
      return { browserFallbackReasonCode, browserFallbackMode };
    }
  }
  return {
    browserFallbackReasonCode: null,
    browserFallbackMode: null
  };
}

function collectShoppingExecution(result) {
  const hasDataPayload = isJsonRecord(result.json?.data);
  const data = hasDataPayload ? result.json.data : {};
  const offers = Array.isArray(data.offers) ? data.offers : [];
  const failures = Array.isArray(data.meta?.failures) ? data.meta.failures : [];
  const firstFailure = failures[0] ?? null;
  const blocker = data.meta?.blocker ?? firstFailure?.error?.blocker ?? null;
  const metrics = isJsonRecord(data.meta?.metrics) ? data.meta.metrics : {};
  return {
    data,
    offers,
    failures,
    firstFailure,
    blocker,
    metrics,
    hasDataPayload
  };
}

function collectShoppingChallengeOrchestration(execution) {
  return firstJsonRecord(execution.metrics.challenge_orchestration)
    ?? firstJsonRecord(execution.metrics.challengeOrchestration)
    ?? readJsonRecordField(execution.firstFailure?.error?.details, "challengeOrchestration");
}

function collectShoppingBrowserFallback(execution) {
  return {
    browserFallbackReasonCode: readStringField(execution.firstFailure?.error?.details, "browserFallbackReasonCode"),
    browserFallbackMode: readStringField(execution.firstFailure?.error?.details, "browserFallbackMode")
  };
}

function readGuidance(value) {
  if (!isJsonRecord(value)) {
    return null;
  }
  const commands = Array.isArray(value.recommendedNextCommands)
    ? value.recommendedNextCommands
    : [];
  const recommendedNextCommand = commands.find(
    (entry) => typeof entry === "string" && entry.trim().length > 0
  ) ?? null;
  const guidanceReason = readStringField(value, "reason");
  return guidanceReason || recommendedNextCommand
    ? { guidanceReason, recommendedNextCommand }
    : null;
}

function collectMetaGuidance(meta) {
  if (!isJsonRecord(meta)) {
    return null;
  }
  const primaryConstraint = firstJsonRecord([meta.primaryConstraint]);
  return readGuidance(primaryConstraint?.guidance);
}

function collectFailureGuidance(failures) {
  for (const failure of failures) {
    const guidance = readGuidance(failure?.error?.details?.guidance);
    if (guidance) {
      return guidance;
    }
  }
  return null;
}

function collectMacroGuidance(execution) {
  return collectFailureGuidance(execution.failures)
    ?? collectMetaGuidance(execution.execution?.meta)
    ?? { guidanceReason: null, recommendedNextCommand: null };
}

function collectShoppingGuidance(execution) {
  return collectFailureGuidance(execution.failures)
    ?? collectMetaGuidance(execution.data?.meta)
    ?? { guidanceReason: null, recommendedNextCommand: null };
}

function hasLinkedInAuthWall(records) {
  if (!Array.isArray(records) || records.length === 0) {
    return false;
  }
  const gated = records.filter((record) => {
    const url = typeof record?.url === "string" ? record.url : "";
    return /linkedin\.com\/(?:uas\/login|login)/i.test(url);
  });
  return gated.length > 0 && gated.length === records.length;
}

function getDeferredChallengeClassification(challengeOrchestration) {
  const classification = readStringField(challengeOrchestration, "classification");
  if (
    readStringField(challengeOrchestration, "status") !== "deferred"
    || (classification !== "auth_required" && classification !== "checkpoint_or_friction")
  ) {
    return null;
  }

  const verification = readJsonRecordField(challengeOrchestration, "verification");
  const bundle = readJsonRecordField(verification, "bundle");
  const continuity = readJsonRecordField(bundle, "continuity");
  if (!continuity) {
    return null;
  }

  const loginRefs = Array.isArray(continuity.loginRefs)
    ? continuity.loginRefs.filter((entry) => typeof entry === "string" && entry.length > 0)
    : [];
  const checkpointRefs = Array.isArray(continuity.checkpointRefs)
    ? continuity.checkpointRefs.filter((entry) => typeof entry === "string" && entry.length > 0)
    : [];
  const likelyLoginPage = continuity.likelyLoginPage === true;
  const likelyHumanVerification = continuity.likelyHumanVerification === true;

  if (classification === "auth_required" && (likelyLoginPage || loginRefs.length > 0)) {
    return {
      status: "env_limited",
      detail: "deferred_auth_wall_only"
    };
  }
  if (classification === "checkpoint_or_friction" && (likelyHumanVerification || checkpointRefs.length > 0)) {
    return {
      status: "env_limited",
      detail: "deferred_checkpoint_only"
    };
  }
  return null;
}

function normalizePlainText(value) {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim()
    : "";
}

const REDDIT_VERIFICATION_WALL_RE = /\b(?:please wait for verification|verify you are human|security check)\b/i;
const SOCIAL_JS_REQUIRED_RE = /\b(?:javascript (?:is not available|required|is disabled(?: in this browser)?)|you need to enable javascript|please enable javascript)\b/i;
const BLUESKY_LOGGED_OUT_SEARCH_RE = /\bsearch is currently unavailable when logged out\b/i;
const BLUESKY_EMPTY_SEARCH_SHELL_RE = /\b(?:follow 10 people to get started|find people to follow)\b/i;
const FACEBOOK_SEARCH_RESULTS_HEADING_RE = /\bsearch results\b/i;
const FACEBOOK_SEARCH_RESULT_MARKERS = [
  /\bshared with public\b/i,
  /\bopen reel in reels viewer\b/i,
  /\bcomment as\b/i
];
const REDDIT_BLOCKED_EXPANSION_HOSTS = ["accounts.google.com", "ads.reddit.com"];
const REDDIT_BLOCKED_FIRST_SEGMENTS = new Set(["account", "ads", "notifications", "submit", "verification"]);

function resolveCandidateUrl(value, baseUrl) {
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return null;
  }
}

function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function matchesHost(host, candidates) {
  const normalized = host.toLowerCase();
  return candidates.some((candidate) => normalized === candidate || normalized.endsWith(`.${candidate}`));
}

function firstPathSegment(pathname) {
  const [firstSegment] = pathname
    .toLowerCase()
    .split("/")
    .filter(Boolean);
  return typeof firstSegment === "string" && firstSegment.length > 0 ? firstSegment : null;
}

function isStaticMetadataPath(pathname) {
  const normalized = pathname.toLowerCase();
  return normalized.endsWith(".json")
    || normalized.endsWith(".xml")
    || normalized.endsWith(".txt")
    || normalized.endsWith(".webmanifest")
    || normalized.endsWith(".ico");
}

function isPrimaryRedditHost(host) {
  const normalized = host.toLowerCase();
  return normalized === "www.reddit.com"
    || normalized === "reddit.com"
    || normalized === "old.reddit.com";
}

function isPrimaryFacebookHost(host) {
  const normalized = host.toLowerCase();
  return normalized === "www.facebook.com"
    || normalized === "facebook.com"
    || normalized === "m.facebook.com";
}

function isPrimaryThreadsHost(host) {
  const normalized = host.toLowerCase();
  return normalized === "www.threads.net" || normalized === "threads.net";
}

function isFacebookSearchLikePath(pathname) {
  return pathname === "/watch/search"
    || pathname === "/watch/search/"
    || pathname.startsWith("/watch/explore/")
    || pathname.startsWith("/search/")
    || pathname.startsWith("/public/")
    || pathname.startsWith("/hashtag/");
}

function isBlockedFacebookNonContentUrl(parsed, { includeSearchRoute }) {
  if (!isPrimaryFacebookHost(parsed.hostname)) {
    return false;
  }
  const pathname = parsed.pathname.toLowerCase();
  if (
    pathname === "/"
    || pathname === "/login"
    || pathname === "/login/"
    || pathname === "/reg"
    || pathname === "/reg/"
    || pathname.startsWith("/recover/")
  ) {
    return true;
  }
  if ((pathname === "/watch" || pathname === "/watch/") && !parsed.searchParams.get("v")) {
    return true;
  }
  if (isStaticMetadataPath(pathname)) {
    return true;
  }
  return includeSearchRoute && isFacebookSearchLikePath(pathname);
}

function isBlockedRedditNonContentUrl(parsed, { includeSearchRoute }) {
  const host = parsed.hostname.toLowerCase();
  if (matchesHost(host, REDDIT_BLOCKED_EXPANSION_HOSTS)) {
    return true;
  }
  if (!isPrimaryRedditHost(host)) {
    return false;
  }
  const pathname = parsed.pathname.toLowerCase();
  if (pathname === "/" || pathname === "/login" || (includeSearchRoute && pathname === "/search")) {
    return true;
  }
  const pathSegment = firstPathSegment(pathname);
  return pathSegment !== null && REDDIT_BLOCKED_FIRST_SEGMENTS.has(pathSegment);
}

function isFirstPartySearchRoute(providerId, parsed) {
  const host = parsed.hostname.toLowerCase();
  const pathname = parsed.pathname.toLowerCase();
  return (
    (providerId === "social/x" && host === "x.com" && pathname === "/search")
    || (providerId === "social/bluesky" && host === "bsky.app" && pathname === "/search")
    || (providerId === "social/reddit" && isPrimaryRedditHost(host) && pathname === "/search")
    || (providerId === "social/facebook" && isPrimaryFacebookHost(host) && isFacebookSearchLikePath(pathname))
    || (providerId === "social/threads" && isPrimaryThreadsHost(host) && (pathname === "/search" || pathname === "/search/"))
  );
}

function isBlockedSocialExpansionPath(providerId, parsed) {
  const host = parsed.hostname.toLowerCase();
  const pathname = parsed.pathname.toLowerCase();
  if (providerId === "social/x") {
    return host === "x.com"
      && (
        pathname === "/"
        || pathname === "/home"
        || pathname === "/login"
        || pathname === "/privacy"
        || pathname === "/search"
        || pathname === "/tos"
        || isStaticMetadataPath(pathname)
        || pathname.startsWith("/i/flow/login")
      );
  }
  if (providerId === "social/bluesky") {
    return host === "bsky.app"
      && (
        pathname === "/"
        || pathname === "/login"
        || pathname === "/search"
        || isStaticMetadataPath(pathname)
        || /^\/profile\/[^/]+\/feed\/[^/]+$/.test(pathname)
      );
  }
  if (providerId === "social/reddit") {
    return isBlockedRedditNonContentUrl(parsed, { includeSearchRoute: true });
  }
  if (providerId === "social/facebook") {
    return isBlockedFacebookNonContentUrl(parsed, { includeSearchRoute: true });
  }
  if (providerId === "social/threads") {
    return isPrimaryThreadsHost(host)
      && (
        pathname === "/"
        || pathname === "/login"
        || pathname === "/login/"
        || pathname === "/search"
        || pathname === "/search/"
        || isStaticMetadataPath(pathname)
      );
  }
  return false;
}

function isUsableFirstPartySearchResultUrl(providerId, url) {
  const parsed = parseUrl(url);
  if (!parsed) {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  if (
    (providerId === "social/x" && host !== "x.com")
    || (providerId === "social/bluesky" && host !== "bsky.app")
  ) {
    return false;
  }
  if (
    (providerId === "social/x" && matchesHost(host, [
      "help.x.com",
      "developer.x.com",
      "business.x.com",
      "business.twitter.com",
      "legal.x.com",
      "legal.twitter.com",
      "support.x.com",
      "support.twitter.com",
      "t.co"
    ]))
    || (providerId === "social/bluesky" && matchesHost(host, [
      "atproto.com",
      "docs.bsky.app",
      "bsky.social",
      "blueskyweb.zendesk.com",
      "go.bsky.app"
    ]))
  ) {
    return false;
  }
  return !isBlockedSocialExpansionPath(providerId, parsed);
}

function isUsableBlueskySearchEvidenceUrl(url) {
  const parsed = parseUrl(url);
  return parsed !== null
    && parsed.hostname.toLowerCase() === "bsky.app"
    && /^\/profile\/[^/]+\/post\/[^/]+$/.test(parsed.pathname.toLowerCase());
}

function isUsableXSearchEvidenceUrl(url) {
  const parsed = parseUrl(url);
  return parsed !== null
    && parsed.hostname.toLowerCase() === "x.com"
    && /^\/[^/]+\/status\/\d+(?:\/|$)/.test(parsed.pathname.toLowerCase());
}

function isUsableRedditSearchEvidenceUrl(url) {
  const parsed = parseUrl(url);
  return parsed !== null
    && isPrimaryRedditHost(parsed.hostname)
    && /^\/r\/[^/]+\/comments\/[^/]+(?:\/|$)/.test(parsed.pathname.toLowerCase());
}

function isUsableFacebookSearchEvidenceUrl(url) {
  const parsed = parseUrl(url);
  if (parsed === null || !isPrimaryFacebookHost(parsed.hostname)) {
    return false;
  }
  const pathname = parsed.pathname.toLowerCase();
  if ((pathname === "/watch" || pathname === "/watch/") && parsed.searchParams.get("v")) {
    return true;
  }
  return /^\/reel\/[^/]+\/?$/.test(pathname)
    || /^\/groups\/[^/]+\/posts\/[^/]+\/?$/.test(pathname)
    || /^\/[^/]+\/videos\/[^/]+\/?$/.test(pathname)
    || /^\/share\/v\/[^/]+\/?$/.test(pathname)
    || ((pathname === "/permalink.php" || pathname === "/story.php") && parsed.searchParams.has("story_fbid"))
    || (pathname === "/photo/" && parsed.searchParams.has("fbid"));
}

function isUsableThreadsSearchEvidenceUrl(url) {
  const parsed = parseUrl(url);
  return parsed !== null
    && isPrimaryThreadsHost(parsed.hostname)
    && /^\/@[^/]+\/post\/[^/]+\/?$/.test(parsed.pathname.toLowerCase());
}

function isRetainableFacebookSearchSupportUrl(url) {
  const parsed = parseUrl(url);
  if (parsed === null || !isPrimaryFacebookHost(parsed.hostname)) {
    return false;
  }
  if (isBlockedFacebookNonContentUrl(parsed, { includeSearchRoute: true })) {
    return false;
  }
  if (isFirstPartySearchRoute("social/facebook", parsed)) {
    return false;
  }
  return !isUsableFacebookSearchEvidenceUrl(url);
}

function isUsableSocialSearchContentUrl(providerId, url) {
  if (providerId === "social/x") {
    return isUsableXSearchEvidenceUrl(url);
  }
  if (providerId === "social/bluesky") {
    return isUsableBlueskySearchEvidenceUrl(url);
  }
  if (providerId === "social/reddit") {
    return isUsableRedditSearchEvidenceUrl(url);
  }
  if (providerId === "social/facebook") {
    return isUsableFacebookSearchEvidenceUrl(url);
  }
  if (providerId === "social/threads") {
    return isUsableThreadsSearchEvidenceUrl(url);
  }
  return false;
}

function isAllowedSocialSearchExpansionUrl(providerId, url) {
  const parsed = parseUrl(url);
  if (!parsed) {
    return false;
  }
  if (
    (providerId === "social/x" && matchesHost(parsed.hostname, [
      "help.x.com",
      "developer.x.com",
      "business.x.com",
      "business.twitter.com",
      "legal.x.com",
      "legal.twitter.com",
      "support.x.com",
      "support.twitter.com",
      "t.co"
    ]))
    || (providerId === "social/bluesky" && matchesHost(parsed.hostname, [
      "atproto.com",
      "docs.bsky.app",
      "bsky.social",
      "blueskyweb.zendesk.com",
      "go.bsky.app"
    ]))
    || (providerId === "social/reddit" && matchesHost(parsed.hostname, ["support.reddithelp.com", "reddithelp.com", "redditinc.com"]))
  ) {
    return false;
  }
  return !isBlockedSocialExpansionPath(providerId, parsed);
}

function collectSocialSearchLinkEvidence(providerId, baseUrl, links) {
  const evidence = {
    usableLinks: [],
    usableFirstPartyLinks: [],
    usableContentLinks: [],
    blockedLinks: []
  };
  for (const candidate of links) {
    const resolved = resolveCandidateUrl(candidate, baseUrl);
    if (!resolved) {
      continue;
    }
    if (providerId === "social/x" || providerId === "social/bluesky") {
      if (isUsableFirstPartySearchResultUrl(providerId, resolved)) {
        evidence.usableLinks.push(resolved);
        evidence.usableFirstPartyLinks.push(resolved);
        if (isUsableSocialSearchContentUrl(providerId, resolved)) {
          evidence.usableContentLinks.push(resolved);
        }
      } else {
        evidence.blockedLinks.push(resolved);
      }
      continue;
    }
    if (isAllowedSocialSearchExpansionUrl(providerId, resolved)) {
      evidence.usableLinks.push(resolved);
      if (isUsableSocialSearchContentUrl(providerId, resolved)) {
        evidence.usableContentLinks.push(resolved);
      }
    } else {
      evidence.blockedLinks.push(resolved);
    }
  }
  return evidence;
}

function hasUsableFirstPartySearchEvidence(providerId, parsed, links) {
  const evidence = parsed === null
    ? null
    : collectSocialSearchLinkEvidence(providerId, parsed.toString(), links);
  return parsed !== null
    && isFirstPartySearchRoute(providerId, parsed)
    && evidence.usableContentLinks.length > 0;
}

function hasFacebookSearchResultSignals(url, title, content, links) {
  const parsed = parseUrl(url);
  if (parsed === null || !isFirstPartySearchRoute("social/facebook", parsed)) {
    return false;
  }
  const combined = `${normalizePlainText(title)} ${normalizePlainText(content)}`.trim();
  const hasSearchHeading = FACEBOOK_SEARCH_RESULTS_HEADING_RE.test(combined);
  const markerCount = FACEBOOK_SEARCH_RESULT_MARKERS.filter((pattern) => pattern.test(combined)).length;
  const evidence = collectSocialSearchLinkEvidence("social/facebook", parsed.toString(), Array.isArray(links) ? links : []);
  const hasContentEvidence = evidence.usableContentLinks.length > 0;
  const supportLinkCount = evidence.usableLinks.filter(isRetainableFacebookSearchSupportUrl).length;
  if (markerCount >= 2 && hasContentEvidence) {
    return true;
  }
  if (!hasSearchHeading) {
    return false;
  }
  return (markerCount >= 1 || supportLinkCount >= 2) && hasContentEvidence;
}

function detectSocialSearchShell(providerId, url, title, content, links = []) {
  const parsed = parseUrl(url);
  const combined = `${title} ${content}`.trim();

  if (providerId === "social/x" && parsed && matchesHost(parsed.hostname, [
    "help.x.com",
    "developer.x.com",
    "business.x.com",
    "business.twitter.com",
    "legal.x.com",
    "legal.twitter.com",
    "support.x.com",
    "support.twitter.com",
    "t.co"
  ])) {
    return "social_first_party_help_shell";
  }
  if (providerId === "social/bluesky" && parsed && matchesHost(parsed.hostname, [
    "atproto.com",
    "docs.bsky.app",
    "bsky.social",
    "blueskyweb.zendesk.com",
    "go.bsky.app"
  ])) {
    return "social_first_party_help_shell";
  }
  if (providerId === "social/reddit" && parsed && matchesHost(parsed.hostname, ["support.reddithelp.com", "reddithelp.com", "redditinc.com"])) {
    return "social_first_party_help_shell";
  }
  if (providerId === "social/reddit" && REDDIT_VERIFICATION_WALL_RE.test(combined)) {
    return "social_verification_wall";
  }
  if (
    providerId === "social/bluesky"
    && parsed
    && isFirstPartySearchRoute(providerId, parsed)
    && BLUESKY_LOGGED_OUT_SEARCH_RE.test(combined)
  ) {
    return "social_js_required_shell";
  }
  if (
    providerId === "social/bluesky"
    && parsed
    && isFirstPartySearchRoute(providerId, parsed)
    && BLUESKY_EMPTY_SEARCH_SHELL_RE.test(combined)
  ) {
    return "social_render_shell";
  }
  if (
    (providerId === "social/x" || providerId === "social/bluesky")
    && SOCIAL_JS_REQUIRED_RE.test(combined)
    && !hasUsableFirstPartySearchEvidence(providerId, parsed, links)
  ) {
    return "social_js_required_shell";
  }
  if (parsed) {
    const pathname = parsed.pathname.toLowerCase();
    if (
      (providerId === "social/x" && parsed.hostname === "x.com" && (pathname === "/" || pathname === "/home" || pathname === "/login" || pathname.startsWith("/i/flow/login")))
      || (providerId === "social/bluesky" && parsed.hostname === "bsky.app" && (pathname === "/" || pathname === "/login"))
      || (providerId === "social/reddit" && isBlockedRedditNonContentUrl(parsed, { includeSearchRoute: false }))
      || (providerId === "social/facebook" && isBlockedFacebookNonContentUrl(parsed, { includeSearchRoute: false }))
      || (providerId === "social/threads" && isPrimaryThreadsHost(parsed.hostname) && (pathname === "/" || pathname === "/login" || pathname === "/login/"))
    ) {
      return "social_render_shell";
    }
  }
  if (
    parsed
    && isFirstPartySearchRoute(providerId, parsed)
    && providerId === "social/facebook"
    && hasFacebookSearchResultSignals(url, title, content, links)
  ) {
    return null;
  }
  if (
    parsed
    && isFirstPartySearchRoute(providerId, parsed)
    && !hasUsableFirstPartySearchEvidence(providerId, parsed, links)
  ) {
    return "social_render_shell";
  }
  return null;
}

function getMacroShellReason(record, providerId, fallbackRetrievalPath) {
  const url = normalizePlainText(record?.url).toLowerCase();
  const title = normalizePlainText(record?.title);
  const content = normalizePlainText(record?.content);
  const combined = `${title} ${content}`.trim().toLowerCase();
  const retrievalPath = normalizePlainText(
    typeof record?.attributes?.retrievalPath === "string"
      ? record.attributes.retrievalPath
      : fallbackRetrievalPath
  ).toLowerCase();
  const extractionQuality = isJsonRecord(record?.attributes?.extractionQuality)
    ? record.attributes.extractionQuality
    : null;
  const contentChars = Number(
    isJsonRecord(extractionQuality)
      ? extractionQuality.contentChars
      : content.length
  );
  const links = Array.isArray(record?.attributes?.links) ? record.attributes.links : [];

  if (
    combined.includes("bots use duckduckgo too")
    || combined.includes("please complete the following challenge")
    || combined.includes("select all squares containing a duck")
  ) {
    return "challenge_shell";
  }

  const socialShell = detectSocialSearchShell(providerId, url, title, content, links);
  if (socialShell) {
    return socialShell;
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
    return "youtube_site_chrome_shell";
  }

  return null;
}

function classifyMacroRecordQuality(testCase, execution) {
  if (!Array.isArray(execution.records) || execution.records.length === 0) {
    return null;
  }

  const fallbackRetrievalPath = normalizePlainText(execution.execution?.meta?.provenance?.retrievalPath);
  const reasons = execution.records
    .map((record) => getMacroShellReason(record, testCase.providerId, fallbackRetrievalPath))
    .filter((reason) => typeof reason === "string");
  if (reasons.length !== execution.records.length) {
    return null;
  }

  const uniqueReasons = [...new Set(reasons)];
  return classifyShellOnlyReasons(uniqueReasons);
}

function classifyRawFailureDetail(detail) {
  return parseShellOnlyFailureDetail(detail) ?? {
    status: "fail",
    detail,
    shellOnlyReasons: []
  };
}

function resolveDirectHarnessVerdict({ classified, detail, preferClassified }) {
  const rawFailure = classifyRawFailureDetail(detail);
  return {
    rawFailure,
    verdict: preferClassified ? classified : rawFailure
  };
}

function isTimeoutDetail(detail) {
  return /timed out|timeout/i.test(String(detail ?? ""));
}

function buildProviderCases(options) {
  const cases = [];
  const webCommunityCases = options.smoke
    ? DIRECT_WEB_COMMUNITY_CASES.slice(0, 4)
    : DIRECT_WEB_COMMUNITY_CASES;
  cases.push(...webCommunityCases);

  for (const platform of socialPlatformsForMode(options.smoke)) {
    cases.push({
      id: `provider.social.${platform}.search`,
      providerId: `social/${platform}`,
      args: ["macro-resolve", "--execute", "--expression", `@media.search("browser automation ${platform}", "${platform}", 5)`, "--timeout-ms", options.releaseGate ? "180000" : "120000", ...MACRO_CHALLENGE_ARGS]
    });
  }

  if (options.runSocialPostCases) {
    for (const testCase of SOCIAL_POST_CASES) {
      cases.push({
        id: testCase.id,
        providerId: `social/${testCase.id.split(".")[2]}`,
        args: ["macro-resolve", "--execute", "--expression", testCase.expression, "--timeout-ms", "120000", ...MACRO_CHALLENGE_ARGS],
        allowExpectedUnavailable: true
      });
    }
  }

  for (const provider of shoppingProvidersForMode(options.smoke)) {
    if (!options.runHighFriction && HIGH_FRICTION_SHOPPING_PROVIDERS.has(provider)) {
      cases.push({
        id: `provider.${provider.replace("/", ".")}.search`,
        providerId: provider,
        skipped: true,
        detail: "skipped_high_friction_by_default"
      });
      continue;
    }
    if (!options.runAuthGated && AUTH_GATED_SHOPPING_PROVIDERS.has(provider)) {
      cases.push({
        id: `provider.${provider.replace("/", ".")}.search`,
        providerId: provider,
        skipped: true,
        detail: "skipped_auth_gated_by_default"
      });
      continue;
    }
    cases.push({
      id: `provider.${provider.replace("/", ".")}.search`,
      providerId: provider,
      args: [
        "shopping",
        "run",
        "--query",
        "ergonomic wireless mouse",
        "--providers",
        provider,
        "--sort",
        "best_deal",
        "--mode",
        "json",
        "--timeout-ms",
        DIRECT_SHOPPING_PROVIDER_TIMEOUT_MS.get(provider) ?? "45000",
        ...MACRO_CHALLENGE_ARGS,
        "--use-cookies"
      ]
    });
  }

  return cases;
}

export function parseArgs(argv) {
  const options = {
    out: null,
    smoke: false,
    releaseGate: false,
    includeAuthGated: false,
    includeHighFriction: false,
    includeSocialPosts: false,
    quiet: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help") {
      console.log(HELP_TEXT);
      process.exit(0);
    }
    if (arg === "--smoke") {
      options.smoke = true;
      continue;
    }
    if (arg === "--release-gate") {
      options.releaseGate = true;
      continue;
    }
    if (arg === "--include-auth-gated") {
      options.includeAuthGated = true;
      continue;
    }
    if (arg === "--include-high-friction") {
      options.includeHighFriction = true;
      continue;
    }
    if (arg === "--include-social-posts") {
      options.includeSocialPosts = true;
      continue;
    }
    if (arg === "--quiet") {
      options.quiet = true;
      continue;
    }
    if (arg === "--out") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("--out requires a file path.");
      }
      options.out = next;
      index += 1;
      continue;
    }
    if (arg.startsWith("--out=")) {
      options.out = arg.slice("--out=".length);
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  if (options.releaseGate && options.smoke) {
    throw new Error("--release-gate cannot be combined with --smoke.");
  }

  const mode = options.smoke ? "smoke" : "full";
  return {
    ...options,
    mode,
    runAuthGated: options.releaseGate || options.includeAuthGated,
    runHighFriction: options.releaseGate || options.includeHighFriction,
    runSocialPostCases: options.releaseGate || options.includeSocialPosts,
    out: options.out ?? defaultArtifactPath(`odb-provider-direct-runs-${mode}`)
  };
}

function evaluateMacroCase(testCase, result) {
  const execution = collectMacroExecution(result);
  const challengeOrchestration = collectMacroChallengeOrchestration(execution);
  const browserFallback = collectMacroBrowserFallback(execution);
  const guidance = collectMacroGuidance(execution);
  const macroMetadata = collectRequestedChallengeMetadata(testCase.args);
  if (result.status === 0 && !execution.hasExecutionPayload) {
    return {
      id: testCase.id,
      providerId: testCase.providerId,
      command: testCase.args,
      status: "fail",
      detail: "missing_execution_payload",
      data: {
        records: 0,
        failures: 0,
        providerOrder: [],
        reasonCodes: [],
        blockerType: null,
        failureSamples: [],
        linkedinAuthWall: false,
        hasExecutionPayload: false,
        challengeOrchestration,
        browserFallbackMode: browserFallback.browserFallbackMode,
        browserFallbackReasonCode: browserFallback.browserFallbackReasonCode,
        ...macroMetadata
      }
    };
  }

  const reasonCodes = normalizedCodesFromFailures(execution.failures);
  const linkedinAuthWall = testCase.providerId === "social/linkedin" && hasLinkedInAuthWall(execution.records);
  const deferredChallengeClassification = testCase.providerId.startsWith("social/")
    ? getDeferredChallengeClassification(challengeOrchestration)
    : null;
  const shellOnlyClassification = classifyMacroRecordQuality(testCase, execution);
  const classified = deferredChallengeClassification
    ?? (linkedinAuthWall
      ? { status: "env_limited", detail: "linkedin_auth_wall_only" }
      : (
        shellOnlyClassification
        ?? classifyRecords(
          execution.records.length,
          execution.failures,
          {
            allowExpectedUnavailable: testCase.allowExpectedUnavailable === true,
            allowNoRecordsNoFailures: false
          }
        )
      ));
  const { rawFailure, verdict } = resolveDirectHarnessVerdict({
    classified,
    detail: result.detail,
    preferClassified: result.status === 0
  });

  return {
    id: testCase.id,
    providerId: testCase.providerId,
    command: testCase.args,
    status: verdict.status,
    detail: verdict.detail,
    data: {
      records: execution.records.length,
      failures: execution.failures.length,
      providerOrder: execution.providerOrder,
      reasonCodes,
      blockerType: execution.execution?.meta?.blocker?.type ?? null,
      failureSamples: summarizeFailures(execution.failures),
      linkedinAuthWall,
      shellOnlyReasons: execution.hasExecutionPayload
        ? (shellOnlyClassification?.shellOnlyReasons ?? [])
        : rawFailure.shellOnlyReasons,
      hasExecutionPayload: execution.hasExecutionPayload,
      challengeOrchestration,
      browserFallbackMode: browserFallback.browserFallbackMode,
      browserFallbackReasonCode: browserFallback.browserFallbackReasonCode,
      guidanceReason: guidance.guidanceReason,
      recommendedNextCommand: guidance.recommendedNextCommand,
      ...macroMetadata
    }
  };
}

export function shouldRetryMacroTimeoutCase(testCase, step) {
  const providerId = testCase?.providerId;
  if (step?.status !== "fail" || step?.data?.hasExecutionPayload !== false) {
    return false;
  }
  if (providerId === "social/linkedin") {
    return LINKEDIN_TIMEOUT_RETRY_DETAIL_RE.test(String(step?.detail ?? ""));
  }
  if (providerId === "social/youtube") {
    return String(step?.detail ?? "").trim() === YOUTUBE_SITE_CHROME_SHELL_RETRY_DETAIL;
  }
  return false;
}

function mergeRetriedStep(initialStep, retriedStep) {
  const retryMetadata = {
    retryAttempted: true,
    retryInitialStatus: initialStep.status,
    retryInitialDetail: initialStep.detail
  };

  const usableCount = Number(retriedStep.data?.records ?? retriedStep.data?.offers ?? 0);
  const recoveredUsableResults = retriedStep.status === "pass" && usableCount > 0;
  if (recoveredUsableResults) {
    return {
      ...retriedStep,
      data: {
        ...(retriedStep.data ?? {}),
        ...retryMetadata,
        retryRecovered: true
      }
    };
  }

  return {
    ...initialStep,
    data: {
      ...(initialStep.data ?? {}),
      ...retryMetadata,
      retryRecovered: false,
      retryFinalStatus: retriedStep.status,
      retryFinalDetail: retriedStep.detail,
      retryFinalData: retriedStep.data ?? null
    }
  };
}

export function mergeRetriedMacroStep(initialStep, retriedStep) {
  return mergeRetriedStep(initialStep, retriedStep);
}

export function shouldRetryShoppingTimeoutCase(testCase, step) {
  return testCase?.providerId === "shopping/temu"
    && step?.status === "fail"
    && (
      (
        Array.isArray(step?.data?.reasonCodes)
        && step.data.reasonCodes.includes("timeout")
      )
      || isTimeoutDetail(step?.detail)
    );
}

export function mergeRetriedShoppingStep(initialStep, retriedStep) {
  return mergeRetriedStep(initialStep, retriedStep);
}

function evaluateShoppingCase(testCase, result) {
  const execution = collectShoppingExecution(result);
  const challengeOrchestration = collectShoppingChallengeOrchestration(execution);
  const browserFallback = collectShoppingBrowserFallback(execution);
  const guidance = collectShoppingGuidance(execution);
  const reasonCodes = normalizedCodesFromFailures(execution.failures);
  const classified = classifyRecords(execution.offers.length, execution.failures);
  const { verdict } = resolveDirectHarnessVerdict({
    classified,
    detail: result.detail,
    preferClassified: result.status === 0
  });
  const firstFailure = execution.firstFailure;
  const failureDetails = firstFailure?.error?.details ?? {};
  const shoppingMetadata = collectRequestedChallengeMetadata(testCase.args);
  return {
    id: testCase.id,
    providerId: testCase.providerId,
    command: testCase.args,
    status: verdict.status,
    detail: verdict.detail,
    data: {
      offers: execution.offers.length,
      failures: execution.failures.length,
      reasonCodes,
      failureSamples: summarizeFailures(execution.failures),
      blockerType: execution.blocker?.type ?? firstFailure?.error?.blockerType ?? failureDetails.blockerType ?? null,
      blockerReason: execution.blocker?.reason ?? firstFailure?.error?.blockerReason ?? failureDetails.blockerReason ?? null,
      constraintKind: failureDetails.constraint?.kind ?? null,
      constraint: failureDetails.constraint ?? null,
      providerShell: firstFailure?.error?.providerShell ?? failureDetails.providerShell ?? null,
      artifactPath: execution.data?.artifact_path ?? execution.data?.path ?? null,
      challengeOrchestration,
      browserFallbackMode: browserFallback.browserFallbackMode,
      browserFallbackReasonCode: browserFallback.browserFallbackReasonCode,
      guidanceReason: guidance.guidanceReason,
      recommendedNextCommand: guidance.recommendedNextCommand,
      ...shoppingMetadata
    }
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  ensureCliBuilt();
  const daemonState = { ownedDaemon: null };

  const report = {
    startedAt: new Date().toISOString(),
    out: options.out,
    mode: options.mode,
    releaseGate: options.releaseGate,
    runAuthGated: options.runAuthGated,
    runHighFriction: options.runHighFriction,
    runSocialPostCases: options.runSocialPostCases,
    rerunMetadata: {
      requestedChallengeAutomationMode: MACRO_REQUESTED_CHALLENGE_AUTOMATION_MODE,
      helperCapableRequested: true,
      appliesTo: "macro_resolve_and_shopping_cases"
    },
    steps: []
  };

  const providerCoverage = buildProviderCoverageSummary({
    smoke: options.smoke,
    runAuthGated: options.runAuthGated,
    runHighFriction: options.runHighFriction,
    releaseGate: options.releaseGate
  });
  report.providerCoverage = providerCoverage;
  report.coverageGap = providerCoverage.ok
    ? null
    : {
        status: options.releaseGate ? "fail" : "skipped",
        detail: `missing=${providerCoverage.missingProviderIds.join(",") || "none"} extra=${providerCoverage.extraScenarioProviderIds.join(",") || "none"}`,
        missingProviderIds: providerCoverage.missingProviderIds,
        extraScenarioProviderIds: providerCoverage.extraScenarioProviderIds
      };
  pushStep(
    report,
    buildProviderCoverageStep(providerCoverage, { releaseGate: options.releaseGate }),
    { prefix: "[provider-direct]", logProgress: !options.quiet }
  );

  try {
    const daemonPreflight = await ensureProviderDaemon(daemonState);
    pushStep(report, appendDaemonState(
      classifyDaemonPreflight(daemonPreflight.daemonStatus),
      daemonPreflight.startedDaemon
    ), {
      prefix: "[provider-direct]",
      logProgress: !options.quiet
    });
    if (shouldAbortForDaemonPreflight(daemonPreflight.daemonStatus)) {
      finalizeReport(report, { strictGate: options.releaseGate });
      writeJson(options.out, report);
      console.log(options.out);
      console.log(JSON.stringify({
        ok: report.ok,
        counts: report.counts,
        out: options.out,
        mode: options.mode
      }, null, 2));
      process.exitCode = 1;
      return;
    }

    for (const testCase of buildProviderCases(options)) {
      if (testCase.skipped) {
        pushStep(report, {
          id: testCase.id,
          providerId: testCase.providerId,
          status: "skipped",
          detail: testCase.detail,
          data: { skipped: true }
        }, { prefix: "[provider-direct]", logProgress: !options.quiet });
        continue;
      }

      let step;
      try {
        if (!options.quiet) {
          console.error(`[provider-direct] starting ${testCase.id}`);
        }
        const daemonReady = await ensureProviderDaemon(daemonState);
        const timeoutMs = testCase.providerId.startsWith("shopping/")
          ? 360000
          : 240000;
        const result = runCli(testCase.args, {
          env: process.env,
          allowFailure: true,
          timeoutMs
        });
        step = testCase.providerId.startsWith("shopping/")
          ? evaluateShoppingCase(testCase, result)
          : evaluateMacroCase(testCase, result);
        if (testCase.providerId.startsWith("shopping/") && shouldRetryShoppingTimeoutCase(testCase, step)) {
          const retriedResult = runCli(testCase.args, {
            env: process.env,
            allowFailure: true,
            timeoutMs
          });
          const retriedStep = evaluateShoppingCase(testCase, retriedResult);
          step = mergeRetriedShoppingStep(step, retriedStep);
        } else if (shouldRetryMacroTimeoutCase(testCase, step)) {
          const retriedResult = runCli(testCase.args, {
            env: process.env,
            allowFailure: true,
            timeoutMs
          });
          const retriedStep = evaluateMacroCase(testCase, retriedResult);
          step = mergeRetriedMacroStep(step, retriedStep);
        }
        step = appendDaemonState(step, daemonReady.startedDaemon);
      } catch (error) {
        step = {
          id: testCase.id,
          providerId: testCase.providerId,
          status: "fail",
          detail: error instanceof Error ? error.message : String(error)
        };
      }
      pushStep(report, step, { prefix: "[provider-direct]", logProgress: !options.quiet });
    }
  } finally {
    if (daemonState.ownedDaemon) {
      await stopDaemon(daemonState.ownedDaemon, process.env);
    }
  }

  finalizeReport(report, { strictGate: options.releaseGate });
  writeJson(options.out, report);
  console.log(options.out);
  console.log(JSON.stringify({
    ok: report.ok,
    counts: report.counts,
    out: options.out,
    mode: options.mode
  }, null, 2));

  if (!report.ok) {
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

export { buildProviderCases, evaluateMacroCase, evaluateShoppingCase };
