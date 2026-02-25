import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, chmod, readFile, stat, access } from "fs/promises";
import * as os from "os";
import { join } from "path";
import { spawnSync } from "child_process";
import { SkillLoader } from "../src/skills/skill-loader";

let tempRoot = "";
let originalConfigDir: string | undefined;
let originalCodexHome: string | undefined;
let originalClaudeCodeHome: string | undefined;
let originalClaudeHome: string | undefined;
let originalAmpCliAliasHome: string | undefined;
let originalAmpCliHome: string | undefined;
let originalAmpHome: string | undefined;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(os.tmpdir(), "odb-skill-"));
  originalConfigDir = process.env.OPENCODE_CONFIG_DIR;
  originalCodexHome = process.env.CODEX_HOME;
  originalClaudeCodeHome = process.env.CLAUDECODE_HOME;
  originalClaudeHome = process.env.CLAUDE_HOME;
  originalAmpCliAliasHome = process.env.AMPCLI_HOME;
  originalAmpCliHome = process.env.AMP_CLI_HOME;
  originalAmpHome = process.env.AMP_HOME;
  process.env.OPENCODE_CONFIG_DIR = tempRoot;
  process.env.CODEX_HOME = join(tempRoot, "codex-home");
  process.env.CLAUDECODE_HOME = join(tempRoot, "claudecode-home");
  delete process.env.CLAUDE_HOME;
  delete process.env.AMPCLI_HOME;
  process.env.AMP_CLI_HOME = join(tempRoot, "amp-home");
  delete process.env.AMP_HOME;
  const skillDir = join(tempRoot, ".opencode", "skill", "opendevbrowser-best-practices");
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    join(skillDir, "SKILL.md"),
    `---
name: opendevbrowser-best-practices
description: Best practices for browser automation
version: 1.0.0
---

# Guide

## Actions
Do actions.

## Snapshots
Do snapshots.

## Quick Start
Do quick start.
`
  );
});

afterEach(() => {
  if (originalConfigDir === undefined) {
    delete process.env.OPENCODE_CONFIG_DIR;
  } else {
    process.env.OPENCODE_CONFIG_DIR = originalConfigDir;
  }

  if (originalCodexHome === undefined) {
    delete process.env.CODEX_HOME;
  } else {
    process.env.CODEX_HOME = originalCodexHome;
  }

  if (originalClaudeCodeHome === undefined) {
    delete process.env.CLAUDECODE_HOME;
  } else {
    process.env.CLAUDECODE_HOME = originalClaudeCodeHome;
  }

  if (originalClaudeHome === undefined) {
    delete process.env.CLAUDE_HOME;
  } else {
    process.env.CLAUDE_HOME = originalClaudeHome;
  }

  if (originalAmpCliAliasHome === undefined) {
    delete process.env.AMPCLI_HOME;
  } else {
    process.env.AMPCLI_HOME = originalAmpCliAliasHome;
  }

  if (originalAmpCliHome === undefined) {
    delete process.env.AMP_CLI_HOME;
  } else {
    process.env.AMP_CLI_HOME = originalAmpCliHome;
  }

  if (originalAmpHome === undefined) {
    delete process.env.AMP_HOME;
  } else {
    process.env.AMP_HOME = originalAmpHome;
  }
});

describe("SkillLoader", () => {
  it("loads best practices", async () => {
    const loader = new SkillLoader(tempRoot);
    const content = await loader.loadBestPractices();
    expect(content).toContain("# Guide");
    expect(content).toContain("Do actions.");
  });

  it("filters by topic when provided", async () => {
    const loader = new SkillLoader(tempRoot);
    const content = await loader.loadBestPractices("snap");
    expect(content).toContain("## Snapshots");
    expect(content).toContain("Do snapshots.");
    expect(content).not.toContain("## Actions");
  });

  it("filters headings with spaces using quick start topic", async () => {
    const loader = new SkillLoader(tempRoot);
    const content = await loader.loadBestPractices("quick start");
    expect(content).toContain("## Quick Start");
    expect(content).toContain("Do quick start.");
    expect(content).not.toContain("## Actions");
  });

  it("filters quick start heading using short quick topic", async () => {
    const loader = new SkillLoader(tempRoot);
    const content = await loader.loadBestPractices("quick");
    expect(content).toContain("## Quick Start");
    expect(content).toContain("Do quick start.");
    expect(content).not.toContain("## Actions");
  });

  it("returns full content when topic has no match", async () => {
    const loader = new SkillLoader(tempRoot);
    const content = await loader.loadBestPractices("missing");
    expect(content).toContain("## Actions");
    expect(content).toContain("## Snapshots");
  });

  it("falls back to global opencode skill directory when local is missing", async () => {
    const missingRoot = await mkdtemp(join(os.tmpdir(), "odb-skill-global-"));
    const globalSkillDir = join(tempRoot, "skill", "opendevbrowser-best-practices");
    await mkdir(globalSkillDir, { recursive: true });
    await writeFile(
      join(globalSkillDir, "SKILL.md"),
      `---
name: opendevbrowser-best-practices
description: Global guide
version: 1.0.0
---

# Guide
Global content.
`
    );

    const loader = new SkillLoader(missingRoot);
    const content = await loader.loadBestPractices();
    expect(content).toContain("# Guide");
    expect(content).toContain("Global content.");
  });

  it("throws when skill file is missing", async () => {
    const missingRoot = await mkdtemp(join(os.tmpdir(), "odb-skill-missing-"));
    const loader = new SkillLoader(missingRoot);
    await expect(loader.loadBestPractices()).rejects.toThrow("not found");
  });

  it("reports none when no skills are available", async () => {
    const emptyRoot = await mkdtemp(join(os.tmpdir(), "odb-skill-none-"));
    const emptyConfig = await mkdtemp(join(os.tmpdir(), "odb-skill-none-config-"));
    const originalConfigDir = process.env.OPENCODE_CONFIG_DIR;
    const originalHome = process.env.HOME;
    process.env.OPENCODE_CONFIG_DIR = emptyConfig;
    process.env.HOME = emptyConfig;
    try {
      const loader = new SkillLoader(emptyRoot);
      await expect(loader.loadSkill("missing-skill")).rejects.toThrow("Available: none");
    } finally {
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
      if (originalConfigDir === undefined) {
        delete process.env.OPENCODE_CONFIG_DIR;
      } else {
        process.env.OPENCODE_CONFIG_DIR = originalConfigDir;
      }
    }
  });

  it("rethrows unexpected readFile errors", async () => {
    if (process.platform === "win32") return;

    const restrictedRoot = await mkdtemp(join(os.tmpdir(), "odb-skill-restricted-"));
    const skillDir = join(restrictedRoot, ".opencode", "skill", "opendevbrowser-best-practices");
    const skillPath = join(skillDir, "SKILL.md");
    await mkdir(skillDir, { recursive: true });
    await writeFile(skillPath, "secret");
    await chmod(skillPath, 0o000);

    const loader = new SkillLoader(restrictedRoot);
    await expect(loader.loadBestPractices()).rejects.toThrow();

    await chmod(skillPath, 0o644);
  });
});

describe("SkillLoader.listSkills", () => {
  it("discovers skills in project .opencode/skill directory", async () => {
    const loader = new SkillLoader(tempRoot);
    const skills = await loader.listSkills();
    expect(skills.length).toBeGreaterThanOrEqual(1);
    expect(skills.some((s) => s.name === "opendevbrowser-best-practices")).toBe(true);
  });

  it("parses frontmatter metadata correctly", async () => {
    const loader = new SkillLoader(tempRoot);
    const skills = await loader.listSkills();
    const skill = skills.find((s) => s.name === "opendevbrowser-best-practices");
    expect(skill).toBeDefined();
    expect(skill?.description).toBe("Best practices for browser automation");
    expect(skill?.version).toBe("1.0.0");
  });

  it("handles empty frontmatter blocks", async () => {
    const skillDir = join(tempRoot, ".opencode", "skill", "empty-frontmatter");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      `---\n\n---\n# Empty Frontmatter\n`
    );

    const loader = new SkillLoader(tempRoot);
    const skills = await loader.listSkills();
    const skill = skills.find((s) => s.name === "empty-frontmatter");
    expect(skill).toBeDefined();
    expect(skill?.description).toBe("Skill: empty-frontmatter");
  });

  it("caches skills after first discovery", async () => {
    const loader = new SkillLoader(tempRoot);
    const skills1 = await loader.listSkills();
    const skills2 = await loader.listSkills();
    expect(skills1).toBe(skills2);
  });

  it("clearCache resets the cache", async () => {
    const loader = new SkillLoader(tempRoot);
    const skills1 = await loader.listSkills();
    loader.clearCache();
    const skills2 = await loader.listSkills();
    expect(skills1).not.toBe(skills2);
    expect(skills1).toEqual(skills2);
  });

  it("discovers skills from additional paths", async () => {
    const additionalPath = await mkdtemp(join(os.tmpdir(), "odb-skill-extra-"));
    await mkdir(join(additionalPath, "custom-skill"), { recursive: true });
    await writeFile(
      join(additionalPath, "custom-skill", "SKILL.md"),
      `---
name: custom-skill
description: A custom skill
---
# Custom
`
    );

    const loader = new SkillLoader(tempRoot, [additionalPath]);
    const skills = await loader.listSkills();
    expect(skills.some((s) => s.name === "custom-skill")).toBe(true);
    expect(skills.some((s) => s.name === "opendevbrowser-best-practices")).toBe(true);
  });

  it("expands tilde in additional paths", async () => {
    const loader = new SkillLoader(tempRoot, ["~/nonexistent-path"]);
    const skills = await loader.listSkills();
    expect(skills.length).toBeGreaterThanOrEqual(1);
  });

  it("falls back to os.homedir when OPENCODE_CONFIG_DIR is unset", async () => {
    const originalConfigDir = process.env.OPENCODE_CONFIG_DIR;
    const originalHome = process.env.HOME;
    delete process.env.OPENCODE_CONFIG_DIR;
    try {
      process.env.HOME = tempRoot;
      const loader = new SkillLoader(tempRoot);
      const skills = await loader.listSkills();
      expect(skills.some((s) => s.name === "opendevbrowser-best-practices")).toBe(true);
    } finally {
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
      if (originalConfigDir === undefined) {
        delete process.env.OPENCODE_CONFIG_DIR;
      } else {
        process.env.OPENCODE_CONFIG_DIR = originalConfigDir;
      }
    }
  });

  it("handles non-existent additional paths gracefully", async () => {
    const loader = new SkillLoader(tempRoot, ["/nonexistent/path/12345"]);
    const skills = await loader.listSkills();
    expect(skills.length).toBeGreaterThanOrEqual(1);
  });

  it("discovers skills from codex and amp compatibility directories", async () => {
    const codexHome = await mkdtemp(join(os.tmpdir(), "odb-skill-codex-"));
    const ampHome = await mkdtemp(join(os.tmpdir(), "odb-skill-amp-"));
    const originalCodexHome = process.env.CODEX_HOME;
    const originalAmpCliHome = process.env.AMP_CLI_HOME;

    process.env.CODEX_HOME = codexHome;
    process.env.AMP_CLI_HOME = ampHome;

    await mkdir(join(codexHome, "skills", "codex-compat"), { recursive: true });
    await writeFile(
      join(codexHome, "skills", "codex-compat", "SKILL.md"),
      `---
name: codex-compat
description: Codex compatibility skill
---
# Codex
`
    );

    await mkdir(join(ampHome, "skills", "amp-compat"), { recursive: true });
    await writeFile(
      join(ampHome, "skills", "amp-compat", "SKILL.md"),
      `---
name: amp-compat
description: Amp compatibility skill
---
# Amp
`
    );

    try {
      const loader = new SkillLoader(tempRoot);
      const skills = await loader.listSkills();
      expect(skills.some((skill) => skill.name === "codex-compat")).toBe(true);
      expect(skills.some((skill) => skill.name === "amp-compat")).toBe(true);
    } finally {
      if (originalCodexHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = originalCodexHome;
      }
      if (originalAmpCliHome === undefined) {
        delete process.env.AMP_CLI_HOME;
      } else {
        process.env.AMP_CLI_HOME = originalAmpCliHome;
      }
    }
  });

  it("discovers skills from CLAUDECODE_HOME/skills when set", async () => {
    const originalClaudeCodeHome = process.env.CLAUDECODE_HOME;
    const originalClaudeHome = process.env.CLAUDE_HOME;
    const claudeCodeHome = await mkdtemp(join(os.tmpdir(), "odb-skill-claudecode-home-"));

    process.env.CLAUDECODE_HOME = claudeCodeHome;
    delete process.env.CLAUDE_HOME;

    await mkdir(join(claudeCodeHome, "skills", "claudecode-compat"), { recursive: true });
    await writeFile(
      join(claudeCodeHome, "skills", "claudecode-compat", "SKILL.md"),
      `---
name: claudecode-compat
description: ClaudeCode compatibility skill
---
# ClaudeCode
`
    );

    try {
      const loader = new SkillLoader(tempRoot);
      const skills = await loader.listSkills();
      expect(skills.some((skill) => skill.name === "claudecode-compat")).toBe(true);
    } finally {
      if (originalClaudeCodeHome === undefined) {
        delete process.env.CLAUDECODE_HOME;
      } else {
        process.env.CLAUDECODE_HOME = originalClaudeCodeHome;
      }
      if (originalClaudeHome === undefined) {
        delete process.env.CLAUDE_HOME;
      } else {
        process.env.CLAUDE_HOME = originalClaudeHome;
      }
    }
  });

  it("falls back to CLAUDE_HOME/skills when CLAUDECODE_HOME is unset", async () => {
    const originalClaudeCodeHome = process.env.CLAUDECODE_HOME;
    const originalClaudeHome = process.env.CLAUDE_HOME;
    const claudeHome = await mkdtemp(join(os.tmpdir(), "odb-skill-claude-home-"));

    delete process.env.CLAUDECODE_HOME;
    process.env.CLAUDE_HOME = claudeHome;

    await mkdir(join(claudeHome, "skills", "claude-home-fallback"), { recursive: true });
    await writeFile(
      join(claudeHome, "skills", "claude-home-fallback", "SKILL.md"),
      `---
name: claude-home-fallback
description: CLAUDE_HOME fallback path
---
# Claude fallback
`
    );

    try {
      const loader = new SkillLoader(tempRoot);
      const skills = await loader.listSkills();
      expect(skills.some((skill) => skill.name === "claude-home-fallback")).toBe(true);
    } finally {
      if (originalClaudeCodeHome === undefined) {
        delete process.env.CLAUDECODE_HOME;
      } else {
        process.env.CLAUDECODE_HOME = originalClaudeCodeHome;
      }
      if (originalClaudeHome === undefined) {
        delete process.env.CLAUDE_HOME;
      } else {
        process.env.CLAUDE_HOME = originalClaudeHome;
      }
    }
  });

  it("prefers AMPCLI_HOME/skills when AMPCLI_HOME is set", async () => {
    const originalAmpCliAliasHome = process.env.AMPCLI_HOME;
    const originalAmpCliHome = process.env.AMP_CLI_HOME;
    const originalAmpHome = process.env.AMP_HOME;
    const ampCliHome = await mkdtemp(join(os.tmpdir(), "odb-skill-ampcli-home-"));

    process.env.AMPCLI_HOME = ampCliHome;
    delete process.env.AMP_CLI_HOME;
    delete process.env.AMP_HOME;

    await mkdir(join(ampCliHome, "skills", "ampcli-compat"), { recursive: true });
    await writeFile(
      join(ampCliHome, "skills", "ampcli-compat", "SKILL.md"),
      `---
name: ampcli-compat
description: AMPCLI compatibility skill
---
# AmpCLI
`
    );

    try {
      const loader = new SkillLoader(tempRoot);
      const skills = await loader.listSkills();
      expect(skills.some((skill) => skill.name === "ampcli-compat")).toBe(true);
    } finally {
      if (originalAmpCliAliasHome === undefined) {
        delete process.env.AMPCLI_HOME;
      } else {
        process.env.AMPCLI_HOME = originalAmpCliAliasHome;
      }
      if (originalAmpCliHome === undefined) {
        delete process.env.AMP_CLI_HOME;
      } else {
        process.env.AMP_CLI_HOME = originalAmpCliHome;
      }
      if (originalAmpHome === undefined) {
        delete process.env.AMP_HOME;
      } else {
        process.env.AMP_HOME = originalAmpHome;
      }
    }
  });

  it("falls back to ~/.codex/skills when CODEX_HOME is unset", async () => {
    const originalCodexHome = process.env.CODEX_HOME;
    const originalHome = process.env.HOME;
    const fallbackHome = await mkdtemp(join(os.tmpdir(), "odb-skill-codex-fallback-home-"));

    delete process.env.CODEX_HOME;
    process.env.HOME = fallbackHome;

    await mkdir(join(fallbackHome, ".codex", "skills", "codex-fallback"), { recursive: true });
    await writeFile(
      join(fallbackHome, ".codex", "skills", "codex-fallback", "SKILL.md"),
      `---
name: codex-fallback
description: Codex fallback path
---
# Codex fallback
`
    );

    try {
      const loader = new SkillLoader(tempRoot);
      const skills = await loader.listSkills();
      expect(skills.some((skill) => skill.name === "codex-fallback")).toBe(true);
    } finally {
      if (originalCodexHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = originalCodexHome;
      }
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
    }
  });

  it("falls back to AMP_HOME/skills when AMP_CLI_HOME is unset", async () => {
    const originalAmpCliHome = process.env.AMP_CLI_HOME;
    const originalAmpHome = process.env.AMP_HOME;
    const ampHome = await mkdtemp(join(os.tmpdir(), "odb-skill-amp-home-"));

    delete process.env.AMP_CLI_HOME;
    process.env.AMP_HOME = ampHome;

    await mkdir(join(ampHome, "skills", "amp-home-fallback"), { recursive: true });
    await writeFile(
      join(ampHome, "skills", "amp-home-fallback", "SKILL.md"),
      `---
name: amp-home-fallback
description: AMP_HOME fallback path
---
# Amp fallback
`
    );

    try {
      const loader = new SkillLoader(tempRoot);
      const skills = await loader.listSkills();
      expect(skills.some((skill) => skill.name === "amp-home-fallback")).toBe(true);
    } finally {
      if (originalAmpCliHome === undefined) {
        delete process.env.AMP_CLI_HOME;
      } else {
        process.env.AMP_CLI_HOME = originalAmpCliHome;
      }
      if (originalAmpHome === undefined) {
        delete process.env.AMP_HOME;
      } else {
        process.env.AMP_HOME = originalAmpHome;
      }
    }
  });

  it("falls back to ~/.amp/skills when AMP_CLI_HOME and AMP_HOME are unset", async () => {
    const originalAmpCliHome = process.env.AMP_CLI_HOME;
    const originalAmpHome = process.env.AMP_HOME;
    const originalHome = process.env.HOME;
    const fallbackHome = await mkdtemp(join(os.tmpdir(), "odb-skill-amp-default-home-"));

    delete process.env.AMP_CLI_HOME;
    delete process.env.AMP_HOME;
    process.env.HOME = fallbackHome;

    await mkdir(join(fallbackHome, ".amp", "skills", "amp-default-fallback"), { recursive: true });
    await writeFile(
      join(fallbackHome, ".amp", "skills", "amp-default-fallback", "SKILL.md"),
      `---
name: amp-default-fallback
description: AMP default home fallback path
---
# Amp default fallback
`
    );

    try {
      const loader = new SkillLoader(tempRoot);
      const skills = await loader.listSkills();
      expect(skills.some((skill) => skill.name === "amp-default-fallback")).toBe(true);
    } finally {
      if (originalAmpCliHome === undefined) {
        delete process.env.AMP_CLI_HOME;
      } else {
        process.env.AMP_CLI_HOME = originalAmpCliHome;
      }
      if (originalAmpHome === undefined) {
        delete process.env.AMP_HOME;
      } else {
        process.env.AMP_HOME = originalAmpHome;
      }
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
    }
  });

  it("filters sections when skill content starts with a heading", async () => {
    const additionalPath = await mkdtemp(join(os.tmpdir(), "odb-skill-heading-"));
    await mkdir(join(additionalPath, "heading-skill"), { recursive: true });
    await writeFile(
      join(additionalPath, "heading-skill", "SKILL.md"),
      `# Heading Skill\n\n## Topic\nKeep this.\n`
    );

    const loader = new SkillLoader(tempRoot, [additionalPath]);
    const content = await loader.loadSkill("heading-skill", "topic");
    expect(content).toContain("## Topic");
    expect(content).toContain("Keep this.");
  });

  it("deduplicates skills by name", async () => {
    const additionalPath = await mkdtemp(join(os.tmpdir(), "odb-skill-dup-"));
    await mkdir(join(additionalPath, "opendevbrowser-best-practices"), { recursive: true });
    await writeFile(
      join(additionalPath, "opendevbrowser-best-practices", "SKILL.md"),
      `---
name: opendevbrowser-best-practices
description: Duplicate
---
`
    );

    const loader = new SkillLoader(tempRoot, [additionalPath]);
    const skills = await loader.listSkills();
    const bpSkills = skills.filter((s) => s.name === "opendevbrowser-best-practices");
    expect(bpSkills.length).toBe(1);
    expect(bpSkills[0]?.description).toBe("Best practices for browser automation");
  });

  it("skips directories without SKILL.md", async () => {
    await mkdir(join(tempRoot, ".opencode", "skill", "empty-dir"), { recursive: true });
    const loader = new SkillLoader(tempRoot);
    const skills = await loader.listSkills();
    expect(skills.some((s) => s.name === "empty-dir")).toBe(false);
  });

  it("skips files in skill directory", async () => {
    await writeFile(join(tempRoot, ".opencode", "skill", "not-a-skill.txt"), "file content");
    const loader = new SkillLoader(tempRoot);
    const skills = await loader.listSkills();
    expect(skills.some((s) => s.name === "not-a-skill.txt")).toBe(false);
  });
});

describe("SkillLoader.loadSkill", () => {
  it("loads a skill by name", async () => {
    const loader = new SkillLoader(tempRoot);
    const content = await loader.loadSkill("opendevbrowser-best-practices");
    expect(content).toContain("# Guide");
  });

  it("loads skill with topic filtering", async () => {
    const loader = new SkillLoader(tempRoot);
    const content = await loader.loadSkill("opendevbrowser-best-practices", "actions");
    expect(content).toContain("## Actions");
    expect(content).not.toContain("## Snapshots");
  });

  it("throws for unknown skill with available list", async () => {
    const loader = new SkillLoader(tempRoot);
    await expect(loader.loadSkill("unknown-skill")).rejects.toThrow("not found");
    await expect(loader.loadSkill("unknown-skill")).rejects.toThrow("opendevbrowser-best-practices");
  });

  it("handles empty topic gracefully", async () => {
    const loader = new SkillLoader(tempRoot);
    const content = await loader.loadSkill("opendevbrowser-best-practices", "  ");
    expect(content).toContain("## Actions");
    expect(content).toContain("## Snapshots");
  });
});

describe("SkillLoader.parseSkillMetadata", () => {
  it("parses complete frontmatter", () => {
    const loader = new SkillLoader(tempRoot);
    const content = `---
name: test-skill
description: Test description
version: 2.0.0
---
# Content
`;
    const metadata = loader.parseSkillMetadata(content, "fallback-name");
    expect(metadata.name).toBe("test-skill");
    expect(metadata.description).toBe("Test description");
    expect(metadata.version).toBe("2.0.0");
  });

  it("falls back to directory name when no frontmatter", () => {
    const loader = new SkillLoader(tempRoot);
    const content = "# Just Content\n\nSome paragraph text.";
    const metadata = loader.parseSkillMetadata(content, "dir-name");
    expect(metadata.name).toBe("dir-name");
    expect(metadata.description).toBe("Some paragraph text.");
  });

  it("extracts first paragraph for description when not in frontmatter", () => {
    const loader = new SkillLoader(tempRoot);
    const content = `---
name: skill-name
---

# Title

First paragraph line one.
First paragraph line two.

Second paragraph.
`;
    const metadata = loader.parseSkillMetadata(content, "dir");
    expect(metadata.name).toBe("skill-name");
    expect(metadata.description).toContain("First paragraph");
  });

  it("handles missing description gracefully", () => {
    const loader = new SkillLoader(tempRoot);
    const content = `---
name: skill-only
---
`;
    const metadata = loader.parseSkillMetadata(content, "dir");
    expect(metadata.name).toBe("skill-only");
    expect(metadata.description).toContain("skill-only");
  });

  it("handles quoted values in frontmatter", () => {
    const loader = new SkillLoader(tempRoot);
    const content = `---
name: "quoted-name"
description: 'single quoted desc'
---
`;
    const metadata = loader.parseSkillMetadata(content, "dir");
    expect(metadata.name).toBe("quoted-name");
    expect(metadata.description).toBe("single quoted desc");
  });

  it("falls back to Skill: dirname when no frontmatter and no extractable paragraph", () => {
    const loader = new SkillLoader(tempRoot);
    const content = "# Only Headings\n## Another Heading\n### Third";
    const metadata = loader.parseSkillMetadata(content, "my-skill");
    expect(metadata.name).toBe("my-skill");
    expect(metadata.description).toBe("Skill: my-skill");
  });

  it("falls back when frontmatter exists but no description extractable", () => {
    const loader = new SkillLoader(tempRoot);
    const content = `---
name: named-skill
---
# Only Headings
## No Paragraph Text
`;
    const metadata = loader.parseSkillMetadata(content, "dir");
    expect(metadata.name).toBe("named-skill");
    expect(metadata.description).toBe("Skill: named-skill");
  });
});

describe("filterSections edge cases", () => {
  it("handles content with body lines before any heading", async () => {
    await writeFile(
      join(tempRoot, ".opencode", "skill", "opendevbrowser-best-practices", "SKILL.md"),
      `---
name: opendevbrowser-best-practices
description: Test
---
Preamble text before any heading.

# Heading One
Content one.
`
    );
    const loader = new SkillLoader(tempRoot);
    loader.clearCache();
    const content = await loader.loadSkill("opendevbrowser-best-practices", "one");
    expect(content).toContain("# Heading One");
    expect(content).toContain("Content one");
  });

  it("handles headings with no text after hash", async () => {
    await writeFile(
      join(tempRoot, ".opencode", "skill", "opendevbrowser-best-practices", "SKILL.md"),
      `---
name: opendevbrowser-best-practices
description: Test
---
# 
Some content.

## Valid Heading
More content.
`
    );
    const loader = new SkillLoader(tempRoot);
    loader.clearCache();
    const content = await loader.loadSkill("opendevbrowser-best-practices", "valid");
    expect(content).toContain("## Valid Heading");
  });
});

describe("bundled best-practices skill assets", () => {
  const skillRoot = join(process.cwd(), "skills", "opendevbrowser-best-practices");
  const requiredAssetRefs = [
    "artifacts/provider-workflows.md",
    "artifacts/parity-gates.md",
    "artifacts/debug-trace-playbook.md",
    "artifacts/fingerprint-tiers.md",
    "artifacts/macro-workflows.md",
    "artifacts/browser-agent-known-issues-matrix.md",
    "assets/templates/robustness-checklist.json",
    "scripts/odb-workflow.sh",
    "scripts/run-robustness-audit.sh",
    "scripts/validate-skill-assets.sh"
  ];

  it("references required artifacts and scripts from SKILL.md", async () => {
    const skillDoc = await readFile(join(skillRoot, "SKILL.md"), "utf8");
    for (const assetRef of requiredAssetRefs) {
      expect(skillDoc).toContain(assetRef);
      await expect(access(join(skillRoot, assetRef))).resolves.toBeUndefined();
    }
  });

  it("marks workflow and validator scripts as executable", async () => {
    for (const scriptRel of ["scripts/odb-workflow.sh", "scripts/run-robustness-audit.sh", "scripts/validate-skill-assets.sh"]) {
      const stats = await stat(join(skillRoot, scriptRel));
      expect((stats.mode & 0o111) !== 0).toBe(true);
    }
  });

  it("passes the asset validation script", () => {
    if (process.platform === "win32") return;
    const scriptPath = join(skillRoot, "scripts", "validate-skill-assets.sh");
    const result = spawnSync("bash", [scriptPath], { cwd: process.cwd(), encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Skill assets validated:");
  }, 20000);
});
