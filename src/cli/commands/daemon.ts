import type { ParsedArgs } from "../args";
import { createUsageError, EXIT_DISCONNECTED, EXIT_EXECUTION } from "../errors";
import { fetchDaemonStatusFromMetadata } from "../daemon-status";
import { readDaemonMetadata } from "../daemon";
import { fetchWithTimeout } from "../utils/http";
import {
  getAutostartStatus,
  installAutostart,
  isTransientAutostartInstallError,
  STABLE_DAEMON_INSTALL_GUIDANCE,
  uninstallAutostart
} from "../daemon-autostart";

type DaemonSubcommand = "install" | "uninstall" | "status";

type DaemonResult = {
  installed: boolean;
  running: boolean;
  autostart?: ReturnType<typeof getAutostartStatus>;
  status?: Awaited<ReturnType<typeof fetchDaemonStatusFromMetadata>>;
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

const formatReason = (reason?: ReturnType<typeof getAutostartStatus>["reason"]): string => {
  return reason ? reason.replace(/_/g, " ") : "unknown reason";
};

const buildStableAutostartGuidance = (action: "install" | "repair"): string => {
  return `${STABLE_DAEMON_INSTALL_GUIDANCE.replace(/\.$/, "")} to ${action} it.`;
};

const describeAutostartLocation = (autostart: ReturnType<typeof getAutostartStatus>): string => {
  if (autostart.location) {
    return ` at ${autostart.location}`;
  }
  if (autostart.taskName) {
    return ` (${autostart.taskName})`;
  }
  return "";
};

const buildStatusMessage = (autostart: ReturnType<typeof getAutostartStatus>, running: boolean): string => {
  const runningText = running ? "running" : "not running";

  if (!autostart.supported) {
    return `Daemon autostart is not supported on ${autostart.platform}. Daemon is ${runningText}.`;
  }

  const location = describeAutostartLocation(autostart);

  if (autostart.health === "healthy") {
    return `Autostart is installed and healthy${location}. Daemon is ${runningText}.`;
  }

  if (autostart.health === "missing") {
    return `Autostart is not installed${location}. ${buildStableAutostartGuidance("install")} Daemon is ${runningText}.`;
  }

  if (autostart.health === "needs_repair") {
    return `Autostart is installed${location} but needs repair (${formatReason(autostart.reason)}). ${buildStableAutostartGuidance("repair")} Daemon is ${runningText}.`;
  }

  if (autostart.health === "malformed") {
    return `Autostart exists${location} but is malformed (${formatReason(autostart.reason)}). ${buildStableAutostartGuidance("repair")} Daemon is ${runningText}.`;
  }

  return `Daemon autostart is not supported on ${autostart.platform}. Daemon is ${runningText}.`;
};

export async function runDaemonCommand(args: ParsedArgs) {
  const { subcommand } = parseDaemonArgs(args.rawArgs);

  if (subcommand === "install") {
    let result;
    try {
      result = installAutostart();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: isTransientAutostartInstallError(error)
          ? message
          : `Daemon autostart install failed: ${message}`,
        exitCode: EXIT_EXECUTION
      };
    }
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
