import {
  isTransientAutostartInstallError,
  STABLE_DAEMON_INSTALL_GUIDANCE
} from "./daemon-autostart";
import type { InstallAutostartReconciliationResult } from "./install-autostart-reconciliation";

export function createInstallAutostartOutputPayload(
  result?: InstallAutostartReconciliationResult
): Record<string, unknown> {
  if (!result) {
    return {};
  }

  return {
    autostart: result.autostart,
    autostartAction: result.autostartAction,
    ...(result.autostartAction === "repair_failed" && result.autostartError
      ? { autostartError: result.autostartError }
      : {})
  };
}

export function formatAutostartReconciliationMessage(
  result: InstallAutostartReconciliationResult
): string | null {
  switch (result.autostartAction) {
    case "unsupported":
      return result.autostart
        ? `Autostart not supported on ${result.autostart.platform}.`
        : "Autostart not supported on this platform.";
    case "already_healthy":
      return "Autostart already healthy.";
    case "installed":
      return result.autostart
        ? `Autostart installed (${result.autostart.platform}).`
        : "Autostart installed.";
    case "repaired":
      return result.autostart
        ? `Autostart repaired (${result.autostart.platform}).`
        : "Autostart repaired.";
    case "repair_failed":
      if (result.autostartError && isTransientAutostartInstallError(result.autostartError)) {
        return `Plugin install succeeded but autostart repair was skipped because the current CLI path is transient: ${result.autostartError}`;
      }
      return `Plugin install succeeded but autostart repair failed: ${result.autostartError ?? "unknown error"}. Run opendevbrowser daemon install to repair it.`;
    default:
      return null;
  }
}

export { STABLE_DAEMON_INSTALL_GUIDANCE };
