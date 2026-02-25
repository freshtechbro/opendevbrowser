import type { ProviderAdapter, ProviderOperation, ProviderSelection } from "./types";
import type { ProviderRegistry } from "./registry";

const SOURCE_ORDER = ["web", "community", "social", "shopping"] as const;

type HealthStatus = ReturnType<ProviderRegistry["getHealth"]>["status"];

const hasOperation = (provider: ProviderAdapter, operation: ProviderOperation): boolean => {
  switch (operation) {
    case "search":
      return typeof provider.search === "function";
    case "fetch":
      return typeof provider.fetch === "function";
    case "crawl":
      return typeof provider.crawl === "function";
    case "post":
      return typeof provider.post === "function";
  }
};

const rankHealth = (status: HealthStatus): number => {
  if (status === "healthy") return 0;
  if (status === "degraded") return 1;
  return 2;
};

export const selectProviders = (
  registry: ProviderRegistry,
  operation: ProviderOperation,
  selection: ProviderSelection = "auto"
): ProviderAdapter[] => {
  const providers = registry.list().filter((provider) => hasOperation(provider, operation));

  const bySelection = providers.filter((provider) => {
    if (selection === "all") return true;
    if (selection === "auto") return provider.source !== "shopping";
    return provider.source === selection;
  });

  return bySelection.sort((left, right) => {
    const healthDelta = rankHealth(registry.getHealth(left.id).status) - rankHealth(registry.getHealth(right.id).status);
    if (healthDelta !== 0) return healthDelta;

    const leftSourceRank = SOURCE_ORDER.indexOf(left.source);
    const rightSourceRank = SOURCE_ORDER.indexOf(right.source);
    const sourceDelta = leftSourceRank - rightSourceRank;
    if (sourceDelta !== 0) return sourceDelta;

    return left.id.localeCompare(right.id);
  });
};

export const shouldFallbackToNextProvider = (selection: ProviderSelection): boolean => {
  return selection === "all" || selection === "auto";
};
