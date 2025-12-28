import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, mkdir, writeFile, chmod } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { SkillLoader } from "../src/skills/skill-loader";

let tempRoot = "";

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "odb-skill-"));
  await mkdir(join(tempRoot, "skills", "opendevbrowser-best-practices"), { recursive: true });
  await writeFile(
    join(tempRoot, "skills", "opendevbrowser-best-practices", "SKILL.md"),
    "\n# Guide\n\n## Actions\nDo actions.\n\n## Snapshots\nDo snapshots.\n"
  );
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

  it("falls back to parent skills directory when root lacks skills", async () => {
    const distRoot = join(tempRoot, "dist");
    await mkdir(distRoot, { recursive: true });
    const loader = new SkillLoader(distRoot);
    const content = await loader.loadBestPractices();
    expect(content).toContain("# Guide");
  });

  it("throws when skill file is missing", async () => {
    const missingRoot = await mkdtemp(join(tmpdir(), "odb-skill-missing-"));
    const loader = new SkillLoader(missingRoot);
    await expect(loader.loadBestPractices()).rejects.toThrow("could not find");
  });

  it("rethrows unexpected readFile errors", async () => {
    if (process.platform === "win32") return;

    const restrictedRoot = await mkdtemp(join(tmpdir(), "odb-skill-restricted-"));
    const skillDir = join(restrictedRoot, "skills", "opendevbrowser-best-practices");
    const skillPath = join(skillDir, "SKILL.md");
    await mkdir(skillDir, { recursive: true });
    await writeFile(skillPath, "secret");
    await chmod(skillPath, 0o000);

    const loader = new SkillLoader(restrictedRoot);
    await expect(loader.loadBestPractices()).rejects.toThrow();

    await chmod(skillPath, 0o644);
  });
});
