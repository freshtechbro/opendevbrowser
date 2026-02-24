import { createUsageError } from "./errors";

export const CLI_COMMANDS = [
  "install", "update", "uninstall", "help", "version", "serve", "daemon", "native", "run",
  "launch", "connect", "disconnect", "status",
  "research", "shopping", "product-video", "artifacts",
  "goto", "wait", "snapshot",
  "click", "hover", "press", "check", "uncheck", "type", "select", "scroll", "scroll-into-view",
  "targets-list", "target-use", "target-new", "target-close",
  "page", "pages", "page-close",
  "dom-html", "dom-text", "dom-attr", "dom-value", "dom-visible", "dom-enabled", "dom-checked",
  "clone-page", "clone-component",
  "perf", "screenshot", "console-poll", "network-poll", "debug-trace-snapshot",
  "cookie-import", "cookie-list", "macro-resolve",
  "annotate", "rpc"
] as const;

const CLI_COMMAND_SET = new Set<string>(CLI_COMMANDS);

export type CliCommand = (typeof CLI_COMMANDS)[number];
export type InstallMode = "global" | "local";
export type SkillsMode = "global" | "local" | "none";
export type OutputFormat = "text" | "json" | "stream-json";
export type TransportMode = "relay" | "native";

export interface ParsedArgs {
  command: CliCommand;
  mode?: InstallMode;
  withConfig: boolean;
  noPrompt: boolean;
  noInteractive: boolean;
  quiet: boolean;
  outputFormat: OutputFormat;
  transport: TransportMode;
  skillsMode: SkillsMode;
  fullInstall: boolean;
  rawArgs: string[];
}

const SHORT_FLAGS: Record<string, string> = {
  "-g": "--global",
  "-l": "--local",
  "-u": "--update",
  "-h": "--help",
  "-v": "--version",
  "-f": "--full"
};

function expandShortFlags(args: string[]): string[] {
  return args.map((arg) => SHORT_FLAGS[arg] ?? arg);
}

function parseSkillsMode(args: string[]): SkillsMode {
  const hasLocal = args.includes("--skills-local");
  const hasGlobal = args.includes("--skills-global");
  if (hasLocal && hasGlobal) {
    throw createUsageError("Choose either --skills-local or --skills-global.");
  }
  if (args.includes("--no-skills")) {
    return "none";
  }
  if (hasLocal) {
    return "local";
  }
  if (hasGlobal) {
    return "global";
  }
  return "global";
}

function parseOutputFormat(args: string[]): OutputFormat {
  const outputFlag = args.find((arg) => arg.startsWith("--output-format"));
  if (!outputFlag) {
    return "text";
  }

  let value: string | undefined;
  if (outputFlag.includes("=")) {
    value = outputFlag.split("=", 2)[1];
  } else {
    const index = args.indexOf(outputFlag);
    value = index >= 0 ? args[index + 1] : undefined;
  }

  if (value === "text" || value === "json" || value === "stream-json") {
    return value;
  }

  throw createUsageError(`Invalid --output-format: ${value ?? "missing"}`);
}

function parseTransport(args: string[]): TransportMode {
  const transportFlag = args.find((arg) => arg.startsWith("--transport"));
  if (!transportFlag) {
    return "relay";
  }

  let value: string | undefined;
  if (transportFlag.includes("=")) {
    value = transportFlag.split("=", 2)[1];
  } else {
    const index = args.indexOf(transportFlag);
    value = index >= 0 ? args[index + 1] : undefined;
  }

  if (value === "relay" || value === "native") {
    return value;
  }

  throw createUsageError(`Invalid --transport: ${value ?? "missing"}`);
}

export const VALID_FLAGS = [
  "--global", "--local", "--update", "--uninstall",
  "--help", "--version", "--with-config", "--no-prompt",
  "--no-interactive", "--quiet", "--output-format",
  "--full",
  "--port", "--token", "--stop",
  "--script", "--headless", "--profile", "--persist-profile", "--chrome-path", "--start-url", "--flag",
  "--session-id", "--close-browser", "--ws-endpoint", "--host", "--cdp-port",
  "--url", "--wait-until", "--timeout-ms", "--ref", "--state", "--until", "--mode", "--max-chars", "--cursor",
  "--text", "--clear", "--submit", "--values", "--dy", "--key", "--attr",
  "--name", "--target-id", "--tab-id", "--include-urls", "--path", "--since-seq", "--max",
  "--since-console-seq", "--since-network-seq", "--since-exception-seq", "--request-id",
  "--cookies", "--cookies-file", "--strict",
  "--expression", "--default-provider", "--include-catalog",
  "--execute",
  "--params", "--params-file", "--unsafe-internal",
  "--daemon",
  "--transport",
  "--no-extension", "--extension-only", "--extension-legacy", "--wait-for-extension", "--wait-timeout-ms",
  "--skills-global", "--skills-local", "--no-skills",
  "--screenshot-mode", "--debug", "--context",
  "--topic", "--days", "--from", "--to", "--source-selection", "--sources", "--include-engagement", "--limit-per-source",
  "--query", "--providers", "--budget", "--region", "--sort",
  "--product-url", "--product-name", "--provider-hint", "--include-screenshots", "--include-all-images", "--include-copy",
  "--output-dir", "--ttl-hours", "--expired-only"
] as const;

const VALID_FLAG_SET = new Set<string>(VALID_FLAGS);

export const VALID_EQUALS_FLAGS = [
  "--output-format",
  "--transport",
  "--session-id",
  "--url",
  "--screenshot-mode",
  "--context",
  "--timeout-ms",
  "--since-seq",
  "--since-console-seq",
  "--since-network-seq",
  "--since-exception-seq",
  "--max",
  "--target-id",
  "--tab-id",
  "--name",
  "--cookies",
  "--cookies-file",
  "--persist-profile",
  "--expression",
  "--default-provider",
  "--request-id",
  "--strict",
  "--params",
  "--params-file",
  "--topic",
  "--days",
  "--from",
  "--to",
  "--source-selection",
  "--sources",
  "--mode",
  "--limit-per-source",
  "--query",
  "--providers",
  "--budget",
  "--region",
  "--sort",
  "--product-url",
  "--product-name",
  "--provider-hint",
  "--include-screenshots",
  "--include-all-images",
  "--include-copy",
  "--output-dir",
  "--ttl-hours"
] as const;

const VALID_EQUALS_FLAG_SET = new Set<string>(VALID_EQUALS_FLAGS);

export function parseArgs(argv: string[]): ParsedArgs {
  let args = expandShortFlags(argv.slice(2));
  let commandOverride: CliCommand | null = null;

  if (args[0] && !args[0].startsWith("-")) {
    const candidate = args[0];
    if (CLI_COMMAND_SET.has(candidate)) {
      commandOverride = candidate as CliCommand;
      args = args.slice(1);
    } else {
      throw createUsageError(`Unknown command: ${candidate}`);
    }
  }
  const hasGlobal = args.includes("--global");
  const hasLocal = args.includes("--local");
  if (hasGlobal && hasLocal) {
    throw createUsageError("Choose either --global or --local.");
  }

  const skillsMode = parseSkillsMode(args);
  const fullInstall = args.includes("--full");
  const outputFormat = parseOutputFormat(args);
  const transport = commandOverride === "annotate" ? "relay" : parseTransport(args);

  if (commandOverride === "help" || args.includes("--help") || args.includes("-h")) {
    return {
      command: "help",
      withConfig: false,
      noPrompt: false,
      noInteractive: false,
      quiet: false,
      outputFormat,
      transport,
      skillsMode,
      fullInstall,
      rawArgs: args
    };
  }

  if (commandOverride === "version" || args.includes("--version") || args.includes("-v")) {
    return {
      command: "version",
      withConfig: false,
      noPrompt: false,
      noInteractive: false,
      quiet: false,
      outputFormat,
      transport,
      skillsMode,
      fullInstall,
      rawArgs: args
    };
  }

  if (commandOverride === "update" || args.includes("--update")) {
    const mode = args.includes("--global") ? "global" : args.includes("--local") ? "local" : undefined;
    return {
      command: "update",
      mode,
      withConfig: false,
      noPrompt: false,
      noInteractive: false,
      quiet: false,
      outputFormat,
      transport,
      skillsMode,
      fullInstall,
      rawArgs: args
    };
  }

  if (commandOverride === "uninstall" || args.includes("--uninstall")) {
    const mode = args.includes("--global") ? "global" : args.includes("--local") ? "local" : undefined;
    const noPrompt = args.includes("--no-prompt") || args.includes("--no-interactive");
    return {
      command: "uninstall",
      mode,
      withConfig: false,
      noPrompt,
      noInteractive: noPrompt,
      quiet: args.includes("--quiet"),
      outputFormat,
      transport,
      skillsMode,
      fullInstall,
      rawArgs: args
    };
  }

  const withConfig = args.includes("--with-config") || fullInstall;
  const noPrompt = args.includes("--no-prompt") || args.includes("--no-interactive");
  const noInteractive = args.includes("--no-interactive") || noPrompt;
  const quiet = args.includes("--quiet");

  let mode: InstallMode | undefined;
  if (args.includes("--global")) {
    mode = "global";
  } else if (args.includes("--local")) {
    mode = "local";
  } else if (noPrompt) {
    mode = "global";
  }

  for (const arg of args) {
    if (arg.startsWith("--") && !VALID_FLAG_SET.has(arg)) {
      if (arg.includes("=")) {
        const baseFlag = arg.split("=", 2)[0] ?? "";
        if (VALID_EQUALS_FLAG_SET.has(baseFlag)) {
          continue;
        }
      }
      throw createUsageError(`Unknown flag: ${arg}`);
    }
    if (arg.startsWith("-") && !arg.startsWith("--") && !SHORT_FLAGS[arg]) {
      throw createUsageError(`Unknown flag: ${arg}`);
    }
  }

  return {
    command: commandOverride ?? "install",
    mode,
    withConfig,
    noPrompt,
    noInteractive,
    quiet,
    outputFormat,
    transport,
    skillsMode,
    fullInstall,
    rawArgs: args
  };
}

export function detectOutputFormat(argv: string[]): OutputFormat {
  const args = expandShortFlags(argv.slice(2));
  try {
    return parseOutputFormat(args);
  } catch {
    return "text";
  }
}

export function detectQuiet(argv: string[]): boolean {
  const args = expandShortFlags(argv.slice(2));
  return args.includes("--quiet");
}
