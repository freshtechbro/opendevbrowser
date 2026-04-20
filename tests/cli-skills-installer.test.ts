import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { mkdtemp, rm } from "fs/promises";
import {
  hasBundledSkillArtifacts,
  hasManagedBundledSkillInstall,
  removeBundledSkills,
  syncBundledSkills
} from "../src/cli/installers/skills";
import {
  getBundledSkillsDir,
  getGlobalSkillTargets,
  getLocalSkillTargets
} from "../src/cli/utils/skills";
import { findInstalledConfigs } from "../src/cli/commands/uninstall";
import { bundledSkillDirectories } from "../src/skills/bundled-skill-directories";

let tempRoot = "";
let workspaceDir = "";
let originalCwd = "";
let originalHome: string | undefined;
let originalConfigDir: string | undefined;
let originalCodexHome: string | undefined;
let originalClaudeCodeHome: string | undefined;
let originalAmpCliHome: string | undefined;

function expectNoLegacyAliasFields(value: object): void {
  expect("removedLegacyAliases" in value).toBe(false);
  expect("preservedLegacyAliases" in value).toBe(false);
}

function copyCanonicalSkillToAlias(targetDir: string, canonicalName: string, aliasName: string): void {
  const sourceDir = path.join(targetDir, canonicalName);
  const aliasDir = path.join(targetDir, aliasName);
  fs.cpSync(sourceDir, aliasDir, { recursive: true });
}

const legacyAliasFixtures = {
  research: {
    "SKILL.md": `---
name: research
description: Deterministic multi-source research workflow with strict timebox and artifact outputs.
version: 1.0.0
---

# Research Skill

Use this skill when you need benchmark-style research across \`web|community|social|shopping\` with strict timebox semantics and stable output modes.

## Triggers
- "research this topic"
- "last 30 days"
- "cross-source summary"
- "output as context/json/markdown"

## Workflow
1. Resolve timebox (\`days\` or \`from/to\`).
2. Choose sources (\`auto|web|community|social|shopping|all\`).
3. Run \`opendevbrowser research run\`.
4. Return requested mode output and artifact path.

## Commands
\`\`\`bash
opendevbrowser research run --topic "<topic>" --days 30 --mode context
\`\`\`

## Notes
- \`auto\` resolves to \`web|community|social\` in v1.
- Use \`--source-selection all\` or \`--sources shopping,...\` to include shopping.
`,
    "assets/templates/compact.md": "# Compact Research Template\n\n- Top findings:\n- Source diversity:\n- Key risks:\n",
    "assets/templates/context.json": "{\n  \"topic\": \"\",\n  \"highlights\": [],\n  \"records\": [],\n  \"meta\": {}\n}\n",
    "assets/templates/report.md": "# Research Report\n\n## Executive Summary\n\n## Findings\n\n## Sources\n",
    "examples/sample-input.json": "{\n  \"topic\": \"ai browser automation\",\n  \"days\": 30,\n  \"sourceSelection\": \"auto\",\n  \"mode\": \"context\"\n}\n",
    "examples/sample-output.md": "# Sample Output\n\n1. Example finding one\n2. Example finding two\n",
    "scripts/render-output.sh": "#!/usr/bin/env bash\nset -euo pipefail\n\nif [[ $# -lt 2 ]]; then\n  echo \"Usage: render-output.sh <topic> <mode>\"\n  exit 1\nfi\n\nTOPIC=\"$1\"\nMODE=\"$2\"\n\nopendevbrowser research run --topic \"$TOPIC\" --mode \"$MODE\"\n",
    "scripts/run-research.sh": "#!/usr/bin/env bash\nset -euo pipefail\n\nif [[ $# -lt 1 ]]; then\n  echo \"Usage: run-research.sh <topic> [days] [mode]\"\n  exit 1\nfi\n\nTOPIC=\"$1\"\nDAYS=\"${2:-30}\"\nMODE=\"${3:-context}\"\n\nopendevbrowser research run \\\n  --topic \"$TOPIC\" \\\n  --days \"$DAYS\" \\\n  --mode \"$MODE\"\n",
    "scripts/write-artifacts.sh": "#!/usr/bin/env bash\nset -euo pipefail\n\nif [[ $# -lt 2 ]]; then\n  echo \"Usage: write-artifacts.sh <topic> <output-dir>\"\n  exit 1\nfi\n\nTOPIC=\"$1\"\nOUTDIR=\"$2\"\n\nopendevbrowser research run --topic \"$TOPIC\" --mode path --output-dir \"$OUTDIR\"\n"
  },
  shopping: {
    "SKILL.md": `---
name: shopping
description: Deterministic multi-provider shopping and deal-comparison workflow.
version: 1.0.0
---

# Shopping Skill

Use this skill for deal discovery and price comparison across shopping providers.

## Triggers
- "find best deal"
- "compare prices"
- "shopping intelligence"
- "price matrix"

## Workflow
1. Resolve provider set (\`10 + others\` by default).
2. Run shopping workflow.
3. Sort by requested strategy.
4. Return compact/json/md/context/path output.

## Commands
\`\`\`bash
opendevbrowser shopping run --query "<query>" --sort best_deal --mode context
\`\`\`
`,
    "assets/templates/deals-context.json": "{\n  \"query\": \"\",\n  \"highlights\": [],\n  \"offers\": [],\n  \"meta\": {}\n}\n",
    "assets/templates/deals-table.md": "# Deals Table\n\n| Provider | Product | Total | Deal Score |\n|---|---|---:|---:|\n",
    "examples/sample-deals.md": "# Sample Deals\n\n1. Provider A - $49.99\n2. Provider B - $52.00\n",
    "examples/sample-query.json": "{\n  \"query\": \"wireless earbuds\",\n  \"sort\": \"best_deal\",\n  \"mode\": \"context\"\n}\n",
    "scripts/normalize-offers.sh": "#!/usr/bin/env bash\nset -euo pipefail\n\nif [[ $# -lt 1 ]]; then\n  echo \"Usage: normalize-offers.sh <query>\"\n  exit 1\nfi\n\nQUERY=\"$1\"\nopendevbrowser shopping run --query \"$QUERY\" --mode json\n",
    "scripts/render-deals.sh": "#!/usr/bin/env bash\nset -euo pipefail\n\nif [[ $# -lt 2 ]]; then\n  echo \"Usage: render-deals.sh <query> <mode>\"\n  exit 1\nfi\n\nQUERY=\"$1\"\nMODE=\"$2\"\nopendevbrowser shopping run --query \"$QUERY\" --mode \"$MODE\"\n",
    "scripts/run-shopping.sh": "#!/usr/bin/env bash\nset -euo pipefail\n\nif [[ $# -lt 1 ]]; then\n  echo \"Usage: run-shopping.sh <query> [mode] [sort]\"\n  exit 1\nfi\n\nQUERY=\"$1\"\nMODE=\"${2:-context}\"\nSORT=\"${3:-best_deal}\"\n\nopendevbrowser shopping run \\\n  --query \"$QUERY\" \\\n  --mode \"$MODE\" \\\n  --sort \"$SORT\"\n"
  }
} as const;

function writeLegacyAliasFixture(targetDir: string, aliasName: keyof typeof legacyAliasFixtures): void {
  const aliasDir = path.join(targetDir, aliasName);
  const files = legacyAliasFixtures[aliasName];

  for (const [relativePath, content] of Object.entries(files)) {
    const outputPath = path.join(aliasDir, relativePath);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, content, "utf8");
  }
}

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "odb-cli-skills-"));
  workspaceDir = path.join(tempRoot, "workspace");
  fs.mkdirSync(workspaceDir, { recursive: true });

  originalCwd = process.cwd();
  process.chdir(workspaceDir);

  originalHome = process.env.HOME;
  originalConfigDir = process.env.OPENCODE_CONFIG_DIR;
  originalCodexHome = process.env.CODEX_HOME;
  originalClaudeCodeHome = process.env.CLAUDECODE_HOME;
  originalAmpCliHome = process.env.AMP_CLI_HOME;

  process.env.HOME = path.join(tempRoot, "home");
  process.env.OPENCODE_CONFIG_DIR = path.join(tempRoot, "opencode-config");
  process.env.CODEX_HOME = path.join(tempRoot, "codex-home");
  process.env.CLAUDECODE_HOME = path.join(tempRoot, "claudecode-home");
  process.env.AMP_CLI_HOME = path.join(tempRoot, "ampcli-home");
});

afterEach(async () => {
  process.chdir(originalCwd);

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

  await rm(tempRoot, { recursive: true, force: true });
});

describe("bundled skill lifecycle sync", () => {
  const bundledSkillNames = bundledSkillDirectories.map((entry) => entry.name);

  it("installs canonical bundled skills across all global agent targets", () => {
    const result = syncBundledSkills("global");

    expect(result.success).toBe(true);
    expect(result.targets.length).toBe(getGlobalSkillTargets().length);
    expect(result.installed.length).toBe(getGlobalSkillTargets().length * bundledSkillNames.length);
    expect(result.refreshed).toEqual([]);
    expect(result.unchanged).toEqual([]);
    expectNoLegacyAliasFields(result);
    result.targets.forEach(expectNoLegacyAliasFields);
    expect(result.message).toContain("installed");
    expect(result.message).not.toContain("legacy aliases preserved");

    for (const target of getGlobalSkillTargets()) {
      const bestPracticesPath = path.join(target.dir, "opendevbrowser-best-practices", "SKILL.md");
      expect(fs.existsSync(bestPracticesPath)).toBe(true);
      expect(fs.existsSync(path.join(target.dir, "research"))).toBe(false);
      expect(fs.existsSync(path.join(target.dir, "shopping"))).toBe(false);
    }
  }, 60_000);

  it("installs canonical bundled skills across all local agent targets", () => {
    const result = syncBundledSkills("local");

    expect(result.success).toBe(true);
    expect(result.targets.length).toBe(getLocalSkillTargets().length);
    expect(result.installed.length).toBe(getLocalSkillTargets().length * bundledSkillNames.length);

    for (const target of getLocalSkillTargets()) {
      const bestPracticesPath = path.join(target.dir, "opendevbrowser-best-practices", "SKILL.md");
      expect(fs.existsSync(bestPracticesPath)).toBe(true);
    }
  }, 60_000);

  it("marks reruns unchanged when the managed copies already match the bundled packs", () => {
    const firstRun = syncBundledSkills("global");
    expect(firstRun.success).toBe(true);

    const secondRun = syncBundledSkills("global");
    expect(secondRun.success).toBe(true);
    expect(secondRun.installed).toEqual([]);
    expect(secondRun.refreshed).toEqual([]);
    expect(secondRun.unchanged.length).toBe(getGlobalSkillTargets().length * bundledSkillNames.length);
  }, 60_000);

  it("refreshes a drifted managed canonical pack and restores the bundled quick start", () => {
    const firstRun = syncBundledSkills("global");
    expect(firstRun.success).toBe(true);

    const bundledSkillPath = path.join(getBundledSkillsDir(), "opendevbrowser-best-practices", "SKILL.md");
    const bundledContent = fs.readFileSync(bundledSkillPath, "utf8");
    const targetDir = getGlobalSkillTargets()[0]?.dir;
    if (!targetDir) {
      throw new Error("Missing global target for refresh test.");
    }

    const targetSkillPath = path.join(targetDir, "opendevbrowser-best-practices", "SKILL.md");
    fs.writeFileSync(targetSkillPath, bundledContent.replace("## Quick Start", "## Drifted Start"), "utf8");

    const secondRun = syncBundledSkills("global");
    expect(secondRun.success).toBe(true);
    expect(secondRun.installed).toEqual([]);
    expect(secondRun.refreshed).toEqual(["opendevbrowser-best-practices"]);
    expect(fs.readFileSync(targetSkillPath, "utf8")).toBe(bundledContent);
  }, 60_000);

  it("retires repo-owned historical legacy alias directories during sync", () => {
    const firstRun = syncBundledSkills("global");
    expect(firstRun.success).toBe(true);

    const targetDir = getGlobalSkillTargets()[0]?.dir;
    if (!targetDir) {
      throw new Error("Missing global target for legacy alias sync test.");
    }

    writeLegacyAliasFixture(targetDir, "research");
    writeLegacyAliasFixture(targetDir, "shopping");

    const secondRun = syncBundledSkills("global");
    expect(secondRun.success).toBe(true);
    expectNoLegacyAliasFields(secondRun);
    secondRun.targets.forEach(expectNoLegacyAliasFields);
    expect(fs.existsSync(path.join(targetDir, "research"))).toBe(false);
    expect(fs.existsSync(path.join(targetDir, "shopping"))).toBe(false);
  }, 60_000);

  it("preserves user-modified same-name alias directories during sync", () => {
    const firstRun = syncBundledSkills("global");
    expect(firstRun.success).toBe(true);

    const targetDir = getGlobalSkillTargets()[0]?.dir;
    if (!targetDir) {
      throw new Error("Missing global target for alias preservation test.");
    }

    copyCanonicalSkillToAlias(targetDir, "opendevbrowser-research", "research");
    copyCanonicalSkillToAlias(targetDir, "opendevbrowser-shopping", "shopping");
    fs.appendFileSync(path.join(targetDir, "research", "SKILL.md"), "\n## Custom Note\n", "utf8");
    fs.writeFileSync(path.join(targetDir, "shopping", "notes.txt"), "custom", "utf8");

    const secondRun = syncBundledSkills("global");
    expect(secondRun.success).toBe(true);
    expect(fs.existsSync(path.join(targetDir, "research"))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, "shopping"))).toBe(true);
  }, 60_000);

  it("keeps sync successful when one alias cleanup attempt fails", () => {
    const firstRun = syncBundledSkills("global");
    expect(firstRun.success).toBe(true);

    const targetDir = getGlobalSkillTargets()[0]?.dir;
    if (!targetDir) {
      throw new Error("Missing global target for alias cleanup failure test.");
    }

    copyCanonicalSkillToAlias(targetDir, "opendevbrowser-research", "research");
    copyCanonicalSkillToAlias(targetDir, "opendevbrowser-shopping", "shopping");

    const researchAliasPath = path.join(targetDir, "research");
    fs.chmodSync(researchAliasPath, 0o000);

    try {
      const secondRun = syncBundledSkills("global");
      expect(secondRun.success).toBe(true);
      expect(fs.existsSync(path.join(targetDir, "research"))).toBe(true);
      expect(fs.existsSync(path.join(targetDir, "shopping"))).toBe(false);
    } finally {
      fs.chmodSync(researchAliasPath, 0o755);
    }
  }, 60_000);

  it("does not treat legacy alias leftovers as canonical bundled artifacts", () => {
    const targetDir = getGlobalSkillTargets()[0]?.dir;
    if (!targetDir) {
      throw new Error("Missing global target for legacy alias artifact test.");
    }

    fs.mkdirSync(path.join(targetDir, "research"), { recursive: true });
    fs.mkdirSync(path.join(targetDir, "shopping"), { recursive: true });

    expect(hasBundledSkillArtifacts("global")).toBe(false);
  });

  it("treats managed skill markers as installed for uninstall discovery", () => {
    expect(findInstalledConfigs()).toEqual({ global: false, local: false });

    const targetDir = getGlobalSkillTargets()[0]?.dir;
    if (!targetDir) {
      throw new Error("Missing global target for uninstall discovery test.");
    }

    fs.mkdirSync(path.join(targetDir, "opendevbrowser-research"), { recursive: true });
    expect(findInstalledConfigs()).toEqual({ global: false, local: false });

    const result = syncBundledSkills("global");
    expect(result.success).toBe(true);

    expect(hasManagedBundledSkillInstall("global")).toBe(true);
    expect(findInstalledConfigs()).toEqual({ global: true, local: false });
  }, 60_000);

  it("publishes canonical shared targets for ClaudeCode and AmpCLI homes", () => {
    const globalTargets = getGlobalSkillTargets();
    const claudeDir = path.join(process.env.CLAUDECODE_HOME!, "skills");
    const ampDir = path.join(process.env.AMP_CLI_HOME!, "skills");

    const claudeTarget = globalTargets.find((target) => path.resolve(target.dir) === path.resolve(claudeDir));
    expect(claudeTarget).toBeDefined();
    expect(claudeTarget?.agents).toEqual(["claudecode"]);

    const ampTarget = globalTargets.find((target) => path.resolve(target.dir) === path.resolve(ampDir));
    expect(ampTarget).toBeDefined();
    expect(ampTarget?.agents).toEqual(["ampcli"]);
  });

  it("removes managed canonical packs and retires legacy alias leftovers during uninstall cleanup", () => {
    const firstRun = syncBundledSkills("global");
    expect(firstRun.success).toBe(true);
    expect(hasBundledSkillArtifacts("global")).toBe(true);

    const targetDir = getGlobalSkillTargets()[0]?.dir;
    if (!targetDir) {
      throw new Error("Missing global target for uninstall cleanup test.");
    }

    copyCanonicalSkillToAlias(targetDir, "opendevbrowser-research", "research");
    copyCanonicalSkillToAlias(targetDir, "opendevbrowser-shopping", "shopping");

    const result = removeBundledSkills("global");
    expect(result.success).toBe(true);
    expect(result.removed.length).toBe(getGlobalSkillTargets().length * bundledSkillNames.length);
    expectNoLegacyAliasFields(result);
    result.targets.forEach(expectNoLegacyAliasFields);
    expect(fs.existsSync(path.join(targetDir, "research"))).toBe(false);
    expect(fs.existsSync(path.join(targetDir, "shopping"))).toBe(false);
    expect(hasManagedBundledSkillInstall("global")).toBe(false);
    expect(hasBundledSkillArtifacts("global")).toBe(false);
  }, 60_000);

  it("keeps the other managed scope intact during scoped lifecycle cleanup", () => {
    const globalResult = syncBundledSkills("global");
    expect(globalResult.success).toBe(true);

    const localResult = syncBundledSkills("local");
    expect(localResult.success).toBe(true);

    const localRemoval = removeBundledSkills("local");
    expect(localRemoval.success).toBe(true);

    expect(hasManagedBundledSkillInstall("global")).toBe(true);
    expect(hasBundledSkillArtifacts("global")).toBe(true);
    expect(hasManagedBundledSkillInstall("local")).toBe(false);
    expect(hasBundledSkillArtifacts("local")).toBe(false);

    const globalTarget = getGlobalSkillTargets()[0]?.dir;
    const localTarget = getLocalSkillTargets()[0]?.dir;
    if (!globalTarget || !localTarget) {
      throw new Error("Missing managed targets for scoped lifecycle test.");
    }

    expect(fs.existsSync(path.join(globalTarget, "opendevbrowser-design-agent", "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(localTarget, "opendevbrowser-design-agent", "SKILL.md"))).toBe(false);
  }, 60_000);
});
