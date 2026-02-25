import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import { runResearchWorkflow } from "../providers";
import type { ToolDeps } from "./deps";
import { failure, ok, serializeError } from "./response";
import { resolveProviderRuntime } from "./workflow-runtime";

const z = tool.schema;
const sourceSelectionSchema = z.enum(["auto", "web", "community", "social", "shopping", "all"]);
const sourceSchema = z.enum(["web", "community", "social", "shopping"]);
const modeSchema = z.enum(["compact", "json", "md", "context", "path"]);
const cookiePolicySchema = z.enum(["off", "auto", "required"]);

export function createResearchRunTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "Run cross-source research with strict timebox and artifact outputs.",
    args: {
      topic: z.string().min(1).describe("Research topic"),
      days: z.number().int().positive().optional().describe("Timebox in days"),
      from: z.string().optional().describe("ISO start date"),
      to: z.string().optional().describe("ISO end date"),
      sourceSelection: sourceSelectionSchema.optional().describe("auto|web|community|social|shopping|all"),
      sources: z.array(sourceSchema).optional().describe("Explicit source list"),
      mode: modeSchema.optional().describe("compact|json|md|context|path"),
      includeEngagement: z.boolean().optional().describe("Include engagement enrichment"),
      limitPerSource: z.number().int().positive().optional().describe("Result limit per source"),
      outputDir: z.string().optional().describe("Optional artifact output directory"),
      ttlHours: z.number().int().positive().optional().describe("Artifact retention TTL in hours"),
      useCookies: z.boolean().optional().describe("Enable/disable provider cookie injection for this run"),
      cookiePolicyOverride: cookiePolicySchema.optional().describe("Override cookie policy: off|auto|required")
    },
    async execute(args) {
      try {
        const runtime = resolveProviderRuntime(deps);
        const result = await runResearchWorkflow(runtime, {
          topic: args.topic,
          days: args.days,
          from: args.from,
          to: args.to,
          sourceSelection: args.sourceSelection,
          sources: args.sources,
          mode: args.mode ?? "compact",
          includeEngagement: args.includeEngagement,
          limitPerSource: args.limitPerSource,
          outputDir: args.outputDir,
          ttlHours: args.ttlHours,
          useCookies: args.useCookies,
          cookiePolicyOverride: args.cookiePolicyOverride
        });
        return ok(result);
      } catch (error) {
        return failure(serializeError(error).message, "research_run_failed");
      }
    }
  });
}
