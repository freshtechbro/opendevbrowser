import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { runCli, ensureCliBuilt, sleep, spawn } = vi.hoisted(() => ({
  runCli: vi.fn(),
  ensureCliBuilt: vi.fn(),
  sleep: vi.fn(async () => {}),
  spawn: vi.fn()
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn
  };
});

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
  hasDaemonStartedOutput,
  isCurrentHarnessDaemonStatus,
  startConfiguredDaemon,
  startDaemon,
  stopDaemon,
  withConfiguredDaemon
} from "../scripts/skill-runtime-probe-utils.mjs";

const makeExitedDaemon = (): ChildProcess => ({
  exitCode: 0,
  signalCode: null,
  kill: vi.fn(),
  once: vi.fn()
} as unknown as ChildProcess);

const makeRunningDaemon = (): ChildProcess & { stdout: EventEmitter; stderr: EventEmitter } => {
  const daemon = {
    exitCode: null as number | null,
    signalCode: null,
    kill: vi.fn(() => {
      daemon.exitCode = 0;
      return true;
    }),
    on: vi.fn(),
    once: vi.fn(),
    stdout: new EventEmitter(),
    stderr: new EventEmitter()
  };
  return daemon as unknown as ChildProcess & { stdout: EventEmitter; stderr: EventEmitter };
};

describe("skill runtime probe utils", () => {
  beforeEach(() => {
    runCli.mockReset();
    sleep.mockClear();
    spawn.mockReset();
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
    const missingFingerprintStatus = {
      status: 0,
      json: { success: true, data: {} }
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
    expect(isCurrentHarnessDaemonStatus(missingFingerprintStatus)).toBe(false);
    expect(currentHarnessDaemonStatusDetail(missingFingerprintStatus)).toBe("daemon_fingerprint_missing");
    expect(isCurrentHarnessDaemonStatus(failedStatus)).toBe(false);
    expect(currentHarnessDaemonStatusDetail(failedStatus)).toBe("daemon unavailable");
  });

  it("recognizes successful daemon startup output as readiness evidence", () => {
    const output = [
      "{\"success\":true,\"message\":\"Daemon running\",\"data\":{\"port\":8788,\"relayPort\":8787}}\n"
    ];

    expect(hasDaemonStartedOutput(output, 8788)).toBe(true);
    expect(hasDaemonStartedOutput(output, 9999)).toBe(false);
    expect(hasDaemonStartedOutput(["not json\n"], 8788)).toBe(false);
  });

  it("waits for a current fingerprint after daemon startup output", async () => {
    const daemon = makeRunningDaemon();
    spawn.mockReturnValue(daemon);
    runCli
      .mockReturnValueOnce({ status: 1, detail: "daemon unavailable" })
      .mockReturnValueOnce({ status: 1, detail: "daemon still warming" })
      .mockReturnValueOnce({
        status: 0,
        json: { success: true, data: { fingerprintCurrent: true } }
      });
    sleep.mockImplementationOnce(async () => {
      daemon.stdout.emit(
        "data",
        "{\"success\":true,\"message\":\"Daemon running\",\"data\":{\"port\":8788,\"relayPort\":8787}}\n"
      );
    });

    await expect(startDaemon(process.env, 8788)).resolves.toBe(daemon);

    expect(runCli).toHaveBeenCalledTimes(3);
  });

  it("waits for a current fingerprint after configured daemon startup output", async () => {
    const daemon = makeRunningDaemon();
    spawn.mockReturnValue(daemon);
    runCli
      .mockReturnValueOnce({ status: 1, detail: "daemon unavailable" })
      .mockReturnValueOnce({ status: 1, detail: "daemon still warming" })
      .mockReturnValueOnce({
        status: 0,
        json: { success: true, data: { fingerprintCurrent: true } }
      });
    sleep.mockImplementationOnce(async () => {
      daemon.stdout.emit(
        "data",
        "{\"success\":true,\"message\":\"Daemon running\",\"data\":{\"port\":8788,\"relayPort\":8787}}\n"
      );
    });

    await expect(startConfiguredDaemon(process.env)).resolves.toBe(daemon);

    expect(runCli).toHaveBeenCalledTimes(3);
  });

  it("stops a stale configured daemon before starting a replacement", async () => {
    const daemon = makeRunningDaemon();
    const staleStatus = {
      status: 0,
      json: { success: true, data: { fingerprintCurrent: false } }
    };
    const currentStatus = {
      status: 0,
      json: { success: true, data: { fingerprintCurrent: true } }
    };
    spawn.mockReturnValue(daemon);
    runCli
      .mockReturnValueOnce(staleStatus)
      .mockReturnValueOnce({ status: 0, json: { success: true } })
      .mockReturnValueOnce(currentStatus)
      .mockReturnValueOnce({ status: 0, json: { success: true } });
    const task = vi.fn(async () => "ok");

    await expect(withConfiguredDaemon(task, process.env)).resolves.toBe("ok");

    expect(runCli).toHaveBeenNthCalledWith(
      2,
      ["serve", "--stop"],
      expect.objectContaining({ allowFailure: true })
    );
    expect(task).toHaveBeenCalledWith(expect.objectContaining({
      daemon,
      startedDaemon: true
    }));
  });

  it("fails closed when a stale configured daemon cannot be stopped", async () => {
    const staleStatus = {
      status: 0,
      json: { success: true, data: { fingerprintCurrent: false } }
    };
    runCli
      .mockReturnValueOnce(staleStatus)
      .mockReturnValueOnce({ status: 2, detail: "stop refused" });

    await expect(withConfiguredDaemon(vi.fn(), process.env)).rejects.toThrow(
      "configured_daemon_stop_failed: stop refused"
    );
    expect(spawn).not.toHaveBeenCalled();
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
