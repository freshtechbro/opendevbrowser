import { access, chmod, copyFile, cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "fs/promises";
import { spawnSync } from "child_process";
import { join } from "path";
import * as os from "os";
import { describe, expect, it } from "vitest";
import { PRODUCT_VIDEO_BRIEF_HELPER_PATH } from "../src/providers/workflow-handoff";
import { SkillLoader } from "../src/skills/skill-loader";

const repoRoot = process.cwd();
const bundledSkillsDir = join(repoRoot, "skills");

type ResearchValidatorMutation = {
  relativePath: string;
  mutate: (content: string) => string;
  expectedError: string;
};

const runResearchValidatorWithMutation = async (mutation: ResearchValidatorMutation) => {
  const tempRoot = await mkdtemp(join(os.tmpdir(), "odb-research-validator-"));
  const tempSkillsDir = join(tempRoot, "skills");
  const skillName = "opendevbrowser-research";
  try {
    await mkdir(tempSkillsDir, { recursive: true });
    await cp(join(bundledSkillsDir, skillName), join(tempSkillsDir, skillName), { recursive: true });
    await cp(
      join(bundledSkillsDir, "opendevbrowser-best-practices"),
      join(tempSkillsDir, "opendevbrowser-best-practices"),
      { recursive: true }
    );
    const target = join(tempSkillsDir, skillName, mutation.relativePath);
    await writeFile(target, mutation.mutate(await readFile(target, "utf8")));
    return spawnSync("/bin/bash", [join(tempSkillsDir, skillName, "scripts/validate-skill-assets.sh")], {
      cwd: tempRoot,
      encoding: "utf8",
      env: process.env
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
};

const requiredFilesBySkill: Record<string, string[]> = {
  "opendevbrowser-continuity-ledger": [
    "SKILL.md",
    "scripts/validate-skill-assets.sh"
  ],
  "opendevbrowser-design-agent": [
    "SKILL.md",
    "artifacts/design-workflows.md",
    "artifacts/design-contract-playbook.md",
    "artifacts/frontend-evaluation-rubric.md",
    "artifacts/external-pattern-synthesis.md",
    "artifacts/component-pattern-index.md",
    "artifacts/existing-surface-adaptation.md",
    "artifacts/app-shell-and-state-wiring.md",
    "artifacts/state-ownership-matrix.md",
    "artifacts/async-search-state-ownership.md",
    "artifacts/loading-and-feedback-surfaces.md",
    "artifacts/theming-and-token-ownership.md",
    "artifacts/isolated-preview-validation.md",
    "artifacts/performance-audit-playbook.md",
    "artifacts/scroll-reveal-surface-planning.md",
    "artifacts/research-harvest-workflow.md",
    "artifacts/design-release-gate.md",
    "artifacts/opendevbrowser-ui-example-map.md",
    "artifacts/implementation-anti-patterns.md",
    "assets/templates/design-brief.v1.md",
    "assets/templates/design-audit-report.v1.md",
    "assets/templates/design-contract.v1.json",
    "assets/templates/canvas-generation-plan.design.v1.json",
    "assets/templates/design-review-checklist.json",
    "assets/templates/real-surface-design-matrix.json",
    "assets/templates/reference-pattern-board.v1.json",
    "assets/templates/design-release-gate.v1.json",
    "scripts/design-workflow.sh",
    "scripts/extract-canvas-plan.sh",
    "scripts/validate-skill-assets.sh"
  ],
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
  it("discovers bundled workflow skill packs without extra skill paths", async () => {
    const tempEnvRoot = await mkdtemp(join(os.tmpdir(), "odb-skill-pack-discovery-"));
    const originalConfigDir = process.env.OPENCODE_CONFIG_DIR;
    const originalCodexHome = process.env.CODEX_HOME;
    const originalClaudeCodeHome = process.env.CLAUDECODE_HOME;
    const originalAmpCliHome = process.env.AMP_CLI_HOME;

    process.env.OPENCODE_CONFIG_DIR = join(tempEnvRoot, "config");
    process.env.CODEX_HOME = join(tempEnvRoot, "codex-home");
    process.env.CLAUDECODE_HOME = join(tempEnvRoot, "claudecode-home");
    process.env.AMP_CLI_HOME = join(tempEnvRoot, "amp-home");

    try {
      const loader = new SkillLoader(join(repoRoot, "non-existent-root"));
      const names = (await loader.listSkills()).map((skill) => skill.name);

      expect(names).toContain("opendevbrowser-login-automation");
      expect(names).toContain("opendevbrowser-design-agent");
      expect(names).toContain("opendevbrowser-form-testing");
      expect(names).toContain("opendevbrowser-data-extraction");
      expect(names).toContain("opendevbrowser-research");
      expect(names).toContain("opendevbrowser-shopping");
      expect(names).toContain("opendevbrowser-product-presentation-asset");
    } finally {
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
      if (originalAmpCliHome === undefined) {
        delete process.env.AMP_CLI_HOME;
      } else {
        process.env.AMP_CLI_HOME = originalAmpCliHome;
      }
      await rm(tempEnvRoot, { recursive: true, force: true });
    }
  });

  it("discovers workflow skill packs", async () => {
    const loader = new SkillLoader(join(repoRoot, "non-existent-root"), [bundledSkillsDir]);
    const skills = await loader.listSkills();
    const names = skills.map((skill) => skill.name);

    expect(names).toContain("opendevbrowser-login-automation");
    expect(names).toContain("opendevbrowser-design-agent");
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
  it("documents the product-video brief helper with the bundled skill path", async () => {
    const content = await readFile(
      join(bundledSkillsDir, "opendevbrowser-product-presentation-asset", "SKILL.md"),
      "utf8"
    );

    expect(content).toContain(`\`${PRODUCT_VIDEO_BRIEF_HELPER_PATH}\``);
  });

  it("uses the shared CLI resolver for executable workflow wrappers", async () => {
    const cliScriptPaths = [
      "opendevbrowser-research/scripts/run-research.sh",
      "opendevbrowser-research/scripts/render-output.sh",
      "opendevbrowser-research/scripts/write-artifacts.sh",
      "opendevbrowser-shopping/scripts/run-shopping.sh",
      "opendevbrowser-shopping/scripts/normalize-offers.sh",
      "opendevbrowser-shopping/scripts/run-deal-hunt.sh",
      "opendevbrowser-product-presentation-asset/scripts/collect-product.sh",
      "opendevbrowser-product-presentation-asset/scripts/capture-screenshots.sh",
      "opendevbrowser-product-presentation-asset/scripts/download-images.sh",
      "opendevbrowser-product-presentation-asset/scripts/write-manifest.sh"
    ];

    for (const relativePath of cliScriptPaths) {
      const content = await readFile(join(bundledSkillsDir, relativePath), "utf8");
      expect(content).toContain("resolve-odb-cli.sh");
      expect(content).toContain("ODB_CLI");
    }
  });

  it("uses the validator override before local CLI discovery", async () => {
    if (process.platform === "win32") return;

    const tempRoot = await mkdtemp(join(os.tmpdir(), "odb-cli-validator-override-"));
    const overridePath = join(tempRoot, "fixture-cli.sh");

    try {
      await writeFile(overridePath, "#!/bin/sh\nprintf '%s\\n' override-cli\n");
      await chmod(overridePath, 0o755);

      const result = spawnSync(
        "/bin/bash",
        [
          "-lc",
          [
            "source \"$1\"",
            "printf '%s\\n' \"${ODB_CLI[@]}\""
          ].join("\n"),
          "bash",
          join(bundledSkillsDir, "opendevbrowser-best-practices", "scripts", "resolve-odb-cli.sh")
        ],
        {
          cwd: repoRoot,
          encoding: "utf8",
          env: {
            ...process.env,
            ODB_CLI_VALIDATOR_OVERRIDE: overridePath
          }
        }
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout.trim()).toBe(overridePath);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("uses the shared CLI resolver for router workflows across agent packs", async () => {
    const routerScriptPaths = [
      "opendevbrowser-best-practices/scripts/odb-workflow.sh",
      "opendevbrowser-design-agent/scripts/design-workflow.sh"
    ];

    for (const relativePath of routerScriptPaths) {
      const content = await readFile(join(bundledSkillsDir, relativePath), "utf8");
      expect(content).toContain("resolve-odb-cli.sh");
      expect(content).toContain("CLI_PREFIX");
    }
  });

  it("resolves a repo-local CLI before PATH and npx for installed workflow copies", async () => {
    if (process.platform === "win32") return;

    const tempRoot = await mkdtemp(join(os.tmpdir(), "odb-cli-resolver-"));
    const tempRepoRoot = join(tempRoot, "repo");
    const tempSkillRoot = join(tempRoot, "installed-skill", "scripts");
    const tempBinRoot = join(tempRoot, "bin");
    const resolverPath = join(tempSkillRoot, "resolve-odb-cli.sh");
    const cliEntry = join(tempRepoRoot, "dist", "cli", "index.js");
    const nodeBinPath = join(tempBinRoot, "node");

    try {
      await mkdir(join(tempRepoRoot, "dist", "cli"), { recursive: true });
      await mkdir(tempSkillRoot, { recursive: true });
      await mkdir(tempBinRoot, { recursive: true });
      await writeFile(join(tempRepoRoot, "package.json"), JSON.stringify({ name: "opendevbrowser" }));
      await writeFile(cliEntry, "console.log('ok');\n");
      await copyFile(
        join(bundledSkillsDir, "opendevbrowser-best-practices", "scripts", "resolve-odb-cli.sh"),
        resolverPath
      );
      await writeFile(nodeBinPath, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} "$@"\n`);
      await chmod(nodeBinPath, 0o755);

      const result = spawnSync(
        "/bin/bash",
        [
          "-lc",
          [
            "source \"$1\"",
            "printf '%s\\n' \"${ODB_CLI[@]}\""
          ].join("\n"),
          "bash",
          resolverPath
        ],
        {
          cwd: tempRepoRoot,
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${tempBinRoot}:/usr/bin:/bin`
          }
        }
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      const parts = result.stdout.trim().split(/\r?\n/);
      expect(parts).toEqual(["node", await realpath(cliEntry)]);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("runs deterministic validator checks for workflow skill packs", () => {
    if (process.platform === "win32") return;

    const validatorPaths = [
      "skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh",
      "skills/opendevbrowser-continuity-ledger/scripts/validate-skill-assets.sh",
      "skills/opendevbrowser-data-extraction/scripts/validate-skill-assets.sh",
      "skills/opendevbrowser-design-agent/scripts/validate-skill-assets.sh",
      "skills/opendevbrowser-form-testing/scripts/validate-skill-assets.sh",
      "skills/opendevbrowser-login-automation/scripts/validate-skill-assets.sh",
      "skills/opendevbrowser-research/scripts/validate-skill-assets.sh",
      "skills/opendevbrowser-shopping/scripts/validate-skill-assets.sh",
      "skills/opendevbrowser-product-presentation-asset/scripts/validate-skill-assets.sh"
    ];

    for (const relativePath of validatorPaths) {
      const result = spawnSync("/bin/bash", [join(repoRoot, relativePath)], {
        cwd: repoRoot,
        encoding: "utf8",
        env: process.env
      });
      expect(result.status, `${relativePath}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(0);
    }
  }, 60000);

  it("rejects research skill validator contract drift", async () => {
    if (process.platform === "win32") return;

    const cases: ResearchValidatorMutation[] = [
      {
        relativePath: "assets/templates/context.json",
        mutate: (content) => content.replace("bundle-manifest.json", "bundle-manifest.removed"),
        expectedError: "assets/templates/context.json missing required marker: bundle-manifest.json"
      },
      {
        relativePath: "SKILL.md",
        mutate: (content) => `${content}\nauto is the recommended default\n`,
        expectedError: "Research assets contain forbidden marker in SKILL.md: auto is the recommended default"
      },
      {
        relativePath: "artifacts/research-workflows.md",
        mutate: (content) => content.replace("Keep SERPs discovery-only", "Use SERPs as final support"),
        expectedError: "artifacts/research-workflows.md missing required marker: Keep SERPs discovery-only"
      }
    ];

    for (const testCase of cases) {
      const result = await runResearchValidatorWithMutation(testCase);
      expect(result.status).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain(testCase.expectedError);
    }
  }, 60000);

  it("accepts review-only canvas audit ids in the best-practices robustness audit", async () => {
    if (process.platform === "win32") return;

    const checklistPath = join(
      bundledSkillsDir,
      "opendevbrowser-best-practices",
      "assets",
      "templates",
      "canvas-blocker-checklist.json"
    );
    const checklist = JSON.parse(await readFile(checklistPath, "utf8")) as {
      blockers?: Array<{ auditId?: string }>;
      reviewChecks?: Array<{ auditId?: string }>;
    };
    const blockerIds = (checklist.blockers ?? []).flatMap((entry) => entry.auditId ?? []);
    const reviewIds = (checklist.reviewChecks ?? []).flatMap((entry) => entry.auditId ?? []);

    expect(reviewIds).toEqual(expect.arrayContaining(["CANVAS-04", "CANVAS-06", "CANVAS-07"]));
    expect(blockerIds).not.toEqual(expect.arrayContaining(["CANVAS-04", "CANVAS-06", "CANVAS-07"]));

    const result = spawnSync(
      "/bin/bash",
      [join(repoRoot, "skills/opendevbrowser-best-practices/scripts/run-robustness-audit.sh"), "canvas-pack"],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: process.env
      }
    );

    expect(result.status, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("Robustness audit checks passed for canvas-pack.");
    expect(result.stderr).not.toContain("missing canvas audit ids in JSON templates");
  });
});
