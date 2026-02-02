import { describe, it, expect } from "vitest";
import type { ParsedArgs } from "../src/cli/args";
import { runNativeCommand, __test__ } from "../src/cli/commands/native";

const makeArgs = (rawArgs: string[]): ParsedArgs => ({
  command: "native",
  mode: undefined,
  withConfig: false,
  noPrompt: false,
  noInteractive: false,
  quiet: false,
  outputFormat: "text",
  transport: "relay",
  skillsMode: "global",
  fullInstall: false,
  rawArgs
});

describe("native CLI command", () => {
  it("rejects invalid extension ids", async () => {
    expect(() => __test__.parseNativeArgs(["install", "not-valid"]))
      .toThrow("Invalid extension ID format");
  });

  it("reports not installed status when manifest missing", async () => {
    if (process.platform !== "darwin" && process.platform !== "linux" && process.platform !== "win32") {
      return;
    }
    const result = await runNativeCommand(makeArgs(["status"]));
    expect(result.success).toBe(false);
    expect(result.message).toContain("not installed");
  });
});
