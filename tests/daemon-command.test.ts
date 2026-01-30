import { describe, expect, it, vi } from "vitest";
import type { ParsedArgs } from "../src/cli/args";

const installAutostart = vi.fn(() => ({
  platform: "darwin" as const,
  supported: true,
  installed: true,
  location: "/tmp/agent.plist",
  label: "com.opendevbrowser.daemon"
}));

const uninstallAutostart = vi.fn(() => ({
  platform: "darwin" as const,
  supported: true,
  installed: false,
  location: "/tmp/agent.plist",
  label: "com.opendevbrowser.daemon"
}));

const getAutostartStatus = vi.fn(() => ({
  platform: "darwin" as const,
  supported: true,
  installed: true,
  location: "/tmp/agent.plist",
  label: "com.opendevbrowser.daemon"
}));

const fetchDaemonStatusFromMetadata = vi.fn(async () => null);

vi.mock("../src/cli/daemon-autostart", () => ({
  installAutostart,
  uninstallAutostart,
  getAutostartStatus
}));

vi.mock("../src/cli/daemon-status", () => ({
  fetchDaemonStatusFromMetadata
}));

vi.mock("../src/cli/daemon", () => ({
  readDaemonMetadata: vi.fn(() => null)
}));

vi.mock("../src/cli/utils/http", () => ({
  fetchWithTimeout: vi.fn(async () => ({ ok: true }))
}));

const buildArgs = (rawArgs: string[]): ParsedArgs => ({
  command: "daemon",
  mode: undefined,
  withConfig: false,
  noPrompt: true,
  noInteractive: true,
  quiet: false,
  outputFormat: "json",
  skillsMode: "none",
  fullInstall: false,
  rawArgs
});

describe("daemon command", () => {
  it("installs autostart", async () => {
    const { runDaemonCommand } = await import("../src/cli/commands/daemon");
    const result = await runDaemonCommand(buildArgs(["install"]));
    expect(result.success).toBe(true);
    expect(installAutostart).toHaveBeenCalledTimes(1);
  });

  it("uninstalls autostart", async () => {
    const { runDaemonCommand } = await import("../src/cli/commands/daemon");
    const result = await runDaemonCommand(buildArgs(["uninstall"]));
    expect(result.success).toBe(true);
    expect(uninstallAutostart).toHaveBeenCalledTimes(1);
  });

  it("returns disconnected status when daemon is not running", async () => {
    const { runDaemonCommand } = await import("../src/cli/commands/daemon");
    const result = await runDaemonCommand(buildArgs(["status"]));
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(10);
    expect(fetchDaemonStatusFromMetadata).toHaveBeenCalledTimes(1);
    expect(getAutostartStatus).toHaveBeenCalledTimes(1);
  });
});
