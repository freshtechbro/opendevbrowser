import type { ParsedArgs } from "../args";
import { createUsageError, EXIT_DISCONNECTED, EXIT_EXECUTION } from "../errors";
import { fetchDaemonStatusFromMetadata } from "../daemon-status";
import { DEFAULT_DAEMON_STATUS_FETCH_OPTIONS } from "../daemon-status-policy";
import { createDaemonStopHeaders, readDaemonMetadata } from "../daemon";
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

type StopDaemonResult = {
  outcome: "stopped" | "not_running" | "fingerprint_rejected" | "failed";
  pid?: number;
  port?: number;
  status?: number;
  error?: string;
};

const parseDaemonArgs = (rawArgs: string[]): { subcommand: DaemonSubcommand } => {
  const subcommand = rawArgs[0];
  if (subcommand === "install" || subcommand === "uninstall" || subcommand === "status") {
    return { subcommand };
  }
  throw createUsageError("Usage: opendevbrowser daemon <install|uninstall|status>");
};

const stopDaemonIfRunning = async (): Promise<StopDaemonResult> => {
  const metadata = readDaemonMetadata();
  if (!metadata) {
    return { outcome: "not_running" };
  }
  try {
    const response = await fetchWithTimeout(`http://127.0.0.1:${metadata.port}/stop`, {
      method: "POST",
      headers: createDaemonStopHeaders(metadata.token, "daemon.uninstall")
    });
    if (response.status === 409) {
      return { outcome: "fingerprint_rejected", pid: metadata.pid, port: metadata.port };
    }
    return response.ok
      ? { outcome: "stopped", pid: metadata.pid, port: metadata.port }
      : { outcome: "failed", pid: metadata.pid, port: metadata.port, status: response.status };
  } catch (error) {
    return {
      outcome: "failed",
      pid: metadata.pid,
      port: metadata.port,
      error: error instanceof Error ? error.message : String(error)
    };
  }
};

const buildStopFailureMessage = (stop: StopDaemonResult): string => {
  const target = stop.port ? `127.0.0.1:${stop.port}` : "recorded daemon";
  const pid = stop.pid ? ` pid=${stop.pid}` : "";
  if (stop.outcome === "fingerprint_rejected") {
    return `Daemon autostart removed, but the running daemon at ${target}${pid} rejected the stop request as stale. Run \`opendevbrowser status --daemon\` to inspect it and restart from the current install if needed.`;
  }
  const reason = stop.error ?? (stop.status ? `HTTP ${stop.status}` : "unknown error");
  return `Daemon autostart removed, but stopping ${target}${pid} failed (${reason}).`;
};

const shouldFailUninstallStop = (stop: StopDaemonResult): boolean => {
  if (stop.outcome === "stopped" || stop.outcome === "not_running") {
    return false;
  }
  return true;
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
    const stop = await stopDaemonIfRunning();
    if (shouldFailUninstallStop(stop)) {
      return {
        success: false,
        message: buildStopFailureMessage(stop),
        data: { ...result, stop },
        exitCode: EXIT_EXECUTION
      };
    }
    return {
      success: true,
      message: `Daemon autostart removed (${result.platform}).`,
      data: result
    };
  }

  const autostart = getAutostartStatus();
  const daemonStatus = await fetchDaemonStatusFromMetadata(undefined, DEFAULT_DAEMON_STATUS_FETCH_OPTIONS);
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
