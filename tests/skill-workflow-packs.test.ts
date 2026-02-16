import { access } from "fs/promises";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { SkillLoader } from "../src/skills/skill-loader";

const repoRoot = process.cwd();
const bundledSkillsDir = join(repoRoot, "skills");

const requiredFilesBySkill: Record<string, string[]> = {
  research: [
    "SKILL.md",
    "scripts/run-research.sh",
    "scripts/render-output.sh",
    "scripts/write-artifacts.sh",
    "assets/templates/compact.md",
    "assets/templates/report.md",
    "assets/templates/context.json"
  ],
  shopping: [
    "SKILL.md",
    "scripts/run-shopping.sh",
    "scripts/normalize-offers.sh",
    "scripts/render-deals.sh",
    "assets/templates/deals-table.md",
    "assets/templates/deals-context.json"
  ],
  "product-presentation-asset": [
    "SKILL.md",
    "scripts/collect-product.sh",
    "scripts/capture-screenshots.sh",
    "scripts/download-images.sh",
    "scripts/write-manifest.sh",
    "assets/templates/manifest.schema.json",
    "assets/templates/copy.md",
    "assets/templates/features.md"
  ]
};

describe("workflow skill packs", () => {
  it("discovers research/shopping/product-presentation-asset skills", async () => {
    const loader = new SkillLoader(join(repoRoot, "non-existent-root"), [bundledSkillsDir]);
    const skills = await loader.listSkills();
    const names = skills.map((skill) => skill.name);

    expect(names).toContain("research");
    expect(names).toContain("shopping");
    expect(names).toContain("product-presentation-asset");
  });

  it("contains required scripts and templates for each workflow skill", async () => {
    for (const [skill, files] of Object.entries(requiredFilesBySkill)) {
      for (const relativePath of files) {
        await expect(access(join(bundledSkillsDir, skill, relativePath))).resolves.toBeUndefined();
      }
    }
  });
});
