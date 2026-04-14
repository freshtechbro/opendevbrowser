#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DIRECT_ENV_LIMITED_CODES } from "./shared/workflow-lane-constants.mjs";
import {
  classifyLaneRecords,
  normalizedCodesFromFailures,
  summarizeFailures
} from "./shared/workflow-lane-verdicts.mjs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CLI = path.join(ROOT, "dist", "cli", "index.js");
export const MAX_BUFFER = 64 * 1024 * 1024;
export const DEFAULT_CLI_TIMEOUT_MS = 120_000;
export const DEFAULT_NODE_TIMEOUT_MS = 900_000;
export const INSTALL_AUTOSTART_SKIP_ENV_VAR = "OPDEVBROWSER_SKIP_INSTALL_AUTOSTART_RECONCILIATION";
export const CANVAS_LIVE_TIMEOUTS_MS = Object.freeze({
  managedHeadless: 300_000,
  managedHeaded: 300_000,
  extension: 240_000,
  cdp: 360_000
});
export const CANVAS_CDP_LONG_STEP_TIMEOUT_MS = 45_000;
export const CANVAS_CDP_CODE_SYNC_STEP_TIMEOUT_MS = 120_000;
export const CANVAS_CDP_TEARDOWN_RESERVE_MS = 5_000;
export const CANVAS_CDP_PARENT_WATCHDOG_MS = CANVAS_LIVE_TIMEOUTS_MS.cdp;

export const ENV_LIMITED_CODES = DIRECT_ENV_LIMITED_CODES;

export function ensureCliBuilt() {
  if (!fs.existsSync(CLI)) {
    throw new Error(`CLI not found at ${CLI}. Run npm run build first.`);
  }
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseJsonFromStdout(stdout) {
  const text = String(stdout ?? "").trim();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    // Fall through to progressively narrower parsing.
  }

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line.startsWith("{") && !line.startsWith("[")) {
      continue;
    }
    try {
      return JSON.parse(lines.slice(index).join("\n"));
    } catch {
      continue;
    }
  }

  for (const line of lines.reverse()) {
    try {
      return JSON.parse(line);
    } catch {
      continue;
    }
  }
  return null;
}

export function summarizeFailure(result) {
  const fromJson = result?.json?.error ?? result?.json?.message;
  return typeof fromJson === "string" && fromJson.length > 0
    ? fromJson
    : result?.stderr || result?.stdout || result?.error || "Unknown failure";
}

function appendOutput(buffer, chunk) {
  const next = buffer + String(chunk ?? "");
  if (next.length <= MAX_BUFFER) {
    return next;
  }
  return next.slice(-MAX_BUFFER);
}

async function runProcessAsync(command, args, {
  allowFailure = false,
  cwd = ROOT,
  env = process.env,
  timeoutLabel,
  timeoutMs
}) {
  const start = Date.now();
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  let timedOut = false;

  const result = await new Promise((resolve) => {
    let settled = false;
    let killTimer = null;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
      }, 1_000);
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdout = appendOutput(stdout, chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr = appendOutput(stderr, chunk);
    });
    child.once("error", (error) => {
      clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
      finish({
        status: 1,
        signal: child.signalCode ?? null,
        error: String(error)
      });
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
      finish({
        status: code ?? (signal ? 1 : 0),
        signal: signal ?? null
      });
    });
  });

  const payload = {
    status: result.status,
    stdout,
    stderr,
    json: parseJsonFromStdout(stdout),
    durationMs: Date.now() - start,
    signal: result.signal,
    timedOut,
    ...(result.error ? { error: result.error } : {})
  };
  payload.detail = timedOut
    ? `${timeoutLabel} timed out after ${timeoutMs}ms (${args.join(" ")}).`
    : summarizeFailure(payload);

  if (!allowFailure && payload.status !== 0) {
    throw new Error(`${timeoutLabel} failed (${args.join(" ")}): ${payload.detail}`);
  }
  return payload;
}

export function runCli(args, {
  allowFailure = false,
  env = process.env,
  timeoutMs = DEFAULT_CLI_TIMEOUT_MS
} = {}) {
  const start = Date.now();
  const result = spawnSync(process.execPath, [CLI, ...args, "--output-format", "json"], {
    cwd: ROOT,
    encoding: "utf-8",
    timeout: timeoutMs,
    maxBuffer: MAX_BUFFER,
    env
  });
  const status = result.status ?? (result.signal ? 1 : 0);
  const timedOut = result.error?.code === "ETIMEDOUT";
  const payload = {
    status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    json: parseJsonFromStdout(result.stdout ?? ""),
    durationMs: Date.now() - start,
    signal: result.signal ?? null,
    timedOut,
    ...(result.error ? { error: String(result.error) } : {})
  };
  payload.detail = timedOut
    ? `CLI timed out after ${timeoutMs}ms (${args.join(" ")}).`
    : summarizeFailure(payload);

  if (!allowFailure && payload.status !== 0) {
    throw new Error(`CLI failed (${args.join(" ")}): ${payload.detail}`);
  }
  return payload;
}

export function runNode(args, {
  allowFailure = false,
  env = process.env,
  timeoutMs = DEFAULT_NODE_TIMEOUT_MS
} = {}) {
  const start = Date.now();
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: "utf-8",
    timeout: timeoutMs,
    maxBuffer: MAX_BUFFER,
    env
  });
  const status = result.status ?? (result.signal ? 1 : 0);
  const timedOut = result.error?.code === "ETIMEDOUT";
  const payload = {
    status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    json: parseJsonFromStdout(result.stdout ?? ""),
    durationMs: Date.now() - start,
    signal: result.signal ?? null,
    timedOut,
    ...(result.error ? { error: String(result.error) } : {})
  };
  payload.detail = timedOut
    ? `Node script timed out after ${timeoutMs}ms (${args.join(" ")}).`
    : summarizeFailure(payload);

  if (!allowFailure && payload.status !== 0) {
    throw new Error(`Node script failed (${args.join(" ")}): ${payload.detail}`);
  }
  return payload;
}

export function runCliAsync(args, {
  allowFailure = false,
  env = process.env,
  timeoutMs = DEFAULT_CLI_TIMEOUT_MS
} = {}) {
  return runProcessAsync(process.execPath, [CLI, ...args, "--output-format", "json"], {
    allowFailure,
    env,
    timeoutLabel: "CLI",
    timeoutMs
  });
}

export function runNodeAsync(args, {
  allowFailure = false,
  env = process.env,
  timeoutMs = DEFAULT_NODE_TIMEOUT_MS
} = {}) {
  return runProcessAsync(process.execPath, args, {
    allowFailure,
    env,
    timeoutLabel: "Node script",
    timeoutMs
  });
}

export function defaultArtifactPath(prefix) {
  return `/tmp/${prefix}-${Date.now()}.json`;
}

export function readCliFlagValue(args, flag) {
  if (!Array.isArray(args)) return null;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === flag) {
      const next = args[index + 1];
      return typeof next === "string" && !next.startsWith("--") ? next : null;
    }
    if (typeof arg === "string" && arg.startsWith(`${flag}=`)) {
      return arg.slice(flag.length + 1) || null;
    }
  }
  return null;
}

export function writeJson(targetPath, value) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function countStatuses(steps) {
  const counts = {
    pass: 0,
    expected_timeout: 0,
    env_limited: 0,
    fail: 0,
    skipped: 0
  };
  for (const step of Array.isArray(steps) ? steps : []) {
    const status = step?.status;
    if (
      status === "pass"
      || status === "expected_timeout"
      || status === "env_limited"
      || status === "fail"
      || status === "skipped"
    ) {
      counts[status] += 1;
    }
  }
  return counts;
}

export function finalizeReport(report, { strictGate = false } = {}) {
  report.counts = countStatuses(report.steps);
  report.finishedAt = new Date().toISOString();
  report.ok = strictGate
    ? report.counts.fail === 0 && report.counts.env_limited === 0 && report.counts.expected_timeout === 0
    : report.counts.fail === 0;
  return report;
}

export { normalizedCodesFromFailures, summarizeFailures };

export function classifyRecords(recordsCount, failures, {
  allowExpectedUnavailable = false,
  allowNoRecordsNoFailures = false
} = {}) {
  return classifyLaneRecords(recordsCount, failures, {
    envLimitedCodes: DIRECT_ENV_LIMITED_CODES,
    allowExpectedUnavailable,
    allowNoRecordsNoFailures
  });
}

export function pushStep(report, step, {
  prefix = "",
  logProgress = true
} = {}) {
  report.steps.push(step);
  if (!logProgress) {
    return;
  }
  const detail = typeof step.detail === "string" && step.detail.length > 0
    ? ` (${step.detail})`
    : "";
  const name = prefix ? `${prefix} ${step.id}` : step.id;
  console.error(`${name} -> ${step.status}${detail}`);
}
