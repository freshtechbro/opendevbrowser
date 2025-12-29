export type CliCommand = "install" | "update" | "uninstall" | "help" | "version";
export type InstallMode = "global" | "local";

export interface ParsedArgs {
  command: CliCommand;
  mode?: InstallMode;
  withConfig: boolean;
  noPrompt: boolean;
}

const SHORT_FLAGS: Record<string, string> = {
  "-g": "--global",
  "-l": "--local",
  "-u": "--update",
  "-h": "--help",
  "-v": "--version"
};

function expandShortFlags(args: string[]): string[] {
  return args.map((arg) => SHORT_FLAGS[arg] ?? arg);
}

export function parseArgs(argv: string[]): ParsedArgs {
  const args = expandShortFlags(argv.slice(2));

  if (args.includes("--help") || args.includes("-h")) {
    return { command: "help", withConfig: false, noPrompt: false };
  }

  if (args.includes("--version") || args.includes("-v")) {
    return { command: "version", withConfig: false, noPrompt: false };
  }

  if (args.includes("--update")) {
    const mode = args.includes("--global") ? "global" : args.includes("--local") ? "local" : undefined;
    return { command: "update", mode, withConfig: false, noPrompt: false };
  }

  if (args.includes("--uninstall")) {
    const mode = args.includes("--global") ? "global" : args.includes("--local") ? "local" : undefined;
    const noPrompt = args.includes("--no-prompt");
    return { command: "uninstall", mode, withConfig: false, noPrompt };
  }

  const withConfig = args.includes("--with-config");
  const noPrompt = args.includes("--no-prompt");

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
    "--help", "--version", "--with-config", "--no-prompt"
  ]);
  
  for (const arg of args) {
    if (arg.startsWith("--") && !validFlags.has(arg)) {
      throw new Error(`Unknown flag: ${arg}`);
    }
    if (arg.startsWith("-") && !arg.startsWith("--") && !SHORT_FLAGS[arg]) {
      throw new Error(`Unknown flag: ${arg}`);
    }
  }

  return { command: "install", mode, withConfig, noPrompt };
}

export function getHelpText(): string {
  return `
OpenDevBrowser CLI - Install and manage the OpenDevBrowser plugin

USAGE:
  npx opendevbrowser [options]

COMMANDS:
  (default)        Install the plugin (interactive if no mode specified)
  --update, -u     Clear cached plugin to trigger reinstall
  --uninstall      Remove plugin from config
  --help, -h       Show this help message
  --version, -v    Show version

INSTALL OPTIONS:
  --global, -g     Install to ~/.config/opencode/opencode.json
  --local, -l      Install to ./opencode.json (project-local)
  --with-config    Also create opendevbrowser.jsonc with defaults
  --no-prompt      Skip prompts, use defaults (global install)

EXAMPLES:
  npx opendevbrowser              # Interactive install
  npx opendevbrowser --global     # Global install
  npx opendevbrowser --local      # Project install
  npx opendevbrowser -g --with-config  # Global + config file
  npx opendevbrowser --update     # Update plugin
  npx opendevbrowser --uninstall --global  # Remove from global config
`.trim();
}
