import { resolveSiteRecipeForProvider, resolveSiteRecipeForUrl } from "./site-registry";
import type { SiteRecipe } from "../types";

export type ProviderUrlSiteRecipeCompatibilityResult =
  | { ok: true; recipeId: string }
  | { ok: false; message: string };

type ProviderUrlSiteRecipeCompatibilityInput = {
  providers: string[];
  urls: string[];
};

const normalizeNonBlank = (values: string[]): string[] => values
  .map((value) => value.trim())
  .filter((value) => value.length > 0);

const incompatible = (message: string): ProviderUrlSiteRecipeCompatibilityResult => ({ ok: false, message });

const supportsBrowserNativeRecovery = (recipe: SiteRecipe | undefined): recipe is SiteRecipe => (
  typeof recipe?.browserNativeDiscovery?.buildSearchUrl === "function"
);

export const validateProviderUrlSiteRecipeCompatibility = ({
  providers,
  urls
}: ProviderUrlSiteRecipeCompatibilityInput): ProviderUrlSiteRecipeCompatibilityResult => {
  const providerIds = normalizeNonBlank(providers);
  const referenceUrls = normalizeNonBlank(urls);

  if (providerIds.length === 0) {
    return incompatible("Provider-scoped URL recovery requires at least one provider.");
  }
  if (referenceUrls.length === 0) {
    return incompatible("Provider-scoped URL recovery requires at least one URL.");
  }

  const providerRecipes = providerIds.map((providerId) => ({
    providerId,
    recipe: resolveSiteRecipeForProvider(providerId)
  }));
  const missingProviderRecipe = providerRecipes.find((entry) => entry.recipe === undefined);
  if (missingProviderRecipe) {
    return incompatible(`Provider ${missingProviderRecipe.providerId} does not support URL-only site recipe recovery.`);
  }
  const nonNativeProviderRecipe = providerRecipes.find((entry) => !supportsBrowserNativeRecovery(entry.recipe));
  if (nonNativeProviderRecipe) {
    return incompatible(`Provider ${nonNativeProviderRecipe.providerId} does not support browser-native URL-only site recipe recovery.`);
  }

  const urlRecipes = referenceUrls.map((url) => ({
    url,
    recipe: resolveSiteRecipeForUrl(url)
  }));
  const missingUrlRecipe = urlRecipes.find((entry) => entry.recipe === undefined);
  if (missingUrlRecipe) {
    return incompatible(`URL ${missingUrlRecipe.url} does not match a browser-native site recipe for provider-scoped recovery.`);
  }
  const nonNativeUrlRecipe = urlRecipes.find((entry) => !supportsBrowserNativeRecovery(entry.recipe));
  if (nonNativeUrlRecipe) {
    return incompatible(`URL ${nonNativeUrlRecipe.url} does not match a browser-native site recipe for provider-scoped recovery.`);
  }

  const recipeIds = new Set([
    ...providerRecipes.map((entry) => entry.recipe?.id),
    ...urlRecipes.map((entry) => entry.recipe?.id)
  ]);
  if (recipeIds.size !== 1) {
    return incompatible("Provider-scoped URL recovery requires every provider and URL to resolve to the same site recipe.");
  }

  const recipeId = providerRecipes[0]?.recipe?.id;
  if (!recipeId) {
    return incompatible("Provider-scoped URL recovery could not resolve a site recipe.");
  }
  return { ok: true, recipeId };
};
