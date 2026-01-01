#!/usr/bin/env node

import { parseArgs, getHelpText } from "./args";
import { installGlobal } from "./installers/global";
import { installLocal } from "./installers/local";
import { installSkills } from "./installers/skills";
import { runUpdate } from "./commands/update";
import { runUninstall, findInstalledConfigs } from "./commands/uninstall";
import { extractExtension } from "../extension-extractor";
import type { InstallMode } from "./args";

const VERSION = "0.1.0";

async function promptInstallMode(): Promise<InstallMode> {
  if (!process.stdin.isTTY) {
    console.log("Non-interactive mode detected. Using global install.");
    return "global";
  }

  return new Promise((resolve) => {
    console.log("\nWhere would you like to install opendevbrowser?\n");
    console.log("  1. Global (~/.config/opencode/opencode.json)");
    console.log("  2. Local (./opencode.json in this project)\n");

    process.stdout.write("Enter choice [1]: ");

    process.stdin.setEncoding("utf8");
    let resolved = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    process.stdin.once("data", (data) => {
      cleanup();
      if (resolved) return;
      resolved = true;
      const input = data.toString().trim();
      if (input === "2") {
        resolve("local");
      } else {
        resolve("global");
      }
    });

    process.stdin.once("close", () => {
      cleanup();
      if (resolved) return;
      resolved = true;
      resolve("global");
    });

    timeoutId = setTimeout(() => {
      timeoutId = null;
      if (resolved) return;
      resolved = true;
      console.log("\nTimeout - using global install.");
      resolve("global");
    }, 30000);
  });
}

async function promptUninstallMode(): Promise<InstallMode | null> {
  const installed = findInstalledConfigs();

  if (!installed.global && !installed.local) {
    console.log("opendevbrowser is not installed in any config.");
    return null;
  }

  if (installed.global && !installed.local) {
    return "global";
  }

  if (!installed.global && installed.local) {
    return "local";
  }

  if (!process.stdin.isTTY) {
    console.log("Plugin found in both global and local configs. Use --global or --local flag.");
    return null;
  }

  return new Promise((resolve) => {
    console.log("\nopendevbrowser is installed in multiple locations:\n");
    console.log("  1. Global (~/.config/opencode/opencode.json)");
    console.log("  2. Local (./opencode.json)");
    console.log("  3. Cancel\n");

    process.stdout.write("Which to uninstall? [3]: ");

    process.stdin.setEncoding("utf8");
    process.stdin.once("data", (data) => {
      const input = data.toString().trim();
      if (input === "1") {
        resolve("global");
      } else if (input === "2") {
        resolve("local");
      } else {
        resolve(null);
      }
    });

    process.stdin.once("close", () => {
      resolve(null);
    });
  });
}

async function main(): Promise<void> {
  try {
    const args = parseArgs(process.argv);

    switch (args.command) {
      case "help":
        console.log(getHelpText());
        process.exit(0);
        break;

      case "version":
        console.log(`opendevbrowser v${VERSION}`);
        process.exit(0);
        break;

      case "update": {
        const result = runUpdate();
        console.log(result.message);
        process.exit(result.success ? 0 : 1);
        break;
      }

      case "uninstall": {
        let mode = args.mode;
        if (!mode && !args.noPrompt) {
          mode = await promptUninstallMode() ?? undefined;
          if (!mode) {
            console.log("Uninstall cancelled.");
            process.exit(0);
          }
        }
        if (!mode) {
          console.error("Error: Please specify --global or --local for uninstall.");
          process.exit(1);
        }
        const result = runUninstall(mode);
        console.log(result.message);
        process.exit(result.success ? 0 : 1);
        break;
      }

      case "install":
      default: {
        let mode = args.mode;
        if (!mode) {
          mode = await promptInstallMode();
        }

        const result = mode === "global"
          ? installGlobal(args.withConfig)
          : installLocal(args.withConfig);

        console.log(result.message);

        if (args.skillsMode === "none") {
          console.log("Skill installation skipped (--no-skills).");
        } else if (result.success) {
          const skillsResult = installSkills(args.skillsMode);
          if (skillsResult.success) {
            console.log(skillsResult.message);
          } else {
            console.warn(skillsResult.message);
          }
        } else {
          console.warn("Skill installation skipped because plugin install failed.");
        }

        if (args.fullInstall && result.success) {
          try {
            const extensionPath = extractExtension();
            if (extensionPath) {
              console.log(`Extension assets extracted to ${extensionPath}`);
            } else {
              console.warn("Extension assets not found; skipping extraction.");
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.warn(`Extension pre-extraction failed: ${message}`);
          }
        }

        if (result.success && !result.alreadyInstalled) {
          console.log("\nNext steps:");
          console.log("  1. Start or restart OpenCode");
          console.log("  2. Use opendevbrowser_status to verify the plugin is loaded");
          console.log("\nFor help: npx opendevbrowser --help");
        }

        process.exit(result.success ? 0 : 1);
        break;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    console.error("\nFor help: npx opendevbrowser --help");
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error("Unexpected error:", error);
  process.exit(1);
});
