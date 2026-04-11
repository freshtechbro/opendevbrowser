import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { ToolDeps } from "./deps";
import { desktopResult, desktopToolFailure, requireDesktopRuntime } from "./desktop-shared";

const z = tool.schema;

export function createDesktopAccessibilitySnapshotTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "Capture desktop accessibility state.",
    args: {
      reason: z.string().describe("Audit reason for the accessibility snapshot"),
      windowId: z.string().optional().describe("Optional desktop window id")
    },
    async execute(args) {
      const runtime = requireDesktopRuntime(deps);
      if (typeof runtime === "string") {
        return runtime;
      }
      try {
        return desktopResult(await runtime.accessibilitySnapshot(args.reason, args.windowId));
      } catch (error) {
        return desktopToolFailure(error, "desktop_accessibility_snapshot_failed");
      }
    }
  });
}
