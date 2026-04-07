import {
  SHOPPING_PROVIDER_IDS,
  SHOPPING_PROVIDER_PROFILES,
  getShoppingRegionSupportDiagnostics,
  validateShoppingLegalReviewChecklist,
  type ShoppingRegionSupportDiagnostic
} from "./shopping";
import type { ProviderAggregateResult, ProviderRunOptions } from "./types";
import type { ProviderExecutor, ShoppingRunInput } from "./workflows";

const DEFAULT_SHOPPING_PROVIDER_IDS = SHOPPING_PROVIDER_PROFILES
  .filter((profile) => profile.tier === "tier1")
  .map((profile) => profile.id);

export interface CompiledShoppingWorkflow {
  query: string;
  now: Date;
  providerIds: string[];
  hasExplicitProviderSelection: boolean;
  autoExcludedProviders: string[];
  effectiveProviderIds: string[];
  regionDiagnostics: ShoppingRegionSupportDiagnostic[];
  budget?: number;
  region?: string;
  sort: NonNullable<ShoppingRunInput["sort"]>;
}

export interface ShoppingWorkflowRun {
  providerId: string;
  result: ProviderAggregateResult;
}

export interface CompileShoppingWorkflowOptions {
  now?: Date;
  getDegradedProviders?: (providerIds: string[]) => ReadonlySet<string>;
}

export interface ExecuteShoppingSearchesOptions {
  buildSearchOptions: (providerId: string) => ProviderRunOptions;
  observeResult?: (result: ProviderAggregateResult) => void;
  limit?: number;
}

export const resolveShoppingProviders = (providers?: string[]): string[] => {
  if (!providers || providers.length === 0) {
    return DEFAULT_SHOPPING_PROVIDER_IDS.length > 0
      ? [...DEFAULT_SHOPPING_PROVIDER_IDS]
      : [...SHOPPING_PROVIDER_IDS];
  }

  const normalized = providers
    .map((provider) => provider.trim().toLowerCase())
    .filter(Boolean)
    .map((provider) => provider.startsWith("shopping/") ? provider : `shopping/${provider}`);

  const deduped = [...new Set(normalized)].filter((provider) => SHOPPING_PROVIDER_IDS.includes(provider as (typeof SHOPPING_PROVIDER_IDS)[number]));
  if (deduped.length === 0) {
    throw new Error("No valid shopping providers were requested");
  }
  return deduped;
};

export const enforceShoppingLegalReviewGate = (providerIds: string[], now: Date): void => {
  const blocked = providerIds
    .map((providerId) => ({ providerId, validation: validateShoppingLegalReviewChecklist(providerId, now) }))
    .filter((entry) => !entry.validation.valid);

  if (blocked.length === 0) return;
  const summary = blocked
    .map((entry) => `${entry.providerId}:${entry.validation.reasonCode ?? "missing_checklist"}`)
    .join(", ");
  throw new Error(`Provider legal review checklist invalid or expired: ${summary}`);
};

export const compileShoppingWorkflow = (
  input: ShoppingRunInput,
  options: CompileShoppingWorkflowOptions = {}
): CompiledShoppingWorkflow => {
  const query = input.query?.trim();
  if (!query) {
    throw new Error("query is required");
  }

  const providerIds = resolveShoppingProviders(input.providers);
  const hasExplicitProviderSelection = Boolean(input.providers && input.providers.length > 0);
  const degradedProviders = options.getDegradedProviders?.(providerIds) ?? new Set<string>();
  const autoExcludedProviders = hasExplicitProviderSelection
    ? []
    : providerIds.filter((providerId) => degradedProviders.has(providerId));
  const effectiveProviderIds = hasExplicitProviderSelection
    ? providerIds
    : providerIds.filter((providerId) => !degradedProviders.has(providerId));
  const now = options.now ?? new Date();
  if (effectiveProviderIds.length === 0) {
    throw new Error("All default shopping providers are temporarily excluded due to degraded anti-bot/rate-limit state");
  }

  enforceShoppingLegalReviewGate(effectiveProviderIds, now);

  return {
    query,
    now,
    providerIds,
    hasExplicitProviderSelection,
    autoExcludedProviders,
    effectiveProviderIds,
    regionDiagnostics: input.region
      ? getShoppingRegionSupportDiagnostics(effectiveProviderIds, input.region)
      : [],
    ...(typeof input.budget === "number" ? { budget: input.budget } : {}),
    ...(input.region ? { region: input.region } : {}),
    sort: input.sort ?? "best_deal"
  };
};

export const executeShoppingSearches = async (
  runtime: ProviderExecutor,
  compiled: CompiledShoppingWorkflow,
  options: ExecuteShoppingSearchesOptions
): Promise<ShoppingWorkflowRun[]> => {
  return Promise.all(compiled.effectiveProviderIds.map(async (providerId) => {
    const result = await runtime.search({
      query: compiled.query,
      limit: options.limit ?? 8,
      filters: {
        ...(typeof compiled.budget === "number" ? { budget: compiled.budget } : {}),
        ...(compiled.region ? { region: compiled.region } : {})
      }
    }, options.buildSearchOptions(providerId));
    options.observeResult?.(result);
    return {
      providerId,
      result
    };
  }));
};
