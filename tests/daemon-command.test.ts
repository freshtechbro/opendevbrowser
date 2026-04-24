import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedArgs } from "../src/cli/args";
import { resolveExitCode } from "../src/cli/errors";
import type { AutostartStatus } from "../src/cli/daemon-autostart";

const makeAutostartStatus = (overrides: Partial<AutostartStatus> = {}): AutostartStatus => ({
  platform: "darwin",
  supported: true,
  installed: true,
  health: "healthy",
  needsRepair: false,
  location: "/tmp/agent.plist",
  label: "com.opendevbrowser.daemon",
  command: "\"/node\" \"/cli/index.js\" serve",
  expectedCommand: "\"/node\" \"/cli/index.js\" serve",
  ...overrides
});

const installAutostart = vi.fn();
const uninstallAutostart = vi.fn();
const getAutostartStatus = vi.fn();
const fetchDaemonStatusFromMetadata = vi.fn(async () => null);
const readDaemonMetadata = vi.fn(() => null);
const createDaemonStopHeaders = vi.fn((token: string, reason: string) => ({
  Authorization: `Bearer ${token}`,
  "x-test-stop-reason": reason
}));
const fetchWithTimeout = vi.fn(async () => ({ ok: true }));
const STABLE_DAEMON_INSTALL_GUIDANCE =
  "Run opendevbrowser daemon install from a stable installation path.";
const isTransientAutostartInstallError = vi.fn((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return message.startsWith("Cannot install daemon autostart from transient CLI path");
});

vi.mock("../src/cli/daemon-autostart", () => ({
  installAutostart,
  uninstallAutostart,
  getAutostartStatus,
  isTransientAutostartInstallError,
  STABLE_DAEMON_INSTALL_GUIDANCE
}));

vi.mock("../src/cli/daemon-status", () => ({
  fetchDaemonStatusFromMetadata
}));

vi.mock("../src/cli/daemon", () => ({
  createDaemonStopHeaders,
  readDaemonMetadata
}));

vi.mock("../src/cli/utils/http", () => ({
  fetchWithTimeout
}));

const buildArgs = (rawArgs: string[]): ParsedArgs => ({
  command: "daemon",
  mode: undefined,
  withConfig: false,
  noPrompt: true,
  noInteractive: true,
  quiet: false,
  outputFormat: "json",
  transport: "relay",
  skillsMode: "none",
  fullInstall: false,
  rawArgs
});

describe("daemon command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installAutostart.mockReturnValue(makeAutostartStatus());
    uninstallAutostart.mockReturnValue(makeAutostartStatus({
      installed: false,
      health: "missing",
      needsRepair: false,
      reason: "missing_plist",
      command: undefined
    }));
    getAutostartStatus.mockReturnValue(makeAutostartStatus());
    fetchDaemonStatusFromMetadata.mockResolvedValue(null);
    readDaemonMetadata.mockReturnValue(null);
    createDaemonStopHeaders.mockImplementation((token: string, reason: string) => ({
      Authorization: `Bearer ${token}`,
      "x-test-stop-reason": reason
    }));
    fetchWithTimeout.mockResolvedValue({ ok: true });
  });

  it("installs autostart", async () => {
    const { runDaemonCommand } = await import("../src/cli/commands/daemon");
    const result = await runDaemonCommand(buildArgs(["install"]));

    expect(result.success).toBe(true);
    expect(result.message).toContain("installed");
    expect(installAutostart).toHaveBeenCalledTimes(1);
  });

  it("returns an execution failure when daemon install is attempted from a transient CLI path", async () => {
    installAutostart.mockImplementation(() => {
      throw new Error(
        "Cannot install daemon autostart from transient CLI path "
        + "\"/tmp/_npx/opendevbrowser/dist/cli/index.js\". "
        + `${STABLE_DAEMON_INSTALL_GUIDANCE} `
        + "Do not use a temporary npx cache or onboarding workspace."
      );
    });

    const { runDaemonCommand } = await import("../src/cli/commands/daemon");
    const result = await runDaemonCommand(buildArgs(["install"]));

    expect(result.success).toBe(false);
    expect(resolveExitCode(result)).toBe(2);
    expect(result.message).toContain("transient CLI path");
    expect(result.message).toContain("stable installation path");
  });

  it("uninstalls autostart", async () => {
    const { runDaemonCommand } = await import("../src/cli/commands/daemon");
    const result = await runDaemonCommand(buildArgs(["uninstall"]));

    expect(result.success).toBe(true);
    expect(result.message).toContain("removed");
    expect(uninstallAutostart).toHaveBeenCalledTimes(1);
  });

  it("tags uninstall stop requests for debug attribution", async () => {
    readDaemonMetadata.mockReturnValue({
      port: 8788,
      token: "daemon-token",
      pid: 8080,
      relayPort: 8787,
      startedAt: new Date().toISOString(),
      fingerprint: "current-fingerprint"
    });

    const { runDaemonCommand } = await import("../src/cli/commands/daemon");
    const result = await runDaemonCommand(buildArgs(["uninstall"]));

    expect(result.success).toBe(true);
    expect(createDaemonStopHeaders).toHaveBeenCalledWith("daemon-token", "daemon.uninstall");
    expect(fetchWithTimeout).toHaveBeenCalledWith(
      "http://127.0.0.1:8788/stop",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer daemon-token",
          "x-test-stop-reason": "daemon.uninstall"
        }
      }
    );
  });

  it("reports stale fingerprint stop rejections during uninstall", async () => {
    readDaemonMetadata.mockReturnValue({
      port: 8788,
      token: "daemon-token",
      pid: 8080,
      relayPort: 8787,
      startedAt: new Date().toISOString(),
      fingerprint: "stale-fingerprint"
    });
    fetchWithTimeout.mockResolvedValue({ ok: false, status: 409 });

    const { runDaemonCommand } = await import("../src/cli/commands/daemon");
    const result = await runDaemonCommand(buildArgs(["uninstall"]));

    expect(result.success).toBe(false);
    expect(resolveExitCode(result)).toBe(2);
    expect(result.message).toContain("rejected the stop request as stale");
    expect(result.message).toContain("127.0.0.1:8788 pid=8080");
    expect(result.message).toContain("opendevbrowser status --daemon");
    expect(result.data).toMatchObject({
      stop: {
        outcome: "fingerprint_rejected",
        pid: 8080,
        port: 8788
      }
    });
  });

  it("returns healthy running status with nested autostart data", async () => {
    fetchDaemonStatusFromMetadata.mockResolvedValue({ pid: 1234, port: 0 });

    const { runDaemonCommand } = await import("../src/cli/commands/daemon");
    const result = await runDaemonCommand(buildArgs(["status"]));

    expect(result.success).toBe(true);
    expect(resolveExitCode(result)).toBe(0);
    expect(result.message).toContain("healthy");
    expect((result.data as { autostart: AutostartStatus }).autostart.health).toBe("healthy");
    expect((result.data as { status: { pid: number } }).status.pid).toBe(1234);
    expect(fetchDaemonStatusFromMetadata).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ timeoutMs: 5_000, retryAttempts: 5, retryDelayMs: 250 })
    );
  });

  it("keeps status successful when autostart is missing but daemon is running", async () => {
    getAutostartStatus.mockReturnValue(makeAutostartStatus({
      installed: false,
      health: "missing",
      needsRepair: false,
      reason: "missing_plist",
      command: undefined
    }));
    fetchDaemonStatusFromMetadata.mockResolvedValue({ pid: 1234, port: 0 });

    const { runDaemonCommand } = await import("../src/cli/commands/daemon");
    const result = await runDaemonCommand(buildArgs(["status"]));

    expect(result.success).toBe(true);
    expect(resolveExitCode(result)).toBe(0);
    expect(result.message).toContain("not installed");
    expect(result.message).toContain("Run opendevbrowser daemon install");
    expect(result.message).toContain("stable installation path");
    expect((result.data as { autostart: AutostartStatus }).autostart.health).toBe("missing");
  });

  it("keeps status successful when autostart needs repair but daemon is running", async () => {
    getAutostartStatus.mockReturnValue(makeAutostartStatus({
      health: "needs_repair",
      needsRepair: true,
      reason: "missing_cli_path",
      command: "\"/node\" \"/old/cli/index.js\" serve"
    }));
    fetchDaemonStatusFromMetadata.mockResolvedValue({ pid: 1234, port: 0 });

    const { runDaemonCommand } = await import("../src/cli/commands/daemon");
    const result = await runDaemonCommand(buildArgs(["status"]));

    expect(result.success).toBe(true);
    expect(resolveExitCode(result)).toBe(0);
    expect(result.message).toContain("needs repair");
    expect(result.message).toContain("missing cli path");
    expect(result.message).toContain("stable installation path");
    expect((result.data as { autostart: AutostartStatus }).autostart.reason).toBe("missing_cli_path");
  });

  it("uses stable-install guidance when autostart points at a transient CLI path", async () => {
    getAutostartStatus.mockReturnValue(makeAutostartStatus({
      health: "needs_repair",
      needsRepair: true,
      reason: "transient_cli_path",
      command: "\"/node\" \"/tmp/_npx/opendevbrowser/dist/cli/index.js\" serve",
      expectedCommand: undefined
    }));
    fetchDaemonStatusFromMetadata.mockResolvedValue({ pid: 1234, port: 0 });

    const { runDaemonCommand } = await import("../src/cli/commands/daemon");
    const result = await runDaemonCommand(buildArgs(["status"]));

    expect(result.success).toBe(true);
    expect(resolveExitCode(result)).toBe(0);
    expect(result.message).toContain("transient cli path");
    expect(result.message).toContain("stable installation path");
  });

  it("keeps status successful when autostart is malformed but daemon is running", async () => {
    getAutostartStatus.mockReturnValue(makeAutostartStatus({
      health: "malformed",
      needsRepair: true,
      reason: "missing_program_arguments",
      command: undefined
    }));
    fetchDaemonStatusFromMetadata.mockResolvedValue({ pid: 1234, port: 0 });

    const { runDaemonCommand } = await import("../src/cli/commands/daemon");
    const result = await runDaemonCommand(buildArgs(["status"]));

    expect(result.success).toBe(true);
    expect(resolveExitCode(result)).toBe(0);
    expect(result.message).toContain("malformed");
    expect(result.message).toContain("Run opendevbrowser daemon install");
    expect(result.message).toContain("stable installation path");
    expect((result.data as { autostart: AutostartStatus }).autostart.reason).toBe("missing_program_arguments");
  });

  it("keeps status successful on unsupported platforms when the daemon is running", async () => {
    getAutostartStatus.mockReturnValue(makeAutostartStatus({
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
    }));
    fetchDaemonStatusFromMetadata.mockResolvedValue({ pid: 1234, port: 0 });

    const { runDaemonCommand } = await import("../src/cli/commands/daemon");
    const result = await runDaemonCommand(buildArgs(["status"]));

    expect(result.success).toBe(true);
    expect(resolveExitCode(result)).toBe(0);
    expect(result.message).toContain("not supported");
    expect((result.data as { autostart?: AutostartStatus }).autostart).toBeUndefined();
  });

  it("returns disconnected status when daemon is not running regardless of autostart health", async () => {
    getAutostartStatus.mockReturnValue(makeAutostartStatus({
      health: "malformed",
      needsRepair: true,
      reason: "malformed_plist",
      command: undefined
    }));

    const { runDaemonCommand } = await import("../src/cli/commands/daemon");
    const result = await runDaemonCommand(buildArgs(["status"]));

    expect(result.success).toBe(false);
    expect(resolveExitCode(result)).toBe(10);
    expect(result.message).toContain("malformed");
    expect((result.data as { autostart: AutostartStatus }).autostart.health).toBe("malformed");
    expect(fetchDaemonStatusFromMetadata).toHaveBeenCalledTimes(1);
  });
});
