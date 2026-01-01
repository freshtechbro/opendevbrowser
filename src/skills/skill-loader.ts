import { readFile, readdir } from "fs/promises";
import { join } from "path";
import * as os from "os";
import type { SkillInfo, SkillMetadata } from "./types";

export class SkillLoader {
  private rootDir: string;
  private additionalPaths: string[];
  private skillCache: SkillInfo[] | null = null;

  constructor(rootDir: string, additionalPaths: string[] = []) {
    this.rootDir = rootDir;
    this.additionalPaths = additionalPaths.map((p) => this.expandPath(p));
  }

  private expandPath(p: string): string {
    if (p.startsWith("~")) {
      return join(os.homedir(), p.slice(1));
    }
    return p;
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

    const skills: SkillInfo[] = [];
    const searchPaths = this.getSearchPaths();

    for (const searchPath of searchPaths) {
      const discovered = await this.discoverSkillsInPath(searchPath);
      for (const skill of discovered) {
        if (!skills.some((s) => s.name === skill.name)) {
          skills.push(skill);
        }
      }
    }

    this.skillCache = skills;
    return skills;
  }

  private getSearchPaths(): string[] {
    const configDir = process.env.OPENCODE_CONFIG_DIR
      || join(os.homedir(), ".config", "opencode");

    const searchPaths = [
      join(this.rootDir, ".opencode", "skill"),
      join(configDir, "skill"),
      join(this.rootDir, ".claude", "skills"),
      join(os.homedir(), ".claude", "skills"),
      ...this.additionalPaths
    ];

    return Array.from(new Set(searchPaths));
  }

  private async discoverSkillsInPath(searchPath: string): Promise<SkillInfo[]> {
    const skills: SkillInfo[] = [];

    try {
      const entries = await readdir(searchPath, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const skillPath = join(searchPath, entry.name, "SKILL.md");
        try {
          const content = await readFile(skillPath, "utf8");
          const metadata = this.parseSkillMetadata(content, entry.name);

          skills.push({
            name: metadata.name,
            description: metadata.description,
            version: metadata.version ?? "1.0.0",
            path: skillPath
          });
        } catch {
          void 0;
        }
      }
    } catch {
      void 0;
    }

    return skills;
  }

  parseSkillMetadata(content: string, dirName: string): SkillMetadata {
    const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);

    if (!frontmatterMatch) {
      return {
        name: dirName,
        description: this.extractFirstParagraph(content) || `Skill: ${dirName}`
      };
    }

    const frontmatter = frontmatterMatch[1] ?? "";
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
    this.skillCache = null;
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
      currentHeading = headingMatch[2]?.trim() ?? "";
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
