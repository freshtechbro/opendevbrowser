export type CliCommand = "install" | "update" | "uninstall" | "help" | "version";
export type InstallMode = "global" | "local";
export type SkillsMode = "global" | "local" | "none";

export interface ParsedArgs {
  command: CliCommand;
  mode?: InstallMode;
  withConfig: boolean;
  noPrompt: boolean;
  skillsMode: SkillsMode;
  fullInstall: boolean;
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

export function parseArgs(argv: string[]): ParsedArgs {
  const args = expandShortFlags(argv.slice(2));
  const skillsMode = parseSkillsMode(args);
  const fullInstall = args.includes("--full");

  if (args.includes("--help") || args.includes("-h")) {
    return { command: "help", withConfig: false, noPrompt: false, skillsMode, fullInstall };
  }

  if (args.includes("--version") || args.includes("-v")) {
    return { command: "version", withConfig: false, noPrompt: false, skillsMode, fullInstall };
  }

  if (args.includes("--update")) {
    const mode = args.includes("--global") ? "global" : args.includes("--local") ? "local" : undefined;
    return { command: "update", mode, withConfig: false, noPrompt: false, skillsMode, fullInstall };
  }

  if (args.includes("--uninstall")) {
    const mode = args.includes("--global") ? "global" : args.includes("--local") ? "local" : undefined;
    const noPrompt = args.includes("--no-prompt");
    return { command: "uninstall", mode, withConfig: false, noPrompt, skillsMode, fullInstall };
  }

  const withConfig = args.includes("--with-config") || fullInstall;
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
    "--help", "--version", "--with-config", "--no-prompt",
    "--full",
    "--skills-global", "--skills-local", "--no-skills"
  ]);
  
  for (const arg of args) {
    if (arg.startsWith("--") && !validFlags.has(arg)) {
      throw new Error(`Unknown flag: ${arg}`);
    }
    if (arg.startsWith("-") && !arg.startsWith("--") && !SHORT_FLAGS[arg]) {
      throw new Error(`Unknown flag: ${arg}`);
    }
  }

  return { command: "install", mode, withConfig, noPrompt, skillsMode, fullInstall };
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
  --full, -f       Create config and pre-extract extension assets
  --no-prompt      Skip prompts, use defaults (global install)
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
