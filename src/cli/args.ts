import { createUsageError } from "./errors";

export type CliCommand = "install" | "update" | "uninstall" | "help" | "version" | "serve" | "run"
  | "launch" | "connect" | "disconnect" | "status"
  | "goto" | "wait" | "snapshot"
  | "click" | "type" | "select" | "scroll";
export type InstallMode = "global" | "local";
export type SkillsMode = "global" | "local" | "none";
export type OutputFormat = "text" | "json" | "stream-json";

export interface ParsedArgs {
  command: CliCommand;
  mode?: InstallMode;
  withConfig: boolean;
  noPrompt: boolean;
  noInteractive: boolean;
  quiet: boolean;
  outputFormat: OutputFormat;
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
  if (args.includes("--no-skills")) {
    return "none";
  }
  if (args.includes("--skills-local")) {
    return "local";
  }
  if (args.includes("--skills-global")) {
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

export function parseArgs(argv: string[]): ParsedArgs {
  let args = expandShortFlags(argv.slice(2));
  let commandOverride: CliCommand | null = null;

  if (args[0] && !args[0].startsWith("-")) {
    const candidate = args[0];
    if (candidate === "install" || candidate === "update" || candidate === "uninstall" || candidate === "help" || candidate === "version" || candidate === "serve" || candidate === "run"
      || candidate === "launch" || candidate === "connect" || candidate === "disconnect" || candidate === "status"
      || candidate === "goto" || candidate === "wait" || candidate === "snapshot"
      || candidate === "click" || candidate === "type" || candidate === "select" || candidate === "scroll") {
      commandOverride = candidate;
      args = args.slice(1);
    } else {
      throw createUsageError(`Unknown command: ${candidate}`);
    }
  }
  const skillsMode = parseSkillsMode(args);
  const fullInstall = args.includes("--full");
  const outputFormat = parseOutputFormat(args);

  if (commandOverride === "help" || args.includes("--help") || args.includes("-h")) {
    return {
      command: "help",
      withConfig: false,
      noPrompt: false,
      noInteractive: false,
      quiet: false,
      outputFormat,
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

  const validFlags = new Set([
    "--global", "--local", "--update", "--uninstall",
    "--help", "--version", "--with-config", "--no-prompt",
    "--no-interactive", "--quiet", "--output-format",
    "--full",
    "--port", "--token", "--stop",
    "--script", "--headless", "--profile", "--persist-profile", "--chrome-path", "--start-url", "--flag",
    "--session-id", "--close-browser", "--ws-endpoint", "--host", "--cdp-port",
    "--url", "--wait-until", "--timeout-ms", "--ref", "--state", "--until", "--mode", "--max-chars", "--cursor",
    "--text", "--clear", "--submit", "--values", "--dy",
    "--no-extension", "--extension-only", "--wait-for-extension", "--wait-timeout-ms",
    "--skills-global", "--skills-local", "--no-skills"
  ]);
  
  for (const arg of args) {
    if (arg.startsWith("--") && !validFlags.has(arg)) {
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
    skillsMode,
    fullInstall,
    rawArgs: args
  };
}

export function getHelpText(): string {
  return `
OpenDevBrowser CLI - Install and manage the OpenDevBrowser plugin

USAGE:
  npx opendevbrowser [command] [options]

COMMANDS:
  install          Install the plugin (default if no command specified)
  update           Clear cached plugin to trigger reinstall
  uninstall        Remove plugin from config
  serve            Start or stop the local daemon
  run              Execute a JSON script in a single process
  launch           Launch a managed browser session via daemon
  connect          Connect to an existing browser via daemon
  disconnect       Disconnect a daemon session
  status           Get daemon session status
  goto             Navigate current session to a URL
  wait             Wait for load or a ref to appear
  snapshot         Capture a snapshot of the active page
  click            Click an element by ref
  type             Type into an element by ref
  select           Select values in a select by ref
  scroll           Scroll the page or element by ref
  help             Show this help message
  version          Show version

ALIASES:
  --update, -u     Same as update
  --uninstall      Same as uninstall
  --help, -h       Same as help
  --version, -v    Same as version

INSTALL OPTIONS:
  --global, -g     Install to ~/.config/opencode/opencode.json
  --local, -l      Install to ./opencode.json (project-local)
  --with-config    Also create opendevbrowser.jsonc with defaults
  --full, -f       Create config and pre-extract extension assets
  --no-prompt      Skip prompts, use defaults (global install)
  --no-interactive Alias of --no-prompt
  --quiet          Suppress non-error output
  --output-format  Output format: text (default), json, stream-json
  --skills-global  Install bundled skills to ~/.config/opencode/skill (default)
  --skills-local   Install bundled skills to ./.opencode/skill
  --no-skills      Skip installing bundled skills

EXAMPLES:
  npx opendevbrowser              # Interactive install
  npx opendevbrowser --global     # Global install
  npx opendevbrowser --local      # Project install
  npx opendevbrowser --full       # Install + config + extension assets
  npx opendevbrowser -g --with-config  # Global + config file
  npx opendevbrowser --skills-local   # Install skills locally
  npx opendevbrowser --no-skills      # Skip skill installation
  npx opendevbrowser --update     # Update plugin
  npx opendevbrowser --uninstall --global  # Remove from global config
`.trim();
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
