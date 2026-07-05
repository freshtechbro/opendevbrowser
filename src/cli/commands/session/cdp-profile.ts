import type { ParsedArgs } from "../../args";
import { findUnsafeExplicitCdpProfileFlag } from "../../../browser/explicit-cdp-profile-flags";
import { callDaemon } from "../../client";
import { createUsageError } from "../../errors";
import { parseNumberFlag, readInlineFlagValue } from "../../utils/parse";

type CdpProfileAction = "start" | "status" | "stop";

type CdpProfileArgs = {
  action: CdpProfileAction;
  profile?: string;
  port?: number;
  startUrl?: string;
  chromePath?: string;
  flags: string[];
};

const CDP_PROFILE_CALL_TIMEOUT_MS = 30_000;

function addCdpProfileFlag(parsed: CdpProfileArgs, flag: string): void {
  const unsafeFlag = findUnsafeExplicitCdpProfileFlag([flag]);
  if (unsafeFlag) {
    throw createUsageError(`Unsafe cdp-profile --flag ${unsafeFlag}; OpenDevBrowser manages profile and CDP endpoint flags.`);
  }
  parsed.flags.push(flag);
}

function parseCdpProfileArgs(rawArgs: string[]): CdpProfileArgs {
  const action = parseCdpProfileAction(rawArgs[0]);
  const parsed: CdpProfileArgs = { action, flags: [] };
  for (let index = 1; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--profile") {
      const value = rawArgs[index + 1];
      if (!value) throw createUsageError("Missing value for --profile");
      parsed.profile = value;
      index += 1;
      continue;
    }
    if (arg?.startsWith("--profile=")) {
      const value = readInlineFlagValue(arg, "--profile");
      if (!value) throw createUsageError("Missing value for --profile");
      parsed.profile = value;
      continue;
    }
    if (arg === "--cdp-port") {
      const value = rawArgs[index + 1];
      if (!value) throw createUsageError("Missing value for --cdp-port");
      parsed.port = parseNumberFlag(value, "--cdp-port", { min: 1, max: 65535 });
      index += 1;
      continue;
    }
    if (arg?.startsWith("--cdp-port=")) {
      const value = readInlineFlagValue(arg, "--cdp-port");
      if (!value) throw createUsageError("Missing value for --cdp-port");
      parsed.port = parseNumberFlag(value, "--cdp-port", { min: 1, max: 65535 });
      continue;
    }
    if (arg === "--start-url") {
      const value = rawArgs[index + 1];
      if (!value) throw createUsageError("Missing value for --start-url");
      parsed.startUrl = value;
      index += 1;
      continue;
    }
    if (arg?.startsWith("--start-url=")) {
      const value = readInlineFlagValue(arg, "--start-url");
      if (!value) throw createUsageError("Missing value for --start-url");
      parsed.startUrl = value;
      continue;
    }
    if (arg === "--chrome-path") {
      const value = rawArgs[index + 1];
      if (!value) throw createUsageError("Missing value for --chrome-path");
      parsed.chromePath = value;
      index += 1;
      continue;
    }
    if (arg?.startsWith("--chrome-path=")) {
      const value = readInlineFlagValue(arg, "--chrome-path");
      if (!value) throw createUsageError("Missing value for --chrome-path");
      parsed.chromePath = value;
      continue;
    }
    if (arg === "--flag") {
      const value = rawArgs[index + 1];
      if (!value) throw createUsageError("Missing value for --flag");
      addCdpProfileFlag(parsed, value);
      index += 1;
      continue;
    }
    if (arg?.startsWith("--flag=")) {
      const value = readInlineFlagValue(arg, "--flag");
      if (!value) throw createUsageError("Missing value for --flag");
      addCdpProfileFlag(parsed, value);
      continue;
    }
  }
  if (!parsed.profile) {
    throw createUsageError("Missing required --profile for cdp-profile.");
  }
  if (parsed.profile.trim().toLowerCase() === "default") {
    throw createUsageError("cdp-profile requires a named non-default OpenDevBrowser profile.");
  }
  if (action !== "start" && parsed.flags.length > 0) {
    throw createUsageError("--flag is only supported by cdp-profile start.");
  }
  if (action !== "start" && (parsed.port || parsed.startUrl || parsed.chromePath)) {
    throw createUsageError("--cdp-port, --start-url, and --chrome-path are only supported by cdp-profile start.");
  }
  return parsed;
}

function parseCdpProfileAction(value: string | undefined): CdpProfileAction {
  if (value === "start" || value === "status" || value === "stop") {
    return value;
  }
  throw createUsageError("Usage: cdp-profile <start|status|stop> --profile <name>");
}

export const __test__ = { parseCdpProfileArgs };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeCdpProfileResult(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    return {};
  }
  const { wsEndpoint: _wsEndpoint, ...safeResult } = value;
  return safeResult;
}

export async function runCdpProfile(args: ParsedArgs) {
  const parsed = parseCdpProfileArgs(args.rawArgs);
  const result = await callDaemon(`session.cdpProfile.${parsed.action}`, parsed, {
    timeoutMs: CDP_PROFILE_CALL_TIMEOUT_MS
  });
  return {
    success: true,
    message: `CDP profile ${parsed.action}: ${parsed.profile}`,
    data: sanitizeCdpProfileResult(result)
  };
}
