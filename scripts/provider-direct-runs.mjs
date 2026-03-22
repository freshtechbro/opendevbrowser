#!/usr/bin/env node
import {
  buildProviderCoverageSummary,
  shoppingProvidersForMode,
  socialPlatformsForMode
} from "./provider-live-scenarios.mjs";
import {
  classifyRecords,
  defaultArtifactPath,
  ensureCliBuilt,
  finalizeReport,
  normalizedCodesFromFailures,
  pushStep,
  runCli,
  summarizeFailures,
  writeJson
} from "./live-direct-utils.mjs";

const HELP_TEXT = [
  "Usage: node scripts/provider-direct-runs.mjs [options]",
  "",
  "Options:",
  "  --out <path>                 Output JSON path (default: /tmp/odb-provider-direct-runs-<mode>-<ts>.json)",
  "  --smoke                      Reduced provider set for faster manual checks",
  "  --release-gate               Strict release mode (enables gated cases and fails on env_limited)",
  "  --use-global-env             Compatibility flag; direct runs already use the current environment",
  "  --include-auth-gated         Include auth-gated provider scenarios",
  "  --include-high-friction      Include high-friction provider scenarios",
  "  --include-social-posts       Include write-path social probes",
  "  --quiet                      Suppress per-step progress logging",
  "  --help                       Show help"
].join("\n");

const AUTH_GATED_SHOPPING_PROVIDERS = new Set(["shopping/costco", "shopping/macys"]);
const HIGH_FRICTION_SHOPPING_PROVIDERS = new Set(["shopping/bestbuy"]);
const SHOPPING_PROVIDER_TIMEOUT_MS = new Map([
  ["shopping/bestbuy", "120000"],
  ["shopping/ebay", "120000"],
  ["shopping/walmart", "120000"],
  ["shopping/target", "120000"],
  ["shopping/costco", "120000"],
  ["shopping/temu", "120000"]
]);
const SOCIAL_POST_CASES = [
  { id: "provider.social.x.post", expression: '@social.post("x", "me", "ship realworld test", true, true)' },
  { id: "provider.social.instagram.post", expression: '@social.post("instagram", "me", "ship realworld test", true, true)' },
  { id: "provider.social.facebook.post", expression: '@social.post("facebook", "me", "ship realworld test", true, true)' }
];

const DIRECT_WEB_COMMUNITY_CASES = [
  {
    id: "provider.web.search.keyword",
    providerId: "web/default",
    args: ["macro-resolve", "--execute", "--expression", '@web.search("site:developer.mozilla.org playwright locator", 4)', "--timeout-ms", "120000"]
  },
  {
    id: "provider.web.search.url",
    providerId: "web/default",
    args: ["macro-resolve", "--execute", "--expression", '@web.search("https://example.com", 2)', "--timeout-ms", "120000"]
  },
  {
    id: "provider.web.fetch.url",
    providerId: "web/default",
    args: ["macro-resolve", "--execute", "--expression", '@web.fetch("https://example.com")', "--timeout-ms", "120000"]
  },
  {
    id: "provider.community.search.keyword",
    providerId: "community/default",
    args: ["macro-resolve", "--execute", "--expression", '@community.search("browser automation failures", 4)', "--timeout-ms", "120000"]
  },
  {
    id: "provider.community.search.url",
    providerId: "community/default",
    args: ["macro-resolve", "--execute", "--expression", '@community.search("https://www.reddit.com/r/programming", 2)', "--timeout-ms", "120000"]
  }
];

function readDaemonStatus() {
  return runCli(["status", "--daemon"], {
    allowFailure: true,
    timeoutMs: 15_000
  });
}

export function classifyDaemonPreflight(result) {
  return {
    id: "infra.daemon_status",
    status: result.status === 0 ? "pass" : "fail",
    detail: result.status === 0 ? null : result.detail,
    data: result.json?.data ?? null
  };
}

function isEnvLimitedDetail(detail) {
  const normalized = String(detail ?? "").toLowerCase();
  return normalized.includes("env_limited")
    || normalized.includes("auth")
    || normalized.includes("rate limit")
    || normalized.includes("challenge")
    || normalized.includes("unavailable")
    || normalized.includes("restricted");
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

function collectShoppingExecution(result) {
  const data = result.json?.data ?? {};
  const offers = Array.isArray(data.offers) ? data.offers : [];
  const failures = Array.isArray(data.meta?.failures) ? data.meta.failures : [];
  const firstFailure = failures[0] ?? null;
  const blocker = data.meta?.blocker ?? firstFailure?.error?.blocker ?? null;
  return {
    data,
    offers,
    failures,
    firstFailure,
    blocker
  };
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
      args: ["macro-resolve", "--execute", "--expression", `@media.search("browser automation ${platform}", "${platform}", 5)`, "--timeout-ms", options.releaseGate ? "180000" : "120000"]
    });
  }

  if (options.runSocialPostCases) {
    for (const testCase of SOCIAL_POST_CASES) {
      cases.push({
        id: testCase.id,
        providerId: `social/${testCase.id.split(".")[2]}`,
        args: ["macro-resolve", "--execute", "--expression", testCase.expression, "--timeout-ms", "120000"],
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
        SHOPPING_PROVIDER_TIMEOUT_MS.get(provider) ?? "45000",
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
    useGlobalEnv: false,
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
    if (arg === "--use-global-env") {
      options.useGlobalEnv = true;
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
        hasExecutionPayload: false
      }
    };
  }

  const reasonCodes = normalizedCodesFromFailures(execution.failures);
  const linkedinAuthWall = testCase.providerId === "social/linkedin" && hasLinkedInAuthWall(execution.records);
  const classified = linkedinAuthWall
    ? { status: "env_limited", detail: "linkedin_auth_wall_only" }
    : classifyRecords(
      execution.records.length,
      execution.failures,
      {
        allowExpectedUnavailable: testCase.allowExpectedUnavailable === true,
        allowNoRecordsNoFailures: testCase.providerId.startsWith("social/")
      }
    );

  return {
    id: testCase.id,
    providerId: testCase.providerId,
    command: testCase.args,
    status: result.status === 0
      ? classified.status
      : (isEnvLimitedDetail(result.detail) ? "env_limited" : "fail"),
    detail: result.status === 0 ? classified.detail : result.detail,
    data: {
      records: execution.records.length,
      failures: execution.failures.length,
      providerOrder: execution.providerOrder,
      reasonCodes,
      blockerType: execution.execution?.meta?.blocker?.type ?? null,
      failureSamples: summarizeFailures(execution.failures),
      linkedinAuthWall,
      hasExecutionPayload: execution.hasExecutionPayload
    }
  };
}

function evaluateShoppingCase(testCase, result) {
  const execution = collectShoppingExecution(result);
  const reasonCodes = normalizedCodesFromFailures(execution.failures);
  const classified = classifyRecords(execution.offers.length, execution.failures);
  const firstFailure = execution.firstFailure;
  const failureDetails = firstFailure?.error?.details ?? {};
  return {
    id: testCase.id,
    providerId: testCase.providerId,
    command: testCase.args,
    status: result.status === 0
      ? classified.status
      : (isEnvLimitedDetail(result.detail) ? "env_limited" : "fail"),
    detail: result.status === 0 ? classified.detail : result.detail,
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
      artifactPath: execution.data?.artifact_path ?? execution.data?.path ?? null
    }
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  ensureCliBuilt();

  const report = {
    startedAt: new Date().toISOString(),
    out: options.out,
    mode: options.mode,
    releaseGate: options.releaseGate,
    useGlobalEnv: options.useGlobalEnv,
    runAuthGated: options.runAuthGated,
    runHighFriction: options.runHighFriction,
    runSocialPostCases: options.runSocialPostCases,
    steps: []
  };

  const providerCoverage = buildProviderCoverageSummary({
    smoke: options.smoke,
    runAuthGated: options.runAuthGated,
    runHighFriction: options.runHighFriction,
    releaseGate: options.releaseGate
  });
  report.providerCoverage = providerCoverage;
  pushStep(report, {
    id: "infra.provider_scenario_coverage",
    status: options.releaseGate
      ? (providerCoverage.ok ? "pass" : "fail")
      : "pass",
    detail: providerCoverage.ok
      ? null
      : (options.releaseGate
        ? `missing=${providerCoverage.missingProviderIds.join(",") || "none"} extra=${providerCoverage.extraScenarioProviderIds.join(",") || "none"}`
        : "release_gate_only_coverage_gap"),
    data: {
      expectedCount: providerCoverage.expected.all.length,
      scenarioCount: providerCoverage.scenarios.all.length,
      missingProviderIds: providerCoverage.missingProviderIds,
      extraScenarioProviderIds: providerCoverage.extraScenarioProviderIds
    }
  }, { prefix: "[provider-direct]", logProgress: !options.quiet });

  const daemonStatus = readDaemonStatus();
  pushStep(report, classifyDaemonPreflight(daemonStatus), {
    prefix: "[provider-direct]",
    logProgress: !options.quiet
  });
  if (daemonStatus.status !== 0) {
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
      const timeoutMs = testCase.providerId.startsWith("shopping/")
        ? 360000
        : 240000;
      const result = runCli(testCase.args, { allowFailure: true, timeoutMs });
      step = testCase.providerId.startsWith("shopping/")
        ? evaluateShoppingCase(testCase, result)
        : evaluateMacroCase(testCase, result);
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
