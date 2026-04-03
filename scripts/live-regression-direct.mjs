#!/usr/bin/env node
import path from "node:path";
import {
  defaultArtifactPath,
  ensureCliBuilt,
  finalizeReport,
  pushStep,
  ROOT,
  runCli,
  runNode,
  sleep,
  writeJson
} from "./live-direct-utils.mjs";

function readDaemonStatus() {
  return runCli(["status", "--daemon"], {
    allowFailure: true,
    timeoutMs: 15_000
  });
}

export async function waitForExtensionReconnect({
  scenario,
  initialExtensionReady,
  statusReader = readDaemonStatus,
  reconnectGraceMs = 8_000,
  pollMs = 1_000
}) {
  let currentDaemonStatus = statusReader();
  const relay = currentDaemonStatus.json?.data?.relay ?? null;
  const extensionReady = relay?.extensionHandshakeComplete === true;

  if (!scenario.requiresExtension || !initialExtensionReady || extensionReady) {
    return currentDaemonStatus;
  }

  const deadline = Date.now() + reconnectGraceMs;
  while (Date.now() < deadline) {
    await sleep(pollMs);
    currentDaemonStatus = statusReader();
    if (
      currentDaemonStatus.status === 0
      && currentDaemonStatus.json?.data?.relay?.extensionHandshakeComplete === true
    ) {
      break;
    }
  }

  return currentDaemonStatus;
}

export function parseCliOptions(argv) {
  const options = {
    out: null,
    releaseGate: false,
    quiet: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--release-gate") {
      options.releaseGate = true;
      continue;
    }
    if (arg === "--quiet") {
      options.quiet = true;
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
    if (arg === "--help") {
      console.log([
        "Usage: node scripts/live-regression-direct.mjs [options]",
        "",
        "Options:",
        "  --out <path>       Output JSON path (default: /tmp/odb-live-regression-direct-<ts>.json)",
        "  --release-gate     Fail on any non-pass scenario",
        "  --quiet            Suppress per-step progress logging",
        "  --help             Show help"
      ].join("\n"));
      process.exit(0);
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  return {
    ...options,
    out: options.out ?? defaultArtifactPath("odb-live-regression-direct")
  };
}

export function buildScenarioCases() {
  return [
    { id: "feature.canvas.managed_headless", script: "scripts/canvas-live-workflow.mjs", args: ["--surface", "managed-headless"], timeoutMs: 300_000 },
    { id: "feature.canvas.managed_headed", script: "scripts/canvas-live-workflow.mjs", args: ["--surface", "managed-headed"], timeoutMs: 300_000 },
    { id: "feature.canvas.extension", script: "scripts/canvas-live-workflow.mjs", args: ["--surface", "extension"], requiresExtension: true, timeoutMs: 240_000 },
    {
      id: "feature.canvas.cdp",
      script: "scripts/canvas-live-workflow.mjs",
      args: ["--surface", "cdp"],
      requiresExtension: true,
      timeoutMs: 300_000
    },
    {
      id: "feature.annotate.relay",
      script: "scripts/annotate-live-probe.mjs",
      args: ["--transport", "relay"],
      requiresExtension: true,
      supportsReleaseGate: true,
      timeoutMs: 180_000
    },
    {
      id: "feature.annotate.direct",
      script: "scripts/annotate-live-probe.mjs",
      args: ["--transport", "direct"],
      supportsReleaseGate: true,
      timeoutMs: 180_000
    },
    { id: "feature.cli.smoke", script: "scripts/cli-smoke-test.mjs", timeoutMs: 240_000 }
  ];
}

export function buildChildArgs(scenario, releaseGate) {
  return [
    ...(scenario.args ?? []),
    ...(releaseGate && scenario.supportsReleaseGate ? ["--release-gate"] : [])
  ];
}

export function classifyScenarioPreflight({
  scenario,
  initialDaemonOk,
  initialExtensionReady,
  currentDaemonStatus
}) {
  const relay = currentDaemonStatus.json?.data?.relay ?? null;
  const currentDaemonOk = currentDaemonStatus.status === 0;
  const currentExtensionReady = relay?.extensionHandshakeComplete === true;

  if (!scenario.requiresExtension) {
    return null;
  }

  if (!currentDaemonOk) {
    return {
      status: initialDaemonOk ? "fail" : "env_limited",
      detail: initialDaemonOk ? "daemon_not_running_after_start" : "daemon_not_running",
      data: { relay: null }
    };
  }

  if (!currentExtensionReady) {
    return {
      status: initialExtensionReady ? "fail" : "env_limited",
      detail: initialExtensionReady ? "extension_disconnected_after_start" : "extension_disconnected",
      data: { relay }
    };
  }

  return null;
}

function resolveChildStep(scenario, child) {
  const summary = child.json?.summary ?? null;
  const childStatus = summary?.status
    ?? child.json?.status
    ?? (child.status === 0 && child.json?.ok !== false ? "pass" : "fail");
  const artifactPath = child.json?.artifactPath ?? summary?.artifactPath ?? null;
  const detail = summary?.detail ?? child.json?.detail ?? (childStatus === "pass" ? null : child.detail);

  return {
    id: scenario.id,
    status: childStatus,
    detail,
    data: {
      artifactPath,
      childStatus: child.status,
      childOk: child.status === 0 && child.json?.ok !== false,
      summaryStatus: summary?.status ?? child.json?.status ?? null,
      stepCount: Array.isArray(summary?.steps) ? summary.steps.length : null
    }
  };
}

async function main() {
  const options = parseCliOptions(process.argv.slice(2));
  ensureCliBuilt();

  const report = {
    startedAt: new Date().toISOString(),
    out: options.out,
    releaseGate: options.releaseGate,
    steps: []
  };

  const initialDaemonStatus = readDaemonStatus();
  const initialRelay = initialDaemonStatus.json?.data?.relay ?? null;
  const initialDaemonOk = initialDaemonStatus.status === 0;
  const initialExtensionReady = initialRelay?.extensionHandshakeComplete === true;
  pushStep(report, {
    id: "infra.daemon_status",
    status: initialDaemonOk ? "pass" : "fail",
    detail: initialDaemonOk ? null : initialDaemonStatus.detail,
    data: initialDaemonStatus.json?.data ?? null
  }, { prefix: "[live-direct]", logProgress: !options.quiet });
  if (!initialDaemonOk) {
    finalizeReport(report, { strictGate: options.releaseGate });
    writeJson(options.out, report);
    console.log(options.out);
    console.log(JSON.stringify({
      ok: report.ok,
      counts: report.counts,
      out: options.out
    }, null, 2));
    process.exitCode = 1;
    return;
  }

  for (const scenario of buildScenarioCases()) {
    const scriptPath = path.join(ROOT, scenario.script);
    let step;
    try {
      const currentDaemonStatus = await waitForExtensionReconnect({
        scenario,
        initialExtensionReady
      });
      const preflightStep = classifyScenarioPreflight({
        scenario,
        initialDaemonOk,
        initialExtensionReady,
        currentDaemonStatus
      });
      if (preflightStep) {
        step = {
          id: scenario.id,
          status: preflightStep.status,
          detail: preflightStep.detail,
          data: {
            requiresExtension: true,
            relay: preflightStep.data.relay
          }
        };
        pushStep(report, step, { prefix: "[live-direct]", logProgress: !options.quiet });
        continue;
      }

      if (!options.quiet) {
        console.error(`[live-direct] starting ${scenario.id}`);
      }
      const child = runNode(
        [
          scriptPath,
          ...buildChildArgs(scenario, options.releaseGate)
        ],
        {
          allowFailure: true,
          timeoutMs: scenario.timeoutMs ?? 900_000
        }
      );
      step = resolveChildStep(scenario, child);
    } catch (error) {
      step = {
        id: scenario.id,
        status: "fail",
        detail: error instanceof Error ? error.message : String(error)
      };
    }
    pushStep(report, step, { prefix: "[live-direct]", logProgress: !options.quiet });
  }

  finalizeReport(report, { strictGate: options.releaseGate });
  writeJson(options.out, report);
  console.log(options.out);
  console.log(JSON.stringify({
    ok: report.ok,
    counts: report.counts,
    out: options.out
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
