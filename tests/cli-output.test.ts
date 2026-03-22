import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { flushOutputAndExit, writeOutput } from "../src/cli/output";

describe("writeOutput", () => {
  const originalLog = console.log;

  beforeEach(() => {
    console.log = vi.fn();
  });

  afterEach(() => {
    console.log = originalLog;
    vi.restoreAllMocks();
  });

  it("prints text payloads as-is", () => {
    writeOutput("hello", { format: "text" });
    expect(console.log).toHaveBeenCalledWith("hello");
  });

  it("pretty-prints non-string payloads in text mode", () => {
    const payload = { ok: true };
    writeOutput(payload, { format: "text" });
    expect(console.log).toHaveBeenCalledWith(JSON.stringify(payload, null, 2));
  });

  it("prints JSON payloads in json mode", () => {
    const payload = { ok: true };
    writeOutput(payload, { format: "json" });
    expect(console.log).toHaveBeenCalledWith(JSON.stringify(payload));
  });

  it("streams array payloads in stream-json mode", () => {
    const payload = [{ id: 1 }, { id: 2 }];
    writeOutput(payload, { format: "stream-json" });
    expect(console.log).toHaveBeenNthCalledWith(1, JSON.stringify(payload[0]));
    expect(console.log).toHaveBeenNthCalledWith(2, JSON.stringify(payload[1]));
  });

  it("prints a single JSON payload in stream-json mode when not array", () => {
    const payload = { ok: true };
    writeOutput(payload, { format: "stream-json" });
    expect(console.log).toHaveBeenCalledWith(JSON.stringify(payload));
  });

  it("suppresses output in quiet mode", () => {
    writeOutput("hello", { format: "text", quiet: true });
    expect(console.log).not.toHaveBeenCalled();
  });

  it("flushes stdout and stderr before exiting", async () => {
    const events: string[] = [];
    const exit = vi.fn();
    const proc = {
      exitCode: 0,
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
      void flushOutputAndExit(4, proc as never);
    });

    expect(proc.exitCode).toBe(4);
    expect(events).toEqual(["stdout", "stderr", "exit:4"]);
  });
});
