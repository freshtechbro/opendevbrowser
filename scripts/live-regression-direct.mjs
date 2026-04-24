#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import {
  CANVAS_LIVE_TIMEOUTS_MS,
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

const DAEMON_RECOVERY_TIMEOUT_MS = 45_000;
const DAEMON_RECOVERY_POLL_MS = 1_000;
const EXTENSION_RECONNECT_GRACE_MS = 30_000;

function readDaemonStatus() {
  return runCli(["status", "--daemon"], {
    allowFailure: true,
    timeoutMs: 15_000
  });
}

function startDetachedDaemon() {
  const cliPath = path.join(ROOT, "dist", "cli", "index.js");
  const child = spawn(process.execPath, [cliPath, "serve", "--output-format", "json"], {
    cwd: ROOT,
    detached: true,
    stdio: "ignore"
  });
  child.unref();
}

export function isCurrentDaemonStatus(status) {
  return status?.status === 0 && status.json?.data?.fingerprintCurrent !== false;
}

export function daemonStatusDetail(status) {
  if (status?.status !== 0) {
    return status?.detail ?? "daemon_status_unavailable";
  }
  return status.json?.data?.fingerprintCurrent === false
    ? "daemon_fingerprint_mismatch"
    : null;
}

export function detailSuggestsDaemonLoss(detail) {
  return /daemon not running/i.test(String(detail ?? ""));
}

export function classifyInitialDaemonStep({
  initialDaemonOk,
  initialDaemonRecovered,
  releaseGate,
  detail
}) {
  return {
    status: initialDaemonOk && !(releaseGate && initialDaemonRecovered) ? "pass" : "fail",
    detail: initialDaemonOk
      ? (initialDaemonRecovered ? "daemon_recovered_before_run" : null)
      : detail
  };
}

export function classifyDaemonLossStep(step, releaseGate) {
  if (!releaseGate || !detailSuggestsDaemonLoss(step.detail)) {
    return step;
  }
  return {
    ...step,
    status: "fail",
    data: {
      ...(step.data ?? {}),
      releaseGateDaemonLoss: true
    }
  };
}

export function buildScenarioDaemonRecoveryStep(scenario, scenarioDaemonStatus) {
  if (scenarioDaemonStatus.currentStatus && !isCurrentDaemonStatus(scenarioDaemonStatus.currentStatus)) {
    return {
      id: scenario.id,
      status: "fail",
      detail: daemonStatusDetail(scenarioDaemonStatus.currentStatus),
      data: {
        currentDaemonStatus: scenarioDaemonStatus.currentStatus.status,
        recoveredBeforeScenario: scenarioDaemonStatus.recovered
      }
    };
  }
  if (!scenarioDaemonStatus.recovered) {
    return null;
  }
  return {
    id: scenario.id,
    status: "fail",
    detail: "daemon_recovered_before_scenario",
    data: {
      recoveredBeforeScenario: true,
      initialProbeDetail: scenarioDaemonStatus.initialStatus.detail ?? null
    }
  };
}

export async function recoverDaemonStatus({
  statusReader = readDaemonStatus,
  daemonStarter = startDetachedDaemon,
  recoverTimeoutMs = DAEMON_RECOVERY_TIMEOUT_MS,
  pollMs = DAEMON_RECOVERY_POLL_MS
} = {}) {
  let currentStatus = statusReader();
  if (currentStatus.status === 0) {
    return currentStatus;
  }

  daemonStarter();
  const deadline = Date.now() + recoverTimeoutMs;
  while (Date.now() < deadline) {
    await sleep(pollMs);
    currentStatus = statusReader();
    if (currentStatus.status === 0) {
      return currentStatus;
    }
  }

  return currentStatus;
}

export async function resolveInitialDaemonStatus({
  statusReader = readDaemonStatus,
  recoverStatus = recoverDaemonStatus
} = {}) {
  const initialStatus = statusReader();
  if (initialStatus.status === 0) {
    return {
      initialStatus,
      currentStatus: initialStatus,
      recovered: false
    };
  }

  const currentStatus = await recoverStatus({ statusReader });
  return {
    initialStatus,
    currentStatus,
    recovered: currentStatus.status === 0
  };
}

export async function waitForExtensionReconnect({
  scenario,
  initialExtensionReady,
  statusReader = readDaemonStatus,
  reconnectGraceMs = EXTENSION_RECONNECT_GRACE_MS,
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
    { id: "feature.canvas.managed_headless", script: "scripts/canvas-live-workflow.mjs", args: ["--surface", "managed-headless"], timeoutMs: CANVAS_LIVE_TIMEOUTS_MS.managedHeadless },
    { id: "feature.canvas.managed_headed", script: "scripts/canvas-live-workflow.mjs", args: ["--surface", "managed-headed"], timeoutMs: CANVAS_LIVE_TIMEOUTS_MS.managedHeaded },
    { id: "feature.canvas.extension", script: "scripts/canvas-live-workflow.mjs", args: ["--surface", "extension"], requiresExtension: true, timeoutMs: CANVAS_LIVE_TIMEOUTS_MS.extension },
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
    {
      id: "feature.canvas.cdp",
      script: "scripts/canvas-live-workflow.mjs",
      args: ["--surface", "cdp"],
      requiresExtension: true,
      timeoutMs: CANVAS_LIVE_TIMEOUTS_MS.cdp
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
  const currentDaemonOk = isCurrentDaemonStatus(currentDaemonStatus);
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

export function resolveChildStep(scenario, child) {
  const summary = child.json?.summary ?? null;
  const childOk = child.status === 0 && child.json?.ok !== false;
  const summaryStatus = summary?.status ?? child.json?.status ?? null;
  const childStatus = childOk ? (summaryStatus ?? "pass") : "fail";
  const artifactPath = child.json?.artifactPath ?? summary?.artifactPath ?? null;
  const detail = childOk
    ? (summary?.detail ?? child.json?.detail ?? (childStatus === "pass" ? null : child.detail))
    : (child.detail ?? summary?.detail ?? child.json?.detail ?? `child exited with status ${child.status}`);

  return {
    id: scenario.id,
    status: childStatus,
    detail,
    data: {
      artifactPath,
      childStatus: child.status,
      childOk,
      summaryStatus,
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

  const {
    initialStatus: initialDaemonProbe,
    currentStatus: initialDaemonStatus,
    recovered: initialDaemonRecovered
  } = await resolveInitialDaemonStatus();
  const initialRelay = initialDaemonStatus.json?.data?.relay ?? null;
  const initialDaemonOk = isCurrentDaemonStatus(initialDaemonStatus);
  const initialExtensionReady = initialRelay?.extensionHandshakeComplete === true;
  const initialDaemonStep = classifyInitialDaemonStep({
    initialDaemonOk,
    initialDaemonRecovered,
    releaseGate: options.releaseGate,
    detail: daemonStatusDetail(initialDaemonStatus)
  });
  pushStep(report, {
    id: "infra.daemon_status",
    status: initialDaemonStep.status,
    detail: initialDaemonStep.detail,
    data: {
      ...(initialDaemonStatus.json?.data ?? {}),
      recoveredBeforeRun: initialDaemonRecovered,
      initialProbeDetail: initialDaemonProbe.status === 0 ? null : initialDaemonProbe.detail
    }
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
      const scenarioDaemonStatus = await resolveInitialDaemonStatus();
      const recoveryStep = options.releaseGate
        ? buildScenarioDaemonRecoveryStep(scenario, scenarioDaemonStatus)
        : null;
      if (recoveryStep) {
        step = recoveryStep;
        pushStep(report, step, { prefix: "[live-direct]", logProgress: !options.quiet });
        continue;
      }
      const currentDaemonStatus = await waitForExtensionReconnect({
        scenario,
        initialExtensionReady,
        statusReader: () => scenarioDaemonStatus.currentStatus.status === 0
          ? readDaemonStatus()
          : scenarioDaemonStatus.currentStatus
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
      step = classifyDaemonLossStep(step, options.releaseGate);
      if (!options.releaseGate && detailSuggestsDaemonLoss(step.detail)) {
        const recoveredAfterFailure = await recoverDaemonStatus();
        const retryStatus = await waitForExtensionReconnect({
          scenario,
          initialExtensionReady
        });
        const retryPreflight = classifyScenarioPreflight({
          scenario,
          initialDaemonOk,
          initialExtensionReady,
          currentDaemonStatus: retryStatus
        });
        if (recoveredAfterFailure.status === 0 && !retryPreflight) {
          const retryChild = runNode(
            [
              scriptPath,
              ...buildChildArgs(scenario, options.releaseGate)
            ],
            {
              allowFailure: true,
              timeoutMs: scenario.timeoutMs ?? 900_000
            }
          );
          const retryStep = resolveChildStep(scenario, retryChild);
          step = {
            ...retryStep,
            data: {
              ...retryStep.data,
              recoveredDaemonAfterFailure: true
            }
          };
        }
      }
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
