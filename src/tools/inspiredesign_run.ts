import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { ToolDeps } from "./deps";
import { failure, ok, serializeError } from "./response";
import { resolveProviderRuntime } from "./workflow-runtime";
import { CHALLENGE_AUTOMATION_MODES } from "../challenges/types";
import { captureInspiredesignReferenceFromManager } from "../providers/inspiredesign-capture";
import { resolveInspiredesignCaptureMode } from "../providers/inspiredesign-capture-mode";

const z = tool.schema;
const modeSchema = z.enum(["compact", "json", "md", "context", "path"]);
const captureModeSchema = z.enum(["off", "deep"]);
const cookiePolicySchema = z.enum(["off", "auto", "required"]);
const challengeAutomationModeSchema = z.enum(CHALLENGE_AUTOMATION_MODES);

export function createInspiredesignRunTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "Run the inspiredesign workflow directly.",
    args: {
      brief: z.string().min(1).describe("Inspiredesign brief"),
      urls: z.array(z.string()).optional().describe("Inspiration URLs to analyze"),
      captureMode: captureModeSchema.optional().describe("Capture mode: off|deep"),
      includePrototypeGuidance: z.boolean().optional().describe("Include prototype guidance output"),
      mode: modeSchema.optional().describe("compact|json|md|context|path"),
      timeoutMs: z.number().int().positive().optional().describe("Workflow timeout in milliseconds"),
      outputDir: z.string().optional().describe("Optional artifact output directory"),
      ttlHours: z.number().int().positive().optional().describe("Artifact retention TTL in hours"),
      useCookies: z.boolean().optional().describe("Enable/disable provider cookie injection for this run"),
      challengeAutomationMode: challengeAutomationModeSchema.optional().describe("Challenge automation mode: off|browser|browser_with_helper"),
      cookiePolicyOverride: cookiePolicySchema.optional().describe("Override cookie policy: off|auto|required")
    },
    async execute(args) {
      try {
        const runtime = await resolveProviderRuntime(deps);
        const { runInspiredesignWorkflow } = await import("../providers");
        const captureMode = resolveInspiredesignCaptureMode(args.captureMode, args.urls);
        const cookieSource = deps.config.get().providers?.cookieSource;
        const result = await runInspiredesignWorkflow(runtime, {
          brief: args.brief,
          urls: args.urls,
          captureMode,
          includePrototypeGuidance: args.includePrototypeGuidance,
          mode: args.mode ?? "compact",
          timeoutMs: args.timeoutMs,
          outputDir: args.outputDir,
          ttlHours: args.ttlHours,
          useCookies: args.useCookies,
          challengeAutomationMode: args.challengeAutomationMode,
          cookiePolicyOverride: args.cookiePolicyOverride
        }, {
          captureReference: captureMode === "deep"
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
