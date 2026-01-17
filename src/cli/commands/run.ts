import { readFileSync } from "fs";
import { createOpenDevBrowserCore } from "../../core";
import type { ParsedArgs } from "../args";
import { writeOutput } from "../output";
import { createUsageError, EXIT_USAGE } from "../errors";

type RunArgs = {
  scriptPath?: string;
  headless?: boolean;
  profile?: string;
  persistProfile?: boolean;
  chromePath?: string;
  startUrl?: string;
  flags: string[];
};

function parseRunArgs(rawArgs: string[]): RunArgs {
  const parsed: RunArgs = { flags: [] };
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (arg === "--script") {
      const value = rawArgs[i + 1];
      if (!value) throw createUsageError("Missing value for --script");
      parsed.scriptPath = value;
      i += 1;
      continue;
    }
    if (arg?.startsWith("--script=")) {
      parsed.scriptPath = arg.split("=", 2)[1];
      continue;
    }
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
    if (arg === "--persist-profile") {
      parsed.persistProfile = true;
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
    if (arg === "--start-url") {
      const value = rawArgs[i + 1];
      if (!value) throw createUsageError("Missing value for --start-url");
      parsed.startUrl = value;
      i += 1;
      continue;
    }
    if (arg?.startsWith("--start-url=")) {
      const value = arg.split("=", 2)[1];
      if (!value) throw createUsageError("Missing value for --start-url");
      parsed.startUrl = value;
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

function readScriptFromStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

export async function runScriptCommand(args: ParsedArgs) {
  const runArgs = parseRunArgs(args.rawArgs);
  const outputOptions = { format: args.outputFormat, quiet: args.quiet };

  let scriptRaw = "";
  if (runArgs.scriptPath) {
    scriptRaw = readFileSync(runArgs.scriptPath, "utf-8");
  } else if (!process.stdin.isTTY) {
    scriptRaw = await readScriptFromStdin();
  } else {
    throw createUsageError("Provide --script <path> or pipe JSON to stdin.");
  }

  let steps: Array<{ action: string; args?: Record<string, unknown> }> = [];
  try {
    const parsed = JSON.parse(scriptRaw);
    if (Array.isArray(parsed)) {
      steps = parsed;
    } else if (parsed && typeof parsed === "object" && Array.isArray(parsed.steps)) {
      steps = parsed.steps;
    } else {
      throw new Error("Script must be a JSON array or an object with steps.");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid JSON script.";
    writeOutput({ success: false, error: message, exitCode: EXIT_USAGE }, outputOptions);
    return { success: false, message, exitCode: EXIT_USAGE, data: { suppressOutput: true } };
  }

  const core = createOpenDevBrowserCore({ directory: process.cwd() });
  const launchResult = await core.manager.launch({
    profile: runArgs.profile,
    headless: runArgs.headless,
    startUrl: runArgs.startUrl,
    chromePath: runArgs.chromePath,
    flags: runArgs.flags.length ? runArgs.flags : undefined,
    persistProfile: runArgs.persistProfile
  });

  try {
    const result = await core.runner.run(launchResult.sessionId, steps, true);
    writeOutput({
      success: true,
      sessionId: launchResult.sessionId,
      warnings: launchResult.warnings.length ? launchResult.warnings : undefined,
      ...result
    }, outputOptions);
    return { success: true, data: { suppressOutput: true } };
  } finally {
    await core.manager.disconnect(launchResult.sessionId, true);
    core.cleanup();
  }
}
