import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

const { spawnMock, spawnSyncMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  spawnSyncMock: vi.fn()
}));

vi.mock("child_process", () => ({
  spawn: spawnMock,
  spawnSync: spawnSyncMock
}));

import { startDaemon } from "../scripts/cli-smoke-test.mjs";

type MockChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
};

function createChild(): MockChild {
  const child = new EventEmitter() as MockChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.kill = vi.fn((signal?: NodeJS.Signals | number) => {
    if (typeof signal === "string") {
      child.signalCode = signal;
    }
    child.emit("exit", child.exitCode, child.signalCode);
    child.emit("close", child.exitCode, child.signalCode);
    return true;
  });
  return child;
}

describe("cli-smoke-test startDaemon", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    spawnMock.mockReset();
    spawnSyncMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits through transient daemon status failures before succeeding", async () => {
    const child = createChild();
    spawnMock.mockReturnValue(child);
    spawnSyncMock
      .mockReturnValueOnce({ status: 1, stdout: "", stderr: "booting", error: undefined })
      .mockReturnValueOnce({ status: 1, stdout: "", stderr: "still booting", error: undefined })
      .mockReturnValueOnce({ status: 0, stdout: "{\"success\":true}", stderr: "", error: undefined });

    const pending = startDaemon({ PATH: "/tmp" }, 8788);
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(pending).resolves.toBe(child);
    expect(spawnSyncMock).toHaveBeenCalledTimes(3);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("reports early daemon exit with captured stderr detail", async () => {
    const child = createChild();
    spawnMock.mockReturnValue(child);
    spawnSyncMock.mockReturnValue({ status: 1, stdout: "", stderr: "status pending", error: undefined });

    const pending = startDaemon({ PATH: "/tmp" }, 8788).catch((error) => error as Error);
    child.stderr.emit("data", "daemon boot failed");
    child.exitCode = 1;
    child.emit("exit", 1, null);
    child.emit("close", 1, null);
    await vi.advanceTimersByTimeAsync(500);

    const error = await pending;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("Daemon exited before becoming ready.");
    expect((error as Error).message).toContain("stderr=daemon boot failed");
  });
});
