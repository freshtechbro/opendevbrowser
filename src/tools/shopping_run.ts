import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import { runShoppingWorkflow } from "../providers";
import type { ToolDeps } from "./deps";
import { failure, ok, serializeError } from "./response";
import { resolveProviderRuntime } from "./workflow-runtime";

const z = tool.schema;
const sortSchema = z.enum(["best_deal", "lowest_price", "highest_rating", "fastest_shipping"]);
const modeSchema = z.enum(["compact", "json", "md", "context", "path"]);
const cookiePolicySchema = z.enum(["off", "auto", "required"]);

export function createShoppingRunTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "Run shopping/deal intelligence across shopping providers.",
    args: {
      query: z.string().min(1).describe("Shopping query"),
      providers: z.array(z.string()).optional().describe("Optional provider allow-list"),
      budget: z.number().positive().optional().describe("Optional budget amount"),
      region: z.string().optional().describe("Region hint"),
      sort: sortSchema.optional().describe("best_deal|lowest_price|highest_rating|fastest_shipping"),
      mode: modeSchema.optional().describe("compact|json|md|context|path"),
      outputDir: z.string().optional().describe("Optional artifact output directory"),
      ttlHours: z.number().int().positive().optional().describe("Artifact retention TTL in hours"),
      useCookies: z.boolean().optional().describe("Enable/disable provider cookie injection for this run"),
      cookiePolicyOverride: cookiePolicySchema.optional().describe("Override cookie policy: off|auto|required")
    },
    async execute(args) {
      try {
        const runtime = resolveProviderRuntime(deps);
        const result = await runShoppingWorkflow(runtime, {
          query: args.query,
          providers: args.providers,
          budget: args.budget,
          region: args.region,
          sort: args.sort,
          mode: args.mode ?? "compact",
          outputDir: args.outputDir,
          ttlHours: args.ttlHours,
          useCookies: args.useCookies,
          cookiePolicyOverride: args.cookiePolicyOverride
        });
        return ok(result);
      } catch (error) {
        return failure(serializeError(error).message, "shopping_run_failed");
      }
    }
  });
}
