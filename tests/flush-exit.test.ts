import { describe, expect, it, vi } from "vitest";
import { flushAndExit, normalizeExitCode } from "../scripts/flush-exit.mjs";

describe("flush-exit", () => {
  it("normalizes non-integer exit codes to zero", () => {
    expect(normalizeExitCode(undefined)).toBe(0);
    expect(normalizeExitCode(null)).toBe(0);
    expect(normalizeExitCode(3)).toBe(3);
  });

  it("flushes stdout and stderr before exiting", async () => {
    const events: string[] = [];
    const exit = vi.fn((code: number) => {
      events.push(`exit:${code}`);
    });
    const proc = {
      exitCode: 7,
      stdout: {
        write: vi.fn((_chunk: string, callback: () => void) => {
          events.push("stdout");
          callback();
          return true;
        })
      },
      stderr: {
        write: vi.fn((_chunk: string, callback: () => void) => {
          events.push("stderr");
          callback();
          return true;
        })
      },
      exit
    };

    await new Promise<void>((resolve) => {
      exit.mockImplementationOnce((code: number) => {
        events.push(`exit:${code}`);
        resolve();
      });
      flushAndExit(proc as never);
    });

    expect(events).toEqual(["stdout", "stderr", "exit:7"]);
  });

  it("accepts an explicit exit code override", async () => {
    const exit = vi.fn();
    const proc = {
      exitCode: 0,
      stdout: { write: vi.fn((_chunk: string, callback: () => void) => callback()) },
      stderr: { write: vi.fn((_chunk: string, callback: () => void) => callback()) },
      exit
    };

    await new Promise<void>((resolve) => {
      exit.mockImplementationOnce((code: number) => {
        expect(code).toBe(1);
        resolve();
      });
      flushAndExit(proc as never, 1);
    });
  });

  it("forces exit when a stream never acknowledges the flush", async () => {
    vi.useFakeTimers();
    const exit = vi.fn();
    const proc = {
      exitCode: 5,
      stdout: {
        write: vi.fn(() => true)
      },
      stderr: {
        write: vi.fn((_chunk: string, callback: () => void) => callback())
      },
      exit
    };

    flushAndExit(proc as never, undefined, 25);
    expect(exit).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(25);
    expect(exit).toHaveBeenCalledWith(5);
    vi.useRealTimers();
  });
});
