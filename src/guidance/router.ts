import { classifyGuidanceReadiness } from "./readiness";
import { genericGuidanceRecipes } from "./recipes/generic";
import type { GuidanceContext, GuidanceRecipe, NextStepGuidance } from "./types";

const byPriority = (left: GuidanceRecipe, right: GuidanceRecipe): number => {
  return right.priority - left.priority || left.id.localeCompare(right.id);
};

export class GuidanceRouter {
  private readonly recipes: GuidanceRecipe[];

  constructor(recipes: GuidanceRecipe[] = genericGuidanceRecipes) {
    this.recipes = recipes.slice().sort(byPriority);
  }

  route(context: GuidanceContext): NextStepGuidance {
    const readiness = classifyGuidanceReadiness(context);
    const recipe = this.recipes.find((candidate) => candidate.matches(context));
    if (!recipe) {
      throw new Error(`No guidance recipe matched workflow ${context.workflow}.`);
    }
    return recipe.build(context, readiness);
  }
}

export const routeNextStepGuidance = (context: GuidanceContext): NextStepGuidance => {
  return new GuidanceRouter().route(context);
};
