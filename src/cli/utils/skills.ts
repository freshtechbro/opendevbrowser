import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { fileURLToPath } from "url";

const PACKAGE_NAME = "opendevbrowser";
const SKILL_DIR_NAME = "skill";
const SKILLS_DIR_NAME = "skills";

let cachedPackageRoot: string | null = null;

export type SkillTargetAgent = "opencode" | "codex" | "claudecode" | "ampcli" | "claude" | "amp";

export interface SkillTarget {
  agents: SkillTargetAgent[];
  dir: string;
}

function findPackageRoot(startDir: string): string {
  let current = startDir;

  while (true) {
    const pkgPath = path.join(current, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as { name?: string };
        if (parsed.name === PACKAGE_NAME) {
          return current;
        }
      } catch {
        void 0;
      }
    }

    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  throw new Error("Unable to locate opendevbrowser package root for skill installation.");
}

export function getPackageRoot(): string {
  if (cachedPackageRoot) return cachedPackageRoot;
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  cachedPackageRoot = findPackageRoot(moduleDir);
  return cachedPackageRoot;
}

export function getBundledSkillsDir(): string {
  const skillsDir = path.join(getPackageRoot(), "skills");
  if (!fs.existsSync(skillsDir)) {
    throw new Error(`Bundled skills directory not found at ${skillsDir}`);
  }
  return skillsDir;
}

export function getGlobalSkillDir(): string {
  const configDir = process.env.OPENCODE_CONFIG_DIR
    || path.join(os.homedir(), ".config", "opencode");
  return path.join(configDir, SKILL_DIR_NAME);
}

export function getLocalSkillDir(): string {
  return path.join(process.cwd(), ".opencode", SKILL_DIR_NAME);
}

function getCodexHomeDir(): string {
  return process.env.CODEX_HOME
    || path.join(os.homedir(), ".codex");
}

function getClaudeCodeHomeDir(): string {
  return process.env.CLAUDECODE_HOME
    || process.env.CLAUDE_HOME
    || path.join(os.homedir(), ".claude");
}

function getAmpHomeDir(): string {
  return process.env.AMPCLI_HOME
    || process.env.AMP_CLI_HOME
    || process.env.AMP_HOME
    || path.join(os.homedir(), ".amp");
}

function dedupeTargets(targets: Array<{ agent: SkillTargetAgent; dir: string }>): SkillTarget[] {
  const deduped = new Map<string, SkillTarget>();

  for (const target of targets) {
    const key = path.resolve(target.dir);
    const existing = deduped.get(key);
    if (existing) {
      if (!existing.agents.includes(target.agent)) {
        existing.agents.push(target.agent);
      }
      continue;
    }
    deduped.set(key, { agents: [target.agent], dir: target.dir });
  }

  return Array.from(deduped.values());
}

export function getGlobalSkillTargets(): SkillTarget[] {
  const claudeSkillsDir = path.join(getClaudeCodeHomeDir(), SKILLS_DIR_NAME);
  const ampSkillsDir = path.join(getAmpHomeDir(), SKILLS_DIR_NAME);

  return dedupeTargets([
    { agent: "opencode", dir: getGlobalSkillDir() },
    { agent: "codex", dir: path.join(getCodexHomeDir(), SKILLS_DIR_NAME) },
    { agent: "claudecode", dir: claudeSkillsDir },
    { agent: "claude", dir: claudeSkillsDir },
    { agent: "ampcli", dir: ampSkillsDir },
    { agent: "amp", dir: ampSkillsDir }
  ]);
}

export function getLocalSkillTargets(): SkillTarget[] {
  const localClaudeSkillsDir = path.join(process.cwd(), ".claude", SKILLS_DIR_NAME);
  const localAmpSkillsDir = path.join(process.cwd(), ".amp", SKILLS_DIR_NAME);

  return dedupeTargets([
    { agent: "opencode", dir: getLocalSkillDir() },
    { agent: "codex", dir: path.join(process.cwd(), ".codex", SKILLS_DIR_NAME) },
    { agent: "claudecode", dir: localClaudeSkillsDir },
    { agent: "claude", dir: localClaudeSkillsDir },
    { agent: "ampcli", dir: localAmpSkillsDir },
    { agent: "amp", dir: localAmpSkillsDir }
  ]);
}
