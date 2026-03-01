import { describe, expect, it } from "vitest";
import { CLI_COMMANDS } from "../src/cli/args";
import { HELP_COMMAND_GROUPS, HELP_TOOL_ENTRIES } from "../src/cli/help";

describe("cli help parity", () => {
  it("covers the full CLI command inventory", () => {
    const helpCommands = HELP_COMMAND_GROUPS.flatMap((group) => [...group.commands]);

    expect(new Set(helpCommands).size).toBe(CLI_COMMANDS.length);
    expect(new Set(helpCommands)).toEqual(new Set(CLI_COMMANDS));
  });

  it("tracks the expected tool inventory size", () => {
    const names = HELP_TOOL_ENTRIES.map((entry) => entry.name);

    expect(new Set(names).size).toBe(HELP_TOOL_ENTRIES.length);
    expect(HELP_TOOL_ENTRIES.length).toBe(48);
  });
});
