#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CLI = path.join(ROOT, "dist", "cli", "index.js");
export const MAX_BUFFER = 64 * 1024 * 1024;
export const DEFAULT_CLI_TIMEOUT_MS = 120_000;
export const DEFAULT_NODE_TIMEOUT_MS = 900_000;

export const ENV_LIMITED_CODES = new Set([
  "unavailable",
  "env_limited",
  "auth",
  "rate_limited",
  "upstream",
  "network",
  "token_required",
  "challenge_detected",
  "cooldown_active",
  "policy_blocked",
  "caption_missing",
  "transcript_unavailable",
  "strategy_unapproved"
]);

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

export function defaultArtifactPath(prefix) {
  return `/tmp/${prefix}-${Date.now()}.json`;
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

export function normalizedCodesFromFailures(failures) {
  if (!Array.isArray(failures)) return [];
  return failures
    .map((entry) => entry?.error?.reasonCode || entry?.error?.code)
    .filter((value) => typeof value === "string");
}

export function summarizeFailures(failures, limit = 3) {
  if (!Array.isArray(failures)) return [];
  return failures.slice(0, limit).map((entry) => {
    const error = entry?.error ?? {};
    return {
      provider: typeof entry?.provider === "string" ? entry.provider : null,
      code: typeof error.code === "string" ? error.code : null,
      reasonCode: typeof error.reasonCode === "string" ? error.reasonCode : null,
      message: typeof error.message === "string" ? error.message.slice(0, 220) : null
    };
  });
}

export function classifyRecords(recordsCount, failures, {
  allowExpectedUnavailable = false,
  allowNoRecordsNoFailures = false
} = {}) {
  if (recordsCount > 0) {
    return { status: "pass", detail: null };
  }

  const normalizedFailures = Array.isArray(failures) ? failures : [];
  const reasonCodes = normalizedCodesFromFailures(normalizedFailures);
  if (reasonCodes.length > 0 && reasonCodes.every((code) => ENV_LIMITED_CODES.has(code))) {
    return {
      status: "env_limited",
      detail: `reason_codes=${reasonCodes.join(",")}`
    };
  }

  if (allowExpectedUnavailable && normalizedFailures.length > 0) {
    return {
      status: "env_limited",
      detail: "expected_unavailable_by_surface"
    };
  }

  if (allowNoRecordsNoFailures && normalizedFailures.length === 0) {
    return {
      status: "env_limited",
      detail: "no_records_no_failures"
    };
  }

  return {
    status: "fail",
    detail: normalizedFailures.length > 0
      ? `unexpected_reason_codes=${reasonCodes.join(",") || "none"}`
      : "no_records_no_failures"
  };
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
