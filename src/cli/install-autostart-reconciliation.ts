import { getAutostartStatus, installAutostart } from "./daemon-autostart";
import type { AutostartInstallResult, AutostartStatus } from "./daemon-autostart";

export const INSTALL_AUTOSTART_SKIP_ENV_VAR = "OPDEVBROWSER_SKIP_INSTALL_AUTOSTART_RECONCILIATION";

export type InstallResultLike = {
  success: boolean;
  alreadyInstalled: boolean;
};

export type AutostartAction =
  | "unsupported"
  | "already_healthy"
  | "installed"
  | "repaired"
  | "repair_failed";

export type InstallAutostartReconciliationResult = {
  attempted: boolean;
  autostart?: AutostartStatus;
  autostartAction?: AutostartAction;
  autostartError?: string;
};

export type InstallAutostartReconciliationDeps = {
  getAutostartStatus?: () => AutostartStatus;
  installAutostart?: () => AutostartInstallResult;
};

export type InstallAutostartReconciliationOptions = {
  env?: NodeJS.ProcessEnv;
};

const defaultDeps = (): Required<InstallAutostartReconciliationDeps> => ({
  getAutostartStatus,
  installAutostart
});

export function shouldSkipInstallAutostartReconciliation(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[INSTALL_AUTOSTART_SKIP_ENV_VAR];
  if (raw === undefined) {
    return false;
  }
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export function reconcileInstallAutostart(
  installResult: InstallResultLike,
  deps: InstallAutostartReconciliationDeps = {},
  options: InstallAutostartReconciliationOptions = {}
): InstallAutostartReconciliationResult {
  if (!installResult.success || shouldSkipInstallAutostartReconciliation(options.env)) {
    return { attempted: false };
  }

  const resolved = { ...defaultDeps(), ...deps };
  const status = resolved.getAutostartStatus();

  if (!status.supported) {
    return {
      attempted: false,
      autostart: status,
      autostartAction: "unsupported"
    };
  }

  if (status.health === "healthy") {
    return {
      attempted: false,
      autostart: status,
      autostartAction: "already_healthy"
    };
  }

  if (status.health !== "missing" && status.health !== "needs_repair" && status.health !== "malformed") {
    return {
      attempted: false,
      autostart: status
    };
  }

  try {
    const autostart = resolved.installAutostart();
    return {
      attempted: true,
      autostart,
      autostartAction: status.health === "missing" ? "installed" : "repaired"
    };
  } catch (error) {
    let autostart = status;
    try {
      autostart = resolved.getAutostartStatus();
    } catch {
      autostart = status;
    }

    return {
      attempted: true,
      autostart,
      autostartAction: "repair_failed",
      autostartError: error instanceof Error ? error.message : String(error)
    };
  }
}
