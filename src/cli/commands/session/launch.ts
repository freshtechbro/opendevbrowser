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
      const value = arg.split("=", 2)[1];
      if (!value) throw createUsageError("Missing value for --wait-timeout-ms");
      parsed.waitTimeoutMs = Number(value);
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

export async function runSessionLaunch(args: ParsedArgs) {
  const launchArgs = parseLaunchArgs(args.rawArgs);
  try {
    const result = await callDaemon("session.launch", launchArgs) as { sessionId: string };
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
        const result = await callDaemon("session.launch", { ...launchArgs, waitForExtension: true }) as { sessionId: string };
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
      const result = await callDaemon("session.launch", {
        ...launchArgs,
        noExtension: true,
        headless: useHeadless ? true : false
      }) as { sessionId: string };
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
