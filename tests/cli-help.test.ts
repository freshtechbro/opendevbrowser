import { describe, expect, it } from "vitest";
import { CLI_COMMANDS, VALID_FLAGS } from "../src/cli/args";
import { registerCommand } from "../src/cli/commands/registry";
import { HELP_COMMAND_GROUPS, HELP_FLAG_GROUPS, HELP_TOOL_ENTRIES, getHelpText } from "../src/cli/help";

function registerAllCommands(): void {
  for (const command of CLI_COMMANDS) {
    registerCommand({
      name: command,
      description: `Description for ${command}`,
      run: () => ({ success: true, message: "" })
    });
  }
}

describe("CLI help surface", () => {
  it("covers every CLI command exactly once", () => {
    const seen = new Set<string>();

    for (const group of HELP_COMMAND_GROUPS) {
      for (const command of group.commands) {
        expect(seen.has(command), `${command} should not repeat`).toBe(false);
        seen.add(command);
      }
    }

    expect(seen.size).toBe(CLI_COMMANDS.length);
    for (const command of CLI_COMMANDS) {
      expect(seen.has(command), `${command} should be included`).toBe(true);
    }
  });

  it("covers every CLI flag exactly once", () => {
    const seen = new Set<string>();

    for (const group of HELP_FLAG_GROUPS) {
      for (const entry of group.flags) {
        expect(seen.has(entry.flag), `${entry.flag} should not repeat`).toBe(false);
        seen.add(entry.flag);
      }
    }

    expect(seen.size).toBe(VALID_FLAGS.length);
    for (const flag of VALID_FLAGS) {
      expect(seen.has(flag), `${flag} should be included`).toBe(true);
    }
  });

  it("lists every tool exactly once", () => {
    const seen = new Set<string>();

    for (const entry of HELP_TOOL_ENTRIES) {
      expect(entry.name.startsWith("opendevbrowser_")).toBe(true);
      expect(seen.has(entry.name), `${entry.name} should not repeat`).toBe(false);
      seen.add(entry.name);
    }

    expect(seen.size).toBe(48);
  });

  it("prints complete command, flag, and tool inventories with descriptions", () => {
    registerAllCommands();
    const output = getHelpText();

    expect(output).toContain(`Command Inventory (all ${CLI_COMMANDS.length} commands):`);
    expect(output).toContain("Flag Inventory (all supported flags):");
    expect(output).toContain("Tool Inventory (all 48 opendevbrowser_* tools):");

    for (const command of CLI_COMMANDS) {
      expect(output).toContain(command);
      expect(output).toContain(`Description for ${command}`);
    }

    for (const flag of VALID_FLAGS) {
      expect(output).toContain(flag);
    }

    for (const tool of HELP_TOOL_ENTRIES) {
      expect(output).toContain(tool.name);
      expect(output).toContain(tool.description);
    }

    expect(output).toContain("docs/SURFACE_REFERENCE.md");
    expect(output).toContain("src/tools/index.ts");
  });
});
