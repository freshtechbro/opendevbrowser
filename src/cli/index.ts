#!/usr/bin/env node

import { parseArgs, getHelpText, detectOutputFormat } from "./args";
import type { OutputFormat } from "./args";
import { registerCommand, getCommand } from "./commands/registry";
import type { CommandResult } from "./commands/types";
import { installGlobal } from "./installers/global";
import { installLocal } from "./installers/local";
import { installSkills } from "./installers/skills";
import { runUpdate } from "./commands/update";
import { runUninstall, findInstalledConfigs } from "./commands/uninstall";
import { runServe } from "./commands/serve";
import { runDaemonCommand } from "./commands/daemon";
import { runNativeCommand } from "./commands/native";
import { getAutostartStatus, installAutostart } from "./daemon-autostart";
import { runScriptCommand } from "./commands/run";
import { runSessionLaunch } from "./commands/session/launch";
import { runSessionConnect } from "./commands/session/connect";
import { runSessionDisconnect } from "./commands/session/disconnect";
import { runStatus } from "./commands/status";
import { runGoto } from "./commands/nav/goto";
import { runWait } from "./commands/nav/wait";
import { runSnapshot } from "./commands/nav/snapshot";
import { runAnnotate } from "./commands/annotate";
import { runClick } from "./commands/interact/click";
import { runHover } from "./commands/interact/hover";
import { runPress } from "./commands/interact/press";
import { runCheck } from "./commands/interact/check";
import { runUncheck } from "./commands/interact/uncheck";
import { runType } from "./commands/interact/type";
import { runSelect } from "./commands/interact/select";
import { runScroll } from "./commands/interact/scroll";
import { runScrollIntoView } from "./commands/interact/scroll-into-view";
import { runTargetsList } from "./commands/targets/list";
import { runTargetUse } from "./commands/targets/use";
import { runTargetNew } from "./commands/targets/new";
import { runTargetClose } from "./commands/targets/close";
import { runPageOpen } from "./commands/pages/open";
import { runPagesList } from "./commands/pages/list";
import { runPageClose } from "./commands/pages/close";
import { runDomHtml } from "./commands/dom/html";
import { runDomText } from "./commands/dom/text";
import { runDomAttr } from "./commands/dom/attr";
import { runDomValue } from "./commands/dom/value";
import { runDomVisible } from "./commands/dom/visible";
import { runDomEnabled } from "./commands/dom/enabled";
import { runDomChecked } from "./commands/dom/checked";
import { runClonePage } from "./commands/export/clone-page";
import { runCloneComponent } from "./commands/export/clone-component";
import { runPerf } from "./commands/devtools/perf";
import { runScreenshot } from "./commands/devtools/screenshot";
import { runConsolePoll } from "./commands/devtools/console-poll";
import { runNetworkPoll } from "./commands/devtools/network-poll";
import { extractExtension } from "../extension-extractor";
import { writeOutput } from "./output";
import type { InstallMode } from "./args";
import { formatErrorPayload, resolveExitCode, toCliError, EXIT_EXECUTION, EXIT_USAGE } from "./errors";
import type { CliError } from "./errors";

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

function emitFatalError(error: CliError, outputFormat: OutputFormat): void {
  if (outputFormat === "text") {
    console.error(`Error: ${error.message}`);
    if (error.exitCode === EXIT_USAGE) {
      console.error("\nFor help: npx opendevbrowser --help");
    }
    return;
  }

  writeOutput(formatErrorPayload(error), { format: outputFormat });
}

async function main(): Promise<void> {
  let outputFormat: OutputFormat | null = null;
  let parseSucceeded = false;
  try {
    const args = parseArgs(process.argv);
    parseSucceeded = true;
    outputFormat = args.outputFormat;
    const outputOptions = { format: args.outputFormat, quiet: args.quiet };

    const emitResult = (result: CommandResult, payload?: Record<string, unknown>) => {
      const suppressOutput = Boolean(
        result.data
        && typeof result.data === "object"
        && "suppressOutput" in result.data
        && (result.data as { suppressOutput?: boolean }).suppressOutput
      );
      if (suppressOutput) {
        return;
      }
      if (args.outputFormat === "text") {
        if (result.message) {
          writeOutput(result.message, outputOptions);
        }
      } else {
        const exitCode = resolveExitCode(result);
        writeOutput({
          success: result.success,
          message: result.message,
          ...(result.success || !result.message ? {} : { error: result.message }),
          ...(result.success || exitCode === null ? {} : { exitCode }),
          ...payload
        }, outputOptions);
      }
    };

    registerCommand({
      name: "help",
      description: "Show help",
      run: () => ({ success: true, message: getHelpText() })
    });

    registerCommand({
      name: "version",
      description: "Show version",
      run: () => ({ success: true, message: `opendevbrowser v${VERSION}` })
    });

    registerCommand({
      name: "update",
      description: "Clear cached plugin to trigger reinstall",
      run: () => {
        const result = runUpdate();
        return { success: result.success, message: result.message };
      }
    });

    registerCommand({
      name: "uninstall",
      description: "Remove plugin from config",
      run: async () => {
        let mode = args.mode;
        if (!mode && !args.noPrompt) {
          mode = await promptUninstallMode() ?? undefined;
          if (!mode) {
            return { success: true, message: "Uninstall cancelled." };
          }
        }
        if (!mode) {
          return { success: false, message: "Error: Please specify --global or --local for uninstall.", exitCode: EXIT_USAGE };
        }
        const result = runUninstall(mode);
        return { success: result.success, message: result.message };
      }
    });

    registerCommand({
      name: "install",
      description: "Install the plugin",
      run: async () => {
        const log = (...values: unknown[]) => {
          if (args.quiet) return;
          console.log(...values);
        };
        const warn = (...values: unknown[]) => {
          if (args.quiet) return;
          console.warn(...values);
        };

        let mode = args.mode;
        if (!mode) {
          mode = await promptInstallMode();
        }

        const result = mode === "global"
          ? installGlobal(args.withConfig)
          : installLocal(args.withConfig);

        const maybeInstallAutostart = () => {
          const status = getAutostartStatus();
          if (!status.supported) {
            return { status, installed: false, message: `Autostart not supported on ${status.platform}.` };
          }
          if (status.installed) {
            return { status, installed: true, message: "Autostart already installed." };
          }
          try {
            const result = installAutostart();
            return { status: result, installed: result.installed, message: `Autostart installed (${result.platform}).` };
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { status, installed: false, message };
          }
        };

        if (args.outputFormat !== "text") {
          const payload: Record<string, unknown> = {
            alreadyInstalled: result.alreadyInstalled
          };

          if (result.success && args.skillsMode !== "none") {
            const skillsResult = installSkills(args.skillsMode);
            payload.skills = skillsResult;
          }

          if (args.fullInstall && result.success) {
            try {
              const extensionPath = extractExtension();
              payload.extensionPath = extensionPath;
            } catch (error) {
              payload.extensionError = error instanceof Error ? error.message : String(error);
            }
          }

          if (result.success && !result.alreadyInstalled) {
            const autostart = maybeInstallAutostart();
            payload.autostart = autostart.status;
            if (!autostart.installed) {
              payload.autostartError = autostart.message;
            }
          }

          return { success: result.success, message: result.message, data: payload };
        }

        log(result.message);

        if (args.skillsMode === "none") {
          log("Skill installation skipped (--no-skills).");
        } else if (result.success) {
          const skillsResult = installSkills(args.skillsMode);
          if (skillsResult.success) {
            log(skillsResult.message);
          } else {
            warn(skillsResult.message);
          }
        } else {
          warn("Skill installation skipped because plugin install failed.");
        }

        if (args.fullInstall && result.success) {
          try {
            const extensionPath = extractExtension();
            if (extensionPath) {
              log(`Extension assets extracted to ${extensionPath}`);
            } else {
              warn("Extension assets not found; skipping extraction.");
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            warn(`Extension pre-extraction failed: ${message}`);
          }
        }

        if (result.success && !result.alreadyInstalled) {
          const autostart = maybeInstallAutostart();
          if (autostart.installed) {
            log(autostart.message);
          } else {
            warn(`Autostart install skipped: ${autostart.message}`);
          }
        }

        if (result.success && !result.alreadyInstalled) {
          log("\nNext steps:");
          log("  1. Start or restart OpenCode");
          log("  2. Use opendevbrowser_status to verify the plugin is loaded");
          log("\nFor help: npx opendevbrowser --help");
        }

        return { success: result.success, message: result.message };
      }
    });

    registerCommand({
      name: "serve",
      description: "Start or stop the local daemon",
      run: async () => runServe(args)
    });

    registerCommand({
      name: "daemon",
      description: "Install/uninstall/status daemon auto-start",
      run: async () => runDaemonCommand(args)
    });

    registerCommand({
      name: "native",
      description: "Install/uninstall/status native messaging host",
      run: async () => runNativeCommand(args)
    });

    registerCommand({
      name: "run",
      description: "Execute a JSON script in a single process",
      run: async () => runScriptCommand(args)
    });

    registerCommand({
      name: "launch",
      description: "Launch a managed browser session via daemon",
      run: async () => runSessionLaunch(args)
    });

    registerCommand({
      name: "connect",
      description: "Connect to an existing browser via daemon",
      run: async () => runSessionConnect(args)
    });

    registerCommand({
      name: "disconnect",
      description: "Disconnect a daemon session",
      run: async () => runSessionDisconnect(args)
    });

    registerCommand({
      name: "status",
      description: "Get daemon or session status",
      run: async () => runStatus(args)
    });

    registerCommand({
      name: "goto",
      description: "Navigate current session to a URL",
      run: async () => runGoto(args)
    });

    registerCommand({
      name: "wait",
      description: "Wait for load or a ref to appear",
      run: async () => runWait(args)
    });

    registerCommand({
      name: "snapshot",
      description: "Capture a snapshot of the active page",
      run: async () => runSnapshot(args)
    });

    registerCommand({
      name: "annotate",
      description: "Request interactive annotations (extension relay)",
      run: async () => runAnnotate(args)
    });

    registerCommand({
      name: "click",
      description: "Click an element by ref",
      run: async () => runClick(args)
    });

    registerCommand({
      name: "hover",
      description: "Hover an element by ref",
      run: async () => runHover(args)
    });

    registerCommand({
      name: "press",
      description: "Press a keyboard key",
      run: async () => runPress(args)
    });

    registerCommand({
      name: "check",
      description: "Check a checkbox by ref",
      run: async () => runCheck(args)
    });

    registerCommand({
      name: "uncheck",
      description: "Uncheck a checkbox by ref",
      run: async () => runUncheck(args)
    });

    registerCommand({
      name: "type",
      description: "Type into an element by ref",
      run: async () => runType(args)
    });

    registerCommand({
      name: "select",
      description: "Select values in a select by ref",
      run: async () => runSelect(args)
    });

    registerCommand({
      name: "scroll",
      description: "Scroll the page or element by ref",
      run: async () => runScroll(args)
    });

    registerCommand({
      name: "scroll-into-view",
      description: "Scroll an element into view by ref",
      run: async () => runScrollIntoView(args)
    });

    registerCommand({
      name: "targets-list",
      description: "List page targets",
      run: async () => runTargetsList(args)
    });

    registerCommand({
      name: "target-use",
      description: "Focus a target by id",
      run: async () => runTargetUse(args)
    });

    registerCommand({
      name: "target-new",
      description: "Open a new target",
      run: async () => runTargetNew(args)
    });

    registerCommand({
      name: "target-close",
      description: "Close a target by id",
      run: async () => runTargetClose(args)
    });

    registerCommand({
      name: "page",
      description: "Open or focus a named page",
      run: async () => runPageOpen(args)
    });

    registerCommand({
      name: "pages",
      description: "List named pages",
      run: async () => runPagesList(args)
    });

    registerCommand({
      name: "page-close",
      description: "Close a named page",
      run: async () => runPageClose(args)
    });

    registerCommand({
      name: "dom-html",
      description: "Capture HTML for a ref",
      run: async () => runDomHtml(args)
    });

    registerCommand({
      name: "dom-text",
      description: "Capture text for a ref",
      run: async () => runDomText(args)
    });

    registerCommand({
      name: "dom-attr",
      description: "Capture attribute value for a ref",
      run: async () => runDomAttr(args)
    });

    registerCommand({
      name: "dom-value",
      description: "Capture input value for a ref",
      run: async () => runDomValue(args)
    });

    registerCommand({
      name: "dom-visible",
      description: "Check visibility for a ref",
      run: async () => runDomVisible(args)
    });

    registerCommand({
      name: "dom-enabled",
      description: "Check enabled state for a ref",
      run: async () => runDomEnabled(args)
    });

    registerCommand({
      name: "dom-checked",
      description: "Check checked state for a ref",
      run: async () => runDomChecked(args)
    });

    registerCommand({
      name: "clone-page",
      description: "Clone the active page to React",
      run: async () => runClonePage(args)
    });

    registerCommand({
      name: "clone-component",
      description: "Clone a component by ref",
      run: async () => runCloneComponent(args)
    });

    registerCommand({
      name: "perf",
      description: "Capture performance metrics",
      run: async () => runPerf(args)
    });

    registerCommand({
      name: "screenshot",
      description: "Capture a screenshot",
      run: async () => runScreenshot(args)
    });

    registerCommand({
      name: "console-poll",
      description: "Poll console events",
      run: async () => runConsolePoll(args)
    });

    registerCommand({
      name: "network-poll",
      description: "Poll network events",
      run: async () => runNetworkPoll(args)
    });
    const command = getCommand(args.command);
    if (!command) {
      throw new Error(`Unknown command: ${args.command}`);
    }

    const result = await command.run(args);
    emitResult(result, result.data ? { data: result.data } : undefined);
    const exitCode = resolveExitCode(result);
    if (exitCode === null) {
      return;
    }
    process.exit(exitCode);
  } catch (error) {
    const format = outputFormat ?? detectOutputFormat(process.argv);
    const cliError = toCliError(error, parseSucceeded ? EXIT_EXECUTION : EXIT_USAGE);
    emitFatalError(cliError, format);
    process.exit(cliError.exitCode);
  }
}

main().catch((error: unknown) => {
  const cliError = toCliError(error, EXIT_EXECUTION);
  emitFatalError(cliError, detectOutputFormat(process.argv));
  process.exit(cliError.exitCode);
});
