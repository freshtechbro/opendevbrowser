import { describe, expect, it } from "vitest";
import { CLI_COMMANDS } from "../src/cli/args";
import { COMMAND_HELP_DETAILS, HELP_COMMAND_GROUPS, HELP_REFERENCE_ENTRIES, HELP_TOOL_ENTRIES } from "../src/cli/help";
import { TOOL_SURFACE_ENTRIES } from "../src/tools/surface";

describe("cli help parity", () => {
  it("covers the full CLI command inventory", () => {
    const helpCommands = HELP_COMMAND_GROUPS.flatMap((group) => [...group.commands]);

    expect(new Set(helpCommands).size).toBe(CLI_COMMANDS.length);
    expect(new Set(helpCommands)).toEqual(new Set(CLI_COMMANDS));
    expect(new Set(Object.keys(COMMAND_HELP_DETAILS))).toEqual(new Set(CLI_COMMANDS));
  });

  it("tracks the expected tool inventory size", () => {
    const names = HELP_TOOL_ENTRIES.map((entry) => entry.name);

    expect(new Set(names).size).toBe(HELP_TOOL_ENTRIES.length);
    expect(HELP_TOOL_ENTRIES).toEqual(TOOL_SURFACE_ENTRIES);
  });

  it("mentions both help invocations in the generated help text", () => {
    const labels = HELP_REFERENCE_ENTRIES.map((entry) => entry.label);

    expect(labels).toContain("opendevbrowser --help");
    expect(labels).toContain("opendevbrowser help");
    expect(labels).toContain("src/cli/help.ts");
  });
});
