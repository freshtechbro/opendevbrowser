import type { ParsedArgs } from "../../args";
import { callDaemon } from "../../client";
import { createUsageError } from "../../errors";
import { parseNumberFlag } from "../../utils/parse";

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
  extensionLegacy?: boolean;
};

const MIN_LAUNCH_CALL_TIMEOUT_MS = 30_000;
const LAUNCH_CALL_TIMEOUT_BUFFER_MS = 5_000;

const parseBooleanFlag = (value: string, flag: string): boolean => {
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  throw createUsageError(`Invalid ${flag}: ${value}`);
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
      const value = rawArgs[i + 1];
      if (value && !value.startsWith("--")) {
        parsed.persistProfile = parseBooleanFlag(value, "--persist-profile");
        i += 1;
      } else {
        parsed.persistProfile = true;
      }
      continue;
    }
    if (arg?.startsWith("--persist-profile=")) {
      const value = arg.split("=", 2)[1];
      if (!value) throw createUsageError("Missing value for --persist-profile");
      parsed.persistProfile = parseBooleanFlag(value, "--persist-profile");
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
    if (arg === "--extension-legacy") {
      parsed.extensionLegacy = true;
      continue;
    }
    if (arg === "--wait-for-extension") {
      parsed.waitForExtension = true;
      continue;
    }
    if (arg === "--wait-timeout-ms") {
      const value = rawArgs[i + 1];
      if (!value) throw createUsageError("Missing value for --wait-timeout-ms");
      parsed.waitTimeoutMs = parseNumberFlag(value, "--wait-timeout-ms", { min: 1 });
      i += 1;
      continue;
    }
    if (arg?.startsWith("--wait-timeout-ms=")) {
      const value = arg.split("=", 2)[1];
      if (!value) throw createUsageError("Missing value for --wait-timeout-ms");
      parsed.waitTimeoutMs = parseNumberFlag(value, "--wait-timeout-ms", { min: 1 });
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
      const value = arg.split("=", 2)[1];
      if (!value) throw createUsageError("Missing value for --flag");
      parsed.flags.push(value);
      continue;
    }
  }
  return parsed;
}

function deriveLaunchCallTimeoutMs(launchArgs: LaunchArgs): number {
  const waitHintMs = typeof launchArgs.waitTimeoutMs === "number"
    ? launchArgs.waitTimeoutMs + LAUNCH_CALL_TIMEOUT_BUFFER_MS
    : 0;
  return Math.max(MIN_LAUNCH_CALL_TIMEOUT_MS, waitHintMs);
}

export const __test__ = { parseLaunchArgs, deriveLaunchCallTimeoutMs };

export async function runSessionLaunch(args: ParsedArgs) {
  const launchArgs = parseLaunchArgs(args.rawArgs);
  const launchCallTimeoutMs = deriveLaunchCallTimeoutMs(launchArgs);
  try {
    const result = await callDaemon("session.launch", launchArgs, { timeoutMs: launchCallTimeoutMs }) as { sessionId: string };
    return {
      success: true,
      message: `Session launched: ${result.sessionId}`,
      data: result
    };
  } catch (error) {
    if (args.noInteractive) {
      throw error;
    }
    const message = error instanceof Error ? error.message : "";
    const lower = message.toLowerCase();
    const isExtensionFailure = message.includes("Extension not connected")
      || message.includes("Extension relay connection failed")
      || lower.includes("unauthorized");
    if (!isExtensionFailure) {
      throw error;
    }

    const retry = await promptYesNo(
      lower.includes("unauthorized")
        ? "Relay token mismatch detected. Open the extension popup and click Connect to refresh pairing, then retry now?"
        : "Extension not connected. Open the extension popup and click Connect, then retry now?",
      false
    );
    if (retry) {
      try {
        const retryArgs = { ...launchArgs, waitForExtension: true };
        const result = await callDaemon("session.launch", retryArgs, { timeoutMs: deriveLaunchCallTimeoutMs(retryArgs) }) as { sessionId: string };
        return {
          success: true,
          message: `Session launched: ${result.sessionId}`,
          data: result
        };
      } catch (retryError) {
        error = retryError;
      }
    }

    const proceedManaged = await promptYesNo("Proceed with a managed session (headed)?", false);
    if (proceedManaged) {
      const useHeadless = await promptYesNo("Run headless instead?", false);
      const managedArgs = {
        ...launchArgs,
        noExtension: true,
        headless: useHeadless ? true : false
      };
      const result = await callDaemon("session.launch", managedArgs, { timeoutMs: deriveLaunchCallTimeoutMs(managedArgs) }) as { sessionId: string };
      return {
        success: true,
        message: `Session launched: ${result.sessionId}`,
        data: result
      };
    }

    const proceedCdp = await promptYesNo("Proceed with CDPConnect (requires Chrome --remote-debugging-port=9222)?", false);
    if (proceedCdp) {
      const result = await callDaemon("session.connect", {}) as { sessionId: string };
      return {
        success: true,
        message: `Session connected: ${result.sessionId}`,
        data: result
      };
    }

    throw error;
  }
}

function promptYesNo(question: string, defaultYes: boolean): Promise<boolean> {
  if (!process.stdin.isTTY) {
    return Promise.resolve(false);
  }

  const suffix = defaultYes ? " [Y/n] " : " [y/N] ";
  return new Promise((resolve) => {
    process.stdout.write(`${question}${suffix}`);
    process.stdin.setEncoding("utf8");
    process.stdin.once("data", (data) => {
      const input = data.toString().trim().toLowerCase();
      if (!input) {
        resolve(defaultYes);
        return;
      }
      resolve(input === "y" || input === "yes");
    });
  });
}
