import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { spawnSyncMock } = vi.hoisted(() => ({ spawnSyncMock: vi.fn() }));

vi.mock("child_process", () => ({
  spawnSync: spawnSyncMock
}));

import {
  buildSmokeReviewArgs,
  DAEMON_READY_TIMEOUT_MS,
  parseArgs,
  runCli,
  startDaemon
} from "../scripts/cli-smoke-test.mjs";

describe("cli-smoke-test parseArgs", () => {
  it("parses supported synthetic-page variants", () => {
    expect(parseArgs(["--variant", "secondary"])).toEqual({ variant: "secondary" });
    expect(() => parseArgs(["--variant", "unknown"])).toThrow("--variant requires primary or secondary.");
  });

  it("uses the default CLI review budget instead of a tighter smoke-only override", () => {
    expect(buildSmokeReviewArgs("session-1")).toEqual([
      "review",
      "--session-id",
      "session-1",
      "--max-chars",
      "2000"
    ]);
  });
});

describe("cli-smoke-test startDaemon", () => {
  let killSpy: ReturnType<typeof vi.spyOn>;
  let mkdtempSpy: ReturnType<typeof vi.spyOn>;
  let logDir: string;

  beforeEach(() => {
    vi.useFakeTimers();
    spawnSyncMock.mockReset();
    killSpy = vi.spyOn(process, "kill");
    killSpy.mockImplementation(() => true);
    logDir = fs.mkdtempSync(path.join(os.tmpdir(), "odb-cli-smoke-test-"));
    mkdtempSpy = vi.spyOn(fs, "mkdtempSync").mockReturnValue(logDir);
  });

  afterEach(() => {
    vi.useRealTimers();
    killSpy.mockRestore();
    mkdtempSpy.mockRestore();
    fs.rmSync(logDir, { recursive: true, force: true });
  });

  it("waits through transient daemon status failures before succeeding", async () => {
    spawnSyncMock
      .mockReturnValueOnce({ status: 0, stdout: "4321\n", stderr: "", error: undefined })
      .mockReturnValueOnce({ status: 1, stdout: "", stderr: "booting", error: undefined })
      .mockReturnValueOnce({ status: 1, stdout: "", stderr: "still booting", error: undefined })
      .mockReturnValueOnce({ status: 0, stdout: "{\"success\":true}", stderr: "", error: undefined });

    const pending = startDaemon({ PATH: "/tmp" }, 8788);
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(pending).resolves.toMatchObject({ pid: 4321 });
    expect(spawnSyncMock).toHaveBeenCalledTimes(4);
    expect(spawnSyncMock.mock.calls[0]?.[1]?.[1]).toContain(JSON.stringify(process.execPath));
    expect(killSpy).toHaveBeenCalledTimes(2);
    expect(killSpy.mock.calls.every(([, signal]) => signal === 0)).toBe(true);
  });

  it("reports early daemon exit with captured stderr detail", async () => {
    fs.writeFileSync(path.join(logDir, "daemon.stderr.log"), "daemon boot failed");
    spawnSyncMock
      .mockReturnValueOnce({ status: 0, stdout: "4321\n", stderr: "", error: undefined })
      .mockReturnValueOnce({ status: 1, stdout: "", stderr: "status pending", error: undefined });
    killSpy.mockImplementation((pid, signal) => {
      if (pid === 4321 && signal === 0) {
        throw new Error("ESRCH");
      }
      return true;
    });

    const pending = startDaemon({ PATH: "/tmp" }, 8788).catch((error) => error as Error);
    await vi.advanceTimersByTimeAsync(500);

    const error = await pending;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("Daemon exited before becoming ready.");
    expect((error as Error).message).toContain("stderr=daemon boot failed");
  });

  it("reports timeout diagnostics using the current pid and log-file model", async () => {
    fs.writeFileSync(path.join(logDir, "daemon.stderr.log"), "boot log");
    spawnSyncMock
      .mockReturnValueOnce({ status: 0, stdout: "4321\n", stderr: "", error: undefined })
      .mockReturnValue({ status: 1, stdout: "", stderr: "daemon not ready", error: undefined });

    let terminated = false;
    killSpy.mockImplementation((pid, signal) => {
      if (pid !== 4321) {
        return true;
      }
      if (signal === "SIGTERM") {
        terminated = true;
        return true;
      }
      if (signal === 0 && terminated) {
        throw new Error("ESRCH");
      }
      return true;
    });

    const pending = startDaemon({ PATH: "/tmp" }, 8788).catch((error) => error as Error);
    await vi.advanceTimersByTimeAsync(DAEMON_READY_TIMEOUT_MS);

    const error = await pending;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("Daemon did not become ready in time.");
    expect((error as Error).message).toContain("pid=4321");
    expect((error as Error).message).toContain("status=daemon not ready");
    expect((error as Error).message).toContain("stderr=boot log");
    expect(killSpy).toHaveBeenCalledWith(4321, "SIGTERM");
  });
});

describe("cli-smoke-test runCli", () => {
  beforeEach(() => {
    spawnSyncMock.mockReset();
  });

  it("prefers the final JSON payload when stdout also contains JSON log lines", () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: [
        "{\"level\":\"info\",\"message\":\"launching\"}",
        "{\"success\":true,\"sessionId\":\"session-1\"}"
      ].join("\n"),
      stderr: "",
      error: undefined
    });

    const result = runCli(["status"], { env: { PATH: "/tmp" } });
    expect(result.json).toEqual({ success: true, sessionId: "session-1" });
  });
});
