import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, mkdir, writeFile } from "fs/promises";
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
});
