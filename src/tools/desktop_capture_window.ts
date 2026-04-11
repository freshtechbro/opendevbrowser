import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { ToolDeps } from "./deps";
import { desktopResult, desktopToolFailure, requireDesktopRuntime } from "./desktop-shared";

const z = tool.schema;

export function createDesktopCaptureWindowTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "Capture a specific desktop window.",
    args: {
      windowId: z.string().describe("Desktop window id"),
      reason: z.string().describe("Audit reason for the capture")
    },
    async execute(args) {
      const runtime = requireDesktopRuntime(deps);
      if (typeof runtime === "string") {
        return runtime;
      }
      try {
        return desktopResult(await runtime.captureWindow(args.windowId, { reason: args.reason }));
      } catch (error) {
        return desktopToolFailure(error, "desktop_capture_window_failed");
      }
    }
  });
}
