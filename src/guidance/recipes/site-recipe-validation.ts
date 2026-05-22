import { resolveSiteRecipeForProvider, resolveSiteRecipeForUrl } from "./site-registry";
import { normalizePinterestReferenceUrl } from "./pinterest";
import type { SiteRecipe } from "../types";

export type ProviderUrlSiteRecipeCompatibilityResult =
  | { ok: true; recipeId: string }
  | { ok: false; message: string };

export type ProviderScopedUrlCanonicalityResult =
  | { ok: true }
  | { ok: false; message: string };

type ProviderUrlSiteRecipeCompatibilityInput = {
  providers: string[];
  urls: string[];
};

type ProviderUrlSiteRecipeCompatibilityGateInput = ProviderUrlSiteRecipeCompatibilityInput & {
  query?: string;
};

const normalizeNonBlank = (values: string[]): string[] => values
  .map((value) => value.trim())
  .filter((value) => value.length > 0);

const incompatible = (message: string): ProviderUrlSiteRecipeCompatibilityResult => ({ ok: false, message });

const supportsBrowserNativeRecovery = (recipe: SiteRecipe | undefined): recipe is SiteRecipe => (
  typeof recipe?.browserNativeDiscovery?.buildSearchUrl === "function"
);

const isCanonicalRecipeReferenceUrl = (recipe: SiteRecipe, url: string): boolean => {
  if (recipe.id === "social/pinterest") {
    return normalizePinterestReferenceUrl(url) !== null;
  }
  return true;
};

const isPinterestLikeHostname = (value: string): boolean => {
  const hostname = value.toLowerCase();
  return [
    hostname === "pinterest.com",
    hostname.endsWith(".pinterest.com"),
    hostname.startsWith("pinterest."),
    hostname.includes(".pinterest.")
  ].some(Boolean);
};

export const isPinterestLikeUrl = (value: string): boolean => {
  try {
    return isPinterestLikeHostname(new URL(value).hostname);
  } catch {
    return false;
  }
};

export const isNonCanonicalPinterestLikeUrl = (url: string): boolean => (
  (resolveSiteRecipeForUrl(url)?.id === "social/pinterest" || isPinterestLikeUrl(url))
  && normalizePinterestReferenceUrl(url) === null
);

export const requiresProviderUrlSiteRecipeCompatibility = ({
  providers,
  urls,
  query
}: ProviderUrlSiteRecipeCompatibilityGateInput): boolean => {
  const providerIds = normalizeNonBlank(providers);
  if (providerIds.length === 0) return false;
  if (!query?.trim()) return true;
  return false;
};

export const validateProviderScopedUrlCanonicality = ({
  providers,
  urls
}: ProviderUrlSiteRecipeCompatibilityInput): ProviderScopedUrlCanonicalityResult => {
  const providerHasPinterest = normalizeNonBlank(providers)
    .some((providerId) => resolveSiteRecipeForProvider(providerId)?.id === "social/pinterest");
  if (!providerHasPinterest) return { ok: true };

  const nonCanonicalPinterestUrl = normalizeNonBlank(urls)
    .find((url) => normalizePinterestReferenceUrl(url) === null);
  if (!nonCanonicalPinterestUrl) return { ok: true };
  return incompatible(
    `URL ${nonCanonicalPinterestUrl} is not a canonical social/pinterest reference URL for provider-scoped recovery.`
  );
};

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
  const recipe = providerRecipes[0]?.recipe;
  const nonReferenceUrl = recipe
    ? urlRecipes.find((entry) => !isCanonicalRecipeReferenceUrl(recipe, entry.url))
    : undefined;
  if (nonReferenceUrl) {
    return incompatible(`URL ${nonReferenceUrl.url} is not a canonical ${recipeId} reference URL for provider-scoped recovery.`);
  }
  return { ok: true, recipeId };
};
