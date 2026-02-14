import { createUsageError } from "./errors";

export type CliCommand = "install" | "update" | "uninstall" | "help" | "version" | "serve" | "daemon" | "native" | "run"
  | "launch" | "connect" | "disconnect" | "status"
  | "goto" | "wait" | "snapshot"
  | "click" | "hover" | "press" | "check" | "uncheck" | "type" | "select" | "scroll" | "scroll-into-view"
  | "targets-list" | "target-use" | "target-new" | "target-close"
  | "page" | "pages" | "page-close"
  | "dom-html" | "dom-text" | "dom-attr" | "dom-value" | "dom-visible" | "dom-enabled" | "dom-checked"
  | "clone-page" | "clone-component"
  | "perf" | "screenshot" | "console-poll" | "network-poll" | "debug-trace-snapshot"
  | "cookie-import" | "macro-resolve"
  | "annotate" | "rpc";
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

export function parseArgs(argv: string[]): ParsedArgs {
  let args = expandShortFlags(argv.slice(2));
  let commandOverride: CliCommand | null = null;

  if (args[0] && !args[0].startsWith("-")) {
    const candidate = args[0];
    if (candidate === "install" || candidate === "update" || candidate === "uninstall" || candidate === "help" || candidate === "version" || candidate === "serve" || candidate === "daemon" || candidate === "native" || candidate === "run"
      || candidate === "launch" || candidate === "connect" || candidate === "disconnect" || candidate === "status"
      || candidate === "goto" || candidate === "wait" || candidate === "snapshot"
      || candidate === "click" || candidate === "hover" || candidate === "press" || candidate === "check" || candidate === "uncheck"
      || candidate === "type" || candidate === "select" || candidate === "scroll" || candidate === "scroll-into-view"
      || candidate === "targets-list" || candidate === "target-use" || candidate === "target-new" || candidate === "target-close"
      || candidate === "page" || candidate === "pages" || candidate === "page-close"
      || candidate === "dom-html" || candidate === "dom-text" || candidate === "dom-attr" || candidate === "dom-value"
      || candidate === "dom-visible" || candidate === "dom-enabled" || candidate === "dom-checked"
      || candidate === "clone-page" || candidate === "clone-component"
      || candidate === "perf" || candidate === "screenshot" || candidate === "console-poll" || candidate === "network-poll"
      || candidate === "debug-trace-snapshot" || candidate === "cookie-import" || candidate === "macro-resolve"
      || candidate === "annotate" || candidate === "rpc") {
      commandOverride = candidate;
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

  const validFlags = new Set([
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
    "--screenshot-mode", "--debug", "--context"
  ]);

  const validEqualsFlags = new Set([
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
    "--expression",
    "--default-provider",
    "--request-id",
    "--strict",
    "--params",
    "--params-file"
  ]);

  for (const arg of args) {
    if (arg.startsWith("--") && !validFlags.has(arg)) {
      if (arg.includes("=")) {
        const baseFlag = arg.split("=", 2)[0] ?? "";
        if (validEqualsFlags.has(baseFlag)) {
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
  daemon           Install/uninstall/status daemon auto-start
  native           Install/uninstall/status native messaging host
  run              Execute a JSON script in a single process
  launch           Launch a managed browser session via daemon
  connect          Connect to an existing browser via daemon
  disconnect       Disconnect a daemon session
  status           Get daemon status (or session status with --session-id)
  goto             Navigate current session to a URL
  wait             Wait for load or a ref to appear
  snapshot         Capture a snapshot of the active page
  click            Click an element by ref
  hover            Hover an element by ref
  press            Press a keyboard key
  check            Check a checkbox by ref
  uncheck          Uncheck a checkbox by ref
  type             Type into an element by ref
  select           Select values in a select by ref
  scroll           Scroll the page or element by ref
  scroll-into-view Scroll an element into view by ref
  targets-list     List page targets
  target-use       Focus a target by id
  target-new       Open a new target
  target-close     Close a target by id
  page             Open or focus a named page
  pages            List named pages
  page-close       Close a named page
  dom-html         Capture HTML for a ref
  dom-text         Capture text for a ref
  dom-attr         Capture attribute value for a ref
  dom-value        Capture input value for a ref
  dom-visible      Check visibility for a ref
  dom-enabled      Check enabled state for a ref
  dom-checked      Check checked state for a ref
  clone-page       Clone the active page to React
  clone-component  Clone a component by ref
  perf             Capture performance metrics
  screenshot       Capture a screenshot
  console-poll     Poll console events
  network-poll     Poll network events
  debug-trace-snapshot Capture page + console + network + exception diagnostics
  cookie-import    Import validated cookies into a session
  macro-resolve    Resolve a macro expression into provider action/provenance (optionally execute)
  annotate         Request interactive annotations (direct or relay)
  rpc              Power-user internal daemon RPC command (unsafe, extreme caution)
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
  --transport      Transport: relay (default) or native
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
  npx opendevbrowser native install <extension-id>  # Install native host
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
