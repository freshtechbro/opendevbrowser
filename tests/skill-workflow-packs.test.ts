import { access } from "fs/promises";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { SkillLoader } from "../src/skills/skill-loader";

const repoRoot = process.cwd();
const bundledSkillsDir = join(repoRoot, "skills");

const requiredFilesBySkill: Record<string, string[]> = {
  "opendevbrowser-login-automation": [
    "SKILL.md",
    "artifacts/login-workflows.md",
    "assets/templates/login-scenario-matrix.json",
    "assets/templates/challenge-checkpoint.md",
    "assets/templates/auth-signals.json",
    "scripts/run-login-workflow.sh",
    "scripts/record-auth-signals.sh",
    "scripts/validate-skill-assets.sh"
  ],
  "opendevbrowser-form-testing": [
    "SKILL.md",
    "artifacts/form-workflows.md",
    "assets/templates/validation-matrix.json",
    "assets/templates/challenge-decision-tree.json",
    "assets/templates/a11y-assertions.md",
    "assets/templates/multi-step-state.json",
    "scripts/run-form-workflow.sh",
    "scripts/validate-skill-assets.sh"
  ],
  "opendevbrowser-data-extraction": [
    "SKILL.md",
    "artifacts/extraction-workflows.md",
    "assets/templates/extraction-schema.json",
    "assets/templates/pagination-state.json",
    "assets/templates/quality-gates.json",
    "assets/templates/compliance-checklist.md",
    "scripts/run-extraction-workflow.sh",
    "scripts/validate-skill-assets.sh"
  ],
  "opendevbrowser-research": [
    "SKILL.md",
    "artifacts/research-workflows.md",
    "scripts/run-research.sh",
    "scripts/render-output.sh",
    "scripts/write-artifacts.sh",
    "scripts/validate-skill-assets.sh",
    "assets/templates/compact.md",
    "assets/templates/report.md",
    "assets/templates/context.json"
  ],
  "opendevbrowser-shopping": [
    "SKILL.md",
    "artifacts/deal-hunting-workflows.md",
    "scripts/run-shopping.sh",
    "scripts/normalize-offers.sh",
    "scripts/render-deals.sh",
    "scripts/analyze-market.sh",
    "scripts/run-deal-hunt.sh",
    "scripts/validate-skill-assets.sh",
    "assets/templates/deals-table.md",
    "assets/templates/deals-context.json",
    "assets/templates/market-analysis.json",
    "assets/templates/deal-thresholds.json"
  ],
  "opendevbrowser-product-presentation-asset": [
    "SKILL.md",
    "artifacts/asset-pack-assembly.md",
    "artifacts/ugc-creative-guide.md",
    "scripts/collect-product.sh",
    "scripts/capture-screenshots.sh",
    "scripts/download-images.sh",
    "scripts/write-manifest.sh",
    "scripts/render-video-brief.sh",
    "scripts/validate-skill-assets.sh",
    "assets/templates/manifest.schema.json",
    "assets/templates/copy.md",
    "assets/templates/features.md",
    "assets/templates/video-assembly.md",
    "assets/templates/user-actions.md",
    "assets/templates/ugc-concepts.md",
    "assets/templates/shot-list.md",
    "assets/templates/claims-evidence-map.md"
  ]
};

describe("workflow skill packs", () => {
  it("discovers workflow skill packs", async () => {
    const loader = new SkillLoader(join(repoRoot, "non-existent-root"), [bundledSkillsDir]);
    const skills = await loader.listSkills();
    const names = skills.map((skill) => skill.name);

    expect(names).toContain("opendevbrowser-login-automation");
    expect(names).toContain("opendevbrowser-form-testing");
    expect(names).toContain("opendevbrowser-data-extraction");
    expect(names).toContain("opendevbrowser-research");
    expect(names).toContain("opendevbrowser-shopping");
    expect(names).toContain("opendevbrowser-product-presentation-asset");
  });

  it("contains required scripts and templates for each workflow skill", async () => {
    for (const [skill, files] of Object.entries(requiredFilesBySkill)) {
      for (const relativePath of files) {
        await expect(access(join(bundledSkillsDir, skill, relativePath))).resolves.toBeUndefined();
      }
    }
  });
});
