import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
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

  it("loads the bundled quick-start guide even when the outer Codex home is stale", async () => {
    const staleRoot = await mkdtemp(join(os.tmpdir(), "odb-stale-skill-home-"));
    const isolatedRoot = await mkdtemp(join(os.tmpdir(), "odb-isolated-skill-home-"));
    const staleSkillDir = join(staleRoot, "skills", onboardingMetadata.skillName);
    await mkdir(staleSkillDir, { recursive: true });
    await writeFile(
      join(staleSkillDir, "SKILL.md"),
      [
        "---",
        `name: ${onboardingMetadata.skillName}`,
        "description: stale copy",
        "---",
        "",
        "## Fast Start",
        "Legacy heading"
      ].join("\n"),
      "utf8"
    );

    const previousCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = staleRoot;
    try {
      const guide = await loadQuickStartGuide(process.cwd(), onboardingMetadata, {
        CODEX_HOME: isolatedRoot,
        OPENCODE_CONFIG_DIR: join(isolatedRoot, "config"),
        CLAUDECODE_HOME: join(isolatedRoot, ".claude"),
        CLAUDE_HOME: join(isolatedRoot, ".claude"),
        AMPCLI_HOME: join(isolatedRoot, ".amp"),
        AMP_CLI_HOME: join(isolatedRoot, ".amp"),
        AMP_HOME: join(isolatedRoot, ".amp")
      });
      expect(guide).toContain("## Quick Start");
      expect(guide).not.toContain("## Fast Start");
    } finally {
      if (previousCodexHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = previousCodexHome;
      }
    }
  });
});
