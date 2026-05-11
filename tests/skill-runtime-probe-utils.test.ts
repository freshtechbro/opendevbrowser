import type { ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { runCli, ensureCliBuilt, sleep } = vi.hoisted(() => ({
  runCli: vi.fn(),
  ensureCliBuilt: vi.fn(),
  sleep: vi.fn(async () => {})
}));

vi.mock("../scripts/live-direct-utils.mjs", () => ({
  CLI: "/tmp/opendevbrowser-cli.js",
  ensureCliBuilt,
  INSTALL_AUTOSTART_SKIP_ENV_VAR: "OPDEVBROWSER_SKIP_INSTALL_AUTOSTART_RECONCILIATION",
  ROOT: "/tmp",
  runCli,
  sleep
}));

import {
  cleanupHarness,
  createTempHarness,
  currentHarnessDaemonStatusDetail,
  isCurrentHarnessDaemonStatus,
  stopDaemon
} from "../scripts/skill-runtime-probe-utils.mjs";

const makeExitedDaemon = (): ChildProcess => ({
  exitCode: 0,
  signalCode: null,
  kill: vi.fn(),
  once: vi.fn()
} as unknown as ChildProcess);

describe("skill runtime probe utils", () => {
  beforeEach(() => {
    runCli.mockReset();
  });

  it("requires a current daemon fingerprint for harness reuse", () => {
    const currentStatus = {
      status: 0,
      json: { success: true, data: { fingerprintCurrent: true } }
    };
    const staleStatus = {
      status: 0,
      json: { success: true, data: { fingerprintCurrent: false } }
    };
    const failedStatus = {
      status: 1,
      detail: "daemon unavailable",
      json: { success: false, data: { fingerprintCurrent: true } }
    };

    expect(isCurrentHarnessDaemonStatus(currentStatus)).toBe(true);
    expect(currentHarnessDaemonStatusDetail(currentStatus)).toBeNull();
    expect(isCurrentHarnessDaemonStatus(staleStatus)).toBe(false);
    expect(currentHarnessDaemonStatusDetail(staleStatus)).toBe("daemon_fingerprint_mismatch");
    expect(isCurrentHarnessDaemonStatus(failedStatus)).toBe(false);
    expect(currentHarnessDaemonStatusDetail(failedStatus)).toBe("daemon unavailable");
  });

  it("allocates an isolated relay port for temp harnesses", async () => {
    const harness = await createTempHarness("odb-probe-test");
    try {
      const configPath = `${harness.configDir}/opendevbrowser.jsonc`;
      const content = await readFile(configPath, "utf8");
      const parsed = JSON.parse(content) as { daemonPort: number; relayPort: number };

      expect(parsed.daemonPort).toBe(harness.daemonPort);
      expect(parsed.relayPort).toBe(harness.relayPort);
      expect(parsed.relayPort).not.toBe(8787);
      expect(parsed.relayPort).not.toBe(parsed.daemonPort);
    } finally {
      await cleanupHarness(harness.tempRoot);
    }
  });

  it("stops a started daemon without uninstalling autostart by default", async () => {
    await stopDaemon(makeExitedDaemon(), process.env);

    expect(runCli).toHaveBeenCalledTimes(1);
    expect(runCli).toHaveBeenCalledWith(
      ["serve", "--stop"],
      expect.objectContaining({
        allowFailure: true,
        timeoutMs: 15_000
      })
    );
  });

  it("can explicitly uninstall autostart before stopping", async () => {
    await stopDaemon(makeExitedDaemon(), process.env, { uninstallAutostart: true });

    expect(runCli).toHaveBeenCalledTimes(2);
    expect(runCli).toHaveBeenNthCalledWith(
      1,
      ["daemon", "uninstall"],
      expect.objectContaining({
        allowFailure: true,
        timeoutMs: 15_000
      })
    );
    expect(runCli).toHaveBeenNthCalledWith(
      2,
      ["serve", "--stop"],
      expect.objectContaining({
        allowFailure: true,
        timeoutMs: 15_000
      })
    );
  });
});
