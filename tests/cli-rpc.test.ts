import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import type { ParsedArgs } from "../src/cli/args";
import { runRpc, __test__ } from "../src/cli/commands/rpc";

const callMock = vi.fn();
const releaseBindingMock = vi.fn();

vi.mock("../src/cli/daemon-client", () => ({
  DaemonClient: class {
    call = callMock;
    releaseBinding = releaseBindingMock;
  }
}));

const makeArgs = (rawArgs: string[], outputFormat: ParsedArgs["outputFormat"] = "json"): ParsedArgs => ({
  command: "rpc",
  mode: undefined,
  withConfig: false,
  noPrompt: false,
  noInteractive: false,
  quiet: false,
  outputFormat,
  transport: "relay",
  skillsMode: "global",
  fullInstall: false,
  rawArgs
});

describe("rpc CLI command", () => {
  beforeEach(() => {
    callMock.mockReset();
    releaseBindingMock.mockReset();
    releaseBindingMock.mockResolvedValue(undefined);
  });

  it("requires --unsafe-internal", async () => {
    await expect(runRpc(makeArgs(["--name", "session.status"])))
      .rejects.toThrow("Missing --unsafe-internal");
  });

  it("executes daemon command with parsed params and timeout", async () => {
    callMock.mockResolvedValue({ ok: true, mode: "extension" });

    const result = await runRpc(makeArgs([
      "--unsafe-internal",
      "--name",
      "session.status",
      "--params",
      "{\"sessionId\":\"s1\"}",
      "--timeout-ms",
      "45000"
    ]));

    expect(callMock).toHaveBeenCalledWith(
      "session.status",
      { sessionId: "s1" },
      { timeoutMs: 45000 }
    );
    expect(releaseBindingMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      success: true,
      message: "RPC executed: session.status",
      data: {
        name: "session.status",
        result: { ok: true, mode: "extension" }
      }
    });
  });

  it("returns raw text payload in text output mode", async () => {
    callMock.mockResolvedValue({ status: "ok" });

    const result = await runRpc(makeArgs([
      "--unsafe-internal",
      "--name",
      "relay.status"
    ], "text"));

    expect(result.success).toBe(true);
    expect(result.message).toContain("\"status\": \"ok\"");
  });

  it("rejects invalid params JSON", async () => {
    await expect(runRpc(makeArgs([
      "--unsafe-internal",
      "--name",
      "relay.status",
      "--params",
      "{invalid"
    ]))).rejects.toThrow("Invalid JSON from --params");
  });

  it("rejects non-object params payload", () => {
    expect(() => __test__.parseJsonObject("[]", "--params"))
      .toThrow("expected object");
  });

  it("loads params from --params-file", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "odb-rpc-"));
    const paramsPath = join(tempDir, "params.json");
    try {
      await writeFile(paramsPath, JSON.stringify({ sessionId: "s1", waitUntil: "load" }), "utf8");
      callMock.mockResolvedValue({ ok: true });

      await runRpc(makeArgs([
        "--unsafe-internal",
        "--name",
        "nav.goto",
        "--params-file",
        paramsPath
      ]));

      expect(callMock).toHaveBeenCalledWith(
        "nav.goto",
        { sessionId: "s1", waitUntil: "load" },
        { timeoutMs: undefined }
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects using both --params and --params-file", async () => {
    await expect(runRpc(makeArgs([
      "--unsafe-internal",
      "--name",
      "session.status",
      "--params",
      "{\"sessionId\":\"s1\"}",
      "--params-file",
      "/tmp/params.json"
    ]))).rejects.toThrow("Provide only one params source");
  });

  it("wraps params-file read errors as usage errors", async () => {
    await expect(runRpc(makeArgs([
      "--unsafe-internal",
      "--name",
      "session.status",
      "--params-file",
      "/tmp/does-not-exist-rpc-params.json"
    ]))).rejects.toThrow("Invalid --params-file");
  });
});
