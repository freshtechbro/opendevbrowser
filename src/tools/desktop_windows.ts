import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { ToolDeps } from "./deps";
import { desktopResult, desktopToolFailure, requireDesktopRuntime } from "./desktop-shared";

const z = tool.schema;

export function createDesktopWindowsTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "List observable desktop windows.",
    args: {
      reason: z.string().optional().describe("Optional audit reason")
    },
    async execute(args) {
      const runtime = requireDesktopRuntime(deps);
      if (typeof runtime === "string") {
        return runtime;
      }
      try {
        return desktopResult(await runtime.listWindows(args.reason));
      } catch (error) {
        return desktopToolFailure(error, "desktop_windows_failed");
      }
    }
  });
}
