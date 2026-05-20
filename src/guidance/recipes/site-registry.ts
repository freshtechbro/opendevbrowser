import { pinterestSiteRecipe } from "./pinterest";
import type { SiteRecipe } from "../types";

const freezeRecipeValue = <T>(value: T): T => {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) {
    freezeRecipeValue(child);
  }
  return Object.freeze(value);
};

const SITE_RECIPES: SiteRecipe[] = [freezeRecipeValue(pinterestSiteRecipe)];

const normalizeHostname = (hostname: string): string => hostname.toLowerCase().replace(/^www\./, "");

export const listSiteRecipes = (): SiteRecipe[] => [...SITE_RECIPES];

export const resolveSiteRecipeForProvider = (providerId: string): SiteRecipe | undefined => {
  return SITE_RECIPES.find((recipe) => recipe.providerIds.includes(providerId));
};

export const resolveSiteRecipeForUrl = (url: string): SiteRecipe | undefined => {
  let hostname: string;
  try {
    hostname = normalizeHostname(new URL(url).hostname);
  } catch {
    return undefined;
  }
  return SITE_RECIPES.find((recipe) => {
    return recipe.hostnames.some((candidate) => {
      const normalized = normalizeHostname(candidate);
      return hostname === normalized || hostname.endsWith(`.${normalized}`);
    });
  });
};
