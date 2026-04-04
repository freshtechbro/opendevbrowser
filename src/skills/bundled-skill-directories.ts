export type BundledSkillDirectory =
  | {
    name: string;
    policy: "discoverable";
  }
  | {
    name: string;
    policy: "aliasOnly";
    aliasFor: string;
  };

export const bundledSkillDirectories: BundledSkillDirectory[] = [
  { name: "opendevbrowser-best-practices", policy: "discoverable" },
  { name: "opendevbrowser-continuity-ledger", policy: "discoverable" },
  { name: "opendevbrowser-data-extraction", policy: "discoverable" },
  { name: "opendevbrowser-design-agent", policy: "discoverable" },
  { name: "opendevbrowser-form-testing", policy: "discoverable" },
  { name: "opendevbrowser-login-automation", policy: "discoverable" },
  { name: "opendevbrowser-product-presentation-asset", policy: "discoverable" },
  { name: "opendevbrowser-research", policy: "discoverable" },
  { name: "opendevbrowser-shopping", policy: "discoverable" },
  { name: "research", policy: "aliasOnly", aliasFor: "opendevbrowser-research" },
  { name: "shopping", policy: "aliasOnly", aliasFor: "opendevbrowser-shopping" }
];

const bundledSkillDirectoryByName = new Map(
  bundledSkillDirectories.map((entry) => [entry.name, entry] as const)
);

export function listBundledSkillDirectories(): BundledSkillDirectory[] {
  return [...bundledSkillDirectories];
}

export function listBundledSkillAliases(): Extract<BundledSkillDirectory, { policy: "aliasOnly" }>[] {
  return bundledSkillDirectories.filter((entry): entry is Extract<BundledSkillDirectory, { policy: "aliasOnly" }> => entry.policy === "aliasOnly");
}

export function getBundledSkillDirectory(name: string): BundledSkillDirectory | null {
  return bundledSkillDirectoryByName.get(name) ?? null;
}

export function isBundledSkillDiscoverable(name: string): boolean {
  return getBundledSkillDirectory(name)?.policy === "discoverable";
}
