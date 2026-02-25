import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import { createConfiguredProviderRuntime } from "../providers/runtime-factory";
import {
  executeMacroResolution,
  shapeExecutionPayload,
  type MacroResolution
} from "../macros/execute";
import type { ToolDeps } from "./deps";
import { failure, ok, serializeError } from "./response";

const z = tool.schema;

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

        if (!args.execute) {
          return ok({
            runtime: resolvedRuntime,
            resolution,
            ...(catalog ? { catalog } : {})
          });
        }

        const runtimeConfig = deps.config?.get?.();
        const providerRuntime = deps.providerRuntime ?? createConfiguredProviderRuntime({
          config: runtimeConfig,
          manager: deps.manager,
          browserFallbackPort: deps.browserFallbackPort
        });
        const execution = shapeExecutionPayload(
          await executeMacroResolution(resolution, providerRuntime)
        );

        return ok({
          runtime: resolvedRuntime,
          resolution,
          ...(catalog ? { catalog } : {}),
          execution
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
