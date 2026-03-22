import { getAutostartStatus, installAutostart } from "./daemon-autostart";
import type { AutostartInstallResult, AutostartStatus } from "./daemon-autostart";

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

const defaultDeps = (): Required<InstallAutostartReconciliationDeps> => ({
  getAutostartStatus,
  installAutostart
});

export function reconcileInstallAutostart(
  installResult: InstallResultLike,
  deps: InstallAutostartReconciliationDeps = {}
): InstallAutostartReconciliationResult {
  if (!installResult.success) {
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
