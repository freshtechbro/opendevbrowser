import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { ToolDeps } from "./deps";
import { failure, ok, serializeError } from "./response";
import { buildAnnotateResult } from "../annotate/output";

const z = tool.schema;
const screenshotModeSchema = z.enum(["visible", "full", "none"]);
const transportSchema = z.enum(["auto", "direct", "relay"]);

export function createAnnotateTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "Request interactive annotations via direct (CDP) or relay transport.",
    args: {
      sessionId: z.string().describe("Session id"),
      transport: transportSchema.optional().describe("auto | direct | relay (default: auto)"),
      targetId: z.string().optional().describe("Optional target id for direct mode"),
      tabId: z.number().int().optional().describe("Optional Chrome tab id for relay mode"),
      url: z.string().optional().describe("Optional URL to open before annotating"),
      screenshotMode: screenshotModeSchema.optional().describe("visible | full | none (default: visible)"),
      debug: z.boolean().optional().describe("Include debug metadata"),
      context: z.string().optional().describe("Optional context for the annotator"),
      timeoutMs: z.number().int().optional().describe("Timeout in milliseconds")
    },
    async execute(args) {
      try {
        const transport = args.transport ?? "auto";
        if (transport === "relay") {
          const status = await deps.manager.status(args.sessionId);
          if (status.mode !== "extension") {
            return failure("Annotations require extension mode (relay).", "annotate_requires_extension");
          }
        }

        const response = await deps.annotationManager.requestAnnotation({
          sessionId: args.sessionId,
          transport,
          targetId: args.targetId,
          tabId: args.tabId,
          url: args.url,
          screenshotMode: args.screenshotMode ?? "visible",
          debug: args.debug ?? false,
          context: args.context,
          timeoutMs: args.timeoutMs
        });

        if (response.status !== "ok" || !response.payload) {
          const message = response.error?.message ?? "Annotation failed.";
          const code = response.error?.code ?? "annotate_failed";
          return failure(message, code);
        }

        const { message, details, screenshots } = await buildAnnotateResult(response.payload);

        return ok({
          message,
          details,
          screenshots
        });
      } catch (error) {
        return failure(serializeError(error).message, "annotate_failed");
      }
    }
  });
}
