import { describe, expect, it } from "vitest";
import {
  createInstallAutostartOutputPayload,
  formatAutostartReconciliationMessage,
  STABLE_DAEMON_INSTALL_GUIDANCE
} from "../src/cli/install-autostart-output";
import type { AutostartStatus } from "../src/cli/daemon-autostart";
import type { InstallAutostartReconciliationResult } from "../src/cli/install-autostart-reconciliation";

const makeAutostartStatus = (overrides: Partial<AutostartStatus> = {}): AutostartStatus => ({
  platform: "darwin",
  supported: true,
  installed: true,
  health: "healthy",
  needsRepair: false,
  location: "/Users/test/Library/LaunchAgents/com.opendevbrowser.daemon.plist",
  label: "com.opendevbrowser.daemon",
  command: "\"/node\" \"/cli/index.js\" \"serve\"",
  expectedCommand: "\"/node\" \"/cli/index.js\" \"serve\"",
  ...overrides
});

const makeResult = (
  overrides: Partial<InstallAutostartReconciliationResult> = {}
): InstallAutostartReconciliationResult => ({
  attempted: false,
  autostart: makeAutostartStatus(),
  autostartAction: "already_healthy",
  ...overrides
});

describe("install autostart output helpers", () => {
  it("omits autostart fields when reconciliation did not run", () => {
    expect(createInstallAutostartOutputPayload(undefined)).toEqual({});
  });

  it("includes autostart and action for successful reconciliation outcomes", () => {
    expect(createInstallAutostartOutputPayload(makeResult({
      attempted: true,
      autostartAction: "installed"
    }))).toEqual({
      autostart: makeAutostartStatus(),
      autostartAction: "installed"
    });
  });

  it("includes autostartError only for repair_failed", () => {
    expect(createInstallAutostartOutputPayload(makeResult({
      attempted: true,
      autostartAction: "repair_failed",
      autostartError: "launchctl bootstrap failed"
    }))).toEqual({
      autostart: makeAutostartStatus(),
      autostartAction: "repair_failed",
      autostartError: "launchctl bootstrap failed"
    });
  });

  it("formats transient repair failures without duplicating stable-install guidance", () => {
    const message = formatAutostartReconciliationMessage(makeResult({
      attempted: true,
      autostartAction: "repair_failed",
      autostartError:
        "Cannot install daemon autostart from transient CLI path "
        + "\"/tmp/_npx/opendevbrowser/dist/cli/index.js\". "
        + `${STABLE_DAEMON_INSTALL_GUIDANCE} `
        + "Do not use a temporary npx cache or onboarding workspace."
    }));

    expect(message).toContain("current CLI path is transient");
    expect(message).toContain(STABLE_DAEMON_INSTALL_GUIDANCE);
    expect(message?.match(new RegExp(STABLE_DAEMON_INSTALL_GUIDANCE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))).toHaveLength(1);
  });

  it("formats generic repair failures with explicit manual repair guidance", () => {
    expect(formatAutostartReconciliationMessage(makeResult({
      attempted: true,
      autostartAction: "repair_failed",
      autostartError: "launchctl bootstrap failed"
    }))).toBe(
      "Plugin install succeeded but autostart repair failed: launchctl bootstrap failed. "
      + "Run opendevbrowser daemon install to repair it."
    );
  });

  it("formats supported steady-state actions", () => {
    expect(formatAutostartReconciliationMessage(makeResult({
      attempted: false,
      autostartAction: "already_healthy"
    }))).toBe("Autostart already healthy.");

    expect(formatAutostartReconciliationMessage(makeResult({
      attempted: true,
      autostartAction: "installed"
    }))).toBe("Autostart installed (darwin).");

    expect(formatAutostartReconciliationMessage(makeResult({
      attempted: true,
      autostartAction: "repaired"
    }))).toBe("Autostart repaired (darwin).");
  });
});
