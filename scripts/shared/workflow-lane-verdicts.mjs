import { ENV_LIMITED_SHELL_ONLY_REASONS } from "./workflow-lane-constants.mjs";

export function normalizedCodesFromFailures(failures) {
  if (!Array.isArray(failures)) return [];
  return failures
    .map((entry) => entry?.error?.reasonCode || entry?.error?.code)
    .filter((value) => typeof value === "string");
}

function failureMessages(failures) {
  if (!Array.isArray(failures)) return [];
  return failures
    .map((entry) => entry?.error?.message)
    .filter((value) => typeof value === "string")
    .map((value) => value.toLowerCase());
}

function normalizeShellOnlyReasons(shellOnlyReasons) {
  if (!Array.isArray(shellOnlyReasons)) return [];
  return shellOnlyReasons
    .map((entry) => typeof entry === "string" ? entry.trim() : "")
    .filter(Boolean);
}

export function classifyShellOnlyReasons(
  shellOnlyReasons,
  {
    envLimitedReasons = ENV_LIMITED_SHELL_ONLY_REASONS
  } = {}
) {
  const normalizedReasons = normalizeShellOnlyReasons(shellOnlyReasons);
  if (normalizedReasons.length === 0) {
    return null;
  }
  return {
    status: normalizedReasons.every((reason) => envLimitedReasons.has(reason)) ? "env_limited" : "fail",
    detail: `shell_only_records=${normalizedReasons.join(",")}`,
    shellOnlyReasons: normalizedReasons
  };
}

export function parseShellOnlyFailureDetail(detail, options) {
  const match = /(?:^|:\s*)Macro execution returned only shell records \(([^)]+)\)\.?$/i.exec(String(detail ?? "").trim());
  if (!match) {
    return null;
  }
  return classifyShellOnlyReasons(match[1].split(","), options);
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

export function classifyLaneRecords(
  recordsCount,
  failures,
  {
    envLimitedCodes,
    allowExpectedUnavailable = false,
    allowNoRecordsNoFailures = false,
    expectedUnavailableDetail = "expected_unavailable_by_surface",
    expectedUnavailableMessageDetails = []
  } = {}
) {
  if (recordsCount > 0) {
    return { status: "pass", detail: null };
  }

  const normalizedFailures = Array.isArray(failures) ? failures : [];
  const reasonCodes = normalizedCodesFromFailures(normalizedFailures);
  if (
    reasonCodes.length > 0
    && envLimitedCodes instanceof Set
    && reasonCodes.every((code) => envLimitedCodes.has(code))
  ) {
    return {
      status: "env_limited",
      detail: `reason_codes=${reasonCodes.join(",")}`
    };
  }

  if (allowExpectedUnavailable && normalizedFailures.length > 0) {
    const messages = failureMessages(normalizedFailures);
    for (const matcher of expectedUnavailableMessageDetails) {
      if (
        typeof matcher?.includes === "string"
        && typeof matcher?.detail === "string"
        && messages.some((message) => message.includes(matcher.includes.toLowerCase()))
      ) {
        return {
          status: "env_limited",
          detail: matcher.detail
        };
      }
    }
    return {
      status: "env_limited",
      detail: expectedUnavailableDetail
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
