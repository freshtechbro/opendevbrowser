import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import onboardingMetadata from "../cli/onboarding-metadata.json";
import type { ToolDeps } from "./deps";
import { ok } from "./response";
import { findBundledSkillsDir } from "../utils/package-assets";
import { listBundledSkillAliases as getBundledSkillAliases } from "../skills/bundled-skill-directories";

type SkillAliasEntry = {
  name: string;
  aliasFor: string;
  policy: "aliasOnly";
};

function listBundledSkillAliases(): SkillAliasEntry[] {
  if (!findBundledSkillsDir()) {
    return [];
  }

  return getBundledSkillAliases().map((entry) => ({
    name: entry.name,
    aliasFor: entry.aliasFor,
    policy: entry.policy
  }));
}

export function createSkillListTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "List bundled and discovered skill packs before choosing a local onboarding or workflow lane; research/ and shopping/ stay alias-only this cycle.",
    args: {},
    async execute() {
      const skills = await deps.skills.listSkills();
      const skillList = skills.map((s) => ({
        name: s.name,
        description: s.description,
        version: s.version
      }));
      const bundledAliases = listBundledSkillAliases();
      return ok({
        skills: skillList,
        count: skillList.length,
        bundledAliases,
        aliasCount: bundledAliases.length,
        notes: {
          aliasOnlyCompatibility: onboardingMetadata.skillDiscovery.aliasOnlyCycleNote,
          shadowRiskPath: onboardingMetadata.skillDiscovery.shadowRiskPath,
          shadowRiskSummary: onboardingMetadata.skillDiscovery.shadowRiskSummary,
          shadowRiskAction: onboardingMetadata.skillDiscovery.shadowRiskAction
        }
      });
    }
  });
}
