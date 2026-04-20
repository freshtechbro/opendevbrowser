import type { InstallMode, ParsedArgs } from "./args";
import { hasBundledSkillArtifacts, hasManagedBundledSkillInstall } from "./installers/skills";

function shouldRefreshManagedSkills(mode: InstallMode): boolean {
  return hasManagedBundledSkillInstall(mode) || hasBundledSkillArtifacts(mode);
}

export function resolveUpdateSkillModes(args: ParsedArgs): InstallMode[] {
  if (args.rawArgs.includes("--no-skills")) {
    return [];
  }
  if (args.rawArgs.includes("--skills-global")) {
    return ["global"];
  }
  if (args.rawArgs.includes("--skills-local")) {
    return ["local"];
  }
  if (args.mode) {
    return [args.mode];
  }

  const modes: InstallMode[] = [];
  if (shouldRefreshManagedSkills("global")) {
    modes.push("global");
  }
  if (shouldRefreshManagedSkills("local")) {
    modes.push("local");
  }
  return modes;
}
