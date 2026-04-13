import { describe, expect, it } from "vitest";
import { CLI_COMMANDS, VALID_FLAGS } from "../src/cli/args";
import onboardingMetadata from "../src/cli/onboarding-metadata.json";
import { registerCommand } from "../src/cli/commands/registry";
import {
  COMMAND_HELP_DETAILS,
  HELP_CAPABILITY_ENTRIES,
  HELP_COMMAND_GROUPS,
  HELP_FLAG_GROUPS,
  HELP_ONBOARDING_ENTRIES,
  HELP_TOOL_ENTRIES,
  getHelpText
} from "../src/cli/help";

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
        expect(COMMAND_HELP_DETAILS[command].usage.length).toBeGreaterThan(0);
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

    expect(seen.size).toBe(HELP_TOOL_ENTRIES.length);
  });

  it("defines an explicit onboarding block for first-contact agents", () => {
    const labels = HELP_ONBOARDING_ENTRIES.map((entry) => entry.label);

    expect(labels).toEqual([
      "prompting_guide",
      "skill_load",
      "validated_lanes",
      "skill_list",
      "research_reliable",
      "shopping_reliable",
      "computer_use_entry",
      "happy_path",
      "docs"
    ]);
    expect(HELP_ONBOARDING_ENTRIES[0]?.details?.[0]?.value).toBe(onboardingMetadata.quickStartCommands.promptingGuide);
    expect(HELP_ONBOARDING_ENTRIES[1]?.details?.[0]?.value).toBe(onboardingMetadata.quickStartCommands.skillLoad);
    expect(HELP_ONBOARDING_ENTRIES[2]?.details?.[0]?.value).toBe(onboardingMetadata.quickStartCommands.validatedLanes);
    expect(HELP_ONBOARDING_ENTRIES[2]?.details).toHaveLength(1);
    expect(HELP_ONBOARDING_ENTRIES[3]?.details?.[0]?.value).toBe(onboardingMetadata.quickStartCommands.skillList);
    expect(HELP_ONBOARDING_ENTRIES[4]?.details?.[0]?.value).toBe(onboardingMetadata.quickStartCommands.validatedResearch);
    expect(HELP_ONBOARDING_ENTRIES[5]?.details?.[0]?.value).toBe(onboardingMetadata.quickStartCommands.validatedShopping);
    expect(HELP_ONBOARDING_ENTRIES[6]?.details?.[0]?.value).toBe(onboardingMetadata.quickStartCommands.computerUseEntry);
    expect(HELP_ONBOARDING_ENTRIES[8]?.details).toHaveLength(1);
  });

  it("defines explicit find-it-fast lookup entries for replay, desktop observation, and browser-scoped computer use", () => {
    const labels = HELP_CAPABILITY_ENTRIES.map((entry) => entry.label);

    expect(labels).toEqual([
      "screencast / browser replay",
      "desktop observation",
      "computer use / browser-scoped computer use"
    ]);
    expect(HELP_CAPABILITY_ENTRIES[0]?.details?.[0]?.value).toBe("screencast-start, screencast-stop");
    expect(HELP_CAPABILITY_ENTRIES[0]?.details?.[1]?.value).toContain("screencast-start --session-id <id>");
    expect(HELP_CAPABILITY_ENTRIES[1]?.details?.[0]?.value).toContain("desktop-status");
    expect(HELP_CAPABILITY_ENTRIES[1]?.details?.[1]?.value).toBe("npx opendevbrowser desktop-status --output-format json");
    expect(HELP_CAPABILITY_ENTRIES[1]?.description).toContain("swift command");
    expect(HELP_CAPABILITY_ENTRIES[1]?.description).toContain("screencapture");
    expect(HELP_CAPABILITY_ENTRIES[2]?.details?.[0]?.value).toBe("--challenge-automation-mode off|browser|browser_with_helper");
    expect(HELP_CAPABILITY_ENTRIES[2]?.details?.[1]?.value).toContain("macro-resolve --execute");
    expect(HELP_CAPABILITY_ENTRIES[2]?.details?.[2]?.value).toBe(onboardingMetadata.quickStartCommands.computerUseEntry);
    expect(HELP_CAPABILITY_ENTRIES[2]?.description).toContain("not a desktop agent");
  });

  it("prints complete command, flag, and tool inventories with descriptions", () => {
    registerAllCommands();
    const output = getHelpText();

    expect(output).toContain(`${onboardingMetadata.sectionTitle}:`);
    expect(output).toContain(onboardingMetadata.sectionSummary);
    expect(output).toContain(onboardingMetadata.quickStartCommands.promptingGuide);
    expect(output).toContain(onboardingMetadata.quickStartCommands.skillLoad);
    expect(output).toContain(onboardingMetadata.quickStartCommands.validatedLanes);
    expect(output).toContain(onboardingMetadata.quickStartCommands.skillList);
    expect(output).toContain(onboardingMetadata.quickStartCommands.validatedResearch);
    expect(output).toContain(onboardingMetadata.quickStartCommands.validatedShopping);
    expect(output).toContain(onboardingMetadata.quickStartCommands.computerUseEntry);
    expect(output).toContain(onboardingMetadata.quickStartCommands.happyPath);
    expect(output).toContain(onboardingMetadata.referencePaths.onboardingDoc);
    expect(output).toContain(onboardingMetadata.referencePaths.skillDoc);
    expect(output).toContain("Find It Fast:");
    expect(output).toContain("Use these exact lookup terms when you need replay, desktop evidence, or browser-scoped computer use.");
    expect(output).toContain("screencast / browser replay");
    expect(output).toContain("desktop observation");
    expect(output).toContain("computer use / browser-scoped computer use");
    expect(output).toContain("screencast-start, screencast-stop");
    expect(output).toContain("desktop-status, desktop-windows");
    expect(output).toContain("swift command");
    expect(output).toContain("screencapture");
    expect(output).toContain("--challenge-automation-mode off|browser|browser_with_helper");
    expect(output).toContain("research run, shopping run, product-video run, macro-resolve --execute");
    expect(output).toContain(onboardingMetadata.quickStartCommands.computerUseEntry);
    expect(output).toContain("not a desktop agent");
    expect(output).toContain(`Command Inventory (all ${CLI_COMMANDS.length} commands):`);
    expect(output).toContain("Flag Inventory (all supported flags):");
    expect(output).toContain(`Tool Inventory (all ${HELP_TOOL_ENTRIES.length} opendevbrowser_* tools):`);

    for (const command of CLI_COMMANDS) {
      expect(output).toContain(command);
      expect(output).toContain(`Description for ${command}`);
      expect(output).toContain(COMMAND_HELP_DETAILS[command].usage);
    }

    for (const flag of VALID_FLAGS) {
      expect(output).toContain(flag);
    }

    for (const tool of HELP_TOOL_ENTRIES) {
      expect(output).toContain(tool.name);
      expect(output).toContain(tool.description);
    }

    expect(output).toContain("usage:");
    expect(output).toContain("flags:");
    expect(output).toContain("cli:");
    expect(output).toContain("docs/SURFACE_REFERENCE.md");
    expect(output).toContain("src/tools/index.ts");
    expect(output).toContain("src/cli/help.ts");
    expect(output).toContain("src/public-surface/generated-manifest.ts");
    expect(output).not.toContain("src/tools/surface.ts");
  });
});
