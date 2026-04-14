import { readFile, readdir } from "fs/promises";
import { join } from "path";
import * as os from "os";
import type {
  SkillAlternative,
  SkillDiscoveryIssue,
  SkillDiscoveryReport,
  SkillInfo,
  SkillMetadata,
  SkillSearchPath
} from "./types";
import { findBundledSkillsDir } from "../utils/package-assets";
import { isBundledSkillName } from "./bundled-skill-directories";

export class SkillLoader {
  private rootDir: string;
  private additionalPaths: string[];
  private bundledSkillsDir: string | null;
  private discoveryReportCache: SkillDiscoveryReport | null = null;
  private skillCache: SkillInfo[] | null = null;

  constructor(rootDir: string, additionalPaths: string[] = []) {
    this.rootDir = rootDir;
    this.additionalPaths = additionalPaths.map((p) => this.expandPath(p));
    this.bundledSkillsDir = findBundledSkillsDir();
  }

  private expandPath(p: string): string {
    if (p.startsWith("~")) {
      return join(os.homedir(), p.slice(1));
    }
    return p;
  }

  private getCodexHome(): string {
    return process.env.CODEX_HOME || join(os.homedir(), ".codex");
  }

  private getClaudeCodeHome(): string {
    return process.env.CLAUDECODE_HOME || join(os.homedir(), ".claude");
  }

  private getAmpHome(): string {
    return process.env.AMP_CLI_HOME || join(os.homedir(), ".amp");
  }

  async loadBestPractices(topic?: string): Promise<string> {
    return this.loadSkill("opendevbrowser-best-practices", topic);
  }

  async loadSkill(name: string, topic?: string): Promise<string> {
    const skills = await this.listSkills();
    const skill = skills.find((s) => s.name === name);

    if (!skill) {
      const available = skills.map((s) => s.name).join(", ") || "none";
      throw new Error(`Skill "${name}" not found. Available: ${available}`);
    }

    const content = await readFile(skill.path, "utf8");
    const trimmed = content.trim();

    if (!topic || !topic.trim()) {
      return trimmed;
    }

    const filtered = filterSections(trimmed, topic);
    return filtered || trimmed;
  }

  async listSkills(): Promise<SkillInfo[]> {
    if (this.skillCache) {
      return this.skillCache;
    }

    const report = await this.getDiscoveryReport();
    this.skillCache = report.skills;
    return report.skills;
  }

  async getDiscoveryReport(): Promise<SkillDiscoveryReport> {
    if (this.discoveryReportCache) {
      return this.discoveryReportCache;
    }

    const skills: SkillInfo[] = [];
    const issues: SkillDiscoveryIssue[] = [];
    const byName = new Map<string, SkillInfo>();
    const searchPaths = this.getSearchPaths();

    for (const searchPath of searchPaths) {
      const discovered = await this.discoverSkillsInPath(searchPath);
      issues.push(...discovered.issues);
      for (const skill of discovered.skills) {
        const alternative = this.toAlternative(skill);
        const existing = byName.get(skill.name);
        if (!existing) {
          const winner: SkillInfo = {
            ...skill,
            shadowedAlternatives: []
          };
          byName.set(skill.name, winner);
          skills.push(winner);
          continue;
        }
        existing.shadowedAlternatives?.push(alternative);
      }
    }

    this.discoveryReportCache = {
      skills,
      issues,
      searchOrder: searchPaths
    };
    this.skillCache = skills;
    return this.discoveryReportCache;
  }

  private getSearchPaths(): SkillSearchPath[] {
    const configDir = process.env.OPENCODE_CONFIG_DIR
      || join(os.homedir(), ".config", "opencode");

    const searchPaths: SkillSearchPath[] = [
      {
        path: join(this.rootDir, ".opencode", "skill"),
        sourceFamily: "project-opencode",
        isBundled: false
      },
      {
        path: join(configDir, "skill"),
        sourceFamily: "global-opencode",
        isBundled: false
      },
      {
        path: join(this.rootDir, ".codex", "skills"),
        sourceFamily: "project-codex",
        isBundled: false
      },
      {
        path: join(this.getCodexHome(), "skills"),
        sourceFamily: "global-codex",
        isBundled: false
      },
      {
        path: join(this.rootDir, ".claude", "skills"),
        sourceFamily: "project-claudecode",
        isBundled: false
      },
      {
        path: join(this.getClaudeCodeHome(), "skills"),
        sourceFamily: "global-claudecode",
        isBundled: false
      },
      {
        path: join(this.rootDir, ".amp", "skills"),
        sourceFamily: "project-ampcli",
        isBundled: false
      },
      {
        path: join(this.getAmpHome(), "skills"),
        sourceFamily: "global-ampcli",
        isBundled: false
      },
      ...this.additionalPaths.map((path) => ({
        path,
        sourceFamily: "custom" as const,
        isBundled: false
      })),
      ...(this.bundledSkillsDir
        ? [{
            path: this.bundledSkillsDir,
            sourceFamily: "bundled" as const,
            isBundled: true
          }]
        : [])
    ];

    const uniquePaths = new Set<string>();
    return searchPaths.filter((entry) => {
      if (uniquePaths.has(entry.path)) {
        return false;
      }
      uniquePaths.add(entry.path);
      return true;
    });
  }

  private async discoverSkillsInPath(searchPath: SkillSearchPath): Promise<{
    skills: SkillInfo[];
    issues: SkillDiscoveryIssue[];
  }> {
    const skills: SkillInfo[] = [];
    const issues: SkillDiscoveryIssue[] = [];

    try {
      const entries = await readdir(searchPath.path, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (searchPath.isBundled) {
          if (!isBundledSkillName(entry.name)) {
            continue;
          }
        }

        const skillPath = join(searchPath.path, entry.name, "SKILL.md");
        try {
          const content = await readFile(skillPath, "utf8");
          const metadata = this.parseSkillMetadata(content, entry.name);
          if (metadata.name !== entry.name) {
            issues.push({
              kind: "skill_entry",
              code: "metadata_name_mismatch",
              detail: `Frontmatter name "${metadata.name}" does not match directory "${entry.name}".`,
              searchPath: searchPath.path,
              sourceFamily: searchPath.sourceFamily,
              dirName: entry.name,
              skillPath
            });
          }

          skills.push({
            name: metadata.name,
            description: metadata.description,
            version: metadata.version ?? "1.0.0",
            path: skillPath,
            searchPath: searchPath.path,
            sourceFamily: searchPath.sourceFamily,
            isBundled: searchPath.isBundled,
            shadowedAlternatives: []
          });
        } catch (error) {
          issues.push(this.createDiscoveryIssue(searchPath, entry.name, skillPath, error));
        }
      }
    } catch (error) {
      if (this.readErrorCode(error) !== "ENOENT") {
        issues.push(this.createSearchPathIssue(searchPath, error));
      }
    }

    return { skills, issues };
  }

  parseSkillMetadata(content: string, dirName: string): SkillMetadata {
    const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);

    if (!frontmatterMatch) {
      return {
        name: dirName,
        description: this.extractFirstParagraph(content) || `Skill: ${dirName}`
      };
    }

    const frontmatter = frontmatterMatch[1] || "";
    const metadata: SkillMetadata = {
      name: dirName,
      description: ""
    };

    const nameMatch = frontmatter.match(/^name:\s*["']?([^"'\n]+)["']?\s*$/m);
    if (nameMatch?.[1]) {
      metadata.name = nameMatch[1].trim();
    }

    const descMatch = frontmatter.match(/^description:\s*["']?([^"'\n]+)["']?\s*$/m);
    if (descMatch?.[1]) {
      metadata.description = descMatch[1].trim();
    }

    const versionMatch = frontmatter.match(/^version:\s*["']?([^"'\n]+)["']?\s*$/m);
    if (versionMatch?.[1]) {
      metadata.version = versionMatch[1].trim();
    }

    if (!metadata.description) {
      const afterFrontmatter = content.slice(frontmatterMatch[0].length);
      metadata.description = this.extractFirstParagraph(afterFrontmatter) || `Skill: ${metadata.name}`;
    }

    return metadata;
  }

  private extractFirstParagraph(content: string): string | null {
    const lines = content.trim().split(/\n/);
    const paragraphLines: string[] = [];

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine.startsWith("#")) continue;
      if (trimmedLine === "" && paragraphLines.length > 0) break;
      if (trimmedLine !== "") {
        paragraphLines.push(trimmedLine);
      }
    }

    const paragraph = paragraphLines.join(" ").trim();
    return paragraph.length > 0 ? paragraph.slice(0, 200) : null;
  }

  clearCache(): void {
    this.discoveryReportCache = null;
    this.skillCache = null;
  }

  private createSearchPathIssue(searchPath: SkillSearchPath, error: unknown): SkillDiscoveryIssue {
    return {
      kind: "search_path",
      code: this.readErrorCode(error),
      detail: this.readErrorDetail(error),
      searchPath: searchPath.path,
      sourceFamily: searchPath.sourceFamily
    };
  }

  private createDiscoveryIssue(
    searchPath: SkillSearchPath,
    dirName: string,
    skillPath: string,
    error: unknown
  ): SkillDiscoveryIssue {
    return {
      kind: "skill_entry",
      code: this.readErrorCode(error),
      detail: this.readErrorDetail(error),
      searchPath: searchPath.path,
      sourceFamily: searchPath.sourceFamily,
      dirName,
      skillPath
    };
  }

  private readErrorCode(error: unknown): string {
    if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
      return error.code;
    }
    return "unknown";
  }

  private readErrorDetail(error: unknown): string {
    if (error instanceof Error && error.message.trim().length > 0) {
      return error.message;
    }
    return String(error);
  }

  private toAlternative(skill: SkillInfo): SkillAlternative {
    return {
      name: skill.name,
      path: skill.path,
      searchPath: skill.searchPath ?? "",
      sourceFamily: skill.sourceFamily ?? "custom",
      isBundled: skill.isBundled ?? false
    };
  }
}

function filterSections(content: string, topic: string): string | null {
  const normalized = topic.trim().toLowerCase();
  const lines = content.split(/\r?\n/);
  const sections: Array<{ heading: string; body: string[] }> = [];
  let currentHeading = "";
  let currentBody: string[] = [];

  const flush = () => {
    if (currentHeading || currentBody.length > 0) {
      sections.push({ heading: currentHeading, body: [...currentBody] });
    }
    currentHeading = "";
    currentBody = [];
  };

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,3})\s+(.*)$/);
    if (headingMatch) {
      flush();
      currentHeading = (headingMatch[2] || "").trim();
      currentBody.push(line);
      continue;
    }
    currentBody.push(line);
  }
  flush();

  const matches = sections.filter((section) => section.heading.toLowerCase().includes(normalized));
  if (matches.length === 0) {
    return null;
  }
  return matches.map((section) => section.body.join("\n")).join("\n\n");
}
