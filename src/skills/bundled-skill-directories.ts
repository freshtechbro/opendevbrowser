export interface BundledSkillDirectory {
  name: string;
}

export const bundledSkillDirectories: BundledSkillDirectory[] = [
  { name: "opendevbrowser-best-practices" },
  { name: "opendevbrowser-continuity-ledger" },
  { name: "opendevbrowser-data-extraction" },
  { name: "opendevbrowser-design-agent" },
  { name: "opendevbrowser-form-testing" },
  { name: "opendevbrowser-login-automation" },
  { name: "opendevbrowser-product-presentation-asset" },
  { name: "opendevbrowser-research" },
  { name: "opendevbrowser-shopping" }
];

const bundledSkillDirectoryByName = new Map(
  bundledSkillDirectories.map((entry) => [entry.name, entry] as const)
);

export function listBundledSkillDirectories(): BundledSkillDirectory[] {
  return [...bundledSkillDirectories];
}

export function getBundledSkillDirectory(name: string): BundledSkillDirectory | null {
  return bundledSkillDirectoryByName.get(name) ?? null;
}

export function isBundledSkillName(name: string): boolean {
  return bundledSkillDirectoryByName.has(name);
}
