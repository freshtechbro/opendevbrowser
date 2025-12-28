import { readFile } from "fs/promises";
import { join } from "path";

export class SkillLoader {
  private rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  async loadBestPractices(topic?: string): Promise<string> {
    const candidates = [
      join(this.rootDir, "skills", "opendevbrowser-best-practices", "SKILL.md"),
      join(this.rootDir, "..", "skills", "opendevbrowser-best-practices", "SKILL.md")
    ];
    let content: string | null = null;

    for (const candidate of candidates) {
      try {
        content = await readFile(candidate, "utf8");
        break;
      } catch (error) {
        if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
      }
    }

    if (!content) {
      throw new Error("Skill loader could not find opendevbrowser-best-practices.");
    }
    const trimmed = content.trim();
    if (!topic || !topic.trim()) {
      return trimmed;
    }
    const filtered = filterSections(trimmed, topic);
    return filtered || trimmed;
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
