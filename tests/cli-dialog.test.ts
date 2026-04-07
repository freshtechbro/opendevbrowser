import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedArgs } from "../src/cli/args";
import { __test__, runDialog } from "../src/cli/commands/devtools/dialog";
import { DEFAULT_DIALOG_TRANSPORT_TIMEOUT_MS } from "../src/cli/transport-timeouts";

const { callDaemon } = vi.hoisted(() => ({
  callDaemon: vi.fn()
}));

vi.mock("../src/cli/client", () => ({
  callDaemon
}));

const makeArgs = (rawArgs: string[]): ParsedArgs => ({
  command: "dialog",
  mode: undefined,
  withConfig: false,
  noPrompt: false,
  noInteractive: false,
  quiet: false,
  outputFormat: "json",
  transport: "relay",
  skillsMode: "global",
  fullInstall: false,
  rawArgs
});

describe("dialog CLI command", () => {
  beforeEach(() => {
    callDaemon.mockReset();
  });

  it("defaults action to status", () => {
    expect(__test__.parseDialogArgs([
      "--session-id=s1"
    ])).toEqual({
      sessionId: "s1",
      targetId: undefined,
      action: "status",
      promptText: undefined,
      timeoutMs: undefined
    });
  });

  it("forwards dialog actions and prompt text", async () => {
    callDaemon.mockResolvedValue({ dialog: { open: true, type: "prompt" }, handled: true });

    await runDialog(makeArgs([
      "--session-id",
      "s1",
      "--target-id",
      "tab-11",
      "--action",
      "accept",
      "--prompt-text",
      "hello"
    ]));

    expect(callDaemon).toHaveBeenCalledWith("page.dialog", {
      sessionId: "s1",
      targetId: "tab-11",
      action: "accept",
      promptText: "hello"
    }, { timeoutMs: DEFAULT_DIALOG_TRANSPORT_TIMEOUT_MS });
  });

  it("forwards dialog timeout overrides to the daemon client", async () => {
    callDaemon.mockResolvedValue({ dialog: { open: false }, handled: true });

    await runDialog(makeArgs([
      "--session-id",
      "s1",
      "--action",
      "status",
      "--timeout-ms",
      "15000"
    ]));

    expect(callDaemon).toHaveBeenCalledWith("page.dialog", {
      sessionId: "s1",
      action: "status"
    }, { timeoutMs: 15000 });
  });

  it("rejects invalid action and prompt text outside accept", () => {
    expect(() => __test__.parseDialogArgs([
      "--session-id",
      "s1",
      "--action",
      "open"
    ])).toThrow("Invalid --action: open");

    expect(() => __test__.parseDialogArgs([
      "--session-id",
      "s1",
      "--prompt-text",
      "hello"
    ])).toThrow("--prompt-text is only valid with --action accept");
  });
});
