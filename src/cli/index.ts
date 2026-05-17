#!/usr/bin/env node

import { parseArgs, detectOutputFormat } from "./args";
import type { InstallMode, OutputFormat, ParsedArgs } from "./args";
import { registerCommand, getCommand } from "./commands/registry";
import type { CommandResult } from "./commands/types";
import { setDefaultLogSink, stderrSink } from "../core/logging";
import { flushOutputAndExit, writeOutput } from "./output";
import { formatErrorPayload, resolveExitCode, toCliError, EXIT_EXECUTION, EXIT_USAGE } from "./errors";
import type { CliError } from "./errors";
import { buildProviderFollowupErrorMessage } from "./utils/workflow-message";
import packageJson from "../../package.json";

const VERSION = typeof packageJson.version === "string" ? packageJson.version : "0.0.0";

type CommandRunner = (args: ParsedArgs) => Promise<CommandResult> | CommandResult;

async function runLazyCommand<ExportName extends string>(
  args: ParsedArgs,
  loader: () => Promise<Record<ExportName, CommandRunner>>,
  exportName: ExportName
): Promise<CommandResult> {
  const commandModule = await loader();
  return commandModule[exportName](args);
}

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
  const { findInstalledConfigs } = await import("./commands/uninstall");
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
  const message = buildProviderFollowupErrorMessage(error.message);
  if (outputFormat === "text") {
    console.error(`Error: ${message}`);
    if (error.exitCode === EXIT_USAGE) {
      console.error("\nFor help: npx opendevbrowser --help");
    }
    return;
  }

  writeOutput({ ...formatErrorPayload(error), error: message }, { format: outputFormat });
}

async function main(): Promise<void> {
  let outputFormat: OutputFormat | null = null;
  let parseSucceeded = false;
  try {
    const args = parseArgs(process.argv);
    parseSucceeded = true;
    outputFormat = args.outputFormat;
    setDefaultLogSink(stderrSink);
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

    const finishCommand = async (result: CommandResult): Promise<void> => {
      emitResult(result, result.data ? { data: result.data } : undefined);
      const exitCode = resolveExitCode(result);
      if (exitCode === null) {
        return;
      }
      await flushOutputAndExit(exitCode);
    };

    if (args.command === "help") {
      const { getHelpText } = await import("./help");
      await finishCommand({ success: true, message: getHelpText() });
      return;
    }

    if (args.command === "version") {
      await finishCommand({ success: true, message: `opendevbrowser v${VERSION}` });
      return;
    }

    registerCommand({
      name: "help",
      description: "Show help",
      run: async () => {
        const { getHelpText } = await import("./help");
        return { success: true, message: getHelpText() };
      }
    });

    registerCommand({
      name: "version",
      description: "Show version",
      run: () => ({ success: true, message: `opendevbrowser v${VERSION}` })
    });

    registerCommand({
      name: "update",
      description: "Repair OpenCode package caches and refresh managed skill packs",
      run: async () => {
        const [
          { runUpdate },
          { resolveUpdateSkillModes },
          { hasInstalledConfig },
          {
            getBundledSkillTargets,
            getBundledSkillLifecycleTargets,
            hasBundledSkillArtifacts,
            syncBundledSkillsForTargets
          },
          { buildUpdateCommandResult }
        ] = await Promise.all([
          import("./commands/update"),
          import("./update-skill-modes"),
          import("./commands/uninstall"),
          import("./installers/skills"),
          import("./skill-lifecycle")
        ]);

        return buildUpdateCommandResult(args, runUpdate(), {
          resolveUpdateSkillModes,
          hasInstalledConfig,
          hasBundledSkillArtifacts,
          getBundledSkillTargets,
          getBundledSkillLifecycleTargets,
          syncBundledSkillsForTargets
        });
      }
    });

    registerCommand({
      name: "uninstall",
      description: "Remove plugin from config and clean managed skill packs",
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
        const [
          { runUninstall },
          {
            getBundledSkillLifecycleTargets,
            hasBundledSkillArtifacts,
            removeBundledSkillsForTargets
          },
          { buildUninstallCommandResult }
        ] = await Promise.all([
          import("./commands/uninstall"),
          import("./installers/skills"),
          import("./skill-lifecycle")
        ]);

        return buildUninstallCommandResult(args, mode, runUninstall(mode), {
          hasBundledSkillArtifacts,
          getBundledSkillLifecycleTargets,
          removeBundledSkillsForTargets
        });
      }
    });

    registerCommand({
      name: "install",
      description: "Install the plugin and sync bundled skill packs",
      run: async () => {
        const [
          { installGlobal },
          { installLocal },
          { syncBundledSkills },
          { reconcileInstallAutostart },
          {
            createInstallAutostartOutputPayload,
            formatAutostartReconciliationMessage
          },
          { extractExtension },
          { default: onboardingMetadata }
        ] = await Promise.all([
          import("./installers/global"),
          import("./installers/local"),
          import("./installers/skills"),
          import("./install-autostart-reconciliation"),
          import("./install-autostart-output"),
          import("../extension-extractor"),
          import("./onboarding-metadata.json")
        ]);

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
        const autostart = result.success ? reconcileInstallAutostart(result) : undefined;
        const skillsResult = result.success && args.skillsMode !== "none"
          ? syncBundledSkills(args.skillsMode)
          : undefined;
        const installSuccess = result.success && (skillsResult?.success ?? true);

        if (args.outputFormat !== "text") {
          const payload: Record<string, unknown> = {
            alreadyInstalled: result.alreadyInstalled
          };

          if (skillsResult) {
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

          if (autostart) {
            Object.assign(payload, createInstallAutostartOutputPayload(autostart));
          }

          return { success: installSuccess, message: result.message, data: payload };
        }

        log(result.message);

        if (args.skillsMode === "none") {
          log("Skill installation skipped (--no-skills).");
        } else if (skillsResult) {
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

        if (autostart) {
          const autostartMessage = formatAutostartReconciliationMessage(autostart);
          if (autostartMessage) {
            if (autostart.autostartAction === "repair_failed") {
              warn(autostartMessage);
            } else {
              log(autostartMessage);
            }
          }
        }

        if (installSuccess && !result.alreadyInstalled) {
          log("\nNext steps:");
          log("  1. Start or restart OpenCode");
          log(`  2. Read npx opendevbrowser --help and start with ${onboardingMetadata.quickStartCommands.promptingGuide}`);
          log(`  3. Or load ${onboardingMetadata.skillName} ${onboardingMetadata.skillTopic} directly via ${onboardingMetadata.quickStartCommands.skillLoad}`);
          log("  4. Use opendevbrowser_status to verify the plugin is loaded");
        }

        return { success: installSuccess, message: result.message };
      }
    });

    registerCommand({
      name: "serve",
      description: "Start or stop the local daemon",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/serve"), "runServe")
    });

    registerCommand({
      name: "daemon",
      description: "Install/uninstall/status daemon auto-start",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/daemon"), "runDaemonCommand")
    });

    registerCommand({
      name: "native",
      description: "Install/uninstall/status native messaging host",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/native"), "runNativeCommand")
    });

    registerCommand({
      name: "run",
      description: "Execute a JSON script in a single process",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/run"), "runScriptCommand")
    });

    registerCommand({
      name: "launch",
      description: "Launch a managed browser session via daemon",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/session/launch"), "runSessionLaunch")
    });

    registerCommand({
      name: "connect",
      description: "Connect to an existing browser via daemon",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/session/connect"), "runSessionConnect")
    });

    registerCommand({
      name: "disconnect",
      description: "Disconnect a daemon session",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/session/disconnect"), "runSessionDisconnect")
    });

    registerCommand({
      name: "status",
      description: "Get daemon or session status",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/status"), "runStatus")
    });

    registerCommand({
      name: "status-capabilities",
      description: "Inspect runtime capability discovery for the host and an optional session",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/status-capabilities"), "runStatusCapabilities")
    });

    registerCommand({
      name: "session-inspector",
      description: "Capture a session-first diagnostic summary with relay health and trace proof",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/session/inspector"), "runSessionInspector")
    });

    registerCommand({
      name: "session-inspector-plan",
      description: "Inspect browser-scoped computer-use policy and safe suggested steps",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/session/inspector-plan"), "runSessionInspectorPlan")
    });

    registerCommand({
      name: "session-inspector-audit",
      description: "Capture a correlated audit bundle across desktop evidence, browser review, and policy state",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/session/inspector-audit"), "runSessionInspectorAudit")
    });

    registerCommand({
      name: "goto",
      description: "Navigate current session to a URL",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/nav/goto"), "runGoto")
    });

    registerCommand({
      name: "wait",
      description: "Wait for load or a ref to appear",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/nav/wait"), "runWait")
    });

    registerCommand({
      name: "snapshot",
      description: "Capture a snapshot of the active page",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/nav/snapshot"), "runSnapshot")
    });

    registerCommand({
      name: "review",
      description: "Capture a first-class review payload for the active page",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/nav/review"), "runReview")
    });

    registerCommand({
      name: "review-desktop",
      description: "Capture desktop-assisted browser review with read-only desktop evidence",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/nav/review-desktop"), "runReviewDesktop")
    });

    registerCommand({
      name: "annotate",
      description: "Request interactive annotations via direct or relay transport",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/annotate"), "runAnnotate")
    });

    registerCommand({
      name: "canvas",
      description: "Execute a design-canvas command",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/canvas"), "runCanvas")
    });

    registerCommand({
      name: "rpc",
      description: "Execute an internal daemon RPC command (power-user)",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/rpc"), "runRpc")
    });

    registerCommand({
      name: "click",
      description: "Click an element by ref",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/interact/click"), "runClick")
    });

    registerCommand({
      name: "hover",
      description: "Hover an element by ref",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/interact/hover"), "runHover")
    });

    registerCommand({
      name: "press",
      description: "Press a keyboard key",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/interact/press"), "runPress")
    });

    registerCommand({
      name: "check",
      description: "Check a checkbox by ref",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/interact/check"), "runCheck")
    });

    registerCommand({
      name: "uncheck",
      description: "Uncheck a checkbox by ref",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/interact/uncheck"), "runUncheck")
    });

    registerCommand({
      name: "type",
      description: "Type into an element by ref",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/interact/type"), "runType")
    });

    registerCommand({
      name: "select",
      description: "Select values in a select by ref",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/interact/select"), "runSelect")
    });

    registerCommand({
      name: "scroll",
      description: "Scroll the page or element by ref",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/interact/scroll"), "runScroll")
    });

    registerCommand({
      name: "scroll-into-view",
      description: "Scroll an element into view by ref",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/interact/scroll-into-view"), "runScrollIntoView")
    });

    registerCommand({
      name: "upload",
      description: "Upload files to a file input or chooser by ref",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/interact/upload"), "runUpload")
    });

    registerCommand({
      name: "pointer-move",
      description: "Move the pointer to viewport coordinates",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/interact/pointer-move"), "runPointerMove")
    });

    registerCommand({
      name: "pointer-down",
      description: "Press a mouse button at viewport coordinates",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/interact/pointer-down"), "runPointerDown")
    });

    registerCommand({
      name: "pointer-up",
      description: "Release a mouse button at viewport coordinates",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/interact/pointer-up"), "runPointerUp")
    });

    registerCommand({
      name: "pointer-drag",
      description: "Drag the pointer between two viewport coordinates",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/interact/pointer-drag"), "runPointerDrag")
    });

    registerCommand({
      name: "targets-list",
      description: "List page targets",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/targets/list"), "runTargetsList")
    });

    registerCommand({
      name: "target-use",
      description: "Focus a target by id",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/targets/use"), "runTargetUse")
    });

    registerCommand({
      name: "target-new",
      description: "Open a new target",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/targets/new"), "runTargetNew")
    });

    registerCommand({
      name: "target-close",
      description: "Close a target by id",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/targets/close"), "runTargetClose")
    });

    registerCommand({
      name: "page",
      description: "Open or focus a named page",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/pages/open"), "runPageOpen")
    });

    registerCommand({
      name: "pages",
      description: "List named pages",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/pages/list"), "runPagesList")
    });

    registerCommand({
      name: "page-close",
      description: "Close a named page",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/pages/close"), "runPageClose")
    });

    registerCommand({
      name: "dom-html",
      description: "Capture HTML for a ref",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/dom/html"), "runDomHtml")
    });

    registerCommand({
      name: "dom-text",
      description: "Capture text for a ref",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/dom/text"), "runDomText")
    });

    registerCommand({
      name: "dom-attr",
      description: "Capture attribute value for a ref",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/dom/attr"), "runDomAttr")
    });

    registerCommand({
      name: "dom-value",
      description: "Capture input value for a ref",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/dom/value"), "runDomValue")
    });

    registerCommand({
      name: "dom-visible",
      description: "Check visibility for a ref",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/dom/visible"), "runDomVisible")
    });

    registerCommand({
      name: "dom-enabled",
      description: "Check enabled state for a ref",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/dom/enabled"), "runDomEnabled")
    });

    registerCommand({
      name: "dom-checked",
      description: "Check checked state for a ref",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/dom/checked"), "runDomChecked")
    });

    registerCommand({
      name: "clone-page",
      description: "Clone the active page to React",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/export/clone-page"), "runClonePage")
    });

    registerCommand({
      name: "clone-component",
      description: "Clone a component by ref",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/export/clone-component"), "runCloneComponent")
    });

    registerCommand({
      name: "perf",
      description: "Capture performance metrics",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/devtools/perf"), "runPerf")
    });

    registerCommand({
      name: "screenshot",
      description: "Capture a screenshot",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/devtools/screenshot"), "runScreenshot")
    });

    registerCommand({
      name: "screencast-start",
      description: "Start a browser replay screencast capture",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/devtools/screencast-start"), "runScreencastStart")
    });

    registerCommand({
      name: "screencast-stop",
      description: "Stop a browser replay screencast capture",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/devtools/screencast-stop"), "runScreencastStop")
    });

    registerCommand({
      name: "dialog",
      description: "Inspect or handle a JavaScript dialog",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/devtools/dialog"), "runDialog")
    });

    registerCommand({
      name: "console-poll",
      description: "Poll console events",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/devtools/console-poll"), "runConsolePoll")
    });

    registerCommand({
      name: "network-poll",
      description: "Poll network events",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/devtools/network-poll"), "runNetworkPoll")
    });

    registerCommand({
      name: "debug-trace-snapshot",
      description: "Capture page + console + network + exception diagnostics",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/devtools/debug-trace-snapshot"), "runDebugTraceSnapshot")
    });

    registerCommand({
      name: "desktop-status",
      description: "Inspect public read-only desktop observation availability",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/desktop/status"), "runDesktopStatus")
    });

    registerCommand({
      name: "desktop-windows",
      description: "List windows exposed by the public read-only desktop observation plane",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/desktop/windows"), "runDesktopWindows")
    });

    registerCommand({
      name: "desktop-active-window",
      description: "Inspect the active window through the public read-only desktop observation plane",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/desktop/active-window"), "runDesktopActiveWindow")
    });

    registerCommand({
      name: "desktop-capture-desktop",
      description: "Capture the current desktop surface through the public read-only desktop observation plane",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/desktop/capture-desktop"), "runDesktopCaptureDesktop")
    });

    registerCommand({
      name: "desktop-capture-window",
      description: "Capture a specific window through the public read-only desktop observation plane",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/desktop/capture-window"), "runDesktopCaptureWindow")
    });

    registerCommand({
      name: "desktop-accessibility-snapshot",
      description: "Capture desktop accessibility state through the public read-only desktop observation plane",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/desktop/accessibility-snapshot"), "runDesktopAccessibilitySnapshot")
    });

    registerCommand({
      name: "cookie-import",
      description: "Import validated cookies into a session",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/session/cookie-import"), "runCookieImport")
    });

    registerCommand({
      name: "cookie-list",
      description: "List cookies for a session (optionally filtered by URL)",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/session/cookie-list"), "runCookieList")
    });

    registerCommand({
      name: "macro-resolve",
      description: "Resolve or execute a macro expression via provider actions",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/macro-resolve"), "runMacroResolve")
    });

    registerCommand({
      name: "research",
      description: "Run research workflows",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/research"), "runResearchCommand")
    });

    registerCommand({
      name: "shopping",
      description: "Run shopping workflows",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/shopping"), "runShoppingCommand")
    });

    registerCommand({
      name: "product-video",
      description: "Run product presentation asset workflows",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/product-video"), "runProductVideoCommand")
    });

    registerCommand({
      name: "inspiredesign",
      description: "Run inspiredesign workflows",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/inspiredesign"), "runInspiredesignCommand")
    });

    registerCommand({
      name: "artifacts",
      description: "Manage workflow artifact lifecycle",
      run: (parsedArgs) => runLazyCommand(parsedArgs, () => import("./commands/artifacts"), "runArtifactsCommand")
    });
    const command = getCommand(args.command);
    if (!command) {
      throw new Error(`Unknown command: ${args.command}`);
    }

    const result = await command.run(args);
    await finishCommand(result);
    return;
  } catch (error) {
    const format = outputFormat ?? detectOutputFormat(process.argv);
    const cliError = toCliError(error, parseSucceeded ? EXIT_EXECUTION : EXIT_USAGE);
    emitFatalError(cliError, format);
    await flushOutputAndExit(cliError.exitCode);
    return;
  }
}

main().catch(async (error: unknown) => {
  const cliError = toCliError(error, EXIT_EXECUTION);
  emitFatalError(cliError, detectOutputFormat(process.argv));
  await flushOutputAndExit(cliError.exitCode);
});
