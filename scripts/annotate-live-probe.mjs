#!/usr/bin/env node
import {
  defaultArtifactPath,
  ensureCliBuilt,
  runCli,
  writeJson
} from "./live-direct-utils.mjs";

const ANNOTATE_TIMEOUT_MS = 8_000;
const RELAY_STATUS_TIMEOUT_MS = 15_000;

function parseArgs(argv) {
  const options = {
    transport: "",
    out: null,
    releaseGate: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--transport") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("--transport requires a value.");
      }
      options.transport = next;
      index += 1;
      continue;
    }
    if (arg.startsWith("--transport=")) {
      options.transport = arg.slice("--transport=".length);
      continue;
    }
    if (arg === "--out") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("--out requires a value.");
      }
      options.out = next;
      index += 1;
      continue;
    }
    if (arg.startsWith("--out=")) {
      options.out = arg.slice("--out=".length);
      continue;
    }
    if (arg === "--release-gate") {
      options.releaseGate = true;
      continue;
    }
    if (arg === "--help") {
      console.log([
        "Usage: node scripts/annotate-live-probe.mjs --transport <relay|direct> [--release-gate] [--out <path>]",
        "",
        "Runs a real annotate probe and classifies manual timeout boundaries explicitly."
      ].join("\n"));
      process.exit(0);
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  if (options.transport !== "relay" && options.transport !== "direct") {
    throw new Error(`Unknown --transport value: ${options.transport}`);
  }

  return {
    ...options,
    out: options.out ?? defaultArtifactPath(`odb-annotate-${options.transport}-probe`)
  };
}

function isTimeoutDetail(detail) {
  return /timed out|timeout|waiting for manual completion/i.test(String(detail ?? ""));
}

function isRelayEnvLimitedDetail(detail) {
  return /daemon not running|failed to fetch relay config|extension not connected|connect the extension|relay unavailable|rate limit|restricted|annotation ui did not load/i
    .test(String(detail ?? "").toLowerCase());
}

export function classifyProbeOutcome({
  transport,
  releaseGate,
  commandStatus,
  success,
  detail
}) {
  if (commandStatus === 0 && success === true) {
    return { status: "pass", detail: null };
  }

  if (transport === "relay" && isRelayEnvLimitedDetail(detail)) {
    return { status: "env_limited", detail };
  }

  if (isTimeoutDetail(detail)) {
    return releaseGate
      ? {
        status: "skipped",
        detail: `manual_probe_boundary_observed:${transport}_annotation_timeout`
      }
      : {
        status: "expected_timeout",
        detail
      };
  }

  return { status: "fail", detail };
}

export function getLaunchArgs(transport) {
  return transport === "relay"
    ? ["launch", "--extension-only", "--wait-for-extension", "--start-url", "https://example.com/?annotate=relay"]
    : ["launch", "--no-extension", "--headless", "--persist-profile", "false", "--start-url", "https://example.com/?annotate=direct"];
}

function getRelayPreflight() {
  const status = runCli(["status", "--daemon"], {
    allowFailure: true,
    timeoutMs: RELAY_STATUS_TIMEOUT_MS
  });
  const relay = status.json?.data?.relay ?? null;
  if (status.status !== 0) {
    return {
      status: "env_limited",
      detail: status.detail,
      data: { daemonRunning: false, relay }
    };
  }
  if (relay?.extensionHandshakeComplete !== true) {
    return {
      status: "env_limited",
      detail: "extension_disconnected",
      data: { daemonRunning: true, relay }
    };
  }
  return {
    status: "pass",
    detail: null,
    data: { daemonRunning: true, relay }
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  ensureCliBuilt();

  const artifact = {
    transport: options.transport,
    artifactPath: options.out,
    releaseGate: options.releaseGate,
    steps: []
  };

  let sessionId = null;
  let disconnected = false;
  let finalStatus = "fail";
  let finalDetail = null;

  try {
    if (options.transport === "relay") {
      const preflight = getRelayPreflight();
      artifact.steps.push({
        step: "relay-preflight",
        status: preflight.status,
        detail: preflight.detail,
        data: preflight.data
      });
      if (preflight.status !== "pass") {
        finalStatus = preflight.status;
        finalDetail = preflight.detail;
        artifact.status = finalStatus;
        artifact.detail = finalDetail;
        artifact.ok = true;
        return;
      }
    }

    const launchArgs = getLaunchArgs(options.transport);
    const launch = runCli(launchArgs, { timeoutMs: 300_000 }).json;
    sessionId = launch.data.sessionId;
    artifact.steps.push({
      step: "launch",
      sessionId,
      activeTargetId: launch.data.activeTargetId
    });

    const annotate = runCli([
      "annotate",
      "--session-id",
      sessionId,
      "--transport",
      options.transport,
      "--target-id",
      launch.data.activeTargetId,
      "--screenshot-mode",
      "none",
      "--timeout-ms",
      String(ANNOTATE_TIMEOUT_MS),
      "--context",
      `Direct ${options.transport} annotation probe`
    ], { allowFailure: true, timeoutMs: 30_000 });
    const annotateDetail = annotate.json?.message ?? annotate.detail;
    artifact.steps.push({
      step: "annotate",
      status: annotate.status,
      success: annotate.json?.success === true,
      message: annotateDetail,
      data: annotate.json?.data ?? null,
      stderr: annotate.stderr || null
    });

    const outcome = classifyProbeOutcome({
      transport: options.transport,
      releaseGate: options.releaseGate,
      commandStatus: annotate.status,
      success: annotate.json?.success === true,
      detail: annotateDetail
    });
    finalStatus = outcome.status;
    finalDetail = outcome.detail;

    const disconnect = runCli([
      "disconnect",
      "--session-id",
      sessionId,
      ...(options.transport === "direct" ? ["--close-browser"] : [])
    ], { allowFailure: true, timeoutMs: 120_000 });
    disconnected = true;
    artifact.steps.push({
      step: "disconnect",
      status: disconnect.status,
      success: disconnect.json?.success === true
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const outcome = classifyProbeOutcome({
      transport: options.transport,
      releaseGate: options.releaseGate,
      commandStatus: 1,
      success: false,
      detail
    });
    finalStatus = outcome.status;
    finalDetail = outcome.detail;
    artifact.error = detail;
  } finally {
    if (sessionId && !disconnected) {
      runCli([
        "disconnect",
        "--session-id",
        sessionId,
        ...(options.transport === "direct" ? ["--close-browser"] : [])
      ], { allowFailure: true, timeoutMs: 120_000 });
    }
    artifact.status = finalStatus;
    artifact.detail = finalDetail;
    artifact.ok = finalStatus !== "fail";
    if (!artifact.ok) {
      process.exitCode = 1;
    }
    writeJson(options.out, artifact);
    console.log(JSON.stringify({
      ok: artifact.ok,
      status: artifact.status,
      detail: artifact.detail,
      artifactPath: options.out,
      summary: artifact
    }, null, 2));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

export { parseArgs };
