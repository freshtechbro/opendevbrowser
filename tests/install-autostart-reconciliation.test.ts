import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  INSTALL_AUTOSTART_SKIP_ENV_VAR,
  reconcileInstallAutostart
} from "../src/cli/install-autostart-reconciliation";
import type { AutostartStatus } from "../src/cli/daemon-autostart";

const makeStatus = (overrides: Partial<AutostartStatus> = {}): AutostartStatus => ({
  platform: "darwin",
  supported: true,
  installed: true,
  health: "healthy",
  needsRepair: false,
  location: "/tmp/com.opendevbrowser.daemon.plist",
  label: "com.opendevbrowser.daemon",
  command: "\"/node\" \"/cli/index.js\" serve",
  expectedCommand: "\"/node\" \"/cli/index.js\" serve",
  ...overrides
});

describe("reconcileInstallAutostart", () => {
  const getAutostartStatus = vi.fn<() => AutostartStatus>();
  const installAutostart = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does nothing when the plugin install failed", () => {
    const result = reconcileInstallAutostart(
      { success: false, alreadyInstalled: false },
      { getAutostartStatus, installAutostart }
    );

    expect(result).toEqual({ attempted: false });
    expect(getAutostartStatus).not.toHaveBeenCalled();
    expect(installAutostart).not.toHaveBeenCalled();
  });

  it("skips reconciliation when the current env marks the install as ephemeral", () => {
    const result = reconcileInstallAutostart(
      { success: true, alreadyInstalled: false },
      { getAutostartStatus, installAutostart },
      { env: { [INSTALL_AUTOSTART_SKIP_ENV_VAR]: "1" } }
    );

    expect(result).toEqual({ attempted: false });
    expect(getAutostartStatus).not.toHaveBeenCalled();
    expect(installAutostart).not.toHaveBeenCalled();
  });

  it("reports unsupported when autostart is unavailable on the platform", () => {
    const status = makeStatus({
      platform: "linux",
      supported: false,
      installed: false,
      health: "unsupported",
      needsRepair: false,
      reason: "unsupported_platform",
      location: undefined,
      label: undefined,
      command: undefined,
      expectedCommand: undefined
    });
    getAutostartStatus.mockReturnValue(status);

    const result = reconcileInstallAutostart(
      { success: true, alreadyInstalled: false },
      { getAutostartStatus, installAutostart }
    );

    expect(result).toEqual({
      attempted: false,
      autostart: status,
      autostartAction: "unsupported"
    });
    expect(installAutostart).not.toHaveBeenCalled();
  });

  it("reports already_healthy when autostart already matches the current entrypoint", () => {
    const status = makeStatus();
    getAutostartStatus.mockReturnValue(status);

    const result = reconcileInstallAutostart(
      { success: true, alreadyInstalled: false },
      { getAutostartStatus, installAutostart }
    );

    expect(result).toEqual({
      attempted: false,
      autostart: status,
      autostartAction: "already_healthy"
    });
    expect(installAutostart).not.toHaveBeenCalled();
  });

  it("installs missing autostart entries even for alreadyInstalled local installs", () => {
    const preStatus = makeStatus({
      installed: false,
      health: "missing",
      needsRepair: false,
      reason: "missing_plist",
      command: undefined
    });
    const postStatus = makeStatus();
    getAutostartStatus.mockReturnValue(preStatus);
    installAutostart.mockReturnValue(postStatus);

    const result = reconcileInstallAutostart(
      { success: true, alreadyInstalled: true },
      { getAutostartStatus, installAutostart }
    );

    expect(result).toEqual({
      attempted: true,
      autostart: postStatus,
      autostartAction: "installed"
    });
    expect(installAutostart).toHaveBeenCalledTimes(1);
  });

  it("installs missing autostart entries even for alreadyInstalled global installs", () => {
    const preStatus = makeStatus({
      installed: false,
      health: "missing",
      needsRepair: false,
      reason: "missing_plist",
      command: undefined
    });
    const postStatus = makeStatus();
    getAutostartStatus.mockReturnValue(preStatus);
    installAutostart.mockReturnValue(postStatus);

    const result = reconcileInstallAutostart(
      {
        success: true,
        alreadyInstalled: true,
        configPath: "/Users/test/.config/opencode/opencode.json"
      } as { success: boolean; alreadyInstalled: boolean },
      { getAutostartStatus, installAutostart }
    );

    expect(result).toEqual({
      attempted: true,
      autostart: postStatus,
      autostartAction: "installed"
    });
    expect(installAutostart).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      name: "needs_repair",
      preStatus: makeStatus({
        health: "needs_repair",
        needsRepair: true,
        reason: "missing_cli_path",
        command: "\"/node\" \"/old/cli/index.js\" serve"
      })
    },
    {
      name: "malformed",
      preStatus: makeStatus({
        health: "malformed",
        needsRepair: true,
        reason: "malformed_plist",
        command: undefined
      })
    }
  ])("reconciles $name autostart states even for alreadyInstalled installs", ({ preStatus }) => {
    const postStatus = makeStatus();
    getAutostartStatus.mockReturnValue(preStatus);
    installAutostart.mockReturnValue(postStatus);

    const result = reconcileInstallAutostart(
      { success: true, alreadyInstalled: true },
      { getAutostartStatus, installAutostart }
    );

    expect(result).toEqual({
      attempted: true,
      autostart: postStatus,
      autostartAction: "repaired"
    });
  });

  it("repairs needs_repair states by rewriting the autostart entry", () => {
    const preStatus = makeStatus({
      health: "needs_repair",
      needsRepair: true,
      reason: "missing_cli_path",
      command: "\"/node\" \"/old/cli/index.js\" serve"
    });
    const postStatus = makeStatus();
    getAutostartStatus.mockReturnValue(preStatus);
    installAutostart.mockReturnValue(postStatus);

    const result = reconcileInstallAutostart(
      { success: true, alreadyInstalled: false },
      { getAutostartStatus, installAutostart }
    );

    expect(result).toEqual({
      attempted: true,
      autostart: postStatus,
      autostartAction: "repaired"
    });
  });

  it("repairs Windows needs_repair states returned by persisted task inspection", () => {
    const preStatus = makeStatus({
      platform: "win32",
      location: undefined,
      label: undefined,
      taskName: "OpenDevBrowser Daemon",
      health: "needs_repair",
      needsRepair: true,
      reason: "missing_cli_path",
      command: "\"C:\\Program Files\\nodejs\\node.exe\" \"C:\\old\\opendevbrowser\\index.js\" serve",
      expectedCommand: "\"C:\\Program Files\\nodejs\\node.exe\" \"C:\\Users\\test\\opendevbrowser\\index.js\" serve"
    });
    const postStatus = makeStatus({
      platform: "win32",
      location: undefined,
      label: undefined,
      taskName: "OpenDevBrowser Daemon",
      command: "\"C:\\Program Files\\nodejs\\node.exe\" \"C:\\Users\\test\\opendevbrowser\\index.js\" serve",
      expectedCommand: "\"C:\\Program Files\\nodejs\\node.exe\" \"C:\\Users\\test\\opendevbrowser\\index.js\" serve"
    });
    getAutostartStatus.mockReturnValue(preStatus);
    installAutostart.mockReturnValue(postStatus);

    const result = reconcileInstallAutostart(
      { success: true, alreadyInstalled: false },
      { getAutostartStatus, installAutostart }
    );

    expect(result).toEqual({
      attempted: true,
      autostart: postStatus,
      autostartAction: "repaired"
    });
  });

  it("repairs malformed autostart entries by rewriting the autostart entry", () => {
    const preStatus = makeStatus({
      health: "malformed",
      needsRepair: true,
      reason: "malformed_plist",
      command: undefined
    });
    const postStatus = makeStatus();
    getAutostartStatus.mockReturnValue(preStatus);
    installAutostart.mockReturnValue(postStatus);

    const result = reconcileInstallAutostart(
      { success: true, alreadyInstalled: false },
      { getAutostartStatus, installAutostart }
    );

    expect(result).toEqual({
      attempted: true,
      autostart: postStatus,
      autostartAction: "repaired"
    });
  });

  it("surfaces repair_failed with a post-attempt reread snapshot when repair throws", () => {
    const preStatus = makeStatus({
      health: "needs_repair",
      needsRepair: true,
      reason: "entrypoint_mismatch",
      command: "\"/node\" \"/old/cli/index.js\" serve"
    });
    const postStatus = makeStatus({
      health: "malformed",
      needsRepair: true,
      reason: "missing_program_arguments",
      command: undefined
    });
    getAutostartStatus.mockReturnValueOnce(preStatus).mockReturnValueOnce(postStatus);
    installAutostart.mockImplementation(() => {
      throw new Error("launchctl bootstrap failed");
    });

    const result = reconcileInstallAutostart(
      { success: true, alreadyInstalled: false },
      { getAutostartStatus, installAutostart }
    );

    expect(result).toEqual({
      attempted: true,
      autostart: postStatus,
      autostartAction: "repair_failed",
      autostartError: "launchctl bootstrap failed"
    });
  });

  it("keeps repair_failed semantics when transient current paths block autostart repair", () => {
    const preStatus = makeStatus({
      installed: false,
      health: "missing",
      needsRepair: false,
      reason: "missing_plist",
      command: undefined
    });
    const postStatus = makeStatus({
      health: "needs_repair",
      needsRepair: true,
      reason: "transient_cli_path",
      command: "\"/node\" \"/tmp/_npx/opendevbrowser/dist/cli/index.js\" serve",
      expectedCommand: undefined
    });
    const transientError =
      "Cannot install daemon autostart from transient CLI path "
      + "\"/tmp/_npx/opendevbrowser/dist/cli/index.js\". "
      + "Run opendevbrowser daemon install from a stable install location (for example, a global npm install or a persistent local package install). "
      + "Do not use a temporary npx cache or onboarding workspace.";
    getAutostartStatus.mockReturnValueOnce(preStatus).mockReturnValueOnce(postStatus);
    installAutostart.mockImplementation(() => {
      throw new Error(transientError);
    });

    const result = reconcileInstallAutostart(
      { success: true, alreadyInstalled: false },
      { getAutostartStatus, installAutostart }
    );

    expect(result).toEqual({
      attempted: true,
      autostart: postStatus,
      autostartAction: "repair_failed",
      autostartError: transientError
    });
  });

  it("falls back to the pre-attempt snapshot when rereading status after failure also throws", () => {
    const preStatus = makeStatus({
      health: "malformed",
      needsRepair: true,
      reason: "malformed_plist",
      command: undefined
    });
    getAutostartStatus.mockReturnValueOnce(preStatus).mockImplementation(() => {
      throw new Error("plutil unavailable");
    });
    installAutostart.mockImplementation(() => {
      throw new Error("launchctl bootstrap failed");
    });

    const result = reconcileInstallAutostart(
      { success: true, alreadyInstalled: false },
      { getAutostartStatus, installAutostart }
    );

    expect(result).toEqual({
      attempted: true,
      autostart: preStatus,
      autostartAction: "repair_failed",
      autostartError: "launchctl bootstrap failed"
    });
  });

  it("keeps transient entrypoint refusal on the existing repair_failed contract", () => {
    const preStatus = makeStatus({
      installed: false,
      health: "missing",
      needsRepair: false,
      reason: "missing_plist",
      command: undefined
    });
    getAutostartStatus.mockReturnValueOnce(preStatus).mockReturnValueOnce(preStatus);
    installAutostart.mockImplementation(() => {
      throw new Error(
        "Cannot install daemon autostart from transient CLI path "
        + "\"/private/tmp/opendevbrowser-first-run/index.js\". "
        + "Re-run opendevbrowser daemon install from a stable installation path "
        + "(for example a non-temp npm install or global install)."
      );
    });

    const result = reconcileInstallAutostart(
      { success: true, alreadyInstalled: false },
      { getAutostartStatus, installAutostart }
    );

    expect(result).toEqual({
      attempted: true,
      autostart: preStatus,
      autostartAction: "repair_failed",
      autostartError: expect.stringContaining("transient CLI path")
    });
  });

  it("keeps repair_failed semantics for Windows transient task snapshots", () => {
    const transientCommand =
      "\"C:\\Program Files\\nodejs\\node.exe\" "
      + "\"C:\\Users\\test\\AppData\\Local\\npm-cache\\_npx\\runner\\node_modules\\opendevbrowser\\dist\\cli\\index.js\" serve";
    const preStatus = makeStatus({
      platform: "win32",
      location: undefined,
      label: undefined,
      taskName: "OpenDevBrowser Daemon",
      health: "needs_repair",
      needsRepair: true,
      reason: "transient_cli_path",
      command: transientCommand,
      expectedCommand: undefined
    });
    const transientError =
      "Cannot install daemon autostart from transient CLI path "
      + "\"C:\\Users\\test\\AppData\\Local\\npm-cache\\_npx\\runner\\node_modules\\opendevbrowser\\dist\\cli\\index.js\". "
      + "Run opendevbrowser daemon install from a stable install location (for example, a global npm install or a persistent local package install). "
      + "Do not use a temporary npx cache or onboarding workspace.";
    getAutostartStatus.mockReturnValueOnce(preStatus).mockReturnValueOnce(preStatus);
    installAutostart.mockImplementation(() => {
      throw new Error(transientError);
    });

    const result = reconcileInstallAutostart(
      { success: true, alreadyInstalled: false },
      { getAutostartStatus, installAutostart }
    );

    expect(result).toEqual({
      attempted: true,
      autostart: preStatus,
      autostartAction: "repair_failed",
      autostartError: transientError
    });
  });

  it("keeps repair_failed semantics for alreadyInstalled repair attempts", () => {
    const preStatus = makeStatus({
      health: "needs_repair",
      needsRepair: true,
      reason: "missing_cli_path",
      command: "\"/node\" \"/old/cli/index.js\" serve"
    });
    const postStatus = makeStatus({
      health: "malformed",
      needsRepair: true,
      reason: "missing_program_arguments",
      command: undefined
    });
    getAutostartStatus.mockReturnValueOnce(preStatus).mockReturnValueOnce(postStatus);
    installAutostart.mockImplementation(() => {
      throw new Error("launchctl bootstrap failed");
    });

    const result = reconcileInstallAutostart(
      { success: true, alreadyInstalled: true },
      { getAutostartStatus, installAutostart }
    );

    expect(result).toEqual({
      attempted: true,
      autostart: postStatus,
      autostartAction: "repair_failed",
      autostartError: "launchctl bootstrap failed"
    });
  });
});
