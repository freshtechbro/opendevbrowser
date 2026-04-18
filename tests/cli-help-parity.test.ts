import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CLI_COMMANDS } from "../src/cli/args";
import onboardingMetadata from "../src/cli/onboarding-metadata.json";
import { COMMAND_HELP_DETAILS, HELP_COMMAND_GROUPS, HELP_FLAG_GROUPS, HELP_REFERENCE_ENTRIES, HELP_TOOL_ENTRIES } from "../src/cli/help";
import { INSPIREDESIGN_HANDOFF_COMMANDS, INSPIREDESIGN_HANDOFF_GUIDANCE } from "../src/inspiredesign/handoff";
import { LOCAL_ONLY_TOOL_NAMES } from "../src/tools";
import { TOOL_SURFACE_ENTRIES } from "../src/public-surface/generated-manifest";

function getRuntimeCommandDescriptions(): Record<string, string> {
  const source = readFileSync(resolve(process.cwd(), "src/cli/index.ts"), "utf8");
  return Object.fromEntries(
    [...source.matchAll(/registerCommand\(\{\s*name:\s*"([^"]+)",\s*description:\s*"([^"]+)"/gs)]
      .map((match) => [match[1], match[2]])
  );
}

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

  it("includes screencast and desktop public-surface entries", () => {
    const commandNames = HELP_COMMAND_GROUPS.flatMap((group) => [...group.commands]);
    const toolNames = HELP_TOOL_ENTRIES.map((entry) => entry.name);

    expect(commandNames).toEqual(expect.arrayContaining([
      "screencast-start",
      "screencast-stop",
      "desktop-status",
      "desktop-windows",
      "desktop-active-window",
      "desktop-capture-desktop",
      "desktop-capture-window",
      "desktop-accessibility-snapshot"
    ]));
    expect(HELP_COMMAND_GROUPS.find((group) => group.title === "Browser Replay")?.commands).toEqual([
      "screencast-start",
      "screencast-stop"
    ]);
    expect(HELP_COMMAND_GROUPS.find((group) => group.title === "Desktop Observation")?.commands).toEqual([
      "desktop-status",
      "desktop-windows",
      "desktop-active-window",
      "desktop-capture-desktop",
      "desktop-capture-window",
      "desktop-accessibility-snapshot"
    ]);
    expect(HELP_COMMAND_GROUPS.find((group) => group.title === "Desktop Observation")?.summary).toContain("swift command");
    expect(HELP_COMMAND_GROUPS.find((group) => group.title === "Desktop Observation")?.summary).toContain("screencapture");
    expect(toolNames).toEqual(expect.arrayContaining([
      "opendevbrowser_screencast_start",
      "opendevbrowser_screencast_stop",
      "opendevbrowser_desktop_status",
      "opendevbrowser_desktop_windows",
      "opendevbrowser_desktop_active_window",
      "opendevbrowser_desktop_capture_desktop",
      "opendevbrowser_desktop_capture_window",
      "opendevbrowser_desktop_accessibility_snapshot"
    ]));
    expect(COMMAND_HELP_DETAILS["screencast-start"].flags).toEqual(expect.arrayContaining([
      "--output-dir",
      "--interval-ms",
      "--max-frames"
    ]));
    expect(COMMAND_HELP_DETAILS["desktop-capture-window"].flags).toEqual(expect.arrayContaining([
      "--window-id",
      "--reason",
      "--timeout-ms"
    ]));
  });

  it("includes inspiredesign command, tool, and required workflow flags", () => {
    const commandNames = HELP_COMMAND_GROUPS.flatMap((group) => [...group.commands]);
    const toolNames = HELP_TOOL_ENTRIES.map((entry) => entry.name);

    expect(commandNames).toContain("inspiredesign");
    expect(toolNames).toContain("opendevbrowser_inspiredesign_run");
    expect(COMMAND_HELP_DETAILS.inspiredesign.flags).toEqual(expect.arrayContaining([
      "--brief",
      "--url",
      "--capture-mode",
      "--include-prototype-guidance"
    ]));
  });

  it("keeps runtime command registration aligned with the declared CLI inventory", () => {
    const source = readFileSync(resolve(process.cwd(), "src/cli/index.ts"), "utf8");
    const registeredNames = [...source.matchAll(/registerCommand\(\{\s*name:\s*"([^"]+)"/gs)].map((match) => match[1]);

    expect(new Set(registeredNames)).toEqual(new Set(CLI_COMMANDS));
  });

  it("keeps runtime command descriptions aligned with generated help descriptions", () => {
    const runtimeDescriptions = getRuntimeCommandDescriptions();

    expect(new Set(Object.keys(runtimeDescriptions))).toEqual(new Set(CLI_COMMANDS));
    for (const command of CLI_COMMANDS) {
      expect(COMMAND_HELP_DETAILS[command].description.length).toBeGreaterThan(0);
      expect(COMMAND_HELP_DETAILS[command].description).toBe(runtimeDescriptions[command]);
    }
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
    expect(COMMAND_HELP_DETAILS.inspiredesign.flags).toEqual(expect.arrayContaining([
      "--brief",
      "--url",
      "--capture-mode",
      "--include-prototype-guidance"
    ]));
    expect(HELP_COMMAND_GROUPS.flatMap((group) => [...group.commands])).toContain("inspiredesign");
    expect(HELP_TOOL_ENTRIES.map((entry) => entry.name)).toContain("opendevbrowser_inspiredesign_run");
  });

  it("mentions both help invocations in the generated help text", () => {
    const labels = HELP_REFERENCE_ENTRIES.map((entry) => entry.label);

    expect(labels).toContain("opendevbrowser --help");
    expect(labels).toContain("opendevbrowser help");
    expect(labels).toContain("src/cli/help.ts");
    expect(labels).toContain("src/cli/onboarding-metadata.json");
    expect(labels).toContain("src/inspiredesign/handoff.ts");
    expect(labels).toContain("src/public-surface/generated-manifest.ts");
    expect(labels).toContain("docs/WORKFLOW_SURFACE_MAP.md");
    expect(labels).toContain(onboardingMetadata.referencePaths.onboardingDoc);
    expect(labels).toContain(onboardingMetadata.referencePaths.skillDoc);
    expect(labels).not.toContain("~/.codex/skills/opendevbrowser-best-practices");
    expect(labels).not.toContain("src/tools/surface.ts");
  });

  it("keeps inspiredesign followthrough commands sourced from the shared handoff module", () => {
    const inspiredesignEntry = HELP_REFERENCE_ENTRIES.find((entry) => entry.label === "src/inspiredesign/handoff.ts");

    expect(inspiredesignEntry?.description).toContain("Shared inspiredesign follow-through commands");
    expect(INSPIREDESIGN_HANDOFF_COMMANDS.loadBestPractices).toContain("opendevbrowser-best-practices");
    expect(INSPIREDESIGN_HANDOFF_COMMANDS.loadDesignAgent).toContain("opendevbrowser-design-agent");
    expect(INSPIREDESIGN_HANDOFF_GUIDANCE.prepareCanvasPlanRequest).toContain("canvas-plan.request.json");
    expect(INSPIREDESIGN_HANDOFF_COMMANDS.continueInCanvas).toContain("canvas.plan.set");
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
