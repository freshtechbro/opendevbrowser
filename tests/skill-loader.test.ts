import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, chmod } from "fs/promises";
import * as os from "os";
import { join } from "path";
import { SkillLoader } from "../src/skills/skill-loader";

let tempRoot = "";
let originalConfigDir: string | undefined;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(os.tmpdir(), "odb-skill-"));
  originalConfigDir = process.env.OPENCODE_CONFIG_DIR;
  process.env.OPENCODE_CONFIG_DIR = tempRoot;
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
`
  );
});

afterEach(() => {
  if (originalConfigDir === undefined) {
    delete process.env.OPENCODE_CONFIG_DIR;
  } else {
    process.env.OPENCODE_CONFIG_DIR = originalConfigDir;
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
