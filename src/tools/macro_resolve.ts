import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import {
  type MacroResolution
} from "../macros/execute";
import { executeMacroWithRuntime } from "../macros/execute-runtime";
import { buildMacroResolveSuccessHandoff } from "../providers/workflow-handoff";
import { CHALLENGE_AUTOMATION_MODES } from "../challenges/types";
import type { ToolDeps } from "./deps";
import { failure, ok, serializeError } from "./response";
import { resolveProviderRuntime } from "./workflow-runtime";

const z = tool.schema;
const browserModeSchema = z.enum(["auto", "extension", "managed"]);
const challengeAutomationModeSchema = z.enum(CHALLENGE_AUTOMATION_MODES);
const cookiePolicySchema = z.enum(["off", "auto", "required"]);

type MacroRuntimeModule = {
  createDefaultMacroRegistry?: () => {
    resolve: (expression: string, context?: { defaultProvider?: string }) => Promise<MacroResolution>;
    list: () => Array<{ name: string; pack?: string; description?: string }>;
  };
};

type FallbackMacroResolution = MacroResolution;

async function loadMacroRuntime(): Promise<MacroRuntimeModule | null> {
  try {
    const module = await import("../macros");
    return module as MacroRuntimeModule;
  } catch {
    return null;
  }
}

function parseFallbackMacro(expression: string, defaultProvider?: string): FallbackMacroResolution {
  const raw = expression.trim();
  if (!raw.startsWith("@")) {
    throw new Error("Macro expressions must start with '@'");
  }

  const body = raw.slice(1).trim();
  if (!body) {
    throw new Error("Macro name is required");
  }

  const openParen = body.indexOf("(");
  const closeParen = body.endsWith(")") ? body.length - 1 : -1;
  const macroName = openParen >= 0 ? body.slice(0, openParen).trim() : body;
  const argsBody = openParen >= 0 && closeParen > openParen
    ? body.slice(openParen + 1, closeParen).trim()
    : "";
  const positional = argsBody
    ? argsBody.split(",").map((part) => part.trim().replace(/^['\"]|['\"]$/g, "")).filter(Boolean)
    : [];
  const query = positional[0] ?? macroName;
  const provider = defaultProvider ?? "web/default";

  return {
    action: {
      source: "web",
      operation: "search",
      input: {
        query,
        limit: 10,
        providerId: provider
      }
    },
    provenance: {
      macro: macroName,
      provider,
      resolvedQuery: query,
      pack: "fallback",
      args: {
        positional,
        named: {}
      }
    }
  };
}


export function createMacroResolveTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "Resolve a macro expression to a provider action with provenance metadata.",
    args: {
      expression: z.string().min(2).describe("Macro expression, e.g. @web.search(\"query\")"),
      defaultProvider: z.string().optional().describe("Default provider fallback"),
      includeCatalog: z.boolean().optional().describe("Include available runtime macro names"),
      browserMode: browserModeSchema.optional().describe("Browser transport mode for executed macros: auto|extension|managed"),
      useCookies: z.boolean().optional().describe("Enable or disable provider cookie reuse for executed macros"),
      challengeAutomationMode: challengeAutomationModeSchema.optional().describe("Challenge automation mode for executed macros: off|browser|browser_with_helper"),
      cookiePolicyOverride: cookiePolicySchema.optional().describe("Per-run provider cookie policy override for executed macros: off|auto|required"),
      execute: z.boolean().optional().describe("Execute the resolved provider action and include execution payload")
    },
    async execute(args) {
      try {
        const runtime = await loadMacroRuntime();
        const registry = runtime?.createDefaultMacroRegistry?.();

        let resolvedRuntime: "macros" | "fallback" = "fallback";
        let resolution: MacroResolution;
        let catalog: Array<{ name: string; pack?: string; description?: string }> | undefined;

        if (registry) {
          resolvedRuntime = "macros";
          resolution = await registry.resolve(args.expression, {
            defaultProvider: args.defaultProvider
          });
          catalog = args.includeCatalog
            ? registry.list().map((entry) => ({
              name: entry.name,
              pack: entry.pack,
              description: entry.description
            }))
            : undefined;
        } else {
          resolution = parseFallbackMacro(args.expression, args.defaultProvider);
        }

        if (!args.execute && args.browserMode) {
          throw new Error("browserMode requires execute=true for macro resolution");
        }
        if (!args.execute && typeof args.useCookies === "boolean") {
          throw new Error("useCookies requires execute=true for macro resolution");
        }
        if (!args.execute && args.challengeAutomationMode) {
          throw new Error("challengeAutomationMode requires execute=true for macro resolution");
        }
        if (!args.execute && args.cookiePolicyOverride) {
          throw new Error("cookiePolicyOverride requires execute=true for macro resolution");
        }

        if (!args.execute) {
          const handoff = buildMacroResolveSuccessHandoff({
            expression: args.expression,
            defaultProvider: args.defaultProvider,
            execute: false,
            blocked: false
          });
          return ok({
            runtime: resolvedRuntime,
            resolution,
            ...(catalog ? { catalog } : {}),
            ...handoff
          });
        }

        const providerRuntime = await resolveProviderRuntime(deps);
        const execution = await executeMacroWithRuntime({
          resolution,
          runtime: providerRuntime,
          browserMode: args.browserMode,
          useCookies: args.useCookies,
          challengeAutomationMode: args.challengeAutomationMode,
          cookiePolicyOverride: args.cookiePolicyOverride
        });
        const handoff = buildMacroResolveSuccessHandoff({
          expression: args.expression,
          defaultProvider: args.defaultProvider,
          execute: true,
          blocked: Boolean(execution.meta.blocker)
        });

        return ok({
          runtime: resolvedRuntime,
          resolution,
          ...(catalog ? { catalog } : {}),
          execution,
          ...handoff
        });
      } catch (error) {
        return failure(serializeError(error).message, "macro_resolve_failed");
      }
    }
  });
}

export const __test__ = {
  parseFallbackMacro,
  loadMacroRuntime
};
