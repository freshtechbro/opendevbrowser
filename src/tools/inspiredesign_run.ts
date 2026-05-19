import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { ToolDeps } from "./deps";
import { failure, ok, serializeError } from "./response";
import { resolveProviderRuntime } from "./workflow-runtime";
import { resolveWorkflowToolOutputDir } from "./workflow-output";
import { CHALLENGE_AUTOMATION_MODES } from "../challenges/types";
import { DEFAULT_WORKFLOW_TRANSPORT_TIMEOUT_MS } from "../cli/transport-timeouts";
import { captureInspiredesignReferenceFromManager } from "../inspiredesign/capture";
import { resolveInspiredesignCaptureMode } from "../inspiredesign/capture-mode";

const z = tool.schema;
const modeSchema = z.enum(["compact", "json", "md", "context", "path"]);
const captureModeSchema = z.enum(["off", "deep"]);
const browserModeSchema = z.enum(["auto", "extension", "managed"]);
const cookiePolicySchema = z.enum(["off", "auto", "required"]);
const visualEvidenceSchema = z.enum(["off", "auto", "required"]);
const challengeAutomationModeSchema = z.enum(CHALLENGE_AUTOMATION_MODES);
const HARVEST_DEFAULT_MAX_REFERENCES = 5;
const MAX_HARVEST_REFERENCES = 10;

export function createInspiredesignRunTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "Run the inspiredesign workflow directly, including harvest query discovery and visual evidence capture.",
    args: {
      brief: z.string().min(1).describe("Inspiredesign brief"),
      harvest: z.boolean().optional().describe("Enable visual harvest defaults for query-backed discovery"),
      query: z.string().optional().describe("Reference discovery query for visual harvest"),
      providers: z.array(z.string()).optional().describe("Optional provider ids for reference discovery"),
      maxReferences: z.number().int().min(1).max(MAX_HARVEST_REFERENCES).optional().describe("Maximum references to analyze"),
      visualEvidence: visualEvidenceSchema.optional().describe("Visual evidence mode: off|auto|required"),
      urls: z.array(z.string()).optional().describe("Inspiration URLs to analyze"),
      captureMode: captureModeSchema.optional().describe("Capture mode: off|deep. Any URLs force deep."),
      includePrototypeGuidance: z.boolean().optional().describe("Include prototype guidance output"),
      mode: modeSchema.optional().describe("compact|json|md|context|path"),
      timeoutMs: z.number().int().positive().optional().describe("Workflow timeout in milliseconds"),
      outputDir: z.string().optional().describe("Optional artifact output directory"),
      ttlHours: z.number().int().positive().optional().describe("Artifact retention TTL in hours"),
      browserMode: browserModeSchema.optional().describe("Browser transport mode: auto|extension|managed"),
      useCookies: z.boolean().optional().describe("Enable/disable provider cookie injection for this run"),
      challengeAutomationMode: challengeAutomationModeSchema.optional().describe("Challenge automation mode: off|browser|browser_with_helper"),
      cookiePolicyOverride: cookiePolicySchema.optional().describe("Override cookie policy: off|auto|required")
    },
    async execute(args) {
      try {
        const runtime = await resolveProviderRuntime(deps);
        const { runInspiredesignWorkflow } = await import("../providers");
        const captureMode = resolveInspiredesignCaptureMode(args.captureMode, args.urls);
        if (args.query && args.harvest !== true) {
          throw new Error("query is only supported when harvest is true.");
        }
        if (args.providers && args.providers.length > 0 && !args.query) {
          throw new Error("providers require query.");
        }
        const cookieSource = deps.config.get().providers?.cookieSource;
        const isHarvest = args.harvest === true;
        if (isHarvest && !args.query && (!args.urls || args.urls.length === 0)) {
          throw new Error("inspiredesign harvest requires query or URLs.");
        }
        const shouldProvideCaptureReference = captureMode === "deep" || isHarvest || Boolean(args.query);
        const result = await runInspiredesignWorkflow(runtime, {
          brief: args.brief,
          harvest: args.harvest,
          query: args.query,
          providers: args.providers,
          maxReferences: args.maxReferences ?? (isHarvest ? HARVEST_DEFAULT_MAX_REFERENCES : undefined),
          visualEvidence: args.visualEvidence ?? (isHarvest ? "required" : "off"),
          urls: args.urls,
          captureMode,
          includePrototypeGuidance: args.includePrototypeGuidance,
          mode: args.mode ?? (isHarvest ? "path" : "compact"),
          timeoutMs: args.timeoutMs ?? DEFAULT_WORKFLOW_TRANSPORT_TIMEOUT_MS,
          outputDir: resolveWorkflowToolOutputDir(deps, args.outputDir),
          ttlHours: args.ttlHours,
          browserMode: args.browserMode,
          useCookies: args.useCookies,
          challengeAutomationMode: args.challengeAutomationMode,
          cookiePolicyOverride: args.cookiePolicyOverride
        }, {
          captureReference: shouldProvideCaptureReference
            ? async (url, options) => captureInspiredesignReferenceFromManager(deps.manager, url, {
              ...options,
              cookieSource
            })
            : undefined
        });
        return ok(result);
      } catch (error) {
        return failure(serializeError(error).message, "inspiredesign_run_failed");
      }
    }
  });
}
