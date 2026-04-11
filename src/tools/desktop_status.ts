import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { ToolDeps } from "./deps";
import { desktopToolFailure, requireDesktopRuntime } from "./desktop-shared";
import { ok } from "./response";

export function createDesktopStatusTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "Inspect sibling desktop observation availability.",
    args: {},
    async execute() {
      const runtime = requireDesktopRuntime(deps);
      if (typeof runtime === "string") {
        return runtime;
      }
      try {
        return ok(await runtime.status());
      } catch (error) {
        return desktopToolFailure(error, "desktop_status_failed");
      }
    }
  });
}
