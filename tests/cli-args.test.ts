import { describe, it, expect } from "vitest";
import { parseArgs } from "../src/cli/args";
import { parseNumberFlag } from "../src/cli/utils/parse";

describe("parseNumberFlag", () => {
  it("parses positive integers", () => {
    expect(parseNumberFlag("1500", "--timeout-ms", { min: 1 })).toBe(1500);
  });

  it("rejects non-integers", () => {
    expect(() => parseNumberFlag("1.2", "--timeout-ms", { min: 1 })).toThrow("Invalid --timeout-ms");
  });

  it("rejects out-of-range values", () => {
    expect(() => parseNumberFlag("0", "--timeout-ms", { min: 1 })).toThrow("Invalid --timeout-ms");
  });
});

describe("parseArgs", () => {
  it("accepts daemon command with subcommand", () => {
    const parsed = parseArgs(["node", "cli", "daemon", "status"]);
    expect(parsed.command).toBe("daemon");
    expect(parsed.rawArgs[0]).toBe("status");
  });

  it("rejects conflicting install modes", () => {
    expect(() => parseArgs(["node", "cli", "--global", "--local"]))
      .toThrow("Choose either --global or --local.");
  });

  it("rejects conflicting skills flags", () => {
    expect(() => parseArgs(["node", "cli", "--skills-global", "--skills-local"]))
      .toThrow("Choose either --skills-local or --skills-global.");
  });
});
