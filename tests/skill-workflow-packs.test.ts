import { access, chmod, copyFile, cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "fs/promises";
import { spawnSync } from "child_process";
import { join } from "path";
import * as os from "os";
import { describe, expect, it } from "vitest";
import { validateGenerationPlan } from "../src/canvas/document-store";
import { PRODUCT_VIDEO_BRIEF_HELPER_PATH } from "../src/providers/workflow-handoff";
import { SkillLoader } from "../src/skills/skill-loader";

const repoRoot = process.cwd();
const bundledSkillsDir = join(repoRoot, "skills");

type SkillValidatorMutation = {
  skillName: string;
  relativePath: string;
  mutate: (content: string) => string;
  expectedError: string;
  dependencies?: string[];
};

type GenerationPlanTemplate = {
  generationPlan: object;
};

type CanvasPatchTemplate = {
  canvasSessionId: string;
  leaseId: string;
  baseRevision: number;
  patches: Array<{
    op: string;
    block?: string;
    changes?: object;
    pageId?: string;
    parentId?: string;
    nodeId?: string;
    node?: {
      id?: string;
      kind?: string;
      rect?: object;
      props?: object;
      style?: object;
      metadata?: object;
    };
  }>;
};

const readJsonFile = async <Template>(filePath: string): Promise<Template> => {
  const content = await readFile(filePath, "utf8");
  return JSON.parse(content) as Template;
};

const runSkillValidatorWithMutation = async (mutation: SkillValidatorMutation) => {
  const tempRoot = await mkdtemp(join(os.tmpdir(), "odb-skill-validator-"));
  const tempSkillsDir = join(tempRoot, "skills");
  try {
    await mkdir(tempSkillsDir, { recursive: true });
    const skillCopies = new Set([mutation.skillName, ...(mutation.dependencies ?? [])]);
    for (const skillName of skillCopies) {
      await cp(join(bundledSkillsDir, skillName), join(tempSkillsDir, skillName), { recursive: true });
    }

    const target = join(tempSkillsDir, mutation.skillName, mutation.relativePath);
    await writeFile(target, mutation.mutate(await readFile(target, "utf8")));
    return spawnSync("/bin/bash", [join(tempSkillsDir, mutation.skillName, "scripts/validate-skill-assets.sh")], {
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
    "artifacts/design-agent-work-products.md",
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
    "assets/templates/canvas-patch.request.v1.json",
    "assets/templates/design-review-checklist.json",
    "assets/templates/real-surface-design-matrix.json",
    "assets/templates/reference-pattern-board.v1.json",
    "assets/templates/design-release-gate.v1.json",
    "scripts/design-workflow.sh",
    "scripts/extract-canvas-plan.sh",
    "scripts/validate-skill-assets.sh"
  ],
  "opendevbrowser-motion-design": [
    "SKILL.md",
    "artifacts/motion-terminology.md",
    "artifacts/motion-pattern-catalog.md",
    "artifacts/platform-framework-guide.md",
    "artifacts/device-breakpoint-posture.md",
    "artifacts/accessibility-reduced-motion.md",
    "artifacts/performance-frame-budget.md",
    "artifacts/open-dev-browser-motion-evidence.md",
    "artifacts/motion-release-gate.md",
    "artifacts/motion-anti-patterns.md",
    "assets/templates/motion-contract.v1.json",
    "assets/templates/motion-audit-report.v1.md",
    "assets/templates/motion-viewport-matrix.v1.json",
    "assets/templates/motion-release-gate.v1.json",
    "scripts/motion-workflow.sh",
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
      expect(names).toContain("opendevbrowser-motion-design");
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
    expect(names).toContain("opendevbrowser-motion-design");
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
      "opendevbrowser-design-agent/scripts/design-workflow.sh",
      "opendevbrowser-motion-design/scripts/motion-workflow.sh"
    ];

    for (const relativePath of routerScriptPaths) {
      const content = await readFile(join(bundledSkillsDir, relativePath), "utf8");
      expect(content).toContain("resolve-odb-cli.sh");
      expect(content).toContain("CLI_PREFIX");
    }
  });

  it("prints install-safe motion workflow paths from outside the repo root", async () => {
    if (process.platform === "win32") return;

    const tempRoot = await mkdtemp(join(os.tmpdir(), "odb-motion-installed-workflow-"));
    const tempSkillsDir = join(tempRoot, "managed-skills");
    const motionSkillRoot = join(tempSkillsDir, "opendevbrowser-motion-design");

    try {
      await mkdir(tempSkillsDir, { recursive: true });
      await cp(join(bundledSkillsDir, "opendevbrowser-motion-design"), motionSkillRoot, { recursive: true });
      await cp(
        join(bundledSkillsDir, "opendevbrowser-best-practices"),
        join(tempSkillsDir, "opendevbrowser-best-practices"),
        { recursive: true }
      );
      await cp(
        join(bundledSkillsDir, "opendevbrowser-design-agent"),
        join(tempSkillsDir, "opendevbrowser-design-agent"),
        { recursive: true }
      );

      const workflowPath = join(motionSkillRoot, "scripts", "motion-workflow.sh");
      const workflows = ["contract-first", "temporal-proof", "scroll-stage-audit", "release-gate"];

      for (const workflow of workflows) {
        const result = spawnSync("/bin/bash", [workflowPath, workflow], {
          cwd: tempRoot,
          encoding: "utf8",
          env: process.env
        });

        expect(result.status, `${workflow}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(0);
        expect(result.stdout).toContain(motionSkillRoot);
        expect(result.stdout).not.toContain("cat skills/opendevbrowser-motion-design");
        expect(result.stdout).not.toContain("./skills/opendevbrowser-motion-design");
      }

      const contractResult = spawnSync("/bin/bash", [workflowPath, "contract-first"], {
        cwd: tempRoot,
        encoding: "utf8",
        env: process.env
      });
      expect(contractResult.stdout).toContain(
        join(motionSkillRoot, "assets", "templates", "motion-contract.v1.json")
      );
      expect(contractResult.stdout).toContain(
        join(tempSkillsDir, "opendevbrowser-design-agent", "assets", "templates", "design-contract.v1.json")
      );
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
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
      "skills/opendevbrowser-motion-design/scripts/validate-skill-assets.sh",
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

  it("keeps design-agent canvas plan templates valid against the runtime validator", async () => {
    const templatePaths = [
      "assets/templates/design-contract.v1.json",
      "assets/templates/canvas-generation-plan.design.v1.json"
    ];

    for (const templatePath of templatePaths) {
      const template = await readJsonFile<GenerationPlanTemplate>(
        join(bundledSkillsDir, "opendevbrowser-design-agent", templatePath)
      );
      const validation = validateGenerationPlan(template.generationPlan);
      expect(validation, templatePath).toMatchObject({ ok: true });
    }
  });

  it("keeps the design-agent canvas patch template as a minimal supported smoke payload", async () => {
    const template = await readJsonFile<CanvasPatchTemplate>(
      join(
        bundledSkillsDir,
        "opendevbrowser-design-agent",
        "assets/templates/canvas-patch.request.v1.json"
      )
    );
    const supportedOperations = new Set([
      "page.create",
      "page.update",
      "node.insert",
      "node.update",
      "node.remove",
      "node.reparent",
      "node.reorder",
      "node.duplicate",
      "node.visibility.set",
      "variant.patch",
      "token.set",
      "tokens.merge",
      "tokens.replace",
      "governance.update",
      "asset.attach",
      "binding.set",
      "binding.remove",
      "prototype.upsert",
      "inventory.promote",
      "inventory.update",
      "inventory.upsert",
      "inventory.remove",
      "starter.apply"
    ]);
    const operationNames = template.patches.map((patch) => patch.op);

    expect(template.canvasSessionId).toBe("<canvas-session-id>");
    expect(template.leaseId).toBe("<lease-id>");
    expect(template.baseRevision).toBe(0);
    expect(operationNames).toEqual(["governance.update", "page.update", "node.insert", "node.update"]);
    expect(operationNames.every((operation) => supportedOperations.has(operation))).toBe(true);
    expect(operationNames).not.toEqual(expect.arrayContaining(["prototype.upsert", "inventory.promote", "starter.apply"]));
    expect(template.patches.length).toBeLessThanOrEqual(4);
    expect(template.patches[0]).toMatchObject({ block: "intent", changes: expect.any(Object) });
    expect(template.patches[1]).toMatchObject({ pageId: "<page-id>", changes: expect.any(Object) });
    expect(template.patches[2]).toMatchObject({
      pageId: "<page-id>",
      parentId: "<root-node-id>",
      node: {
        id: "node_design_smoke_hero",
        kind: "frame",
        rect: expect.any(Object),
        props: expect.any(Object),
        style: expect.any(Object),
        metadata: expect.any(Object)
      }
    });
    expect(template.patches[3]).toMatchObject({
      nodeId: "node_design_smoke_hero",
      changes: expect.any(Object)
    });
  });

  it("rejects research skill validator contract drift", async () => {
    if (process.platform === "win32") return;

    const cases: SkillValidatorMutation[] = [
      {
        skillName: "opendevbrowser-research",
        relativePath: "assets/templates/context.json",
        mutate: (content) => content.replace("bundle-manifest.json", "bundle-manifest.removed"),
        expectedError: "assets/templates/context.json missing required marker: bundle-manifest.json",
        dependencies: ["opendevbrowser-best-practices"]
      },
      {
        skillName: "opendevbrowser-research",
        relativePath: "SKILL.md",
        mutate: (content) => `${content}\nauto is the recommended default\n`,
        expectedError: "Research assets contain forbidden marker in SKILL.md: auto is the recommended default",
        dependencies: ["opendevbrowser-best-practices"]
      },
      {
        skillName: "opendevbrowser-research",
        relativePath: "artifacts/research-workflows.md",
        mutate: (content) => content.replace("Keep SERPs discovery-only", "Use SERPs as final support"),
        expectedError: "artifacts/research-workflows.md missing required marker: Keep SERPs discovery-only",
        dependencies: ["opendevbrowser-best-practices"]
      }
    ];

    for (const testCase of cases) {
      const result = await runSkillValidatorWithMutation(testCase);
      expect(result.status).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain(testCase.expectedError);
    }
  }, 60000);

  it("rejects representative stale workflow validator mutations", async () => {
    if (process.platform === "win32") return;

    const cases: SkillValidatorMutation[] = [
      {
        skillName: "opendevbrowser-research",
        relativePath: "scripts/validate-skill-assets.sh",
        mutate: (content) => content.replace(
          'context "web,community"',
          'context "web,docs"'
        ),
        expectedError: "Invalid --sources value: docs",
        dependencies: ["opendevbrowser-best-practices"]
      },
      {
        skillName: "opendevbrowser-research",
        relativePath: "SKILL.md",
        mutate: (content) => content.replace(
          "Run research workflow browser-mode sweeps with `auto`, `extension`, and `managed` where browser-backed evidence capture is used.",
          "Run research workflow parity sweeps with `auto`, `extension`, and `cdpConnect` where browser-backed evidence capture is used."
        ),
        expectedError: "Research skill must not present cdpConnect in workflow browser-mode guidance.",
        dependencies: ["opendevbrowser-best-practices"]
      },
      {
        skillName: "opendevbrowser-research",
        relativePath: "SKILL.md",
        mutate: (content) => `${content}\n## Stale Workflow Example\nRun with \`--browser-mode cdpConnect\` before release.\n`,
        expectedError: "Research skill must not present cdpConnect in workflow browser-mode guidance.",
        dependencies: ["opendevbrowser-best-practices"]
      },
      {
        skillName: "opendevbrowser-login-automation",
        relativePath: "scripts/run-login-workflow.sh",
        mutate: (content) => content
          .replace("fromX=<start-x>", "startX=<start-x>")
          .replace("fromY=<start-y>", "startY=<start-y>")
          .replace("toX=<end-x>", "endX=<end-x>")
          .replace("toY=<end-y>", "endY=<end-y>"),
        expectedError: "pointer-checkpoint workflow contains stale marker: startX="
      },
      {
        skillName: "opendevbrowser-motion-design",
        relativePath: "scripts/motion-workflow.sh",
        mutate: (content) => content.replace(
          "pointer-drag --session-id <session-id> --from-x <x> --from-y <y> --to-x <x2> --to-y <y2>",
          "pointer-drag --session-id <session-id> --to-x <x2> --to-y <y2>"
        ),
        expectedError: "gesture-motion pointer-drag missing coordinate marker: --from-x <x>",
        dependencies: ["opendevbrowser-best-practices", "opendevbrowser-design-agent"]
      },
      {
        skillName: "opendevbrowser-form-testing",
        relativePath: "scripts/run-form-workflow.sh",
        mutate: (content) => content
          .replace(
            'opendevbrowser_upload sessionId="<session-id>" ref="<file-input-ref>" files=["<absolute-file-path>"]',
            'opendevbrowser_click sessionId="<session-id>" ref="<file-input-ref>"'
          )
          .replace(
            "# CLI equivalent: opendevbrowser upload --session-id <session-id> --ref <file-input-ref> --files <absolute-file-path>",
            "# Click the file input and select a file manually."
          ),
        expectedError: "file-upload workflow missing marker: opendevbrowser_upload"
      },
      {
        skillName: "opendevbrowser-product-presentation-asset",
        relativePath: "scripts/write-manifest.sh",
        mutate: (content) => content.replace(
          [
            '  "$manifest_out"',
            '  "$bundle_path/presentation-readiness.json"',
            '  "$bundle_path/product.json"',
            '  "$bundle_path/copy.md"',
            '  "$bundle_path/features.md"'
          ].join("\n"),
          '  "$manifest_out"'
        ),
        expectedError: "write-manifest.sh succeeded with missing adjacent sidecars.",
        dependencies: ["opendevbrowser-best-practices"]
      }
    ];

    for (const testCase of cases) {
      const result = await runSkillValidatorWithMutation(testCase);
      expect(result.status, `${testCase.skillName}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain(testCase.expectedError);
    }
  }, 60000);

  const designAgentCanvasValidatorMutationCases: SkillValidatorMutation[] = [
      {
        skillName: "opendevbrowser-design-agent",
        relativePath: "assets/templates/design-contract.v1.json",
        mutate: (content) => content.replace(
          '"themeStrategy": "light-dark-parity"',
          '"themeStrategyRemoved": "light-dark-parity"'
        ),
        expectedError: "assets/templates/design-contract.v1.json generationPlan missing visualDirection.themeStrategy",
        dependencies: ["opendevbrowser-best-practices"]
      },
      {
        skillName: "opendevbrowser-design-agent",
        relativePath: "assets/templates/canvas-generation-plan.design.v1.json",
        mutate: (content) => content.replace(
          '"maxInteractionLatencyMs": 160',
          '"maxInteractionLatencyMsRemoved": 160'
        ),
        expectedError: "assets/templates/canvas-generation-plan.design.v1.json generationPlan missing validationTargets.maxInteractionLatencyMs",
        dependencies: ["opendevbrowser-best-practices"]
      },
      {
        skillName: "opendevbrowser-design-agent",
        relativePath: "assets/templates/canvas-generation-plan.design.v1.json",
        mutate: (content) => content.replace(
          '"profile": "product-story"',
          '"profile": "invalid-profile"'
        ),
        expectedError: "Invalid generationPlan.visualDirection.profile: expected one of",
        dependencies: ["opendevbrowser-best-practices"]
      },
      {
        skillName: "opendevbrowser-design-agent",
        relativePath: "assets/templates/design-contract.v1.json",
        mutate: (content) => content.replace(
          '"targetOutcome": {',
          '"interactionMoments": [42],\n    "targetOutcome": {'
        ),
        expectedError: "Invalid generationPlan.interactionMoments: expected only non-empty strings",
        dependencies: ["opendevbrowser-best-practices"]
      },
      {
        skillName: "opendevbrowser-design-agent",
        relativePath: "scripts/design-workflow.sh",
        mutate: (content) => content.replace(
          "mkdir -p .tmp",
          "printf '%s\\n' preparing-scratch"
        ),
        expectedError: "design-workflow.sh output for canvas-contract missing marker: mkdir -p .tmp",
        dependencies: ["opendevbrowser-best-practices"]
      },
      {
        skillName: "opendevbrowser-design-agent",
        relativePath: "artifacts/research-harvest-workflow.md",
        mutate: (content) => content.split("evidenceAuthority=pin_media_ready").join("non-diagnostic evidenceAuthority"),
        expectedError: "research-harvest-workflow missing marker: evidenceAuthority=pin_media_ready",
        dependencies: ["opendevbrowser-best-practices"]
      },
      {
        skillName: "opendevbrowser-design-agent",
        relativePath: "SKILL.md",
        mutate: (content) => content.replace(
          ".tmp/canvas-plan.request.json",
          "./tmp/canvas-plan.json"
        ),
        expectedError: "Stale scratch guidance marker ./tmp/ in SKILL.md",
        dependencies: ["opendevbrowser-best-practices"]
      },
      {
        skillName: "opendevbrowser-design-agent",
        relativePath: "scripts/design-workflow.sh",
        mutate: (content) => content.replace(
          'DESIGN_RUN_DIR=".opendevbrowser/design-agent/\\$RUN_ID"',
          'DESIGN_RUN_DIR=".opendevbrowser/design-agent-run/\\$RUN_ID"'
        ),
        expectedError: "design-workflow.sh output for canvas-contract missing marker: .opendevbrowser/design-agent/",
        dependencies: ["opendevbrowser-best-practices"]
      },
      {
        skillName: "opendevbrowser-design-agent",
        relativePath: "artifacts/design-workflows.md",
        mutate: (content) => content.replace(
          /\.opendevbrowser\/canvas\/\.\.\./g,
          ".opendevbrowser/design-agent/<run-id>/..."
        ),
        expectedError: "artifacts/design-workflows.md storage policy missing marker: .opendevbrowser/canvas/...",
        dependencies: ["opendevbrowser-best-practices"]
      },
      {
        skillName: "opendevbrowser-design-agent",
        relativePath: "assets/templates/canvas-patch.request.v1.json",
        mutate: (content) => content.replace(
          '"op": "node.insert"',
          '"op": "node.add"'
        ),
        expectedError: "assets/templates/canvas-patch.request.v1.json uses unsupported patch operation: node.add",
        dependencies: ["opendevbrowser-best-practices"]
      },
      {
        skillName: "opendevbrowser-design-agent",
        relativePath: "assets/templates/canvas-patch.request.v1.json",
        mutate: (content) => content.replace(
          '  "baseRevision": 0,\n',
          ""
        ),
        expectedError: "assets/templates/canvas-patch.request.v1.json missing required key: baseRevision",
        dependencies: ["opendevbrowser-best-practices"]
      },
      {
        skillName: "opendevbrowser-design-agent",
        relativePath: "assets/templates/canvas-patch.request.v1.json",
        mutate: (content) => content.replace(
          '        "id": "node_design_smoke_hero",\n',
          ""
        ),
        expectedError: "assets/templates/canvas-patch.request.v1.json node.insert at index 2 missing node.id",
        dependencies: ["opendevbrowser-best-practices"]
      },
      {
        skillName: "opendevbrowser-design-agent",
        relativePath: "assets/templates/canvas-patch.request.v1.json",
        mutate: (content) => content.replace(
          "\n  ]",
          ',\n    { "op": "prototype.upsert" }\n  ]'
        ),
        expectedError: "assets/templates/canvas-patch.request.v1.json should stay a minimal smoke payload with exactly these operations: governance.update, page.update, node.insert, node.update",
        dependencies: ["opendevbrowser-best-practices"]
      },
      {
        skillName: "opendevbrowser-design-agent",
        relativePath: "scripts/extract-canvas-plan.sh",
        mutate: (content) => content.replace(
          'requestId: payload.requestId ?? "req_plan_from_contract",',
          'requestId: "req_plan_from_contract",'
        ),
        expectedError: "extract-canvas-plan output for assets/templates/canvas-generation-plan.design.v1.json did not preserve wrapper key: requestId",
        dependencies: ["opendevbrowser-best-practices"]
      },
      {
        skillName: "opendevbrowser-design-agent",
        relativePath: "scripts/design-workflow.sh",
        mutate: (content) => content.replace(
          "cp skills/opendevbrowser-design-agent/assets/templates/canvas-patch.request.v1.json .tmp/canvas-patch.request.json",
          "printf '%s\\n' prepare-canvas-patch"
        ),
        expectedError: "design-workflow.sh output for canvas-contract missing marker: cp skills/opendevbrowser-design-agent/assets/templates/canvas-patch.request.v1.json .tmp/canvas-patch.request.json",
        dependencies: ["opendevbrowser-best-practices"]
      },
      {
        skillName: "opendevbrowser-design-agent",
        relativePath: "scripts/design-workflow.sh",
        mutate: (content) => content.replace(
          '"itemId":"<inventory-item-id>"',
          '"inventoryItemId":"<inventory-item-id>"'
        ),
        expectedError: "Stale inventory insert param inventoryItemId in scripts/design-workflow.sh",
        dependencies: ["opendevbrowser-best-practices"]
      },
      {
        skillName: "opendevbrowser-design-agent",
        relativePath: "scripts/design-workflow.sh",
        mutate: (content) => content.replace(
          ',"prototypeId":"<prototype-id>"',
          ',"projection": "canvas_html"'
        ),
        expectedError: "Stale canvas.preview.render projection param in scripts/design-workflow.sh",
        dependencies: ["opendevbrowser-best-practices"]
      },
      {
        skillName: "opendevbrowser-design-agent",
        relativePath: "artifacts/isolated-preview-validation.md",
        mutate: (content) => content.replace(
          '"prototypeId":"<prototype-id>"',
          '"projection": "canvas_html"'
        ),
        expectedError: "Stale canvas.preview.render projection param in artifacts/isolated-preview-validation.md",
        dependencies: ["opendevbrowser-best-practices"]
      },
      {
        skillName: "opendevbrowser-design-agent",
        relativePath: "scripts/design-workflow.sh",
        mutate: (content) => content
          .replace(/canvas\.starter\.list/g, "canvas.starter.lookup")
          .replace(/canvas\.inventory\.list/g, "canvas.inventory.lookup"),
        expectedError: "design-workflow.sh output for canvas-contract missing marker: canvas.starter.list",
        dependencies: ["opendevbrowser-best-practices"]
      }
  ];

  for (const testCase of designAgentCanvasValidatorMutationCases) {
    it(`rejects design-agent canvas validator mutation: ${testCase.expectedError}`, async () => {
      if (process.platform === "win32") return;

      const result = await runSkillValidatorWithMutation(testCase);
      expect(result.status, `${testCase.skillName}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain(testCase.expectedError);
    }, 60000);
  }

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
