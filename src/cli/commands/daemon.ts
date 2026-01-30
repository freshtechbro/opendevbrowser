import type { ParsedArgs } from "../args";
import { createUsageError, EXIT_DISCONNECTED, EXIT_EXECUTION } from "../errors";
import { fetchDaemonStatusFromMetadata } from "../daemon-status";
import { readDaemonMetadata } from "../daemon";
import { fetchWithTimeout } from "../utils/http";
import { getAutostartStatus, installAutostart, uninstallAutostart } from "../daemon-autostart";

type DaemonSubcommand = "install" | "uninstall" | "status";

type DaemonResult = {
  installed: boolean;
  running: boolean;
  autostart?: ReturnType<typeof getAutostartStatus>;
};

const parseDaemonArgs = (rawArgs: string[]): { subcommand: DaemonSubcommand } => {
  const subcommand = rawArgs[0];
  if (subcommand === "install" || subcommand === "uninstall" || subcommand === "status") {
    return { subcommand };
  }
  throw createUsageError("Usage: opendevbrowser daemon <install|uninstall|status>");
};

const stopDaemonIfRunning = async (): Promise<boolean> => {
  const metadata = readDaemonMetadata();
  if (!metadata) {
    return false;
  }
  try {
    const response = await fetchWithTimeout(`http://127.0.0.1:${metadata.port}/stop`, {
      method: "POST",
      headers: { Authorization: `Bearer ${metadata.token}` }
    });
    return response.ok;
  } catch {
    return false;
  }
};

const buildStatusMessage = (autostart: ReturnType<typeof getAutostartStatus>, running: boolean): string => {
  if (!autostart.supported) {
    return `Daemon autostart is not supported on ${autostart.platform}.`;
  }

  const installed = autostart.installed ? "installed" : "not installed";
  const runningText = running ? "running" : "not running";
  const location = autostart.location ? ` at ${autostart.location}` : "";
  const task = autostart.taskName ? ` (${autostart.taskName})` : "";
  return `Autostart ${installed}${location}${task}. Daemon is ${runningText}.`;
};

export async function runDaemonCommand(args: ParsedArgs) {
  const { subcommand } = parseDaemonArgs(args.rawArgs);

  if (subcommand === "install") {
    const result = installAutostart();
    if (!result.supported) {
      return {
        success: false,
        message: `Daemon autostart is not supported on ${result.platform}.`,
        data: result,
        exitCode: EXIT_EXECUTION
      };
    }
    return {
      success: true,
      message: `Daemon autostart installed (${result.platform}).`,
      data: result
    };
  }

  if (subcommand === "uninstall") {
    const result = uninstallAutostart();
    if (!result.supported) {
      return {
        success: false,
        message: `Daemon autostart is not supported on ${result.platform}.`,
        data: result,
        exitCode: EXIT_EXECUTION
      };
    }
    await stopDaemonIfRunning();
    return {
      success: true,
      message: `Daemon autostart removed (${result.platform}).`,
      data: result
    };
  }

  const autostart = getAutostartStatus();
  const daemonStatus = await fetchDaemonStatusFromMetadata();
  const running = Boolean(daemonStatus);
  const message = buildStatusMessage(autostart, running);
  const data: DaemonResult = {
    installed: autostart.installed,
    running,
    autostart: autostart.supported ? autostart : undefined
  };

  if (!running) {
    return {
      success: false,
      message,
      data,
      exitCode: EXIT_DISCONNECTED
    };
  }

  return {
    success: true,
    message,
    data: { ...data, status: daemonStatus }
  };
}
