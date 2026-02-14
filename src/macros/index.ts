import { MacroRegistry } from "./registry";
import { createCoreMacroPack } from "./packs/core";
import type { MacroResolveContext, MacroResolution } from "./registry";

export { MacroRegistry, parseMacro } from "./registry";
export { createCoreMacroPack } from "./packs/core";
export type {
  MacroAction,
  MacroDefinition,
  MacroProvenance,
  MacroResolution,
  MacroResolveContext,
  MacroValue,
  ParsedMacro
} from "./registry";

export const createMacroRegistry = (): MacroRegistry => {
  const registry = new MacroRegistry();
  registry.registerPack(createCoreMacroPack());
  return registry;
};

export const createDefaultMacroRegistry = (): MacroRegistry => createMacroRegistry();

export const resolveMacro = async (
  expression: string,
  context: MacroResolveContext = {}
): Promise<MacroResolution> => {
  const registry = createMacroRegistry();
  return registry.resolve(expression, context);
};
