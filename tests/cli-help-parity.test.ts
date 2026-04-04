import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CLI_COMMANDS } from "../src/cli/args";
import onboardingMetadata from "../src/cli/onboarding-metadata.json";
import { COMMAND_HELP_DETAILS, HELP_COMMAND_GROUPS, HELP_FLAG_GROUPS, HELP_REFERENCE_ENTRIES, HELP_TOOL_ENTRIES } from "../src/cli/help";
import { LOCAL_ONLY_TOOL_NAMES } from "../src/tools";
import { TOOL_SURFACE_ENTRIES } from "../src/public-surface/generated-manifest";

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

  it("includes the session-inspector public-surface tranche", () => {
    const commandNames = HELP_COMMAND_GROUPS.flatMap((group) => [...group.commands]);
    const toolNames = HELP_TOOL_ENTRIES.map((entry) => entry.name);

    expect(commandNames).toContain("session-inspector");
    expect(HELP_COMMAND_GROUPS.find((group) => group.commands.includes("session-inspector"))?.commands).toContain("session-inspector");
    expect(toolNames).toContain("opendevbrowser_session_inspector");
    expect(COMMAND_HELP_DETAILS["session-inspector"].flags).toEqual(expect.arrayContaining([
      "--session-id",
      "--include-urls",
      "--since-console-seq",
      "--since-network-seq",
      "--since-exception-seq",
      "--max",
      "--request-id"
    ]));
  });

  it("keeps runtime command registration aligned with the declared CLI inventory", () => {
    const source = readFileSync(resolve(process.cwd(), "src/cli/index.ts"), "utf8");
    const registeredNames = [...source.matchAll(/registerCommand\(\{\s*name:\s*"([^"]+)"/gs)].map((match) => match[1]);

    expect(new Set(registeredNames)).toEqual(new Set(CLI_COMMANDS));
  });

  it("keeps runtime tool names aligned with the mirrored tool inventory", () => {
    const source = readFileSync(resolve(process.cwd(), "src/tools/index.ts"), "utf8");
    const runtimeToolNames = [...source.matchAll(/\s(opendevbrowser_[a-z_]+):/g)].map((match) => match[1]);

    expect(new Set(runtimeToolNames)).toEqual(new Set(TOOL_SURFACE_ENTRIES.map((entry) => entry.name)));
  });

  it("keeps multi-flag help metadata aligned for workflow and run commands", () => {
    expect(COMMAND_HELP_DETAILS.uninstall.usage).toContain("--quiet");
    expect(COMMAND_HELP_DETAILS.run.flags).toEqual(expect.arrayContaining(["--headless", "--persist-profile"]));
    expect(COMMAND_HELP_DETAILS.research.flags).toEqual(expect.arrayContaining(["--output-dir", "--ttl-hours"]));
    expect(COMMAND_HELP_DETAILS.shopping.flags).toEqual(expect.arrayContaining(["--output-dir", "--ttl-hours"]));
    expect(COMMAND_HELP_DETAILS["product-video"].flags).toEqual(expect.arrayContaining(["--output-dir", "--ttl-hours"]));
  });

  it("mentions both help invocations in the generated help text", () => {
    const labels = HELP_REFERENCE_ENTRIES.map((entry) => entry.label);

    expect(labels).toContain("opendevbrowser --help");
    expect(labels).toContain("opendevbrowser help");
    expect(labels).toContain("src/cli/help.ts");
    expect(labels).toContain("src/cli/onboarding-metadata.json");
    expect(labels).toContain("src/public-surface/generated-manifest.ts");
    expect(labels).toContain(onboardingMetadata.referencePaths.onboardingDoc);
    expect(labels).toContain(onboardingMetadata.referencePaths.skillDoc);
    expect(labels).toContain(onboardingMetadata.skillDiscovery.shadowRiskPath);
    expect(labels).not.toContain("src/tools/surface.ts");
  });

  it("keeps onboarding-recommended tool names local-only", () => {
    expect(new Set(onboardingMetadata.localOnlyToolNames)).toEqual(LOCAL_ONLY_TOOL_NAMES);
  });

  it("documents the temporary-profile default for one-shot run commands", () => {
    const persistProfileEntry = HELP_FLAG_GROUPS
      .flatMap((group) => group.flags)
      .find((entry) => entry.flag === "--persist-profile");

    expect(persistProfileEntry?.description).toContain("`run` uses a temporary profile by default");
  });
});
