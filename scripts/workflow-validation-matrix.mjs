#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { countStatuses, ensureCliBuilt, runCli, runNode, sleep } from "./live-direct-utils.mjs";
import {
  currentHarnessDaemonStatusDetail,
  isCurrentHarnessDaemonStatus,
  withConfiguredDaemon
} from "./skill-runtime-probe-utils.mjs";
import { MATRIX_ENV_LIMITED_CODES } from "./shared/workflow-lane-constants.mjs";
import { classifyLaneRecords, normalizedCodesFromFailures, parseShellOnlyFailureDetail } from "./shared/workflow-lane-verdicts.mjs";
import { VALIDATION_SCENARIOS } from "./shared/workflow-inventory.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KNOWN_SCENARIO_IDS = new Set(VALIDATION_SCENARIOS.map((scenario) => scenario.id));
const CLI_TIMEOUT_HEADROOM_MS = 15_000;

export function parseWorkflowValidationArgs(argv) {
  const options = {
    out: null,
    markdownOut: null,
    variant: "primary",
    scenarioIds: []
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--out") {
      options.out = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg?.startsWith("--out=")) {
      options.out = arg.split("=", 2)[1];
      continue;
    }
    if (arg === "--markdown-out") {
      options.markdownOut = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg?.startsWith("--markdown-out=")) {
      options.markdownOut = arg.split("=", 2)[1];
      continue;
    }
    if (arg === "--variant") {
      const value = argv[index + 1];
      if (value !== "primary" && value !== "secondary") {
        throw new Error("--variant requires primary or secondary.");
      }
      options.variant = value;
      index += 1;
      continue;
    }
    if (arg?.startsWith("--variant=")) {
      const value = arg.split("=", 2)[1];
      if (value !== "primary" && value !== "secondary") {
        throw new Error("--variant requires primary or secondary.");
      }
      options.variant = value;
      continue;
    }
    if (arg === "--scenario") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--scenario requires a value.");
      }
      options.scenarioIds.push(value);
      index += 1;
      continue;
    }
    if (arg?.startsWith("--scenario=")) {
      options.scenarioIds.push(arg.split("=", 2)[1]);
      continue;
    }
    if (arg === "--help") {
      console.log([
        "Usage: node scripts/workflow-validation-matrix.mjs [options]",
        "",
        "Options:",
        "  --variant <primary|secondary>  Choose the task variant to execute",
        "  --scenario <id>                Limit execution to one or more scenario ids",
        "  --out <path>                   Write the JSON matrix report",
        "  --markdown-out <path>          Write a Markdown execution ledger",
        "  --help                         Show help"
      ].join("\n"));
      process.exit(0);
    }
    throw new Error(`Unknown option: ${arg}`);
  }
  for (const scenarioId of options.scenarioIds) {
    if (!KNOWN_SCENARIO_IDS.has(scenarioId)) {
      throw new Error(`Unknown scenario id: ${scenarioId}`);
    }
  }
  return options;
}

function writeFile(targetPath, content) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content, "utf8");
}

function matchesScenarioSelection(scenario, scenarioIds) {
  return scenarioIds.length === 0 || scenarioIds.includes(scenario.id);
}

export function selectWorkflowValidationScenarios(options) {
  const selectedScenarios = VALIDATION_SCENARIOS.filter((scenario) => (
    scenario.executionPolicy === "automated"
    && matchesScenarioSelection(scenario, options.scenarioIds)
  ));
  if (selectedScenarios.length === 0) {
    throw new Error("No automated workflow validation scenarios matched the current selection.");
  }
  return selectedScenarios;
}

function resolveScenarioArgs(scenario, variant) {
  return variant === "secondary" ? scenario.secondaryArgs : scenario.primaryArgs;
}

function buildScenarioCommand(scenario, scenarioArgs) {
  return scenario.runner === "cli"
    ? `opendevbrowser ${scenarioArgs.join(" ")}`
    : `node ${scenarioArgs.join(" ")}`;
}

function matchesScenarioEnvLimitedDetail(detail, scenario) {
  if (typeof detail !== "string") {
    return false;
  }
  const matchers = Array.isArray(scenario.envLimitedDetailMatchers)
    ? scenario.envLimitedDetailMatchers
    : [];
  const normalized = detail.toLowerCase();
  return matchers.some((matcher) => typeof matcher === "string" && normalized.includes(matcher.toLowerCase()));
}

function readDaemonStatus(env = process.env) {
  return runCli(["status", "--daemon"], {
    env,
    allowFailure: true,
    timeoutMs: 15_000
  });
}

function hasDirtyRelayClients(relay) {
  return relay?.canvasConnected === true
    || relay?.annotationConnected === true
    || relay?.cdpConnected === true;
}

function collectScenarioFailures(result) {
  const candidates = [
    result.json?.summary?.failures,
    result.json?.data?.execution?.failures,
    result.json?.data?.meta?.failures,
    result.json?.data?.failures,
    result.json?.failures
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }
  return [];
}

function collectScenarioRecordCount(result) {
  const records = result.json?.data?.execution?.records;
  if (Array.isArray(records)) {
    return records.length;
  }
  const offers = result.json?.data?.offers;
  if (Array.isArray(offers)) {
    return offers.length;
  }
  const plainRecords = result.json?.data?.records;
  if (Array.isArray(plainRecords)) {
    return plainRecords.length;
  }
  return 0;
}

function readScenarioNextStep(result) {
  const candidates = [
    result.json?.data?.suggestedNextAction,
    result.json?.summary?.data?.suggestedNextAction,
    result.json?.data?.meta?.primaryConstraint?.guidance?.recommendedNextCommands?.[0]
  ];
  return candidates.find((value) => typeof value === "string" && value.trim().length > 0)?.trim() ?? null;
}

function withScenarioNextStep(detail, result) {
  const nextStep = readScenarioNextStep(result);
  if (!nextStep || typeof detail !== "string" || detail.toLowerCase().includes("next step:")) {
    return detail;
  }
  return `${detail} Next step: ${nextStep}`;
}

async function waitForRequiredExtension({
  scenario,
  initialExtensionReady,
  startedDaemon,
  relayWasDirty,
  env,
  reconnectGraceMs = 8_000,
  pollMs = 1_000
}) {
  let currentDaemonStatus = readDaemonStatus(env);
  const extensionReady = currentDaemonStatus.json?.data?.relay?.extensionHandshakeComplete === true;
  const daemonReady = isCurrentHarnessDaemonStatus(currentDaemonStatus);

  if (
    !scenario.requiresExtension
    || (!startedDaemon && relayWasDirty)
    || !initialExtensionReady
    || extensionReady
    || !daemonReady
  ) {
    return currentDaemonStatus;
  }

  const deadline = Date.now() + reconnectGraceMs;
  while (Date.now() < deadline) {
    await sleep(pollMs);
    currentDaemonStatus = readDaemonStatus(env);
    if (!isCurrentHarnessDaemonStatus(currentDaemonStatus)) {
      break;
    }
    if (currentDaemonStatus.json?.data?.relay?.extensionHandshakeComplete === true) {
      break;
    }
  }

  return currentDaemonStatus;
}

export function classifyScenarioPreflight({
  scenario,
  startedDaemon,
  relayWasDirty,
  initialDaemonOk,
  initialExtensionReady,
  currentDaemonStatus
}) {
  const relay = currentDaemonStatus.json?.data?.relay ?? null;
  const currentDaemonOk = isCurrentHarnessDaemonStatus(currentDaemonStatus);
  const currentExtensionReady = relay?.extensionHandshakeComplete === true;

  if (!scenario.requiresExtension) {
    return null;
  }

  if (!startedDaemon && relayWasDirty) {
    return {
      status: "env_limited",
      detail: "relay_busy_existing_clients",
      data: { relay }
    };
  }

  if (!currentDaemonOk) {
    const detail = currentHarnessDaemonStatusDetail(currentDaemonStatus);
    return {
      status: initialDaemonOk ? "fail" : "env_limited",
      detail: initialDaemonOk ? detail ?? "daemon_not_running_after_start" : detail ?? "daemon_not_running",
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

export function determineScenarioStatus(result, scenario) {
  const detail = result.json?.summary?.detail
    ?? result.json?.detail
    ?? result.json?.message
    ?? result.json?.error
    ?? result.detail
    ?? null;
  const explicitStatus = result.json?.summary?.status
    ?? result.json?.status
    ?? (result.json?.success === false ? "fail" : null);

  if (result.timedOut && scenario.allowedStatuses.includes("expected_timeout")) {
    return {
      status: "expected_timeout",
      detail,
      ok: true
    };
  }

  if (
    typeof detail === "string"
    && scenario.allowedStatuses.includes("env_limited")
    && matchesScenarioEnvLimitedDetail(detail, scenario)
  ) {
    return {
      status: "env_limited",
      detail,
      ok: true
    };
  }

  const shellOnly = parseShellOnlyFailureDetail(detail);
  if (shellOnly) {
    return {
      status: shellOnly.status,
      detail: shellOnly.detail,
      ok: scenario.allowedStatuses.includes(shellOnly.status)
    };
  }

  const failures = collectScenarioFailures(result);
  const reasonCodes = normalizedCodesFromFailures(failures);
  if (reasonCodes.length > 0) {
    const envLimitedCodes = new Set([
      ...MATRIX_ENV_LIMITED_CODES,
      ...(Array.isArray(scenario.envLimitedReasonCodes) ? scenario.envLimitedReasonCodes : [])
    ]);
    const laneStatus = classifyLaneRecords(collectScenarioRecordCount(result), failures, {
      envLimitedCodes
    });
    return {
      status: laneStatus.status,
      detail: withScenarioNextStep(laneStatus.detail ?? detail, result),
      ok: scenario.allowedStatuses.includes(laneStatus.status)
    };
  }

  if (typeof explicitStatus === "string" && explicitStatus.length > 0) {
    return {
      status: explicitStatus,
      detail,
      ok: scenario.allowedStatuses.includes(explicitStatus)
    };
  }

  const status = result.status === 0 ? "pass" : "fail";
  return {
    status,
    detail,
    ok: scenario.allowedStatuses.includes(status)
  };
}

function buildScenarioStepBase(scenario, variant, scenarioArgs) {
  return {
    id: scenario.id,
    label: scenario.label,
    entryPath: scenario.entryPath,
    executionPolicy: scenario.executionPolicy,
    runner: scenario.runner,
    allowedStatuses: scenario.allowedStatuses,
    ownerFiles: scenario.ownerFiles,
    variantTask: variant === "secondary" ? scenario.secondaryTask : scenario.primaryTask,
    command: buildScenarioCommand(scenario, scenarioArgs)
  };
}

function executeScenarioCommand(scenario, scenarioArgs, env) {
  const timeoutMs = resolveScenarioProcessTimeoutMs(scenario);
  return scenario.runner === "cli"
    ? runCli(scenarioArgs, { env, allowFailure: true, timeoutMs })
    : runNode(scenarioArgs, { env, allowFailure: true, timeoutMs });
}

export function resolveScenarioProcessTimeoutMs(scenario) {
  const baseTimeoutMs = scenario.timeoutMs;
  if (scenario.runner !== "cli" || typeof baseTimeoutMs !== "number") {
    return baseTimeoutMs;
  }
  return Math.max(baseTimeoutMs + CLI_TIMEOUT_HEADROOM_MS, 60_000);
}

function executeScenarioStep({ scenario, variant, env }) {
  const scenarioArgs = resolveScenarioArgs(scenario, variant);
  const step = buildScenarioStepBase(scenario, variant, scenarioArgs);
  try {
    const result = executeScenarioCommand(scenario, scenarioArgs, env);
    const outcome = determineScenarioStatus(result, scenario);
    return {
      ...step,
      status: outcome.status,
      ok: outcome.ok,
      detail: outcome.detail,
      artifactPath: result.json?.artifactPath ?? result.json?.summary?.artifactPath ?? null,
      data: result.json?.data ?? result.json?.summary ?? null
    };
  } catch (error) {
    return {
      ...step,
      status: "fail",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
      artifactPath: null,
      data: null
    };
  }
}

export async function runWorkflowValidationMatrix(options) {
  ensureCliBuilt();
  const selectedScenarios = selectWorkflowValidationScenarios(options);
  const isolatedScenarios = selectedScenarios.filter((scenario) => scenario.isolatedDaemonHarness === true);
  const sharedScenarios = selectedScenarios.filter((scenario) => scenario.isolatedDaemonHarness !== true);
  const inventoriedSurfaces = VALIDATION_SCENARIOS.filter((scenario) => (
    scenario.executionPolicy !== "automated"
    && matchesScenarioSelection(scenario, options.scenarioIds)
  )).map((scenario) => ({
    id: scenario.id,
    label: scenario.label,
    entryPath: scenario.entryPath,
    executionPolicy: scenario.executionPolicy,
    variantTask: options.variant === "secondary" ? scenario.secondaryTask : scenario.primaryTask,
    ownerFiles: scenario.ownerFiles,
    executionState: "inventoried_not_executed"
  }));

  const report = {
    schemaVersion: "2026-04-02",
    generatedAt: new Date().toISOString(),
    variant: options.variant,
    steps: [],
    infraSteps: [],
    inventoriedSurfaces
  };
  const stepResults = new Map();

  try {
    for (const scenario of isolatedScenarios) {
      stepResults.set(scenario.id, executeScenarioStep({
        scenario,
        variant: options.variant,
        env: process.env
      }));
    }

    if (sharedScenarios.length > 0) {
      await withConfiguredDaemon(async ({ env, startedDaemon }) => {
      const initialStatus = readDaemonStatus(env);
      const initialRelay = initialStatus.json?.data?.relay ?? null;
      const relayWasDirty = hasDirtyRelayClients(initialRelay);
      const initialDaemonOk = isCurrentHarnessDaemonStatus(initialStatus);
      const initialExtensionReady = initialRelay?.extensionHandshakeComplete === true;
      const daemonMode = startedDaemon ? "started" : "reused";
      const daemonDetail = startedDaemon
        ? "started configured daemon via owner helper"
        : relayWasDirty
          ? "reused configured daemon; dirty relay gates extension scenarios"
          : "reused configured daemon";

      report.infraSteps.push({
        id: "infra.daemon.recycle",
        status: initialDaemonOk ? "pass" : "fail",
        ok: initialDaemonOk,
        detail: initialDaemonOk ? daemonDetail : currentHarnessDaemonStatusDetail(initialStatus),
        data: {
          mode: daemonMode,
          relayWasDirty,
          previousRelay: initialRelay,
          startedDaemon
        }
      });

      report.infraSteps.push({
        id: "infra.daemon_status",
        status: initialDaemonOk ? "pass" : "fail",
        ok: initialDaemonOk,
        detail: currentHarnessDaemonStatusDetail(initialStatus),
        data: initialStatus.json?.data ?? null
      });

      if (!initialDaemonOk) {
        return;
      }

      for (const scenario of sharedScenarios) {
        const scenarioArgs = resolveScenarioArgs(scenario, options.variant);
        const step = buildScenarioStepBase(scenario, options.variant, scenarioArgs);

        try {
          const currentDaemonStatus = await waitForRequiredExtension({
            scenario,
            initialExtensionReady,
            startedDaemon,
            relayWasDirty,
            env
          });
          const preflight = classifyScenarioPreflight({
            scenario,
            startedDaemon,
            relayWasDirty,
            initialDaemonOk,
            initialExtensionReady,
            currentDaemonStatus
          });
          if (preflight) {
            stepResults.set(scenario.id, {
              ...step,
              status: preflight.status,
              ok: scenario.allowedStatuses.includes(preflight.status),
              detail: preflight.detail,
              artifactPath: null,
              data: preflight.data
            });
            continue;
          }

          const result = executeScenarioCommand(scenario, scenarioArgs, env);
          const outcome = determineScenarioStatus(result, scenario);
          stepResults.set(scenario.id, {
            ...step,
            status: outcome.status,
            ok: outcome.ok,
            detail: outcome.detail,
            artifactPath: result.json?.artifactPath ?? result.json?.summary?.artifactPath ?? null,
            data: result.json?.data ?? result.json?.summary ?? null
          });
        } catch (error) {
          stepResults.set(scenario.id, {
            ...step,
            status: "fail",
            ok: false,
            detail: error instanceof Error ? error.message : String(error),
            artifactPath: null,
            data: null
          });
        }
      }
      });
    }
  } catch (error) {
    if (report.infraSteps.length === 0) {
      report.infraSteps.push({
        id: "infra.daemon.recycle",
        status: "fail",
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
        data: null
      });
    }
  }

  report.steps = selectedScenarios
    .map((scenario) => stepResults.get(scenario.id))
    .filter((step) => step);

  report.counts = countStatuses(report.steps);
  report.executedScenarioCount = report.steps.length;
  report.inventoriedOnlyCount = report.inventoriedSurfaces.length;
  report.infraStepCount = report.infraSteps.length;
  report.executionPolicyCounts = {
    automated: VALIDATION_SCENARIOS.filter((scenario) => (
      scenario.executionPolicy === "automated"
      && matchesScenarioSelection(scenario, options.scenarioIds)
    )).length,
    guarded: report.inventoriedSurfaces.filter((scenario) => scenario.executionPolicy === "guarded").length,
    non_cli: report.inventoriedSurfaces.filter((scenario) => scenario.executionPolicy === "non_cli").length
  };
  report.ok = report.infraSteps.every((step) => step.status === "pass")
    && report.steps.every((step) => step.ok);
  return report;
}

export function renderWorkflowExecutionInventoryMarkdown(report) {
  const counts = report.counts ?? countStatuses(report.steps ?? []);
  const infraSteps = Array.isArray(report.infraSteps) ? report.infraSteps : [];
  const steps = Array.isArray(report.steps) ? report.steps : [];
  const inventoriedSurfaces = Array.isArray(report.inventoriedSurfaces) ? report.inventoriedSurfaces : [];
  const executionPolicyCounts = report.executionPolicyCounts ?? {};
  const escapeCell = (value) => String(value ?? "").replaceAll("|", "\\|");

  return [
    "# Workflow Execution Inventory",
    "",
    `Variant: ${report.variant}`,
    `Generated: ${report.generatedAt}`,
    `Automated executed: ${report.executedScenarioCount ?? steps.length}`,
    `Inventoried only: ${report.inventoriedOnlyCount ?? inventoriedSurfaces.length}`,
    `Infra steps: ${report.infraStepCount ?? infraSteps.length}`,
    "",
    "## Status summary",
    "",
    ...Object.entries(counts).map(([status, count]) => `- ${status}: ${count}`),
    ...(Object.keys(executionPolicyCounts).length > 0
      ? [
          "",
          "## Inventory split",
          "",
          ...Object.entries(executionPolicyCounts).map(([policy, count]) => `- ${policy}: ${count}`)
        ]
      : []),
    "",
    "## Infra preflight",
    "",
    "| ID | Status | Detail |",
    "| --- | --- | --- |",
    ...infraSteps.map((step) => `| \`${step.id}\` | \`${step.status}\` | ${step.detail ?? ""} |`),
    ...(infraSteps.length === 0 ? ["| _None_ |  |  |"] : []),
    "",
    "## Executed automated scenarios",
    "",
    "| ID | Command | Task | Status | Detail | Artifact | Owners |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...steps.map((step) => `| \`${step.id}\` | \`${escapeCell(step.command)}\` | ${escapeCell(step.variantTask)} | \`${step.status}\` | ${escapeCell(step.detail)} | ${escapeCell(step.artifactPath)} | ${escapeCell(Array.isArray(step.ownerFiles) ? step.ownerFiles.join(", ") : "")} |`),
    ...(steps.length === 0 ? ["| _None_ |  |  |  |  |  |  |"] : []),
    "",
    "## Inventoried but not executed",
    "",
    "| ID | Entry | Policy | Task | State |",
    "| --- | --- | --- | --- | --- |",
    ...inventoriedSurfaces.map((step) => `| \`${step.id}\` | \`${step.entryPath}\` | \`${step.executionPolicy}\` | ${step.variantTask} | \`${step.executionState}\` |`),
    ...(inventoriedSurfaces.length === 0 ? ["| _None_ |  |  |  |  |"] : [])
  ].join("\n");
}

export async function main(options = parseWorkflowValidationArgs(process.argv.slice(2))) {
  const report = await runWorkflowValidationMatrix(options);
  if (options.out) {
    writeFile(path.resolve(ROOT, options.out), `${JSON.stringify(report, null, 2)}\n`);
  }
  if (options.markdownOut) {
    writeFile(path.resolve(ROOT, options.markdownOut), `${renderWorkflowExecutionInventoryMarkdown(report)}\n`);
  }
  process.stdout.write(JSON.stringify({
    ok: report.ok,
    counts: report.counts,
    executedScenarioCount: report.executedScenarioCount,
    inventoriedOnlyCount: report.inventoriedOnlyCount,
    infraStepCount: report.infraStepCount,
    out: options.out ? path.resolve(ROOT, options.out) : null,
    markdownOut: options.markdownOut ? path.resolve(ROOT, options.markdownOut) : null
  }, null, 2));
  process.stdout.write("\n");
  if (!report.ok) {
    process.exitCode = 1;
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
