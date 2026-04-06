export interface SkillInfo {
  name: string;
  description: string;
  version: string;
  path: string;
  searchPath?: string;
  sourceFamily?: SkillSourceFamily;
  isBundled?: boolean;
  shadowedAlternatives?: SkillAlternative[];
}

export interface SkillMetadata {
  name: string;
  description: string;
  version?: string;
}

export type SkillSourceFamily =
  | "project-opencode"
  | "global-opencode"
  | "project-codex"
  | "global-codex"
  | "project-claudecode"
  | "global-claudecode"
  | "project-ampcli"
  | "global-ampcli"
  | "custom"
  | "bundled";

export interface SkillAlternative {
  name: string;
  path: string;
  searchPath: string;
  sourceFamily: SkillSourceFamily;
  isBundled: boolean;
}

export interface SkillDiscoveryIssue {
  kind: "search_path" | "skill_entry";
  code: string;
  detail: string;
  searchPath: string;
  sourceFamily: SkillSourceFamily;
  dirName?: string;
  skillPath?: string;
}

export interface SkillSearchPath {
  path: string;
  sourceFamily: SkillSourceFamily;
  isBundled: boolean;
}

export interface SkillDiscoveryReport {
  skills: SkillInfo[];
  issues: SkillDiscoveryIssue[];
  searchOrder: SkillSearchPath[];
}
