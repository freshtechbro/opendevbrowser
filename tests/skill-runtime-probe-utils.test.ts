import type { ChildProcess } from "node:child_process";
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

import { stopDaemon } from "../scripts/skill-runtime-probe-utils.mjs";

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
