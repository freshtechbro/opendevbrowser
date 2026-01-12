import type { ParsedArgs } from "../../args";
import { callDaemon } from "../../client";
import { createUsageError } from "../../errors";

type LaunchArgs = {
  profile?: string;
  headless?: boolean;
  startUrl?: string;
  chromePath?: string;
  flags: string[];
  persistProfile?: boolean;
  noExtension?: boolean;
  extensionOnly?: boolean;
  waitForExtension?: boolean;
  waitTimeoutMs?: number;
};

function parseLaunchArgs(rawArgs: string[]): LaunchArgs {
  const parsed: LaunchArgs = { flags: [] };
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (arg === "--headless") {
      parsed.headless = true;
      continue;
    }
    if (arg === "--profile") {
      const value = rawArgs[i + 1];
      if (!value) throw createUsageError("Missing value for --profile");
      parsed.profile = value;
      i += 1;
      continue;
    }
    if (arg?.startsWith("--profile=")) {
      parsed.profile = arg.split("=", 2)[1];
      continue;
    }
    if (arg === "--start-url") {
      const value = rawArgs[i + 1];
      if (!value) throw createUsageError("Missing value for --start-url");
      parsed.startUrl = value;
      i += 1;
      continue;
    }
    if (arg?.startsWith("--start-url=")) {
      parsed.startUrl = arg.split("=", 2)[1];
      continue;
    }
    if (arg === "--chrome-path") {
      const value = rawArgs[i + 1];
      if (!value) throw createUsageError("Missing value for --chrome-path");
      parsed.chromePath = value;
      i += 1;
      continue;
    }
    if (arg?.startsWith("--chrome-path=")) {
      parsed.chromePath = arg.split("=", 2)[1];
      continue;
    }
    if (arg === "--persist-profile") {
      parsed.persistProfile = true;
      continue;
    }
    if (arg === "--no-extension") {
      parsed.noExtension = true;
      continue;
    }
    if (arg === "--extension-only") {
      parsed.extensionOnly = true;
      continue;
    }
    if (arg === "--wait-for-extension") {
      parsed.waitForExtension = true;
      continue;
    }
    if (arg === "--wait-timeout-ms") {
      const value = rawArgs[i + 1];
      if (!value) throw createUsageError("Missing value for --wait-timeout-ms");
      parsed.waitTimeoutMs = Number(value);
      i += 1;
      continue;
    }
    if (arg?.startsWith("--wait-timeout-ms=")) {
      parsed.waitTimeoutMs = Number(arg.split("=", 2)[1]);
      continue;
    }
    if (arg === "--flag") {
      const value = rawArgs[i + 1];
      if (!value) throw createUsageError("Missing value for --flag");
      parsed.flags.push(value);
      i += 1;
      continue;
    }
    if (arg?.startsWith("--flag=")) {
      parsed.flags.push(arg.split("=", 2)[1]);
      continue;
    }
  }
  return parsed;
}

export async function runSessionLaunch(args: ParsedArgs) {
  const launchArgs = parseLaunchArgs(args.rawArgs);
  const result = await callDaemon("session.launch", launchArgs) as { sessionId: string };
  return {
    success: true,
    message: `Session launched: ${result.sessionId}`,
    data: result
  };
}
