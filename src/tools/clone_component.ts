import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { ToolDeps } from "./deps";
import { failure, ok, serializeError } from "./response";

const z = tool.schema;

export function createCloneComponentTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "Export a selected element subtree as a React component and CSS bundle.",
    args: {
      sessionId: z.string().describe("Active browser session id"),
      ref: z.string().describe("Element ref from snapshot")
    },
    async execute(args) {
      try {
        const result = await deps.manager.cloneComponent(args.sessionId, args.ref);
        return ok({ component: result.component, css: result.css, warnings: result.warnings });
      } catch (error) {
        return failure(serializeError(error).message, "clone_component_failed");
      }
    }
  });
}
