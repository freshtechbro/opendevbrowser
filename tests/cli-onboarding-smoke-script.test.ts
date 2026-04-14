import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import onboardingMetadata from "../src/cli/onboarding-metadata.json";
import {
  assertOnboardingHelp,
  assertQuickStartGuide,
  loadQuickStartGuide
} from "../scripts/cli-onboarding-smoke.mjs";

describe("cli-onboarding-smoke script", () => {
  it("accepts help output that includes the canonical onboarding path", () => {
    const helpText = [
      "OpenDevBrowser CLI",
      "",
      `${onboardingMetadata.sectionTitle}:`,
      `  ${onboardingMetadata.sectionSummary}`,
      `  prompting_guide ${onboardingMetadata.quickStartCommands.promptingGuide}`,
      `  skill_load ${onboardingMetadata.quickStartCommands.skillLoad}`,
      `  skill_list ${onboardingMetadata.quickStartCommands.skillList}`,
      `  computer_use_entry ${onboardingMetadata.quickStartCommands.computerUseEntry}`,
      `  happy_path ${onboardingMetadata.quickStartCommands.happyPath}`,
      `  docs ${onboardingMetadata.referencePaths.onboardingDoc}`,
      `  skill ${onboardingMetadata.referencePaths.skillDoc}`
    ].join("\n");

    expect(() => assertOnboardingHelp(helpText)).not.toThrow();
  });

  it("rejects help output when the quick-start path is missing", () => {
    expect(() => assertOnboardingHelp("OpenDevBrowser CLI")).toThrow("Help output is missing onboarding guidance");
  });

  it("accepts the canonical quick-start guide heading", () => {
    expect(() => assertQuickStartGuide("## Quick Start\nRun the workflow.")).not.toThrow();
  });

  it("rejects stale Fast Start guidance", () => {
    expect(() => assertQuickStartGuide("## Fast Start\nRun the workflow.")).toThrow("stale Fast Start");
  });

  it("loads the bundled quick-start guide inside isolated compatibility homes", async () => {
    const isolatedRoot = await mkdtemp(join(os.tmpdir(), "odb-isolated-skill-home-"));
    const { SkillLoader } = await import("../src/skills/skill-loader");
    const guide = await loadQuickStartGuide(process.cwd(), onboardingMetadata, {
      CODEX_HOME: isolatedRoot,
      OPENCODE_CONFIG_DIR: join(isolatedRoot, "config"),
      CLAUDECODE_HOME: join(isolatedRoot, ".claude"),
      AMP_CLI_HOME: join(isolatedRoot, ".amp")
    }, SkillLoader);
    expect(guide).toContain("## Quick Start");
    expect(guide).not.toContain("## Fast Start");
  });
});
